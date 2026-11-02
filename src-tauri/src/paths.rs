//! Shared path-confinement helpers.

use std::fs;
use std::path::{Component, Path, PathBuf};

pub fn io_err(error: std::io::Error) -> String {
    error.to_string()
}

/// Joins `rel` to `root` and proves the result stays inside the canonical root.
/// Rejects absolute paths, `..`, drive prefixes, and any symlink that leads out of the root
/// (a dangling link is refused, since it cannot be proven to stay inside).
pub fn resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rejected = || format!("Path is outside the folder: {rel}");
    let root = root.canonicalize().map_err(io_err)?;
    let mut joined = root.clone();
    for component in Path::new(rel).components() {
        match component {
            Component::Normal(part) => joined.push(part),
            Component::CurDir => {}
            _ => return Err(rejected()),
        }
    }
    // Canonicalize the deepest ancestor that exists. The rest does not exist yet, so it cannot
    // be a symlink.
    let mut ancestor = joined.as_path();
    while fs::symlink_metadata(ancestor).is_err() {
        ancestor = ancestor.parent().ok_or_else(rejected)?;
    }
    let real = ancestor.canonicalize().map_err(|_| rejected())?;
    if real.starts_with(&root) {
        Ok(joined)
    } else {
        Err(rejected())
    }
}
