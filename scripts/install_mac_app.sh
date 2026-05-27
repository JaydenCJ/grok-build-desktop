#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Grok Desktop.app"
SOURCE_APP="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME"
TARGET_DIR="${GROK_DESKTOP_INSTALL_DIR:-$HOME/Applications}"
TARGET_APP="$TARGET_DIR/$APP_NAME"

cd "$ROOT_DIR"
npm run mac:build

mkdir -p "$TARGET_DIR"
if [[ -d "$TARGET_APP" ]]; then
  osascript -e 'tell application id "com.grok.desktop" to quit' >/dev/null 2>&1 || true
  rm -rf "$TARGET_APP"
fi

ditto "$SOURCE_APP" "$TARGET_APP"
codesign --verify --deep --strict "$TARGET_APP"
if ! open "$TARGET_APP"; then
  printf 'Warning: installed app verified, but macOS did not launch it automatically. Open it from %s.\n' "$TARGET_APP" >&2
fi

printf '\nInstalled %s\n' "$TARGET_APP"
printf 'Tip: launch this installed app for day-to-day use so macOS permissions stay tied to the same bundle identifier and install path.\n'
