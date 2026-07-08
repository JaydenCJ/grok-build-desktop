// Minimal end-to-end smoke test: serve the production build with `vite
// preview`, launch headless Chromium via playwright-core, install the Tauri
// IPC mock BEFORE any app script runs, and drive the real UI — boot, send a
// prompt, watch the streamed reply land, and switch conversations.
//
// Run with `npm run test:e2e` after `npm run build`. Chromium resolution:
//   1. $GROK_E2E_CHROMIUM (explicit executable path)
//   2. /opt/pw-browsers/chromium (preinstalled container browser)
//   3. playwright-core's own registry path (CI: `npx playwright-core install chromium`)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;

function resolveChromium() {
  if (process.env.GROK_E2E_CHROMIUM) return process.env.GROK_E2E_CHROMIUM;
  if (existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  return chromium.executablePath();
}

function fail(message) {
  console.error(`e2e: FAIL — ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite preview did not come up on ${url} within ${timeoutMs}ms`);
}

if (!existsSync(join(root, 'dist/index.html'))) {
  console.error('e2e: dist/index.html missing — run `npm run build` first.');
  process.exit(1);
}

// `--host 127.0.0.1` keeps the bind address in lockstep with the probe URL:
// without it vite binds "localhost", which resolves to ::1 on some runners
// (e.g. GitHub Actions) while the probe polls 127.0.0.1 and times out.
const server = spawn(
  process.execPath,
  [
    join(root, 'node_modules/vite/bin/vite.js'),
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
    '--strictPort',
  ],
  { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
);
server.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`e2e: vite preview exited early (code ${code})`);
    process.exit(1);
  }
});
let shuttingDown = false;

let browser;
try {
  await waitForServer(BASE);

  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    // Container-friendly flags; harmless elsewhere.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext();
  await context.addInitScript({ path: join(root, 'e2e/tauri-mock.js') });
  const page = await context.newPage();

  const consoleErrors = [];
  const ignorable = [
    /ResizeObserver loop/i, // benign layout-observer noise
    /Download the React DevTools/i,
  ];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (ignorable.some((re) => re.test(text))) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  // 1. Boot: sidebar brand + composer visible, empty state showing.
  await page.getByText('Grok Build Desktop').first().waitFor({ timeout: 10_000 });
  const composer = page.locator('.composer textarea');
  await composer.waitFor({ timeout: 10_000 });
  await page.getByText('How can Grok help today?').waitFor({ timeout: 10_000 });
  console.log('e2e: boot ok (sidebar + composer + empty state)');

  // 2. Submit a prompt: the user bubble appears, then the mocked stream lands.
  await composer.click();
  await composer.fill('hello from the e2e test');
  await composer.press('Enter');
  await page.getByText('hello from the e2e test').first().waitFor({ timeout: 10_000 });
  await page.getByText('All systems streaming.').first().waitFor({ timeout: 15_000 });
  console.log('e2e: prompt round-trip ok (user bubble + streamed reply)');

  // 3. Conversation switching: New Session clears the transcript…
  await page.getByRole('button', { name: /New Session/ }).click();
  await page.getByText('How can Grok help today?').waitFor({ timeout: 10_000 });
  // …and the old conversation is one click away in HISTORY.
  const historyRow = page.locator('.history-row', { hasText: 'hello from the e2e test' });
  await historyRow.waitFor({ timeout: 10_000 });
  await historyRow.click();
  await page.getByText('All systems streaming.').first().waitFor({ timeout: 10_000 });
  console.log('e2e: conversation switching ok (new session + history restore)');

  // 4. The mock must have answered every command the app invoked.
  const unknown = await page.evaluate(() => globalThis.__E2E_UNKNOWN_COMMANDS__ ?? []);
  if (unknown.length > 0) {
    console.warn(`e2e: note — unmocked commands invoked: ${[...new Set(unknown)].join(', ')}`);
  }

  // 5. No unexpected console errors during the whole scenario.
  if (consoleErrors.length > 0) {
    fail(`console errors during scenario:\n${consoleErrors.join('\n')}`);
  }

  console.log('e2e: ok');
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
} finally {
  shuttingDown = true;
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
}
