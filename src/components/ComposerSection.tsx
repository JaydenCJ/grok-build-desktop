// The composer block below the chat: autopilot risk banner, the Composer
// itself, and the footer selects (mode / model / workflow / action policy /
// effort / reasoning / best-of-N) plus the inline Stop button. Extracted
// from App.tsx unchanged; run-config state rides in as the grouped
// useModelConfig result.
import { AlertTriangle, X } from "lucide-react";
import { Composer, type ComposerHandle } from "./Composer";
import type { useModelConfig } from "../hooks/useModelConfig";
import {
  isGrokModelId,
  type ActionPolicy,
  type EffortLevel,
  type Mode,
  type ReasoningEffort,
} from "../app/types";
import {
  actionPolicies,
  codingPresets,
  defaultDrafts,
  effortLevels,
  modeCopy,
  reasoningEfforts,
} from "../app/constants";
import { t } from "../i18n";

export interface ComposerSectionProps {
  composerRef: React.RefObject<ComposerHandle | null>;
  codingCwd: string;
  buildRunArgs: () => string[];
  drafts: Record<Mode, string>;
  mode: Mode;
  setDrafts: React.Dispatch<React.SetStateAction<Record<Mode, string>>>;
  switchMode: (mode: Mode) => void;
  handleEnqueued: (info: { runId: string; position: number; prompt: string; rawText?: string }) => void;
  setSessionNotice: (notice: string | null) => void;
  modelConfig: ReturnType<typeof useModelConfig>;
  availableModels: string[];
  actionPolicy: ActionPolicy;
  setActionPolicy: (policy: ActionPolicy) => void;
  codingWorkflow: string;
  applyCodingPreset: (preset: (typeof codingPresets)[number]) => void;
  grokIsRunning: boolean;
  activeRunId: string | null;
  stopRun: (runId: string) => void;
}

