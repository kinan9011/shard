//! Install and update from repositories (W11). A package listed by a repository is downloaded into
//! `plugins/.downloads`, its SHA-256 (and length) must equal what the index says, and only then does it go
//! through the zip pipeline of W9. A repository install is the only one recorded as `verified`.
//! A URL that is not one of the repositories is a sideload: it needs the `allowOutside` setting and stays unverified.

use super::fetch::describe;
use super::manifest::{Manifest, Permission};
use super::repos::{client_builder, repos, CatalogEntry, IndexEntry, RepoKind, Repos};
use super::store::{locked, unique_name, InstalledPlugin, Source, SourceKind, Store, LIMITS, MAX_BYTES};
use super::zip::{check_sha, hex, ZIP_OVERHEAD};
use crate::folder_compare::blocking;
use crate::paths::io_err;
use semver::Version;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Per read, not for the whole download: a big package on a slow line may take longer than any fixed total.
const READ_TIMEOUT: Duration = Duration::from_secs(30);
/// A progress event every this many bytes (and one at the end).
const PROGRESS_STEP: u64 = 256 * 1024;

pub const PROGRESS_EVENT: &str = "plugin://progress";

/// The payload of `plugin://progress`. `total` is unknown when the server sends no length and the index no size.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Progress {
    pub id: String,
    pub received: u64,
    pub total: Option<u64>,
}

/// An installed plugin that has a newer version in the repository it came from.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginUpdate {
    pub id: String,
    pub name: String,
    pub from: String,
    pub to: String,
    pub changelog: Option<String>,
    /// Permissions the new version asks for that the installed one did not (`network` also when it lists a new host).
    pub new_permissions: Vec<String>,
    pub repo: String,
}

/// What the install dialog shows for a pasted repository URL.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UrlPreview {
    /// The plugin as the repository lists it. `size` is the size of the download.
    #[serde(flatten)]
    pub entry: IndexEntry,
    pub repo: String,
    pub repo_name: String,
    pub kind: RepoKind,
    /// The downloaded package hashes to the checksum the repository lists.
    pub checksum_matches: bool,
    /// The repository is already in the list and turned on.
    pub repo_added: bool,
}

/// A downloaded package. The file is deleted when this is dropped, whatever happened.
struct Download {
    path: PathBuf,
    sha256: String,
    size: u64,
}

impl Drop for Download {
    fn drop(&mut self) {
        // The folder stays: another download may be using it right now.
        let _ = fs::remove_file(&self.path);
    }
}

fn too_big() -> String {
    format!("The package is larger than {} MB.", MAX_BYTES / (1024 * 1024))
}

/// The permission names a plugin asks for, with one `network:<host>` entry per listed host.
fn signature(permissions: &[Permission]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for permission in permissions {
        out.insert(permission.name.clone());
        if permission.name == "network" {
            out.extend(permission.hosts.iter().flatten().map(|host| format!("network:{}", host.to_ascii_lowercase())));
        }
    }
    out
}

/// What an update asks for on top of the installed version, as permission names.
fn new_permissions(installed: &Manifest, entry: &IndexEntry) -> Vec<String> {
    let before = signature(&installed.permissions);
    let names: BTreeSet<String> =
        signature(&entry.permissions).difference(&before).map(|p| if p.starts_with("network:") { "network".to_string() } else { p.clone() }).collect();
    names.into_iter().collect()
}

/// The minimum app version of `entry` when this app is older than it.
fn needs_newer_app(entry: &IndexEntry, app: &Version) -> Option<Version> {
    entry.min_app_version.as_deref().and_then(|min| Version::parse(min).ok()).filter(|min| min > app)
}

/// The repository's entry for an installed plugin when it is a repository install and the entry is newer (semver).
fn newer_entry<'a>(plugin: &InstalledPlugin, catalog: &'a [CatalogEntry]) -> Option<&'a CatalogEntry> {
    let repo = plugin.source.repo.as_deref().filter(|_| plugin.source.kind == SourceKind::Repo)?;
    let found = catalog.iter().find(|c| c.repo == repo && c.entry.id == plugin.id)?;
    (Version::parse(&found.entry.version).ok()? > Version::parse(&plugin.version).ok()?).then_some(found)
}

