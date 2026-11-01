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
use warp::http;
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
    /// Nature de l'élément : "hymnes" ou "bible".
    ///
    /// ⚠ Renseigné ICI, à la source, et pas côté interface. Il ne l'était
    /// nulle part : `type` n'existait que sur les éléments d'agenda, alors
    /// qu'une dizaine d'endroits testaient `type === 'bible'`. Tous
    /// concluaient « ce n'est pas la Bible » — d'où un chapitre enregistré
    /// vers `data/hymnes/<Livre>.db`, et des réglages de chapitre rangés
    /// dans la catégorie des chants.
    #[serde(rename = "type", default)]
    pub song_type: String,
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
    /// Numéro de livre au format MyBible (Genèse = 10, Exode = 20 … ).
    /// C'est la SEULE clé commune entre deux versions : les noms de livres
    /// changent d'une langue à l'autre (« Jaona » / « Jean » / « John »), et
    /// le rang `book_index` se décale dès qu'un module contient les
    /// deutérocanoniques. Indispensable à l'affichage multilingue.
    #[serde(default)]
    pub book_no: Option<i32>,
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
                song_type: "hymnes".to_string(),
                number: num.to_string(),
                title: row.get(2)?,
                lyrics: row.get(3)?,
                book: db_name.replace(".db", ""), // default book from db name
                playback: playback.filter(|p| !p.trim().is_empty()),
                abbr: None,
                book_index: None,
                book_no: None,
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
        SELECT b.long_name, v.chapter, v.verse, v.text, b.short_name, v.book_number
        FROM verses v
        JOIN books b ON v.book_number = b.book_number
        ORDER BY v.book_number, v.chapter, v.verse
    ",
        )
        .map_err(|e| e.to_string())?;

    let mut current_book = String::new();
    let mut current_abbr: Option<String> = None;
    let mut current_book_no: Option<i32> = None;
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
        let book_no: i32 = row.get(5).map_err(|e| e.to_string())?;

        let title = format!("{} {}", book_name, chapter);
        if current_title != title {
            if !current_title.is_empty() {
                songs.push(Song {
                    id: current_id as i64,
                    song_type: "bible".to_string(),
                    number: current_chapter.to_string(),
                    title: current_title.clone(),
                    lyrics: current_content.clone(),
                    book: current_book.clone(),
                    playback: None, // pas d'audio associé pour la Bible
                    abbr: current_abbr.clone(),
                    book_index: Some(current_index),
                    book_no: current_book_no,
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
            current_book_no = Some(book_no);
            current_chapter = chapter;
            current_content = format!("{}\n{}", verse, text);
        } else {
            current_content.push_str(&format!("\n\n{}\n{}", verse, text));
        }
    }
    if !current_title.is_empty() {
        songs.push(Song {
            id: current_id as i64,
            song_type: "bible".to_string(),
            number: current_chapter.to_string(),
            title: current_title,
            lyrics: current_content,
            book: current_book,
            playback: None,
            abbr: current_abbr,
            book_index: Some(current_index),
            book_no: current_book_no,
            version: Some(db_name.to_string()),
        });
    }

    Ok(songs)
}

// ---------------------------------------------------------------------------
// Recherche plein texte dans la Bible
//
// La barre de recherche ne savait résoudre qu'une RÉFÉRENCE ("Jean 3:16").
// Retrouver un verset dont on ne se rappelle que quelques mots — le cas le
// plus courant en préparation — obligeait à le chercher ailleurs.
//
// Pourquoi côté Rust et non en JavaScript : le texte complet est déjà chargé
// dans l'interface, mais normaliser 31 000 versets à chaque frappe gèle le
// webview. Ici c'est un balayage SQLite sur un thread bloquant, invisible.
//
// Pourquoi pas la recherche plein texte de SQLite (FTS5) : les fichiers
// MyBible n'ont pas de table FTS, et en créer une modifierait des bases que
// l'utilisateur peut avoir téléchargées ou sauvegardées.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct BibleHit {
    pub book: String,
    pub abbr: Option<String>,
    pub chapter: i32,
    pub verse: i32,
    /// Texte débarrassé de son balisage, tel qu'il sera affiché.
    pub text: String,
}

/// Minuscules et accents retirés, pour que « Jéhovah » se trouve en tapant
/// « jehovah ». `to_lowercase` ne suffit pas : il conserve les diacritiques.
fn fold(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars().flat_map(|c| c.to_lowercase()) {
        match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => out.push('a'),
            'æ' => out.push_str("ae"),
            'ç' | 'ć' | 'č' => out.push('c'),
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' => out.push('e'),
            'ì' | 'í' | 'î' | 'ï' | 'ī' => out.push('i'),
            'ñ' | 'ń' => out.push('n'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' => out.push('o'),
            'œ' => out.push_str("oe"),
            'š' | 'ś' => out.push('s'),
            'ù' | 'ú' | 'û' | 'ü' | 'ū' => out.push('u'),
            'ý' | 'ÿ' => out.push('y'),
            'ž' | 'ź' => out.push('z'),
            // Apostrophes typographiques : « Andriamanitra'ny » doit se
            // trouver avec l'apostrophe droite du clavier.
            '\u{2018}' | '\u{2019}' | '\u{02bc}' => out.push('\''),
            _ => out.push(c),
        }
    }
    out
}

