// External-command runners + inspector data for App: grok auth/status,
// static preview, ecosystem inspect, models, MCP/plugins/sessions lists,
// shell, browser, absorb-repo, doctor, and the project folder picker.
// Owns the busy flags, terminal lines, and result state. Extracted from
// App.tsx unchanged — the only substitution is that opening the preview
// panel goes through the onPreviewAvailable callback.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ToolRun } from "../lib/grok";
import { hasTauriRuntime } from "../lib/runtime";
import type { GrokAuthStatus, Runner, StaticPreview, ToolStatus } from "../app/types";
import { defaultStatuses } from "../app/constants";
import { nativeUnavailable, parseAvailableModels } from "../app/format";
import { t } from "../i18n";

export interface GrokRunnerDeps {
  codingCwd: string;
  shellCommand: string;
  lastRun: ToolRun | null;
  recordRun: (run: ToolRun) => void;
  setLastRun: (run: ToolRun | null) => void;
  setCodingCwd: (cwd: string) => void;
  setSessionNotice: (notice: string | null) => void;
  /** Open the preview panel after a refresh found previewable content. */
  onPreviewAvailable: () => void;
}

export function useGrokRunners(deps: GrokRunnerDeps) {
  const {
    codingCwd,
    shellCommand,
    lastRun,
    recordRun,
    setLastRun,
    setCodingCwd,
    setSessionNotice,
    onPreviewAvailable,
  } = deps;

  const [browserTask, setBrowserTask] = useState(
    "Open https://example.com and report the main heading.",
  );
  const [repoPath, setRepoPath] = useState("");
  const [copyText, setCopyText] = useState(true);
  const [grokStatus, setGrokStatus] = useState<GrokAuthStatus | null>(null);
  const [statuses, setStatuses] = useState<ToolStatus[]>([]);
  const [ecosystemRun, setEcosystemRun] = useState<ToolRun | null>(null);
  const [modelsRun, setModelsRun] = useState<ToolRun | null>(null);
  const [mcpRun, setMcpRun] = useState<ToolRun | null>(null);
  const [mcpDoctorRun, setMcpDoctorRun] = useState<ToolRun | null>(null);
  const [pluginsRun, setPluginsRun] = useState<ToolRun | null>(null);
  const [sessionsRun, setSessionsRun] = useState<ToolRun | null>(null);
  const [staticPreview, setStaticPreview] = useState<StaticPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [folderPickerBusy, setFolderPickerBusy] = useState(false);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [busyRunner, setBusyRunner] = useState<Runner | "status" | null>(null);
  const [contextBusy, setContextBusy] = useState<"models" | "inspect" | null>(null);
  async function refreshStatuses() {
    setBusyRunner("status");
    try {
      if (!hasTauriRuntime()) {
        setStatuses(defaultStatuses);
        setLastRun(nativeUnavailable("web preview"));
        return;
      }
      setStatuses(await invoke<ToolStatus[]>("get_tool_statuses"));
    } catch (error) {
      setLastRun({
        ok: false,
        command: "get_tool_statuses",
        cwd: "",
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyRunner(null);
    }
  }

  async function refreshGrokAuthStatus() {
    try {
      if (!hasTauriRuntime()) {
        setGrokStatus({
          installed: false,
          authenticated: false,
          apiKeyPresent: false,
          cachedLoginPresent: false,
          configPresent: false,
          version: "",
          detail: "Grok status is available in the Tauri desktop window.",
          loginCommand: "grok login",
          deviceLoginCommand: "grok login --device-auth",
          installCommand: "curl -fsSL https://x.ai/cli/install.sh | bash",
          npmInstallCommand: "npm install -g @xai-official/grok",
          authPath: "~/.grok/auth",
          configPath: "~/.grok/config.toml",
        });
        return;
      }
      setGrokStatus(await invoke<GrokAuthStatus>("get_grok_auth_status"));
    } catch (error) {
      setGrokStatus({
        installed: false,
        authenticated: false,
        apiKeyPresent: false,
        cachedLoginPresent: false,
        configPresent: false,
        version: "",
        detail: error instanceof Error ? error.message : String(error),
        loginCommand: "grok login",
        deviceLoginCommand: "grok login --device-auth",
        installCommand: "curl -fsSL https://x.ai/cli/install.sh | bash",
        npmInstallCommand: "npm install -g @xai-official/grok",
        authPath: "~/.grok/auth",
        configPath: "~/.grok/config.toml",
      });
    }
  }

  async function refreshStaticPreview(openWhenAvailable = false) {
    setPreviewBusy(true);
    try {
      if (!hasTauriRuntime()) {
        setStaticPreview({
          available: false,
          root: codingCwd,
          entryPath: "",
          previewUrl: "",
          files: [],
          detail: "Preview is available in the installed Grok Desktop app.",
          updatedAt: Date.now(),
        });
        return;
      }
      const preview = await invoke<StaticPreview>("get_static_preview", { cwd: codingCwd });
      setStaticPreview(preview);
      if (openWhenAvailable && preview.available) {
        onPreviewAvailable();
      }
    } catch (error) {
      setStaticPreview({
        available: false,
        root: codingCwd,
        entryPath: "",
        previewUrl: "",
        files: [],
        detail: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      });
    } finally {
      setPreviewBusy(false);
    }
  }

  async function startGrokLogin(deviceAuth = false) {
    setBusyRunner("grok");
    setTerminalLines([
      `[sys] Opening Terminal for ${deviceAuth ? "device login" : "Grok setup"}.`,
      "[sys] If Grok is missing, Terminal will ask before running the official installer.",
      "[sys] Complete the official authorization, then return here and refresh status.",
    ]);
    try {
      if (!hasTauriRuntime()) {
        const unavailable = nativeUnavailable("grok login");
        setTerminalLines((current) => [...current, `[err] ${unavailable.stderr}`]);
        recordRun(unavailable);
        return;
      }
      const run = await invoke<ToolRun>("start_grok_login", {
        deviceAuth,
        cwd: codingCwd,
      });
      recordRun(run);
      await refreshStaticPreview(true);
      await refreshGrokAuthStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTerminalLines((current) => [...current, `[err] ${message}`]);
      recordRun({
        ok: false,
        command: deviceAuth ? "grok login --device-auth" : "grok login",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: message,
      });
    } finally {
      setBusyRunner(null);
    }
  }

  async function runShell() {
    setBusyRunner("shell");
    setTerminalLines([]);
    try {
      if (!hasTauriRuntime()) {
        recordRun(nativeUnavailable("zsh -lc"));
        return;
      }
      recordRun(
        await invoke<ToolRun>("run_shell_command", {
          command: shellCommand,
          cwd: codingCwd,
        }),
      );
    } catch (error) {
      recordRun({
        ok: false,
        command: "zsh -lc",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyRunner(null);
    }
  }

  async function refreshGrokEcosystem() {
    setContextBusy("inspect");
    try {
      if (!hasTauriRuntime()) {
        setEcosystemRun(nativeUnavailable("grok inspect"));
        return;
      }
      setEcosystemRun(
        await invoke<ToolRun>("inspect_grok_environment", {
          cwd: codingCwd,
        }),
      );
    } catch (error) {
      setEcosystemRun({
        ok: false,
        command: "grok inspect",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setContextBusy(null);
    }
  }

  async function refreshGrokModels() {
    setContextBusy("models");
    try {
      if (!hasTauriRuntime()) {
        setModelsRun(nativeUnavailable("grok models"));
        return;
      }
      const run = await invoke<ToolRun>("list_grok_models");
      setModelsRun(run);
      const parsed = parseAvailableModels(run.output);
      if (parsed.length > 0) setAvailableModels(parsed);
    } catch (error) {
      setModelsRun({
        ok: false,
        command: "grok models",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setContextBusy(null);
    }
  }

  async function pickFolder() {
    if (!hasTauriRuntime()) {
      setSessionNotice(t("notices.folderPickerUnavailable"));
      return;
    }
    setFolderPickerBusy(true);
    try {
      const next = await invoke<string | null>("pick_project_folder", {
        initial: codingCwd || null,
      });
      if (next) {
        setCodingCwd(next);
        setSessionNotice(t("notices.repoSet", { path: next }));
      }
    } catch (error) {
      setSessionNotice(
        t("notices.folderPickerFailed", { error: error instanceof Error ? error.message : String(error) }),
      );
    } finally {
      setFolderPickerBusy(false);
    }
  }

  async function refreshGrokMcp() {
    setBusyRunner("mcp");
    try {
      if (!hasTauriRuntime()) {
        setMcpRun(nativeUnavailable("grok mcp list"));
        return;
      }
      const run = await invoke<ToolRun>("list_grok_mcp", { cwd: codingCwd });
      setMcpRun(run);
      recordRun(run);
    } catch (error) {
      const run = {
        ok: false,
        command: "grok mcp list",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
      setMcpRun(run);
      recordRun(run);
    } finally {
      setBusyRunner(null);
    }
  }

  async function doctorGrokMcp() {
    setBusyRunner("mcp-doctor");
    try {
      if (!hasTauriRuntime()) {
        setMcpDoctorRun(nativeUnavailable("grok mcp doctor"));
        return;
      }
      const run = await invoke<ToolRun>("doctor_grok_mcp", { cwd: codingCwd });
      setMcpDoctorRun(run);
      recordRun(run);
    } catch (error) {
      const run = {
        ok: false,
        command: "grok mcp doctor",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
      setMcpDoctorRun(run);
      recordRun(run);
    } finally {
      setBusyRunner(null);
    }
  }

  async function refreshGrokPlugins() {
    setBusyRunner("plugins");
    try {
      if (!hasTauriRuntime()) {
        setPluginsRun(nativeUnavailable("grok plugin list"));
        return;
      }
      const run = await invoke<ToolRun>("list_grok_plugins", { cwd: codingCwd });
      setPluginsRun(run);
      recordRun(run);
    } catch (error) {
      const run = {
        ok: false,
        command: "grok plugin list",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
      setPluginsRun(run);
      recordRun(run);
    } finally {
      setBusyRunner(null);
    }
  }

  async function refreshGrokSessions() {
    setBusyRunner("sessions");
    try {
      if (!hasTauriRuntime()) {
        setSessionsRun(nativeUnavailable("grok sessions list"));
        return;
      }
      const run = await invoke<ToolRun>("list_grok_sessions", { cwd: codingCwd });
      setSessionsRun(run);
      recordRun(run);
    } catch (error) {
      const run = {
        ok: false,
        command: "grok sessions list",
        cwd: codingCwd,
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
      setSessionsRun(run);
      recordRun(run);
    } finally {
      setBusyRunner(null);
    }
  }

  async function runBrowser() {
    setBusyRunner("browser");
    setTerminalLines([]);
    try {
      if (!hasTauriRuntime()) {
        setLastRun(nativeUnavailable("browser-use"));
        return;
      }
      recordRun(
        await invoke<ToolRun>("run_browser_task", {
          task: browserTask,
          maxSteps: 10,
        }),
      );
    } catch (error) {
      recordRun({
        ok: false,
        command: "browser-use",
        cwd: "",
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyRunner(null);
    }
  }

  async function runAbsorbRepo() {
    setBusyRunner("absorb");
    setTerminalLines([]);
    try {
      if (!hasTauriRuntime()) {
        recordRun(nativeUnavailable("absorb-repo"));
        return;
      }
      recordRun(
        await invoke<ToolRun>("run_absorb_repo", {
          repoPath,
          copyText,
        }),
      );
    } catch (error) {
      recordRun({
        ok: false,
        command: "absorb-repo",
        cwd: "",
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyRunner(null);
    }
  }

  async function runDoctor() {
    setBusyRunner("doctor");
    setTerminalLines([]);
    try {
      if (!hasTauriRuntime()) {
        recordRun(nativeUnavailable("doctor"));
        return;
      }
      recordRun(await invoke<ToolRun>("run_doctor"));
    } catch (error) {
      recordRun({
        ok: false,
        command: "doctor",
        cwd: "",
        exit_code: null,
        duration_ms: 0,
        timed_out: false,
        output: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyRunner(null);
    }
  }

  useEffect(() => {
    refreshStatuses();
    refreshGrokAuthStatus();
    refreshStaticPreview();
    refreshGrokModels();
    // Mount-only bootstrap: the refresh helpers are plain functions recreated
    // every render — listing them would re-probe the CLI on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshStaticPreview();
    }, 250);
    return () => window.clearTimeout(timer);
    // Key on the lastRun object, not duration_ms — two runs with equal
    // durations must still trigger a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codingCwd, lastRun]);

  return {
    statuses,
    grokStatus,
    ecosystemRun,
    modelsRun,
    mcpRun,
    mcpDoctorRun,
    pluginsRun,
    sessionsRun,
    staticPreview,
    previewBusy,
    availableModels,
    busyRunner,
    contextBusy,
    terminalLines,
    setTerminalLines,
    browserTask,
    setBrowserTask,
    repoPath,
    setRepoPath,
    copyText,
    setCopyText,
    folderPickerBusy,
    refreshStatuses,
    refreshGrokAuthStatus,
    refreshStaticPreview,
    startGrokLogin,
    runShell,
    refreshGrokEcosystem,
    refreshGrokModels,
    refreshGrokMcp,
    doctorGrokMcp,
    refreshGrokPlugins,
    refreshGrokSessions,
    runBrowser,
    runAbsorbRepo,
    runDoctor,
    pickFolder,
  };
}
