#!/usr/bin/env bash
# `tauri android init` leaves the template launcher icons in the generated project. Put the Shard ones
# (src-tauri/icons/android, made by `tauri icon`) over them. Idempotent; run after `tauri android init`.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
res="$root/src-tauri/gen/android/app/src/main/res"

test -d "$res" || { echo "android-icons: $res is missing; run 'tauri android init' first" >&2; exit 1; }

cp -r "$root/src-tauri/icons/android/." "$res/"
# The template's own adaptive-icon pieces (the Android robot) would shadow ours.
rm -f "$res/drawable-v24/ic_launcher_foreground.xml" "$res/drawable/ic_launcher_background.xml"
echo "android-icons: Shard launcher icons copied into $res"
