//! Plugin shell backend: the manifest validator (W3), the installed-plugin store (W4) and the
//! `shard-plugin://` protocol that serves a plugin's files to its sandboxed frame (W5).
//! `storage` holds the SDK's per-plugin key-value data (W6). `fetch`, `files` and `frame` back the permission-gated SDK calls (W7). `zip` installs from a zip package (W9).
//! `repos` keeps the repository list and its synced catalogs (W10). `install` downloads, verifies and installs from them, and finds updates (W11).
pub mod fetch;
pub mod files;
pub mod frame;
pub mod install;
pub mod manifest;
#[cfg(test)]
mod mock;
pub mod protocol;
pub mod repos;
pub mod storage;
pub mod store;
pub mod zip;
