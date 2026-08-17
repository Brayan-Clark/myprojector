use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::fs;
use std::io::Write;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use warp::Filter;

fn get_data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    
    // Subdirs for our app
    let subdirs = ["data/hymnes", "data/bible", "backgrounds", "media"];
    for sub in subdirs {
        let mut full_path = path.clone();
        full_path.push(sub);
        if !full_path.exists() {
            fs::create_dir_all(&full_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(path)
}

// ============================================================================
// Optimisation automatique des médias (compression)
// ----------------------------------------------------------------------------
// Les vidéos/fonds trop lourds (4K, haut débit, très gros fichiers) font
// saturer le décodeur logiciel de WebKitGTK : la lecture se fige quelques
// secondes, parfois plusieurs minutes, puis reprend. Pour garantir une
// projection fluide, on re-transcode automatiquement avec ffmpeg (quand il est
// disponible) tout média qui dépasse les seuils ci-dessous. La conversion se
// fait "en place" (même nom de fichier), donc toutes les références existantes
// (paramètres, agenda, playlists) restent valides.
// ============================================================================

const VIDEO_SIZE_LIMIT: u64 = 80 * 1024 * 1024; // 80 Mo
const VIDEO_MAX_WIDTH: u64 = 1920;
const VIDEO_MAX_HEIGHT: u64 = 1080;
const VIDEO_MAX_BITRATE: u64 = 10_000_000; // 10 Mbps
const IMAGE_SIZE_LIMIT: u64 = 6 * 1024 * 1024; // 6 Mo
const IMAGE_MAX_WIDTH: u64 = 2560;
const IMAGE_MAX_HEIGHT: u64 = 1440;

// Fichiers en cours de traitement (évite de compresser deux fois le même).
static COMPRESSING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn compressing_lock() -> &'static Mutex<HashSet<String>> {
    COMPRESSING.get_or_init(|| Mutex::new(HashSet::new()))
}

fn file_ext(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

fn is_video_file(path: &Path) -> bool {
    matches!(file_ext(path).as_str(), "mp4" | "webm" | "ogg" | "mov" | "mkv" | "avi" | "m4v")
}

fn is_image_file(path: &Path) -> bool {
    matches!(file_ext(path).as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif")
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn ffmpeg_path() -> Option<PathBuf> {
    // 1) Dans le PATH
    if Command::new("ffmpeg").arg("-version").output().map(|o| o.status.success()).unwrap_or(false) {
        return Some(PathBuf::from("ffmpeg"));
    }
    // 2) Emplacements système classiques
    for p in ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"] {
        let pb = PathBuf::from(p);
        if pb.exists() { return Some(pb); }
    }
    // 3) Bundlé dans l'AppImage
    if let Ok(appdir) = std::env::var("APPDIR") {
        let pb = PathBuf::from(format!("{}/usr/bin/ffmpeg", appdir));
        if pb.exists() { return Some(pb); }
    }
    None
}

fn ffprobe_path() -> Option<PathBuf> {
    let ff = ffmpeg_path()?;
    if ff == PathBuf::from("ffmpeg") {
        if Command::new("ffprobe").arg("-version").output().map(|o| o.status.success()).unwrap_or(false) {
            return Some(PathBuf::from("ffprobe"));
        }
        return None;
    }
    let sibling = ff.parent()?.join("ffprobe");
    if sibling.exists() { Some(sibling) } else { None }
}

/// Retourne (largeur, hauteur, bitrate vidéo) via ffprobe, si disponible.
fn probe_video(path: &Path) -> Option<(u64, u64, u64)> {
    let probe = ffprobe_path()?;
    let out = Command::new(probe)
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,bit_rate",
            "-of", "default=noprint_wrappers=1",
        ])
        .arg(path)
        .output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut w = 0u64;
    let mut h = 0u64;
    let mut br = 0u64;
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("width=") { w = v.trim().parse().unwrap_or(0); }
        else if let Some(v) = line.strip_prefix("height=") { h = v.trim().parse().unwrap_or(0); }
        else if let Some(v) = line.strip_prefix("bit_rate=") { br = v.trim().parse().unwrap_or(0); }
    }
    if w > 0 && h > 0 { Some((w, h, br)) } else { None }
}