/// The updates to offer. One that needs a newer app than this one is left out.
fn compute_updates(installed: &[InstalledPlugin], catalog: &[CatalogEntry], app: &Version) -> Vec<PluginUpdate> {
    let mut updates: Vec<PluginUpdate> = installed
        .iter()
        .filter_map(|plugin| {
            let found = newer_entry(plugin, catalog).filter(|found| needs_newer_app(&found.entry, app).is_none())?;
            Some(PluginUpdate {
                id: plugin.id.clone(),
                name: found.entry.name.clone(),
                from: plugin.version.clone(),
                to: found.entry.version.clone(),
                changelog: found.entry.changelog.clone(),
                new_permissions: new_permissions(&plugin.manifest, &found.entry),
                repo: found.repo.clone(),
            })
        })
        .collect();
    updates.sort_by(|a, b| a.id.cmp(&b.id));
    updates
}

/// The one plugin of a repository that is installed from a URL.
fn single(entries: &[IndexEntry]) -> Result<IndexEntry, String> {
    match entries {
        [one] => Ok(one.clone()),
        [] => Err("This repository lists no plugins.".into()),
        many => Err(format!("This repository lists {} plugins. Add it as a repository to browse them.", many.len())),
    }
}

type Report = Arc<dyn Fn(Progress) + Send + Sync>;

pub struct Installer {
    store: Store,
    repos: Repos,
    app_version: Version,
    report: Report,
}

impl Installer {
    pub fn new(store: Store, repos: Repos, app_version: Version, report: Report) -> Self {
        Installer { store, repos, app_version, report }
    }

    /// Downloads the package of `entry` into `plugins/.downloads`, hashing as it goes.
    // ponytail: writes with std::fs inside the async loop (small chunks, local disk). Use spawn_blocking per chunk if that ever stalls the runtime.
    // A crash mid-download leaves a file in `.downloads`; nothing sweeps it yet.
    async fn download(&self, entry: &IndexEntry, report: bool) -> Result<Download, String> {
        let limit = MAX_BYTES + ZIP_OVERHEAD;
        if entry.size.is_some_and(|size| size > limit) {
            return Err(too_big());
        }
        let cap = entry.size.unwrap_or(limit);
        let dir = self.store.downloads_dir();
        fs::create_dir_all(&dir).map_err(io_err)?;
        let mut download = Download { path: dir.join(format!("{}.zip", unique_name("dl-"))), sha256: String::new(), size: 0 };

        let client = client_builder().connect_timeout(CONNECT_TIMEOUT).read_timeout(READ_TIMEOUT).build().map_err(|error| error.to_string())?;
        let mut response = client.get(&entry.url).send().await.map_err(describe)?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err("The package was not found (404).".into());
        }
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        let total = response.content_length().or(entry.size);
        let emit = |received: u64, total: Option<u64>| {
            if report {
                (self.report)(Progress { id: entry.id.clone(), received, total });
            }
        };

