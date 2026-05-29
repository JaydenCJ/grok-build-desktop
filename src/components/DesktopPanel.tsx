import { useEffect, useState } from 'react';
import {
  CAPABILITY_LABELS,
  chromeDispatch,
  desktopActivate,
  desktopQuery,
  listDesktopApps,
  type DesktopApp,
} from '../lib/desktop';

interface Props {
  onInsertContext: (text: string) => void;
}

/**
 * The Desktop dock panel — lets the user pull live state from a whitelisted
 * Mac app and paste it into the next prompt as context. Deliberately
 * minimalist: every capability is one button, the result lands in the
 * composer with a header so the model knows where it came from.
 *
 * Why not let grok directly call these? Because grok CLI's streaming-json is
 * a one-way pipe — there's no back-channel for "tool use" yet. So we expose
 * them as user-initiated commands instead, and the result becomes input on
 * the user's next turn.
 */
export function DesktopPanel({ onInsertContext }: Props) {
  const [apps, setApps] = useState<DesktopApp[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chromeCmd, setChromeCmd] = useState('');
  const [chromeNote, setChromeNote] = useState<string | null>(null);

  async function sendToChrome() {
    const text = chromeCmd.trim();
    if (!text) return;
    setChromeNote(null);
    // A URL → navigate the controlled tab; otherwise show it as an agent note.
    const isUrl = /^https?:\/\//i.test(text);
    try {
      await chromeDispatch(isUrl ? { action: 'navigate', url: text } : { action: 'note', text });
      setChromeNote(
        isUrl
          ? `Navigating controlled tab → ${text}`
          : `Sent to controlled tab: "${text}". (Load the extension + Control a tab to see it.)`,
      );
      setChromeCmd('');
    } catch (e) {
      setChromeNote(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
    // poll once every 5s to keep "running" indicators fresh — the OS doesn't
    // emit running-app events to non-privileged processes, so we sample.
    const t = window.setInterval(refresh, 5000);
    return () => window.clearInterval(t);
  }, []);

  async function refresh() {
    setApps(await listDesktopApps());
  }

  async function runCapability(action: string, appName: string) {
    setBusy(`${appName}:${action}`);
    setError(null);
    try {
      const out = await desktopQuery(action);
      const label = CAPABILITY_LABELS[action]?.label ?? action;
      const block = `\n\n[Desktop context — ${appName} · ${label}]\n${out || '(empty)'}\n`;
      onInsertContext(block);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="desktop-panel">
      <div className="desktop-head">
        <h3 className="desktop-title">Mac desktop bridge</h3>
        <p className="desktop-sub">
          Pull live state from whitelisted apps into your next prompt. Every
          query is read-only, allowlisted, and logged to{' '}
          <code>~/.grok-desktop/audit/</code>.
        </p>
      </div>
      {error ? <div className="desktop-error">{error}</div> : null}
      <div className="desktop-apps">
        {apps.map((app) => (
          <div
            key={app.bundleId}
            className={`desktop-app${app.running ? ' is-running' : ''}`}
          >
            <div className="desktop-app-head">
              <span className="desktop-app-dot" aria-hidden />
              <span className="desktop-app-name">{app.name}</span>
              <span className="desktop-app-state">
                {app.running ? 'running' : 'not running'}
              </span>
              {app.running ? (
                <button
                  type="button"
                  className="desktop-activate"
                  onClick={() => {
                    void desktopActivate(app.name).catch((e) =>
                      setError(e instanceof Error ? e.message : String(e)),
                    );
                  }}
                >
                  Bring to front
                </button>
              ) : null}
            </div>
            {app.capabilities.length === 0 ? (
              <div className="desktop-app-empty">
                No read-only queries supported yet.
              </div>
            ) : (
              <div className="desktop-caps">
                {app.capabilities.map((cap) => {
                  const meta = CAPABILITY_LABELS[cap];
                  const key = `${app.name}:${cap}`;
                  return (
                    <button
                      key={cap}
                      type="button"
                      className="desktop-cap"
                      disabled={busy !== null || !app.running}
                      onClick={() => void runCapability(cap, app.name)}
                      title={meta?.hint ?? cap}
                    >
                      {busy === key ? '…' : meta?.label ?? cap}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="desktop-chrome">
        <div className="desktop-head">
          <h3 className="desktop-title">Drive Chrome</h3>
          <p className="desktop-sub">
            Send a command to the controlled Chrome tab through the native bridge.
            A URL navigates it; other text shows as an agent note on the page.
            Requires the extension loaded + a tab in “Control”.
          </p>
        </div>
        <div className="set-inline">
          <input
            value={chromeCmd}
            placeholder="https://example.com  or  a note for the tab"
            onChange={(e) => setChromeCmd(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void sendToChrome();
              }
            }}
          />
          <button type="button" onClick={() => void sendToChrome()}>
            Send to Chrome
          </button>
        </div>
        {chromeNote ? <p className="desktop-hint">{chromeNote}</p> : null}
      </div>

      <p className="desktop-foot">
        The desktop → Chrome bridge writes <code>chrome_command.json</code>; the
        native host polls it and pushes to the extension.
      </p>
    </div>
  );
}
