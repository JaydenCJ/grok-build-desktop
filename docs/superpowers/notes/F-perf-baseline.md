# F — Performance Baseline + Verification Scenarios

**Date:** 2026-05-28
**Status:** Architecture in place; user-driven DevTools verification required for full sign-off.

## Architectural decisions that preserve UI responsiveness

These are the design-time choices that, in combination, decouple the streaming pipeline from the rest of the UI:

1. **Typed Tauri events instead of raw chunks.** Rust parses each `streaming-json` line into a `GrokEvent`, then emits `grok-desktop://run-event` with a typed payload. The frontend reducer (`applyRunEvent`) mutates exactly the fields needed in `streamStore` — no broad re-render fan-out.
2. **`useSyncExternalStore` with per-component selectors.** `StatusBar` subscribes only to `activeRun.elapsed / lastEventType`; `MessageItem` subscribes only to its own `runId.htmlVersion`; `QueueDock` subscribes only to `queue.{active, items}`. None of these subscribe to fields that change every chunk except the targeted message. So Composer, Sidebar, Tabs, Settings, Terminal pane re-render zero times during streaming.
3. **Markdown parses in a Web Worker.** Every `text` event triggers `scheduleMarkdownParse(runId, text)`, which posts the latest accumulated text to `markdown.worker.ts`. The worker runs `marked` + `highlight.js` off the main thread. When it returns HTML, `streamStore.setHtml(runId, html)` bumps `htmlVersion`, re-rendering only the active `MessageItem`. Main thread is never blocked by markdown parsing.
4. **Worker debouncing.** If a text chunk arrives while the worker is still parsing the previous one, the wrapper stashes the latest text in a `Map<runId, latestText>` and posts it the moment the worker becomes idle. No queue buildup, no head-of-line blocking on slow runs.
5. **`react-virtuoso` for the message list.** Only the visible message rows render. Long conversations (>100 messages) don't drag the frame rate.
6. **Uncontrolled `Composer` textarea.** Typing in the composer mutates a DOM ref, not React state. React doesn't re-render on every keystroke. The Composer subscribes via `useActiveRun()` + `useQueue()` only to flip Send ↔ Enqueue button label.
7. **Queue + event loop in Rust.** No JavaScript timer or polling — the Rust worker emits events as it reads stdout. Event delivery is push, not pull.
8. **Bundle split.** The markdown worker compiles into its own chunk (`dist/assets/markdown.worker-*.js`), lazy-loaded on first text event. Initial app bundle stays small.

## Current bundle sizes (measured 2026-05-28, `npm run build`)

| Asset | Size | Gzip |
|---|---|---|
| `dist/assets/index-*.js` (main) | 328.98 kB | **102.99 kB** |
| `dist/assets/markdown.worker-*.js` | 204.76 kB | ~55 kB (estimated) |
| `dist/assets/markdownWorker-*.js` (wrapper) | 0.72 kB | 0.44 kB |
| `dist/assets/index-*.css` | 46.46 kB | 8.96 kB |
| **Total (gzip)** | — | **~167 kB** |

Budget from spec: < 260 kB gzip. We are 36% under.

The main bundle actually *shrank* from 130 kB (pre-F) to 103 kB because deleting the legacy raw-chunk plumbing was worth more than the new components cost.

## Performance budgets (from spec)

| Metric | Target | How verified |
|---|---|---|
| Composer keystroke lag during streaming | p95 < 16 ms (60 fps) | User-driven (DevTools Performance) |
| Sidebar / Tabs / Settings click response | p95 < 100 ms | User-driven |
| Stop button response | p95 < 200 ms | User-driven |
| Streaming-period median frame rate | ≥ 50 fps | User-driven |
| Worker markdown parse for 5 KB text | p95 < 200 ms | User-driven (DevTools, worker thread) |
| App start → first interactive | < 2 s | User-driven |
| Bundle gzip size | < 260 kB | ✓ Measured 167 kB |

## Verification scenarios (for the user to run)

### Scenario A — Concurrent typing while streaming

1. Launch app: `npm run mac:install` (rebuilds + reinstalls into `~/Applications/`), then open `~/Applications/Grok Desktop.app`.
2. In a Chrome/Chromium browser, open the Tauri DevTools (in dev mode: `npm run tauri:dev`, right-click → Inspect Element → Performance tab).
3. Click **Record** in DevTools.
4. In the composer, paste this prompt and press Enter:
   ```
   Write a detailed 3000-word essay on the history of computing, with code examples
   in 5 languages (Python, Rust, JavaScript, Go, Haskell).
   ```
5. While text streams, immediately:
   - Type 30 seconds of continuous keystrokes in the composer (any lorem ipsum)
   - Click sidebar items 10 times
   - Click the theme toggle 5 times
   - Mid-stream, click **Stop**, then immediately re-send a fresh prompt to test enqueue-after-cancel
6. Stop the recording. Inspect:
   - **Long tasks (yellow bars > 50 ms):** should be few and clustered on the worker thread, not the main thread
   - **Main thread frame budget violations (red bars > 16 ms):** should be < 10% of frames during the 30-second typing window
   - **Frames per second** (the FPS meter at the top): should hold a median ≥ 50 fps

### Scenario B — Restart recovery

1. Send 2 short prompts in quick succession; observe one streaming, one queued (QueueDock should show `+1 queued`).
2. Force-quit the app (`Cmd+Q` or kill via Activity Monitor).
3. Re-launch the app.
4. Observe: QueueDock displays a banner `↻ Last session had N pending tasks [Resume all] [Cancel all]`.
5. Test both buttons in two separate launches:
   - **Resume all** → queued runs begin executing
   - **Cancel all** → runs marked Cancelled, no execution

### Scenario C — 7-day vacuum

Not directly verifiable in a single session. Inspect `~/Library/Application Support/Grok Desktop/runs.sqlite` after the app has been running for a week:
```bash
sqlite3 "$HOME/Library/Application Support/Grok Desktop/runs.sqlite" \
  "SELECT state, COUNT(*) FROM runs GROUP BY state;"
```
Expect no `Done`/`Cancelled`/`Failed` rows older than 7 days.

### Scenario D — Bundle size regression

```bash
cd "~/grok-build-desktop"
npm run build
```
Look at the gzip column in the output. Main bundle should stay under ~130 kB, worker bundle under ~80 kB gzip. If either crosses, investigate before merge.

## Tuning levers (if budgets are missed)

| Symptom | Lever |
|---|---|
| Main-thread frames > 16 ms during typing | Increase Worker debounce window in `markdownWorker.ts` (currently no explicit delay; can add a 16ms RAF before posting) |
| `MessageItem` re-renders too often | Tighten its memo by comparing `htmlVersion` only (currently relies on default shallow compare) |
| Virtuoso flickers on long bottom-streaming | Increase `increaseViewportBy` in `MessageList.tsx` (currently `{ top: 200, bottom: 400 }`) |
| Worker latency on huge code blocks | `markdown.worker.ts` already skips hljs for blocks > 50 KB; lower the threshold if that's still too slow |
| `StatusBar` causes parent re-renders | Confirm it mounts as a sibling of `MessageList`, not inside it. Currently sibling. |
| Bundle bloat | Switch hljs from `common` to a smaller language pack (e.g., load only the languages the user actually pastes) |

## Verdict

**Code-level architecture is in place to meet all 7 performance budgets** by construction. The bundle-size budget is met with ample headroom. The remaining 6 budgets are runtime properties that need user-driven DevTools profiling for hard verification. If any scenario fails in the user's hands, the levers above are the prescribed fixes.
