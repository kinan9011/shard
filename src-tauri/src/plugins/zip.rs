//! Install from a zip (W9). The zip is unpacked into `plugins/.staging`, the package root is found,
//! and the folder goes through the same install pipeline as W4. The SHA-256 of the zip file itself is
//! the package's canonical checksum.

use super::manifest::{self, Manifest};
use super::store::{run, InstalledPlugin, Limits, Source, SourceKind, Store, LIMITS};
use crate::paths::{io_err, resolve_inside};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

/// A test a repository install runs on the package's own manifest, before anything is installed.
pub(super) type ManifestCheck<'a> = dyn Fn(&Manifest) -> Result<(), String> + 'a;

/// What the install dialog shows before anything is installed.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ZipPreview {
    pub manifest: Manifest,
    /// SHA-256 of the zip file, lowercase hex.
    pub sha256: String,
    /// Entries that would be skipped (links).
    pub warnings: Vec<String>,
}

pub(super) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Copies the zip into `staging` while hashing it, and returns the copy and the hash. Everything after
/// this reads the copy, so the hash is of exactly the bytes that get unpacked even if the original
/// changes. A zip can not be much bigger than what it unpacks to, so the size limit also stops a
/// huge or endless file (a device, a pipe) from being read.
fn stage_zip(path: &Path, staging: &Path, limits: Limits) -> Result<(PathBuf, String), String> {
    let mut input = fs::File::open(path).map_err(io_err)?;
    if !input.metadata().map_err(io_err)?.is_file() {
        return Err("The zip path is not a file.".into());
    }
    fs::create_dir_all(staging).map_err(io_err)?;
    let copy = staging.join(unpack_dir() + ".zip");
    let mut output = fs::File::create(&copy).map_err(io_err)?;
    let (mut hasher, mut buf, mut total) = (Sha256::new(), vec![0u8; 64 * 1024], 0u64);
    loop {
        let n = input.read(&mut buf).map_err(io_err)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > limits.max_bytes + ZIP_OVERHEAD {
            return Err(too_big(limits));
        }
        hasher.update(&buf[..n]);
        io::Write::write_all(&mut output, &buf[..n]).map_err(io_err)?;
    }
    Ok((copy, hex(&hasher.finalize())))
}

/// Room for zip headers on top of the package size limit.
pub(super) const ZIP_OVERHEAD: u64 = 1024 * 1024;

#[cfg(test)]
fn sha256_file(path: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    io::copy(&mut fs::File::open(path).map_err(io_err)?, &mut hasher).map_err(io_err)?;
    Ok(hex(&hasher.finalize()))
}

fn too_big(limits: Limits) -> String {
    format!("The package is larger than {} MB.", limits.max_bytes / (1024 * 1024))
}

/// The relative path of a zip entry, or an error when it could leave the package folder.
/// `None` for entries to ignore (Finder and Explorer metadata).
fn entry_path(name: &str) -> Result<Option<PathBuf>, String> {
    let unsafe_path = || format!("Unsafe path in the zip: {name}");
    // Backslashes and drive letters mean different things on different systems: refuse both everywhere.
    if name.is_empty() || name.contains(['\\', '\0', ':']) {
        return Err(unsafe_path());
    }
    let path = Path::new(name.trim_end_matches('/'));
    if path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(unsafe_path());
    }
    // Metadata that Finder and Explorer add. It is not part of the package, wherever it sits.
    let junk = |c: Component| {
        let name = c.as_os_str().to_string_lossy();
        name == "__MACOSX" || name == ".DS_Store" || name == "Thumbs.db" || name.starts_with("._")
    };
    if path.components().any(junk) {
        return Ok(None);
    }
    Ok(Some(path.to_path_buf()))
}