fn needs_video_compression(path: &Path) -> bool {
    if file_size(path) > VIDEO_SIZE_LIMIT { return true; }
    if let Some((w, h, br)) = probe_video(path) {
        if w > VIDEO_MAX_WIDTH || h > VIDEO_MAX_HEIGHT { return true; }
        if br > VIDEO_MAX_BITRATE { return true; }
    }
    false
}

fn needs_image_compression(path: &Path) -> bool {
    if file_size(path) > IMAGE_SIZE_LIMIT { return true; }
    if let Some((w, h, _)) = probe_video(path) {
        if w > IMAGE_MAX_WIDTH || h > IMAGE_MAX_HEIGHT { return true; }
    }
    false
}

/// Re-transcode une vidéo "en place" (même nom de fichier) vers une version
/// légère : max 1080p, H.264 CRF 26 (VP8 pour webm), audio AAC 128k.
fn compress_video(path: &Path) -> Result<(), String> {
    let ff = ffmpeg_path().ok_or("ffmpeg introuvable")?;
    let ext = file_ext(path);
    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("Nom de fichier invalide")?;
    let tmp = path.with_file_name(format!("{}.opt.{}", file_name, ext));

    let scale = "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos";
    let mut cmd = Command::new(&ff);
    cmd.arg("-hide_banner").arg("-loglevel").arg("error").arg("-y")
        .arg("-i").arg(path)
        .arg("-vf").arg(scale)
        .arg("-map").arg("0:v:0")
        .arg("-map").arg("0:a:0?");

    match ext.as_str() {
        "webm" => {
            cmd.args(["-c:v", "libvpx", "-crf", "10", "-b:v", "0", "-deadline", "good", "-cpu-used", "4"])
               .args(["-c:a", "libvorbis", "-b:a", "128k"]);
        }
        _ => {
            cmd.args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p"])
               .args(["-c:a", "aac", "-b:a", "128k"]);
            if ext == "mp4" || ext == "m4v" || ext == "mov" {
                cmd.arg("-movflags").arg("+faststart");
            }
        }
    }

    cmd.arg(&tmp);
    let out = cmd.output().map_err(|e| format!("ffmpeg: {}", e))?;
    if !out.status.success() {
        let _ = fs::remove_file(&tmp);
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("échec ffmpeg: {}", err.trim()));
    }

    // Remplace l'original par la version allégée (même chemin = références intactes)
    fs::rename(&tmp, path).map_err(|e| format!("renommage: {}", e))?;
    Ok(())
}

/// Redimensionne une image "en place" (max 2560x1440) et la ré-encode.
fn compress_image(path: &Path) -> Result<(), String> {
    let ff = ffmpeg_path().ok_or("ffmpeg introuvable")?;
    let ext = file_ext(path);
    if ext == "gif" { return Err("gif animé ignoré".into()); }
    let file_name = path.file_name().and_then(|n| n.to_str()).ok_or("Nom de fichier invalide")?;
    let tmp = path.with_file_name(format!("{}.opt.{}", file_name, ext));

    let scale = "scale=2560:1440:force_original_aspect_ratio=decrease:flags=lanczos";
    let mut cmd = Command::new(&ff);
    cmd.arg("-hide_banner").arg("-loglevel").arg("error").arg("-y")
        .arg("-i").arg(path)
        .arg("-vf").arg(scale);

    match ext.as_str() {
        "png" => { cmd.args(["-compression_level", "6"]); }
        "webp" => { cmd.args(["-quality", "82"]); }
        _ => { cmd.args(["-q:v", "3"]); } // jpg/jpeg
    }

    cmd.arg(&tmp);
    let out = cmd.output().map_err(|e| format!("ffmpeg: {}", e))?;
    if !out.status.success() {
        let _ = fs::remove_file(&tmp);
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("échec ffmpeg: {}", err.trim()));
    }

    fs::rename(&tmp, path).map_err(|e| format!("renommage: {}", e))?;
    Ok(())
}

