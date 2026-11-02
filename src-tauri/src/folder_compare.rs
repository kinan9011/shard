//! Path-confined file-system helpers for the Diff & Merge folder mode.
//!
//! Every path that reaches the disk comes from the web UI as a root plus a relative path. Nothing
//! is read, written or deleted until `resolve_inside` has shown that it stays inside its root.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::UNIX_EPOCH;

use crate::paths::io_err;
pub use crate::paths::resolve_inside;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Relative to the scanned root, with `/` separators.
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: u64,
}

pub const MAX_ENTRIES: usize = 100_000;
const CHUNK: usize = 64 * 1024;

/// Lists every file and folder under `root`, without following symlinks.
pub fn scan(root: &Path) -> Result<Vec<FileEntry>, String> {
    scan_limited(root, MAX_ENTRIES)
}

fn scan_limited(root: &Path, max: usize) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    let mut stack = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        for item in fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))? {
            let item = item.map_err(io_err)?;
            let meta = fs::symlink_metadata(item.path()).map_err(io_err)?;
            if meta.file_type().is_symlink() {
                continue;
            }
            // A name that is not valid UTF-8 cannot round-trip through the UI, so it is skipped.
            let Some(name) = item.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let path = format!("{prefix}{name}");
            if entries.len() >= max {
                return Err("Folder has more than 100,000 files.".into());
            }
            if meta.is_dir() {
                stack.push((item.path(), format!("{path}/")));
            }
            entries.push(FileEntry {
                path,
                is_dir: meta.is_dir(),
                size: if meta.is_dir() { 0 } else { meta.len() },
                modified_ms: meta
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_millis() as u64),
            });
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

/// Fills `buf` as far as the file allows and returns the byte count.
fn read_full(file: &mut fs::File, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        let n = file.read(&mut buf[filled..])?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    Ok(filled)
}