/// Unpacks `zip_path` into `dest` and returns the package root and warnings. Sizes are counted from the
/// bytes actually written, not from the headers, so a zip bomb stops at the limit.
fn extract(zip_path: &Path, dest: &Path, limits: Limits) -> Result<(PathBuf, Vec<String>), String> {
    let mut archive = zip::ZipArchive::new(fs::File::open(zip_path).map_err(io_err)?).map_err(|error| format!("Not a valid zip file ({error})."))?;
    fs::create_dir_all(dest).map_err(io_err)?;
    let (mut files, mut dirs, mut bytes, mut warnings) = (0usize, 0usize, 0u64, Vec::new());
    for i in 0..archive.len() {
        // The raw entry is enough to read flags, so an encrypted entry is refused before any decoding.
        if archive.by_index_raw(i).map_err(|error| error.to_string())?.encrypted() {
            return Err("Encrypted zip entries are not supported.".into());
        }
        let mut entry = archive.by_index(i).map_err(|error| format!("Cannot read the zip ({error})."))?;
        let Some(rel) = entry_path(entry.name())? else { continue };
        let target = dest.join(&rel);
        if entry.is_dir() {
            dirs += 1;
            if dirs > limits.max_files {
                return Err(format!("The package has more than {} folders.", limits.max_files));
            }
            fs::create_dir_all(&target).map_err(io_err)?;
        } else if entry.unix_mode().is_some_and(|mode| !matches!(mode & 0o170000, 0 | 0o100000)) {
            // Anything but a regular file: a link, a device, a pipe.
            warnings.push(format!("Skipped {}: links and special files are not installed.", rel.display()));
        } else {
            files += 1;
            if files > limits.max_files {
                return Err(format!("The package has more than {} files.", limits.max_files));
            }
            let remaining = limits.max_bytes - bytes;
            if entry.size() > remaining {
                return Err(too_big(limits));
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(io_err)?;
            }
            // `create_new` never overwrites. (The zip reader merges entries that share a name, so this is a backstop.)
            let mut out = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|error| {
                if error.kind() == io::ErrorKind::AlreadyExists {
                    format!("The zip lists {} twice.", rel.display())
                } else {
                    io_err(error)
                }
            })?;
            let written = io::copy(&mut (&mut entry).take(remaining + 1), &mut out).map_err(io_err)?;
            if written > remaining {
                return Err(too_big(limits));
            }
            bytes += written;
        }
    }
    warnings.sort();
    Ok((package_root(dest)?, warnings))
}

/// `dest` itself when `plugin.json` is at the top, or the single top folder that holds it.
fn package_root(dest: &Path) -> Result<PathBuf, String> {
    if dest.join("plugin.json").is_file() {
        return Ok(dest.to_path_buf());
    }
    let mut entries = fs::read_dir(dest).map_err(io_err)?.collect::<Result<Vec<_>, _>>().map_err(io_err)?;
    if entries.len() == 1 {
        let inner = entries.remove(0).path();
        if inner.is_dir() && inner.join("plugin.json").is_file() {
            return Ok(inner);
        }
    }
    Err("plugin.json was not found at the top of the zip or inside a single top folder.".into())
}

/// Checks `expected` (any case) against the zip's hash, before the zip is unpacked.
pub(super) fn check_sha(actual: &str, expected: Option<&str>) -> Result<(), String> {
    match expected {
        Some(expected) if !expected.trim().eq_ignore_ascii_case(actual) => {
            Err(format!("The checksum does not match. Expected {}, the file is {actual}.", expected.trim().to_ascii_lowercase()))
        }
        _ => Ok(()),
    }
}

/// The one file a dropped zip is written to, inside `plugins/.drop`.
const DROP_FILE: &str = "dropped.zip";

