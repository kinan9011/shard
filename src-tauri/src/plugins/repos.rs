//! Plugin repositories (W10): `repos.json` (the list plus two settings), type detection, and sync into
//! `repo-cache/<hash>.json`. Two repository shapes exist (see `docs/plugins/index-format.md`): an
//! `index.json` at the repo root, or a single plugin published as GitHub Releases. Detection uses plain
//! file downloads, never the GitHub API (60 requests an hour without a token).
//! Both shapes are cached as the same `Index`, so the catalog does not care which one a repo is.

use super::fetch::{describe, ensure_crypto_provider};
use super::manifest::{permission_errors, valid_id, valid_version, Manifest, Permission, Runtime};
use crate::folder_compare::blocking;
use crate::paths::io_err;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;

pub const OFFICIAL_URL: &str = "https://github.com/kinan9011/shard-plugins";
pub const THEMES_URL: &str = "https://github.com/kinan9011/shard-themes";
/// The repositories every install has, with the name shown until the first sync reads the index's own. They can be turned off, not removed.
pub(super) const BUILT_IN: [(&str, &str); 2] = [(OFFICIAL_URL, "kinan9011/shard-plugins"), (THEMES_URL, "kinan9011/shard-themes")];
const STATE_FILE: &str = "repos.json";
const CACHE_DIR: &str = "repo-cache";
const RAW_BASE: &str = "https://raw.githubusercontent.com";
const GITHUB_BASE: &str = "https://github.com";
const MAX_REDIRECTS: usize = 5;
const TIMEOUT: Duration = Duration::from_secs(30);
/// An index is a list of plugin descriptions; 5 MB is far more than any real one.
const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RepoKind {
    Index,
    Releases,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    /// Canonical `https://github.com/<owner>/<repo>`, lowercase. The key for every command.
    pub url: String,
    pub name: String,
    /// `None` until the first successful sync detects it.
    #[serde(rename = "type", default)]
    pub kind: Option<RepoKind>,
    pub enabled: bool,
    /// Epoch milliseconds of the last successful sync.
    #[serde(default)]
    pub last_sync: Option<u64>,
    #[serde(default)]
    pub last_error: Option<String>,
    /// A built-in repository (see `BUILT_IN`) can be turned off but not removed.
    #[serde(default)]
    pub official: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RepoState {
    pub check_on_start: bool,
    pub allow_outside: bool,
    pub repos: Vec<Repo>,
}

impl Default for RepoState {
    fn default() -> Self {
        RepoState { check_on_start: true, allow_outside: false, repos: BUILT_IN.iter().map(|(url, name)| built_in_repo(url, name)).collect() }
    }
}

/// The two switches in `repos.json`.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoSettings {
    pub check_on_start: bool,
    pub allow_outside: bool,
}

fn built_in_repo(url: &str, name: &str) -> Repo {
    Repo {
        url: url.to_string(),
        name: name.to_string(),
        kind: None,
        enabled: true,
        last_sync: None,
        last_error: None,
        official: true,
    }
}

/// One plugin as the repository describes it. Same shape as an `index.json` entry.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub runtime: Runtime,
    #[serde(default)]
    pub permissions: Vec<Permission>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_app_version: Option<String>,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub sha256: String,
    /// Required in an `index.json`. A releases repository does not know the size before downloading.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub released: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changelog: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// A named set of plugins of one index, offered together on the Launcher first-run screen.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Bundle {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// Plugin ids listed in the same index.
    #[serde(default)]
    pub plugins: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct Index {
    #[serde(default)]
    pub schema: u32,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub plugins: Vec<IndexEntry>,
    /// Optional in an `index.json`. Kept in the cache so the first-run screen can read it offline.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bundles: Vec<Bundle>,
    /// Optional in an `index.json`. Color themes: see src/themes.rs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub themes: Vec<ThemeEntry>,
}

/// One color theme as the repository describes it. `url` is the theme's JSON file.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ThemeEntry {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub size: u64,
}

/// A theme row of the catalog: the entry tagged with the repository it came from.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCatalogEntry {
    #[serde(flatten)]
    pub entry: ThemeEntry,
    pub repo: String,
    pub repo_name: String,
}

/// A catalog row: the entry tagged with the repository it came from.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    #[serde(flatten)]
    pub entry: IndexEntry,
    pub repo: String,
    pub repo_name: String,
}

/// `YYYY-MM-DD`
fn valid_date(date: &str) -> bool {
    let b = date.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && days_in_month(date[0..4].parse().unwrap_or(0), date[5..7].parse().unwrap_or(0)).is_some_and(|days| matches!(date[8..10].parse::<u32>(), Ok(day) if (1..=days).contains(&day)))
}

fn days_in_month(year: u32, month: u32) -> Option<u32> {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => Some(31),
        4 | 6 | 9 | 11 => Some(30),
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => Some(29),
        2 => Some(28),
        _ => None,
    }
}

