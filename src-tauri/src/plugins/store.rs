//! The installed-plugin registry (`plugins.json`) and the package folders under `plugins/<id>/`.
//! W4 installs from a folder, W9 from a zip (`zip.rs`), W11 from a repository or a URL (`install.rs`); all go through the same record.

use super::manifest::{self, valid_host, valid_id, Manifest};
use crate::folder_compare::blocking;
use crate::paths::io_err;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_FILES: usize = 50_000;
pub const MAX_BYTES: u64 = 1024 * 1024 * 1024;

const REGISTRY_FILE: &str = "plugins.json";

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Repo,
    Zip,
    Folder,
    Url,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Source {
    pub kind: SourceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// One registry record. It is also what the commands return to the frontend.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub id: String,
    pub version: String,
    /// Stored with the record, so listing never reads the package folders.
    pub manifest: Manifest,
    pub source: Source,
    /// SHA-256 of the installed files (sorted paths plus contents; skipped links are not part of it), for display.
    pub sha256: String,
    /// True only when the hash matched an index or a release asset. A folder install is unverified.
    pub verified: bool,
    pub enabled: bool,
    pub granted: Vec<String>,
    /// Epoch milliseconds.
    pub installed_at: u64,
    /// Install-time notes (skipped symlinks). Returned once, never stored.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

/// What the install dialog shows for a folder before anything is installed.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderPreview {
    pub manifest: Manifest,
    /// Entries that would be skipped (links).
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy)]
pub struct Limits {
    pub max_files: usize,
    pub max_bytes: u64,
}

pub const LIMITS: Limits = Limits { max_files: MAX_FILES, max_bytes: MAX_BYTES };

#[derive(Clone)]
pub struct Store {
    root: PathBuf,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// A name that no other staging folder in this or an earlier process used.
pub(super) fn unique_name(prefix: &str) -> String {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{prefix}{}-{}-{nanos}", std::process::id(), COUNTER.fetch_add(1, Ordering::SeqCst))
}

/// Every regular file under `src` (sorted by relative path), plus a warning for each skipped link or
/// special file. The whole tree is checked before anything is copied.
fn collect_files(src: &Path, limits: Limits) -> Result<(Vec<PathBuf>, Vec<String>), String> {
    fn walk(dir: &Path, rel: &Path, files: &mut Vec<PathBuf>, warnings: &mut Vec<String>, bytes: &mut u64, limits: Limits) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(io_err)? {
            let entry = entry.map_err(io_err)?;
            let rel = rel.join(entry.file_name());
            if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
                return Err(format!("Unsafe path in the package: {}", rel.display()));
            }
            let meta = fs::symlink_metadata(entry.path()).map_err(io_err)?;
            if meta.is_dir() {
                walk(&entry.path(), &rel, files, warnings, bytes, limits)?;
            } else if meta.is_file() {
                *bytes += meta.len();
                if files.len() >= limits.max_files {
                    return Err(format!("The package has more than {} files.", limits.max_files));
                }
                if *bytes > limits.max_bytes {
                    return Err(format!("The package is larger than {} MB.", limits.max_bytes / (1024 * 1024)));
                }
                files.push(rel);
            } else {
                warnings.push(format!("Skipped {}: links and special files are not installed.", rel.display()));
            }
        }
        Ok(())
    }
    let (mut files, mut warnings, mut bytes) = (Vec::new(), Vec::new(), 0u64);
    walk(src, Path::new(""), &mut files, &mut warnings, &mut bytes, limits)?;
    files.sort();
    warnings.sort();
    Ok((files, warnings))
}

