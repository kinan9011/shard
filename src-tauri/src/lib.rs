//! Shard's native side. `main.rs` starts it on a desktop; on Android `run` is the entry point the generated project calls.

use std::path::PathBuf;

#[cfg(feature = "e2e")]
mod e2e;
mod folder_compare;
mod paths;
mod plugins;
mod themes;

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const FILE_NAME_HEADER: &str = "x-file-name";
const DEFAULT_FILE_NAME: &str = "download";

/// Decodes the percent-encoded file name that the web UI sends in a header.
fn file_name_from_header(value: Option<&str>) -> String {
    value
        .map(|value| percent_decode_str(value).decode_utf8_lossy().into_owned())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_FILE_NAME.into())
}

/// Asks the user where to save the file. Returns `None` when the user cancels.
fn choose_save_path(app: &AppHandle, file_name: &str) -> Result<Option<PathBuf>, String> {
    // End-to-end test builds cannot drive the native dialog, so they save into a fixed folder.
    #[cfg(feature = "e2e")]
    if let Some(dir) = std::env::var_os("SHARD_E2E_SAVE_DIR") {
        let name = std::path::Path::new(file_name)
            .file_name()
            .ok_or("Invalid file name.")?;
        return Ok(Some(PathBuf::from(dir).join(name)));
    }

    app.dialog()
        .file()
        .set_file_name(file_name)
        .blocking_save_file()
        .map(|target| target.into_path().map_err(|error| error.to_string()))
        .transpose()
}

/// Asks the user where to save a file and writes the raw request body there.
/// Returns the saved path, or `None` when the user cancels the dialog.
/// Sets the native window appearance. On macOS the sidebar material follows it,
/// so it must match the app theme. `None` follows the system.
/// The tool list that launchers such as Raycast read, written to the app data folder.
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolManifest {
    version: u32,
    app_version: String,
    scheme: String,
    tools: Vec<ManifestTool>,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct ManifestTool {
    id: String,
    name: String,
    category: String,
    #[serde(default)]
    keywords: Vec<String>,
}

const MANIFEST_FILE: &str = "tools.json";
const MAX_MANIFEST_TOOLS: usize = 500;

/// Rejects a manifest that is not a plain list of tools, so the command cannot write arbitrary data.
fn validate_manifest(manifest: &ToolManifest) -> Result<(), String> {
    let short = |text: &str, max: usize| !text.trim().is_empty() && text.len() <= max;
    if manifest.tools.is_empty() || manifest.tools.len() > MAX_MANIFEST_TOOLS {
        return Err("The tool list is empty or too long.".into());
    }
    if !short(&manifest.app_version, 32) || !short(&manifest.scheme, 32) {
        return Err("The manifest version or scheme is invalid.".into());
    }
    for tool in &manifest.tools {
        let id_ok = short(&tool.id, 64)
            && tool.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        let keywords_ok = tool.keywords.len() <= 32 && tool.keywords.iter().all(|k| short(k, 64));
        if !id_ok || !short(&tool.name, 100) || !short(&tool.category, 100) || !keywords_ok {
            return Err(format!("Invalid tool entry: {}", tool.id));
        }
    }
    Ok(())
}

/// Writes the tool list to <app data>/tools.json, through a temporary file so readers never see half a file.
#[tauri::command]
fn write_tool_manifest(app: AppHandle, manifest: ToolManifest) -> Result<(), String> {
    use tauri::Manager;
    validate_manifest(&manifest)?;
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let json = serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
    let temp = dir.join(format!("{MANIFEST_FILE}.tmp"));
    std::fs::write(&temp, json).map_err(|error| error.to_string())?;
    std::fs::rename(&temp, dir.join(MANIFEST_FILE)).map_err(|error| error.to_string())
}

/// A downloaded update installs when the user quits. The frontend owns the download, so on quit
/// the shell asks it to install, then exits once it confirms or after a timeout.
static UPDATE_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
const INSTALL_ON_QUIT_EVENT: &str = "install-update-and-quit";
const INSTALL_ON_QUIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

#[tauri::command]
fn set_update_ready(ready: bool) {
    UPDATE_READY.store(ready, std::sync::atomic::Ordering::SeqCst);
}

/// Exits after the frontend has installed the update (or failed to).
#[tauri::command]
fn quit_now(app: AppHandle) {
    QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
}

/// The folders `reset_app_data` may delete: only ones named after the app identifier, so a misconfigured
/// path can never take a parent folder with it.
fn reset_targets(dirs: impl IntoIterator<Item = Option<std::path::PathBuf>>, identifier: &str) -> Vec<std::path::PathBuf> {
    let mut out: Vec<std::path::PathBuf> = Vec::new();
    for dir in dirs.into_iter().flatten() {
        if dir.ends_with(identifier) && !out.contains(&dir) {
            out.push(dir);
        }
    }
    out
}

/// Deletes everything Shard stores. The frontend then clears its own storage and restarts, so a failure here
/// leaves both untouched and can be reported. A folder that is not there is fine; the webview's own folder
/// may be locked (Windows) and is left for the frontend's clean-up.
#[tauri::command]
fn reset_app_data(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let id = app.config().identifier.clone();
    let path = app.path();
    let data = path.app_data_dir().ok();
    let targets = reset_targets([data.clone(), path.app_local_data_dir().ok(), path.app_cache_dir().ok(), path.app_config_dir().ok()], &id);
    for dir in targets {
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            // The folder with the plugins, repositories and themes must go. The others are caches and a webview's files.
            Err(error) if Some(&dir) == data.as_ref() => return Err(format!("Could not remove {}: {error}", dir.display())),
            Err(_) => {}
        }
    }
    // A pending update must not hold the restart back.
    QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

/// Quits, installing a downloaded update first. Returns false when the quit must wait.
pub(crate) fn request_quit(app: &tauri::AppHandle) -> bool {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    if !UPDATE_READY.load(Ordering::SeqCst) || QUITTING.swap(true, Ordering::SeqCst) {
        return true;
    }
    let _ = app.emit(INSTALL_ON_QUIT_EVENT, ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(INSTALL_ON_QUIT_TIMEOUT);
        handle.exit(0);
    });
    false
}

