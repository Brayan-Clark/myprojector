use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize, Deserialize)]
pub struct Song {
    pub id: i64,
    pub number: String,
    pub title: String,
    pub lyrics: String,
    pub book: String,
}

#[tauri::command]
fn fetch_hymns(_app_handle: tauri::AppHandle, db_name: &str) -> Result<Vec<Song>, String> {
    // Determine the db path correctly based on the app environment
    // For development, assuming src-tauri/data/hymnes/
    // We can use current_dir or a fixed base for now
    let mut db_path = std::env::current_dir().map_err(|e| e.to_string())?;
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
fn fetch_bible(db_name: &str) -> Result<Vec<Song>, String> {
    let mut db_path = std::env::current_dir().map_err(|e| e.to_string())?;
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
    db_name: &str,
    is_bible: bool,
    id: i64,
    title: String,
    content: String,
) -> Result<(), String> {
    let mut db_path = std::env::current_dir().map_err(|e| e.to_string())?;
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

use std::fs;
use std::io::Write;

#[tauri::command]
fn list_dbs(category: &str) -> Result<Vec<String>, String> {
    let mut dir_path = std::env::current_dir().map_err(|e| e.to_string())?;
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
async fn download_db(url: String, category: String, filename: String) -> Result<(), String> {
    let mut dest_path = std::env::current_dir().map_err(|e| e.to_string())?;
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
fn delete_db(category: &str, filename: &str) -> Result<(), String> {
    let mut db_path = std::env::current_dir().map_err(|e| e.to_string())?;
    db_path.push("data");
    db_path.push(category);
    db_path.push(filename);

    if db_path.exists() {
        fs::remove_file(db_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn list_backgrounds() -> Result<Vec<String>, String> {
    let mut dir_path = std::env::current_dir().map_err(|e| e.to_string())?;
    dir_path.push("data");
    dir_path.push("backgrounds");

    if !dir_path.exists() {
        fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(&dir_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            if let Some(path_str) = path.to_str() {
                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                if ["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "ogg", "mov", "mkv", "avi", "m4v"].contains(&ext.as_str()) {
                    files.push(path_str.to_string());
                }
            }
        }
    }
    Ok(files)
}

#[tauri::command]
fn import_background(source_path: String) -> Result<String, String> {
    let mut dest_dir = std::env::current_dir().map_err(|e| e.to_string())?;
    dest_dir.push("data");
    dest_dir.push("backgrounds");

    if !dest_dir.exists() {
        fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    }

    let src = std::path::Path::new(&source_path);
    let filename = src.file_name().ok_or("Invalid filename")?;
    let mut dest_path = dest_dir.clone();
    dest_path.push(filename);

    fs::copy(src, &dest_path).map_err(|e| e.to_string())?;
    
    Ok(dest_path.to_str().unwrap_or("").to_string())
}

#[tauri::command]
fn delete_background(file_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&file_path);
    // Basal security check: verify if it's inside data/backgrounds
    let mut bg_dir = std::env::current_dir().map_err(|e| e.to_string())?;
    bg_dir.push("data");
    bg_dir.push("backgrounds");
    
    if path.starts_with(&bg_dir) && path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Unauthorized or file does not exist".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            delete_background
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
