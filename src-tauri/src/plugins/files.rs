//! `files.open` for plugins: the host shows the open dialog and reads the file the user picks.

use super::frame::encode_frame;
use super::store::enabled_plugin;
use crate::folder_compare::blocking;
use std::io::Read;
use std::path::Path;

pub const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// File extensions for the dialog filter: letters and digits only, without a leading `.` or `*.`.
fn extensions(accept: &[String]) -> Vec<String> {
    accept
        .iter()
        .map(|a| a.trim_start_matches("*.").trim_start_matches('.').to_ascii_lowercase())
        .filter(|a| !a.is_empty() && a.len() <= 16 && a.bytes().all(|b| b.is_ascii_alphanumeric()))
        .collect()
}

/// Reads `path` unless it is not a regular file or is over the cap. The size is checked before reading.
pub fn read_capped(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if !meta.is_file() {
        return Err("Not a file".to_string());
    }
    if meta.len() > max {
        return Err(format!("The file is larger than {} MB", max / (1024 * 1024)));
    }
    // Bounded by the reader too, so a file that grows after the check (or reports size 0) cannot pass the cap.
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    std::fs::File::open(path).and_then(|file| file.take(max + 1).read_to_end(&mut bytes)).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > max {
        return Err(format!("The file is larger than {} MB", max / (1024 * 1024)));
    }
    Ok(bytes)
}

/// Replies with a frame of `{name, size}` and the file bytes, or an empty reply when the user cancels.
#[tauri::command]
pub async fn plugin_open_file(app: tauri::AppHandle, id: String, accept: Vec<String>) -> Result<tauri::ipc::Response, String> {
    use tauri_plugin_dialog::DialogExt;
    let plugin = {
        let app = app.clone();
        blocking(move || enabled_plugin(&app, &id)).await?
    };
    if !plugin.granted.iter().any(|g| g == "files:open") {
        return Err("permission_denied: files:open".to_string());
    }
    let exts = extensions(&accept);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if !exts.is_empty() {
            let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
            dialog = dialog.add_filter("Files", &refs);
        }
        dialog.blocking_pick_file()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(picked) = picked else { return Ok(tauri::ipc::Response::new(Vec::<u8>::new())) };
    let path = picked.into_path().map_err(|error| error.to_string())?;
    let bytes = blocking(move || {
        let bytes = read_capped(&path, MAX_FILE_BYTES)?;
        Ok((path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), bytes))
    })
    .await?;
    let meta = serde_json::json!({ "name": bytes.0, "size": bytes.1.len() });
    Ok(tauri::ipc::Response::new(encode_frame(&meta, &bytes.1)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accept_lists_become_plain_extensions() {
        let accept = ["JSON", ".txt", "*.md", "", "a/b", "x".repeat(20).as_str()].map(String::from);
        assert_eq!(extensions(&accept), vec!["json", "txt", "md"]);
    }

    #[test]
    fn reading_stops_at_the_cap_and_refuses_folders() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "0123456789").unwrap();
        assert_eq!(read_capped(&file, 10).unwrap(), b"0123456789");
        assert!(read_capped(&file, 9).unwrap_err().contains("larger than"));
        assert!(read_capped(dir.path(), 100).is_err());
        assert!(read_capped(&dir.path().join("missing"), 100).is_err());
    }
}