        let mut file = fs::File::create(&download.path).map_err(io_err)?;
        let (mut hasher, mut received, mut reported) = (Sha256::new(), 0u64, 0u64);
        while let Some(chunk) = response.chunk().await.map_err(describe)? {
            received += chunk.len() as u64;
            if received > cap {
                return Err(match entry.size {
                    Some(size) => format!("The download is larger than the repository lists ({size} bytes)."),
                    None => too_big(),
                });
            }
            hasher.update(&chunk);
            file.write_all(&chunk).map_err(io_err)?;
            if received - reported >= PROGRESS_STEP {
                reported = received;
                emit(received, total);
            }
        }
        file.flush().map_err(io_err)?;
        if let Some(size) = entry.size.filter(|size| *size != received) {
            return Err(format!("The download is {received} bytes, but the repository lists {size}."));
        }
        emit(received, total.or(Some(received)));
        download.sha256 = hex(&hasher.finalize());
        download.size = received;
        Ok(download)
    }

    /// Downloads, checks and installs one listed plugin. `source` says where it is recorded as coming from.
    async fn install_entry(&self, entry: &IndexEntry, source: Source) -> Result<InstalledPlugin, String> {
        if let Some(min) = needs_newer_app(entry, &self.app_version) {
            return Err(format!("Requires Shard {min}"));
        }
        let download = self.download(entry, true).await?;
        check_sha(&download.sha256, Some(&entry.sha256))?;
        let (path, sha256) = (download.path.clone(), download.sha256.clone());
        let (id, version, listed) = (entry.id.clone(), entry.version.clone(), signature(&entry.permissions));
        let installed = locked(self.store.clone(), move |store| {
            // The index is what the user was shown. The package has to be the same plugin and ask for nothing more.
            let check = |manifest: &Manifest| -> Result<(), String> {
                if manifest.id != id || manifest.version != version {
                    return Err(format!("The package is {} {}, but the repository lists {id} {version}.", manifest.id, manifest.version));
                }
                let extra: Vec<String> = signature(&manifest.permissions).difference(&listed).cloned().collect();
                if extra.is_empty() {
                    Ok(())
                } else {
                    Err(format!("The package asks for permissions the repository did not list: {}.", extra.join(", ")))
                }
            };
            store.install_zip_as(&path, Some(&sha256), LIMITS, source, Some(&check))
        })
        .await;
        // The downloaded file goes now, whatever the outcome.
        drop(download);
        installed
    }

    pub async fn install_from_repo(&self, repo: &str, id: &str) -> Result<InstalledPlugin, String> {
        let repos = self.repos.clone();
        let (repo, id) = (repo.to_string(), id.to_string());
        let (url, entry) = blocking(move || repos.entry(&repo, &id)).await?;
        self.install_entry(&entry, Source { kind: SourceKind::Repo, repo: Some(url), url: None }).await
    }

    /// What a pasted URL points at, without installing or adding anything. It downloads the package once,
    /// to know its size and whether the checksum matches.
    pub async fn lookup_url(&self, text: &str) -> Result<UrlPreview, String> {
        let (url, kind, index) = self.repos.detect(text).await?;
        let entry = single(&index.plugins)?;
        let download = self.download(&entry, false).await?;
        let checksum_matches = download.sha256.eq_ignore_ascii_case(&entry.sha256);
        let repo_added = self.repos.enabled_url(&url)?.is_some();
        Ok(UrlPreview { entry: IndexEntry { size: Some(download.size), ..entry }, repo: url, repo_name: index.name, kind, checksum_matches, repo_added })
    }

    /// Installs the plugin a URL points at. A repository that is listed and on counts as a repository install.
    /// Otherwise `add_repo` adds it first, and without that it is a sideload that needs `allowOutside`.
    pub async fn install_from_url(&self, text: &str, add_repo: bool) -> Result<InstalledPlugin, String> {
        let listed = self.repos.enabled_url(text)?.is_some();
        if !listed && !add_repo {
            self.repos.require_outside()?;
        }
        let (url, _kind, index) = self.repos.detect(text).await?;
        let entry = single(&index.plugins)?;
        if listed {
            return self.install_entry(&entry, Source { kind: SourceKind::Repo, repo: Some(url), url: None }).await;
        }
        if !add_repo {
            return self.install_entry(&entry, Source { kind: SourceKind::Url, repo: None, url: Some(url) }).await;
        }
        self.repos.add(&url).await?;
        let installed = self.install_entry(&entry, Source { kind: SourceKind::Repo, repo: Some(url.clone()), url: None }).await;
        if installed.is_err() {
            // The user asked for the plugin with its repository. Without the plugin, keep the list as it was.
            let _ = self.repos.remove(&url);
        }
        installed
    }

    async fn snapshot(&self) -> Result<(Vec<InstalledPlugin>, Vec<CatalogEntry>), String> {
        let installed = locked(self.store.clone(), |store| store.list()).await?;
        let repos = self.repos.clone();
        let catalog = blocking(move || repos.catalog()).await?;
        Ok((installed, catalog))
    }

    pub async fn updates(&self) -> Result<Vec<PluginUpdate>, String> {
        let (installed, catalog) = self.snapshot().await?;
        Ok(compute_updates(&installed, &catalog, &self.app_version))
    }

    /// Installs the newer version. The grants the plugin has stay; a permission it newly asks for is not granted
    /// until `plugin_set_grants` says so.
    pub async fn update(&self, id: &str) -> Result<InstalledPlugin, String> {
        let (installed, catalog) = self.snapshot().await?;
        let plugin = installed.iter().find(|p| p.id == id).ok_or_else(|| format!("Plugin is not installed: {id}"))?;
        let found = newer_entry(plugin, &catalog).ok_or_else(|| format!("{id} is already up to date."))?;
        self.install_entry(&found.entry, Source { kind: SourceKind::Repo, repo: Some(found.repo.clone()), url: None }).await
    }
}