/// The frontend opens the command palette when it receives this event.
#[cfg(desktop)]
const OPEN_PALETTE_EVENT: &str = "open-command-palette";

/// Shows the window with the command palette open, ready to search.
#[cfg(desktop)]
fn show_command_palette(app: &tauri::AppHandle) {
    use tauri::Emitter;
    show_main_window(app);
    let _ = app.emit(OPEN_PALETTE_EVENT, ());
}

/// The global shortcut hides Shard when it is in front, and otherwise brings it up searching.
#[cfg(desktop)]
fn toggle_from_shortcut(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let in_front = window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false);
        if in_front {
            let _ = window.hide();
            return;
        }
    }
    show_command_palette(app);
}

/// Replaces the global shortcut. `None` turns it off. The error text names the reason, for
/// example a combination that another app already uses.
#[cfg(desktop)]
#[tauri::command]
fn set_global_shortcut(app: AppHandle, accelerator: Option<String>) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|error| error.to_string())?;
    if let Some(accelerator) = accelerator.filter(|value| !value.trim().is_empty()) {
        let shortcut: Shortcut = accelerator
            .parse()
            .map_err(|_| format!("\"{accelerator}\" is not a valid shortcut."))?;
        shortcuts.register(shortcut).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// A phone has no global shortcuts. The command stays so the frontend's call is answered, not unknown.
#[cfg(mobile)]
#[tauri::command]
fn set_global_shortcut(_accelerator: Option<String>) -> Result<(), String> {
    Err("Global shortcuts need the desktop app.".into())
}

/// The tray menu with its labels in the app language.
#[cfg(desktop)]
fn tray_menu<M: tauri::Manager<tauri::Wry>>(manager: &M, open: &str, search: &str, quit: &str) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

    let open = MenuItem::with_id(manager, "open", open, true, None::<&str>)?;
    let search = MenuItem::with_id(manager, "search", search, true, None::<&str>)?;
    let quit = MenuItem::with_id(manager, "quit", quit, true, None::<&str>)?;
    Menu::with_items(manager, &[&open, &search, &PredefinedMenuItem::separator(manager)?, &quit])
}