/// Copies `files` from `src` to `dest` and hashes them: for each file, the `/`-joined path, a zero
/// byte, the length (u64 LE) and the contents. Bytes read are counted again, in case the folder
/// changed after the walk.
fn copy_and_hash(src: &Path, dest: &Path, files: &[PathBuf], limits: Limits) -> Result<String, String> {
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    for rel in files {
        let path = src.join(rel);
        // The walk saw a regular file. Check again, so one swapped for a link meanwhile is refused.
        if !fs::symlink_metadata(&path).map_err(io_err)?.is_file() {
            return Err(format!("{} changed while it was being installed.", rel.display()));
        }
        let bytes = fs::read(path).map_err(io_err)?;
        total += bytes.len() as u64;
        if total > limits.max_bytes {
            return Err(format!("The package is larger than {} MB.", limits.max_bytes / (1024 * 1024)));
        }
        let name = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
        hasher.update(name.as_bytes());
        hasher.update([0u8]);
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(&bytes);
        let target = dest.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(io_err)?;
        }
        fs::write(target, bytes).map_err(io_err)?;
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Checks one grant against what the plugin declared. `Ok(None)` is a grant that needs no record
/// (`storage` is always on). `Ok(Some(entry))` is the normalised entry to store: a declared
/// permission name, or `network:<host>` for a host the user added on top of the manifest's.
fn check_grant(manifest: &Manifest, grant: &str) -> Result<Option<String>, String> {
    let declared = |name: &str| manifest.permissions.iter().any(|p| p.name == name);
    if grant == "storage" {
        return Ok(None);
    }
    if let Some(host) = grant.strip_prefix("network:") {
        let host = host.to_ascii_lowercase();
        if !declared("network") {
            return Err(format!("The plugin does not declare the network permission: {grant}"));
        }
        if !valid_host(&host) {
            return Err(format!("Not a valid host: {host}"));
        }
        return Ok(Some(format!("network:{host}")));
    }
    if declared(grant) {
        Ok(Some(grant.to_string()))
    } else {
        Err(format!("The plugin does not declare this permission: {grant}"))
    }
}

/// The entries to store for `grants`: sorted, without duplicates. Any undeclared or malformed entry is an error.
pub fn sanitize_grants(manifest: &Manifest, grants: &[String]) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for grant in grants {
        out.extend(check_grant(manifest, grant)?);
    }
    out.sort();
    out.dedup();
    Ok(out)
}

/// The hosts a manifest's `network` permission lists, lowercase.
fn network_hosts(manifest: &Manifest) -> Vec<String> {
    manifest.permissions.iter().filter(|p| p.name == "network").flat_map(|p| p.hosts.iter().flatten().map(|h| h.to_ascii_lowercase())).collect()
}