fn installer(app: &tauri::AppHandle) -> Result<Installer, String> {
    use tauri::{Emitter, Manager};
    let root = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let version = Version::parse(&app.package_info().version.to_string()).map_err(|error| format!("The app version is not semver: {error}"))?;
    let handle = app.clone();
    let report: Report = Arc::new(move |progress| {
        let _ = handle.emit(PROGRESS_EVENT, progress);
    });
    Ok(Installer::new(Store::new(root.clone()), repos(app)?, version, report))
}

#[tauri::command]
pub async fn plugin_install_from_repo(app: tauri::AppHandle, repo_url: String, id: String) -> Result<InstalledPlugin, String> {
    installer(&app)?.install_from_repo(&repo_url, &id).await
}

#[tauri::command]
pub async fn plugin_lookup_url(app: tauri::AppHandle, url: String) -> Result<UrlPreview, String> {
    installer(&app)?.lookup_url(&url).await
}

#[tauri::command]
pub async fn plugin_install_from_url(app: tauri::AppHandle, url: String, add_repo: bool) -> Result<InstalledPlugin, String> {
    installer(&app)?.install_from_url(&url, add_repo).await
}

#[tauri::command]
pub async fn plugin_updates(app: tauri::AppHandle) -> Result<Vec<PluginUpdate>, String> {
    installer(&app)?.updates().await
}

#[tauri::command]
pub async fn plugin_update(app: tauri::AppHandle, id: String) -> Result<InstalledPlugin, String> {
    installer(&app)?.update(&id).await
}