/// Renames the tray menu entries when the app language changes. No tray (a Linux desktop without one, a phone) is fine.
#[tauri::command]
fn set_tray_labels(app: tauri::AppHandle, open: String, search: String, quit: String) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(tray) = app.tray_by_id("main") {
        let menu = tray_menu(&app, &open, &search, &quit).map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    #[cfg(not(desktop))]
    let _ = (app, open, search, quit);
    Ok(())
}

/// Adds the menu bar (macOS) or tray (Windows, Linux) icon. Linux desktops without a tray
/// return an error, which only means there is no icon.
#[cfg(desktop)]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::tray::TrayIconBuilder;

    let menu = tray_menu(app, "Open Shard", "Search Tools…", "Quit Shard")?;

    let builder = TrayIconBuilder::with_id("main")
        .tooltip("Shard")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "search" => show_command_palette(app),
            "quit" if request_quit(app) => app.exit(0),
            _ => {}
        });

    // macOS draws a monochrome template image in the menu bar and opens the menu on click.
    #[cfg(target_os = "macos")]
    let builder = builder
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?)
        .icon_as_template(true)
        .show_menu_on_left_click(true);

    // Windows and Linux show the app icon; a left click opens the window, a right click the menu.
    #[cfg(not(target_os = "macos"))]
    let builder = {
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
        let builder = builder.show_menu_on_left_click(false).on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
        match app.default_window_icon() {
            Some(icon) => builder.icon(icon.clone()),
            None => builder,
        }
    };
    builder.build(app)?;
    Ok(())
}