/// Compresse un fichier s'il est trop lourd. Retourne true si compressé.
fn optimize_file(path: &Path) -> Result<bool, String> {
    if !path.is_file() { return Ok(false); }

    // Ignore les fichiers temporaires de compression restants
    if path.file_name().and_then(|n| n.to_str()).map(|n| n.contains(".opt.")).unwrap_or(false) {
        return Ok(false);
    }

    let (is_video, heavy) = if is_video_file(path) {
        (true, needs_video_compression(path))
    } else if is_image_file(path) {
        (false, needs_image_compression(path))
    } else {
        return Ok(false);
    };

    if !heavy { return Ok(false); }

    // Évite de traiter deux fois le même fichier en parallèle
    let key = path.to_string_lossy().to_string();
    {
        let mut set = compressing_lock().lock().unwrap();
        if set.contains(&key) { return Ok(false); }
        set.insert(key.clone());
    }

    let before = file_size(path);
    let result = if is_video { compress_video(path) } else { compress_image(path) };

    {
        let mut set = compressing_lock().lock().unwrap();
        set.remove(&key);
    }

    match result {
        Ok(()) => {
            let after = file_size(path);
            println!("Média optimisé: {:?} ({} Mo → {} Mo)", path, before / (1024 * 1024), after / (1024 * 1024));
            Ok(true)
        }
        Err(e) => Err(e),
    }
}

#[derive(Serialize)]
struct OptimizeReport {
    scanned: usize,
    compressed: usize,
    skipped: usize,
    errors: usize,
    messages: Vec<String>,
}

fn scan_folder(folder: &Path, report: &mut OptimizeReport) {
    let entries = match fs::read_dir(folder) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        report.scanned += 1;
        match optimize_file(&path) {
            Ok(true) => {
                report.compressed += 1;
                let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                report.messages.push(format!("✅ {} optimisé", name));
            }
            Ok(false) => report.skipped += 1,
            Err(e) => {
                report.errors += 1;
                let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                report.messages.push(format!("⚠️ {} : {}", name, e));
            }
        }
    }
}

/// Analyse tous les médias (fonds + agenda) et compresse ceux qui sont trop lourds.
#[tauri::command]
async fn optimize_all_media(app_handle: tauri::AppHandle) -> Result<OptimizeReport, String> {
    if ffmpeg_path().is_none() {
        return Ok(OptimizeReport {
            scanned: 0,
            compressed: 0,
            skipped: 0,
            errors: 0,
            messages: vec!["ffmpeg introuvable : la compression automatique est désactivée. Installez ffmpeg pour activer l'optimisation des médias.".into()],
        });
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = get_data_root(&app_handle)?;
        let mut report = OptimizeReport { scanned: 0, compressed: 0, skipped: 0, errors: 0, messages: Vec::new() };
        scan_folder(&root.join("backgrounds"), &mut report);
        scan_folder(&root.join("media"), &mut report);
        Ok(report)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn init_data(app: &tauri::AppHandle) -> Result<(), String> {
    let data_root = get_data_root(app)?;
    println!("Initializing data in {:?}", data_root);
    
    // Use a flag to only copy once, so user deletions persist
    let flag_path = data_root.join(".initialized");
    if flag_path.exists() {
        println!("Data already initialized. Skipping copy.");
        return Ok(());
    }

    if let Ok(res_dir) = app.path().resource_dir() {
        println!("Resources found in {:?}", res_dir);
        // Copy DBs
        let data_src = res_dir.join("data");
        if data_src.exists() {
            println!("Copying data from {:?} to {:?}", data_src, data_root);
            let _ = copy_dir_recursive(&data_src, &data_root.join("data"));
        }
        
        // Copy initial backgrounds
        let bg_src = res_dir.join("backgrounds");
        if bg_src.exists() {
             println!("Copying backgrounds from {:?} to {:?}", bg_src, data_root);
             let _ = copy_dir_recursive(&bg_src, &data_root.join("backgrounds"));
        }
    } else {
        println!("Resource directory not found!");
    }

    // Create flag file
    let _ = fs::File::create(flag_path);
    
    Ok(())
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    if !dst.exists() {
        fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    }
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            let dest_file = dst.join(entry.file_name());
            if !dest_file.exists() {
                if let Err(e) = fs::copy(entry.path(), &dest_file) {
                    println!("Failed to copy file {:?}: {}", entry.path(), e);
                }
            }
        }
    }
    Ok(())
}

