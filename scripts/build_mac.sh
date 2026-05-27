#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npm install
npm run check
npm run mac:build

echo "macOS artifacts:"
find src-tauri/target/release/bundle -maxdepth 3 \( -name "*.app" -o -name "*.dmg" \) -print
