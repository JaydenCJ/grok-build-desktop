# macOS Build

## Development

```bash
npm run mac:dev
```

## Release Bundle

```bash
npm run mac:build
```

or:

```bash
scripts/build_mac.sh
```

Artifacts are written under:

```text
src-tauri/target/release/bundle/
```

## Stable Local Install

```bash
npm run mac:install
```

This builds the release `.app` bundle, copies `Grok Desktop.app` to `~/Applications/Grok Desktop.app`, verifies the signature, and opens the installed app. Use `npm run mac:build:dmg` only when you specifically need a distributable DMG.

Use the installed app for daily testing and upgrades. macOS privacy prompts are tied to app identity, signing, and install location; repeatedly launching changing build artifacts from `target/` or `Downloads/` can make macOS treat the app as new. The local build now uses Tauri ad-hoc signing (`signingIdentity: "-"`) plus a stable install path.

Ad-hoc signing is still not the same as public distribution signing. For a polished public release, use an Apple Developer ID certificate and notarization.

## Local Verification

```bash
npm run doctor
npm run check
npm run mac:build
```

Open the installed app from `~/Applications/Grok Desktop.app` for a local smoke test.