/// Brings the main window to the front, including after the window was closed or the app hidden.
#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    // Hide (Cmd+H) hides the whole app, which window.show() does not undo.
    #[cfg(target_os = "macos")]
    let _ = app.show();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn set_window_theme(window: tauri::WebviewWindow, theme: Option<String>) -> Result<(), String> {
    let theme = match theme.as_deref() {
        Some("dark") => Some(tauri::Theme::Dark),
        Some("light") => Some(tauri::Theme::Light),
        _ => None,
    };
    window.set_theme(theme).map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_file(app: AppHandle, request: Request<'_>) -> Result<Option<String>, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw file bytes.".into());
    };

    let file_name = file_name_from_header(
        request
            .headers()
            .get(FILE_NAME_HEADER)
            .and_then(|value| value.to_str().ok()),
    );

    let Some(path) = choose_save_path(&app, &file_name)? else {
        return Ok(None);
    };

    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ponytail: WebKitGTK's DMABUF renderer is slow or glitchy on NVIDIA and some Wayland setups.
    // An explicit user value still wins.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let builder = plugins::protocol::register(tauri::Builder::default());

    #[cfg(not(feature = "e2e"))]
    let builder = builder.invoke_handler(tauri::generate_handler![save_file, set_window_theme, write_tool_manifest, set_global_shortcut, set_tray_labels, set_update_ready, quit_now, reset_app_data, themes::theme_list, themes::theme_dir, themes::theme_open_dir, themes::theme_import, themes::theme_remove, themes::theme_catalog, themes::theme_install, themes::theme_preview, themes::theme_save, folder_compare::pick_folder, folder_compare::scan_folder, folder_compare::compare_contents, folder_compare::read_text_file, folder_compare::write_text_file, folder_compare::apply_folder_merge, folder_compare::undo_folder_merge, plugins::store::plugins_list, plugins::store::plugin_install_folder, plugins::store::plugin_uninstall, plugins::store::plugin_set_enabled, plugins::store::plugin_pick_folder, plugins::zip::plugin_inspect_zip, plugins::zip::plugin_install_zip, plugins::zip::plugin_stage_zip, plugins::zip::plugin_clear_drop, plugins::zip::plugin_pick_zip, plugins::store::plugin_inspect_folder, plugins::store::plugin_set_grants, plugins::storage::plugin_storage_get, plugins::storage::plugin_storage_set, plugins::fetch::plugin_fetch, plugins::files::plugin_open_file, plugins::repos::repo_list, plugins::repos::repo_add, plugins::repos::repo_remove, plugins::repos::repo_set_enabled, plugins::repos::repo_sync, plugins::repos::repo_catalog, plugins::repos::repo_bundles, plugins::repos::repo_set_settings, plugins::install::plugin_install_from_repo, plugins::install::plugin_lookup_url, plugins::install::plugin_install_from_url, plugins::install::plugin_updates, plugins::install::plugin_update]);

    #[cfg(feature = "e2e")]
    let builder = builder
        .invoke_handler(tauri::generate_handler![
            save_file,
            set_window_theme,
            write_tool_manifest,
            set_global_shortcut,
            set_tray_labels,
            set_update_ready,
            quit_now,
            reset_app_data,
            themes::theme_list,
            themes::theme_dir,
            themes::theme_open_dir,
            themes::theme_import,
            themes::theme_remove,
            themes::theme_catalog,
            themes::theme_install,
            themes::theme_preview,
            themes::theme_save,
            folder_compare::pick_folder,
            folder_compare::scan_folder,
            folder_compare::compare_contents,
            folder_compare::read_text_file,
            folder_compare::write_text_file,
            folder_compare::apply_folder_merge,
            folder_compare::undo_folder_merge,
            plugins::store::plugins_list,
            plugins::store::plugin_install_folder,
            plugins::store::plugin_uninstall,
            plugins::store::plugin_set_enabled,
            plugins::store::plugin_pick_folder,
            plugins::zip::plugin_inspect_zip,
            plugins::zip::plugin_install_zip,
            plugins::zip::plugin_stage_zip,
            plugins::zip::plugin_clear_drop,
            plugins::zip::plugin_pick_zip,
            plugins::store::plugin_inspect_folder,
            plugins::storage::plugin_storage_get,
            plugins::storage::plugin_storage_set,
            plugins::store::plugin_set_grants,
            plugins::fetch::plugin_fetch,
            plugins::files::plugin_open_file,
            plugins::repos::repo_list,
            plugins::repos::repo_add,
            plugins::repos::repo_remove,
            plugins::repos::repo_set_enabled,
            plugins::repos::repo_sync,
            plugins::repos::repo_catalog,
            plugins::repos::repo_bundles,
            plugins::repos::repo_set_settings,
            plugins::install::plugin_install_from_repo,
            plugins::install::plugin_lookup_url,
            plugins::install::plugin_install_from_url,
            plugins::install::plugin_updates,
            plugins::install::plugin_update,
            e2e::e2e_request_quit,
            e2e::e2e_report,
            e2e::e2e_saved_files,
            e2e::e2e_tool_names,
            e2e::e2e_plugin_fixtures
        ])
        .on_page_load(|webview, payload| {
            if let tauri::webview::PageLoadEvent::Finished = payload.event() {
                e2e::start_selftest(webview);
            }
        });

    // A second launch, usually from a shard:// link, focuses the running window. With the
    // deep-link feature, the plugin also passes that link on to the deep-link plugin.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        show_main_window(app);
    }));

    let builder = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        // A file dropped where nothing takes it makes the webview open it (a PDF replaces the whole app, with no way back).
        // The UI claims drops, and this is the backstop: the main window never navigates to a file.
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("no-file-navigation")
                .on_navigation(|_webview, url| url.scheme() != "file")
                .build(),
        );

    // Global shortcuts, restarting and self-updating exist on a desktop only. A phone updates through its store.
    #[cfg(desktop)]
    let builder = builder
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        toggle_from_shortcut(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    let app = builder
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;
            // Installers register the scheme on macOS, Windows, and deb/rpm. An AppImage and a
            // development build register it at run time. A failure only disables links.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            let _ = app.deep_link().register_all();
            // On a desktop a link brings the window forward. A phone opens the app itself.
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |_event| show_main_window(&handle));
            }
            // The end-to-end build never goes to the network on its own.
            #[cfg(not(feature = "e2e"))]
            plugins::install::check_on_start(app.handle().clone());
            #[cfg(desktop)]
            if let Err(error) = build_tray(app) {
                eprintln!("The tray icon is not available: {error}");
            }
            Ok(())
        })
        .on_window_event(|_window, _event| {
            // Keep the app running in the dock when the window closes on macOS.
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                api.prevent_close();
                let _ = _window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Shard");

    app.run(|_app, _event| {
        // Cmd+Q, the last window closing on Windows and Linux, or a system shutdown: install a
        // downloaded update first. A quit from quit_now or the timeout passes straight through.
        if let tauri::RunEvent::ExitRequested { api, .. } = &_event {
            if !request_quit(_app) {
                api.prevent_exit();
            }
        }

        // Show the hidden window again when the dock icon is clicked.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            show_main_window(_app);
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn reset_only_targets_folders_named_after_the_identifier_once() {
        use std::path::PathBuf;
        let id = "io.github.kinan9011.shard";
        let data = PathBuf::from("/home/u/.local/share").join(id);
        let targets = super::reset_targets([Some(data.clone()), Some(data.clone()), Some(PathBuf::from("/home/u/.cache")), None, Some(PathBuf::from("/home/u/.config/other"))], id);
        assert_eq!(targets, vec![data]);
    }

    use super::{file_name_from_header, validate_manifest, ManifestTool, ToolManifest};

    fn manifest(id: &str) -> ToolManifest {
        ToolManifest {
            version: 1,
            app_version: "2.1.0".into(),
            scheme: "shard".into(),
            tools: vec![ManifestTool {
                id: id.into(),
                name: "JSON Viewer".into(),
                category: "Development Tools".into(),
                keywords: vec!["json".into()],
            }],
        }
    }

    #[test]
    fn accepts_a_valid_manifest() {
        assert!(validate_manifest(&manifest("json-viewer")).is_ok());
    }

    #[test]
    fn rejects_unsafe_tool_ids_and_empty_lists() {
        assert!(validate_manifest(&manifest("../escape")).is_err());
        assert!(validate_manifest(&manifest("")).is_err());
        let mut empty = manifest("json-viewer");
        empty.tools.clear();
        assert!(validate_manifest(&empty).is_err());
    }

    #[test]
    fn decodes_percent_encoded_names() {
        assert_eq!(file_name_from_header(Some("qr%20code.png")), "qr code.png");
        assert_eq!(
            file_name_from_header(Some("%E5%9B%BE%E7%89%87.webp")),
            "\u{56fe}\u{7247}.webp"
        );
    }

    #[test]
    fn keeps_plain_names() {
        assert_eq!(
            file_name_from_header(Some("compressed-images.zip")),
            "compressed-images.zip"
        );
    }

    #[test]
    fn falls_back_when_the_name_is_missing_or_blank() {
        assert_eq!(file_name_from_header(None), "download");
        assert_eq!(file_name_from_header(Some("")), "download");
        assert_eq!(file_name_from_header(Some("%20")), "download");
    }

    #[test]
    fn replaces_invalid_utf8() {
        assert_eq!(file_name_from_header(Some("a%FFb.txt")), "a\u{fffd}b.txt");
    }
}
