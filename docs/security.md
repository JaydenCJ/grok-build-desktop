# Security Model

How Grok Build Desktop keeps arbitrary model output and previewed project code
away from the machine-level powers the app legitimately has. This documents
what is enforced, where, and what residual risk remains.

## Layered design

The app renders three kinds of untrusted content:

1. **Model output** (assistant markdown streamed from the `grok` CLI),
2. **Previewed project files** (the generated static site in the Preview panel),
3. **CLI tool output** (inspect/models/MCP listings rendered as text).

Each is contained by a different mechanism, and the escalation path from any
of them to the IPC surface (and from IPC to the shell) is what the layers
below are designed to break.

## Webview CSP

`src-tauri/tauri.conf.json` ships this production policy:

```
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' asset: http://asset.localhost data: blob:;
media-src 'self' data: blob:; font-src 'self' data:;
connect-src 'self' ipc: http://ipc.localhost;
frame-src grokpreview: http://grokpreview.localhost;
object-src 'none'; base-uri 'self'; form-action 'none'
```

Key decisions:

- **`script-src 'self'`** — no inline scripts, no remote script origins.
  Even if HTML injection slipped past sanitization, injected `<script>` tags
  and `javascript:` URLs do not execute. Tauri adds nonces/hashes for its own
  bootstrap scripts at build time; nothing else may run.
- **`style-src 'self'`** — no `'unsafe-inline'`. This matters because
  DOMPurify's defaults keep `style="..."` attributes, so a prompt-injected
  style attribute in assistant markdown would otherwise apply (CSS-based
  exfiltration probes, spoofed UI overlays). Markup-parsed style attributes
  are now blocked. The app's own styling is entirely class-based; the one
  dynamic value (context-menu position) is written through the CSSOM
  (`element.style.left = …`), which CSP deliberately does not govern — but
  reaching the CSSOM requires script execution, which `script-src` already
  gates. `scripts/smoke_test.mjs` guards that no React `style={}` props creep
  back in.
- **Fonts are bundled** — Geist and JetBrains Mono ship via
  `@fontsource-variable` packages imported in `src/main.tsx`, so `font-src`
  needs no remote origins and the app renders identically offline.
- **`img-src` has no remote origins** — DOMPurify allows `<img>`, so an
  `https:` source would let a prompt-injected markdown image exfiltrate
  conversation data in a zero-click GET (the payload rides in the URL; no
  script, no user interaction). Remote images in chat are therefore blocked
  by design and simply do not render; local (`'self'`, `asset:`), `data:`,
  and `blob:` images still work.
- **`form-action 'none'`** — `form-action` does **not** inherit from
  `default-src`; without it, an injected `<form action="https://…">` plus a
  submit (DOMPurify keeps forms and submit buttons) is a navigation +
  exfiltration primitive. The app submits no real HTML forms.
- `devCsp` additionally allows `'unsafe-inline'` scripts and styles plus
  websockets — required by Vite HMR (the React refresh preamble is an inline
  script; HMR injects `<style>` tags). It carries the same locked-down
  `img-src` and `form-action 'none'`, and it never ships.
- The e2e smoke test (`e2e/smoke.e2e.mjs`) serves the production build with
  this exact CSP attached as a response header, so a change that starts
  depending on inline styles/scripts or remote origins fails CI as a CSP
  violation, not in a shipped build.

## Preview isolation (`grokpreview://`)

The Preview panel renders a user-chosen project's `index.html` with local CSS
and JS inlined. Running arbitrary generated JS is the feature, so isolation —
not prevention — is the goal.

- The document is served by a **Tauri custom URI scheme**
  (`register_uri_scheme_protocol("grokpreview", ...)` in `src-tauri/src/lib.rs`),
  not by `srcdoc`. `about:srcdoc` documents inherit the parent page's CSP, so a
  strict app CSP would kill the preview; documents from a real scheme carry
  their **own** `Content-Security-Policy` header (`PREVIEW_DOCUMENT_CSP`),
  which is deliberately permissive for the previewed site.
