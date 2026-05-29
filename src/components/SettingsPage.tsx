import { useEffect } from 'react';

type ThemeMode = 'dark' | 'light';
type DockPosition = 'right' | 'bottom';

export type SettingsSection = 'general' | 'model' | 'permissions' | 'integrations' | 'about';

interface Option {
  value: string;
  label: string;
  detail?: string;
}

export interface SettingsPageProps {
  open: boolean;
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  onClose: () => void;

  // General
  themeMode: ThemeMode;
  setThemeMode: (t: ThemeMode) => void;
  dockPosition: DockPosition;
  setDockPosition: (d: DockPosition) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;

  // Model & reasoning
  modelOptions: Option[];
  modelPreset: string;
  onModelPreset: (id: string) => void;
  customModel: string;
  setCustomModel: (v: string) => void;
  activeModel: string;
  effortOptions: Option[];
  effortLevel: string;
  setEffortLevel: (v: string) => void;
  reasoningOptions: Option[];
  reasoningEffort: string;
  setReasoningEffort: (v: string) => void;
  bestOfN: number;
  setBestOfN: (v: number) => void;
  experimentalMemory: boolean;
  setExperimentalMemory: (v: boolean) => void;

  // Permissions & policy
  actionPolicyOptions: { value: string; label: string; detail: string; risk: 'none' | 'low' | 'high' }[];
  actionPolicy: string;
  setActionPolicy: (v: string) => void;
  permissionOptions: Option[];
  permissionMode: string;
  setPermissionMode: (v: string) => void;
  webSearchEnabled: boolean;
  setWebSearchEnabled: (v: boolean) => void;
  subagentsEnabled: boolean;
  setSubagentsEnabled: (v: boolean) => void;
  selfCheck: boolean;
  setSelfCheck: (v: boolean) => void;

  // Integrations
  codingCwd: string;
  setCodingCwd: (v: string) => void;
  onPickFolder: () => void;
  chromeExtensionId: string;
  setChromeExtensionId: (v: string) => void;
  telegramConfigured: boolean;
  chromeConnected: boolean;

  // About
  appVersion: string;
  grokVersionLine: string;
}

const NAV: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'model', label: 'Model & reasoning' },
  { id: 'permissions', label: 'Permissions & policy' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'about', label: 'About' },
];

