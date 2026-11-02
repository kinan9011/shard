//! User color schemes. One `<id>.json` of CSS tokens per theme in `<app data>/themes`.
//!
//! A theme is data, never CSS: tokens come from a fixed list and values are a hex color or an
//! `H S% L%` triplet. The webview has no CSP, so nothing else may reach a stylesheet.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::paths::io_err;
use crate::plugins::repos::{repos, ThemeCatalogEntry};

pub const MAX_BYTES: u64 = 64 * 1024;

/// The schemes of src/utils/theme.ts. A user theme may not take their id.
const BUILT_IN: [&str; 8] = ["default", "adwaita", "solarized", "classic", "kate", "tango", "cobalt", "oblivion"];

/// The tokens a theme may set: those of src/index.css, without --radius and the fonts.
const TOKENS: &[&str] = &[
    "--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
    "--primary", "--primary-foreground", "--secondary", "--secondary-foreground", "--muted", "--muted-foreground",
    "--accent", "--accent-foreground", "--destructive", "--destructive-foreground", "--success", "--success-foreground",
    "--warning", "--warning-foreground", "--info", "--info-foreground", "--border", "--input", "--ring",
    "--sidebar-background", "--sidebar-foreground", "--sidebar-primary", "--sidebar-primary-foreground",
    "--sidebar-accent", "--sidebar-accent-foreground", "--sidebar-border", "--sidebar-ring",
    "--chrome-input-border", "--chrome-muted-foreground",
    "--surface-chrome", "--surface-editor", "--surface-raised", "--surface-sidebar",
    "--syntax-fn", "--syntax-kw", "--syntax-lit", "--syntax-num", "--syntax-str",
];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Theme {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    /// The repository an installed theme came from. Absent for a theme the user made or imported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub light: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dark: Option<BTreeMap<String, String>>,
}

#[derive(Serialize, Default, Debug)]
pub struct ThemeList {
    pub themes: Vec<Theme>,
    /// One line per file that could not be used, `file.json: reason`.
    pub errors: Vec<String>,
}

pub fn valid_id(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_number(text: &str) -> bool {
    !text.is_empty() && text.len() <= 7 && text.bytes().all(|b| b.is_ascii_digit() || b == b'.') && text.parse::<f32>().is_ok()
}

/// `--surface-*` and `--syntax-*` are hex colors (`#1e1e1e`). The rest are `hsl(var(--x))` triplets: `213 77% 48%`.
fn valid_value(token: &str, value: &str) -> bool {
    if token.starts_with("--surface-") || token.starts_with("--syntax-") {
        return value
            .strip_prefix('#')
            .is_some_and(|hex| matches!(hex.len(), 3 | 6) && hex.bytes().all(|b| b.is_ascii_hexdigit()));
    }
    let parts: Vec<&str> = value.split(' ').collect();
    let percent = |text: &str| text.strip_suffix('%').is_some_and(is_number);
    parts.len() == 3 && is_number(parts[0]) && percent(parts[1]) && percent(parts[2])
}

/// Parses and checks a theme file. The error names the first problem.
pub fn parse_theme(text: &str) -> Result<Theme, String> {
    let theme: Theme = serde_json::from_str(text).map_err(|error| format!("Not a theme file: {error}"))?;
    if !valid_id(&theme.id) {
        return Err("id must be 1 to 40 characters of a-z, 0-9 and -".into());
    }
    if BUILT_IN.contains(&theme.id.as_str()) {
        return Err(format!("id \"{}\" is a built-in scheme", theme.id));
    }
    if theme.name.trim().is_empty() || theme.name.chars().count() > 40 {
        return Err("name must be 1 to 40 characters".into());
    }
    if theme.light.is_none() && theme.dark.is_none() {
        return Err("needs a \"light\" or a \"dark\" block".into());
    }
    for (mode, tokens) in [("light", &theme.light), ("dark", &theme.dark)] {
        for (token, value) in tokens.iter().flat_map(|map| map.iter()) {
            if !TOKENS.contains(&token.as_str()) {
                return Err(format!("{mode}: unknown token {token}"));
            }
            if !valid_value(token, value) {
                return Err(format!("{mode}: bad value for {token}: {value}"));
            }
        }
    }
    Ok(theme)
}

fn themes_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("themes");
    std::fs::create_dir_all(&dir).map_err(io_err)?;
    Ok(dir)
}

fn read_file(path: &Path) -> Result<Theme, String> {
    if std::fs::metadata(path).map_err(io_err)?.len() > MAX_BYTES {
        return Err("larger than 64 KB".into());
    }
    parse_theme(&std::fs::read_to_string(path).map_err(io_err)?)
}

pub fn read_dir(dir: &Path) -> ThemeList {
    let mut list = ThemeList::default();
    let Ok(entries) = std::fs::read_dir(dir) else { return list };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let file = entry.file_name().to_string_lossy().into_owned();
        match read_file(&path) {
            Ok(theme) if path.file_stem().and_then(|stem| stem.to_str()) == Some(theme.id.as_str()) => list.themes.push(theme),
            Ok(theme) => list.errors.push(format!("{file}: the file must be named {}.json", theme.id)),
            Err(reason) => list.errors.push(format!("{file}: {reason}")),
        }
    }
    list.themes.sort_by_key(|theme| theme.name.to_lowercase());
    list.errors.sort();
    list
}