fn valid_sha256(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Mirrors `validateIndex` in `src/plugins/schema.ts`. Returns every problem.
/// A download link must be https. Plain http is accepted only for the machine itself, which is what the tests serve from.
pub(crate) fn valid_download_url(text: &str) -> bool {
    let Ok(url) = Url::parse(text) else { return false };
    match url.scheme() {
        "https" => true,
        "http" => match url.host() {
            Some(url::Host::Domain(domain)) => domain == "localhost",
            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
            None => false,
        },
        _ => false,
    }
}

pub fn validate_index(index: &Index) -> Vec<String> {
    let mut errors = Vec::new();
    if index.schema != 1 {
        errors.push(format!("schema: must be 1 (found {})", index.schema));
    }
    if index.name.is_empty() {
        errors.push("name: must not be empty".into());
    }
    let mut seen = std::collections::HashSet::new();
    for (i, plugin) in index.plugins.iter().enumerate() {
        let at = format!("plugins[{i}]");
        if !valid_id(&plugin.id) {
            errors.push(format!("{at}.id: \"{}\" must match ^[a-z0-9][a-z0-9-]{{1,63}}$", plugin.id));
        }
        if !seen.insert(plugin.id.as_str()) {
            errors.push(format!("{at}.id: \"{}\" is listed more than once", plugin.id));
        }
        for (field, value) in [("name", &plugin.name), ("description", &plugin.description)] {
            if value.is_empty() {
                errors.push(format!("{at}.{field}: must not be empty"));
            }
        }
        if !valid_version(&plugin.version) {
            errors.push(format!("{at}.version: \"{}\" is not a valid semver version", plugin.version));
        }
        if let Some(min) = plugin.min_app_version.as_deref().filter(|m| !valid_version(m)) {
            errors.push(format!("{at}.minAppVersion: \"{min}\" is not a valid semver version"));
        }
        if !valid_download_url(&plugin.url) {
            errors.push(format!("{at}.url: \"{}\" must be an https URL", plugin.url));
        }
        if !valid_sha256(&plugin.sha256) {
            errors.push(format!("{at}.sha256: \"{}\" must be 64 lowercase hex characters", plugin.sha256));
        }
        if plugin.size.is_none() {
            errors.push(format!("{at}.size: is required"));
        }
        if let Some(released) = plugin.released.as_deref().filter(|r| !valid_date(r)) {
            errors.push(format!("{at}.released: \"{released}\" must look like YYYY-MM-DD"));
        }
        errors.extend(permission_errors(&format!("{at}.permissions"), &plugin.permissions));
    }
    let listed: std::collections::HashSet<&str> = index.plugins.iter().map(|p| p.id.as_str()).collect();
    let mut bundle_ids = std::collections::HashSet::new();
    for (i, bundle) in index.bundles.iter().enumerate() {
        let at = format!("bundles[{i}]");
        if !valid_id(&bundle.id) {
            errors.push(format!("{at}.id: \"{}\" must match ^[a-z0-9][a-z0-9-]{{1,63}}$", bundle.id));
        }
        if !bundle_ids.insert(bundle.id.as_str()) {
            errors.push(format!("{at}.id: \"{}\" is listed more than once", bundle.id));
        }
        if bundle.name.is_empty() {
            errors.push(format!("{at}.name: must not be empty"));
        }
        if bundle.plugins.is_empty() {
            errors.push(format!("{at}.plugins: needs at least 1 item"));
        }
        let mut in_bundle = std::collections::HashSet::new();
        for (j, id) in bundle.plugins.iter().enumerate() {
            if !valid_id(id) {
                errors.push(format!("{at}.plugins[{j}]: \"{id}\" must match ^[a-z0-9][a-z0-9-]{{1,63}}$"));
            } else if !listed.contains(id.as_str()) {
                errors.push(format!("{at}.plugins[{j}]: \"{id}\" is not listed in plugins"));
            } else if !in_bundle.insert(id.as_str()) {
                errors.push(format!("{at}.plugins[{j}]: \"{id}\" is listed more than once"));
            }
        }
    }
    let mut theme_ids = std::collections::HashSet::new();
    for (i, theme) in index.themes.iter().enumerate() {
        let at = format!("themes[{i}]");
        if !crate::themes::valid_id(&theme.id) {
            errors.push(format!("{at}.id: \"{}\" must match ^[a-z0-9-]{{1,40}}$", theme.id));
        }
        if !theme_ids.insert(theme.id.as_str()) {
            errors.push(format!("{at}.id: \"{}\" is listed more than once", theme.id));
        }
        if theme.name.is_empty() {
            errors.push(format!("{at}.name: must not be empty"));
        }
        if !valid_version(&theme.version) {
            errors.push(format!("{at}.version: \"{}\" is not a valid semver version", theme.version));
        }
        if !valid_download_url(&theme.url) {
            errors.push(format!("{at}.url: \"{}\" must be an https URL", theme.url));
        }
        if !valid_sha256(&theme.sha256) {
            errors.push(format!("{at}.sha256: \"{}\" must be 64 lowercase hex characters", theme.sha256));
        }
        if !(1..=crate::themes::MAX_BYTES).contains(&theme.size) {
            errors.push(format!("{at}.size: must be 1 to {} bytes", crate::themes::MAX_BYTES));
        }
    }
    errors
}

/// `github.com/<owner>/<repo>` with or without scheme, `www.`, `.git` or a trailing slash.
/// Returns the lowercase owner and repo (GitHub names are case-insensitive).
pub fn parse_repo_url(text: &str) -> Result<(String, String), String> {
    let bad = || format!("Not a GitHub repository URL: {}", text.trim());
    let lower = text.trim().to_ascii_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://")).unwrap_or(&lower);
    let rest = rest.strip_prefix("www.").unwrap_or(rest);
    let path = rest.strip_prefix("github.com/").ok_or_else(bad)?;
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, repo) = path.split_once('/').ok_or_else(bad)?;
    let part_ok = |part: &str| {
        !part.is_empty() && part != "." && part != ".." && part.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    };
    if part_ok(owner) && part_ok(repo) {
        Ok((owner.to_string(), repo.to_string()))
    } else {
        Err(bad())
    }
}

fn canonical(owner: &str, repo: &str) -> String {
    format!("{GITHUB_BASE}/{owner}/{repo}")
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Temp file, flushed, then renamed: a crash leaves the old file or the whole new one.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(path.parent().unwrap_or(Path::new("."))).map_err(io_err)?;
    let temp = path.with_extension("json.tmp");
    let write = fs::File::create(&temp).and_then(|mut file| {
        std::io::Write::write_all(&mut file, bytes)?;
        file.sync_all()
    });
    write.map_err(io_err)?;
    fs::rename(&temp, path).map_err(io_err)
}

/// A client for GitHub downloads (indexes here, packages in `install.rs`). A release download redirects to
/// GitHub's CDN, so redirects are followed, but never from https down to http.
pub(super) fn client_builder() -> reqwest::ClientBuilder {
    ensure_crypto_provider();
    let redirects = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            attempt.error("Too many redirects")
        } else if attempt.url().scheme() != "https" && attempt.previous().last().is_some_and(|from| from.scheme() == "https") {
            attempt.error("Redirected from https to http")
        } else {
            attempt.follow()
        }
    });
    reqwest::Client::builder().redirect(redirects)
}

static LOCK: Mutex<()> = Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Clone)]
pub struct Repos {
    root: PathBuf,
    raw_base: String,
    github_base: String,
    /// The key the built-in repositories' indexes must be signed with. Empty: not checked.
    index_key: String,
}

impl Repos {
    pub fn new(root: PathBuf) -> Self {
        Repos { root, raw_base: RAW_BASE.into(), github_base: GITHUB_BASE.into(), index_key: super::signing::INDEX_PUBLIC_KEY.into() }
    }

    #[cfg(test)]
    pub(super) fn with_bases(root: PathBuf, raw_base: String, github_base: String) -> Self {
        Repos { root, raw_base, github_base, index_key: String::new() }
    }

    #[cfg(test)]
    pub(super) fn with_index_key(mut self, key: &str) -> Self {
        self.index_key = key.into();
        self
    }

    fn state_path(&self) -> PathBuf {
        self.root.join(STATE_FILE)
    }

    pub(super) fn cache_path(&self, url: &str) -> PathBuf {
        let hash = Sha256::digest(url.as_bytes());
        let name: String = hash.iter().take(8).map(|b| format!("{b:02x}")).collect();
        self.root.join(CACHE_DIR).join(format!("{name}.json"))
    }

