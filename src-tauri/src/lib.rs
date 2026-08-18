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

/// Nombre de threads laissés à ffmpeg : au plus la moitié des coeurs, jamais 0.
/// L'autre moitié reste disponible pour le décodage vidéo de WebKitGTK, sinon
/// la projection se fige pendant toute la durée de la compression.
fn encoder_threads() -> usize {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    std::cmp::max(1, cores / 2)
}

/// Construit une commande ffmpeg/ffprobe qui ne peut pas voler le CPU à la
/// projection : priorité minimale (nice 19) quand `nice` est disponible.
fn low_priority_command(program: &Path) -> Command {
    #[cfg(unix)]
    {
        if Path::new("/usr/bin/nice").exists() {
            let mut cmd = Command::new("/usr/bin/nice");
            cmd.arg("-n").arg("19").arg(program);
            return cmd;
        }
    }
    Command::new(program)
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
    let out = low_priority_command(&probe)
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
    let mut cmd = low_priority_command(&ff);
    cmd.arg("-hide_banner").arg("-loglevel").arg("error").arg("-y")
        .arg("-threads").arg(encoder_threads().to_string())
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
    let mut cmd = low_priority_command(&ff);
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

/// `hold` est consulté avant CHAQUE fichier : tant qu'il renvoie true on attend.
/// Cela permet de suspendre la compression dès qu'une projection démarre, même
/// si le scan avait déjà commencé.
fn scan_folder(folder: &Path, report: &mut OptimizeReport, hold: &dyn Fn() -> bool) {
    let entries = match fs::read_dir(folder) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        while hold() {
            std::thread::sleep(std::time::Duration::from_secs(30));
        }
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
        // Déclenché manuellement par l'utilisateur : on ne suspend pas.
        scan_folder(&root.join("backgrounds"), &mut report, &|| false);
        scan_folder(&root.join("media"), &mut report, &|| false);
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
    /// Identifiant de la collection audio associée au cantique (colonne
    /// `c_playbacks`, ex: "fihirana-adventista"). La piste elle-même se
    /// retrouve par `number`, qui correspond au `c_num` du playback.
    /// `None` pour la Bible et pour les recueils sans cette colonne.
    #[serde(default)]
    pub playback: Option<String>,
    /// Abréviation du livre biblique (`books.short_name`, ex: "1jao").
    /// Indispensable pour retrouver "1Jao 3:16" : le `long_name` s'écrit
    /// "1 Jaona", avec une espace que personne ne tape dans une référence.
    #[serde(default)]
    pub abbr: Option<String>,
    /// Rang du livre biblique (1 = Genèse … 66 = Apocalypse).
    /// C'est CE rang, et non `books.book_number`, qui indexe la carte audio :
    /// la numérotation MyBible (10…730) saute des valeurs réservées aux
    /// deutérocanoniques, la carte non.
    #[serde(default)]
    pub book_index: Option<i32>,
    /// Fichier de la version biblique chargée (ex: "MG65.SQLite3"), pour ne
    /// proposer l'audio malgache qu'avec le texte qui lui correspond.
    #[serde(default)]
    pub version: Option<String>,
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
    // fields: id, c_num, c_title, c_content, (c_playbacks)
    //
    // `c_playbacks` relie le cantique à sa collection audio, mais tous les
    // recueils ne l'ont pas : on vérifie sa présence avant de la demander,
    // sinon SQLite renvoie une erreur et le recueil entier ne se charge plus.
    let has_playbacks = conn
        .prepare("SELECT * FROM adventiste_cantique LIMIT 0")
        .map(|st| st.column_names().iter().any(|c| *c == "c_playbacks"))
        .unwrap_or(false);

    let sql = if has_playbacks {
        "SELECT id, c_num, c_title, c_content, c_playbacks FROM adventiste_cantique"
    } else {
        "SELECT id, c_num, c_title, c_content, NULL FROM adventiste_cantique"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let song_iter = stmt
        .query_map([], |row| {
            let num: i32 = row.get(1)?;
            let playback: Option<String> = row.get(4).unwrap_or(None);
            Ok(Song {
                id: row.get(0)?,
                number: num.to_string(),
                title: row.get(2)?,
                lyrics: row.get(3)?,
                book: db_name.replace(".db", ""), // default book from db name
                playback: playback.filter(|p| !p.trim().is_empty()),
                abbr: None,
                book_index: None,
                version: None,
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
        SELECT b.long_name, v.chapter, v.verse, v.text, b.short_name
        FROM verses v
        JOIN books b ON v.book_number = b.book_number
        ORDER BY v.book_number, v.chapter, v.verse
    ",
        )
        .map_err(|e| e.to_string())?;

    let mut current_book = String::new();
    let mut current_abbr: Option<String> = None;
    // Rang du livre en cours (1..66), incrémenté à chaque changement de livre.
    let mut current_index: i32 = 0;
    let mut current_chapter = 0;
    let mut current_title = String::new();
    let mut current_content = String::new();
    let mut current_id = 0;
    let mut songs = Vec::new();

    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let book_name: String = row.get(0).map_err(|e| e.to_string())?;
        let book_abbr: Option<String> = row.get(4).unwrap_or(None);
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
                    playback: None, // pas d'audio associé pour la Bible
                    abbr: current_abbr.clone(),
                    book_index: Some(current_index),
                    version: Some(db_name.to_string()),
                });
                current_id += 1;
            }
            current_title = title;
            if current_book != book_name {
                current_index += 1;
            }
            current_book = book_name;
            current_abbr = book_abbr;
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
            playback: None,
            abbr: current_abbr,
            book_index: Some(current_index),
            version: Some(db_name.to_string()),
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

// ============================================================================
// Bibliothèque : contenus téléchargeables à la carte (documents PDF, Mofon'aina)
// ----------------------------------------------------------------------------
// Rien n'est téléchargé sans action de l'utilisateur. Les fichiers atterrissent
// dans <appdata>/data/<kind>/, donc le serveur warp les sert déjà sur
// http://127.0.0.1:11223/fs/data/<kind>/<fichier> (voir cleanUrl côté React).
// ============================================================================

/// Dossier des écoutes en ligne, séparé des vrais téléchargements.
const AUDIO_CACHE_DIR: &str = "_cache";

/// Sous-dossiers autorisés pour la bibliothèque téléchargeable.
fn safe_library_kind(kind: &str) -> Result<(), String> {
    match kind {
        "docs" | "mofonaina" | "audio" => Ok(()),
        _ => Err(format!("Type de contenu invalide: {}", kind)),
    }
}

/// Un identifiant de collection (ex: "fihirana-adventista") sert de sous-dossier :
/// on n'accepte donc que des slugs, jamais de séparateur de chemin.
fn safe_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty() || !slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("Identifiant invalide: {}", slug));
    }
    Ok(())
}