/** A labelled row: title + description on the left, control on the right. */
function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <span className="set-row-title">{title}</span>
        {hint ? <span className="set-row-hint">{hint}</span> : null}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`set-toggle${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="set-toggle-knob" />
    </button>
  );
}

/**
 * Claude-Desktop-style Settings modal: centered card, left section nav,
 * scrollable content on the right. All app configuration lives here — moved
 * out of the cramped inspector dock and the header toolbar.
 */
export function SettingsPage(props: SettingsPageProps) {
  const { open, section, onSection, onClose } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="Settings" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <aside className="settings-nav">
          <div className="settings-nav-head">Settings</div>
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`settings-nav-item${section === n.id ? ' is-active' : ''}`}
              onClick={() => onSection(n.id)}
            >
              {n.label}
            </button>
          ))}
        </aside>

        <div className="settings-content">
          <button type="button" className="settings-close" aria-label="Close settings" onClick={onClose}>
            ✕
          </button>

          {section === 'general' ? (
            <section className="settings-section">
              <h2>General</h2>
              <Row title="Appearance" hint="Light uses a warm parchment palette; dark is graphite.">
                <div className="set-segmented">
                  <button
                    type="button"
                    className={props.themeMode === 'dark' ? 'is-active' : ''}
                    onClick={() => props.setThemeMode('dark')}
                  >
                    Dark
                  </button>
                  <button
                    type="button"
                    className={props.themeMode === 'light' ? 'is-active' : ''}
                    onClick={() => props.setThemeMode('light')}
                  >
                    Light
                  </button>
                </div>
              </Row>
              <Row title="Dock position" hint="Where the Tools / Terminal docks attach.">
                <select value={props.dockPosition} onChange={(e) => props.setDockPosition(e.currentTarget.value as DockPosition)}>
                  <option value="right">Right</option>
                  <option value="bottom">Bottom</option>
                </select>
              </Row>
              <Row title="Collapse sidebar by default" hint="Hide the left rail to focus on the conversation (⌘B toggles).">
                <Toggle checked={props.sidebarCollapsed} onChange={props.setSidebarCollapsed} label="Collapse sidebar" />
              </Row>
            </section>
          ) : null}

          {section === 'model' ? (
            <section className="settings-section">
              <h2>Model &amp; reasoning</h2>
              <Row title="Model" hint={`Active engine: ${props.activeModel}`}>
                <select value={props.modelPreset} onChange={(e) => props.onModelPreset(e.currentTarget.value)}>
                  {props.modelOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              {props.modelPreset === 'custom' ? (
                <Row title="Custom model id" hint="Any model id your Grok CLI accepts.">
                  <input
                    value={props.customModel}
                    placeholder="e.g. grok-4.3-latest"
                    onChange={(e) => props.setCustomModel(e.currentTarget.value)}
                  />
                </Row>
              ) : null}
              <Row title="Effort" hint="How hard Grok works per turn.">
                <select value={props.effortLevel} onChange={(e) => props.setEffortLevel(e.currentTarget.value)}>
                  {props.effortOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row title="Reasoning effort" hint="Extra thinking budget on hard code paths.">
                <select value={props.reasoningEffort} onChange={(e) => props.setReasoningEffort(e.currentTarget.value)}>
                  {props.reasoningOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row title="Best-of-N" hint="Run the task N ways in parallel and keep the best (headless).">
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={props.bestOfN}
                  onChange={(e) => props.setBestOfN(Math.max(1, Math.min(5, Number(e.currentTarget.value) || 1)))}
                />
              </Row>
              <Row title="Cross-session memory" hint="Experimental: let Grok remember across sessions.">
                <Toggle checked={props.experimentalMemory} onChange={props.setExperimentalMemory} label="Experimental memory" />
              </Row>
            </section>
          ) : null}

          {section === 'permissions' ? (
            <section className="settings-section">
              <h2>Permissions &amp; policy</h2>
              <Row title="Action policy" hint="How much Grok is allowed to do on its own.">
                <select value={props.actionPolicy} onChange={(e) => props.setActionPolicy(e.currentTarget.value)}>
                  {props.actionPolicyOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              {(() => {
                const cur = props.actionPolicyOptions.find((o) => o.value === props.actionPolicy);
                if (!cur) return null;
                return (
                  <p className={`set-policy-detail risk-${cur.risk}`}>
                    {cur.risk === 'high' ? '⚠ ' : ''}
                    {cur.detail}
                  </p>
                );
              })()}
              <Row title="Permission mode" hint="Advanced: maps to grok --permission-mode (Plan/Autopilot override this).">
                <select value={props.permissionMode} onChange={(e) => props.setPermissionMode(e.currentTarget.value)}>
                  {props.permissionOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row title="Web search" hint="Allow Grok to fetch current docs / version-sensitive facts.">
                <Toggle checked={props.webSearchEnabled} onChange={props.setWebSearchEnabled} label="Web search" />
              </Row>
              <Row title="Subagents" hint="Let Grok fan work out to parallel subagents.">
                <Toggle checked={props.subagentsEnabled} onChange={props.setSubagentsEnabled} label="Subagents" />
              </Row>
              <Row title="Self-check" hint="Append grok --check self-verification loop (headless).">
                <Toggle checked={props.selfCheck} onChange={props.setSelfCheck} label="Self-check" />
              </Row>
            </section>
          ) : null}

          {section === 'integrations' ? (
            <section className="settings-section">
              <h2>Integrations</h2>
              <Row title="Project folder" hint="Working directory Grok runs in (coding mode).">
                <div className="set-inline">
                  <input
                    value={props.codingCwd}
                    placeholder="/path/to/your/project"
                    onChange={(e) => props.setCodingCwd(e.currentTarget.value)}
                  />
                  <button type="button" onClick={props.onPickFolder}>
                    Pick…
                  </button>
                </div>
              </Row>
              <Row title="Chrome extension id" hint="32-char id from chrome://extensions for the native bridge.">
                <input
                  value={props.chromeExtensionId}
                  placeholder="abcdefghijklmnopabcdefghijklmnop"
                  onChange={(e) => props.setChromeExtensionId(e.currentTarget.value)}
                />
              </Row>
              <Row title="Chrome bridge" hint="Native messaging host connection status.">
                <span className={`set-status ${props.chromeConnected ? 'is-on' : 'is-off'}`}>
                  {props.chromeConnected ? 'Connected' : 'Not connected'}
                </span>
              </Row>
              <Row title="Telegram remote" hint="Set TELEGRAM_BOT_TOKEN + allowlist in .env to enable.">
                <span className={`set-status ${props.telegramConfigured ? 'is-on' : 'is-off'}`}>
                  {props.telegramConfigured ? 'Configured' : 'Disabled'}
                </span>
              </Row>
            </section>
          ) : null}

          {section === 'about' ? (
            <section className="settings-section">
              <h2>About</h2>
              <div className="set-about">
                <div className="set-about-mark">G</div>
                <div>
                  <div className="set-about-name">Grok Desktop</div>
                  <div className="set-about-ver">v{props.appVersion}</div>
                  <div className="set-about-grok">{props.grokVersionLine}</div>
                </div>
              </div>
              <p className="set-about-blurb">
                A premium desktop client for the Grok Build CLI — non-blocking streaming, multi-session
                tabs, prompt library, Telegram remote control, and a Chrome companion bridge.
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