/// Keeps the grants a new manifest still declares and drops the rest (an update that no longer asks for a permission).
/// The plain `network` grant also goes when the update lists a host the approved version did not: the user
/// approved those hosts, not the new ones. Hosts the user added themselves (`network:<host>`) stay.
fn retain_declared(previous: &Manifest, manifest: &Manifest, grants: &[String]) -> Vec<String> {
    let old_hosts = network_hosts(previous);
    let widened = network_hosts(manifest).iter().any(|host| !old_hosts.contains(host));
    let mut out: Vec<String> =
        grants.iter().filter(|g| !(widened && *g == "network")).filter_map(|g| check_grant(manifest, g).ok().flatten()).collect();
    out.sort();
    out.dedup();
    out
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Store { root }
    }

    fn plugins_dir(&self) -> PathBuf {
        self.root.join("plugins")
    }

    pub(super) fn staging_dir(&self) -> PathBuf {
        self.plugins_dir().join(".staging")
    }

    /// Packages being downloaded from a repository, before they are staged.
    pub(super) fn downloads_dir(&self) -> PathBuf {
        self.plugins_dir().join(".downloads")
    }

    /// The zip dropped on the install dialog, before it is inspected.
    pub(super) fn drop_dir(&self) -> PathBuf {
        self.plugins_dir().join(".drop")
    }

    fn registry_path(&self) -> PathBuf {
        self.root.join(REGISTRY_FILE)
    }

    /// A missing registry is empty. An unreadable one is renamed to `plugins.json.corrupt-<ms>` and
    /// replaced by an empty one, so a damaged file never blocks the app.
    /// Any other read failure (permissions, a lock) is an error: treating it as empty would let the
    /// next save overwrite the real registry.
    pub fn load(&self) -> Result<Vec<InstalledPlugin>, String> {
        let path = self.registry_path();
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(io_err(error)),
        };
        match serde_json::from_str(&text) {
            Ok(list) => Ok(list),
            Err(error) => {
                let backup = self.root.join(format!("{REGISTRY_FILE}.corrupt-{}", now_ms()));
                eprintln!("plugins.json is unreadable ({error}); moved to {}", backup.display());
                fs::rename(&path, backup).map_err(io_err)?;
                Ok(Vec::new())
            }
        }
    }

    fn save(&self, list: &[InstalledPlugin]) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(io_err)?;
        let stored: Vec<InstalledPlugin> =
            list.iter().cloned().map(|plugin| InstalledPlugin { warnings: Vec::new(), ..plugin }).collect();
        let json = serde_json::to_vec_pretty(&stored).map_err(|error| error.to_string())?;
        let temp = self.root.join(format!("{REGISTRY_FILE}.tmp"));
        // Flushed before the rename, so a crash leaves the old file or the whole new one.
        let write = fs::File::create(&temp).and_then(|mut file| {
            std::io::Write::write_all(&mut file, &json)?;
            file.sync_all()
        });
        write.map_err(io_err)?;
        fs::rename(&temp, self.registry_path()).map_err(io_err)
    }

    pub fn list(&self) -> Result<Vec<InstalledPlugin>, String> {
        self.load()
    }

    pub fn install_folder(&self, src: &Path) -> Result<InstalledPlugin, String> {
        self.install_folder_with(src, LIMITS)
    }

    pub fn install_folder_with(&self, src: &Path, limits: Limits) -> Result<InstalledPlugin, String> {
        let source = Source { kind: SourceKind::Folder, repo: None, url: None };
        self.with_staging(|staging| self.install_tree(src, staging, limits, source, None))
    }

    /// The manifest of a package folder and what the install would skip, with the checks of
    /// `install_folder` (manifest, links, file and size limits). Nothing is written.
    pub fn inspect_folder(&self, src: &Path) -> Result<FolderPreview, String> {
        self.inspect_folder_with(src, LIMITS)
    }

    pub fn inspect_folder_with(&self, src: &Path, limits: Limits) -> Result<FolderPreview, String> {
        let manifest = manifest::read(src).map_err(|errors| errors.join("\n"))?;
        let (_files, warnings) = collect_files(src, limits)?;
        Ok(FolderPreview { manifest, warnings })
    }

    /// Runs `work` with a clean `.staging` folder and removes it afterwards, whatever the outcome.
    pub(super) fn with_staging<T>(&self, work: impl FnOnce(&Path) -> Result<T, String>) -> Result<T, String> {
        let staging = self.staging_dir();
        // Leftovers come from an earlier crash. Installs run one at a time, so nothing live is here.
        let _ = fs::remove_dir_all(&staging);
        let result = work(&staging);
        let _ = fs::remove_dir_all(&staging);
        result
    }

    /// The install pipeline for an unpacked package folder `src`: validate, check limits, copy into
    /// `staging`, then swap it into place. `sha256` replaces the content hash when the source has a
    /// canonical one (the zip file's).
    pub(super) fn install_tree(&self, src: &Path, staging: &Path, limits: Limits, source: Source, sha256: Option<String>) -> Result<InstalledPlugin, String> {
        manifest::read(src).map_err(|errors| errors.join("\n"))?;
        let (files, warnings) = collect_files(src, limits)?;
        let staged = staging.join(unique_name(""));
        self.install_staged(src, &staged, &files, limits, source, sha256).map(|plugin| InstalledPlugin { warnings, ..plugin })
    }

    fn install_staged(&self, src: &Path, staged: &Path, files: &[PathBuf], limits: Limits, source: Source, sha256: Option<String>) -> Result<InstalledPlugin, String> {
        fs::create_dir_all(staged).map_err(io_err)?;
        let content_hash = copy_and_hash(src, staged, files, limits)?;
        let sha256 = sha256.unwrap_or(content_hash);
        // The staged copy is what gets installed. This also catches an entry file that was a skipped link.
        let manifest = manifest::read(staged).map_err(|errors| errors.join("\n"))?;

        let mut list = self.load()?;
        let target = self.plugins_dir().join(&manifest.id);
        let old = self.staging_dir().join(unique_name(&format!("{}.old-", manifest.id)));
        let had_old = fs::symlink_metadata(&target).is_ok();
        if had_old {
            fs::rename(&target, &old).map_err(io_err)?;
        }
        if let Err(error) = fs::rename(staged, &target) {
            if had_old {
                let _ = fs::rename(&old, &target);
            }
            return Err(io_err(error));
        }

        let previous = list.iter().position(|p| p.id == manifest.id);
        let (enabled, granted) = previous.map(|i| (list[i].enabled, retain_declared(&list[i].manifest, &manifest, &list[i].granted))).unwrap_or((true, Vec::new()));
        // A repository install has passed the checksum from the index. Every other source is unverified.
        let verified = source.kind == SourceKind::Repo;
        let record = InstalledPlugin {
            id: manifest.id.clone(),
            version: manifest.version.clone(),
            manifest,
            source,
            sha256,
            verified,
            enabled,
            granted,
            installed_at: now_ms(),
            warnings: Vec::new(),
        };
        match previous {
            Some(i) => list[i] = record.clone(),
            None => list.push(record.clone()),
        }
        if let Err(error) = self.save(&list) {
            // Put the earlier package back, so the registry and the folders still agree.
            let _ = fs::remove_dir_all(&target);
            if had_old {
                let _ = fs::rename(&old, &target);
            }
            return Err(error);
        }
        Ok(record)
    }

    pub fn uninstall(&self, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err(format!("Invalid plugin id: {id}"));
        }
        let mut list = self.load()?;
        let before = list.len();
        list.retain(|p| p.id != id);
        if list.len() == before {
            return Err(format!("Plugin is not installed: {id}"));
        }
        // Registry first: a failure after this leaves an orphan folder, which a reinstall replaces,
        // never a listed plugin without files.
        self.save(&list)?;
        match fs::remove_dir_all(self.plugins_dir().join(id)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_err(error)),
        }
        // The plugin's SDK storage goes with it, so a later plugin with the same id does not read it.
        super::storage::remove_all(&self.root, id)
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<InstalledPlugin, String> {
        if !valid_id(id) {
            return Err(format!("Invalid plugin id: {id}"));
        }
        let mut list = self.load()?;
        let plugin = list.iter_mut().find(|p| p.id == id).ok_or_else(|| format!("Plugin is not installed: {id}"))?;
        plugin.enabled = enabled;
        let record = plugin.clone();
        self.save(&list)?;
        Ok(record)
    }
    pub fn set_grants(&self, id: &str, grants: &[String]) -> Result<InstalledPlugin, String> {
        if !valid_id(id) {
            return Err(format!("Invalid plugin id: {id}"));
        }
        let mut list = self.load()?;
        let plugin = list.iter_mut().find(|p| p.id == id).ok_or_else(|| format!("Plugin is not installed: {id}"))?;
        plugin.granted = sanitize_grants(&plugin.manifest, grants)?;
        let record = plugin.clone();
        self.save(&list)?;
        Ok(record)
    }
}