/// Retire le balisage des bases MyBible (`<S>` Strong, `<pb/>`, `<f>` notes…).
/// Sans ça, un verset affiché dans les résultats montrait ses numéros Strong.
fn strip_markup(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut depth = 0usize;
    for c in input.chars() {
        match c {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    // Les balises laissent des espaces en double une fois supprimées.
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Les termes que le verset doit contenir, déjà normalisés.
/// Entre guillemets, la saisie est traitée comme une seule expression exacte.
fn search_terms(query: &str) -> Vec<String> {
    let folded = fold(query.trim());
    let quoted = folded.len() >= 2 && folded.starts_with('"') && folded.ends_with('"');
    if quoted {
        let phrase = folded.trim_matches('"').trim().to_string();
        return if phrase.is_empty() { vec![] } else { vec![phrase] };
    }
    folded
        .split_whitespace()
        .filter(|w| !w.is_empty())
        .map(|w| w.to_string())
        .collect()
}

#[tauri::command]
async fn search_bible(
    app_handle: tauri::AppHandle,
    db_name: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<BibleHit>, String> {
    safe_component(&db_name)?;
    tauri::async_runtime::spawn_blocking(move || {
        search_bible_blocking(&app_handle, &db_name, &query, limit.unwrap_or(300))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn search_bible_blocking(
    app_handle: &tauri::AppHandle,
    db_name: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<BibleHit>, String> {
    let terms = search_terms(query);
    // Un seul caractère renverrait la Bible entière : ce n'est pas une
    // recherche, et construire la réponse coûterait plus que de ne rien faire.
    if terms.is_empty() || terms.iter().all(|t| t.chars().count() < 2) {
        return Ok(Vec::new());
    }

    let mut db_path = get_data_root(app_handle)?;
    db_path.push("data");
    db_path.push("bible");
    db_path.push(db_name);

    if !db_path.exists() {
        return Err(format!("Database not found at {:?}", db_path));
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "
        SELECT b.long_name, b.short_name, v.chapter, v.verse, v.text
        FROM verses v
        JOIN books b ON v.book_number = b.book_number
        ORDER BY v.book_number, v.chapter, v.verse
    ",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let mut hits = Vec::new();

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let raw: String = row.get(4).map_err(|e| e.to_string())?;
        let text = strip_markup(&raw);
        let folded = fold(&text);
        if !terms.iter().all(|t| folded.contains(t.as_str())) {
            continue;
        }
        hits.push(BibleHit {
            book: row.get(0).map_err(|e| e.to_string())?,
            abbr: row.get(1).unwrap_or(None),
            chapter: row.get(2).map_err(|e| e.to_string())?,
            verse: row.get(3).map_err(|e| e.to_string())?,
            text,
        });
        // On s'arrête net : au-delà, la liste n'est plus lisible et le
        // balayage complet d'un mot très courant coûterait pour rien.
        if hits.len() >= limit {
            break;
        }
    }

    Ok(hits)
}

// ---------------------------------------------------------------------------
// Affichage multilingue : le même passage dans plusieurs versions
//
// Pour une assemblée mélangée, projeter le verset en malgache ET en français
// évite d'avoir à choisir. Les versions sont alignées sur `book_number`, la
// numérotation MyBible : c'est la seule clé commune, puisque les noms de
// livres changent d'une langue à l'autre.
//
// On ne recharge PAS la version entière pour afficher un verset : charger une
// bible complète prend plusieurs centaines de millisecondes, ce qui se verrait
// à chaque changement de diapo.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct ParallelVerse {
    /// Fichier de la version, tel que passé en entrée (ex: "Louis_Segond.SQLite3").
    pub version: String,
    /// Nom du livre DANS CETTE VERSION (« Jean » là où le malgache dit « Jaona »).
    pub book: String,
    pub chapter: i32,
    pub verse: i32,
    pub text: String,
}

#[tauri::command]
async fn fetch_parallel_verse(
    app_handle: tauri::AppHandle,
    db_names: Vec<String>,
    book_no: i32,
    chapter: i32,
    verse: i32,
) -> Result<Vec<ParallelVerse>, String> {
    for name in &db_names {
        safe_component(name)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        for db_name in &db_names {
            // Une version absente ou abîmée ne doit pas faire disparaître les
            // autres : on la saute en silence, la projection continue.
            match parallel_verse_blocking(&app_handle, db_name, book_no, chapter, verse) {
                Ok(Some(v)) => out.push(v),
                Ok(None) => {}
                Err(e) => eprintln!("fetch_parallel_verse({db_name}): {e}"),
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn parallel_verse_blocking(
    app_handle: &tauri::AppHandle,
    db_name: &str,
    book_no: i32,
    chapter: i32,
    verse: i32,
) -> Result<Option<ParallelVerse>, String> {
    let mut db_path = get_data_root(app_handle)?;
    db_path.push("data");
    db_path.push("bible");
    db_path.push(db_name);
    if !db_path.exists() {
        return Ok(None);
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "
        SELECT b.long_name, v.text
        FROM verses v
        JOIN books b ON v.book_number = b.book_number
        WHERE v.book_number = ?1 AND v.chapter = ?2 AND v.verse = ?3
        LIMIT 1
    ",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query(rusqlite::params![book_no, chapter, verse])
        .map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let book: String = row.get(0).map_err(|e| e.to_string())?;
        let raw: String = row.get(1).map_err(|e| e.to_string())?;
        return Ok(Some(ParallelVerse {
            version: db_name.to_string(),
            book,
            chapter,
            verse,
            // Même nettoyage que la recherche : sans lui, les numéros Strong
            // des modules annotés s'afficheraient en projection.
            text: strip_markup(&raw),
        }));
    }
    Ok(None)
}

// ---------------------------------------------------------------------------
// Un lien web peut-il être affiché DANS l'application ?
//
// La plupart des grands sites l'interdisent (`X-Frame-Options: SAMEORIGIN` ou
// `Content-Security-Policy: frame-ancestors`). Mesuré : Google, GitHub et
// jw.org refusent ; Wikipédia accepte. Sans vérification, l'opérateur ajoute
// un lien, le projette pendant le culte, et l'assemblée voit une page blanche.
//
// On le dit donc AU MOMENT DE L'AJOUT, quand c'est encore réparable.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct EmbedCheck {
    /// Le site accepte d'être affiché dans un cadre.
    pub embeddable: bool,
    /// Le site a répondu (faux = hors ligne, adresse morte, délai dépassé).
    pub reachable: bool,
    /// Explication en clair, destinée à être affichée telle quelle.
    pub reason: String,
}

#[tauri::command]
async fn check_embeddable(url: String) -> Result<EmbedCheck, String> {
    let client = reqwest::Client::builder()
        // Court : on bloque l'opérateur pendant ce temps, et un site lent à
        // répondre sera de toute façon pénible en projection.
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    // GET et non HEAD : beaucoup de serveurs répondent 405 à un HEAD, ou
    // n'y renvoient pas les entêtes de sécurité.
    let response = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(EmbedCheck {
                embeddable: false,
                reachable: false,
                reason: if e.is_timeout() {
                    "Le site n'a pas répondu dans les délais.".into()
                } else {
                    "Site injoignable (pas de connexion, ou adresse incorrecte).".into()
                },
            })
        }
    };

    let headers = response.headers();
    let xfo = headers
        .get("x-frame-options")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let csp = headers
        .get("content-security-policy")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let frame_ancestors = csp
        .split(';')
        .map(|d| d.trim())
        .find(|d| d.starts_with("frame-ancestors"));

    // `frame-ancestors` fait autorité sur X-Frame-Options quand les deux sont
    // présents. On n'accepte que 'self' absent ET une liste permissive.
    let blocked_by_csp = match frame_ancestors {
        Some(d) => !(d.contains('*') || d.contains("https:")),
        None => false,
    };
    let blocked_by_xfo = xfo.contains("deny") || xfo.contains("sameorigin");

    if blocked_by_csp || blocked_by_xfo {
        return Ok(EmbedCheck {
            embeddable: false,
            reachable: true,
            reason: "Ce site interdit d'être affiché dans une autre application. \
                     Il apparaîtra vide en projection."
                .into(),
        });
    }

    Ok(EmbedCheck {
        embeddable: true,
        reachable: true,
        reason: format!("Site joignable ({}), affichage autorisé.", response.status().as_u16()),
    })
}

// ---------------------------------------------------------------------------
// Documents bureautiques (.docx, .pptx, .odp…) — via la suite INSTALLÉE
//
// L'application sait afficher du PDF, du texte et des images, mais pas un
// traitement de texte ni une présentation. Plutôt que d'embarquer un moteur de
// rendu (des dizaines de méga-octets, et un rendu toujours approximatif), on
// se sert de la suite bureautique déjà installée sur le poste pour convertir
// en PDF — puis on réutilise l'affichage PDF existant, avec sa navigation de
// pages et sa projection.
//
// Conséquences assumées :
//   • Le rendu est celui de LibreOffice, donc fidèle au fichier d'origine.
//   • Les animations d'un .pptx sont perdues : il reste les diapos. Ce n'est
//     pas une régression, l'application ne les affichait pas du tout avant —
//     et elle a ses propres transitions.
//   • Rien n'est imposé : sans suite installée, tout le reste fonctionne et
//     l'application le dit clairement au lieu d'échouer en silence.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct OfficeStatus {
    pub available: bool,
    /// Chemin du binaire trouvé, pour le Check système.
    pub path: String,
    pub version: String,
}

/// Binaire de la suite bureautique, s'il y en a une.
fn office_binary() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    let candidates: Vec<std::path::PathBuf> = vec![
        r"C:\Program Files\LibreOffice\program\soffice.exe".into(),
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe".into(),
    ];
    #[cfg(target_os = "macos")]
    let candidates: Vec<std::path::PathBuf> =
        vec!["/Applications/LibreOffice.app/Contents/MacOS/soffice".into()];
    #[cfg(target_os = "linux")]
    let candidates: Vec<std::path::PathBuf> = vec![
        "/usr/bin/soffice".into(),
        "/usr/bin/libreoffice".into(),
        "/usr/local/bin/soffice".into(),
        "/snap/bin/libreoffice".into(),
        "/var/lib/flatpak/exports/bin/org.libreoffice.LibreOffice".into(),
    ];

    for c in candidates {
        if c.exists() {
            return Some(c);
        }
    }
    // Dernier recours : le PATH.
    for name in ["soffice", "libreoffice"] {
        if let Ok(out) = Command::new("which").arg(name).output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() {
                    return Some(p.into());
                }
            }
        }
    }
    None
}

#[tauri::command]
fn office_status() -> OfficeStatus {
    match office_binary() {
        Some(path) => {
            let version = Command::new(&path)
                .arg("--version")
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();
            OfficeStatus { available: true, path: path.to_string_lossy().into(), version }
        }
        None => OfficeStatus {
            available: false,
            path: String::new(),
            version: String::new(),
        },
    }
}

/// Convertit un document en PDF et renvoie le chemin du PDF produit.
///
/// Le résultat est mis en cache : une conversion prend plusieurs secondes
/// (mesuré : 4,7 s pour 13 diapos), ce qui est inacceptable en plein culte.
/// On convertit donc à l'import, une seule fois.
#[tauri::command]
async fn convert_office_to_pdf(
    app_handle: tauri::AppHandle,
    source_path: String,
) -> Result<String, String> {
    let binary = office_binary()
        .ok_or_else(|| "Aucune suite bureautique installée.".to_string())?;

    let source = std::path::PathBuf::from(&source_path);
    let meta = fs::metadata(&source).map_err(|e| format!("Fichier illisible : {e}"))?;
    let stamp = format!(
        "{}-{}",
        meta.len(),
        meta.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0)
    );
    let stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".into());
    let safe_stem: String = stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();

    let mut out_dir = get_data_root(&app_handle)?;
    out_dir.push("media");
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let final_pdf = out_dir.join(format!("{safe_stem}-{stamp}.pdf"));

    // Déjà converti et inchangé depuis : on ressort le cache.
    if final_pdf.exists() {
        return Ok(final_pdf.to_string_lossy().to_string());
    }

    let mut profile_dir = get_data_root(&app_handle)?;
    profile_dir.push("cache");
    profile_dir.push("office-profile");
    fs::create_dir_all(&profile_dir).map_err(|e| e.to_string())?;

    let work_dir = out_dir.clone();
    let source_for_task = source.clone();
    let final_for_task = final_pdf.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let status = Command::new(&binary)
            // ⚠ Profil DÉDIÉ. Sans lui, si l'utilisateur a déjà LibreOffice
            // ouvert, la commande headless rejoint l'instance en cours et la
            // conversion échoue sans produire de fichier — panne que l'on ne
            // reproduit jamais sur un poste de développement.
            .arg(format!(
                "-env:UserInstallation=file://{}",
                profile_dir.to_string_lossy()
            ))
            .args(["--headless", "--norestore", "--convert-to", "pdf", "--outdir"])
            .arg(&work_dir)
            .arg(&source_for_task)
            .output()
            .map_err(|e| format!("Conversion impossible : {e}"))?;

        // LibreOffice nomme le résultat d'après le fichier source : on le
        // renomme pour y inclure l'empreinte qui sert de cache.
        let produced = work_dir.join(format!(
            "{}.pdf",
            source_for_task
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default()
        ));

        if !produced.exists() {
            return Err(format!(
                "La conversion n'a rien produit. {}",
                String::from_utf8_lossy(&status.stderr).trim()
            ));
        }
        fs::rename(&produced, &final_for_task).map_err(|e| e.to_string())?;
        Ok(final_for_task.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Vidéos intégrées à un .pptx
//
// La conversion en PDF donne la mise en page fidèle, mais le PDF est figé :
// une vidéo intégrée y devient une image morte. Or un .pptx est une archive
// ZIP : les médias sont dans `ppt/media/`, et `ppt/slides/_rels/slideN.xml.rels`
// dit quelle diapo référence quel fichier.
//
// On extrait donc les vidéos et on les relie à leur numéro de diapo — qui est
// aussi le numéro de page du PDF. L'opérateur peut alors lancer la vidéo de la
// diapo affichée.
//
// Limite assumée : les ANIMATIONS et transitions internes au PowerPoint restent
// perdues. On récupère la vidéo, pas le diaporama.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct SlideVideo {
    /// Numéro de diapo, donc de page dans le PDF converti (1 = première).
    pub slide: u32,
    /// Chemin du fichier extrait, servi ensuite par le serveur média.
    pub path: String,
    pub name: String,
}

#[tauri::command]
async fn extract_pptx_videos(
    app_handle: tauri::AppHandle,
    source_path: String,
) -> Result<Vec<SlideVideo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = fs::File::open(&source_path).map_err(|e| format!("Lecture impossible : {e}"))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Ce fichier n'est pas un .pptx : {e}"))?;

        // 1) Quelle diapo référence quel média ? On lit les fichiers de
        //    relations, un par diapo.
        let mut wanted: Vec<(u32, String)> = Vec::new();
        // `file_names()` renvoie des Result dans cette version du crate.
        let rels: Vec<String> = archive
            .file_names()
            .filter_map(|n| n.ok())
            .map(|n| n.to_string())
            .filter(|n| n.starts_with("ppt/slides/_rels/") && n.ends_with(".xml.rels"))
            .collect();

        for rel_name in rels {
            let slide_no: u32 = rel_name
                .trim_start_matches("ppt/slides/_rels/slide")
                .trim_end_matches(".xml.rels")
                .parse()
                .unwrap_or(0);
            if slide_no == 0 {
                continue;
            }
            let mut content = String::new();
            {
                use std::io::Read;
                let mut f = archive.by_name(&rel_name).map_err(|e| e.to_string())?;
                f.read_to_string(&mut content).map_err(|e| e.to_string())?;
            }
            // Un `Relationship` de type vidéo/média porte une cible
            // « ../media/videoN.mp4 ». On reste volontairement sur une
            // recherche textuelle : le XML est simple et stable, et une
            // dépendance de plus pour l'analyser ne se justifie pas.
            for part in content.split("<Relationship").skip(1) {
                let is_media = part.contains("/video") || part.contains("/media");
                if !is_media {
                    continue;
                }
                if let Some(start) = part.find("Target=\"") {
                    let rest = &part[start + 8..];
                    if let Some(end) = rest.find('"') {
                        let target = &rest[..end];
                        // On ignore les cibles externes (liens YouTube, etc.).
                        if target.starts_with("http") {
                            continue;
                        }
                        let normalised =
                            format!("ppt/{}", target.trim_start_matches("../"));
                        if VIDEO_IN_PPTX
                            .iter()
                            .any(|ext| normalised.to_lowercase().ends_with(ext))
                        {
                            wanted.push((slide_no, normalised));
                        }
                    }
                }
            }
        }

        if wanted.is_empty() {
            return Ok(Vec::new());
        }

        // 2) Extraction dans le dossier média de l'application.
        let mut out_dir = get_data_root(&app_handle)?;
        out_dir.push("media");
        fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

        let stem: String = std::path::Path::new(&source_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "presentation".into())
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '_' })
            .collect();

        let mut found = Vec::new();
        for (slide, inner) in wanted {
            let base = inner.rsplit('/').next().unwrap_or("video").to_string();
            let dest = out_dir.join(format!("{stem}-diapo{slide}-{base}"));

            if !dest.exists() {
                use std::io::copy;
                let mut entry = match archive.by_name(&inner) {
                    Ok(e) => e,
                    Err(_) => continue, // référence cassée : on passe
                };
                let mut out = fs::File::create(&dest).map_err(|e| e.to_string())?;
                copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            }
            found.push(SlideVideo {
                slide,
                path: dest.to_string_lossy().to_string(),
                name: base,
            });
        }
        found.sort_by_key(|v| v.slide);
        Ok(found)
    })
    .await
    .map_err(|e| e.to_string())?
}

