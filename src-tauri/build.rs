fn main() {
    // tauri_build only tracks config files that already exist, so a platform file added later would never trigger a rebuild.
    for platform in ["linux", "macos", "windows", "android", "ios"] {
        println!("cargo:rerun-if-changed=tauri.{platform}.conf.json");
    }
    tauri_build::build()
}
