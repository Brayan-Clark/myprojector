use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::path::PathBuf;
use std::fs;
use std::io::Write;
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

fn init_data(app: &tauri::AppHandle) -> Result<(), String> {
    let data_root = get_data_root(app)?;
    println!("Initializing data in {:?}", data_root);
    
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

#[derive(Serialize, Deserialize)]
pub struct Song {
    pub id: i64,
    pub number: String,
    pub title: String,
    pub lyrics: String,
    pub book: String,
}

#[tauri::command]
fn fetch_hymns(app_handle: tauri::AppHandle, db_name: &str) -> Result<Vec<Song>, String> {
    let mut db_path = get_data_root(&app_handle)?;
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
fn fetch_bible(app_handle: tauri::AppHandle, db_name: &str) -> Result<Vec<Song>, String> {
    let mut db_path = get_data_root(&app_handle)?;
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
    let mut dest_path = get_data_root(&app_handle)?;
    dest_path.push("data");
    dest_path.push(category);
    fs::create_dir_all(&dest_path).map_err(|e| e.to_string())?;
    dest_path.push(&filename);

    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;

    let mut file = fs::File::create(&dest_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn delete_db(app_handle: tauri::AppHandle, category: &str, filename: &str) -> Result<(), String> {
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

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
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
        // Fix for AppImage crashes on video playback
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("WEBKIT_DISABLE_HW_ACCELERATION", "1");
    }

    tauri::Builder::default()
        .setup(|app| {
            init_data(app.handle())?;
            
            let app_data_path = app.path().app_data_dir().unwrap_or_default();
            
            let _ = std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("Failed to create tokio runtime for warp");
                rt.block_on(async {
                    let cors = warp::cors()
                        .allow_any_origin()
                        .allow_methods(vec!["GET", "POST", "OPTIONS"])
                        .allow_headers(vec!["Range", "Content-Type", "Accept", "Origin"]);
                    
                    // On ne sert QUE le dossier AppData pour plus de stabilité
                    let fs_route = warp::path("fs")
                        .and(warp::fs::dir(app_data_path))
                        .with(cors);
                    
                    println!("Media server (AppData only) running on http://127.0.0.1:11223");
                    warp::serve(fs_route).run(([127, 0, 0, 1], 11223)).await;
                });
            });
            
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                if window.label() == "main" {
                    window.app_handle().exit(0);
                }
            }
            _ => {}
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
            get_app_data_path,
            read_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