fn library_dir(app_handle: &tauri::AppHandle, kind: &str) -> Result<PathBuf, String> {
    safe_library_kind(kind)?;
    let mut dir = get_data_root(app_handle)?;
    dir.push("data");
    dir.push(kind);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Dossier d'une collection : <appdata>/data/<kind>/<collection>/
fn library_collection_dir(
    app_handle: &tauri::AppHandle,
    kind: &str,
    collection: &Option<String>,
) -> Result<PathBuf, String> {
    let mut dir = library_dir(app_handle, kind)?;
    if let Some(c) = collection {
        safe_slug(c)?;
        dir.push(c);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

/// Hôtes autorisés au téléchargement, par type de contenu.
///
/// Les documents et le Mofon'aina viennent du dépôt du projet. Les audios, eux,
/// sont hébergés ailleurs (Google Drive, sdahymnals...) : la liste reste
/// explicite pour que cette commande ne devienne pas un téléchargeur d'URL
/// arbitraire pilotable depuis la page.
fn host_allowed(kind: &str, host: &str) -> bool {
    let github = host == "raw.githubusercontent.com" || host.ends_with(".githubusercontent.com");
    match kind {
        "audio" => {
            github
                || host == "sdahymnals.com"
                || host == "www.sdahymnals.com"
                || host == "drive.google.com"
                || host == "drive.usercontent.google.com"
                || host.ends_with(".fanantenanahoanao.org")
                || host == "fanantenanahoanao.org"
                || host == "nybaiboly.net"
                || host == "www.nybaiboly.net"
        }
        _ => github,
    }
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    id: String,
    received: u64,
    total: u64,
}

/// Télécharge un fichier de la bibliothèque en émettant la progression.
/// Les PDF vont jusqu'à ~30 Mo : on écrit au fil de l'eau plutôt que de garder
/// tout le fichier en mémoire, et on informe l'interface pour éviter l'attente
/// aveugle qui donnait l'impression que l'application était figée.
#[tauri::command]
async fn download_library_file(
    app_handle: tauri::AppHandle,
    url: String,
    kind: String,
    filename: String,
    id: String,
    collection: Option<String>,
) -> Result<String, String> {
    use tauri::Emitter;

    safe_component(&filename)?;
    let dir = library_collection_dir(&app_handle, &kind, &collection)?;

    // Garde-fou anti-SSRF : pas de téléchargement d'URL arbitraire.
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("URL invalide: {}", e))?;
    let host = parsed.host_str().unwrap_or("");
    if !host_allowed(&kind, host) {
        return Err(format!("Hôte non autorisé: {}", host));
    }

    let client = reqwest::Client::builder()
        .user_agent("MyProjector/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Téléchargement échoué ({}) : {}", response.status(), url));
    }

    let total = response.content_length().unwrap_or(0);
    let dest_path = dir.join(&filename);
    // Fichier temporaire : un téléchargement interrompu ne laisse jamais un
    // fichier tronqué qui passerait pour installé.
    let tmp_path = dir.join(format!("{}.part", filename));
    let mut file = fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;

    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        // On n'émet qu'environ tous les 256 Ko : sinon l'IPC sature l'interface.
        if received - last_emit > 256 * 1024 || received == total {
            last_emit = received;
            let _ = app_handle.emit(
                "library_download_progress",
                DownloadProgress { id: id.clone(), received, total },
            );
        }
    }

    drop(file);
    fs::rename(&tmp_path, &dest_path).map_err(|e| format!("renommage: {}", e))?;
    Ok(dest_path.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Entretien du stockage
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct StorageEntry {
    id: String,
    label: String,
    bytes: u64,
    files: usize,
    /// true si l'utilisateur peut vider cette entrée sans rien perdre.
    clearable: bool,
    /// Chemin réel sur le disque, pour pouvoir ouvrir le dossier.
    path: String,
    exists: bool,
}

#[derive(Serialize)]
struct StorageReport {
    entries: Vec<StorageEntry>,
    total: u64,
    /// Téléchargements interrompus (.part) : invisibles ailleurs dans l'interface.
    partial_files: usize,
    partial_bytes: u64,
    root: String,
}

/// Taille et nombre de fichiers d'un dossier, récursivement.
fn dir_stats(dir: &Path) -> (u64, usize) {
    let mut bytes = 0;
    let mut count = 0;
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return (0, 0),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let (b, c) = dir_stats(&path);
            bytes += b;
            count += c;
        } else if path.is_file() {
            bytes += file_size(&path);
            count += 1;
        }
    }
    (bytes, count)
}