// ---------------------------------------------------------------------------------------------
// Tauri commands. Every one runs on a blocking thread, one at a time (ponytail: one global lock;
// installs are rare and local, so per-plugin locks are not worth it).
// ---------------------------------------------------------------------------------------------

static LOCK: Mutex<()> = Mutex::new(());

fn store(app: &tauri::AppHandle) -> Result<Store, String> {
    use tauri::Manager;
    Ok(Store::new(app.path().app_data_dir().map_err(|error| error.to_string())?))
}

/// Runs `work` on a blocking thread while holding the store lock.
pub(super) async fn locked<T: Send + 'static>(store: Store, work: impl FnOnce(Store) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    blocking(move || {
        let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        work(store)
    })
    .await
}

pub(super) async fn run<T: Send + 'static>(app: tauri::AppHandle, work: impl FnOnce(Store) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    locked(store(&app)?, work).await
}

#[tauri::command]
pub async fn plugins_list(app: tauri::AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    run(app, |store| store.list()).await
}

#[tauri::command]
pub async fn plugin_install_folder(app: tauri::AppHandle, path: String) -> Result<InstalledPlugin, String> {
    let repos = super::repos::repos(&app)?;
    run(app, move |store| {
        repos.require_outside()?;
        store.install_folder(Path::new(&path))
    })
    .await
}