const VIDEO_IN_PPTX: [&str; 6] = [".mp4", ".m4v", ".mov", ".avi", ".wmv", ".webm"];

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

    // L'interface garde les bases chargées en mémoire pour ne pas les relire à
    // chaque bascule d'onglet. Sans ce signal, un module réinstallé pendant la
    // session continuerait d'afficher l'ancien contenu.
    {
        use tauri::Emitter;
        let _ = app_handle.emit("dbs_changed", &filename);
    }
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

/// Lecture automatique des fonds vidéo : on remonte ce que WebKit a REELLEMENT
/// retenu, pas ce qu'on lui a demandé.
#[cfg(target_os = "linux")]
fn check_autoplay() -> Check {
    match AUTOPLAY_ALLOWED.load(std::sync::atomic::Ordering::Relaxed) {
        1 => check("autoplay", "Lecture automatique des fonds", "ok",
            "WebKit accepte de démarrer les vidéos sans clic.".into(), None),
        0 => check("autoplay", "Lecture automatique des fonds", "error",
            "WebKit continue d'exiger un clic : la vidéo de fond ne démarrera qu'après une interaction dans la fenêtre de projection.".into(),
            Some("Signale-le : c'est un réglage refusé par cette version de WebKitGTK.".into())),
        _ => check("autoplay", "Lecture automatique des fonds", "warn",
            "Réglage non encore appliqué (aucune page chargée ?).".into(), None),
    }
}