/// At start: when `checkOnStart` is on, syncs every repository in the background and emits `plugins://updates`
/// with the number of updates. The window may not be listening yet, so the UI also asks `plugin_updates` when it opens.
#[cfg(not(feature = "e2e"))]
pub fn check_on_start(app: tauri::AppHandle) {
    use tauri::Emitter;
    // The count goes out as a number, for the badge and the "Updates available" tab.
    const UPDATES_EVENT: &str = "plugins://updates";
    tauri::async_runtime::spawn(async move {
        let Ok(installer) = installer(&app) else { return };
        if !installer.repos.state().is_ok_and(|state| state.check_on_start) || installer.repos.sync(None).await.is_err() {
            return;
        }
        if let Ok(updates) = installer.updates().await {
            let _ = app.emit(UPDATES_EVENT, updates.len());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::mock::Mock;
    use serde_json::{json, Value};
    use std::sync::Mutex;
    use zip::write::SimpleFileOptions;

    const ID: &str = "kafka-inspector";
    const URL: &str = "https://github.com/acme/tools";

    struct World {
        mock: Mock,
        dir: tempfile::TempDir,
        installer: Installer,
        repos: Repos,
        store: Store,
        progress: Arc<Mutex<Vec<Progress>>>,
    }

    fn world() -> World {
        let mock = Mock::start();
        let (dir, repos) = mock.repos();
        let store = Store::new(dir.path().to_path_buf());
        let progress: Arc<Mutex<Vec<Progress>>> = Arc::default();
        let sink = progress.clone();
        let report: Report = Arc::new(move |p| sink.lock().unwrap().push(p));
        let installer = Installer::new(store.clone(), repos.clone(), Version::parse("2.8.0").unwrap(), report);
        World { mock, dir, installer, repos, store, progress }
    }

    fn perm(name: &str) -> Value {
        json!({ "name": name, "reason": "Because" })
    }

    fn network(hosts: &[&str]) -> Value {
        json!({ "name": "network", "hosts": hosts, "reason": "Because" })
    }

    /// What a test publishes: the package's own manifest, and what the index says about it (by default the same).
    #[derive(Clone)]
    struct Spec {
        version: &'static str,
        permissions: Vec<Value>,
        min_app: Option<&'static str>,
        changelog: Option<&'static str>,
        listed_version: Option<&'static str>,
        listed_permissions: Option<Vec<Value>>,
        sha: Option<String>,
        size_delta: i64,
    }

    fn spec(version: &'static str) -> Spec {
        Spec { version, permissions: vec![], min_app: None, changelog: None, listed_version: None, listed_permissions: None, sha: None, size_delta: 0 }
    }

    fn sha_hex(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    fn zip_of(manifest: &Value) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        writer.start_file("plugin.json", options).unwrap();
        writer.write_all(manifest.to_string().as_bytes()).unwrap();
        writer.start_file("index.html", options).unwrap();
        writer.write_all(b"<p>hi</p>").unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn manifest(id: &str, version: &str, permissions: &[Value]) -> Value {
        json!({ "id": id, "name": "Kafka Inspector", "version": version, "description": "Browse topics.", "entry": "index.html", "runtime": "web", "permissions": permissions })
    }

    /// Serves the package and an index listing it (the only plugin). Returns the package's real checksum.
    fn serve(w: &World, spec: &Spec) -> String {
        let zip = zip_of(&manifest(ID, spec.version, &spec.permissions));
        let sha = sha_hex(&zip);
        let path = format!("/pkg/{}.zip", spec.version);
        let size = (zip.len() as i64 + spec.size_delta) as u64;
        w.mock.set(&path, 200, zip);
        let mut entry = json!({
            "id": ID, "name": "Kafka Inspector", "version": spec.listed_version.unwrap_or(spec.version), "description": "Browse topics.", "runtime": "web",
            "permissions": spec.listed_permissions.clone().unwrap_or_else(|| spec.permissions.clone()),
            "url": w.mock.url(&path), "sha256": spec.sha.clone().unwrap_or_else(|| sha.clone()), "size": size, "released": "2026-10-18"
        });
        if let Some(min) = spec.min_app {
            entry["minAppVersion"] = json!(min);
        }
        if let Some(changelog) = spec.changelog {
            entry["changelog"] = json!(changelog);
        }
        w.mock.set("/raw/acme/tools/HEAD/index.json", 200, json!({ "schema": 1, "name": "Acme", "plugins": [entry] }).to_string());
        sha
    }

    fn run<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn add_repo(w: &World) {
        run(w.repos.add(URL)).unwrap();
    }

    fn sync(w: &World) {
        run(w.repos.sync(Some(URL))).unwrap();
    }

    fn assert_nothing_installed(w: &World) {
        assert!(w.store.list().unwrap().is_empty());
        for left in ["plugins/kafka-inspector", "plugins/.staging"] {
            assert!(!w.dir.path().join(left).exists(), "{left} is still there");
        }
        assert_no_downloads(w);
    }

    /// `.downloads` may exist, but it holds no package.
    fn assert_no_downloads(w: &World) {
        let left = fs::read_dir(w.dir.path().join("plugins/.downloads")).map(|dir| dir.count()).unwrap_or(0);
        assert_eq!(left, 0, "a downloaded package is still there");
    }

    #[test]
    fn installs_from_a_repository_and_records_it_as_verified() {
        let w = world();
        let sha = serve(&w, &spec("1.0.0"));
        add_repo(&w);
        let plugin = run(w.installer.install_from_repo("github.com/Acme/Tools", ID)).unwrap();
        assert_eq!((plugin.id.as_str(), plugin.version.as_str(), plugin.verified, plugin.enabled), (ID, "1.0.0", true, true));
        assert_eq!((plugin.source.kind, plugin.source.repo.as_deref(), plugin.sha256.as_str()), (SourceKind::Repo, Some(URL), sha.as_str()));
        assert!(w.dir.path().join("plugins/kafka-inspector/index.html").is_file());
        assert!(!w.dir.path().join("plugins/.staging").exists());
        assert_no_downloads(&w);
        assert_eq!(w.store.list().unwrap(), vec![plugin]);
        let events = w.progress.lock().unwrap();
        let last = events.last().unwrap();
        assert_eq!((last.id.as_str(), last.total), (ID, Some(last.received)));
        assert!(last.received > 0);
        // A repository that is not in the list, or an unknown plugin id, is an error.
        drop(events);
        assert!(run(w.installer.install_from_repo("github.com/other/repo", ID)).unwrap_err().contains("not in the list"));
        assert!(run(w.installer.install_from_repo(URL, "nope-tool")).unwrap_err().contains("not listed"));
    }

    #[test]
    fn a_checksum_or_size_mismatch_installs_nothing_and_leaves_no_files() {
        let w = world();
        serve(&w, &Spec { sha: Some("0".repeat(64)), ..spec("1.0.0") });
        add_repo(&w);
        let error = run(w.installer.install_from_repo(URL, ID)).unwrap_err();
        assert!(error.contains("checksum does not match"), "{error}");
        assert_nothing_installed(&w);

        serve(&w, &Spec { size_delta: 1, ..spec("1.0.0") });
        sync(&w);
        let error = run(w.installer.install_from_repo(URL, ID)).unwrap_err();
        assert!(error.contains("bytes, but the repository lists"), "{error}");
        assert_nothing_installed(&w);

        serve(&w, &Spec { size_delta: -1, ..spec("1.0.0") });
        sync(&w);
        let error = run(w.installer.install_from_repo(URL, ID)).unwrap_err();
        assert!(error.contains("larger than the repository lists"), "{error}");
        assert_nothing_installed(&w);

        w.mock.set("/pkg/1.0.0.zip", 404, "");
        sync(&w);
        assert!(run(w.installer.install_from_repo(URL, ID)).unwrap_err().contains("not found (404)"));
        assert_nothing_installed(&w);
    }

    #[test]
    fn a_package_that_is_not_what_the_index_listed_is_refused() {
        let w = world();
        // Right checksum (of this package), but the package is another version than the index says.
        serve(&w, &Spec { listed_version: Some("1.0.1"), ..spec("1.0.0") });
        add_repo(&w);
        let error = run(w.installer.install_from_repo(URL, ID)).unwrap_err();
        assert!(error.contains("1.0.0, but the repository lists kafka-inspector 1.0.1"), "{error}");
        assert_nothing_installed(&w);
        // The package asks for more than the index shows.
        serve(&w, &Spec { permissions: vec![perm("files:open"), network(&["evil.example.com"])], listed_permissions: Some(vec![perm("files:open")]), ..spec("1.0.0") });
        sync(&w);
        let error = run(w.installer.install_from_repo(URL, ID)).unwrap_err();
        assert!(error.contains("did not list: network, network:evil.example.com"), "{error}");
        assert_nothing_installed(&w);
    }

    #[test]
    fn an_update_reports_new_permissions_and_keeps_the_old_grants() {
        let w = world();
        serve(&w, &Spec { permissions: vec![perm("files:open")], ..spec("1.0.0") });
        add_repo(&w);
        run(w.installer.install_from_repo(URL, ID)).unwrap();
        w.store.set_grants(ID, &["files:open".to_string()]).unwrap();
        assert!(run(w.installer.updates()).unwrap().is_empty());
        assert!(run(w.installer.update(ID)).unwrap_err().contains("already up to date"));

        serve(&w, &Spec { permissions: vec![perm("files:open"), perm("clipboard:write"), network(&["a.example.com"])], changelog: Some("Adds clipboard"), ..spec("1.1.0") });
        sync(&w);
        let updates = run(w.installer.updates()).unwrap();
        assert_eq!(
            updates,
            vec![PluginUpdate {
                id: ID.into(),
                name: "Kafka Inspector".into(),
                from: "1.0.0".into(),
                to: "1.1.0".into(),
                changelog: Some("Adds clipboard".into()),
                new_permissions: vec!["clipboard:write".into(), "network".into()],
                repo: URL.into(),
            }]
        );
        let wire = serde_json::to_value(&updates[0]).unwrap();
        assert_eq!(wire["newPermissions"], json!(["clipboard:write", "network"]));
        let updated = run(w.installer.update(ID)).unwrap();
        assert_eq!((updated.version.as_str(), updated.verified, updated.source.kind), ("1.1.0", true, SourceKind::Repo));
        assert_eq!(updated.granted, vec!["files:open".to_string()], "the new permissions are not granted");
        assert!(run(w.installer.updates()).unwrap().is_empty());

        // The same host again is nothing new. A second host is.
        let hosts = |list: &[&str]| Spec { permissions: vec![perm("files:open"), perm("clipboard:write"), network(list)], ..spec("1.2.0") };
        serve(&w, &hosts(&["a.example.com"]));
        sync(&w);
        assert!(run(w.installer.updates()).unwrap()[0].new_permissions.is_empty());
        serve(&w, &hosts(&["a.example.com", "b.example.com"]));
        sync(&w);
        assert_eq!(run(w.installer.updates()).unwrap()[0].new_permissions, vec!["network".to_string()]);
    }

    #[test]
    fn a_version_that_is_not_newer_is_not_an_update() {
        let w = world();
        serve(&w, &spec("1.10.0"));
        add_repo(&w);
        run(w.installer.install_from_repo(URL, ID)).unwrap();
        // 1.9.0 sorts after 1.10.0 as text, but it is older.
        serve(&w, &spec("1.9.0"));
        sync(&w);
        assert!(run(w.installer.updates()).unwrap().is_empty());
        assert!(run(w.installer.update(ID)).unwrap_err().contains("already up to date"));
    }

    #[test]
    fn a_plugin_that_needs_a_newer_app_cannot_be_installed_and_its_update_is_hidden() {
        let w = world();
        serve(&w, &Spec { min_app: Some("3.0.0"), ..spec("1.0.0") });
        add_repo(&w);
        assert_eq!(run(w.installer.install_from_repo(URL, ID)).unwrap_err(), "Requires Shard 3.0.0");
        assert_nothing_installed(&w);

        serve(&w, &spec("1.0.0"));
        sync(&w);
        run(w.installer.install_from_repo(URL, ID)).unwrap();
        serve(&w, &Spec { min_app: Some("9.0.0"), ..spec("1.1.0") });
        sync(&w);
        assert!(run(w.installer.updates()).unwrap().is_empty());
        assert_eq!(run(w.installer.update(ID)).unwrap_err(), "Requires Shard 9.0.0");
        assert_eq!(w.store.list().unwrap()[0].version, "1.0.0");
        // The same version, when the app is new enough.
        serve(&w, &Spec { min_app: Some("2.8.0"), ..spec("1.1.0") });
        sync(&w);
        assert_eq!(run(w.installer.updates()).unwrap().len(), 1);
    }

    #[test]
    fn updates_only_come_from_the_repository_that_installed_the_plugin() {
        let w = world();
        serve(&w, &spec("1.0.0"));
        add_repo(&w);
        run(w.installer.install_from_repo(URL, ID)).unwrap();
        serve(&w, &spec("1.1.0"));
        sync(&w);
        assert_eq!(run(w.installer.updates()).unwrap().len(), 1);
        w.repos.set_enabled(URL, false).unwrap();
        assert!(run(w.installer.updates()).unwrap().is_empty(), "a repository that is off offers nothing");
        // A sideload has no repository to update from.
        w.repos.set_enabled(URL, true).unwrap();
        w.store.uninstall(ID).unwrap();
        let package = w.dir.path().join("pkg.zip");
        fs::write(&package, zip_of(&manifest(ID, "1.0.0", &[]))).unwrap();
        w.store.install_zip(&package, None).unwrap();
        assert!(run(w.installer.updates()).unwrap().is_empty());
    }

    #[test]
    fn a_url_outside_the_repositories_needs_allow_outside_and_stays_unverified() {
        let w = world();
        serve(&w, &spec("1.0.0"));
        let error = run(w.installer.install_from_url("github.com/acme/tools", false)).unwrap_err();
        assert!(error.contains("outside your repositories"), "{error}");
        assert_nothing_installed(&w);
        assert!(w.repos.require_outside().is_err());

        assert_eq!(w.repos.set_settings(None, Some(true)).unwrap(), crate::plugins::repos::RepoSettings { check_on_start: true, allow_outside: true });
        let plugin = run(w.installer.install_from_url("github.com/acme/tools", false)).unwrap();
        assert_eq!((plugin.source.kind, plugin.source.url.as_deref(), plugin.source.repo.as_deref(), plugin.verified), (SourceKind::Url, Some(URL), None, false));
        assert_eq!(w.repos.list().unwrap().len(), 1, "the repository was not added");
        assert!(run(w.installer.updates()).unwrap().is_empty());

        // The setting persists, and each switch changes on its own.
        let saved = w.repos.set_settings(Some(false), None).unwrap();
        assert_eq!((saved.check_on_start, saved.allow_outside), (false, true));
        assert_eq!(w.repos.settings().unwrap(), saved);
    }

    #[test]
    fn a_url_with_add_repo_works_with_the_gate_closed_and_a_failure_does_not_leave_the_repository() {
        let w = world();
        serve(&w, &Spec { sha: Some("0".repeat(64)), ..spec("1.0.0") });
        assert!(run(w.installer.install_from_url(URL, true)).unwrap_err().contains("checksum does not match"));
        assert_eq!(w.repos.list().unwrap().len(), 1, "the repository went again");
        assert!(!w.repos.cache_path(URL).exists());
        assert_nothing_installed(&w);

        serve(&w, &spec("1.0.0"));
        let plugin = run(w.installer.install_from_url(URL, true)).unwrap();
        assert_eq!((plugin.source.kind, plugin.source.repo.as_deref(), plugin.verified), (SourceKind::Repo, Some(URL), true));
        assert_eq!(w.repos.list().unwrap().len(), 2);
        // It is a repository now: updates come, and a URL install of it needs no gate.
        serve(&w, &spec("1.1.0"));
        sync(&w);
        assert_eq!(run(w.installer.updates()).unwrap().len(), 1);
        assert!(!w.repos.settings().unwrap().allow_outside);
        let again = run(w.installer.install_from_url("https://github.com/Acme/Tools.git", false)).unwrap();
        assert_eq!((again.version.as_str(), again.verified), ("1.1.0", true));
        // Adding a repository that is already there is fine.
        assert!(run(w.installer.install_from_url(URL, true)).is_ok());
        assert_eq!(w.repos.list().unwrap().len(), 2);
    }

    #[test]
    fn lookup_previews_a_releases_repository_and_checks_the_checksum() {
        let w = world();
        let zip = zip_of(&json!({ "id": "solo-tool", "name": "Solo", "version": "1.2.0", "description": "One tool.", "entry": "index.html", "runtime": "web" }));
        let base = "/gh/acme/tools/releases/latest/download";
        w.mock.set(&format!("{base}/plugin.json"), 200, json!({ "id": "solo-tool", "name": "Solo", "version": "1.2.0", "description": "One tool.", "entry": "index.html", "runtime": "web" }).to_string());
        w.mock.set(&format!("{base}/plugin.zip"), 200, zip.clone());
        w.mock.set(&format!("{base}/plugin.zip.sha256"), 200, format!("{}  plugin.zip\n", sha_hex(&zip)));
        let preview = run(w.installer.lookup_url("https://github.com/acme/tools")).unwrap();
        assert_eq!((preview.entry.id.as_str(), preview.entry.version.as_str(), preview.kind), ("solo-tool", "1.2.0", RepoKind::Releases));
        assert_eq!((preview.entry.size, preview.checksum_matches, preview.repo_added), (Some(zip.len() as u64), true, false));
        assert_eq!((preview.repo.as_str(), preview.repo_name.as_str()), (URL, "acme/tools"));
        let wire = serde_json::to_value(&preview).unwrap();
        assert_eq!((wire["checksumMatches"].as_bool(), wire["repoName"].as_str(), wire["kind"].as_str(), wire["runtime"].as_str()), (Some(true), Some("acme/tools"), Some("releases"), Some("web")));
        assert_nothing_installed(&w);
        assert_eq!(w.repos.list().unwrap().len(), 1, "a lookup adds nothing");

        w.mock.set(&format!("{base}/plugin.zip.sha256"), 200, format!("{}  plugin.zip\n", "0".repeat(64)));
        assert!(!run(w.installer.lookup_url(URL)).unwrap().checksum_matches);
        assert_no_downloads(&w);
    }

    #[test]
    fn lookup_refuses_a_repository_with_many_plugins_and_something_that_is_not_one() {
        let w = world();
        let entry = |id: &str| json!({ "id": id, "name": "X", "version": "1.0.0", "description": "d", "runtime": "web", "url": w.mock.url("/pkg/x.zip"), "sha256": "a".repeat(64), "size": 1 });
        w.mock.set("/raw/acme/tools/HEAD/index.json", 200, json!({ "schema": 1, "name": "Acme", "plugins": [entry("one-tool"), entry("two-tool")] }).to_string());
        let error = run(w.installer.lookup_url(URL)).unwrap_err();
        assert!(error.contains("lists 2 plugins"), "{error}");
        let error = run(w.installer.install_from_url(URL, true)).unwrap_err();
        assert!(error.contains("lists 2 plugins"), "{error}");
        assert_eq!(w.repos.list().unwrap().len(), 1);
        assert_eq!(run(w.installer.lookup_url("https://example.com/x")).unwrap_err(), "Not a GitHub repository URL: https://example.com/x");
        w.mock.set("/raw/acme/tools/HEAD/index.json", 404, "");
        assert_eq!(run(w.installer.lookup_url(URL)).unwrap_err(), "Not a plugin repository");
    }
}