impl Store {
    /// Writes the bytes of a zip dropped on the install dialog to `plugins/.drop/dropped.zip`, replacing the
    /// one from an earlier drop, and returns the path. The webview has no path for a dropped file.
    pub fn stage_drop_with(&self, bytes: &[u8], max_bytes: u64) -> Result<PathBuf, String> {
        if bytes.len() as u64 > max_bytes {
            return Err(format!("The zip is larger than {} MB.", max_bytes / (1024 * 1024)));
        }
        let dir = self.drop_dir();
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).map_err(io_err)?;
        let path = resolve_inside(&dir, DROP_FILE)?;
        fs::write(&path, bytes).map_err(io_err)?;
        Ok(path)
    }

    pub fn stage_drop(&self, bytes: &[u8]) -> Result<PathBuf, String> {
        self.stage_drop_with(bytes, LIMITS.max_bytes)
    }

    /// Removes the dropped zip, if there is one.
    pub fn clear_drop(&self) {
        let _ = fs::remove_dir_all(self.drop_dir());
    }

    pub fn inspect_zip(&self, path: &Path) -> Result<ZipPreview, String> {
        self.inspect_zip_with(path, LIMITS)
    }

    pub fn inspect_zip_with(&self, path: &Path, limits: Limits) -> Result<ZipPreview, String> {
        self.with_staging(|staging| {
            let (copy, sha256) = stage_zip(path, staging, limits)?;
            let (root, warnings) = extract(&copy, &staging.join(unpack_dir()), limits)?;
            let manifest = manifest::read(&root).map_err(|errors| errors.join("\n"))?;
            Ok(ZipPreview { manifest, sha256, warnings })
        })
    }

    pub fn install_zip(&self, path: &Path, expected_sha: Option<&str>) -> Result<InstalledPlugin, String> {
        self.install_zip_with(path, expected_sha, LIMITS)
    }

    pub fn install_zip_with(&self, path: &Path, expected_sha: Option<&str>, limits: Limits) -> Result<InstalledPlugin, String> {
        self.install_zip_as(path, expected_sha, limits, Source { kind: SourceKind::Zip, repo: None, url: None }, None)
    }

    /// The zip pipeline for any source. `check` sees the package's own manifest before anything is
    /// installed, so a repository install can compare it with what the index promised.
    pub(super) fn install_zip_as(&self, path: &Path, expected_sha: Option<&str>, limits: Limits, source: Source, check: Option<&ManifestCheck<'_>>) -> Result<InstalledPlugin, String> {
        self.with_staging(|staging| {
            let (copy, sha256) = stage_zip(path, staging, limits)?;
            check_sha(&sha256, expected_sha)?;
            let (root, warnings) = extract(&copy, &staging.join(unpack_dir()), limits)?;
            if let Some(check) = check {
                check(&manifest::read(&root).map_err(|errors| errors.join("\n"))?)?;
            }
            let plugin = self.install_tree(&root, staging, limits, source, Some(sha256))?;
            let mut all = warnings;
            all.extend(plugin.warnings.iter().cloned());
            Ok(InstalledPlugin { warnings: all, ..plugin })
        })
    }
}

fn unpack_dir() -> String {
    static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    format!("unzip-{}-{}", std::process::id(), COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst))
}

#[tauri::command]
pub async fn plugin_inspect_zip(app: tauri::AppHandle, path: String) -> Result<ZipPreview, String> {
    run(app, move |store| store.inspect_zip(Path::new(&path))).await
}

#[tauri::command]
pub async fn plugin_install_zip(app: tauri::AppHandle, path: String, expected_sha: Option<String>) -> Result<InstalledPlugin, String> {
    let repos = super::repos::repos(&app)?;
    run(app, move |store| {
        repos.require_outside()?;
        store.install_zip(Path::new(&path), expected_sha.as_deref())
    })
    .await
}

/// The bytes of a zip dropped on the install dialog (the request body), staged for `plugin_inspect_zip`.
/// Returns its path.
#[tauri::command]
pub async fn plugin_stage_zip(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the bytes of a zip file.".into());
    };
    let bytes = bytes.clone();
    run(app, move |store| store.stage_drop(&bytes).map(|path| path.to_string_lossy().into_owned())).await
}

/// Removes the dropped zip. The install flow calls it after the install (whatever the outcome) and when the dialog is cancelled or closed.
#[tauri::command]
pub async fn plugin_clear_drop(app: tauri::AppHandle) -> Result<(), String> {
    run(app, |store| {
        store.clear_drop();
        Ok(())
    })
    .await
}