#[cfg(not(target_os = "linux"))]
fn check_autoplay() -> Check {
    check("autoplay", "Lecture automatique des fonds", "ok", "Géré par le système.".into(), None)
}

#[tauri::command]
fn run_diagnostics(app_handle: tauri::AppHandle) -> Result<Vec<Check>, String> {
    let mut checks = Vec::new();

    checks.push(check_gstreamer());
    checks.push(check_autoplay());

    // Suite bureautique : facultative, mais c'est elle qui permet de projeter
    // un .docx ou un .pptx. Sans elle le reste fonctionne — on l'indique donc
    // comme une information, pas comme une erreur.
    {
        let office = office_status();
        checks.push(if office.available {
            check("office", "Documents Word / PowerPoint", "ok",
                format!("{} — conversion disponible.",
                    office.version.lines().next().unwrap_or("Suite bureautique détectée")),
                None)
        } else {
            check("office", "Documents Word / PowerPoint", "warn",
                "Aucune suite bureautique installée : les .docx et .pptx ne pourront pas être projetés.".into(),
                Some("Installez LibreOffice (libreoffice.org) ou ONLYOFFICE, puis relancez l'application.".into()))
        });
    }

    // Serveur média local : on tente une vraie connexion TCP.
    let server = std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", MEDIA_PORT.load(std::sync::atomic::Ordering::Relaxed))
            .parse().map_err(|e| format!("{}", e))?,
        std::time::Duration::from_millis(600),
    );
    checks.push(match server {
        Ok(_) => check("server", "Serveur média local", "ok",
            format!("Actif sur 127.0.0.1:{}.", MEDIA_PORT.load(std::sync::atomic::Ordering::Relaxed)), None),
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

/// Comment cette installation peut se mettre à jour.
///
/// `"auto"` : le binaire se remplace tout seul (AppImage, installeur Windows,
/// bundle macOS) — le plugin de mise à jour sait faire.
/// `"manual"` : l'application a été installée par le gestionnaire de paquets
/// (.deb, .rpm). Tauri ne remplace PAS un paquet système : on prévient
/// l'utilisateur et on l'envoie télécharger la nouvelle version lui-même.
#[tauri::command]
fn update_install_kind() -> String {
    #[cfg(target_os = "linux")]
    {
        // La variable APPIMAGE est posée par le runtime AppImage lui-même.
        if std::env::var_os("APPIMAGE").is_some() {
            return "auto".to_string();
        }
        return "manual".to_string();
    }
    #[cfg(not(target_os = "linux"))]
    {
        "auto".to_string()
    }
}

/// Page des versions publiées, pour la mise à jour manuelle.
#[tauri::command]
fn releases_url() -> String {
    "https://github.com/Brayan-Clark/myprojector/releases/latest".to_string()
}

/// Cache local des manifestes distants.
///
/// La bibliothèque lit ses catalogues (documents, playbacks, trimestres) sur
/// GitHub. Sans connexion, ces requêtes échouent et l'utilisateur perdait
/// l'accès à TOUT, y compris à ce qu'il avait déjà téléchargé. On garde donc
/// une copie du dernier catalogue reçu : hors ligne, l'application repart de
/// cette copie au lieu d'afficher une erreur.
fn manifest_cache_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut dir = get_data_root(app_handle)?;
    dir.push("data");
    dir.push("_manifests");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Une clé de cache devient un nom de fichier : on n'accepte donc aucun
/// séparateur de chemin, seulement des caractères de slug.
fn safe_cache_key(key: &str) -> Result<String, String> {
    if key.is_empty()
        || key.len() > 120
        || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        || key.contains("..")
    {
        return Err(format!("Clé de cache invalide: {}", key));
    }
    Ok(format!("{}.json", key))
}

#[tauri::command]
fn cache_manifest(app_handle: tauri::AppHandle, key: String, contents: String) -> Result<(), String> {
    let name = safe_cache_key(&key)?;
    let path = manifest_cache_dir(&app_handle)?.join(name);
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Renvoie `None` (et non une erreur) quand rien n'a encore été mis en cache :
/// l'absence de cache est un état normal, pas un incident.
#[tauri::command]
fn read_cached_manifest(app_handle: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let name = safe_cache_key(&key)?;
    let path = manifest_cache_dir(&app_handle)?.join(name);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
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
        let status = resp.status();
        // L'API GitHub est limitée à 60 appels par heure et par adresse IP quand
        // on n'est pas authentifié : passé ce seuil elle répond 403 alors que la
        // connexion fonctionne parfaitement. Le message doit le dire, sinon on
        // conclut à tort qu'on est hors ligne.
        let hint = if status.as_u16() == 403 || status.as_u16() == 429 {
            " (quota de l'API GitHub atteint : réessaie dans une heure — les trimestres déjà téléchargés restent accessibles)"
        } else {
            ""
        };
        return Err(format!("GitHub a répondu {}{}", status, hint));
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
    {
        use tauri::Emitter;
        let _ = app_handle.emit("dbs_changed", filename);
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

    // ⚠ Le fichier est-il DEJA a sa place ? Un `fs::copy` d'un fichier vers
    // lui-meme le TRONQUE A ZERO : le systeme ouvre la destination en ecriture
    // (donc la vide) avant d'en lire la source.
    //
    // C'est ce qui est arrive aux documents convertis : la conversion deposait
    // le PDF dans `media/`, puis l'import le recopiait par-dessus - d'ou des
    // PDF de 0 octet, et le message « fichier PDF vide » a l'affichage.
    let same_file = src
        .canonicalize()
        .ok()
        .zip(dest_path.canonicalize().ok())
        .map(|(a, b)| a == b)
        .unwrap_or(false);

    if !same_file {
        fs::copy(src, &dest_path).map_err(|e| e.to_string())?;
    }

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

    // ⚠ Le fichier est-il DEJA a sa place ? Un `fs::copy` d'un fichier vers
    // lui-meme le TRONQUE A ZERO : le systeme ouvre la destination en ecriture
    // (donc la vide) avant d'en lire la source.
    //
    // C'est ce qui est arrive aux documents convertis : la conversion deposait
    // le PDF dans `media/`, puis l'import le recopiait par-dessus - d'ou des
    // PDF de 0 octet, et le message « fichier PDF vide » a l'affichage.
    let same_file = src
        .canonicalize()
        .ok()
        .zip(dest_path.canonicalize().ok())
        .map(|(a, b)| a == b)
        .unwrap_or(false);

    if !same_file {
        fs::copy(src, &dest_path).map_err(|e| e.to_string())?;
    }

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
///
/// La politique est RELUE après écriture : sur certaines distributions le
/// réglage n'est pas pris en compte, et sans cette relecture on n'a aucun moyen
/// de distinguer "WebKit refuse" d'un problème de codec. La valeur observée est
/// remontée dans le Check système (voir `check_autoplay`).
#[cfg(target_os = "linux")]
static AUTOPLAY_ALLOWED: std::sync::atomic::AtomicI8 = std::sync::atomic::AtomicI8::new(-1);

#[cfg(target_os = "linux")]
fn apply_media_settings(webkit_webview: &webkit2gtk::WebView) {
    use std::sync::atomic::Ordering;
    use webkit2gtk::{SettingsExt, WebViewExt};
    if let Some(settings) = WebViewExt::settings(webkit_webview) {
        // Autoplay : aucune interaction requise (c'est un fond, il doit tourner seul)
        settings.set_media_playback_requires_user_gesture(false);
        settings.set_media_playback_allows_inline(true);
        settings.set_enable_media_stream(true);
        settings.set_enable_webaudio(true);
        settings.set_enable_webgl(true);

        let allowed = !settings.is_media_playback_requires_user_gesture();
        AUTOPLAY_ALLOWED.store(if allowed { 1 } else { 0 }, Ordering::Relaxed);
    } else {
        AUTOPLAY_ALLOWED.store(0, std::sync::atomic::Ordering::Relaxed);
    }
}

// ---------------------------------------------------------------------------
// Port du serveur média
//
// ⚠ Il était figé à 11223, et `warp::serve(...).run(...)` PANIQUE si le port
// est déjà pris. Le fil mourait alors en silence — l'application continuait,
// mais plus aucun média local ne s'affichait : fond vidéo noir, image
// importée absente, PDF vide. Et le message « running on… » s'affichant AVANT
// le bind, les traces affirmaient que tout allait bien.
//
// Cela arrive dès qu'une instance précédente tourne encore (plantage, double
// lancement) ou qu'un autre logiciel occupe le port.
//
// On réserve donc le port au démarrage, avec repli, et on le communique à
// l'interface par un script d'initialisation — exécuté avant tout autre code
// de la page, dans TOUTES les fenêtres.
// ---------------------------------------------------------------------------

static MEDIA_PORT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(11223);

/// Prépare la fenêtre de projection pour la lecture automatique.
///
/// ⚠ WebKitGTK fige la politique média À LA CRÉATION DU DOCUMENT. La fenêtre
/// principale reçoit le réglage dans `setup()`, donc avant son premier
/// chargement : ses vidéos démarrent seules. La fenêtre de projection, elle,
/// est créée plus tard ; le plus tôt qu'on puisse la toucher est
/// `on_page_load`, et c'est déjà trop tard pour son document. D'où le gros
/// bouton « play » au milieu du fond vidéo, alors que la trace affiche
/// pourtant « autoplay autorisé ».
///
/// On applique donc le réglage, PUIS on recharge : le second document naît
/// avec la bonne politique. La fenêtre est encore masquée à ce moment-là,
/// l'assemblée ne voit rien.
#[tauri::command]
fn prime_live_webview(app_handle: tauri::AppHandle) -> Result<(), String> {
    let webview = app_handle
        .get_webview_window("live")
        .ok_or_else(|| "Fenêtre de projection introuvable.".to_string())?;

    #[cfg(target_os = "linux")]
    {
        webview
            .with_webview(|pw: tauri::webview::PlatformWebview| {
                apply_media_settings(&pw.inner());
            })
            .map_err(|e| format!("Réglages média non appliqués : {e}"))?;
    }

    // Le rechargement est ce qui rend le réglage effectif pour le document.
    webview
        .eval("location.reload()")
        .map_err(|e| format!("Rechargement impossible : {e}"))?;
    Ok(())
}

/// Renvoie un message de la fenêtre de projection vers le terminal.
///
/// La console d'une fenêtre secondaire n'est visible nulle part : un échec de
/// lecture automatique y restait indiagnosticable. Cette passerelle fait
/// remonter la raison EXACTE du refus.
#[tauri::command]
fn debug_log(message: String) {
    println!("[webview] {message}");
}

/// Port réellement utilisé par le serveur média, pour l'interface.
#[tauri::command]
fn media_server_port() -> u16 {
    MEDIA_PORT.load(std::sync::atomic::Ordering::Relaxed)
}

/// Cherche un port libre et le mémorise. Renvoie `None` si aucun n'est
/// disponible — cas où l'application doit le DIRE, pas faire semblant.
fn reserve_media_port() -> Option<u16> {
    // 11224 est réservé à la télécommande : on ne le propose pas.
    for port in [11223u16, 11225, 11226, 11227, 11228, 11229, 11230] {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            MEDIA_PORT.store(port, std::sync::atomic::Ordering::Relaxed);
            if port != 11223 {
                println!("[media] port 11223 occupé, serveur média replié sur {port}");
            }
            return Some(port);
        }
    }
    eprintln!("[media] AUCUN port libre : les médias locaux ne s'afficheront pas.");
    None
}

// ---------------------------------------------------------------------------
// Relais audio progressif
//
// Pour écouter une piste non téléchargée, l'interface appelait
// `cacheRemoteAudio` : le fichier ENTIER était rapatrié sur le disque, puis
// seulement joué. Entre le clic sur « lire » et le premier son il s'écoulait
// donc le temps d'un téléchargement complet (3 à 15 Mo selon la piste), sans
// que rien ne bouge à l'écran. C'est ce que l'opérateur décrit par « ça
// coince ».
//
// Ce relais sert la piste distante par tranches, avec les en-têtes `Range` :
// le lecteur reçoit le début du morceau immédiatement et réclame la suite au
// fur et à mesure. On ne passe pas par l'hôte distant directement depuis la
// page (la CSP l'interdit, et les redirections Google Drive la font échouer).
//
// ⚠ On répond volontairement avec MOINS d'octets que demandé (HTTP l'autorise
// explicitement pour une réponse 206) : WebKit demande `bytes=0-`, soit tout
// le fichier, ce qui nous ramènerait au problème de départ.
// ---------------------------------------------------------------------------

/// Taille maximale d'une tranche servie par le relais.
///
/// Assez grande pour que le pipeline GStreamer ne redemande pas sans cesse,
/// assez petite pour que la lecture démarre tout de suite.
const AUDIO_RELAY_CHUNK: u64 = 512 * 1024;

#[derive(Deserialize)]
struct AudioRelayQuery {
    /// URL distante absolue de la piste.
    u: String,
}

/// Analyse un en-tête `Range` simple (`bytes=<début>-[<fin>]`).
///
/// Les plages multiples et les plages suffixes (`bytes=-500`) renvoient `None` :
/// aucun lecteur média n'en émet, et les gérer à moitié serait pire que de
/// servir le fichier entier.
fn parse_byte_range(header: &str) -> Option<(u64, Option<u64>)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let start = start.trim().parse::<u64>().ok()?;
    let end = match end.trim() {
        "" => None,
        v => Some(v.parse::<u64>().ok()?),
    };
    Some((start, end))
}

/// Sert une tranche de la piste distante.
///
/// Ne renvoie jamais de rejet warp : un échec réseau devient une réponse HTTP
/// explicite, sinon le lecteur reçoit un 404 du routeur et affiche
/// « source illisible » sans qu'on sache pourquoi.
async fn relay_audio(
    query: AudioRelayQuery,
    range: Option<String>,
) -> Result<http::Response<Vec<u8>>, std::convert::Infallible> {
    let fail = |status: u16, why: String| {
        eprintln!("[relais audio] {why}");
        Ok(http::Response::builder()
            .status(status)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(why.into_bytes())
            .unwrap_or_default())
    };

    let parsed = match reqwest::Url::parse(&query.u) {
        Ok(u) => u,
        Err(e) => return fail(400, format!("URL invalide : {e}")),
    };
    // Même garde-fou anti-SSRF que les téléchargements : ce relais ne doit pas
    // devenir un moyen de lire n'importe quelle URL depuis la machine.
    let host = parsed.host_str().unwrap_or("").to_string();
    if !host_allowed("audio", &host) {
        return fail(403, format!("Hôte non autorisé : {host}"));
    }

    let client = match reqwest::Client::builder().user_agent("MyProjector/1.0").build() {
        Ok(c) => c,
        Err(e) => return fail(500, format!("Client HTTP : {e}")),
    };

    let wanted = range.as_deref().and_then(parse_byte_range);
    let mut request = client.get(parsed);
    if let Some((start, end)) = wanted {
        let last = start.saturating_add(AUDIO_RELAY_CHUNK).saturating_sub(1);
        let stop = end.map(|e| e.min(last)).unwrap_or(last);
        request = request.header("Range", format!("bytes={start}-{stop}"));
    }

    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => return fail(502, format!("Hôte distant injoignable : {e}")),
    };

    let status = response.status();
    let headers = response.headers().clone();
    if !status.is_success() {
        return fail(502, format!("Hôte distant : HTTP {status}"));
    }
    let body = match response.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => return fail(502, format!("Lecture du flux : {e}")),
    };

    let mut builder = http::Response::builder()
        .header("Accept-Ranges", "bytes")
        // Le cache du WebView ne doit pas garder une tranche : c'est le disque
        // local qui sert de cache, via un vrai téléchargement.
        .header("Cache-Control", "no-store");
    if let Some(kind) = headers.get(reqwest::header::CONTENT_TYPE) {
        builder = builder.header("Content-Type", kind);
    } else {
        builder = builder.header("Content-Type", "audio/mpeg");
    }

    // 206 : l'hôte a respecté la plage, on la transmet telle quelle.
    // 200 : l'hôte IGNORE `Range` (c'est le cas de certains partages Google
    // Drive). On sert alors tout le corps — le comportement d'avant, mais
    // seulement pour ces hôtes-là au lieu de tous.
    if status == reqwest::StatusCode::PARTIAL_CONTENT {
        if let Some(content_range) = headers.get(reqwest::header::CONTENT_RANGE) {
            builder = builder.header("Content-Range", content_range);
        }
        builder = builder.status(206);
    } else {
        builder = builder.status(200);
    }

    Ok(builder
        .header("Content-Length", body.len())
        .body(body)
        .unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Mode de rendu média
//
// L'application FORÇAIT jusqu'ici `WEBKIT_DISABLE_COMPOSITING_MODE=1` et
// `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Ces deux variables corrigent bien une
// fenêtre noire ou verte sur certaines machines, mais elles ont un coût qui
// n'avait pas été mesuré : tout le rendu — y compris CHAQUE image de vidéo —
// repasse par le processeur, et les images décodées ne peuvent plus être
// partagées avec le compositeur sans recopie.
//
// Sur la machine de référence du projet (Celeron N4020C, 2 coeurs à 1,1 GHz,
// Intel UHD 600), c'est rédhibitoire : une vidéo 1080p sature les deux coeurs,
// l'image saccade, et l'audio hache avec elle puisqu'il n'y a plus de coeur
// disponible pour le pipeline GStreamer. Or cette même machine sait décoder en
// MATÉRIEL (vah264dec, vaapih264dec).
//
// Le réglage devient donc un choix explicite, persistant, modifiable depuis la
// bibliothèque > Diagnostic :
//
//   - `auto`     (défaut) : GPU actif + décodage matériel VA-API préféré.
//   - `compat`   : compositing GPU gardé, renderer DMA-BUF désactivé — pour les
//                  configurations où le DMA-BUF échoue (NVIDIA propriétaire,
//                  Mesa ancien, machines virtuelles, Xwayland).
//   - `software` : l'ancien comportement, tout en logiciel. Dernier recours
//                  quand la fenêtre reste noire ou verte.
//
// Les variables d'environnement posées à la main gardent la priorité : on peut
// toujours diagnostiquer depuis un terminal sans toucher au réglage.
// ---------------------------------------------------------------------------

pub const RENDER_MODES: [&str; 3] = ["auto", "compat", "software"];

/// Décodeurs matériels à privilégier sur les décodeurs logiciels de libav.
///
/// 512 vaut plus que `GST_RANK_PRIMARY` (256) : sans ça, GStreamer choisit
/// `avdec_h264` (processeur) alors que `vah264dec` (carte graphique) est
/// disponible, ce qui est exactement le contraire de ce qu'il faut sur un
/// petit processeur.
const HW_DECODER_RANKS: &str = concat!(
    "vah264dec:512,vah265dec:512,vavp8dec:512,vavp9dec:512,",
    "vaav1dec:512,vampeg2dec:512,vajpegdec:512,",
    "vaapih264dec:512,vaapih265dec:512,vaapivp8dec:512,vaapivp9dec:512"
);

/// Emplacement du réglage.
///
/// Il est lu AVANT que Tauri n'existe (les variables d'environnement doivent
/// être posées avant la création du premier WebView), donc on ne peut pas
/// passer par `app.path()`. On reproduit le chemin que Tauri utilise sous
/// Linux : `$XDG_DATA_HOME/<identifier>`, sinon `~/.local/share/<identifier>`.
fn render_config_path() -> Option<PathBuf> {
    let base = match std::env::var_os("XDG_DATA_HOME") {
        Some(v) if !v.is_empty() => PathBuf::from(v),
        _ => PathBuf::from(std::env::var_os("HOME")?).join(".local/share"),
    };
    Some(base.join("com.bryan.myprojector").join("render.json"))
}

fn normalize_render_mode(value: &str) -> String {
    let v = value.trim().to_lowercase();
    if RENDER_MODES.contains(&v.as_str()) { v } else { "auto".to_string() }
}

/// Le mode immédiatement moins exigeant, ou `None` au plus bas.
fn weaker_render_mode(mode: &str) -> Option<&'static str> {
    match mode {
        "auto" => Some("compat"),
        "compat" => Some("software"),
        _ => None, // `software` est le dernier recours : rien en dessous.
    }
}

/// Contenu de `render.json`.
#[derive(Default, Serialize, Deserialize)]
struct RenderConfig {
    #[serde(default)]
    mode: String,
    /// Mode d'un lancement COMMENCÉ mais jamais confirmé par l'interface.
    ///
    /// C'est le cœur du filet de sécurité : la valeur est posée avant la
    /// création de la fenêtre et effacée dès que l'interface a produit des
    /// images. La retrouver au démarrage suivant signifie donc que la fois
    /// précédente n'a RIEN affiché.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending: Option<String>,
    /// Mode depuis lequel on a dû redescendre, pour que l'interface l'explique.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    downgraded_from: Option<String>,
}

fn read_render_config() -> RenderConfig {
    let Some(path) = render_config_path() else { return RenderConfig::default() };
    let Ok(text) = fs::read_to_string(&path) else { return RenderConfig::default() };
    // Un réglage corrompu ne doit pas décider du rendu à la place de
    // l'opérateur : on repart du défaut.
    serde_json::from_str(&text).unwrap_or_default()
}

fn write_render_config(config: &RenderConfig) -> Result<(), String> {
    let path = render_config_path().ok_or("Dossier de configuration introuvable.")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("création du dossier : {e}"))?;
    }
    let text = serde_json::to_string(config).map_err(|e| e.to_string())?;
    fs::write(&path, format!("{text}\n")).map_err(|e| format!("écriture du réglage : {e}"))
}