/// True when both files hold the same bytes. Compares sizes first, then 64 KiB chunks.
pub fn same_content(a: &Path, b: &Path) -> std::io::Result<bool> {
    if fs::metadata(a)?.len() != fs::metadata(b)?.len() {
        return Ok(false);
    }
    let (mut fa, mut fb) = (fs::File::open(a)?, fs::File::open(b)?);
    let (mut ba, mut bb) = (vec![0u8; CHUNK], vec![0u8; CHUNK]);
    loop {
        let (na, nb) = (read_full(&mut fa, &mut ba)?, read_full(&mut fb, &mut bb)?);
        if na != nb || ba[..na] != bb[..nb] {
            return Ok(false);
        }
        if na == 0 {
            return Ok(true);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Merge, journal and undo
// ---------------------------------------------------------------------------------------------

/// The wire names are the variant names (`"ToRight"`), as `src/lib/desktop.ts` sends them.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
pub enum MergeAction {
    ToRight,
    ToLeft,
}

#[derive(Deserialize)]
pub struct MergeOp {
    pub path: String,
    pub action: MergeAction,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    pub copied_right: Vec<String>,
    pub copied_left: Vec<String>,
    pub backed_up: Vec<String>,
    pub journal: String,
    pub backup_dir: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UndoReport {
    pub restored: usize,
    pub removed: usize,
    pub unrestorable: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Side {
    Left,
    Right,
}

impl Side {
    fn name(self) -> &'static str {
        match self {
            Side::Left => "left",
            Side::Right => "right",
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalEntry {
    /// The side that was written to.
    side: Side,
    /// Path relative to that side's root. Undo resolves the destination from this, not from `dest`.
    rel: String,
    /// Absolute destination, for people reading the journal.
    dest: String,
    existed: bool,
    /// Backup of the replaced file, relative to the run folder.
    backup: Option<String>,
    /// Directories the merge created, relative to the side's root, deepest first.
    created_dirs: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Journal {
    left_root: String,
    right_root: String,
    entries: Vec<JournalEntry>,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// `path` relative to `root`, with `/` separators. Both come from `resolve_inside`.
fn rel_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|rel| rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
        .unwrap_or_default()
}

fn write_journal(path: &Path, journal: &Journal) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(journal).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(io_err)
}

/// Directories on the way to `dest` that do not exist yet, deepest first, relative to `root`.
fn missing_dirs(root: &Path, dest: &Path) -> Vec<String> {
    let mut dirs = Vec::new();
    let mut dir = dest.parent();
    while let Some(current) = dir {
        if current == root || fs::symlink_metadata(current).is_ok() {
            break;
        }
        dirs.push(rel_string(root, current));
        dir = current.parent();
    }
    dirs
}

/// Copies each file from one side to the other. Everything is validated before the first write.
/// With `backup`, a file that would be replaced is first copied into the run folder.
/// A failure part-way rolls the finished steps back.
pub fn apply_ops(left: &Path, right: &Path, ops: &[MergeOp], work_dir: &Path, backup: bool) -> Result<MergeReport, String> {
    let left = left.canonicalize().map_err(io_err)?;
    let right = right.canonicalize().map_err(io_err)?;
    if left == right {
        return Err("Pick two different folders.".into());
    }

    // (source, destination, destination side, relative path)
    let mut plan = Vec::new();
    let mut seen = HashSet::new();
    let mut seen_targets = HashSet::new();
    for op in ops {
        let (from, to, side) = match op.action {
            MergeAction::ToRight => (&left, &right, Side::Right),
            MergeAction::ToLeft => (&right, &left, Side::Left),
        };
        let source = resolve_inside(from, &op.path)?;
        let dest = resolve_inside(to, &op.path)?;
        let rel = rel_string(from, &source);
        // Two ops on one path would share a backup file, so the second would overwrite the first.
        // The canonical destination also catches a symlink, or a case-insensitive name, that
        // reaches a file another op already writes.
        let target = dest.canonicalize().unwrap_or_else(|_| dest.clone());
        if !seen.insert(rel.clone()) || !seen_targets.insert(target) {
            return Err(format!("Path appears twice: {}", op.path));
        }
        if !source.is_file() {
            return Err(format!("Missing source file: {}", op.path));
        }
        if dest.is_dir() {
            return Err(format!("A folder is in the way: {}", op.path));
        }
        plan.push((source, dest, side, rel));
    }

    fs::create_dir_all(work_dir).map_err(io_err)?;
    let stamp = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
    let run = (0..)
        .find_map(|n| {
            let name = if n == 0 { stamp.to_string() } else { format!("{stamp}-{n}") };
            let run = work_dir.join(name);
            match fs::create_dir(&run) {
                Ok(()) => Some(Ok(run)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => None,
                Err(error) => Some(Err(io_err(error))),
            }
        })
        .unwrap_or_else(|| Err("No run folder.".into()))?;
    let journal_path = run.join("journal.json");

    let mut journal = Journal { left_root: path_string(&left), right_root: path_string(&right), entries: Vec::new() };
    let mut report = MergeReport {
        copied_right: Vec::new(),
        copied_left: Vec::new(),
        backed_up: Vec::new(),
        journal: path_string(&journal_path),
        backup_dir: None,
    };

    for (source, dest, side, rel) in plan {
        let root = if side == Side::Right { &right } else { &left };
        let existed = dest.exists();
        let backup_rel = (existed && backup).then(|| format!("backup/{}/{rel}", side.name()));
        let created_dirs = missing_dirs(root, &dest);
        let fail = |journal: &Journal, error: String| -> String {
            let rolled_back = write_journal(&journal_path, journal).and_then(|()| undo(&journal_path));
            match rolled_back {
                Ok(report) if report.unrestorable.is_empty() => format!("Merge stopped and was rolled back: {error}"),
                Ok(report) => format!(
                    "Merge stopped: {error}. These files were replaced and could not be restored: {}.",
                    report.unrestorable.join(", ")
                ),
                Err(undo_error) => format!("Merge failed ({error}) and could not be rolled back ({undo_error})."),
            }
        };
        // The entry is journaled only once its backup exists, so a rollback never looks for a
        // backup that was not made.
        if let Some(backup_rel) = &backup_rel {
            let target = run.join(backup_rel);
            let made = fs::create_dir_all(target.parent().unwrap_or(&run))
                .and_then(|()| fs::copy(&dest, &target).map(|_| ()))
                .map_err(io_err);
            if let Err(error) = made {
                return Err(fail(&journal, error));
            }
        }
        journal.entries.push(JournalEntry {
            side,
            rel: rel.clone(),
            dest: path_string(&dest),
            existed,
            backup: backup_rel.clone(),
            created_dirs,
        });
        let copied = fs::create_dir_all(dest.parent().unwrap_or(root))
            .and_then(|()| fs::copy(&source, &dest).map(|_| ()))
            .map_err(io_err);
        if let Err(error) = copied {
            return Err(fail(&journal, error));
        }
        if backup_rel.is_some() {
            report.backed_up.push(rel.clone());
        }
        match side {
            Side::Right => report.copied_right.push(rel),
            Side::Left => report.copied_left.push(rel),
        }
    }

    write_journal(&journal_path, &journal)?;
    if !report.backed_up.is_empty() {
        report.backup_dir = Some(path_string(&run.join("backup")));
    }
    Ok(report)
}

/// Reverses a merge from its journal, newest step first. Replaced files return from their
/// backup, files the merge created are removed, and replaced files with no backup are reported.
/// Every path is re-resolved inside its root first, so a tampered journal cannot reach outside.
pub fn undo(journal: &Path) -> Result<UndoReport, String> {
    let text = fs::read_to_string(journal).map_err(io_err)?;
    let parsed: Journal = serde_json::from_str(&text).map_err(|_| "This backup journal is not valid.".to_string())?;
    let run = journal.parent().ok_or("This backup journal is not valid.")?;
    let (left, right) = (PathBuf::from(&parsed.left_root), PathBuf::from(&parsed.right_root));

    struct Step<'a> {
        entry: &'a JournalEntry,
        dest: PathBuf,
        backup: Option<PathBuf>,
        dirs: Vec<PathBuf>,
    }
    let mut steps = Vec::new();
    for entry in &parsed.entries {
        let root = if entry.side == Side::Right { &right } else { &left };
        let backup = match &entry.backup {
            Some(rel) => {
                let confined = Path::new(rel).components().all(|c| matches!(c, Component::Normal(_)));
                if !confined {
                    return Err("This backup journal is not valid.".into());
                }
                Some(run.join(rel))
            }
            None => None,
        };
        let dirs = entry.created_dirs.iter().map(|dir| resolve_inside(root, dir)).collect::<Result<Vec<_>, _>>()?;
        steps.push(Step { entry, dest: resolve_inside(root, &entry.rel)?, backup, dirs });
    }

    let mut report = UndoReport { restored: 0, removed: 0, unrestorable: Vec::new() };
    let mut failed = false;
    for step in steps.iter().rev() {
        // A step that fails is reported as unrestorable and the rest still run, so one bad file
        // does not leave the folders half undone.
        if let Some(backup) = &step.backup {
            match fs::copy(backup, &step.dest) {
                Ok(_) => report.restored += 1,
                Err(_) => {
                    failed = true;
                    report.unrestorable.push(step.entry.rel.clone());
                }
            }
        } else if !step.entry.existed {
            match fs::remove_file(&step.dest) {
                Ok(()) => report.removed += 1,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => {
                    failed = true;
                    report.unrestorable.push(step.entry.rel.clone());
                }
            }
        } else {
            report.unrestorable.push(step.entry.rel.clone());
        }
        // Only empty directories go, so a folder the user filled since stays.
        for dir in &step.dirs {
            let _ = fs::remove_dir(dir);
        }
    }
    report.unrestorable.reverse();
    // A finished undo must not run twice: a second run would overwrite edits made since.
    if !failed {
        let _ = fs::remove_file(journal);
    }
    Ok(report)
}

// ---------------------------------------------------------------------------------------------
// Single-file read and write for the embedded text diff
// ---------------------------------------------------------------------------------------------

pub const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
const NOT_TEXT: &str = "This file is not UTF-8 text.";

/// Reads a UTF-8 text file of at most 5 MiB. Binary (NUL bytes) and non-UTF-8 files are refused.
pub fn read_text(root: &Path, rel: &str) -> Result<String, String> {
    let path = resolve_inside(root, rel)?;
    if fs::metadata(&path).map_err(io_err)?.len() > MAX_TEXT_BYTES {
        return Err("This file is larger than 5 MiB.".into());
    }
    let bytes = fs::read(&path).map_err(io_err)?;
    if bytes.contains(&0) {
        return Err(NOT_TEXT.into());
    }
    String::from_utf8(bytes).map_err(|_| NOT_TEXT.to_string())
}

/// Writes through a temporary file in the same folder, then renames it over the target.
pub fn write_text(root: &Path, rel: &str, contents: &str) -> Result<(), String> {
    let mut path = resolve_inside(root, rel)?;
    // Write through a symlink (resolve_inside proved it stays inside) instead of replacing it.
    if fs::symlink_metadata(&path).is_ok_and(|meta| meta.file_type().is_symlink()) {
        path = path.canonicalize().map_err(io_err)?;
    }
    if path.is_dir() {
        return Err("A folder is in the way.".into());
    }
    let parent = path.parent().ok_or("Invalid path.")?;
    fs::create_dir_all(parent).map_err(io_err)?;
    let name = path.file_name().ok_or("Invalid path.")?.to_string_lossy();
    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);
    let temp = parent.join(format!(".{name}.{}-{}.tmp", std::process::id(), TEMP_COUNTER.fetch_add(1, Ordering::SeqCst)));
    let result = fs::write(&temp, contents)
        .and_then(|()| match fs::metadata(&path) {
            Ok(meta) => fs::set_permissions(&temp, meta.permissions()),
            Err(_) => Ok(()),
        })
        .and_then(|()| fs::rename(&temp, &path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(io_err)
}

// ---------------------------------------------------------------------------------------------
// Tauri commands. The work runs on a blocking thread: a sync command would run on the main
// thread and freeze the window during a large scan or merge.
// ---------------------------------------------------------------------------------------------

pub(crate) async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| error.to_string())?
}

fn backups_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("diff-merge-backups"))
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await
        .ok()??;
    picked.into_path().ok().map(|path| path_string(&path))
}

#[tauri::command]
pub async fn scan_folder(root: String) -> Result<Vec<FileEntry>, String> {
    blocking(move || scan(Path::new(&root))).await
}

/// For each relative path, whether the file has the same bytes under both roots. Anything that is
/// not a regular file on both sides (a folder, a missing file) counts as different.
pub fn compare_paths(left: &Path, right: &Path, paths: &[String]) -> Result<Vec<bool>, String> {
    paths
        .iter()
        .map(|rel| {
            let a = resolve_inside(left, rel)?;
            let b = resolve_inside(right, rel)?;
            if !a.is_file() || !b.is_file() {
                return Ok(false);
            }
            same_content(&a, &b).map_err(|error| format!("{rel}: {error}"))
        })
        .collect()
}

#[tauri::command]
pub async fn compare_contents(left_root: String, right_root: String, paths: Vec<String>) -> Result<Vec<bool>, String> {
    blocking(move || compare_paths(Path::new(&left_root), Path::new(&right_root), &paths)).await
}

#[tauri::command]
pub async fn read_text_file(root: String, path: String) -> Result<String, String> {
    blocking(move || read_text(Path::new(&root), &path)).await
}

#[tauri::command]
pub async fn write_text_file(root: String, path: String, contents: String) -> Result<(), String> {
    blocking(move || write_text(Path::new(&root), &path, &contents)).await
}

#[tauri::command]
pub async fn apply_folder_merge(
    app: tauri::AppHandle,
    left_root: String,
    right_root: String,
    ops: Vec<MergeOp>,
    backup: bool,
) -> Result<MergeReport, String> {
    let work_dir = backups_dir(&app)?;
    blocking(move || apply_ops(Path::new(&left_root), Path::new(&right_root), &ops, &work_dir, backup)).await
}

/// The journal path comes from the web UI, so it must be a `journal.json` inside the backups
/// folder this app wrote.
#[tauri::command]
pub async fn undo_folder_merge(app: tauri::AppHandle, journal: String) -> Result<UndoReport, String> {
    let work_dir = backups_dir(&app)?;
    blocking(move || {
        let journal = Path::new(&journal).canonicalize().map_err(io_err)?;
        let inside = work_dir.canonicalize().is_ok_and(|dir| journal.starts_with(dir));
        if !inside || journal.file_name().and_then(|name| name.to_str()) != Some("journal.json") {
            return Err("This is not a backup journal from this app.".into());
        }
        undo(&journal)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A fresh, empty directory under the system temp dir. Tests remove it with `rm`.
    fn tmp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "shard-folder-compare-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn rm(dirs: &[&Path]) {
        for dir in dirs {
            let _ = fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn rejects_escaping_paths() {
        let root = tmp();
        assert!(resolve_inside(&root, "../x").is_err());
        assert!(resolve_inside(&root, "/etc/passwd").is_err());
        assert!(resolve_inside(&root, "a/../../x").is_err());
        assert!(resolve_inside(&root, "a/b.txt").unwrap().starts_with(root.canonicalize().unwrap()));
        rm(&[&root]);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_out_of_root() {
        let root = tmp();
        let outside = tmp();
        std::os::unix::fs::symlink(&outside, root.join("out")).unwrap();
        assert!(resolve_inside(&root, "out/x").is_err());
        // A dangling link is refused too, since it cannot be proven to stay inside.
        std::os::unix::fs::symlink(root.join("missing-target"), root.join("dangling")).unwrap();
        assert!(resolve_inside(&root, "dangling").is_err());
        rm(&[&root, &outside]);
    }

    #[test]
    fn scans_recursively_without_following_symlinks() {
        let root = tmp();
        fs::create_dir_all(root.join("d")).unwrap();
        fs::write(root.join("d/f.txt"), "hi").unwrap();
        #[cfg(unix)]
        {
            let outside = tmp();
            fs::write(outside.join("secret.txt"), "s").unwrap();
            std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
            std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("link.txt")).unwrap();
            let e = scan(&root).unwrap();
            assert!(e.iter().all(|x| !x.path.starts_with("link")));
            rm(&[&outside]);
        }
        let e = scan(&root).unwrap();
        assert!(e.iter().any(|x| x.path == "d/f.txt" && x.size == 2 && !x.is_dir));
        assert!(e.iter().any(|x| x.path == "d" && x.is_dir));
        rm(&[&root]);
    }

    #[test]
    fn scan_stops_past_the_limit() {
        let root = tmp();
        for name in ["a", "b", "c"] {
            fs::write(root.join(name), "x").unwrap();
        }
        assert_eq!(scan_limited(&root, 2).unwrap_err(), "Folder has more than 100,000 files.");
        assert_eq!(scan_limited(&root, 3).unwrap().len(), 3);
        rm(&[&root]);
    }

    #[test]
    fn compares_content() {
        let r = tmp();
        fs::write(r.join("a"), "x").unwrap();
        fs::write(r.join("b"), "x").unwrap();
        fs::write(r.join("c"), "y").unwrap();
        fs::write(r.join("d"), "xx").unwrap();
        assert!(same_content(&r.join("a"), &r.join("b")).unwrap());
        assert!(!same_content(&r.join("a"), &r.join("c")).unwrap());
        assert!(!same_content(&r.join("a"), &r.join("d")).unwrap());
        // Spans several 64 KiB chunks and differs only in the last byte.
        let mut big = vec![7u8; 200_000];
        fs::write(r.join("big1"), &big).unwrap();
        *big.last_mut().unwrap() = 8;
        fs::write(r.join("big2"), &big).unwrap();
        assert!(!same_content(&r.join("big1"), &r.join("big2")).unwrap());
        assert!(same_content(&r.join("big1"), &r.join("big1")).unwrap());
        rm(&[&r]);
    }

    fn op(path: &str, action: MergeAction) -> MergeOp {
        MergeOp { path: path.into(), action }
    }
    use MergeAction::{ToLeft, ToRight};

    #[test]
    fn merge_action_wire_names() {
        let op: MergeOp = serde_json::from_str(r#"{"path":"x","action":"ToRight"}"#).unwrap();
        assert_eq!(op.action, ToRight);
        let op: MergeOp = serde_json::from_str(r#"{"path":"x","action":"ToLeft"}"#).unwrap();
        assert_eq!(op.action, ToLeft);
    }

    #[test]
    fn merge_copies_backs_up_and_undoes() {
        let (l, r, w) = (tmp(), tmp(), tmp());
        fs::write(l.join("new.txt"), "L").unwrap();
        fs::write(l.join("same.txt"), "L2").unwrap();
        fs::write(r.join("same.txt"), "R2").unwrap();
        fs::create_dir_all(l.join("d")).unwrap();
        fs::write(l.join("d/deep.txt"), "D").unwrap();
        let ops = vec![op("new.txt", ToRight), op("same.txt", ToRight), op("d/deep.txt", ToRight)];
        let rep = apply_ops(&l, &r, &ops, &w, true).unwrap();
        assert_eq!(fs::read_to_string(r.join("same.txt")).unwrap(), "L2");
        assert_eq!(fs::read_to_string(r.join("d/deep.txt")).unwrap(), "D");
        assert_eq!(rep.backed_up, vec!["same.txt"]);
        assert_eq!(rep.copied_right, vec!["new.txt", "same.txt", "d/deep.txt"]);
        assert!(rep.copied_left.is_empty());
        assert!(rep.backup_dir.is_some());
        let u = undo(Path::new(&rep.journal)).unwrap();
        assert_eq!(fs::read_to_string(r.join("same.txt")).unwrap(), "R2");
        assert!(!r.join("new.txt").exists());
        assert_eq!((u.restored, u.removed), (1, 2));
        assert!(u.unrestorable.is_empty());
        rm(&[&l, &r, &w]);
    }

    #[test]
    fn merge_to_left_copies_right_to_left() {
        let (l, r, w) = (tmp(), tmp(), tmp());
        fs::write(r.join("a.txt"), "R").unwrap();
        let rep = apply_ops(&l, &r, &[op("a.txt", ToLeft)], &w, true).unwrap();
        assert_eq!(fs::read_to_string(l.join("a.txt")).unwrap(), "R");
        assert_eq!(rep.copied_left, vec!["a.txt"]);
        assert!(rep.backup_dir.is_none());
        rm(&[&l, &r, &w]);
    }

    #[test]
    fn merge_without_backup_reports_unrestorable() {
        let (l, r, w) = (tmp(), tmp(), tmp());
        fs::write(l.join("same.txt"), "L2").unwrap();
        fs::write(r.join("same.txt"), "R2").unwrap();
        let rep = apply_ops(&l, &r, &[op("same.txt", ToRight)], &w, false).unwrap();
        assert!(rep.backed_up.is_empty() && rep.backup_dir.is_none());
        let u = undo(Path::new(&rep.journal)).unwrap();
        assert_eq!(u.unrestorable, vec!["same.txt"]);
        assert_eq!((u.restored, u.removed), (0, 0));
        assert_eq!(fs::read_to_string(r.join("same.txt")).unwrap(), "L2");
        rm(&[&l, &r, &w]);
    }

    #[test]
    fn merge_rejects_escaping_op() {
        let (l, r, w) = (tmp(), tmp(), tmp());
        fs::write(l.join("ok.txt"), "L").unwrap();
        let ops = [op("ok.txt", ToRight), op("../x", ToRight)];
        assert!(apply_ops(&l, &r, &ops, &w, true).is_err());
        // Validation runs first, so the good op was not applied either.
        assert!(!r.join("ok.txt").exists());
        assert_eq!(fs::read_dir(&w).unwrap().count(), 0);
        rm(&[&l, &r, &w]);
    }

    #[test]
    fn merge_rejects_bad_ops_before_writing() {
        let (l, r, w) = (tmp(), tmp(), tmp());
        fs::write(l.join("a.txt"), "L").unwrap();
        fs::create_dir_all(r.join("dir")).unwrap();
        fs::create_dir_all(l.join("dir")).unwrap();
        // Missing source, duplicate path, directory as source or destination, same root twice.
        assert!(apply_ops(&l, &r, &[op("nope.txt", ToRight)], &w, true).is_err());
        assert!(apply_ops(&l, &r, &[op("a.txt", ToRight), op("a.txt", ToLeft)], &w, true).is_err());
        assert!(apply_ops(&l, &r, &[op("dir", ToRight)], &w, true).is_err());
        fs::write(l.join("dir.f"), "x").unwrap();
        fs::create_dir_all(r.join("dir.f")).unwrap();
        assert!(apply_ops(&l, &r, &[op("dir.f", ToRight)], &w, true).is_err());
        assert!(apply_ops(&l, &l, &[op("a.txt", ToRight)], &w, true).is_err());
        assert_eq!(fs::read_dir(&w).unwrap().count(), 0);
        rm(&[&l, &r, &w]);
    }

    #[cfg(unix)]
    #[test]
    fn merge_rejects_dest_through_symlink() {
        let (l, r, w, outside) = (tmp(), tmp(), tmp(), tmp());
        fs::create_dir_all(l.join("out")).unwrap();
        fs::write(l.join("out/x.txt"), "L").unwrap();
        std::os::unix::fs::symlink(&outside, r.join("out")).unwrap();
        assert!(apply_ops(&l, &r, &[op("out/x.txt", ToRight)], &w, true).is_err());
        assert!(!outside.join("x.txt").exists());
        rm(&[&l, &r, &w, &outside]);
    }

    #[test]
    fn undo_removes_directories_it_created() {
        let (l, r, w) = (tmp(), tmp(), tmp());
        fs::create_dir_all(l.join("a/b")).unwrap();
        fs::write(l.join("a/b/c.txt"), "C").unwrap();
        fs::create_dir_all(r.join("keep")).unwrap();
        fs::create_dir_all(l.join("keep")).unwrap();
        fs::write(l.join("keep/k.txt"), "K").unwrap();
        let ops = [op("a/b/c.txt", ToRight), op("keep/k.txt", ToRight)];
        let rep = apply_ops(&l, &r, &ops, &w, true).unwrap();
        undo(Path::new(&rep.journal)).unwrap();
        assert!(!r.join("a").exists());
        assert!(r.join("keep").is_dir());
        assert!(!r.join("keep/k.txt").exists());
        rm(&[&l, &r, &w]);
    }

    #[test]
    fn undo_ignores_journal_paths_outside_roots() {
        let (l, r, w, outside) = (tmp(), tmp(), tmp(), tmp());
        fs::write(l.join("a.txt"), "L").unwrap();
        let rep = apply_ops(&l, &r, &[op("a.txt", ToRight)], &w, true).unwrap();
        fs::write(outside.join("victim.txt"), "keep me").unwrap();
        // Tamper with the journal so the entry points at a file outside both roots.
        let text = fs::read_to_string(&rep.journal).unwrap();
        let mut json: serde_json::Value = serde_json::from_str(&text).unwrap();
        json["entries"][0]["rel"] = "../../".into();
        json["entries"][0]["dest"] = outside.join("victim.txt").to_string_lossy().into_owned().into();
        fs::write(&rep.journal, json.to_string()).unwrap();
        assert!(undo(Path::new(&rep.journal)).is_err());
        assert_eq!(fs::read_to_string(outside.join("victim.txt")).unwrap(), "keep me");
        rm(&[&l, &r, &w, &outside]);
    }

    #[test]
    fn read_text_rejects_non_utf8_and_nul() {
        let r = tmp();
        fs::write(r.join("ok.txt"), "héllo").unwrap();
        fs::write(r.join("bad.bin"), [0xff, 0xfe, 0x41]).unwrap();
        fs::write(r.join("nul.bin"), b"a\0b").unwrap();
        assert_eq!(read_text(&r, "ok.txt").unwrap(), "héllo");
        assert_eq!(read_text(&r, "bad.bin").unwrap_err(), "This file is not UTF-8 text.");
        assert_eq!(read_text(&r, "nul.bin").unwrap_err(), "This file is not UTF-8 text.");
        assert!(read_text(&r, "../x").is_err());
        let big = fs::File::create(r.join("big.txt")).unwrap();
        big.set_len(MAX_TEXT_BYTES + 1).unwrap();
        assert_eq!(read_text(&r, "big.txt").unwrap_err(), "This file is larger than 5 MiB.");
        rm(&[&r]);
    }

    #[test]
    fn write_text_replaces_atomically_and_stays_inside() {
        let r = tmp();
        fs::write(r.join("a.txt"), "old").unwrap();
        write_text(&r, "a.txt", "new").unwrap();
        write_text(&r, "sub/b.txt", "fresh").unwrap();
        assert_eq!(fs::read_to_string(r.join("a.txt")).unwrap(), "new");
        assert_eq!(fs::read_to_string(r.join("sub/b.txt")).unwrap(), "fresh");
        assert!(write_text(&r, "../evil.txt", "x").is_err());
        assert!(write_text(&r, "/tmp/evil.txt", "x").is_err());
        // No temp files left behind.
        assert_eq!(fs::read_dir(&r).unwrap().count(), 2);
        rm(&[&r]);
    }

    /// Merges a.txt then b.txt, with b.txt made unreadable (`mode`) on the source or destination side. Returns the error text.
    #[cfg(unix)]
    fn failing_second_step(mode: u32, on_source: bool, backup: bool) -> (String, PathBuf, Vec<PathBuf>) {
        use std::os::unix::fs::PermissionsExt;
        let (l, r, w) = (tmp(), tmp(), tmp());
        for name in ["a.txt", "b.txt"] {
            fs::write(l.join(name), format!("L-{name}")).unwrap();
            fs::write(r.join(name), format!("R-{name}")).unwrap();
        }
        let broken = if on_source { l.join("b.txt") } else { r.join("b.txt") };
        fs::set_permissions(&broken, fs::Permissions::from_mode(mode)).unwrap();
        let ops = [op("a.txt", ToRight), op("b.txt", ToRight)];
        let error = apply_ops(&l, &r, &ops, &w, backup).unwrap_err();
        fs::set_permissions(&broken, fs::Permissions::from_mode(0o644)).unwrap();
        (error, r.clone(), vec![l, r, w])
    }

    #[cfg(unix)]
    #[test]
    fn rollback_after_a_failed_copy_restores_earlier_steps() {
        // The source b.txt is unreadable: its backup is made, then the copy fails.
        let (error, r, dirs) = failing_second_step(0o000, true, true);
        assert!(error.starts_with("Merge stopped and was rolled back"), "{error}");
        assert_eq!(fs::read_to_string(r.join("a.txt")).unwrap(), "R-a.txt");
        assert_eq!(fs::read_to_string(r.join("b.txt")).unwrap(), "R-b.txt");
        rm(&dirs.iter().map(PathBuf::as_path).collect::<Vec<_>>());
    }

    #[cfg(unix)]
    #[test]
    fn rollback_after_a_failed_backup_still_restores_earlier_steps() {
        // The destination b.txt is unreadable: its backup fails before it is journaled.
        let (error, r, dirs) = failing_second_step(0o000, false, true);
        assert!(error.starts_with("Merge stopped and was rolled back"), "{error}");
        assert_eq!(fs::read_to_string(r.join("a.txt")).unwrap(), "R-a.txt");
        rm(&dirs.iter().map(PathBuf::as_path).collect::<Vec<_>>());
    }

    #[cfg(unix)]
    #[test]
    fn failed_merge_without_backup_does_not_claim_a_rollback() {
        let (error, r, dirs) = failing_second_step(0o000, true, false);
        assert!(error.contains("could not be restored: a.txt"), "{error}");
        assert!(!error.contains("rolled back"), "{error}");
        assert_eq!(fs::read_to_string(r.join("a.txt")).unwrap(), "L-a.txt");
        rm(&dirs.iter().map(PathBuf::as_path).collect::<Vec<_>>());
    }

    #[test]
    fn undo_runs_once_and_keeps_going_past_a_lost_backup() {
        let (l, r, w) = (tmp(), tmp(), tmp());
        for name in ["a.txt", "b.txt"] {
            fs::write(l.join(name), "L").unwrap();
            fs::write(r.join(name), "R").unwrap();
        }
        let ops = [op("a.txt", ToRight), op("b.txt", ToRight)];
        let rep = apply_ops(&l, &r, &ops, &w, true).unwrap();
        let backup_dir = PathBuf::from(rep.backup_dir.unwrap());
        fs::remove_file(backup_dir.join("right/b.txt")).unwrap();
        let u = undo(Path::new(&rep.journal)).unwrap();
        assert_eq!((u.restored, u.unrestorable), (1, vec!["b.txt".to_string()]));
        assert_eq!(fs::read_to_string(r.join("a.txt")).unwrap(), "R");
        // The journal is kept, since one step failed and can be retried.
        assert!(Path::new(&rep.journal).exists());
        rm(&[&l, &r, &w]);
    }

    #[test]
    fn a_finished_undo_cannot_be_replayed() {
        let (l, r, w) = (tmp(), tmp(), tmp());
        fs::write(l.join("a.txt"), "L").unwrap();
        fs::write(r.join("a.txt"), "R").unwrap();
        let rep = apply_ops(&l, &r, &[op("a.txt", ToRight)], &w, true).unwrap();
        undo(Path::new(&rep.journal)).unwrap();
        fs::write(r.join("a.txt"), "edited later").unwrap();
        assert!(undo(Path::new(&rep.journal)).is_err());
        assert_eq!(fs::read_to_string(r.join("a.txt")).unwrap(), "edited later");
        rm(&[&l, &r, &w]);
    }

    #[cfg(unix)]
    #[test]
    fn merge_rejects_two_paths_to_one_destination() {
        let (l, r, w) = (tmp(), tmp(), tmp());
        fs::write(l.join("link.txt"), "1").unwrap();
        fs::write(l.join("real.txt"), "2").unwrap();
        fs::write(r.join("real.txt"), "R").unwrap();
        std::os::unix::fs::symlink(r.join("real.txt"), r.join("link.txt")).unwrap();
        let ops = [op("link.txt", ToRight), op("real.txt", ToRight)];
        assert!(apply_ops(&l, &r, &ops, &w, true).is_err());
        assert_eq!(fs::read_to_string(r.join("real.txt")).unwrap(), "R");
        rm(&[&l, &r, &w]);
    }

    #[test]
    fn compare_paths_treats_folders_and_missing_files_as_different() {
        let (l, r) = (tmp(), tmp());
        fs::write(l.join("same"), "x").unwrap();
        fs::write(r.join("same"), "x").unwrap();
        fs::create_dir_all(l.join("dir")).unwrap();
        fs::write(r.join("dir"), "x").unwrap();
        fs::write(l.join("only-left"), "x").unwrap();
        let paths = ["same", "dir", "only-left"].map(String::from);
        assert_eq!(compare_paths(&l, &r, &paths).unwrap(), vec![true, false, false]);
        assert!(compare_paths(&l, &r, &["../x".to_string()]).is_err());
        rm(&[&l, &r]);
    }

    #[cfg(unix)]
    #[test]
    fn write_text_writes_through_a_symlink_inside_the_root() {
        let r = tmp();
        fs::write(r.join("real.txt"), "old").unwrap();
        std::os::unix::fs::symlink(r.join("real.txt"), r.join("cfg")).unwrap();
        write_text(&r, "cfg", "new").unwrap();
        assert_eq!(fs::read_to_string(r.join("real.txt")).unwrap(), "new");
        assert!(fs::symlink_metadata(r.join("cfg")).unwrap().file_type().is_symlink());
        rm(&[&r]);
    }
}