/// Asks for a zip file with the native dialog. `None` when the user cancels.
#[tauri::command]
pub async fn plugin_pick_zip(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().add_filter("Plugin package", &["zip"]).blocking_pick_file())
        .await
        .ok()??;
    picked.into_path().ok().map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/plugins").join(name)
    }

    /// A zip in a temp dir. `prefix` goes in front of every package file (a top folder); `extra` adds
    /// entries as (name, bytes). `skip_manifest` leaves `plugin.json` out.
    fn make_zip(prefix: &str, extra: &[(&str, &[u8])], skip_manifest: bool) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("package.zip");
        let mut writer = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for entry in fs::read_dir(fixture("good-minimal")).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().to_string();
            if skip_manifest && name == "plugin.json" {
                continue;
            }
            writer.start_file(format!("{prefix}{name}"), options).unwrap();
            writer.write_all(&fs::read(entry.path()).unwrap()).unwrap();
        }
        for (name, bytes) in extra {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        (dir, path)
    }

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf());
        (dir, store)
    }

    fn assert_nothing_installed(data: &tempfile::TempDir, store: &Store) {
        assert!(store.list().unwrap().is_empty());
        assert!(!data.path().join("plugins/hello-tool").exists());
        assert!(!data.path().join("plugins/.staging").exists());
    }

    #[test]
    fn a_dropped_zip_is_staged_inside_the_drop_folder_and_replaced_by_the_next() {
        let (data, store) = store();
        let (_zip_dir, zip) = make_zip("", &[], false);
        let bytes = fs::read(&zip).unwrap();
        let path = store.stage_drop(&bytes).unwrap();
        assert_eq!(path.canonicalize().unwrap(), data.path().canonicalize().unwrap().join("plugins/.drop/dropped.zip"));
        assert_eq!(store.inspect_zip(&path).unwrap().manifest.id, "hello-tool");
        store.stage_drop(b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert_eq!(fs::read_dir(data.path().join("plugins/.drop")).unwrap().count(), 1);
        store.clear_drop();
        assert!(!data.path().join("plugins/.drop").exists());
        store.clear_drop();
    }

    #[test]
    fn a_dropped_zip_over_the_cap_is_refused_and_not_written() {
        let (data, store) = store();
        let error = store.stage_drop_with(&[0u8; 11], 10).unwrap_err();
        assert!(error.contains("larger than"), "{error}");
        assert!(!data.path().join("plugins/.drop").exists());
        store.stage_drop_with(&[0u8; 10], 10).unwrap();
    }

    #[test]
    fn installs_a_zip_with_the_package_at_the_top() {
        let (data, store) = store();
        let (_zip_dir, zip) = make_zip("", &[], false);
        let plugin = store.install_zip(&zip, None).unwrap();
        assert_eq!((plugin.id.as_str(), plugin.source.kind), ("hello-tool", SourceKind::Zip));
        assert!(plugin.enabled && !plugin.verified);
        assert_eq!(plugin.sha256, sha256_file(&zip).unwrap());
        assert!(data.path().join("plugins/hello-tool/index.html").is_file());
        assert!(!data.path().join("plugins/.staging").exists());
        assert_eq!(store.list().unwrap(), vec![plugin]);
    }

    #[test]
    fn installs_a_zip_with_a_single_top_folder_and_ignores_macos_metadata() {
        let (data, store) = store();
        let (_zip_dir, zip) = make_zip("hello-tool-1.0.0/", &[("__MACOSX/hello-tool-1.0.0/._index.html", b"junk")], false);
        store.install_zip(&zip, None).unwrap();
        assert!(data.path().join("plugins/hello-tool/plugin.json").is_file());
        assert!(!data.path().join("plugins/hello-tool/__MACOSX").exists());
        assert!(!data.path().join("plugins/hello-tool/hello-tool-1.0.0").exists());
    }

    #[test]
    fn finder_and_explorer_junk_is_ignored_anywhere() {
        let (data, store) = store();
        let junk: &[(&str, &[u8])] = &[(".DS_Store", b"j"), ("pkg/.DS_Store", b"j"), ("pkg/._index.html", b"j"), ("pkg/__MACOSX/x", b"j"), ("pkg/Thumbs.db", b"j")];
        let (_zip_dir, zip) = make_zip("pkg/", junk, false);
        store.install_zip(&zip, None).unwrap();
        let installed: Vec<_> = fs::read_dir(data.path().join("plugins/hello-tool")).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        assert!(installed.iter().all(|n| n == "plugin.json" || n == "index.html"), "{installed:?}");
    }

    #[test]
    fn too_many_folders_is_rejected() {
        let (data, store) = store();
        let (_zip_dir, zip) = make_zip("", &[("d1/", b""), ("d2/", b""), ("d3/", b"")], false);
        let error = store.install_zip_with(&zip, None, Limits { max_files: 2, max_bytes: LIMITS.max_bytes }).unwrap_err();
        assert!(error.contains("more than 2"), "{error}");
        assert_nothing_installed(&data, &store);
    }

    #[test]
    fn the_hash_is_of_the_staged_copy_and_a_folder_is_not_a_zip() {
        let (data, store) = store();
        let (_zip_dir, zip) = make_zip("", &[], false);
        let (copy, sha) = stage_zip(&zip, &data.path().join("stage"), LIMITS).unwrap();
        assert_eq!(sha, sha256_file(&copy).unwrap());
        assert_eq!(fs::read(&copy).unwrap(), fs::read(&zip).unwrap());
        let dir = tempfile::tempdir().unwrap();
        assert!(store.install_zip(dir.path(), None).unwrap_err().contains("not a file"));
    }

    #[test]
    fn a_reinstall_from_a_zip_is_an_update() {
        let (_data, store) = store();
        let (_a, zip) = make_zip("", &[], false);
        store.install_zip(&zip, None).unwrap();
        store.set_enabled("hello-tool", false).unwrap();
        let (_b, zip) = make_zip("", &[("extra.txt", b"x")], false);
        let updated = store.install_zip(&zip, None).unwrap();
        assert!(!updated.enabled);
        assert_eq!(store.list().unwrap().len(), 1);
    }

    #[test]
    fn zip_slip_paths_are_rejected() {
        for name in ["../evil.txt", "a/../../evil.txt", "/abs.txt", "a\\..\\evil.txt", "C:evil.txt", "./x.txt"] {
            let (data, store) = store();
            let (_zip_dir, zip) = make_zip("", &[(name, b"evil")], false);
            let error = store.install_zip(&zip, None).unwrap_err();
            assert!(error.contains("Unsafe path"), "{name}: {error}");
            assert_nothing_installed(&data, &store);
            assert!(!data.path().join("evil.txt").exists() && !data.path().parent().unwrap().join("evil.txt").exists());
        }
    }

    #[test]
    fn too_many_files_or_bytes_is_rejected() {
        let (data, store) = store();
        let (_zip_dir, zip) = make_zip("", &[("a.txt", b"12345"), ("b.txt", b"12345"), ("c.txt", b"12345")], false);
        let files = store.install_zip_with(&zip, None, Limits { max_files: 4, max_bytes: LIMITS.max_bytes }).unwrap_err();
        assert!(files.contains("more than 4 files"), "{files}");
        let bytes = store.install_zip_with(&zip, None, Limits { max_files: LIMITS.max_files, max_bytes: 10 }).unwrap_err();
        assert!(bytes.contains("larger than"), "{bytes}");
        assert_nothing_installed(&data, &store);
        store.install_zip_with(&zip, None, Limits { max_files: 8, max_bytes: LIMITS.max_bytes }).unwrap();
    }

    #[test]
    fn a_zip_that_inflates_past_the_limit_is_stopped() {
        // 2 MB of zeros packs to a few KB. The limit is on what is written, so it still trips.
        let (data, store) = store();
        let big = vec![0u8; 2 * 1024 * 1024];
        let (_zip_dir, zip) = make_zip("", &[("big.bin", &big)], false);
        assert!(fs::metadata(&zip).unwrap().len() < 100 * 1024);
        let error = store.install_zip_with(&zip, None, Limits { max_files: LIMITS.max_files, max_bytes: 1024 * 1024 }).unwrap_err();
        assert!(error.contains("larger than"), "{error}");
        assert_nothing_installed(&data, &store);
    }

    #[test]
    fn a_missing_or_ambiguous_manifest_is_rejected() {
        let (data, store) = store();
        let (_a, no_manifest) = make_zip("", &[], true);
        assert!(store.install_zip(&no_manifest, None).unwrap_err().contains("plugin.json was not found"));
        // Two top folders, or a folder next to a file, is not a single top folder.
        let (_b, two) = make_zip("one/", &[("two/x.txt", b"x")], false);
        assert!(store.install_zip(&two, None).unwrap_err().contains("plugin.json was not found"));
        let (_c, loose) = make_zip("one/", &[("loose.txt", b"x")], false);
        assert!(store.install_zip(&loose, None).unwrap_err().contains("plugin.json was not found"));
        assert_nothing_installed(&data, &store);
    }

    #[test]
    fn an_invalid_manifest_inside_a_zip_is_rejected() {
        let (data, store) = store();
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("bad.zip");
        let mut writer = zip::ZipWriter::new(fs::File::create(&bad).unwrap());
        writer.start_file("plugin.json", SimpleFileOptions::default()).unwrap();
        writer.write_all(b"{not json").unwrap();
        writer.finish().unwrap();
        assert!(store.install_zip(&bad, None).unwrap_err().starts_with("plugin.json: "));
        assert_nothing_installed(&data, &store);
    }

    #[test]
    fn not_a_zip_is_rejected() {
        let (data, store) = store();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.zip");
        fs::write(&path, "this is not a zip").unwrap();
        assert!(store.install_zip(&path, None).unwrap_err().contains("Not a valid zip"));
        assert!(store.install_zip(&dir.path().join("missing.zip"), None).is_err());
        assert_nothing_installed(&data, &store);
    }

    #[test]
    fn the_checksum_must_match_the_zip_file() {
        let (data, store) = store();
        let (_zip_dir, zip) = make_zip("", &[], false);
        let sha = sha256_file(&zip).unwrap();
        let error = store.install_zip(&zip, Some(&"0".repeat(64))).unwrap_err();
        assert!(error.contains("checksum does not match"), "{error}");
        assert_nothing_installed(&data, &store);
        // Case and surrounding space do not matter.
        let plugin = store.install_zip(&zip, Some(&format!(" {} ", sha.to_uppercase()))).unwrap();
        assert_eq!(plugin.sha256, sha);
    }

    #[test]
    fn an_encrypted_entry_is_rejected() {
        let (data, store) = store();
        let (_zip_dir, zip) = make_zip("", &[], false);
        let mut bytes = fs::read(&zip).unwrap();
        // Set the "encrypted" flag (bit 0 of the general purpose flags) in every local and central header.
        for i in 0..bytes.len() - 10 {
            match bytes[i..i + 4] {
                [0x50, 0x4b, 0x03, 0x04] => bytes[i + 6] |= 1,
                [0x50, 0x4b, 0x01, 0x02] => bytes[i + 8] |= 1,
                _ => {}
            }
        }
        fs::write(&zip, bytes).unwrap();
        let error = store.install_zip(&zip, None).unwrap_err();
        assert!(error.contains("Encrypted"), "{error}");
        assert_nothing_installed(&data, &store);
    }

    #[test]
    fn inspect_returns_the_manifest_and_hash_and_installs_nothing() {
        let (data, store) = store();
        let (_zip_dir, zip) = make_zip("pkg/", &[], false);
        let preview = store.inspect_zip(&zip).unwrap();
        assert_eq!(preview.manifest.id, "hello-tool");
        assert_eq!(preview.sha256, sha256_file(&zip).unwrap());
        assert_nothing_installed(&data, &store);
        let (_dir, bad) = make_zip("", &[], true);
        assert!(store.inspect_zip(&bad).is_err());
        assert_nothing_installed(&data, &store);
    }
}