/// Mode enregistré, `auto` par défaut.
fn read_render_mode() -> String {
    normalize_render_mode(&read_render_config().mode)
}

/// Décide du mode de CE lancement, et arme le filet de sécurité.
///
/// ⚠ Pourquoi ce filet existe.
///
/// Jusqu'à la version 0.1.1, le rendu logiciel était imposé à toutes les
/// machines. Le rendre optionnel — et accéléré par défaut — rend la projection
/// fluide, mais déplace le risque : sur une configuration où le DMA-BUF échoue
/// vraiment (pilote NVIDIA propriétaire, Mesa ancien, machine virtuelle), la
/// fenêtre reste NOIRE. Et un opérateur devant une fenêtre noire ne peut pas
/// cliquer sur le réglage qui l'en sortirait.
///
/// On pose donc un témoin avant d'ouvrir la fenêtre. L'interface l'efface dès
/// qu'elle a réellement produit des images (voir `confirm_render_ok`). Si on le
/// retrouve au démarrage suivant, c'est que rien ne s'est affiché : on
/// redescend d'un cran tout seul, et on le DIT.
///
/// Un échec suffit à faire redescendre. C'est volontaire : attendre deux
/// échecs laisserait l'opérateur bloqué plus longtemps, et une fausse alerte
/// (application fermée dans la demi-seconde qui suit l'ouverture) se corrige
/// d'un clic depuis le Diagnostic, qui affiche la raison.
fn resolve_render_mode() -> String {
    let mut config = read_render_config();
    let requested = normalize_render_mode(&config.mode);

    let effective = match config.pending.as_deref() {
        Some(failed) => {
            let failed = normalize_render_mode(failed);
            match weaker_render_mode(&failed) {
                Some(weaker) => {
                    eprintln!(
                        "[render] le démarrage précédent en « {failed} » n'a rien affiché \
                         -> repli sur « {weaker} »"
                    );
                    config.downgraded_from = Some(failed);
                    weaker.to_string()
                }
                None => {
                    // Déjà au plus bas : on n'a plus rien à proposer, mais on
                    // ne masque pas le problème.
                    eprintln!(
                        "[render] le démarrage précédent en « {failed} » n'a rien affiché, \
                         et c'est déjà le mode le plus compatible."
                    );
                    failed
                }
            }
        }
        None => requested,
    };

    config.mode = effective.clone();
    config.pending = Some(effective.clone());
    if let Err(e) = write_render_config(&config) {
        // Sans témoin, on perd le filet — mais pas le démarrage.
        eprintln!("[render] témoin de démarrage non écrit : {e}");
    }
    effective
}

