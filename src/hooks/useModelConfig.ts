// Model / run-configuration state for App: model preset + custom id, agent
// effort, reasoning effort, permission mode, best-of-N, memory/web/subagents/
// self-check toggles — each persisted to localStorage — plus the derived
// active model, the CLI-verified model options, and the coding-mode
// auto-snap. Extracted from App.tsx unchanged.
import { useEffect, useMemo, useState } from "react";
import {
  isEffortLevel,
  isGrokModelId,
  isPermissionMode,
  isReasoningEffort,
  type EffortLevel,
  type GrokModelId,
  type Mode,
  type PermissionMode,
  type ReasoningEffort,
} from "../app/types";
import { grokModelPresets, reasoningEfforts, storageKeys } from "../app/constants";

export interface ModelConfigDeps {
  mode: Mode;
  /** Model ids reported by the grok CLI (empty when it reported nothing). */
  availableModels: string[];
}

export function useModelConfig({ mode, availableModels }: ModelConfigDeps) {
  const [modelPreset, setModelPreset] = useState<GrokModelId>(() => {
    const stored = window.localStorage.getItem(storageKeys.modelPreset);
    return isGrokModelId(stored) ? stored : "grok-build";
  });
  const [customModel, setCustomModel] = useState(
    () => window.localStorage.getItem(storageKeys.customModel) ?? "",
  );
  const safeRuntimeDefaultsMigrated =
    window.localStorage.getItem(storageKeys.safeRuntimeDefaults) === "true";
  const [effortLevel, setEffortLevel] = useState<EffortLevel>(() => {
    const stored = window.localStorage.getItem(storageKeys.effortLevel);
    return safeRuntimeDefaultsMigrated && isEffortLevel(stored) ? stored : "medium";
  });
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(() => {
    const stored = window.localStorage.getItem(storageKeys.reasoningEffort);
    return isReasoningEffort(stored) ? stored : grokModelPresets["grok-build"].defaultReasoning;
  });
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    const stored = window.localStorage.getItem(storageKeys.permissionMode);
    return isPermissionMode(stored) ? stored : "default";
  });
  const [bestOfN, setBestOfN] = useState(() => {
    const value = Number(window.localStorage.getItem(storageKeys.bestOfN) ?? "1");
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 1;
  });
  const [experimentalMemory, setExperimentalMemory] = useState(
    () => window.localStorage.getItem(storageKeys.experimentalMemory) === "true",
  );
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    () => safeRuntimeDefaultsMigrated && window.localStorage.getItem(storageKeys.webSearchEnabled) === "true",
  );
  const [subagentsEnabled, setSubagentsEnabled] = useState(
    () => safeRuntimeDefaultsMigrated && window.localStorage.getItem(storageKeys.subagentsEnabled) === "true",
  );
  const [selfCheck, setSelfCheck] = useState(
    () => window.localStorage.getItem(storageKeys.selfCheck) === "true",
  );

  const activeModel = modelPreset === "custom" ? customModel.trim() || "grok-build" : modelPreset;
  const activeModelMeta = grokModelPresets[modelPreset];
  const activeReasoningLabel =
    reasoningEffort === "off" ? "auto" : reasoningEfforts[reasoningEffort].label;

  function changeModelPreset(nextModel: GrokModelId) {
    setModelPreset(nextModel);
    setReasoningEffort(grokModelPresets[nextModel].defaultReasoning);
  }

  useEffect(() => {
    window.localStorage.setItem(storageKeys.modelPreset, modelPreset);
  }, [modelPreset]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.customModel, customModel);
  }, [customModel]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.effortLevel, effortLevel);
  }, [effortLevel]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.reasoningEffort, reasoningEffort);
  }, [reasoningEffort]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.permissionMode, permissionMode);
  }, [permissionMode]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.bestOfN, String(bestOfN));
  }, [bestOfN]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.experimentalMemory, String(experimentalMemory));
  }, [experimentalMemory]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.webSearchEnabled, String(webSearchEnabled));
  }, [webSearchEnabled]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.subagentsEnabled, String(subagentsEnabled));
  }, [subagentsEnabled]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.selfCheck, String(selfCheck));
  }, [selfCheck]);

  const modelOptions = useMemo(() => {
    const fromCli = availableModels.filter((value) => value && value !== "models" && value !== "available");
    const declared = Object.keys(grokModelPresets).filter((id) => id !== "custom");
    // The grok CLI is authoritative about which models THIS login can actually
    // run. When it reported them (the normal case), offer ONLY those — hardcoded
    // presets grok doesn't know (grok-build-0.1, grok-4.3, grok-latest, …) make
    // grok exit "unknown model id" and reply NOTHING, so they must never be
    // selectable. Power users who know a real id can still type it via "Custom…".
    if (fromCli.length > 0) return fromCli;
    // CLI reported nothing (offline / parse miss): best-effort fallback so the
    // dropdown isn't empty. Coding locks to grok-build; chat shows the presets.
    return mode === "coding" ? ["grok-build"] : declared;
  }, [availableModels, mode]);
  const modelIsVerified = availableModels.length === 0 || availableModels.includes(activeModel) || modelPreset === "custom";

  // Only auto-snap in CODE mode, where the list is intentionally restricted —
  // if a stale grok-4.3 selection lingers there, jump to the coding agent.
  // Chat mode leaves the user's pick alone.
  useEffect(() => {
    if (mode !== "coding") return;
    if (availableModels.length === 0) return; // CLI didn't report — leave as-is
    if (modelPreset === "custom") return;
    if (modelOptions.includes(modelPreset)) return;
    const fallback = modelOptions[0];
    if (!fallback) return;
    if (isGrokModelId(fallback)) {
      changeModelPreset(fallback);
    } else {
      // The CLI reported ids outside the hardcoded preset union (e.g. a new
      // model generation). Route through "custom" so the <select> value and
      // the --model arg stay in sync — otherwise the dropdown displays the
      // first CLI model while runs silently send the stale preset.
      setModelPreset("custom");
      setCustomModel(fallback);
    }
  }, [mode, availableModels, modelOptions, modelPreset]);

  return {
    modelPreset,
    setModelPreset,
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
    activeModelMeta,
    activeReasoningLabel,
    changeModelPreset,
    modelOptions,
    modelIsVerified,
  };
}
