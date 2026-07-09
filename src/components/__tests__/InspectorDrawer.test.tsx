// ARIA contract of the inspector's tab strip: a real tablist whose buttons
// are role=tab with aria-selected (not aria-pressed toggles), pointing at the
// single tabpanel body.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InspectorDrawer } from '../InspectorDrawer';
import type { useGrokRunners } from '../../hooks/useGrokRunners';
import type { useModelConfig } from '../../hooks/useModelConfig';
import { inspectorTabs } from '../../app/constants';

const runnersStub = {
  busyRunner: null,
  contextBusy: null,
  grokStatus: null,
  ecosystemRun: null,
  modelsRun: null,
  mcpRun: null,
  mcpDoctorRun: null,
  pluginsRun: null,
  sessionsRun: null,
  refreshGrokAuthStatus: vi.fn(),
  refreshGrokModels: vi.fn(),
  refreshGrokEcosystem: vi.fn(),
  refreshGrokMcp: vi.fn(),
  doctorGrokMcp: vi.fn(),
  refreshGrokPlugins: vi.fn(),
  refreshGrokSessions: vi.fn(),
  startGrokLogin: vi.fn(),
} as unknown as ReturnType<typeof useGrokRunners>;

const modelConfigStub = {
  modelPreset: 'grok-build',
  customModel: '',
  setCustomModel: vi.fn(),
  effortLevel: 'high',
  setEffortLevel: vi.fn(),
  reasoningEffort: 'off',
  setReasoningEffort: vi.fn(),
  permissionMode: 'default',
  setPermissionMode: vi.fn(),
  bestOfN: 1,
  setBestOfN: vi.fn(),
  experimentalMemory: false,
  setExperimentalMemory: vi.fn(),
  webSearchEnabled: false,
  setWebSearchEnabled: vi.fn(),
  subagentsEnabled: false,
  setSubagentsEnabled: vi.fn(),
  selfCheck: false,
  setSelfCheck: vi.fn(),
  activeModel: 'grok-build',
  activeModelMeta: { label: 'Grok Build', detail: 'stub detail' },
  activeReasoningLabel: 'Auto',
  changeModelPreset: vi.fn(),
} as unknown as ReturnType<typeof useModelConfig>;

function renderDrawer(overrides: { setInspectorTab?: (tab: string) => void } = {}) {
  const setInspectorTab = overrides.setInspectorTab ?? vi.fn();
  render(
    <InspectorDrawer
      open
      onOpenPanel={() => {}}
      onClose={() => {}}
      inspectorTab="skills"
      setInspectorTab={setInspectorTab as never}
      dockPosition="right"
      onDockPositionChange={() => {}}
      runners={runnersStub}
      modelConfig={modelConfigStub}
      actionPolicy="patch"
      setActionPolicy={() => {}}
      history={[]}
      lastRun={null}
      setLastRun={() => {}}
      clearRunHistory={() => {}}
      workspacePath="/repo"
      onInsertDesktopContext={() => {}}
    />,
  );
  return { setInspectorTab };
}

describe('InspectorDrawer tab semantics', () => {
  it('exposes the capability switcher as tablist/tab/aria-selected', () => {
    renderDrawer();
    const tablist = screen.getByRole('tablist');
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(inspectorTabs.length);
    for (const tab of tabs) {
      expect(tablist.contains(tab)).toBe(true);
      expect(tab).not.toHaveAttribute('aria-pressed');
      expect(tab).toHaveAttribute('aria-controls', 'inspector-tabpanel');
    }
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'MCP' })).toHaveAttribute('aria-selected', 'false');
  });

  it('labels the body as the tabpanel of the selected tab', () => {
    renderDrawer();
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'inspector-tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'inspector-tab-skills');
  });

  it('clicking a tab selects it (behavior unchanged)', async () => {
    const user = userEvent.setup();
    const { setInspectorTab } = renderDrawer();
    await user.click(screen.getByRole('tab', { name: 'MCP' }));
    expect(setInspectorTab).toHaveBeenCalledWith('mcp');
  });
});