#[tauri::command]
pub async fn plugin_inspect_folder(app: tauri::AppHandle, path: String) -> Result<FolderPreview, String> {
    run(app, move |store| store.inspect_folder(Path::new(&path))).await
}

#[tauri::command]
pub async fn plugin_uninstall(app: tauri::AppHandle, id: String) -> Result<(), String> {
    run(app, move |store| store.uninstall(&id)).await
}

#[tauri::command]
pub async fn plugin_set_enabled(app: tauri::AppHandle, id: String, enabled: bool) -> Result<InstalledPlugin, String> {
    run(app, move |store| store.set_enabled(&id, enabled)).await
}

#[tauri::command]
pub async fn plugin_set_grants(app: tauri::AppHandle, id: String, grants: Vec<String>) -> Result<InstalledPlugin, String> {
    run(app, move |store| store.set_grants(&id, &grants)).await
}

/// The installed, enabled plugin `id`. Used by the commands that act for a plugin (fetch, files).
pub(crate) fn enabled_plugin(app: &tauri::AppHandle, id: &str) -> Result<InstalledPlugin, String> {
    let store = store(app)?;
    let _guard = LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    store.load()?.into_iter().find(|p| p.id == id && p.enabled).ok_or_else(|| format!("Plugin is not installed or is turned off: {id}"))
}