/// Liste les téléchargements inachevés sous un dossier.
fn find_partials(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            find_partials(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("part") {
            out.push(path);
        }
    }
}

#[tauri::command]
fn storage_report(app_handle: tauri::AppHandle) -> Result<StorageReport, String> {
    let root = get_data_root(&app_handle)?;
    let audio_root = root.join("data").join("audio");

    // Le cache d'écoute en ligne est compté à part : c'est le seul dossier
    // qui grossit sans action explicite de l'utilisateur.
    let cache_dir = audio_root.join(AUDIO_CACHE_DIR);
    let (cache_bytes, cache_files) = dir_stats(&cache_dir);
    let (audio_bytes, audio_files) = dir_stats(&audio_root);

    let mut entries = Vec::new();
    let mut add = |id: &str, label: &str, path: PathBuf, clearable: bool| {
        let (bytes, files) = dir_stats(&path);
        entries.push(StorageEntry {
            id: id.into(), label: label.into(), bytes, files, clearable,
            exists: path.exists(),
            path: path.to_string_lossy().to_string(),
        });
    };

    add("bible", "Bibles", root.join("data").join("bible"), false);
    add("hymnes", "Recueils de chants", root.join("data").join("hymnes"), false);
    add("docs", "Documents PDF", root.join("data").join("docs"), false);
    add("mofonaina", "Mofon'aina", root.join("data").join("mofonaina"), false);
    add("backgrounds", "Fonds d'écran", root.join("backgrounds"), false);
    add("media", "Médias de l'agenda", root.join("media"), false);

    entries.push(StorageEntry {
        id: "audio".into(),
        label: "Audios téléchargés".into(),
        bytes: audio_bytes.saturating_sub(cache_bytes),
        files: audio_files.saturating_sub(cache_files),
        clearable: false,
        exists: audio_root.exists(),
        path: audio_root.to_string_lossy().to_string(),
    });
    entries.push(StorageEntry {
        id: "audio_cache".into(),
        label: "Cache des écoutes en ligne".into(),
        bytes: cache_bytes,
        files: cache_files,
        clearable: true,
        exists: cache_dir.exists(),
        path: cache_dir.to_string_lossy().to_string(),
    });

    let mut partials = Vec::new();
    find_partials(&root, &mut partials);
    let partial_bytes = partials.iter().map(|p| file_size(p)).sum();

    Ok(StorageReport {
        total: entries.iter().map(|e| e.bytes).sum::<u64>() + partial_bytes,
        entries,
        partial_files: partials.len(),
        partial_bytes,
        root: root.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------------------
// Télécommande sur le réseau local
// ---------------------------------------------------------------------------
// Serveur SÉPARÉ de celui des médias : celui-ci écoute sur le réseau, mais ne
// sert AUCUN fichier — uniquement une petite page de commande et quatre ordres.
// Le serveur de fichiers, lui, reste strictement sur 127.0.0.1.
//
// Il est éteint par défaut : c'est l'utilisateur qui l'allume, et un code à
// 6 chiffres affiché dans l'application est exigé à chaque commande.

const REMOTE_PORT: u16 = 11224;

static REMOTE_SHUTDOWN: OnceLock<Mutex<Option<tokio::sync::oneshot::Sender<()>>>> = OnceLock::new();
static REMOTE_CODE: OnceLock<Mutex<String>> = OnceLock::new();
/// Ce qui est projeté en ce moment, publié par l'interface pour la télécommande.
static REMOTE_STATE: OnceLock<Mutex<String>> = OnceLock::new();

fn remote_shutdown_slot() -> &'static Mutex<Option<tokio::sync::oneshot::Sender<()>>> {
    REMOTE_SHUTDOWN.get_or_init(|| Mutex::new(None))
}

fn remote_code_slot() -> &'static Mutex<String> {
    REMOTE_CODE.get_or_init(|| Mutex::new(String::new()))
}

fn remote_state_slot() -> &'static Mutex<String> {
    REMOTE_STATE.get_or_init(|| Mutex::new("{}".to_string()))
}

/// Publie l'état courant (titre projeté, diapo, direct on/off) pour l'affichage
/// sur le téléphone. Appelé par l'interface à chaque changement.
#[tauri::command]
fn set_remote_state(state: String) -> Result<(), String> {
    if let Ok(mut slot) = remote_state_slot().lock() {
        *slot = state;
    }
    Ok(())
}

/// Code d'appairage à 6 chiffres, tiré de la source aléatoire du système.
fn generate_code() -> String {
    use std::hash::{BuildHasher, Hasher};
    let n = std::collections::hash_map::RandomState::new().build_hasher().finish();
    format!("{:06}", n % 1_000_000)
}

/// Adresses IPv4 locales, pour afficher l'URL à saisir sur le téléphone.
fn local_addresses() -> Vec<String> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(out) = Command::new("hostname").arg("-I").output() {
            return String::from_utf8_lossy(&out.stdout)
                .split_whitespace()
                .filter(|a| a.contains('.') && !a.starts_with("127."))
                .map(|a| a.to_string())
                .collect();
        }
    }
    Vec::new()
}