- The iframe keeps `sandbox="allow-forms allow-popups allow-scripts"` and
  deliberately omits the same-origin flag, so the preview runs in an **opaque
  origin**: no cookies/storage, and no access to Tauri IPC (`window.__TAURI__`
  is absent and `ipc:` is unreachable from that origin).
- Requests are **token-gated and root-confined**: `get_static_preview`
  registers exactly one canonicalized preview root plus a fresh random token
  per refresh; the handler 404s on a wrong/missing token (compared in
  constant time) and validates every
  subresource path with canonicalize + `starts_with(root)` (rejecting
  absolute paths, `..`, percent-encoded traversal, and backslashes). Files
  over 2 MiB are refused (`413`). A compromised renderer cannot use the
  scheme to read files outside the folder the user already chose to preview.
- Platform note: custom protocols are supported by WKWebView (macOS) and
  WebKitGTK (Linux) directly as `grokpreview://localhost/...`; Windows/Android
  map them to `http://grokpreview.localhost/...`. The backend builds the URL
  per-platform, and the app CSP `frame-src` allows both forms.
- Verification note: the scheme handler's token, traversal, and size checks
  are covered by Rust unit tests that run on any platform, but verifying the
  protocol **inside a real webview** (i.e. integration testing the actual
  Tauri binary) is only possible at runtime on macOS or Windows — the two
  targets the app ships for.

## Markdown sanitization

`marked` does not sanitize. Every worker-produced HTML string is passed
through DOMPurify (`src/lib/sanitizeHtml.ts`) before `dangerouslySetInnerHTML`
in `MessageItem`. The CSP above is the second net behind it: even a DOMPurify
bypass yields no script execution under `script-src 'self'`, and the elements
DOMPurify deliberately allows (`<img>`, `style` attributes, `<form>`) are
defanged by `img-src` (no remote origins), `style-src` (no
`'unsafe-inline'`), and `form-action 'none'` respectively.

## IPC surface

- The single Tauri capability (`src-tauri/capabilities/default.json`) applies
  to the **main window only**; no other windows exist (the agent-overlay
  window was removed).
- Commands are narrowly shaped: file access goes through `read_file_safe` /
  `glob_files` (project-scoped), MCP/skills/inspect commands run fixed `grok`
  subcommands, and the macOS desktop bridge (`desktop.rs`) is read-only,
  allowlisted, uses hard-coded AppleScript, and audits every call.
- Echoed command lines redact prompt text and `--env` values before they are
  persisted (`command_line` in `lib.rs`), so session files never store tokens.

## `run_shell_command` (Terminal panel)

`run_shell_command` executes `zsh -lc <command>` with a 600 s timeout. This is
a deliberate feature — the Terminal panel of a local developer tool — and it is
equivalent in power to the user's own terminal. Mitigations around it:

- **Reachable only from the renderer of the main window**, which is exactly
  the surface the CSP + sanitization + preview isolation layers protect. The
  realistic XSS→RCE chain (inject markup → run script in app origin → invoke
  `run_shell_command`) is broken at the script-execution step.
- **The command string is always user-visible**: it only ever comes from the
  Terminal panel's input field, and every run is echoed (as `zsh -lc "..."`)
  into the Last run / Command History views.
- **Working directory is validated** (`shell_cwd`): the cwd shown in the UI is
  canonicalized and must exist and be a directory; otherwise the command is
  refused with an explicit error instead of silently running in `$HOME`.
- No confirmation dialog is added: the command runs only on an explicit user
  click, and a blocking prompt would train users to click through.

**Residual risk, stated plainly:** any compromise that achieves arbitrary JS
in the app origin (not the preview origin) can invoke `run_shell_command` and
therefore execute code as the user. That is inherent to shipping a terminal
feature over IPC. The defense is that arbitrary JS in the app origin now
requires defeating, in order: DOMPurify, `script-src 'self'`, and the preview
origin isolation. Grok CLI runs themselves are governed separately by the
action-policy flags surfaced in the composer (review / patch / autopilot),
with autopilot clearly labeled in the UI.

## Reporting

This is a source-available project; open an issue or contact the maintainer
listed in the README for security reports.
