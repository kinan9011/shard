//! Per-plugin key-value storage for the plugin SDK (`storage.get/set/remove`).
//! Each plugin has one JSON object in `plugin-data/<id>.json`, capped at 1 MB.

use super::manifest::valid_id;
use crate::folder_compare::blocking;
use crate::paths::io_err;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const MAX_BYTES: usize = 1024 * 1024;
pub const MAX_KEY_LEN: usize = 256;

// ponytail: one global lock around read-modify-write. Per-plugin locks if contention ever matters.
static LOCK: Mutex<()> = Mutex::new(());

fn file_for(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("Invalid plugin id: {id}"));
    }
    Ok(root.join("plugin-data").join(format!("{id}.json")))
}

fn check_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_KEY_LEN {
        return Err(format!("A storage key must be 1 to {MAX_KEY_LEN} bytes long"));
    }
    Ok(())
}

/// A missing file is empty. An unreadable one is an error: treating it as empty would let the next
/// write replace the plugin's data.
fn load(path: &Path) -> Result<Map<String, Value>, String> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(error) => return Err(io_err(error)),
    };
    match serde_json::from_str(&text) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err("The plugin's stored data is damaged".to_string()),
    }
}

pub fn get(root: &Path, id: &str, key: &str) -> Result<Option<Value>, String> {
    check_key(key)?;
    let path = file_for(root, id)?;
    Ok(load(&path)?.remove(key))
}

/// Stores `value` under `key`, or removes the key when `value` is `None`.
pub fn set(root: &Path, id: &str, key: &str, value: Option<Value>) -> Result<(), String> {
    check_key(key)?;
    let path = file_for(root, id)?;
    let mut map = load(&path)?;
    match value {
        Some(value) => map.insert(key.to_string(), value),
        None => map.remove(key),
    };
    let json = serde_json::to_vec(&map).map_err(|error| error.to_string())?;
    if json.len() > MAX_BYTES {
        return Err("Plugin storage is full (1 MB limit)".to_string());
    }
    let dir = path.parent().ok_or("Invalid storage path")?;
    fs::create_dir_all(dir).map_err(io_err)?;
    let temp = path.with_extension("json.tmp");
    // Flushed before the rename, so a crash leaves the old file or the whole new one.
    let write = fs::File::create(&temp).and_then(|mut file| {
        std::io::Write::write_all(&mut file, &json)?;
        file.sync_all()
    });
    write.map_err(io_err)?;
    fs::rename(&temp, &path).map_err(io_err)
}

/// Deletes all of a plugin's data. Called when the plugin is uninstalled, so a later plugin with the same id starts empty.
pub fn remove_all(root: &Path, id: &str) -> Result<(), String> {
    let path = file_for(root, id)?;
    let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_err(error)),
    }
}

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn plugin_storage_get(app: tauri::AppHandle, id: String, key: String) -> Result<Option<Value>, String> {
    let root = root(&app)?;
    blocking(move || {
        let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        get(&root, &id, &key)
    })
    .await
}

/// A `null` value removes the key.
#[tauri::command]
pub async fn plugin_storage_set(app: tauri::AppHandle, id: String, key: String, value: Option<Value>) -> Result<(), String> {
    let root = root(&app)?;
    blocking(move || {
        let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        set(&root, &id, &key, value)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn values_round_trip_and_missing_keys_are_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(get(dir.path(), "hello", "a").unwrap(), None);
        set(dir.path(), "hello", "a", Some(json!({"n": [1, 2], "s": "x"}))).unwrap();
        assert_eq!(get(dir.path(), "hello", "a").unwrap(), Some(json!({"n": [1, 2], "s": "x"})));
        assert_eq!(get(dir.path(), "hello", "b").unwrap(), None);
    }

    #[test]
    fn none_removes_the_key() {
        let dir = tempfile::tempdir().unwrap();
        set(dir.path(), "hello", "a", Some(json!(1))).unwrap();
        set(dir.path(), "hello", "b", Some(json!(2))).unwrap();
        set(dir.path(), "hello", "a", None).unwrap();
        assert_eq!(get(dir.path(), "hello", "a").unwrap(), None);
        assert_eq!(get(dir.path(), "hello", "b").unwrap(), Some(json!(2)));
        // Removing a key that is not there is fine.
        set(dir.path(), "hello", "zzz", None).unwrap();
    }

    #[test]
    fn remove_all_deletes_the_data_and_tolerates_none() {
        let dir = tempfile::tempdir().unwrap();
        remove_all(dir.path(), "hello").unwrap();
        set(dir.path(), "hello", "a", Some(json!(1))).unwrap();
        set(dir.path(), "other", "a", Some(json!(2))).unwrap();
        remove_all(dir.path(), "hello").unwrap();
        assert_eq!(get(dir.path(), "hello", "a").unwrap(), None);
        assert_eq!(get(dir.path(), "other", "a").unwrap(), Some(json!(2)));
    }

    #[test]
    fn plugins_do_not_share_data() {
        let dir = tempfile::tempdir().unwrap();
        set(dir.path(), "one", "k", Some(json!("1"))).unwrap();
        assert_eq!(get(dir.path(), "two", "k").unwrap(), None);
    }

    #[test]
    fn the_size_cap_rejects_and_leaves_the_file_alone() {
        let dir = tempfile::tempdir().unwrap();
        set(dir.path(), "hello", "small", Some(json!("ok"))).unwrap();
        let before = fs::read(file_for(dir.path(), "hello").unwrap()).unwrap();
        let error = set(dir.path(), "hello", "big", Some(json!("x".repeat(MAX_BYTES)))).unwrap_err();
        assert!(error.contains("full"), "{error}");
        assert_eq!(fs::read(file_for(dir.path(), "hello").unwrap()).unwrap(), before);
    }

    #[test]
    fn bad_ids_and_keys_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        for id in ["", "../evil", "A", "a/b", "x"] {
            assert!(set(dir.path(), id, "k", Some(json!(1))).is_err(), "id {id:?}");
            assert!(get(dir.path(), id, "k").is_err(), "id {id:?}");
        }
        assert!(set(dir.path(), "hello", "", Some(json!(1))).is_err());
        assert!(set(dir.path(), "hello", &"k".repeat(MAX_KEY_LEN + 1), Some(json!(1))).is_err());
        assert!(!dir.path().join("plugin-data").join("evil.json").exists());
    }

    #[test]
    fn damaged_data_is_an_error_and_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = file_for(dir.path(), "hello").unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "not json").unwrap();
        assert!(get(dir.path(), "hello", "k").is_err());
        assert!(set(dir.path(), "hello", "k", Some(json!(1))).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "not json");
    }
}