export function ComposerSection({
  composerRef,
  codingCwd,
  buildRunArgs,
  drafts,
  mode,
  setDrafts,
  switchMode,
  handleEnqueued,
  setSessionNotice,
  modelConfig,
  availableModels,
  actionPolicy,
  setActionPolicy,
  codingWorkflow,
  applyCodingPreset,
  grokIsRunning,
  activeRunId,
  stopRun,
}: ComposerSectionProps) {
  const {
    modelPreset,
    setModelPreset,
    setCustomModel,
    effortLevel,
    setEffortLevel,
    reasoningEffort,
    setReasoningEffort,
    bestOfN,
    setBestOfN,
    activeModel,
    changeModelPreset,
    modelOptions,
    modelIsVerified,
  } = modelConfig;
  return (
            <div className="composer-row">
              {actionPolicy === "autopilot" ? (
                <div className="autopilot-warning" role="alert">
                  <AlertTriangle size={15} />
                  <div>
                    <strong>{t('composerSection.autopilotTitle')}</strong>
                    <span>
                      It can edit files and run shell commands with{" "}
                      <code>--always-approve</code>, no confirmation. Only use this in a
                      sandbox or a disposable git checkout.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="autopilot-warning-dismiss"
                    onClick={() => setActionPolicy("patch")}
                    title={t('composerSection.autopilotSwitchTitle')}
                  >
                    {t('composerSection.autopilotSwitch')}
                  </button>
                </div>
              ) : null}
              <Composer
                ref={composerRef}
                cwd={codingCwd}
                argsBuilder={buildRunArgs}
                initialValue={drafts[mode] || defaultDrafts[mode]}
                placeholder={modeCopy[mode].placeholder}
                onTextChange={(text) => {
                  setDrafts((current) => ({ ...current, [mode]: text }));
                }}
                onEnqueued={handleEnqueued}
                onError={(message) => setSessionNotice(t('composerSection.sendFailed', { message }))}
              />
              <div className="composer-footer">
                <select
                  aria-label={t('composerSection.interactionMode')}
                  className="mode-select"
                  onChange={(event) => switchMode(event.currentTarget.value as Mode)}
                  value={mode}
                >
                  {(Object.keys(modeCopy) as Mode[]).map((item) => (
                    <option key={item} value={item}>
                      {modeCopy[item].title}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t('composerSection.grokModel')}
                  className="model-select-footer"
                  title={
                    modelIsVerified
                      ? t('composerSection.modelTitle', { model: activeModel })
                      : t('composerSection.modelUnverifiedTitle', { model: activeModel })
                  }
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (isGrokModelId(value)) {
                      changeModelPreset(value);
                    } else {
                      setModelPreset("custom");
                      setCustomModel(value);
                    }
                  }}
                  value={modelPreset === "custom" ? "custom" : modelPreset}
                >
                  {modelOptions.map((id) => {
                    const verified = availableModels.length === 0 || availableModels.includes(id);
                    return (
                      <option key={id} value={id}>
                        {verified ? id : t('composerSection.modelNotInCli', { id })}
                      </option>
                    );
                  })}
                  <option value="custom">{t('composerSection.customOption')}</option>
                </select>
                <select
                  aria-label={t('composerSection.codingWorkflow')}
                  className="workflow-select"
                  onChange={(event) => {
                    const preset = codingPresets.find((item) => item.id === event.currentTarget.value);
                    if (preset) applyCodingPreset(preset);
                  }}
                  value={codingWorkflow}
                >
                  {codingPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t('composerSection.actionPolicy')}
                  onChange={(event) => setActionPolicy(event.currentTarget.value as ActionPolicy)}
                  value={actionPolicy}
                >
                  {(Object.keys(actionPolicies) as ActionPolicy[]).map((policy) => (
                    <option key={policy} value={policy}>
                      {actionPolicies[policy].label}
                    </option>
                  ))}
                </select>
                {/* Run config — moved here from the inspector so it's one
                    glance below the chat box (Claude-style). Labels are
                    self-describing since the footer has no separate captions. */}
                <select
                  aria-label={t('composerSection.agentEffort')}
                  className="run-select"
                  title={t('composerSection.agentEffortTitle')}
                  value={effortLevel}
                  onChange={(event) => setEffortLevel(event.currentTarget.value as EffortLevel)}
                >
                  {(Object.keys(effortLevels) as EffortLevel[]).map((k) => (
                    <option key={k} value={k}>
                      {t('composerSection.effortOption', { label: effortLevels[k].label })}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t('composerSection.reasoningEffort')}
                  className="run-select"
                  title={t('composerSection.reasoningEffortTitle')}
                  value={reasoningEffort}
                  onChange={(event) => setReasoningEffort(event.currentTarget.value as ReasoningEffort)}
                >
                  {(Object.keys(reasoningEfforts) as ReasoningEffort[]).map((k) => (
                    <option key={k} value={k}>
                      {t('composerSection.reasoningOption', { label: reasoningEfforts[k].label })}
                    </option>
                  ))}
                </select>
                {/* Raw grok --permission-mode lives in Settings → Permissions
                    (advanced). The composer footer uses the friendlier "Action
                    policy" (Review/Plan/Patch/Autopilot) as the single
                    permission control, so the two no longer overlap. */}
                <select
                  aria-label={t('composerSection.bestOfN')}
                  className="run-select"
                  title={t('composerSection.bestOfNTitle')}
                  value={bestOfN}
                  onChange={(event) => setBestOfN(Number(event.currentTarget.value))}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{t('composerSection.bestOfOption', { n })}</option>
                  ))}
                </select>
                <span className="composer-hint" aria-hidden="true">
                  {t('composerSection.enterHint')}
                </span>
                {grokIsRunning && activeRunId ? (
                  <button
                    className="mini-run"
                    onClick={() => stopRun(activeRunId)}
                    type="button"
                    title={t('composerSection.stopRun')}
                  >
                    <X size={16} />
                  </button>
                ) : null}
              </div>
            </div>
  );
}
