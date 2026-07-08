// Adapter that maps App-level state (model config, session, panels) onto
// SettingsPage's option-list props. Extracted from App.tsx unchanged.
import { SettingsPage, type SettingsSection } from "./SettingsPage";
import type { useModelConfig } from "../hooks/useModelConfig";
import type {
  ActionPolicy,
  DockPosition,
  EffortLevel,
  GrokModelId,
  PermissionMode,
  ReasoningEffort,
  ThemeMode,
} from "../app/types";
import {
  actionPolicies,
  effortLevels,
  grokModelPresets,
  permissionModes,
  reasoningEfforts,
} from "../app/constants";

export interface SettingsHostProps {
  open: boolean;
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  onClose: () => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  dockPosition: DockPosition;
  setDockPosition: (position: DockPosition) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  modelConfig: ReturnType<typeof useModelConfig>;
  actionPolicy: ActionPolicy;
  setActionPolicy: (policy: ActionPolicy) => void;
  codingCwd: string;
  setCodingCwd: (cwd: string) => void;
  onPickFolder: () => void;
  grokVersionLine: string;
}

export function SettingsHost({
  open,
  section,
  onSection,
  onClose,
  themeMode,
  setThemeMode,
  dockPosition,
  setDockPosition,
  sidebarCollapsed,
  setSidebarCollapsed,
  modelConfig,
  actionPolicy,
  setActionPolicy,
  codingCwd,
  setCodingCwd,
  onPickFolder,
  grokVersionLine,
}: SettingsHostProps) {
  const {
    modelPreset,
    customModel,
    setCustomModel,
    effortLevel,
    setEffortLevel,
    reasoningEffort,
    setReasoningEffort,
    permissionMode,
    setPermissionMode,
    bestOfN,
    setBestOfN,
    experimentalMemory,
    setExperimentalMemory,
    webSearchEnabled,
    setWebSearchEnabled,
    subagentsEnabled,
    setSubagentsEnabled,
    selfCheck,
    setSelfCheck,
    activeModel,
    changeModelPreset,
    modelOptions,
  } = modelConfig;
  return (
      <SettingsPage
        open={open}
        section={section}
        onSection={onSection}
        onClose={onClose}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        dockPosition={dockPosition}
        setDockPosition={setDockPosition}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        modelOptions={modelOptions.map((id) => ({
          value: id,
          label: grokModelPresets[id as GrokModelId]?.label ?? id,
        }))}
        modelPreset={modelPreset}
        onModelPreset={(id) => changeModelPreset(id as GrokModelId)}
        customModel={customModel}
        setCustomModel={setCustomModel}
        activeModel={activeModel}
        effortOptions={(Object.keys(effortLevels) as EffortLevel[]).map((k) => ({
          value: k,
          label: effortLevels[k].label,
        }))}
        effortLevel={effortLevel}
        setEffortLevel={(v) => setEffortLevel(v as EffortLevel)}
        reasoningOptions={(Object.keys(reasoningEfforts) as ReasoningEffort[]).map((k) => ({
          value: k,
          label: reasoningEfforts[k].label,
        }))}
        reasoningEffort={reasoningEffort}
        setReasoningEffort={(v) => setReasoningEffort(v as ReasoningEffort)}
        bestOfN={bestOfN}
        setBestOfN={setBestOfN}
        experimentalMemory={experimentalMemory}
        setExperimentalMemory={setExperimentalMemory}
        actionPolicyOptions={(Object.keys(actionPolicies) as ActionPolicy[]).map((k) => ({
          value: k,
          label: actionPolicies[k].label,
          detail: actionPolicies[k].detail,
          risk: actionPolicies[k].risk,
        }))}
        actionPolicy={actionPolicy}
        setActionPolicy={(v) => setActionPolicy(v as ActionPolicy)}
        permissionOptions={(Object.keys(permissionModes) as PermissionMode[]).map((k) => ({
          value: k,
          label: permissionModes[k].label,
        }))}
        permissionMode={permissionMode}
        setPermissionMode={(v) => setPermissionMode(v as PermissionMode)}
        webSearchEnabled={webSearchEnabled}
        setWebSearchEnabled={setWebSearchEnabled}
        subagentsEnabled={subagentsEnabled}
        setSubagentsEnabled={setSubagentsEnabled}
        selfCheck={selfCheck}
        setSelfCheck={setSelfCheck}
        codingCwd={codingCwd}
        setCodingCwd={setCodingCwd}
        onPickFolder={onPickFolder}
        appVersion="0.4.0"
        grokVersionLine={grokVersionLine}
      />
  );
}