/// The user's themes, and what is wrong with the files that are not usable.
#[tauri::command]
pub fn theme_list(app: AppHandle) -> Result<ThemeList, String> {
    Ok(read_dir(&themes_dir(&app)?))
}

/// The themes folder, created when missing.
#[tauri::command]
pub fn theme_dir(app: AppHandle) -> Result<String, String> {
    Ok(themes_dir(&app)?.to_string_lossy().into_owned())
}

/// Asks for a theme file, checks it and copies it in. `None` when the user cancels.
#[tauri::command]
pub async fn theme_import(app: AppHandle) -> Result<Option<Theme>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dialog_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog_app.dialog().file().add_filter("Theme", &["json"]).blocking_pick_file())
        .await
        .map_err(|error| error.to_string())?;
    let Some(path) = picked.and_then(|file| file.into_path().ok()) else { return Ok(None) };
    let theme = read_file(&path)?;
    let json = serde_json::to_vec_pretty(&theme).map_err(|error| error.to_string())?;
    std::fs::write(themes_dir(&app)?.join(format!("{}.json", theme.id)), json).map_err(io_err)?;
    Ok(Some(theme))
}

/// The themes the repositories list, from their last sync.
#[tauri::command]
pub fn theme_catalog(app: AppHandle) -> Result<Vec<ThemeCatalogEntry>, String> {
    repos(&app)?.theme_catalog()
}

/// Downloads a theme of a repository, checks it against the index and adds it. Installing again updates it.
#[tauri::command]
pub async fn theme_install(app: AppHandle, repo: String, id: String) -> Result<Theme, String> {
    let repos = repos(&app)?;
    let (url, entry) = repos.theme_entry(&repo, &id)?;
    let body = repos.theme_file(&entry).await?;
    let mut theme = parse_theme(std::str::from_utf8(&body).map_err(|_| "The theme file is not text.")?)?;
    if theme.id != entry.id {
        return Err(format!("The file is the theme \"{}\", but the repository lists \"{}\".", theme.id, entry.id));
    }
    // Only a theme that came from this repository is replaced, never one the user made or imported.
    let path = themes_dir(&app)?.join(format!("{}.json", theme.id));
    if read_file(&path).is_ok_and(|existing| existing.repo.as_deref() != Some(url.as_str())) {
        return Err(format!("A theme \"{}\" is already in the themes folder. Remove it first to install this one.", theme.id));
    }
    // The index's version is the one updates compare against.
    theme.version = entry.version;
    theme.repo = Some(url);
    let json = serde_json::to_vec_pretty(&theme).map_err(|error| error.to_string())?;
    std::fs::write(path, json).map_err(io_err)?;
    Ok(theme)
}

/// Deletes a theme file. A theme that is not there is not an error.
#[tauri::command]
pub fn theme_remove(app: AppHandle, id: String) -> Result<(), String> {
    // The id becomes a file name, so it is checked before it is joined to the folder.
    if !valid_id(&id) {
        return Err("Not a theme id".into());
    }
    match std::fs::remove_file(themes_dir(&app)?.join(format!("{id}.json"))) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(io_err(error)),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r##"{"id":"nord","name":"Nord","dark":{"--background":"220 16% 22%","--surface-editor":"#2e3440","--syntax-str":"#a3be8c"}}"##;

    #[test]
    fn accepts_a_theme_and_every_listed_token_is_unique() {
        assert_eq!(parse_theme(GOOD).unwrap().id, "nord");
        let mut all = TOKENS.to_vec();
        all.sort();
        all.dedup();
        assert_eq!(all.len(), TOKENS.len());
    }

    #[test]
    fn the_example_theme_of_the_docs_is_valid() {
        let theme = parse_theme(include_str!("../../themes/example.json")).unwrap();
        assert!(theme.light.is_some() && theme.dark.is_some());
    }

    #[test]
    fn rejects_what_could_leave_the_block() {
        for bad in [
            r#""--background":"0 0% 0%; } body { display:none""#,
            r#""--background":"url(https://x.test/a.png)""#,
            r##""--background":"#fff""##,
            r##""--surface-editor":"red""##,
            r#""--radius":"0 0% 0%""#,
            r#""--font-ui":"serif""#,
        ] {
            let text = format!(r#"{{"id":"x","name":"X","light":{{{bad}}}}}"#);
            assert!(parse_theme(&text).is_err(), "{bad}");
        }
    }

    #[test]
    fn rejects_bad_ids_built_ins_and_empty_themes() {
        for text in [
            r#"{"id":"../x","name":"X","light":{}}"#,
            r#"{"id":"Nord","name":"X","light":{}}"#,
            r#"{"id":"adwaita","name":"X","light":{}}"#,
            r#"{"id":"x","name":"X"}"#,
            "not json",
        ] {
            assert!(parse_theme(text).is_err(), "{text}");
        }
    }

    #[test]
    fn lists_good_files_and_reports_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("nord.json"), GOOD).unwrap();
        std::fs::write(dir.path().join("other.json"), GOOD).unwrap();
        std::fs::write(dir.path().join("broken.json"), "{").unwrap();
        std::fs::write(dir.path().join("notes.txt"), "x").unwrap();
        let list = read_dir(dir.path());
        assert_eq!(list.themes.len(), 1);
        assert_eq!(list.errors.len(), 2);
    }
}