    /// A missing file is the seeded default. An unreadable one is renamed to `repos.json.corrupt-<ms>`
    /// and replaced, so a damaged file never blocks the app. The built-in repositories are always present.
    fn load(&self) -> Result<RepoState, String> {
        let path = self.state_path();
        let mut state = match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str(&text) {
                Ok(state) => state,
                Err(error) => {
                    let backup = self.root.join(format!("{STATE_FILE}.corrupt-{}", now_ms()));
                    eprintln!("repos.json is unreadable ({error}); moved to {}", backup.display());
                    fs::rename(&path, backup).map_err(io_err)?;
                    RepoState::default()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => RepoState::default(),
            Err(error) => return Err(io_err(error)),
        };
        // A missing one goes in at its place in the list, so an older repos.json gets the newer ones after the older ones.
        for (i, (url, name)) in BUILT_IN.iter().enumerate() {
            match state.repos.iter_mut().find(|r| r.url == *url) {
                Some(repo) => repo.official = true,
                None => state.repos.insert(i.min(state.repos.len()), built_in_repo(url, name)),
            }
        }
        Ok(state)
    }

    fn save(&self, state: &RepoState) -> Result<(), String> {
        let json = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
        write_atomic(&self.state_path(), &json)
    }

    pub fn state(&self) -> Result<RepoState, String> {
        let _guard = lock();
        self.load()
    }

    pub fn list(&self) -> Result<Vec<Repo>, String> {
        Ok(self.state()?.repos)
    }

    /// The canonical url of a repository that is in the list.
    fn find(state: &RepoState, text: &str) -> Result<String, String> {
        let (owner, repo) = parse_repo_url(text)?;
        let url = canonical(&owner, &repo);
        if state.repos.iter().any(|r| r.url == url) {
            Ok(url)
        } else {
            Err(format!("Repository is not in the list: {url}"))
        }
    }

    pub fn remove(&self, text: &str) -> Result<(), String> {
        let _guard = lock();
        let mut state = self.load()?;
        let url = Self::find(&state, text)?;
        if BUILT_IN.iter().any(|(built_in, _)| *built_in == url) {
            return Err("A built-in repository can be turned off but not removed".into());
        }
        state.repos.retain(|r| r.url != url);
        self.save(&state)?;
        match fs::remove_file(self.cache_path(&url)) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(io_err(error)),
            _ => Ok(()),
        }
    }

    pub fn set_enabled(&self, text: &str, enabled: bool) -> Result<Repo, String> {
        let _guard = lock();
        let mut state = self.load()?;
        let url = Self::find(&state, text)?;
        let repo = state.repos.iter_mut().find(|r| r.url == url).expect("found above");
        repo.enabled = enabled;
        let repo = repo.clone();
        self.save(&state)?;
        Ok(repo)
    }

    pub fn settings(&self) -> Result<RepoSettings, String> {
        let state = self.state()?;
        Ok(RepoSettings { check_on_start: state.check_on_start, allow_outside: state.allow_outside })
    }

    /// Changes the switches that are `Some`. Returns both as they are afterwards.
    pub fn set_settings(&self, check_on_start: Option<bool>, allow_outside: Option<bool>) -> Result<RepoSettings, String> {
        let _guard = lock();
        let mut state = self.load()?;
        state.check_on_start = check_on_start.unwrap_or(state.check_on_start);
        state.allow_outside = allow_outside.unwrap_or(state.allow_outside);
        self.save(&state)?;
        Ok(RepoSettings { check_on_start: state.check_on_start, allow_outside: state.allow_outside })
    }

    /// The gate for installs from a zip, a folder or a URL that is not one of the repositories.
    pub fn require_outside(&self) -> Result<(), String> {
        if self.settings()?.allow_outside {
            Ok(())
        } else {
            Err("Installs from outside your repositories are turned off. Turn on \"Allow installs from zip files, folders and URLs outside these repositories\" in Plugins, Repositories to continue.".into())
        }
    }

    /// The canonical url of `text` when that repository is in the list and turned on.
    pub fn enabled_url(&self, text: &str) -> Result<Option<String>, String> {
        let (owner, name) = parse_repo_url(text)?;
        let url = canonical(&owner, &name);
        Ok(self.state()?.repos.iter().any(|r| r.url == url && r.enabled).then_some(url))
    }

    /// One plugin of a repository's last good sync, and the repository's canonical url.
    pub fn entry(&self, text: &str, id: &str) -> Result<(String, IndexEntry), String> {
        let state = self.state()?;
        let url = Self::find(&state, text)?;
        if !state.repos.iter().any(|r| r.url == url && r.enabled) {
            return Err(format!("The repository is turned off: {url}"));
        }
        let index: Index = fs::read_to_string(self.cache_path(&url))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .ok_or_else(|| format!("The repository has not been synced yet: {url}"))?;
        let entry = index.plugins.into_iter().find(|p| p.id == id).ok_or_else(|| format!("{id} is not listed in {url}. Sync the repository and try again."))?;
        Ok((url, entry))
    }

    /// Detects what `text` points at without adding it: the canonical url, the kind and the catalog it serves.
    pub async fn detect(&self, text: &str) -> Result<(String, RepoKind, Index), String> {
        let (owner, name) = parse_repo_url(text)?;
        let (kind, index) = self.fetch(&owner, &name, None).await?;
        Ok((canonical(&owner, &name), kind, index))
    }

    // ---- network ----

