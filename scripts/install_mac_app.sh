#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Grok Build Desktop.app"
SOURCE_APP="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME"
TARGET_DIR="${GROK_DESKTOP_INSTALL_DIR:-$HOME/Applications}"
TARGET_APP="$TARGET_DIR/$APP_NAME"

cd "$ROOT_DIR"
# Remove the pre-rename bundle so we don't leave a stale "Grok Desktop.app"
# next to the new "Grok Build Desktop.app". Same bundle id, so permissions
# and app data carry over.
rm -rf "$TARGET_DIR/Grok Desktop.app" 2>/dev/null || true
npm run mac:build

mkdir -p "$TARGET_DIR"
if [[ -d "$TARGET_APP" ]]; then
  osascript -e 'tell application id "com.grok.desktop" to quit' >/dev/null 2>&1 || true
  rm -rf "$TARGET_APP"
fi

ditto "$SOURCE_APP" "$TARGET_APP"
codesign --verify --deep --strict "$TARGET_APP"

# Re-register with LaunchServices so `open` sees the freshly-written bundle.
# Without this, `open` can race the rewrite and fail with -600 (procNotFound)
# even though the app is perfectly valid on disk.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$TARGET_APP" >/dev/null 2>&1 || true

# Launch with one short-settle retry — the first attempt right after a bundle
# rewrite occasionally loses the LaunchServices race.
launched=0
for attempt in 1 2 3; do
  if open "$TARGET_APP" >/dev/null 2>&1; then
    launched=1
    break
  fi
  sleep 1
done
if [[ "$launched" -ne 1 ]]; then
  printf 'Warning: installed app verified, but macOS did not launch it automatically. Open it from %s.\n' "$TARGET_APP" >&2
fi

printf '\nInstalled %s\n' "$TARGET_APP"
printf 'Tip: launch this installed app for day-to-day use so macOS permissions stay tied to the same bundle identifier and install path.\n'