#[tauri::command]
pub async fn plugin_pick_folder(app: tauri::AppHandle) -> Option<String> {
    crate::folder_compare::pick_folder(app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/plugins").join(name)
    }

    /// A copy of a fixture the test may change.
    fn package(name: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for entry in fs::read_dir(fixture(name)).unwrap() {
            let entry = entry.unwrap();
            fs::copy(entry.path(), dir.path().join(entry.file_name())).unwrap();
        }
        dir
    }

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        (dir, store)
    }

    /// Makes the package ask for `clipboard:write`.
    fn declare_clipboard(dir: &Path) {
        let path = dir.join("plugin.json");
        let text = fs::read_to_string(&path).unwrap().replacen('{', r#"{"permissions":[{"name":"clipboard:write","reason":"Copy"}],"#, 1);
        fs::write(path, text).unwrap();
    }

    fn set_version(dir: &Path, version: &str) {
        let path = dir.join("plugin.json");
        let text = fs::read_to_string(&path).unwrap().replace("\"1.0.0\"", &format!("\"{version}\""));
        fs::write(path, text).unwrap();
    }

    #[test]
    fn install_copies_the_package_and_records_it() {
        let (data, store) = store();
        let src = package("good-minimal");
        let plugin = store.install_folder(src.path()).unwrap();
        assert_eq!((plugin.id.as_str(), plugin.version.as_str()), ("hello-tool", "1.0.0"));
        assert!(plugin.enabled && !plugin.verified && plugin.granted.is_empty());
        assert_eq!(plugin.source.kind, SourceKind::Folder);
        assert_eq!(plugin.sha256.len(), 64);
        assert!(data.path().join("plugins/hello-tool/index.html").is_file());
        assert!(!data.path().join("plugins/.staging").exists());
        assert_eq!(store.list().unwrap(), vec![plugin]);
    }

    #[test]
    fn hash_follows_the_content() {
        let a = store().1.install_folder(package("good-minimal").path()).unwrap();
        let b = store().1.install_folder(package("good-minimal").path()).unwrap();
        assert_eq!(a.sha256, b.sha256);
        let changed = package("good-minimal");
        fs::write(changed.path().join("index.html"), "<p>other</p>").unwrap();
        let c = store().1.install_folder(changed.path()).unwrap();
        assert_ne!(a.sha256, c.sha256);
    }

    #[test]
    fn reinstall_updates_and_keeps_enabled_and_grants() {
        let (data, store) = store();
        let src = package("good-minimal");
        declare_clipboard(src.path());
        store.install_folder(src.path()).unwrap();
        store.set_enabled("hello-tool", false).unwrap();
        let mut list = store.load().unwrap();
        list[0].granted = vec!["clipboard:write".into()];
        store.save(&list).unwrap();

        set_version(src.path(), "1.1.0");
        fs::write(src.path().join("extra.txt"), "x").unwrap();
        let updated = store.install_folder(src.path()).unwrap();
        assert_eq!(updated.version, "1.1.0");
        assert!(!updated.enabled);
        assert_eq!(updated.granted, vec!["clipboard:write".to_string()]);
        assert_eq!(store.list().unwrap().len(), 1);
        assert!(data.path().join("plugins/hello-tool/extra.txt").is_file());

        fs::remove_file(src.path().join("extra.txt")).unwrap();
        store.install_folder(src.path()).unwrap();
        assert!(!data.path().join("plugins/hello-tool/extra.txt").exists());
    }

    #[test]
    fn inspect_folder_returns_the_manifest_and_installs_nothing() {
        let (data, store) = store();
        let src = package("good-full");
        let preview = store.inspect_folder(src.path()).unwrap();
        assert_eq!(preview.manifest.id, "kafka-inspector");
        assert!(preview.warnings.is_empty());
        assert!(store.list().unwrap().is_empty());
        assert!(!data.path().join("plugins").exists());
    }

    #[test]
    fn inspect_folder_applies_the_install_rules() {
        let (_data, store) = store();
        let src = package("good-minimal");
        let count = fs::read_dir(src.path()).unwrap().count();
        let files = store.inspect_folder_with(src.path(), Limits { max_files: count - 1, max_bytes: MAX_BYTES }).unwrap_err();
        assert!(files.contains("more than"), "{files}");
        let bytes = store.inspect_folder_with(src.path(), Limits { max_files: MAX_FILES, max_bytes: 10 }).unwrap_err();
        assert!(bytes.contains("larger than"), "{bytes}");
        assert!(store.inspect_folder(package("missing-entry").path()).is_err());
        assert!(store.inspect_folder(package("malformed-json").path()).is_err());
    }

    #[test]
    fn uninstall_removes_folder_and_record() {
        let (data, store) = store();
        store.install_folder(package("good-minimal").path()).unwrap();
        store.uninstall("hello-tool").unwrap();
        assert!(store.list().unwrap().is_empty());
        assert!(!data.path().join("plugins/hello-tool").exists());
        assert!(store.uninstall("hello-tool").unwrap_err().contains("not installed"));
    }

    #[test]
    fn uninstall_removes_the_plugins_sdk_storage() {
        let (_dir, store) = store();
        let pkg = package("good-minimal");
        let plugin = store.install_folder(pkg.path()).unwrap();
        super::super::storage::set(&store.root, &plugin.id, "k", Some(serde_json::json!(1))).unwrap();
        store.uninstall(&plugin.id).unwrap();
        assert_eq!(super::super::storage::get(&store.root, &plugin.id, "k").unwrap(), None);
    }

    fn declared(names: &[&str]) -> Manifest {
        let mut manifest = manifest::read(&fixture("good-minimal")).unwrap();
        manifest.permissions = names
            .iter()
            .map(|name| manifest::Permission {
                name: name.to_string(),
                hosts: (*name == "network").then(|| vec!["localhost:9092".to_string()]),
                reason: "r".into(),
                optional: false,
            })
            .collect();
        manifest
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn grants_must_be_declared_and_are_sorted_and_deduped() {
        let manifest = declared(&["clipboard:write", "network", "files:open"]);
        let ok = sanitize_grants(&manifest, &strings(&["network", "clipboard:write", "network", "storage", "network:Broker.Example.com:9093"])).unwrap();
        assert_eq!(ok, strings(&["clipboard:write", "network", "network:broker.example.com:9093"]));
        assert!(sanitize_grants(&manifest, &strings(&["files:save"])).unwrap_err().contains("does not declare"));
        assert!(sanitize_grants(&manifest, &strings(&["nonsense"])).is_err());
        assert!(sanitize_grants(&manifest, &strings(&["network:https://x.com"])).unwrap_err().contains("Not a valid host"));
        // A network host needs the network permission itself.
        let no_net = declared(&["clipboard:write"]);
        assert!(sanitize_grants(&no_net, &strings(&["network:a.com"])).unwrap_err().contains("network"));
    }

    #[test]
    fn set_grants_persists_and_rejects_bad_input_without_changing_anything() {
        let (_data, store) = store();
        let pkg = package("good-minimal");
        declare_clipboard(pkg.path());
        let plugin = store.install_folder(pkg.path()).unwrap();
        assert!(plugin.granted.is_empty());
        let updated = store.set_grants(&plugin.id, &strings(&["clipboard:write"])).unwrap();
        assert_eq!(updated.granted, strings(&["clipboard:write"]));
        assert_eq!(store.list().unwrap()[0].granted, strings(&["clipboard:write"]));
        assert!(store.set_grants(&plugin.id, &strings(&["files:open"])).is_err());
        assert_eq!(store.list().unwrap()[0].granted, strings(&["clipboard:write"]));
        assert!(store.set_grants("nope-tool", &[]).unwrap_err().contains("not installed"));
        assert!(store.set_grants("../x", &[]).unwrap_err().contains("Invalid plugin id"));
        // Revoking everything.
        assert!(store.set_grants(&plugin.id, &[]).unwrap().granted.is_empty());
    }

    #[test]
    fn an_update_that_drops_a_permission_drops_its_grant() {
        let manifest = declared(&["clipboard:write", "network"]);
        let kept = retain_declared(&manifest, &manifest, &strings(&["clipboard:write", "files:open", "network:a.com", "bogus"]));
        assert_eq!(kept, strings(&["clipboard:write", "network:a.com"]));
        let narrowed = declared(&["clipboard:write"]);
        assert_eq!(retain_declared(&manifest, &narrowed, &kept), strings(&["clipboard:write"]));
    }

    #[test]
    fn an_update_that_lists_a_new_network_host_needs_a_new_approval() {
        let old = declared(&["network"]); // hosts: localhost:9092
        let grants = strings(&["network", "network:mine.example.com"]);
        assert_eq!(retain_declared(&old, &old, &grants), grants.clone());
        let mut wider = declared(&["network"]);
        wider.permissions[0].hosts = Some(vec!["localhost:9092".into(), "*.evil.example".into()]);
        // The plain grant is dropped. The host the user added themselves stays.
        assert_eq!(retain_declared(&old, &wider, &grants), strings(&["network:mine.example.com"]));
        // Fewer hosts is fine.
        let mut narrower = declared(&["network"]);
        narrower.permissions[0].hosts = Some(vec!["LOCALHOST:9092".into()]);
        assert_eq!(retain_declared(&old, &narrower, &grants), grants);
    }

    #[test]
    fn set_enabled_persists() {
        let (_data, store) = store();
        store.install_folder(package("good-minimal").path()).unwrap();
        assert!(!store.set_enabled("hello-tool", false).unwrap().enabled);
        assert!(!store.list().unwrap()[0].enabled);
        assert!(store.set_enabled("hello-tool", true).unwrap().enabled);
        assert!(store.set_enabled("nope-tool", true).unwrap_err().contains("not installed"));
    }

    #[test]
    fn ids_from_the_frontend_cannot_leave_the_plugins_folder() {
        let (_data, store) = store();
        assert!(store.uninstall("../x").unwrap_err().contains("Invalid plugin id"));
        assert!(store.set_enabled("../x", true).unwrap_err().contains("Invalid plugin id"));
    }

    #[test]
    fn corrupt_registry_is_backed_up_and_reset() {
        let (data, store) = store();
        fs::write(data.path().join("plugins.json"), "{not json").unwrap();
        assert!(store.list().unwrap().is_empty());
        assert!(!data.path().join("plugins.json").exists());
        let backups: Vec<_> = fs::read_dir(data.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("plugins.json.corrupt-"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read_to_string(backups[0].path()).unwrap(), "{not json");
        // The store works again afterwards.
        store.install_folder(package("good-minimal").path()).unwrap();
        assert_eq!(store.list().unwrap().len(), 1);
    }

    #[test]
    fn an_unreadable_registry_is_an_error_not_an_empty_list() {
        let (data, store) = store();
        // A folder where the file should be: reading it fails with something other than NotFound.
        fs::create_dir(data.path().join("plugins.json")).unwrap();
        assert!(store.list().is_err());
        assert!(store.install_folder(package("good-minimal").path()).is_err());
        assert!(!data.path().join("plugins/hello-tool").exists());
    }

    #[test]
    fn invalid_manifest_is_rejected_and_leaves_nothing() {
        let (data, store) = store();
        let error = store.install_folder(&fixture("bad-id")).unwrap_err();
        assert!(error.contains("id:"), "{error}");
        assert!(store.list().unwrap().is_empty());
        assert!(!data.path().join("plugins/.staging").exists());
    }

    #[test]
    fn too_many_files_or_bytes_is_rejected() {
        let (data, store) = store();
        let src = package("good-minimal");
        for i in 0..3 {
            fs::write(src.path().join(format!("f{i}.txt")), "12345").unwrap();
        }
        let files = store.install_folder_with(src.path(), Limits { max_files: 4, max_bytes: MAX_BYTES }).unwrap_err();
        assert!(files.contains("more than 4 files"), "{files}");
        let bytes = store.install_folder_with(src.path(), Limits { max_files: MAX_FILES, max_bytes: 10 }).unwrap_err();
        assert!(bytes.contains("larger than"), "{bytes}");
        assert!(store.list().unwrap().is_empty());
        assert!(!data.path().join("plugins/hello-tool").exists());
        store.install_folder_with(src.path(), Limits { max_files: 5, max_bytes: MAX_BYTES }).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_skipped_with_a_warning() {
        let (data, store) = store();
        let src = package("good-minimal");
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), src.path().join("link.txt")).unwrap();
        let plugin = store.install_folder(src.path()).unwrap();
        assert_eq!(plugin.warnings.len(), 1);
        assert!(plugin.warnings[0].contains("link.txt"));
        assert!(!data.path().join("plugins/hello-tool/link.txt").exists());
        assert!(store.list().unwrap()[0].warnings.is_empty());
        assert!(!fs::read_to_string(data.path().join("plugins.json")).unwrap().contains("warnings"));
    }

    #[cfg(unix)]
    #[test]
    fn an_entry_that_is_a_link_is_rejected() {
        let (_data, store) = store();
        let src = package("good-minimal");
        let real = src.path().join("real.html");
        fs::rename(src.path().join("index.html"), &real).unwrap();
        std::os::unix::fs::symlink(&real, src.path().join("index.html")).unwrap();
        let error = store.install_folder(src.path()).unwrap_err();
        assert!(error.contains("entry:"), "{error}");
        assert!(store.list().unwrap().is_empty());
    }
}