    /// `Ok(None)` for a 404, so the callers can tell "not there" from "broken".
    async fn get(&self, url: &str) -> Result<Option<Vec<u8>>, String> {
        let client = client_builder().timeout(TIMEOUT).build().map_err(|error| error.to_string())?;
        let mut response = client.get(url).send().await.map_err(describe)?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(describe)? {
            if body.len() + chunk.len() > MAX_BODY_BYTES {
                return Err(format!("The response is larger than {} MB", MAX_BODY_BYTES / (1024 * 1024)));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(Some(body))
    }

    async fn fetch_index(&self, owner: &str, repo: &str) -> Result<Option<Index>, String> {
        let Some(body) = self.get(&format!("{}/{owner}/{repo}/HEAD/index.json", self.raw_base)).await? else { return Ok(None) };
        self.check_signature(owner, repo, &body).await?;
        let index: Index = serde_json::from_slice(&body).map_err(|error| format!("index.json: {error}"))?;
        let errors = validate_index(&index);
        if errors.is_empty() {
            Ok(Some(index))
        } else {
            Err(format!("index.json: {}", errors.join("; ")))
        }
    }

    /// A built-in repository's index must carry a valid signature of exactly these bytes, once the app has a key for it.
    /// A repository the user added is not signed by anyone the app knows, so it is not checked.
    async fn check_signature(&self, owner: &str, repo: &str, body: &[u8]) -> Result<(), String> {
        if self.index_key.is_empty() || !BUILT_IN.iter().any(|(url, _)| *url == canonical(owner, repo)) {
            return Ok(());
        }
        let sig = self.get(&format!("{}/{owner}/{repo}/HEAD/index.json.sig", self.raw_base)).await?;
        let sig = sig.ok_or("index.json.sig not found (404): the index is not signed")?;
        let sig = std::str::from_utf8(&sig).map_err(|_| "index.json.sig is not text")?;
        super::signing::verify(body, sig, &self.index_key).map_err(|error| format!("index.json: {error}"))
    }

    /// The latest release's `plugin.json` and `plugin.zip.sha256`, as a one-plugin index.
    async fn fetch_release(&self, owner: &str, repo: &str) -> Result<Option<Index>, String> {
        let base = format!("{}/{owner}/{repo}/releases/latest/download", self.github_base);
        let Some(body) = self.get(&format!("{base}/plugin.json")).await? else { return Ok(None) };
        let manifest: Manifest = serde_json::from_slice(&body).map_err(|error| format!("plugin.json: {error}"))?;
        let errors = manifest.field_errors();
        if !errors.is_empty() {
            return Err(format!("plugin.json: {}", errors.join("; ")));
        }
        let checksum = self.get(&format!("{base}/plugin.zip.sha256")).await?.ok_or("plugin.zip.sha256 not found (404)")?;
        let sha256 = String::from_utf8_lossy(&checksum).split_whitespace().next().unwrap_or("").to_ascii_lowercase();
        if !valid_sha256(&sha256) {
            return Err("plugin.zip.sha256: not a SHA-256 checksum".into());
        }
        let entry = IndexEntry {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description,
            category: manifest.category,
            runtime: manifest.runtime,
            permissions: manifest.permissions,
            min_app_version: manifest.min_app_version,
            url: format!("{base}/plugin.zip"),
            sha256,
            size: None,
            released: None,
            changelog: None,
            // A package file is not reachable before install; only a built-in icon name is.
            icon: manifest.icon.filter(|icon| icon.starts_with("lucide:")),
        };
        Ok(Some(Index { schema: 1, name: format!("{owner}/{repo}"), plugins: vec![entry], bundles: Vec::new(), themes: Vec::new() }))
    }

    /// A known `kind` is fetched as that kind. Otherwise detect: index first, then releases.
    async fn fetch(&self, owner: &str, repo: &str, kind: Option<RepoKind>) -> Result<(RepoKind, Index), String> {
        let (kind, index) = self.fetch_any(owner, repo, kind).await?;
        // The themes repository is built in, and so trusted, for color themes only. A plugin it listed would pass as an official one.
        if canonical(owner, repo) == THEMES_URL && !index.plugins.is_empty() {
            return Err("Shard Themes lists themes only, not plugins".into());
        }
        Ok((kind, index))
    }

    async fn fetch_any(&self, owner: &str, repo: &str, kind: Option<RepoKind>) -> Result<(RepoKind, Index), String> {
        match kind {
            Some(RepoKind::Index) => self.fetch_index(owner, repo).await?.map(|i| (RepoKind::Index, i)).ok_or_else(|| "index.json not found (404)".into()),
            Some(RepoKind::Releases) => {
                self.fetch_release(owner, repo).await?.map(|i| (RepoKind::Releases, i)).ok_or_else(|| "plugin.json not found (404)".into())
            }
            None => {
                if let Some(index) = self.fetch_index(owner, repo).await? {
                    return Ok((RepoKind::Index, index));
                }
                if let Some(index) = self.fetch_release(owner, repo).await? {
                    return Ok((RepoKind::Releases, index));
                }
                Err("Not a plugin repository".into())
            }
        }
    }

    // ---- operations ----

    fn write_cache(&self, url: &str, index: &Index) -> Result<(), String> {
        write_atomic(&self.cache_path(url), &serde_json::to_vec(index).map_err(|error| error.to_string())?)
    }

    fn ensure_new(&self, url: &str) -> Result<(), String> {
        let _guard = lock();
        if self.load()?.repos.iter().any(|r| r.url == url) {
            Err("Repository already added".into())
        } else {
            Ok(())
        }
    }

    /// Detects the repository and adds it. A repository that cannot be read is not added.
    pub async fn add(&self, text: &str) -> Result<Repo, String> {
        let (owner, name) = parse_repo_url(text)?;
        let url = canonical(&owner, &name);
        self.ensure_new(&url)?;
        let (kind, index) = self.fetch(&owner, &name, None).await?;
        let _guard = lock();
        let mut state = self.load()?;
        if state.repos.iter().any(|r| r.url == url) {
            return Err("Repository already added".into());
        }
        self.write_cache(&url, &index)?;
        let repo = Repo { url, name: index.name, kind: Some(kind), enabled: true, last_sync: Some(now_ms()), last_error: None, official: false };
        state.repos.push(repo.clone());
        self.save(&state)?;
        Ok(repo)
    }

    /// Fetches one repository. A failure is recorded in `lastError` (the old cache stays) and returned
    /// inside the `Repo`; only a problem with the app's own files is an `Err`.
    async fn sync_one(&self, text: &str) -> Result<Repo, String> {
        let (url, kind) = {
            let _guard = lock();
            let state = self.load()?;
            let url = Self::find(&state, text)?;
            let kind = state.repos.iter().find(|r| r.url == url).and_then(|r| r.kind);
            (url, kind)
        };
        let (owner, name) = parse_repo_url(&url)?;
        let result = self.fetch(&owner, &name, kind).await;

        let _guard = lock();
        let mut state = self.load()?;
        let Some(repo) = state.repos.iter_mut().find(|r| r.url == url) else { return Err("Repository was removed while syncing".into()) };
        match result {
            Ok((kind, index)) => {
                self.write_cache(&url, &index)?;
                repo.kind = Some(kind);
                repo.name = index.name;
                repo.last_sync = Some(now_ms());
                repo.last_error = None;
            }
            Err(message) => repo.last_error = Some(message),
        }
        let repo = repo.clone();
        self.save(&state)?;
        Ok(repo)
    }

    /// One repository, or every enabled one. Returns the whole list as it is afterwards.
    pub async fn sync(&self, url: Option<&str>) -> Result<Vec<Repo>, String> {
        match url {
            Some(url) => {
                self.sync_one(url).await?;
            }
            None => {
                // ponytail: one after the other; join them concurrently if people add many repositories.
                // A repository that fails (even for a local reason, like being removed meanwhile) must not stop the rest.
                for repo in self.list()?.into_iter().filter(|r| r.enabled) {
                    if let Err(error) = self.sync_one(&repo.url).await {
                        eprintln!("sync of {} failed: {error}", repo.url);
                    }
                }
            }
        }
        self.list()
    }

    /// Entries of every enabled repository's last good sync, tagged with the repository.
    pub fn catalog(&self) -> Result<Vec<CatalogEntry>, String> {
        let state = self.state()?;
        let mut out = Vec::new();
        for repo in state.repos.iter().filter(|r| r.enabled) {
            let Ok(text) = fs::read_to_string(self.cache_path(&repo.url)) else { continue };
            let Ok(index) = serde_json::from_str::<Index>(&text) else { continue };
            out.extend(index.plugins.into_iter().map(|entry| CatalogEntry { entry, repo: repo.url.clone(), repo_name: repo.name.clone() }));
        }
        Ok(out)
    }

    /// The bundles of one repository's last good sync. Empty when it has none, was never synced or is turned off.
    pub fn bundles(&self, text: &str) -> Result<Vec<Bundle>, String> {
        let state = self.state()?;
        let url = Self::find(&state, text)?;
        if !state.repos.iter().any(|r| r.url == url && r.enabled) {
            return Ok(Vec::new());
        }
        let index = fs::read_to_string(self.cache_path(&url)).ok().and_then(|text| serde_json::from_str::<Index>(&text).ok());
        Ok(index.map(|index| index.bundles).unwrap_or_default())
    }

    fn cached_index(&self, url: &str) -> Option<Index> {
        fs::read_to_string(self.cache_path(url)).ok().and_then(|text| serde_json::from_str(&text).ok())
    }

    /// The themes of every enabled repository's last good sync, tagged with the repository.
    pub fn theme_catalog(&self) -> Result<Vec<ThemeCatalogEntry>, String> {
        let state = self.state()?;
        let mut out = Vec::new();
        for repo in state.repos.iter().filter(|r| r.enabled) {
            let Some(index) = self.cached_index(&repo.url) else { continue };
            out.extend(index.themes.into_iter().map(|entry| ThemeCatalogEntry { entry, repo: repo.url.clone(), repo_name: repo.name.clone() }));
        }
        Ok(out)
    }

    /// One theme of a repository's last good sync, and the repository's canonical url.
    pub fn theme_entry(&self, text: &str, id: &str) -> Result<(String, ThemeEntry), String> {
        let state = self.state()?;
        let url = Self::find(&state, text)?;
        if !state.repos.iter().any(|r| r.url == url && r.enabled) {
            return Err(format!("The repository is turned off: {url}"));
        }
        let index = self.cached_index(&url).ok_or_else(|| format!("The repository has not been synced yet: {url}"))?;
        let entry = index.themes.into_iter().find(|t| t.id == id).ok_or_else(|| format!("{id} is not listed in {url}. Sync the repository and try again."))?;
        Ok((url, entry))
    }

    /// Downloads a theme file. It must be exactly the size and SHA-256 the index lists.
    pub async fn theme_file(&self, entry: &ThemeEntry) -> Result<Vec<u8>, String> {
        let body = self.get(&entry.url).await?.ok_or("The theme file was not found (404).")?;
        if body.len() as u64 != entry.size {
            return Err(format!("The download is {} bytes, but the repository lists {}.", body.len(), entry.size));
        }
        let sha256: String = Sha256::digest(&body).iter().map(|b| format!("{b:02x}")).collect();
        if sha256 != entry.sha256 {
            return Err("The download does not match the checksum the repository lists.".into());
        }
        Ok(body)
    }
}

pub(crate) fn repos(app: &tauri::AppHandle) -> Result<Repos, String> {
    use tauri::Manager;
    Ok(Repos::new(app.path().app_data_dir().map_err(|error| error.to_string())?))
}

#[tauri::command]
pub async fn repo_list(app: tauri::AppHandle) -> Result<Vec<Repo>, String> {
    let repos = repos(&app)?;
    blocking(move || repos.list()).await
}

#[tauri::command]
pub async fn repo_add(app: tauri::AppHandle, url: String) -> Result<Repo, String> {
    repos(&app)?.add(&url).await
}

#[tauri::command]
pub async fn repo_remove(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let repos = repos(&app)?;
    blocking(move || repos.remove(&url)).await
}

#[tauri::command]
pub async fn repo_set_enabled(app: tauri::AppHandle, url: String, enabled: bool) -> Result<Repo, String> {
    let repos = repos(&app)?;
    blocking(move || repos.set_enabled(&url, enabled)).await
}

#[tauri::command]
pub async fn repo_sync(app: tauri::AppHandle, url: Option<String>) -> Result<Vec<Repo>, String> {
    repos(&app)?.sync(url.as_deref()).await
}

/// Reads the two settings, or changes the ones that are given. Returns both.
#[tauri::command]
pub async fn repo_set_settings(app: tauri::AppHandle, check_on_start: Option<bool>, allow_outside: Option<bool>) -> Result<RepoSettings, String> {
    let repos = repos(&app)?;
    blocking(move || repos.set_settings(check_on_start, allow_outside)).await
}

#[tauri::command]
pub async fn repo_catalog(app: tauri::AppHandle) -> Result<Vec<CatalogEntry>, String> {
    let repos = repos(&app)?;
    blocking(move || repos.catalog()).await
}

/// The bundles the repository's index offers (first run, Launcher layout).
#[tauri::command]
pub async fn repo_bundles(app: tauri::AppHandle, url: String) -> Result<Vec<Bundle>, String> {
    let repos = repos(&app)?;
    blocking(move || repos.bundles(&url)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::mock::Mock;
    use serde_json::json;

    const SHA: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn entry(id: &str) -> serde_json::Value {
        json!({
            "id": id, "name": "Kafka Inspector", "version": "0.3.1", "description": "Browse topics.", "runtime": "web",
            "permissions": [{ "name": "files:open", "reason": "Read files you open" }],
            "url": "https://example.com/kafka.zip", "sha256": SHA, "size": 1234, "released": "2026-10-18"
        })
    }

    fn index(name: &str, plugins: Vec<serde_json::Value>) -> String {
        json!({ "schema": 1, "name": name, "plugins": plugins }).to_string()
    }

    const URL: &str = "https://github.com/acme/tools";

    fn add(repos: &Repos, text: &str) -> Result<Repo, String> {
        tauri::async_runtime::block_on(repos.add(text))
    }

    fn sync(repos: &Repos, url: Option<&str>) -> Vec<Repo> {
        tauri::async_runtime::block_on(repos.sync(url)).unwrap()
    }

    fn release(mock: &Mock) {
        let manifest = json!({ "id": "solo-tool", "name": "Solo", "version": "1.2.0", "description": "One tool.", "entry": "index.html", "runtime": "web", "icon": "icon.svg" });
        mock.set("/gh/acme/tools/releases/latest/download/plugin.json", 200, manifest.to_string());
        mock.set("/gh/acme/tools/releases/latest/download/plugin.zip.sha256", 200, format!("{SHA}  plugin.zip\n"));
    }

    #[test]
    fn url_forms_resolve_to_one_canonical_repository() {
        for text in ["https://github.com/Acme/Tools", "github.com/acme/tools", "http://www.github.com/acme/tools.git", " https://GitHub.com/acme/tools/ ", "github.com/acme/tools.git/"] {
            assert_eq!(parse_repo_url(text), Ok(("acme".into(), "tools".into())), "{text}");
        }
        for text in ["", "acme/tools", "https://gitlab.com/acme/tools", "https://github.com/acme", "https://github.com/acme/tools/tree/main", "https://github.com/../tools", "https://github.com/a b/tools", "https://github.com//tools"] {
            assert!(parse_repo_url(text).unwrap_err().starts_with("Not a GitHub repository URL"), "{text}");
        }
    }

    #[test]
    fn the_official_repository_is_seeded_and_cannot_be_removed() {
        let (_dir, repos) = Mock::start().repos();
        let list = repos.list().unwrap();
        assert_eq!((list.len(), list[0].url.as_str(), list[1].url.as_str()), (2, OFFICIAL_URL, THEMES_URL));
        assert!(list.iter().all(|repo| repo.official && repo.enabled));
        assert!(repos.state().unwrap().check_on_start);
        assert!(!repos.state().unwrap().allow_outside);
        assert!(repos.remove(OFFICIAL_URL).unwrap_err().contains("can be turned off but not removed"));
        assert!(repos.remove("github.com/kinan9011/shard-themes").unwrap_err().contains("can be turned off but not removed"));
        assert!(!repos.set_enabled("github.com/kinan9011/shard-plugins", false).unwrap().enabled);
        assert!(!repos.list().unwrap()[0].enabled, "the off switch persists");
        // Edited out of the file: it comes back, still off if its record is there.
        fs::write(repos.state_path(), r#"{"repos":[]}"#).unwrap();
        assert!(repos.list().unwrap()[0].official);
    }

    #[test]
    fn an_older_repos_file_gets_the_themes_repository_after_shard_plugins_and_before_the_users_own() {
        let (_dir, repos) = Mock::start().repos();
        let own = r#"{"url":"https://github.com/acme/tools","name":"Acme","enabled":true}"#;
        let official = format!(r#"{{"url":"{OFFICIAL_URL}","name":"Shard Official","enabled":false,"official":true}}"#);
        fs::write(repos.state_path(), format!(r#"{{"repos":[{official},{own}]}}"#)).unwrap();
        let urls: Vec<String> = repos.list().unwrap().into_iter().map(|repo| repo.url).collect();
        assert_eq!(urls, [OFFICIAL_URL, THEMES_URL, URL]);
        assert!(!repos.list().unwrap()[0].enabled, "what the user turned off stays off");
        assert!(repos.list().unwrap()[1].enabled);
    }

    #[test]
    fn the_themes_repository_is_synced_with_the_rest_and_can_be_turned_off() {
        let mock = Mock::start();
        mock.set("/raw/kinan9011/shard-themes/HEAD/index.json", 200, themes_index(&sha_of(THEME), THEME.len()));
        let (_dir, repos) = mock.repos();
        sync(&repos, None);
        let catalog = repos.theme_catalog().unwrap();
        assert_eq!((catalog.len(), catalog[0].repo.as_str()), (1, THEMES_URL));
        assert!(!repos.set_enabled(THEMES_URL, false).unwrap().enabled);
        assert!(repos.theme_catalog().unwrap().is_empty());
    }

    #[test]
    fn an_index_repository_is_detected_cached_and_listed_in_the_catalog() {
        let mock = Mock::start();
        mock.set("/raw/acme/tools/HEAD/index.json", 200, index("Acme Plugins", vec![entry("kafka-inspector")]));
        let (_dir, repos) = mock.repos();
        let added = add(&repos, "github.com/Acme/Tools.git").unwrap();
        assert_eq!((added.url.as_str(), added.name.as_str(), added.kind), (URL, "Acme Plugins", Some(RepoKind::Index)));
        assert!(added.last_sync.is_some() && added.last_error.is_none());
        assert!(repos.cache_path(URL).is_file());
        let catalog = repos.catalog().unwrap();
        assert_eq!(catalog.len(), 1);
        assert_eq!((catalog[0].entry.id.as_str(), catalog[0].repo.as_str(), catalog[0].repo_name.as_str()), ("kafka-inspector", URL, "Acme Plugins"));
        let wire = serde_json::to_value(&catalog[0]).unwrap();
        assert_eq!((wire["repoName"].as_str(), wire["sha256"].as_str(), wire["minAppVersion"].is_null()), (Some("Acme Plugins"), Some(SHA), true));
    }

    #[test]
    fn a_releases_repository_becomes_a_one_plugin_catalog() {
        let mock = Mock::start();
        release(&mock);
        let (_dir, repos) = mock.repos();
        let added = add(&repos, URL).unwrap();
        assert_eq!((added.kind, added.name.as_str()), (Some(RepoKind::Releases), "acme/tools"));
        let catalog = repos.catalog().unwrap();
        let plugin = &catalog[0].entry;
        assert_eq!((plugin.id.as_str(), plugin.version.as_str(), plugin.sha256.as_str()), ("solo-tool", "1.2.0", SHA));
        assert_eq!(plugin.url, format!("http://127.0.0.1:{}/gh/acme/tools/releases/latest/download/plugin.zip", mock.port));
        assert_eq!((plugin.size, plugin.icon.as_deref()), (None, None), "a package icon file is not reachable before install");
        assert!(validate_index(&serde_json::from_str(&fs::read_to_string(repos.cache_path(URL)).unwrap()).unwrap()).iter().all(|e| e.contains("size")));
    }

    #[test]
    fn something_that_is_neither_is_not_added() {
        let (_dir, repos) = Mock::start().repos();
        assert_eq!(add(&repos, URL).unwrap_err(), "Not a plugin repository");
        assert_eq!(repos.list().unwrap().len(), BUILT_IN.len());
        assert!(!repos.cache_path(URL).exists());
        assert!(add(&repos, "https://example.com/x").unwrap_err().starts_with("Not a GitHub repository URL"));
    }

    #[test]
    fn a_failed_sync_records_the_error_and_keeps_the_last_good_catalog() {
        let mock = Mock::start();
        mock.set("/raw/acme/tools/HEAD/index.json", 200, index("Acme Plugins", vec![entry("kafka-inspector")]));
        let (_dir, repos) = mock.repos();
        let first = add(&repos, URL).unwrap();
        mock.set("/raw/acme/tools/HEAD/index.json", 404, "");
        let repo = sync(&repos, Some(URL)).into_iter().find(|r| r.url == URL).unwrap();
        assert_eq!(repo.last_error.as_deref(), Some("index.json not found (404)"));
        assert_eq!(repo.last_sync, first.last_sync, "lastSync is the last success");
        assert_eq!(repos.catalog().unwrap().len(), 1);
        mock.set("/raw/acme/tools/HEAD/index.json", 500, "");
        assert_eq!(sync(&repos, Some(URL)).into_iter().find(|r| r.url == URL).unwrap().last_error.as_deref(), Some("HTTP 500"));
        // A good answer clears the error.
        mock.set("/raw/acme/tools/HEAD/index.json", 200, index("Renamed", vec![entry("kafka-inspector"), entry("second-tool")]));
        let repo = sync(&repos, Some(URL)).into_iter().find(|r| r.url == URL).unwrap();
        assert_eq!((repo.last_error, repo.name.as_str()), (None, "Renamed"));
        assert_eq!(repos.catalog().unwrap().len(), 2);
    }

    #[test]
    fn invalid_json_and_schema_errors_are_reported_and_nothing_is_cached() {
        let mock = Mock::start();
        let (_dir, repos) = mock.repos();
        mock.set("/raw/acme/tools/HEAD/index.json", 200, "{ nope");
        assert!(add(&repos, URL).unwrap_err().starts_with("index.json: "));
        let mut bad = entry("kafka-inspector");
        bad["sha256"] = json!("XYZ");
        mock.set("/raw/acme/tools/HEAD/index.json", 200, index("Acme", vec![bad, entry("dup-tool"), entry("dup-tool")]));
        let error = add(&repos, URL).unwrap_err();
        assert!(error.contains("plugins[0].sha256") && error.contains("\"dup-tool\" is listed more than once"), "{error}");
        mock.set("/raw/acme/tools/HEAD/index.json", 200, json!({ "schema": 2, "name": "", "plugins": [] }).to_string());
        let error = add(&repos, URL).unwrap_err();
        assert!(error.contains("schema: must be 1") && error.contains("name: must not be empty"), "{error}");
        assert_eq!(repos.list().unwrap().len(), BUILT_IN.len());
        assert!(!repos.cache_path(URL).exists());
        // A releases repo with a bad checksum file.
        mock.set("/raw/acme/tools/HEAD/index.json", 404, "");
        release(&mock);
        mock.set("/gh/acme/tools/releases/latest/download/plugin.zip.sha256", 200, "not a hash");
        assert!(add(&repos, URL).unwrap_err().contains("plugin.zip.sha256"));
    }

    #[test]
    fn duplicates_are_refused_and_disabled_repositories_are_skipped() {
        let mock = Mock::start();
        mock.set("/raw/acme/tools/HEAD/index.json", 200, index("Acme", vec![entry("kafka-inspector")]));
        let (_dir, repos) = mock.repos();
        add(&repos, URL).unwrap();
        assert_eq!(add(&repos, "github.com/acme/tools/").unwrap_err(), "Repository already added");
        repos.set_enabled(URL, false).unwrap();
        assert!(repos.catalog().unwrap().is_empty(), "off means out of the catalog");
        // Sync-all leaves a disabled repository alone (and the unreachable official one only records an error).
        mock.set("/raw/acme/tools/HEAD/index.json", 404, "");
        let all = sync(&repos, None);
        assert_eq!(all.iter().find(|r| r.url == URL).unwrap().last_error, None);
        assert_eq!(all[0].last_error.as_deref(), Some("Not a plugin repository"));
        // Removing drops the record and its cache.
        repos.remove(URL).unwrap();
        assert!(!repos.cache_path(URL).exists() && repos.list().unwrap().len() == BUILT_IN.len());
        assert!(repos.remove(URL).unwrap_err().contains("not in the list"));
    }

    #[test]
    fn index_validation_checks_dates_and_reports_repeated_invalid_ids() {
        for (date, ok) in [("2026-10-18", true), ("2024-02-29", true), ("2026-02-29", false), ("2026-04-31", false), ("2026-13-01", false), ("2026-1-01", false)] {
            assert_eq!(valid_date(date), ok, "{date}");
        }
        let mut a = serde_json::from_value::<IndexEntry>(entry("Bad")).unwrap();
        a.size = Some(1);
        let index = Index { schema: 1, name: "x".into(), plugins: vec![a.clone(), a], bundles: Vec::new(), themes: Vec::new() };
        let errors = validate_index(&index).join("\n");
        assert!(errors.contains("plugins[1].id: \"Bad\" is listed more than once"), "{errors}");
    }

    fn bundle(id: &str, plugins: &[&str]) -> serde_json::Value {
        json!({ "id": id, "name": "Web & APIs", "plugins": plugins })
    }

    fn index_with_bundles(plugins: Vec<serde_json::Value>, bundles: Vec<serde_json::Value>) -> String {
        json!({ "schema": 1, "name": "Acme", "plugins": plugins, "bundles": bundles }).to_string()
    }

    #[test]
    fn bundles_are_optional_and_checked_against_the_listed_plugins() {
        let parse = |text: String| serde_json::from_str::<Index>(&text).unwrap();
        assert!(validate_index(&parse(index("Acme", vec![entry("kafka-inspector")]))).is_empty(), "an index without bundles stays valid");
        let ok = parse(index_with_bundles(vec![entry("kafka-inspector"), entry("second-tool")], vec![bundle("web-apis", &["kafka-inspector", "second-tool"]), bundle("data-sql", &["second-tool"])]));
        assert!(validate_index(&ok).is_empty());
        let bad = parse(index_with_bundles(vec![entry("kafka-inspector")], vec![bundle("web-apis", &["kafka-inspector", "ghost"]), bundle("web-apis", &[]), json!({ "id": "Bad Id", "name": "", "plugins": ["kafka-inspector"] }), bundle("twice", &["kafka-inspector", "kafka-inspector"])]));
        let errors = validate_index(&bad).join("\n");
        for expected in [
            "bundles[0].plugins[1]: \"ghost\" is not listed in plugins",
            "bundles[1].id: \"web-apis\" is listed more than once",
            "bundles[1].plugins: needs at least 1 item",
            "bundles[2].id: \"Bad Id\" must match",
            "bundles[2].name: must not be empty",
            "bundles[3].plugins[1]: \"kafka-inspector\" is listed more than once",
        ] {
            assert!(errors.contains(expected), "{expected} in {errors}");
        }
    }

    const THEME: &str = r#"{"id":"nord","name":"Nord","dark":{"--background":"220 16% 22%"}}"#;

    fn themes_index(sha: &str, size: usize) -> String {
        json!({ "schema": 1, "name": "Themes", "plugins": [], "themes": [{
            "id": "nord", "name": "Nord", "version": "1.0.0", "description": "Cool.", "url": "http://127.0.0.1/t/nord.json", "sha256": sha, "size": size
        }] })
        .to_string()
    }

    fn sha_of(text: &str) -> String {
        Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn a_repository_with_only_themes_is_added_and_its_themes_are_cataloged() {
        let mock = Mock::start();
        mock.set("/raw/acme/tools/HEAD/index.json", 200, themes_index(&sha_of(THEME), THEME.len()));
        let (_dir, repos) = mock.repos();
        add(&repos, URL).unwrap();
        let catalog = repos.theme_catalog().unwrap();
        assert_eq!((catalog.len(), catalog[0].entry.id.as_str(), catalog[0].repo.as_str()), (1, "nord", URL));
        assert!(repos.catalog().unwrap().is_empty());
        repos.set_enabled(URL, false).unwrap();
        assert!(repos.theme_catalog().unwrap().is_empty());
    }

    #[test]
    fn a_theme_download_must_match_the_listed_size_and_checksum() {
        let mock = Mock::start();
        mock.set("/t/nord.json", 200, THEME);
        let (_dir, repos) = mock.repos();
        let mut entry = ThemeEntry {
            id: "nord".into(), name: "Nord".into(), version: "1.0.0".into(), description: "".into(),
            url: mock.url("/t/nord.json"), sha256: sha_of(THEME), size: THEME.len() as u64,
        };
        assert_eq!(tauri::async_runtime::block_on(repos.theme_file(&entry)).unwrap(), THEME.as_bytes());
        entry.sha256 = SHA.into();
        assert!(tauri::async_runtime::block_on(repos.theme_file(&entry)).unwrap_err().contains("checksum"));
        entry.sha256 = sha_of(THEME);
        entry.size += 1;
        assert!(tauri::async_runtime::block_on(repos.theme_file(&entry)).unwrap_err().contains("bytes"));
        entry.url = mock.url("/t/missing.json");
        assert!(tauri::async_runtime::block_on(repos.theme_file(&entry)).unwrap_err().contains("404"));
    }

    fn signed_themes_repo(body: &str, sig: Option<&str>, key: &str) -> (tempfile::TempDir, Repos, Vec<Repo>) {
        let mock = Mock::start();
        mock.set("/raw/kinan9011/shard-themes/HEAD/index.json", 200, body.to_string());
        if let Some(sig) = sig {
            mock.set("/raw/kinan9011/shard-themes/HEAD/index.json.sig", 200, sig.to_string());
        }
        let (dir, repos) = mock.repos();
        let repos = repos.with_index_key(key);
        let all = sync(&repos, Some(THEMES_URL));
        (dir, repos, all)
    }

    #[test]
    fn a_built_in_index_is_read_only_when_its_signature_checks_out() {
        use crate::plugins::signing::fixtures::*;
        let error_of = |all: &[Repo]| all.iter().find(|repo| repo.url == THEMES_URL).unwrap().last_error.clone();

        let (_dir, repos, all) = signed_themes_repo(BODY, Some(SIGNATURE), PUBLIC_KEY);
        assert_eq!(error_of(&all), None);
        assert!(repos.cached_index(THEMES_URL).is_some());

        for (body, sig, key, expect) in [
            (BODY.replace("Fixture", "Evil"), Some(SIGNATURE), PUBLIC_KEY, "does not match"),
            (BODY.to_string(), None, PUBLIC_KEY, "not signed"),
            (BODY.to_string(), Some(SIGNATURE), OTHER_PUBLIC_KEY, "does not match"),
        ] {
            let (_dir, repos, all) = signed_themes_repo(&body, sig, key);
            let error = error_of(&all).unwrap_or_default();
            assert!(error.contains(expect), "{error}");
            assert!(repos.cached_index(THEMES_URL).is_none(), "nothing is cached from an index that failed the check");
        }
    }

    #[test]
    fn an_added_repository_and_an_unconfigured_key_are_not_checked() {
        use crate::plugins::signing::fixtures::*;
        // No key yet: an unsigned built-in index is fine.
        let (_dir, repos, all) = signed_themes_repo(BODY, None, "");
        assert!(all.iter().find(|repo| repo.url == THEMES_URL).unwrap().last_error.is_none());
        assert!(repos.cached_index(THEMES_URL).is_some());
        // A key, but the repository is the user's own.
        let mock = Mock::start();
        mock.set("/raw/acme/tools/HEAD/index.json", 200, BODY.to_string());
        let (_dir, repos) = mock.repos();
        let repos = repos.with_index_key(PUBLIC_KEY);
        add(&repos, URL).unwrap();
    }

    #[test]
    fn the_themes_repository_may_not_list_plugins() {
        let mock = Mock::start();
        let with_plugin = json!({ "schema": 1, "name": "Themes", "plugins": [entry("evil")], "themes": [] });
        mock.set("/raw/kinan9011/shard-themes/HEAD/index.json", 200, with_plugin.to_string());
        let (_dir, repos) = mock.repos();
        let all = sync(&repos, Some(THEMES_URL));
        let themes = all.iter().find(|repo| repo.url == THEMES_URL).unwrap();
        assert!(themes.last_error.as_deref().is_some_and(|error| error.contains("themes only")), "{:?}", themes.last_error);
        assert!(repos.catalog().unwrap().is_empty());
    }

    #[test]
    fn downloads_must_be_https_except_from_the_machine_itself() {
        for good in ["https://example.com/a.zip", "http://127.0.0.1:8080/a.zip", "http://localhost/a.zip", "http://[::1]/a.zip"] {
            assert!(valid_download_url(good), "{good}");
        }
        for bad in ["http://example.com/a.zip", "ftp://example.com/a.zip", "file:///etc/passwd", "not a url", "http://127.0.0.1.example.com/a.zip"] {
            assert!(!valid_download_url(bad), "{bad}");
        }
    }

    #[test]
    fn validate_index_checks_the_themes() {
        let theme = |id: &str, size: u64| ThemeEntry {
            id: id.into(), name: "N".into(), version: "1.0.0".into(), description: "".into(),
            url: "https://example.com/t.json".into(), sha256: SHA.into(), size,
        };
        let index = |themes| Index { schema: 1, name: "x".into(), themes, ..Default::default() };
        assert!(validate_index(&index(vec![theme("nord", 100)])).is_empty());
        assert_eq!(validate_index(&index(vec![theme("nord", 100), theme("nord", 100)])).len(), 1);
        assert_eq!(validate_index(&index(vec![theme("Bad Id", 100)])).len(), 1);
        assert_eq!(validate_index(&index(vec![theme("nord", 0)])).len(), 1);
        assert_eq!(validate_index(&index(vec![theme("nord", 64 * 1024 + 1)])).len(), 1);
    }

    #[test]
    fn a_synced_index_keeps_its_bundles_in_the_cache() {
        let mock = Mock::start();
        mock.set("/raw/acme/tools/HEAD/index.json", 200, index_with_bundles(vec![entry("kafka-inspector")], vec![bundle("web-apis", &["kafka-inspector"])]));
        let (_dir, repos) = mock.repos();
        add(&repos, URL).unwrap();
        let bundles = repos.bundles(URL).unwrap();
        assert_eq!(bundles, vec![Bundle { id: "web-apis".into(), name: "Web & APIs".into(), plugins: vec!["kafka-inspector".into()] }]);
        let wire = serde_json::to_value(&bundles[0]).unwrap();
        assert_eq!(wire["plugins"][0], "kafka-inspector");
        // Turned off: not offered.
        repos.set_enabled(URL, false).unwrap();
        assert!(repos.bundles(URL).unwrap().is_empty());
        // An index without the key, a releases repository and a repository that is not in the list give none.
        mock.set("/raw/acme/tools/HEAD/index.json", 200, index("Acme", vec![entry("kafka-inspector")]));
        repos.set_enabled(URL, true).unwrap();
        sync(&repos, Some(URL));
        assert!(repos.bundles(URL).unwrap().is_empty());
        assert!(repos.bundles("github.com/nobody/nothing").unwrap_err().contains("not in the list"));
    }

    #[test]
    fn a_releases_repository_has_no_bundles() {
        let mock = Mock::start();
        release(&mock);
        let (_dir, repos) = mock.repos();
        add(&repos, URL).unwrap();
        assert!(repos.bundles(URL).unwrap().is_empty());
        assert!(!fs::read_to_string(repos.cache_path(URL)).unwrap().contains("bundles"), "an empty list is not written");
    }

    #[test]
    fn sync_all_continues_past_a_repository_that_vanishes() {
        let mock = Mock::start();
        mock.set("/raw/acme/tools/HEAD/index.json", 200, index("Acme", vec![entry("kafka-inspector")]));
        let (_dir, repos) = mock.repos();
        add(&repos, URL).unwrap();
        let all = sync(&repos, None);
        // Both built-in repositories are unreachable here and only record an error; the one added last still syncs.
        assert_eq!(all.len(), BUILT_IN.len() + 1);
        let acme = all.last().unwrap();
        assert!(all[..BUILT_IN.len()].iter().all(|repo| repo.last_error.is_some()) && acme.last_error.is_none() && acme.last_sync.is_some());
    }

    #[test]
    fn a_corrupt_repos_file_is_backed_up_and_reset() {
        let (dir, repos) = Mock::start().repos();
        fs::write(repos.state_path(), "not json").unwrap();
        assert_eq!(repos.state().unwrap(), RepoState::default());
        let backups = fs::read_dir(dir.path()).unwrap().filter_map(Result::ok).filter(|e| e.file_name().to_string_lossy().starts_with("repos.json.corrupt-")).count();
        assert_eq!(backups, 1);
    }

    #[test]
    fn settings_persist_and_default_on_a_partial_file() {
        let (_dir, repos) = Mock::start().repos();
        fs::write(repos.state_path(), r#"{"allowOutside":true,"repos":[]}"#).unwrap();
        let state = repos.state().unwrap();
        assert_eq!((state.check_on_start, state.allow_outside), (true, true));
        repos.set_enabled(OFFICIAL_URL, true).unwrap();
        let saved: serde_json::Value = serde_json::from_str(&fs::read_to_string(repos.state_path()).unwrap()).unwrap();
        assert_eq!((saved["allowOutside"].as_bool(), saved["repos"][0]["official"].as_bool()), (Some(true), Some(true)));
    }
}