// --- Security helpers -------------------------------------------------------
// Reject any path component that could be used to escape the intended folder
// (path traversal). File/db names coming from the frontend or remote manifests
// must be plain file names, never paths.
fn safe_component(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.contains('\0')
    {
        return Err(format!("Nom de fichier invalide: {}", name));
    }
    Ok(())
}

// Only the two known content categories are allowed as a sub-directory name.
fn safe_category(category: &str) -> Result<(), String> {
    match category {
        "hymnes" | "bible" => Ok(()),
        _ => Err(format!("Catégorie invalide: {}", category)),
    }
}

#[derive(Serialize, Deserialize)]
pub struct Song {
    pub id: i64,
    pub number: String,
    pub title: String,
    pub lyrics: String,
    pub book: String,
}

#[tauri::command]
async fn fetch_hymns(app_handle: tauri::AppHandle, db_name: String) -> Result<Vec<Song>, String> {
    safe_component(&db_name)?;
    // Offload the (potentially heavy) SQLite read to a blocking thread so the
    // UI/IPC thread never freezes while loading a song book.
    tauri::async_runtime::spawn_blocking(move || fetch_hymns_blocking(&app_handle, &db_name))
        .await
        .map_err(|e| e.to_string())?
}

fn fetch_hymns_blocking(app_handle: &tauri::AppHandle, db_name: &str) -> Result<Vec<Song>, String> {
    let mut db_path = get_data_root(app_handle)?;
    db_path.push("data");
    db_path.push("hymnes");
    db_path.push(db_name);

    if !db_path.exists() {
        return Err(format!("Database not found at {:?}", db_path));
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    // table: adventiste_cantique
    // fields: id, c_num, c_title, c_content
    let mut stmt = conn
        .prepare("SELECT id, c_num, c_title, c_content FROM adventiste_cantique")
        .map_err(|e| e.to_string())?;
    let song_iter = stmt
        .query_map([], |row| {
            let num: i32 = row.get(1)?;
            Ok(Song {
                id: row.get(0)?,
                number: num.to_string(),
                title: row.get(2)?,
                lyrics: row.get(3)?,
                book: db_name.replace(".db", ""), // default book from db name
            })
        })
        .map_err(|e| e.to_string())?;

    let mut songs = Vec::new();
    for song in song_iter {
        songs.push(song.map_err(|e| e.to_string())?);
    }

    Ok(songs)
}

#[derive(Serialize, Deserialize)]
pub struct BibleVerse {
    pub id: i64,
    pub book: String,
    pub chapter: i32,
    pub number: i32,
    pub text: String,
}

#[tauri::command]
async fn fetch_bible(app_handle: tauri::AppHandle, db_name: String) -> Result<Vec<Song>, String> {
    safe_component(&db_name)?;
    // The whole Bible is ~31k verses; do this off the UI/IPC thread.
    tauri::async_runtime::spawn_blocking(move || fetch_bible_blocking(&app_handle, &db_name))
        .await
        .map_err(|e| e.to_string())?
}

fn fetch_bible_blocking(app_handle: &tauri::AppHandle, db_name: &str) -> Result<Vec<Song>, String> {
    let mut db_path = get_data_root(app_handle)?;
    db_path.push("data");
    db_path.push("bible");
    db_path.push(db_name);

    if !db_path.exists() {
        return Err(format!("Database not found at {:?}", db_path));
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    // Pour simplifier et les lister dans LeftSidebar,
    // on groupe les versets par chapitre et on les traite comme un "Chant"
    // ID, title="Genèse 1", content="1. Au commencement..."
    let mut stmt = conn
        .prepare(
            "
        SELECT b.long_name, v.chapter, v.verse, v.text 
        FROM verses v
        JOIN books b ON v.book_number = b.book_number
        ORDER BY v.book_number, v.chapter, v.verse
    ",
        )
        .map_err(|e| e.to_string())?;

    let mut current_book = String::new();
    let mut current_chapter = 0;
    let mut current_title = String::new();
    let mut current_content = String::new();
    let mut current_id = 0;
    let mut songs = Vec::new();

    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let book_name: String = row.get(0).map_err(|e| e.to_string())?;
        let chapter: i32 = row.get(1).map_err(|e| e.to_string())?;
        let verse: i32 = row.get(2).map_err(|e| e.to_string())?;
        let text: String = row.get(3).map_err(|e| e.to_string())?;

        let title = format!("{} {}", book_name, chapter);
        if current_title != title {
            if !current_title.is_empty() {
                songs.push(Song {
                    id: current_id as i64,
                    number: current_chapter.to_string(),
                    title: current_title.clone(),
                    lyrics: current_content.clone(),
                    book: current_book.clone(),
                });
                current_id += 1;
            }
            current_title = title;
            current_book = book_name;
            current_chapter = chapter;
            current_content = format!("{}\n{}", verse, text);
        } else {
            current_content.push_str(&format!("\n\n{}\n{}", verse, text));
        }
    }
    if !current_title.is_empty() {
        songs.push(Song {
            id: current_id as i64,
            number: current_chapter.to_string(),
            title: current_title,
            lyrics: current_content,
            book: current_book,
        });
    }

    Ok(songs)
}

#[tauri::command]
fn update_song(
    app_handle: tauri::AppHandle,
    db_name: &str,
    is_bible: bool,
    id: i64,
    title: String,
    content: String,
) -> Result<(), String> {
    safe_component(db_name)?;
    let mut db_path = get_data_root(&app_handle)?;
    db_path.push("data");
    db_path.push(if is_bible { "bible" } else { "hymnes" });
    db_path.push(db_name);

    if !db_path.exists() {
        return Err(format!("Database not found at {:?}", db_path));
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    if is_bible {
        // Not supporting bible updates right now as it modifies verses
        return Err("L'édition de la Bible n'est pas supportée pour l'instant.".to_string());
    } else {
        conn.execute(
            "UPDATE adventiste_cantique SET c_title = ?1, c_content = ?2 WHERE id = ?3",
            (title, content, id),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}



#[tauri::command]
fn list_dbs(app_handle: tauri::AppHandle, category: &str) -> Result<Vec<String>, String> {
    safe_category(category)?;
    let mut dir_path = get_data_root(&app_handle)?;
    dir_path.push("data");
    dir_path.push(category);

    let mut files = Vec::new();
    if dir_path.exists() {
        for entry in fs::read_dir(dir_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() {
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    if file_name.ends_with(".db") || file_name.ends_with(".SQLite3") {
                        files.push(file_name.to_string());
                    }
                }
            }
        }
    }
    Ok(files)
}

#[tauri::command]
async fn download_db(app_handle: tauri::AppHandle, url: String, category: String, filename: String) -> Result<(), String> {
    println!("Downloading {} from {}", filename, url);

    // --- Validate inputs before touching the filesystem or the network ------
    safe_category(&category)?;
    safe_component(&filename)?;

    // Only allow downloads from the project's GitHub raw host (no SSRF / no
    // arbitrary file fetching through this command).
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("URL invalide: {}", e))?;
    let host = parsed.host_str().unwrap_or("");
    if host != "raw.githubusercontent.com" && !host.ends_with(".githubusercontent.com") {
        return Err(format!("Hôte non autorisé: {}", host));
    }

    let mut dest_path = get_data_root(&app_handle)?;
    dest_path.push("data");
    dest_path.push(&category);
    fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;
    dest_path.push(&filename);

    let client = reqwest::Client::builder()
        .user_agent("MyProjector/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    // Add cache buster to URL to skip Github CDN cache
    let cache_buster = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let final_url = if url.contains('?') {
        format!("{}&cb={}", url, cache_buster)
    } else {
        format!("{}?cb={}", url, cache_buster)
    };

    let response = client.get(&final_url)
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache")
        .send().await.map_err(|e| e.to_string())?;
    
    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}. URL: {}", response.status(), final_url));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    let mut file = fs::File::create(&dest_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;

    println!("Download complete: {:?}", dest_path);
    Ok(())
}

#[tauri::command]
fn delete_db(app_handle: tauri::AppHandle, category: &str, filename: &str) -> Result<(), String> {
    safe_category(category)?;
    safe_component(filename)?;
    let mut db_path = get_data_root(&app_handle)?;
    db_path.push("data");
    db_path.push(category);
    db_path.push(filename);

    if db_path.exists() {
        fs::remove_file(db_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn list_backgrounds(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    // Return absolute paths so the frontend can use convertFileSrc
    let mut dir_path = get_data_root(&app_handle)?;
    dir_path.push("backgrounds");

    if !dir_path.exists() {
        fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(&dir_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            if let Some(_filename) = path.file_name().and_then(|n| n.to_str()) {
                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                if ["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "ogg", "mov", "mkv", "avi", "m4v"].contains(&ext.as_str()) {
                    files.push(path.to_string_lossy().to_string());
                }
            }
        }
    }
    Ok(files)
}

#[tauri::command]
fn import_background(app_handle: tauri::AppHandle, source_path: String) -> Result<String, String> {
    let mut dest_dir = get_data_root(&app_handle)?;
    dest_dir.push("backgrounds");

    if !dest_dir.exists() {
        fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }

    let src = std::path::Path::new(&source_path);
    let filename = src.file_name().ok_or("Invalid filename")?;
    let mut dest_path = dest_dir.clone();
    dest_path.push(filename);

    fs::copy(src, &dest_path).map_err(|e| e.to_string())?;

    // Compression automatique en arrière-plan : si le fichier est trop lourd,
    // il est remplacé "en place" par une version allégée (même chemin, donc
    // toutes les références existantes restent valides).
    let optimize_target = dest_path.clone();
    std::thread::spawn(move || {
        match optimize_file(&optimize_target) {
            Ok(true) => println!("Fond optimisé: {:?}", optimize_target),
            Ok(false) => println!("Fond déjà léger: {:?}", optimize_target),
            Err(e) => eprintln!("Optimisation du fond échouée {:?}: {}", optimize_target, e),
        }
    });

    // Return the absolute path
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_background(app_handle: tauri::AppHandle, file_path: String) -> Result<(), String> {
    // file_path is now an absolute path
    let bg_path = PathBuf::from(&file_path);
    
    // Safety check: ensure it's inside our backgrounds folder
    let mut root = get_data_root(&app_handle)?;
    root.push("backgrounds");
    
    if !bg_path.starts_with(&root) {
        return Err("Accès refusé: le fichier est en dehors du dossier backgrounds".to_string());
    }

    if bg_path.exists() {
        fs::remove_file(&bg_path).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("File not found: {:?}", bg_path))
    }
}

#[tauri::command]
fn delete_media(app_handle: tauri::AppHandle, file_path: String) -> Result<(), String> {
    let media_path = PathBuf::from(&file_path);
    let mut root = get_data_root(&app_handle)?;
    root.push("media");
    
    if !media_path.starts_with(&root) {
        return Err("Accès refusé".to_string());
    }

    if media_path.exists() {
        fs::remove_file(&media_path).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("File not found: {:?}", media_path))
    }
}

#[tauri::command]
fn import_media(app_handle: tauri::AppHandle, source_path: String) -> Result<String, String> {
    let mut dest_dir = get_data_root(&app_handle)?;
    dest_dir.push("media");

    if !dest_dir.exists() {
        fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }

    let src = std::path::Path::new(&source_path);
    let filename = src.file_name().ok_or("Invalid filename")?;
    let mut dest_path = dest_dir.clone();
    dest_path.push(filename);

    fs::copy(src, &dest_path).map_err(|e| e.to_string())?;

    // Compression automatique en arrière-plan (même logique que les fonds).
    let optimize_target = dest_path.clone();
    std::thread::spawn(move || {
        match optimize_file(&optimize_target) {
            Ok(true) => println!("Média agenda optimisé: {:?}", optimize_target),
            Ok(false) => println!("Média agenda déjà léger: {:?}", optimize_target),
            Err(e) => eprintln!("Optimisation du média échouée {:?}: {}", optimize_target, e),
        }
    });

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_text_file(app_handle: tauri::AppHandle, path: String) -> Result<String, String> {
    // Restrict reads to the application's data directory so this command can't
    // be abused to exfiltrate arbitrary files (e.g. /etc/passwd, SSH keys).
    let root = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let requested = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let root_canon = fs::canonicalize(&root).unwrap_or(root);

    if !requested.starts_with(&root_canon) {
        return Err("Accès refusé: fichier hors du dossier de l'application".to_string());
    }

    fs::read_to_string(requested).map_err(|e| e.to_string())
}

// Playlist import/export. The path comes from the OS save/open dialog (an
// explicit user gesture). We only allow .json so this can't be misused to
// read/write arbitrary files — this replaces the broad fs plugin permissions.
#[tauri::command]
fn save_playlist_file(path: String, content: String) -> Result<(), String> {
    if !path.to_lowercase().ends_with(".json") {
        return Err("Seuls les fichiers .json sont autorisés".to_string());
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_playlist_file(path: String) -> Result<String, String> {
    if !path.to_lowercase().ends_with(".json") {
        return Err("Seuls les fichiers .json sont autorisés".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_data_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    // In Dev, we might want to point to the project's public folder for default backgrounds
    // In Prod, we always use the app_data_dir
    let path = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        // Fix for AppImage -- disable GPU compositing to prevent green screen artifacts
        // NOTE: We intentionally do NOT disable HW_ACCELERATION as that breaks video playback
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        
        // Force GStreamer to use bundled plugins (important for AppImage)
        // This avoids conflicts with system gstreamer plugins that may not support H264/VP8
        if std::env::var("APPDIR").is_ok() {
            // We are running inside an AppImage
            let appdir = std::env::var("APPDIR").unwrap_or_default();
            let gst_plugin_path = format!("{}/usr/lib/x86_64-linux-gnu/gstreamer-1.0", appdir);
            if std::path::Path::new(&gst_plugin_path).exists() {
                std::env::set_var("GST_PLUGIN_PATH", &gst_plugin_path);
                std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", &gst_plugin_path);
            }
        }
    }

    tauri::Builder::default()
        .setup(|app| {
            init_data(app.handle())?;
            
            let _app_data_path = app.path().app_data_dir().unwrap_or_default();
            
            // Fix for Linux Camera Permissions - Initial windows
            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::WebViewExt;
                use webkit2gtk::PermissionRequestExt;
                use webkit2gtk::glib::Cast;
                for window in app.webview_windows().values() {
                    let _ = window.with_webview(|webview| {
                        let webkit_webview = webview.inner();
                        webkit_webview.connect_permission_request(|_view, request: &webkit2gtk::PermissionRequest| {
                            if let Ok(user_media_request) = request.clone().downcast::<webkit2gtk::UserMediaPermissionRequest>() {
                                println!("Granting camera/mic permission for window on Linux");
                                user_media_request.allow();
                                return true; 
                            }
                            false 
                        });
                    });
                }
            }

            let _ = std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime for warp");
                rt.block_on(async {
                    // SECURITE: on ne laisse que les origines de l'application lire le
                    // serveur de médias. Avant, `allow_any_origin()` exposait tout le
                    // dossier AppData (fonds, médias, playlists, bases de données) à
                    // n'importe quel site web ouvert sur la machine.
                    let cors = warp::cors()
                        .allow_origins(vec![
                            "http://localhost:1420", // dev (vite)
                            "http://tauri.localhost", // prod Linux/Windows
                            "https://tauri.localhost",
                            "tauri://localhost", // prod macOS
                        ])
                        .allow_methods(vec!["GET", "POST", "OPTIONS"])
                        .allow_headers(vec!["Range", "Content-Type", "Accept", "Origin"]);

                    // Bloque le DNS rebinding : on refuse toute requête dont l'en-tête
                    // Host n'est pas le serveur local attendu.
                    let host_ok = warp::header::optional::<String>("host")
                        .and_then(|host: Option<String>| async move {
                            match host {
                                Some(h) if h.starts_with("127.0.0.1:11223") || h.starts_with("localhost:11223") => Ok(()),
                                Some(_) => Err(warp::reject::reject()),
                                None => Ok(()),
                            }
                        })
                        .untuple_one();
                    
                    // On ne sert QUE le dossier AppData pour plus de stabilité
                    let fs_route = host_ok
                        .and(warp::path("fs"))
                        .and(warp::fs::dir(_app_data_path))
                        .with(cors);
                    
                    println!("Media server (AppData only) running on http://127.0.0.1:11223");
                    warp::serve(fs_route).run(([127, 0, 0, 1], 11223)).await;
                });
            });

            // Analyse des médias déjà en place : re-compresse en arrière-plan les
            // fichiers trop lourds (démarrage différé pour ne pas ralentir
            // l'ouverture de l'application).
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(15));
                    if ffmpeg_path().is_none() {
                        println!("Optimisation des médias: ffmpeg introuvable, ignoré.");
                        return;
                    }
                    let root = match handle.path().app_data_dir() {
                        Ok(p) => p,
                        Err(e) => {
                            eprintln!("Optimisation des médias: app_data_dir: {}", e);
                            return;
                        }
                    };
                    let mut report = OptimizeReport { scanned: 0, compressed: 0, skipped: 0, errors: 0, messages: Vec::new() };
                    scan_folder(&root.join("backgrounds"), &mut report);
                    scan_folder(&root.join("media"), &mut report);
                    println!(
                        "Optimisation des médias terminée: {} analysés, {} compressés, {} déjà légers, {} erreurs",
                        report.scanned, report.compressed, report.skipped, report.errors
                    );
                });
            }
            
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            // Fix for Linux Camera Permissions - Robust handling for ALL windows
            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::WebViewExt;
                use webkit2gtk::PermissionRequestExt;
                use webkit2gtk::glib::Cast;
                use webkit2gtk::glib::ObjectExt;
                use tauri::Manager;
                
                // On récupère le WebviewWindow correspondant à cette fenêtre
                if let Some(webview_window) = window.get_webview_window(window.label()) {
                    let _ = webview_window.with_webview(|platform_webview: tauri::webview::PlatformWebview| {
                        let webkit_webview = platform_webview.inner();
                        
                        // On utilise un tag GLib pour ne pas connecter le signal plusieurs fois
                        let has_handler = unsafe { 
                            webkit_webview.data::<bool>("permission_handler_attached").is_some() 
                        };

                        if !has_handler {
                            webkit_webview.connect_permission_request(|_view, request: &webkit2gtk::PermissionRequest| {
                                if let Ok(user_media_request) = request.clone().downcast::<webkit2gtk::UserMediaPermissionRequest>() {
                                    println!("Granting camera/mic permission for window: Linux native");
                                    user_media_request.allow();
                                    return true;
                                }
                                false
                            });
                            unsafe { webkit_webview.set_data("permission_handler_attached", true); }
                        }
                    });
                }
            }

            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    if window.label() == "main" {
                        window.app_handle().exit(0);
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            fetch_hymns,
            fetch_bible,
            update_song,
            list_dbs,
            download_db,
            delete_db,
            list_backgrounds,
            import_background,
            delete_background,
            import_media,
            delete_media,
            optimize_all_media,
            get_app_data_path,
            read_text_file,
            save_playlist_file,
            read_playlist_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