/// L'interface a produit des images : le mode en cours fonctionne.
///
/// Appelée UNIQUEMENT par la fenêtre de contrôle, et seulement après que
/// plusieurs images ont réellement été composées — pas au simple montage de
/// React. Sur une fenêtre noire, le code s'exécute mais aucune image ne sort :
/// confirmer trop tôt viderait le filet de tout son sens.
#[tauri::command]
fn confirm_render_ok() -> Result<(), String> {
    let mut config = read_render_config();
    if config.pending.is_none() {
        return Ok(()); // déjà confirmé par cette session
    }
    config.pending = None;
    write_render_config(&config)
}

/// Pose les variables d'environnement correspondant au mode.
/// `set` n'écrase jamais une variable déjà définie par l'utilisateur.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn apply_render_mode(mode: &str, set: fn(&str, &str)) {
    println!("[render] mode « {mode} »");
    match mode {
        "software" => {
            // Ancien comportement : aucune accélération, aucun partage d'image.
            set("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            set("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        "compat" => {
            // Le compositing GPU reste actif ; seul le chemin DMA-BUF, qui
            // échoue silencieusement sur certains pilotes, est écarté.
            set("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            set("GST_PLUGIN_FEATURE_RANK", HW_DECODER_RANKS);
        }
        _ => {
            // `auto` : on ne désactive RIEN, et on demande explicitement le
            // décodage matériel.
            set("GST_PLUGIN_FEATURE_RANK", HW_DECODER_RANKS);
        }
    }
}

#[tauri::command]
fn get_render_mode() -> String {
    read_render_mode()
}

/// Enregistre le mode. Il ne prend effet qu'au prochain démarrage : WebKitGTK
/// et GStreamer lisent ces variables une seule fois, à l'initialisation du
/// processus. L'interface DOIT donc le dire à l'opérateur.
#[tauri::command]
fn set_render_mode(mode: String) -> Result<(), String> {
    let mut config = read_render_config();
    config.mode = normalize_render_mode(&mode);
    // L'opérateur reprend la main : on efface l'explication du repli
    // automatique, et le témoin de la session en cours — sinon le choix qu'il
    // vient de faire serait annulé par un repli au prochain démarrage.
    config.downgraded_from = None;
    config.pending = None;
    write_render_config(&config)
}

#[derive(Serialize)]
struct RenderDiagnostic {
    /// Mode enregistré (celui qui s'appliquera au prochain démarrage).
    mode: String,
    /// Mode depuis lequel on a dû redescendre automatiquement, s'il y en a un.
    /// L'interface doit l'expliquer : un repli silencieux priverait l'opérateur
    /// de la fluidité sans qu'il sache pourquoi.
    downgraded_from: Option<String>,
    cores: usize,
    /// true si un périphérique de rendu DRM existe (`/dev/dri/renderD*`).
    gpu_device: bool,
    /// Décodeurs matériels GStreamer effectivement installés.
    hw_decoders: Vec<String>,
    /// Valeurs réellement vues par ce processus, pour lever tout doute.
    compositing_disabled: bool,
    dmabuf_disabled: bool,
    feature_rank: Option<String>,
}

/// État réel du chemin de rendu, pour la section Diagnostic.
///
/// On interroge GStreamer plutôt que de deviner : « la machine a un GPU Intel »
/// ne dit pas si le greffon `va` est installé, et c'est lui qui décide.
#[tauri::command]
fn render_diagnostic() -> RenderDiagnostic {
    let gpu_device = fs::read_dir("/dev/dri")
        .map(|entries| {
            entries.flatten().any(|e| {
                e.file_name().to_string_lossy().starts_with("renderD")
            })
        })
        .unwrap_or(false);

    // `gst-inspect-1.0 <element>` sort en 0 si l'élément existe. On ne teste
    // que les décodeurs qui changent vraiment la vie sur un petit processeur.
    let mut hw_decoders = Vec::new();
    for element in ["vah264dec", "vah265dec", "vavp9dec", "vaapih264dec", "msdkh264dec"] {
        let found = Command::new("gst-inspect-1.0")
            .arg(element)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if found {
            hw_decoders.push(element.to_string());
        }
    }

    let flag = |key: &str| {
        std::env::var(key).map(|v| v != "0" && !v.is_empty()).unwrap_or(false)
    };

    let config = read_render_config();
    RenderDiagnostic {
        mode: normalize_render_mode(&config.mode),
        downgraded_from: config.downgraded_from,
        cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        gpu_device,
        hw_decoders,
        compositing_disabled: flag("WEBKIT_DISABLE_COMPOSITING_MODE"),
        dmabuf_disabled: flag("WEBKIT_DISABLE_DMABUF_RENDERER"),
        feature_rank: std::env::var("GST_PLUGIN_FEATURE_RANK").ok(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // --- Une seule instance ------------------------------------------------
    //
    // Deux instances se disputent les mêmes ports. Constaté en conditions
    // réelles : la seconde ne pouvait plus démarrer son serveur média, et
    // PLUS AUCUN média local ne s'affichait — fond vidéo noir, PDF vide —
    // sans le moindre message. Le repli de port limite les dégâts, mais deux
    // instances restent une mauvaise idée : elles écrivent dans les mêmes
    // fichiers de réglages et pilotent deux fenêtres de projection.
    //
    // Le verrou est une prise de port : il disparaît tout seul si
    // l'application plante, là où un fichier verrou resterait et empêcherait
    // tout redémarrage.
    let _instance_lock = match std::net::TcpListener::bind(("127.0.0.1", 11222u16)) {
        Ok(l) => l,
        Err(_) => {
            eprintln!(
                "MyProjector est déjà lancé. Utilisez la fenêtre existante.\n\
                 (Si vous pensez que c'est une erreur, fermez l'application puis relancez-la.)"
            );
            return;
        }
    };

    // Réservé AVANT tout le reste : le port choisi doit être connu au moment
    // où l'on construit le script d'initialisation des fenêtres.
    let media_port = reserve_media_port().unwrap_or(11223);
    println!("[media] serveur média sur le port {media_port}");

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

        apply_render_mode(&resolve_render_mode(), set_env_default);

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
                                Some(h) if {
                                    let p = MEDIA_PORT.load(std::sync::atomic::Ordering::Relaxed);
                                    h.starts_with(&format!("127.0.0.1:{p}")) || h.starts_with(&format!("localhost:{p}"))
                                } => Ok(()),
                                Some(_) => Err(warp::reject::reject()),
                                None => Ok(()),
                            }
                        })
                        .untuple_one();
                    
                    // On ne sert QUE le dossier AppData pour plus de stabilité
                    let fs_route = host_ok
                        .clone()
                        .and(warp::path("fs"))
                        .and(warp::fs::dir(_app_data_path));

                    // Relais des pistes distantes, par tranches (voir `relay_audio`).
                    let audio_route = host_ok
                        .and(warp::path("audio"))
                        .and(warp::path::end())
                        .and(warp::get())
                        .and(warp::query::<AudioRelayQuery>())
                        .and(warp::header::optional::<String>("range"))
                        .and_then(relay_audio);

                    let routes = fs_route.or(audio_route).with(cors);

                    // Le port a été réservé AVANT le démarrage de l'application
                    // (voir `reserve_media_port`), donc ce bind ne peut plus
                    // échouer sur un port déjà pris.
                    let port = MEDIA_PORT.load(std::sync::atomic::Ordering::Relaxed);
                    println!("Media server (AppData only) running on http://127.0.0.1:{port}");
                    warp::serve(routes).run(([127, 0, 0, 1], port)).await;
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
                    // Sur une machine à deux coeurs, `nice` ne suffit pas :
                    // ffprobe puis ffmpeg occupent la moitié du processeur, et
                    // la moitié restante doit déjà décoder la vidéo, peindre
                    // l'interface et alimenter le pipeline audio. Résultat
                    // observé : audio haché et vidéo saccadée pendant les
                    // premières minutes de chaque session. L'optimisation est
                    // un confort, pas une fonction : on la réserve aux
                    // machines qui peuvent la payer.
                    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
                    if cores < 4 {
                        println!(
                            "Optimisation des médias: {cores} coeur(s) seulement, ignorée \
                             (elle volerait le processeur à la lecture)."
                        );
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
        .on_page_load(|_webview, _payload| {
            // Trace par fenêtre : le réglage d'autoplay est global au WebView,
            // et jusqu'ici rien ne permettait de savoir s'il avait bien pris
            // dans la fenêtre de PROJECTION, créée après le démarrage. Sans
            // cette ligne, « la vidéo de fond démarre dans l'aperçu mais pas à
            // l'écran » reste indiagnosticable.
            #[cfg(target_os = "linux")]
            {
                use std::sync::atomic::Ordering;
                let label = _webview.label().to_string();
                println!("[media] on_page_load pour '{}'", label);
                // ⚠ L'erreur n'est PAS ignorée : `with_webview` échoue si on
                // n'est pas sur le fil principal, et le `let _ =` d'origine
                // rendait cet échec totalement invisible.
                match _webview.with_webview(move |pw: tauri::webview::PlatformWebview| {
                    apply_media_settings(&pw.inner());
                    println!(
                        "[media] webview '{}' : autoplay {}",
                        label,
                        if AUTOPLAY_ALLOWED.load(Ordering::Relaxed) == 1 { "autorisé" } else { "REFUSÉ" }
                    );
                }) {
                    Ok(()) => {}
                    Err(e) => println!("[media] with_webview a échoué : {e}"),
                }
            }
            // La fenêtre de projection est créée APRÈS le setup, et
            // `on_window_event` ne se déclenche que sur un évènement (focus,
            // déplacement...) qui peut arriver trop tard. Ce hook-ci passe pour
            // CHAQUE webview au moment où son document se charge : c'est le seul
            // endroit qui garantit que la politique d'autoplay est posée avant
            // que la vidéo de fond ne tente de démarrer.
            #[cfg(target_os = "linux")]
            {
                let _ = _webview.with_webview(|platform_webview: tauri::webview::PlatformWebview| {
                    apply_media_settings(&platform_webview.inner());
                });
            }
        })
        .plugin(tauri_plugin_fs::init())
        // Mise à jour : le plugin ne fait que VERIFIER et télécharger sur
        // demande explicite. Rien ne s'installe sans l'accord de l'utilisateur
        // (voir `src/lib/updater.ts`) — on ne redémarre pas une machine en
        // plein culte parce qu'une version est sortie.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            search_bible,
            fetch_parallel_verse,
            check_embeddable,
            media_server_port,
            get_render_mode,
            set_render_mode,
            render_diagnostic,
            confirm_render_ok,
            debug_log,
            prime_live_webview,
            office_status,
            convert_office_to_pdf,
            extract_pptx_videos,
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
            clean_partial_downloads,
            cache_manifest,
            read_cached_manifest,
            update_install_kind,
            releases_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
