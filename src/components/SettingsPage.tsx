import { useRef } from 'react';
import { useModalFocus } from '../hooks/useModalFocus';
import { t } from '../i18n';

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
  actionPolicyOptions: {
    value: string;
    label: string;
    detail: string;
    risk: 'none' | 'low' | 'high';
  }[];
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

  // Workspace
  codingCwd: string;
  setCodingCwd: (v: string) => void;
  onPickFolder: () => void;

  // About
  appVersion: string;
  grokVersionLine: string;
}

const NAV: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: t('settings.nav.general') },
  { id: 'model', label: t('settings.nav.model') },
  { id: 'permissions', label: t('settings.nav.permissions') },
  { id: 'integrations', label: t('settings.nav.workspace') },
  { id: 'about', label: t('settings.nav.about') },
];

/** A labelled row: title + description on the left, control on the right. */
function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
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

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
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
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  // Focus trap: Tab/Shift+Tab cycle inside the card, Escape closes, focus
  // returns to the opener on close.
  useModalFocus(open, modalRef, { initialFocus: closeRef, onEscape: onClose });

  if (!open) return null;

  return (
    <div
      className="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.title')}
      onClick={onClose}
    >
      <div
        className="settings-modal"
        ref={modalRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="settings-nav">
          <div className="settings-nav-head">{t('settings.title')}</div>
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
          <button
            ref={closeRef}
            type="button"
            className="settings-close"
            aria-label={t('settings.close')}
            onClick={onClose}
          >
            ✕
          </button>

          {section === 'general' ? (
            <section className="settings-section">
              <h2>{t('settings.nav.general')}</h2>
              <Row title={t('settings.appearance')} hint={t('settings.appearanceHint')}>
                <div className="set-segmented">
                  <button
                    type="button"
                    className={props.themeMode === 'dark' ? 'is-active' : ''}
                    onClick={() => props.setThemeMode('dark')}
                  >
                    {t('common.dark')}
                  </button>
                  <button
                    type="button"
                    className={props.themeMode === 'light' ? 'is-active' : ''}
                    onClick={() => props.setThemeMode('light')}
                  >
                    {t('common.light')}
                  </button>
                </div>
              </Row>
              <Row title={t('settings.dockPosition')} hint={t('settings.dockPositionHint')}>
                <select
                  aria-label={t('settings.dockPosition')}
                  value={props.dockPosition}
                  onChange={(e) => props.setDockPosition(e.currentTarget.value as DockPosition)}
                >
                  <option value="right">{t('common.right')}</option>
                  <option value="bottom">{t('common.bottom')}</option>
                </select>
              </Row>
              <Row
                title={t('settings.collapseSidebarTitle')}
                hint={t('settings.collapseSidebarHint')}
              >
                <Toggle
                  checked={props.sidebarCollapsed}
                  onChange={props.setSidebarCollapsed}
                  label={t('settings.collapseSidebar')}
                />
              </Row>
            </section>
          ) : null}

          {section === 'model' ? (
            <section className="settings-section">
              <h2>{t('settings.nav.model')}</h2>
              <Row
                title={t('settings.model')}
                hint={t('settings.modelHint', { model: props.activeModel })}
              >
                <select
                  aria-label={t('settings.model')}
                  value={props.modelPreset}
                  onChange={(e) => props.onModelPreset(e.currentTarget.value)}
                >
                  {props.modelOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              {props.modelPreset === 'custom' ? (
                <Row title={t('settings.customModelId')} hint={t('settings.customModelIdHint')}>
                  <input
                    aria-label={t('settings.customModelId')}
                    value={props.customModel}
                    placeholder={t('settings.customModelIdPlaceholder')}
                    onChange={(e) => props.setCustomModel(e.currentTarget.value)}
                  />
                </Row>
              ) : null}
              <Row title={t('settings.effort')} hint={t('settings.effortHint')}>
                <select
                  aria-label={t('settings.effort')}
                  value={props.effortLevel}
                  onChange={(e) => props.setEffortLevel(e.currentTarget.value)}
                >
                  {props.effortOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row title={t('settings.reasoningEffort')} hint={t('settings.reasoningEffortHint')}>
                <select
                  aria-label={t('settings.reasoningEffort')}
                  value={props.reasoningEffort}
                  onChange={(e) => props.setReasoningEffort(e.currentTarget.value)}
                >
                  {props.reasoningOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row title={t('settings.bestOfN')} hint={t('settings.bestOfNHint')}>
                <input
                  aria-label={t('settings.bestOfN')}
                  type="number"
                  min={1}
                  max={5}
                  value={props.bestOfN}
                  onChange={(e) =>
                    props.setBestOfN(Math.max(1, Math.min(5, Number(e.currentTarget.value) || 1)))
                  }
                />
              </Row>
              <Row title={t('settings.memoryTitle')} hint={t('settings.memoryHint')}>
                <Toggle
                  checked={props.experimentalMemory}
                  onChange={props.setExperimentalMemory}
                  label={t('settings.memoryToggle')}
                />
              </Row>
            </section>
          ) : null}

          {section === 'permissions' ? (
            <section className="settings-section">
              <h2>{t('settings.nav.permissions')}</h2>
              <Row title={t('settings.actionPolicy')} hint={t('settings.actionPolicyHint')}>
                <select
                  aria-label={t('settings.actionPolicy')}
                  value={props.actionPolicy}
                  onChange={(e) => props.setActionPolicy(e.currentTarget.value)}
                >
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
              <Row title={t('settings.permissionMode')} hint={t('settings.permissionModeHint')}>
                <select
                  aria-label={t('settings.permissionMode')}
                  value={props.permissionMode}
                  onChange={(e) => props.setPermissionMode(e.currentTarget.value)}
                >
                  {props.permissionOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Row>
              <Row title={t('settings.webSearch')} hint={t('settings.webSearchHint')}>
                <Toggle
                  checked={props.webSearchEnabled}
                  onChange={props.setWebSearchEnabled}
                  label={t('settings.webSearch')}
                />
              </Row>
              <Row title={t('settings.subagents')} hint={t('settings.subagentsHint')}>
                <Toggle
                  checked={props.subagentsEnabled}
                  onChange={props.setSubagentsEnabled}
                  label={t('settings.subagents')}
                />
              </Row>
              <Row title={t('settings.selfCheck')} hint={t('settings.selfCheckHint')}>
                <Toggle
                  checked={props.selfCheck}
                  onChange={props.setSelfCheck}
                  label={t('settings.selfCheck')}
                />
              </Row>
            </section>
          ) : null}

          {section === 'integrations' ? (
            <section className="settings-section">
              <h2>{t('settings.nav.workspace')}</h2>
              <Row title={t('settings.projectFolder')} hint={t('settings.projectFolderHint')}>
                <div className="set-inline">
                  <input
                    aria-label={t('settings.projectFolder')}
                    value={props.codingCwd}
                    placeholder={t('settings.projectFolderPlaceholder')}
                    onChange={(e) => props.setCodingCwd(e.currentTarget.value)}
                  />
                  <button type="button" onClick={props.onPickFolder}>
                    {t('settings.pickFolder')}
                  </button>
                </div>
              </Row>
            </section>
          ) : null}

          {section === 'about' ? (
            <section className="settings-section">
              <h2>{t('settings.nav.about')}</h2>
              <div className="set-about">
                <div className="set-about-mark">G</div>
                <div>
                  <div className="set-about-name">{t('settings.aboutName')}</div>
                  <div className="set-about-ver">
                    {t('settings.aboutVersion', { version: props.appVersion })}
                  </div>
                  <div className="set-about-grok">{props.grokVersionLine}</div>
                </div>
              </div>
              <p className="set-about-blurb">{t('settings.aboutBlurb')}</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
