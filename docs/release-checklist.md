# Release checklist

How to turn a green `main` into a signed, notarized, self-updating macOS
release. Everything here that needs paid credentials (Apple Developer
Program) or long-lived secrets is deliberately **not** wired into CI yet —
this file is the single place that says exactly which switches to flip.

## 0. Current state of the repo

- `src-tauri/tauri.conf.json` ships an **inert** updater skeleton under
  `plugins.updater` (endpoint + `REPLACE_WITH_TAURI_UPDATER_PUBKEY`
  placeholder). It is inert because the `tauri-plugin-updater` crate is not a
  dependency, so nothing reads that block at runtime; dev builds, `npm run
build`, `cargo check`, and `cargo test` are unaffected. Steps 3–4 below
  make it real.
- `bundle.macOS.signingIdentity` is `"-"` (ad-hoc signing) so local
  `npm run mac:build` works without certificates.
- `bundle.createUpdaterArtifacts` is unset (off), so `tauri build` does not
  demand a signing key.

## 1. Prerequisites (one-time)

- Apple Developer Program membership (paid) for signing + notarization.
- A **Developer ID Application** certificate installed in the login keychain
  of the build machine (Xcode → Settings → Accounts → Manage Certificates,
  or developer.apple.com → Certificates).
- An App Store Connect API key **or** an app-specific password for
  notarization.
- Tauri CLI available (`npm run tauri -- --version`).

## 2. macOS signing + notarization

1. Find the identity string:

   ```sh
   security find-identity -v -p codesigning
   # → "Developer ID Application: Your Name (TEAMID)"
   ```

2. In `src-tauri/tauri.conf.json`, replace the ad-hoc identity:

   ```json
   "bundle": {
     "macOS": {
       "signingIdentity": "Developer ID Application: Your Name (TEAMID)"
     }
   }
   ```

   (Alternatively leave the file alone and export
   `APPLE_SIGNING_IDENTITY="Developer ID Application: …"`, which overrides
   the config — preferable for CI so forks keep building ad-hoc.)

3. Export notarization credentials before `tauri build` — either an API key:

   ```sh
   export APPLE_API_ISSUER="…"        # App Store Connect issuer id
   export APPLE_API_KEY="…"           # key id
   export APPLE_API_KEY_PATH="$HOME/.appstoreconnect/AuthKey_….p8"
   ```

   or an Apple ID + app-specific password:

   ```sh
   export APPLE_ID="you@example.com"
   export APPLE_PASSWORD="app-specific-password"
   export APPLE_TEAM_ID="TEAMID"
   ```

4. Build: `npm run mac:build:dmg`. Tauri signs, submits for notarization,
   and staples the ticket automatically when these env vars are present.
5. Verify: `spctl -a -vv "src-tauri/target/release/bundle/macos/Grok Build
Desktop.app"` should say `accepted · source=Notarized Developer ID`.

## 3. Updater key generation (one-time)

```sh
npm run tauri -- signer generate -w ~/.tauri/grok-build-desktop.key
```

- Prints the **public key** (base64) — commit it into
  `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, replacing
  `REPLACE_WITH_TAURI_UPDATER_PUBKEY`.
- The **private key file and its password must never be committed.** Store
  them as CI secrets:
  - `TAURI_SIGNING_PRIVATE_KEY` — the key file's contents (or a path)
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password

## 4. Wiring the updater plugin (turns the skeleton on)

1. Rust side:

   ```sh
   cd src-tauri && cargo add tauri-plugin-updater
   ```

   and register it in `src-tauri/src/lib.rs`:

   ```rust
   .plugin(tauri_plugin_updater::Builder::new().build())
   ```

2. JS side:

   ```sh
   npm install @tauri-apps/plugin-updater
   ```

3. Capability: add `"updater:default"` to
   `src-tauri/capabilities/default.json` permissions.
4. In `src-tauri/tauri.conf.json` set:

   ```json
   "bundle": { "createUpdaterArtifacts": true }
   ```

   From then on `tauri build` **requires** `TAURI_SIGNING_PRIVATE_KEY` (and
   `…_PASSWORD`) in the environment and emits `.sig` files next to the
   bundles. Do not set this flag until the keys exist, or local builds break.

5. Frontend: check for updates from the Settings page (or on boot):

   ```ts
   import { check } from '@tauri-apps/plugin-updater';
   const update = await check();
   if (update) await update.downloadAndInstall();
   ```

   Gate the check behind `hasTauriRuntime()` like every other native call,
   and treat "no updater configured / dev build" as a silent no-op so
   unsigned dev builds keep working.

## 5. GitHub release flow

1. Bump versions together: `package.json`, `src-tauri/tauri.conf.json`
   (`version`), `src-tauri/Cargo.toml` — keep them identical.
2. Tag: `git tag v0.5.0 && git push origin v0.5.0`.
3. Build the signed artifacts (locally or in a release workflow):
   `npm run tauri -- build --bundles dmg,app` with the signing +
   notarization + updater env vars from §2–§3 exported.
4. Create the GitHub release for the tag and upload:
   - the `.dmg` (user download)
   - the updater bundle (`.app.tar.gz`) and its `.sig`
   - `latest.json` — the updater manifest the configured endpoint points at:

   ```json
   {
     "version": "0.5.0",
     "notes": "…",
     "pub_date": "2026-07-08T00:00:00Z",
     "platforms": {
       "darwin-aarch64": {
         "signature": "<contents of the .sig file>",
         "url": "https://github.com/JaydenCJ/grok-build-desktop/releases/download/v0.5.0/Grok.Build.Desktop_aarch64.app.tar.gz"
       },
       "darwin-x86_64": { "signature": "…", "url": "…" }
     }
   }
   ```

   The endpoint already configured in `tauri.conf.json`
   (`releases/latest/download/latest.json`) always resolves to the newest
   release's manifest, so old installs find new versions without any server.

5. Smoke-check the manifest: `curl -sL
https://github.com/JaydenCJ/grok-build-desktop/releases/latest/download/latest.json`
   must return the JSON above.

## 6. Why the full updater config is staged, not live

Compiling `tauri-plugin-updater` in without a real public key would either
fail plugin initialization or leave a updater that can never verify a
download — both worse for unsigned dev builds than the current inert
skeleton. The placeholder pubkey is intentionally loud
(`REPLACE_WITH_TAURI_UPDATER_PUBKEY`) so step 3 cannot be forgotten once the
plugin lands.
