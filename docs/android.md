# Shard on Android

Shard builds for Android with Tauri's mobile support. What a phone gets is the same app minus what only a desktop has: no tray,
global shortcut, self-updater, folder compare, or installing a plugin from a zip or a folder. Plugins install from a repository or
a URL. The layout is the phone layout: one column, a bottom bar, no sidebar or tab strip (below 640 px wide, or on Android).

## CI

`.github/workflows/android.yml` builds a debug APK on every pull request that touches `src/` or `src-tauri/`, and on demand
(Actions → Android → Run workflow). The APK is the `shard-android-debug` artifact. This job is the check that the Android build works.

## On your machine

You need Android Studio (or the command-line SDK), JDK 17, the Android NDK, and the Rust targets:

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
export ANDROID_HOME="$HOME/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"   # the version installed under ndk/

npm ci
npx tauri android init          # creates src-tauri/gen/android (not committed)
npx tauri android dev           # runs on a connected device or emulator
npx tauri android build --apk --debug --target aarch64
```

Or `task build:android`: it runs the init once and builds the debug APK. It defaults `ANDROID_HOME` to `~/Android/Sdk`, `NDK_HOME` to the newest NDK there and `JAVA_HOME` to JDK 17; export them to override.

`tauri android init` leaves the stock Tauri launcher icons in the generated project. `bash scripts/android-icons.sh` (run by `task build:android` and by CI) copies the Shard ones from `src-tauri/icons/android` over them; run it by hand after a manual `tauri android init`. `npm run icon` does not touch `src-tauri/icons/android`; after a brand change run `npx tauri icon src-tauri/app-icon.png` to refresh it.

The phone build trusts the root certificates bundled in the app (`webpki-root-certs`), not the phone's certificate store, because reqwest's Android verifier needs a JNI setup the app doesn't have. A CA the user installed on the phone is not trusted by repository sync or plugin downloads.

## Release builds

A release APK or AAB must be signed. Make a keystore, keep it out of the repository, and follow
[Tauri's Android signing guide](https://v2.tauri.app/distribute/sign/android/). Publishing to a store needs a Play Console account.

## Known limits

- Saving a file uses a Blob download in the webview; whether Android's WebView offers it as a download needs a check on a device.
- Plugin packages are served by a custom protocol. Android's WebView reaches it as `http://<scheme>.localhost`; plugin frames were not run on a device yet.
- iOS is not set up (it needs a Mac and an Apple developer team).