const REMOTE_PAGE: &str = r##"<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#1a1b1e"><title>MyProjector</title><style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;font-family:system-ui,sans-serif;background:#1a1b1e;color:#eee;
display:flex;flex-direction:column;min-height:100dvh;padding:14px;gap:10px}
h1{font-size:13px;margin:0;text-align:center;color:#8891f2;letter-spacing:.18em}
input{width:100%;padding:13px;font-size:19px;text-align:center;letter-spacing:.3em;
border-radius:10px;border:1px solid #333;background:#232428;color:#fff}
#now{background:#232428;border:1px solid #2f3136;border-radius:10px;padding:10px 12px;min-height:52px}
#dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#666;margin-right:6px}
#dot.on{background:#22c55e}
#t{font-size:14px;font-weight:700;margin:2px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#s{font-size:11px;color:#8a8d93}
button{border:0;border-radius:12px;background:#2b2d31;color:#fff;font-size:15px;
font-weight:700;padding:16px 10px;cursor:pointer;transition:background .1s}
button:active{background:#5865f2}
.nav{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.nav button{font-size:20px;padding:30px 10px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.b{background:#000;border:1px solid #444}.w{background:#e5e5e5;color:#111}
.lab{font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.12em;margin:4px 0 -2px}
#msg{text-align:center;font-size:12px;min-height:16px;color:#888;margin:0}
</style></head><body>
<h1>MYPROJECTOR</h1>
<input id="code" inputmode="numeric" maxlength="6" placeholder="code">
<div id="now"><span id="dot"></span><span id="s">en attente…</span><p id="t">—</p></div>

<div class="nav">
<button onclick="cmd('prev')">&#9650;<br>PRÉCÉDENT</button>
<button onclick="cmd('next')">&#9660;<br>SUIVANT</button>
</div>

<p class="lab">Écran</p>
<div class="g3">
<button class="b" onclick="cmd('black')">Noir</button>
<button class="w" onclick="cmd('white')">Blanc</button>
<button onclick="cmd('normal')">Reprendre</button>
</div>

<p class="lab">Projection</p>
<div class="grid">
<button onclick="cmd('live')">Direct on/off</button>
<button onclick="cmd('base')">Écran d'accueil</button>
<button onclick="cmd('start')">Démarrer l'agenda</button>
<button onclick="cmd('hide')">Masquer le texte</button>
</div>

<p class="lab">Affichage</p>
<div class="grid">
<button onclick="cmd('clock')">Horloge</button>
<button onclick="cmd('ticker')">Bandeau</button>
</div>

<p id="msg"></p>
<script>
var i=document.getElementById('code'),m=document.getElementById('msg');
var t=document.getElementById('t'),st=document.getElementById('s'),dot=document.getElementById('dot');
i.value=localStorage.getItem('c')||'';
i.oninput=function(){localStorage.setItem('c',i.value)};
function cmd(a){
  if(i.value.length!==6){m.textContent="Entrez le code affiché sur l'ordinateur";return}
  fetch('/cmd/'+i.value+'/'+a).then(function(r){
    m.textContent=r.ok?'':'Code refusé';
    if(r.ok&&navigator.vibrate)navigator.vibrate(20);
    setTimeout(poll,250);
  }).catch(function(){m.textContent='Hors de portée'});
}
function poll(){
  if(i.value.length!==6)return;
  fetch('/state/'+i.value).then(function(r){return r.json()}).then(function(d){
    dot.className=d.live?'on':'';
    st.textContent=d.live?(d.base?'Écran d\'accueil':'En direct'):'Projection coupée';
    t.textContent=d.title||'—';
    if(d.slides>1)st.textContent+=' · diapo '+(d.slide+1)+'/'+d.slides;
  }).catch(function(){});
}
poll();setInterval(poll,2000);
</script></body></html>"##;

#[derive(Serialize)]
struct RemoteStatus {
    enabled: bool,
    code: String,
    port: u16,
    urls: Vec<String>,
}

fn current_remote_status(enabled: bool) -> RemoteStatus {
    RemoteStatus {
        enabled,
        code: remote_code_slot().lock().map(|c| c.clone()).unwrap_or_default(),
        port: REMOTE_PORT,
        urls: local_addresses().iter().map(|a| format!("http://{}:{}", a, REMOTE_PORT)).collect(),
    }
}

#[tauri::command]
fn remote_status() -> Result<RemoteStatus, String> {
    let running = remote_shutdown_slot().lock().map(|s| s.is_some()).unwrap_or(false);
    Ok(current_remote_status(running))
}

#[tauri::command]
fn set_remote_enabled(app_handle: tauri::AppHandle, enabled: bool) -> Result<RemoteStatus, String> {
    // Arrêt : on consomme le signal d'extinction.
    if !enabled {
        if let Ok(mut slot) = remote_shutdown_slot().lock() {
            if let Some(tx) = slot.take() {
                let _ = tx.send(());
            }
        }
        return Ok(current_remote_status(false));
    }

    // Déjà démarré ?
    if remote_shutdown_slot().lock().map(|s| s.is_some()).unwrap_or(false) {
        return Ok(current_remote_status(true));
    }

    // Nouveau code à chaque activation : un ancien code ne rouvre jamais l'accès.
    let code = generate_code();
    if let Ok(mut c) = remote_code_slot().lock() {
        *c = code.clone();
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    if let Ok(mut slot) = remote_shutdown_slot().lock() {
        *slot = Some(tx);
    }

    let handle = app_handle.clone();
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(rt) => rt,
            Err(e) => { eprintln!("Télécommande: runtime: {}", e); return; }
        };
        rt.block_on(async move {
            use tauri::Emitter;

            let page = warp::path::end()
                .map(|| warp::reply::html(REMOTE_PAGE));

            let expected = code.clone();
            let cmd = warp::path!("cmd" / String / String)
                .map(move |given: String, action: String| {
                    // Code exigé à chaque commande.
                    if given != expected {
                        return warp::reply::with_status("code refusé", warp::http::StatusCode::FORBIDDEN);
                    }
                    // Liste blanche stricte : rien d'autre ne passe.
                    let allowed = [
                        "next", "prev", "black", "white", "normal", "hide",
                        "live", "base", "start", "clock", "ticker",
                    ];
                    if !allowed.contains(&action.as_str()) {
                        return warp::reply::with_status("action inconnue", warp::http::StatusCode::BAD_REQUEST);
                    }
                    let _ = handle.emit("remote_command", action);
                    warp::reply::with_status("ok", warp::http::StatusCode::OK)
                });

            // État courant : lu par la page du téléphone toutes les 2 s.
            // Protégé par le même code que les commandes.
            let expected_state = code.clone();
            let state = warp::path!("state" / String).map(move |given: String| {
                if given != expected_state {
                    return warp::reply::with_status(
                        String::from("{}"), warp::http::StatusCode::FORBIDDEN,
                    );
                }
                let body = remote_state_slot().lock().map(|s| s.clone()).unwrap_or_else(|_| "{}".into());
                warp::reply::with_status(body, warp::http::StatusCode::OK)
            });

            let routes = page.or(cmd).or(state);
            println!("Télécommande active sur le port {} (code {})", REMOTE_PORT, code);
            // `graceful` reçoit le signal d'extinction envoyé par set_remote_enabled(false).
            warp::serve(routes)
                .bind(([0, 0, 0, 0], REMOTE_PORT))
                .await
                .graceful(async { let _ = rx.await; })
                .run()
                .await;
            println!("Télécommande arrêtée");
        });
    });

    Ok(current_remote_status(true))
}

// ---------------------------------------------------------------------------
// Historique des projections
// ---------------------------------------------------------------------------
// Répond à « qu'est-ce qu'on a chanté le mois dernier ? » et évite de reprendre
// trois fois le même cantique. Stocké dans une base à part : aucun risque pour
// les recueils, et la suppression est immédiate.

fn history_db(app_handle: &tauri::AppHandle) -> Result<Connection, String> {
    let mut path = get_data_root(app_handle)?;
    path.push("data");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    path.push("history.db");

    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS projections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            number TEXT,
            book TEXT
        )",
        [],
    ).map_err(|e| e.to_string())?;
    Ok(conn)
}

#[derive(Serialize)]
struct HistoryRow {
    id: i64,
    ts: i64,
    kind: String,
    title: String,
    number: Option<String>,
    book: Option<String>,
}

#[derive(Serialize)]
struct HistoryTop {
    title: String,
    number: Option<String>,
    count: i64,
    last_ts: i64,
}

/// Enregistre une projection. Le doublon immédiat (même titre projeté à
/// nouveau dans les 30 minutes) n'est pas ré-enregistré : sinon revenir sur un
/// chant pendant le culte fausserait complètement les statistiques.
#[tauri::command]
fn record_projection(
    app_handle: tauri::AppHandle,
    kind: String,
    title: String,
    number: Option<String>,
    book: Option<String>,
) -> Result<(), String> {
    if title.trim().is_empty() {
        return Ok(());
    }
    let conn = history_db(&app_handle)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64).unwrap_or(0);

    let recent: i64 = conn.query_row(
        "SELECT COUNT(*) FROM projections WHERE title = ?1 AND ts > ?2",
        rusqlite::params![&title, now - 1800],
        |r| r.get(0),
    ).unwrap_or(0);
    if recent > 0 {
        return Ok(());
    }

    conn.execute(
        "INSERT INTO projections (ts, kind, title, number, book) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![now, kind, title, number, book],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn history_recent(app_handle: tauri::AppHandle, limit: Option<i64>) -> Result<Vec<HistoryRow>, String> {
    let conn = history_db(&app_handle)?;
    let mut stmt = conn.prepare(
        "SELECT id, ts, kind, title, number, book FROM projections ORDER BY ts DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([limit.unwrap_or(100)], |r| {
        Ok(HistoryRow {
            id: r.get(0)?, ts: r.get(1)?, kind: r.get(2)?,
            title: r.get(3)?, number: r.get(4)?, book: r.get(5)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Chants les plus projetés depuis `since_days` jours.
#[tauri::command]
fn history_top(app_handle: tauri::AppHandle, since_days: Option<i64>, limit: Option<i64>) -> Result<Vec<HistoryTop>, String> {
    let conn = history_db(&app_handle)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64).unwrap_or(0);
    let since = now - since_days.unwrap_or(365) * 86400;

    let mut stmt = conn.prepare(
        "SELECT title, number, COUNT(*) as n, MAX(ts) FROM projections
         WHERE ts >= ?1 AND kind IN ('hymnes', 'agenda')
         GROUP BY title ORDER BY n DESC, MAX(ts) DESC LIMIT ?2"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![since, limit.unwrap_or(20)], |r| {
        Ok(HistoryTop { title: r.get(0)?, number: r.get(1)?, count: r.get(2)?, last_ts: r.get(3)? })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn history_clear(app_handle: tauri::AppHandle) -> Result<(), String> {
    let conn = history_db(&app_handle)?;
    conn.execute("DELETE FROM projections", []).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Diagnostic de l'environnement
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct Check {
    id: String,
    label: String,
    /// "ok" | "warn" | "error"
    level: String,
    detail: String,
    /// Commande à copier pour corriger, quand il y en a une.
    fix: Option<String>,
}

fn check(id: &str, label: &str, level: &str, detail: String, fix: Option<String>) -> Check {
    Check { id: id.into(), label: label.into(), level: level.into(), detail, fix }
}

/// Un décodeur GStreamer est-il disponible ? C'est la cause n°1 des vidéos
/// muettes/figées sur une machine fraîchement installée.
#[cfg(target_os = "linux")]
fn check_gstreamer() -> Check {
    let inspect = Command::new("gst-inspect-1.0").arg("avdec_h264").output();
    match inspect {
        Ok(out) if out.status.success() => check(
            "codecs", "Décodeurs vidéo (H.264)", "ok",
            "Le décodeur avdec_h264 est disponible.".into(), None,
        ),
        Ok(_) => check(
            "codecs", "Décodeurs vidéo (H.264)", "error",
            "avdec_h264 est introuvable : les vidéos MP4 ne se liront pas.".into(),
            Some("sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-good gstreamer1.0-plugins-bad".into()),
        ),
        Err(_) => check(
            "codecs", "Décodeurs vidéo (H.264)", "warn",
            "gst-inspect-1.0 est absent : impossible de vérifier les codecs.".into(),
            Some("sudo apt install gstreamer1.0-tools gstreamer1.0-libav".into()),
        ),
    }
}

#[cfg(not(target_os = "linux"))]
fn check_gstreamer() -> Check {
    check("codecs", "Décodeurs vidéo", "ok", "Fournis par le système.".into(), None)
}

#[tauri::command]
fn run_diagnostics(app_handle: tauri::AppHandle) -> Result<Vec<Check>, String> {
    let mut checks = Vec::new();

    checks.push(check_gstreamer());

    // Serveur média local : on tente une vraie connexion TCP.
    let server = std::net::TcpStream::connect_timeout(
        &"127.0.0.1:11223".parse().map_err(|e| format!("{}", e))?,
        std::time::Duration::from_millis(600),
    );
    checks.push(match server {
        Ok(_) => check("server", "Serveur média local", "ok",
            "Actif sur 127.0.0.1:11223.".into(), None),
        Err(e) => check("server", "Serveur média local", "error",
            format!("Injoignable ({}). Fonds, médias et PDF ne s'afficheront pas.", e),
            Some("Redémarrer l'application".into())),
    });

    // ffmpeg : optionnel, sert à alléger les médias trop lourds.
    checks.push(match ffmpeg_path() {
        Some(p) => check("ffmpeg", "Optimisation des médias (ffmpeg)", "ok",
            format!("Trouvé : {}", p.to_string_lossy()), None),
        None => check("ffmpeg", "Optimisation des médias (ffmpeg)", "warn",
            "Absent : les vidéos lourdes ne seront pas compressées automatiquement.".into(),
            Some("sudo apt install ffmpeg".into())),
    });

    // Écrans : sans second écran, la projection s'ouvre sur le même moniteur.
    let monitors = app_handle
        .webview_windows()
        .values()
        .next()
        .and_then(|w| w.available_monitors().ok())
        .map(|m| m.len())
        .unwrap_or(0);
    checks.push(if monitors >= 2 {
        check("screens", "Écrans détectés", "ok", format!("{} écrans disponibles.", monitors), None)
    } else {
        check("screens", "Écrans détectés", "warn",
            format!("{} écran détecté : la projection s'ouvrira sur le même écran que le contrôleur.", monitors),
            None)
    });

    // Contenus installés : une application sans recueil ni bible ne sert à rien.
    let root = get_data_root(&app_handle)?;
    let (_, hymn_files) = dir_stats(&root.join("data").join("hymnes"));
    let (_, bible_files) = dir_stats(&root.join("data").join("bible"));
    checks.push(if hymn_files > 0 || bible_files > 0 {
        check("content", "Contenus installés", "ok",
            format!("{} recueil(s) et {} bible(s).", hymn_files, bible_files), None)
    } else {
        check("content", "Contenus installés", "warn",
            "Aucun recueil ni bible installé.".into(),
            Some("Bibliothèque → Recueils / Bibles".into()))
    });

    // Espace disque du volume contenant les données.
    #[cfg(unix)]
    {
        if let Ok(out) = Command::new("df").arg("-h").arg("--output=avail").arg(&root).output() {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(avail) = text.lines().nth(1) {
                checks.push(check("disk", "Espace disque disponible", "ok",
                    format!("{} libres sur le volume des données.", avail.trim()), None));
            }
        }
    }

    Ok(checks)
}

/// Liste les médias importés dans l'agenda, du plus lourd au plus léger.
///
/// Ces fichiers ne sont volontairement pas supprimés automatiquement : un même
/// média peut servir dans un agenda enregistré qui n'est pas ouvert. C'est donc
/// à l'utilisateur de décider, en voyant les noms et les tailles.
#[tauri::command]
fn list_media_files(app_handle: tauri::AppHandle) -> Result<Vec<LibraryFile>, String> {
    let dir = get_data_root(&app_handle)?.join("media");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        files.push(LibraryFile {
            filename,
            path: path.to_string_lossy().to_string(),
            size: file_size(&path),
        });
    }
    files.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(files)
}

/// Vide le cache des écoutes en ligne. Aucun contenu téléchargé n'est touché.
#[tauri::command]
fn clear_audio_cache(app_handle: tauri::AppHandle) -> Result<u64, String> {
    let dir = get_data_root(&app_handle)?
        .join("data").join("audio").join(AUDIO_CACHE_DIR);
    if !dir.exists() {
        return Ok(0);
    }
    let (bytes, _) = dir_stats(&dir);
    fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(bytes)
}

/// Supprime les téléchargements interrompus (.part) restés sur le disque.
#[tauri::command]
fn clean_partial_downloads(app_handle: tauri::AppHandle) -> Result<u64, String> {
    let root = get_data_root(&app_handle)?;
    let mut partials = Vec::new();
    find_partials(&root, &mut partials);
    let mut freed = 0;
    for p in partials {
        freed += file_size(&p);
        let _ = fs::remove_file(&p);
    }
    Ok(freed)
}

// ---------------------------------------------------------------------------
// Téléchargement groupé (recueils audio, catégories de documents)
// ---------------------------------------------------------------------------
// Un recueil compte jusqu'à 700 pistes, une catégorie de documents plusieurs
// dizaines de PDF : les prendre un par un n'est pas tenable. On enchaîne donc
// les téléchargements côté Rust, en séquence (pour ne pas se faire limiter par
// les hébergeurs), en sautant ce qui est déjà là, et SANS s'arrêter à la
// première erreur — un fichier manquant ne doit pas ruiner le lot entier.

static BATCH_CANCEL: OnceLock<std::sync::atomic::AtomicBool> = OnceLock::new();

fn batch_cancel_flag() -> &'static std::sync::atomic::AtomicBool {
    BATCH_CANCEL.get_or_init(|| std::sync::atomic::AtomicBool::new(false))
}

#[derive(Deserialize)]
struct BatchItem {
    url: String,
    filename: String,
}

#[derive(Clone, Serialize)]
struct BatchProgress {
    done: usize,
    total: usize,
    skipped: usize,
    failed: usize,
    bytes: u64,
    current: String,
}

#[derive(Serialize)]
struct BatchSummary {
    downloaded: usize,
    skipped: usize,
    failed: usize,
    bytes: u64,
    cancelled: bool,
}

/// Interrompt le lot en cours. Le fichier en cours de transfert est terminé,
/// puis la boucle s'arrête proprement.
#[tauri::command]
fn cancel_batch_download() -> Result<(), String> {
    batch_cancel_flag().store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn download_batch(
    app_handle: tauri::AppHandle,
    kind: String,
    collection: Option<String>,
    items: Vec<BatchItem>,
) -> Result<BatchSummary, String> {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;

    batch_cancel_flag().store(false, Ordering::Relaxed);

    let dir = library_collection_dir(&app_handle, &kind, &collection)?;
    let client = reqwest::Client::builder()
        .user_agent("MyProjector/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let total = items.len();
    let mut downloaded = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;
    let mut bytes = 0u64;

    for (index, item) in items.iter().enumerate() {
        if batch_cancel_flag().load(Ordering::Relaxed) {
            return Ok(BatchSummary { downloaded, skipped, failed, bytes, cancelled: true });
        }

        if safe_component(&item.filename).is_err() {
            failed += 1;
            continue;
        }
        let dest = dir.join(&item.filename);
        if dest.exists() {
            skipped += 1;
        } else {
            match fetch_to_file(&client, &kind, &item.url, &dir, &item.filename).await {
                Ok(n) => { downloaded += 1; bytes += n; }
                Err(e) => {
                    failed += 1;
                    eprintln!("Lot {}: {} a échoué: {}", kind, item.filename, e);
                }
            }
        }

        let _ = app_handle.emit("batch_download_progress", BatchProgress {
            done: index + 1, total, skipped, failed, bytes,
            current: item.filename.clone(),
        });
    }

    Ok(BatchSummary { downloaded, skipped, failed, bytes, cancelled: false })
}

/// Télécharge une URL vers <dir>/<filename>, via un .part renommé à la fin.
async fn fetch_to_file(
    client: &reqwest::Client,
    kind: &str,
    url: &str,
    dir: &Path,
    filename: &str,
) -> Result<u64, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("URL invalide: {}", e))?;
    let host = parsed.host_str().unwrap_or("");
    if !host_allowed(kind, host) {
        return Err(format!("Hôte non autorisé: {}", host));
    }

    let mut response = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let tmp = dir.join(format!("{}.part", filename));
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut written = 0u64;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        written += chunk.len() as u64;
    }
    drop(file);
    fs::rename(&tmp, dir.join(filename)).map_err(|e| e.to_string())?;
    Ok(written)
}

#[derive(Serialize)]
struct LibraryFile {
    filename: String,
    path: String,
    size: u64,
}

#[tauri::command]
fn list_library_files(
    app_handle: tauri::AppHandle,
    kind: String,
    collection: Option<String>,
) -> Result<Vec<LibraryFile>, String> {
    let dir = library_collection_dir(&app_handle, &kind, &collection)?;
    let mut files = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Les .part sont des téléchargements inachevés : ils ne comptent pas.
        if filename.ends_with(".part") { continue; }
        files.push(LibraryFile {
            filename,
            path: path.to_string_lossy().to_string(),
            size: file_size(&path),
        });
    }
    Ok(files)
}

#[tauri::command]
fn delete_library_file(
    app_handle: tauri::AppHandle,
    kind: String,
    filename: String,
    collection: Option<String>,
) -> Result<(), String> {
    safe_component(&filename)?;
    let path = library_collection_dir(&app_handle, &kind, &collection)?.join(&filename);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Lit un fichier JSON déjà téléchargé (Mofon'aina). Passe par Rust plutôt que
/// par fetch() pour ne dépendre ni du serveur warp ni de la CSP.
#[tauri::command]
fn read_library_json(app_handle: tauri::AppHandle, kind: String, filename: String) -> Result<String, String> {
    safe_component(&filename)?;
    let path = library_dir(&app_handle, &kind)?.join(&filename);
    fs::read_to_string(&path).map_err(|e| format!("Lecture de {}: {}", filename, e))
}

/// Liste les trimestres Mofon'aina disponibles sur GitHub.
/// Appelé depuis Rust car l'API GitHub n'est pas autorisée par la CSP du webview.
#[tauri::command]
async fn list_remote_mofonaina() -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .user_agent("MyProjector/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get("https://api.github.com/repos/Brayan-Clark/adventools/contents/mofonaina?ref=data")
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("GitHub a répondu {}", resp.status()));
    }
    let items: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    if let Some(arr) = items.as_array() {
        for it in arr {
            if let Some(name) = it.get("name").and_then(|n| n.as_str()) {
                if name.ends_with(".json") {
                    names.push(name.to_string());
                }
            }
        }
    }
    names.sort();
    names.reverse(); // le trimestre le plus récent en premier
    Ok(names)
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

// Sous Linux (WebKitGTK) la lecture automatique dépend des réglages du webview.
// Selon la version de webkit2gtk installée sur la machine,
// `media-playback-requires-user-gesture` peut être à TRUE : la vidéo de fond
// n'est alors jamais lancée et WebKit affiche un gros bouton "play" au milieu.
// On force donc explicitement les réglages média à chaque webview créé.
#[cfg(target_os = "linux")]
fn apply_media_settings(webkit_webview: &webkit2gtk::WebView) {
    use webkit2gtk::{SettingsExt, WebViewExt};
    if let Some(settings) = WebViewExt::settings(webkit_webview) {
        // Autoplay : aucune interaction requise (c'est un fond, il doit tourner seul)
        settings.set_media_playback_requires_user_gesture(false);
        settings.set_media_playback_allows_inline(true);
        settings.set_enable_media_stream(true);
        settings.set_enable_webaudio(true);
        settings.set_enable_webgl(true);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        // Toutes ces variables sont posées UNIQUEMENT si l'utilisateur ne les a
        // pas déjà définies : on peut donc diagnostiquer/annuler chaque réglage
        // depuis le terminal sans recompiler (ex: WEBKIT_DISABLE_DMABUF_RENDERER=0).
        fn set_env_default(key: &str, value: &str) {
            if std::env::var_os(key).is_none() {
                std::env::set_var(key, value);
            }
        }

        // Fix for AppImage -- disable GPU compositing to prevent green screen artifacts
        // NOTE: We intentionally do NOT disable HW_ACCELERATION as that breaks video playback
        set_env_default("WEBKIT_DISABLE_COMPOSITING_MODE", "1");

        // FENETRE NOIRE / VIDE au lancement (surtout en AppImage) :
        // depuis WebKitGTK 2.42, le rendu passe par un "DMA-BUF renderer" qui
        // échoue silencieusement sur beaucoup de configs (pilotes NVIDIA
        // propriétaires, Mesa ancien, machines virtuelles, Wayland+Xwayland).
        // Le processus se lance normalement mais ne peint jamais rien.
        // On repasse sur le chemin de rendu classique, qui marche partout.
        set_env_default("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        
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
                        apply_media_settings(&webkit_webview);
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
                    // JAMAIS pendant une projection : une compression H.264 sature
                    // le CPU et fige le passage à la diapo suivante. On attend que
                    // la fenêtre "live" soit refermée.
                    while handle.get_webview_window("live").is_some() {
                        std::thread::sleep(std::time::Duration::from_secs(30));
                    }
                    let root = match handle.path().app_data_dir() {
                        Ok(p) => p,
                        Err(e) => {
                            eprintln!("Optimisation des médias: app_data_dir: {}", e);
                            return;
                        }
                    };
                    let mut report = OptimizeReport { scanned: 0, compressed: 0, skipped: 0, errors: 0, messages: Vec::new() };
                    let presenting = || handle.get_webview_window("live").is_some();
                    scan_folder(&root.join("backgrounds"), &mut report, &presenting);
                    scan_folder(&root.join("media"), &mut report, &presenting);
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
                        // La fenêtre de projection est créée après le setup :
                        // on ré-applique les réglages média ici aussi.
                        apply_media_settings(&webkit_webview);

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
            read_playlist_file,
            download_library_file,
            download_batch,
            cancel_batch_download,
            list_library_files,
            delete_library_file,
            read_library_json,
            list_remote_mofonaina,
            storage_report,
            list_media_files,
            run_diagnostics,
            record_projection,
            history_recent,
            history_top,
            history_clear,
            remote_status,
            set_remote_enabled,
            set_remote_state,
            clear_audio_cache,
            clean_partial_downloads
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
