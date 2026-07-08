// Conversation/session state and its persistence: mode, drafts, cwd, shell
// command, action policy, workflow, theme, run history, chat messages —
// hydrated from localStorage at boot, mirrored back on change, and synced
// with the Rust-side session_state.json (load once, save debounced).
// Extracted from App.tsx unchanged.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ToolRun } from "../lib/grok";
import { hasTauriRuntime } from "../lib/runtime";
import {
  isActionPolicy,
  isChatMessage,
  isMode,
  isThemeMode,
  isToolRun,
  type ActionPolicy,
  type ChatMessage,
  type ChatMessageStatus,
  type Mode,
  type SessionState,
  type ThemeMode,
} from "../app/types";
import { defaultDrafts, storageKeys } from "../app/constants";
import {
  storedActiveTabMessages,
  storedLastRun,
  storedMessages,
  storedRunHistory,
} from "../app/storage";

export interface SessionPersistenceDeps {
  setComposerValue: (value: string) => void;
  setSessionNotice: (notice: string | null) => void;
}

export function useSessionPersistence({
  setComposerValue,
  setSessionNotice,
}: SessionPersistenceDeps) {
  const [mode, setMode] = useState<Mode>(() => {
    const stored = window.localStorage.getItem(storageKeys.mode);
    return stored === "coding" || stored === "standard" ? stored : "coding";
  });
  const [drafts, setDrafts] = useState<Record<Mode, string>>(() => {
    try {
      return {
        ...defaultDrafts,
        ...JSON.parse(window.localStorage.getItem(storageKeys.drafts) ?? "{}"),
      };
    } catch {
      return defaultDrafts;
    }
  });
  const [codingCwd, setCodingCwd] = useState(
    () => window.localStorage.getItem(storageKeys.codingCwd) ?? "",
  );
  const [shellCommand, setShellCommand] = useState(
    () => {
      const stored = window.localStorage.getItem(storageKeys.shellCommand);
      return stored &&
        stored !== "pwd && git status --short && ls" &&
        stored !== "pwd; git status --short || true; ls"
        ? stored
        : "pwd; git status --short 2>/dev/null || true; ls";
    },
  );
  const [actionPolicy, setActionPolicy] = useState<ActionPolicy>(() => {
    const stored = window.localStorage.getItem(storageKeys.actionPolicy);
    return stored === "review" || stored === "patch" || stored === "autopilot"
      ? stored
      : "patch";
  });
  const [codingWorkflow, setCodingWorkflow] = useState(
    () => window.localStorage.getItem(storageKeys.codingWorkflow) ?? "analyze",
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem(storageKeys.themeMode);
    const cleanLayoutMigrated = window.localStorage.getItem(storageKeys.cleanLayoutTheme) === "true";
    if (!cleanLayoutMigrated) return "dark";
    return isThemeMode(stored) ? stored : "dark";
  });
  const [lastRun, setLastRun] = useState<ToolRun | null>(() => storedLastRun());
  const [history, setHistory] = useState<ToolRun[]>(() => storedRunHistory());
  const [totalRuns, setTotalRuns] = useState<number>(() => {
    const stored = Number.parseInt(window.localStorage.getItem("grok-desktop-run-count-total") ?? "", 10);
    if (Number.isFinite(stored) && stored >= 0) return stored;
    return storedRunHistory().length;
  });
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => storedActiveTabMessages() ?? storedMessages(),
  );
  const [sessionLoaded, setSessionLoaded] = useState(false);

  function recordRun(run: ToolRun) {
    setLastRun(run);
    setHistory((current) => [run, ...current].slice(0, 6));
    setTotalRuns((current) => {
      const next = current + 1;
      window.localStorage.setItem("grok-desktop-run-count-total", String(next));
      return next;
    });
  }

  function appendMessage(message: ChatMessage) {
    setMessages((current) => [...current, message].slice(-120));
  }

  useEffect(() => {
    let cancelled = false;

    async function loadDesktopSession() {
      if (!hasTauriRuntime()) {
        setSessionLoaded(true);
        return;
      }

      try {
        const restored = await invoke<SessionState | null>("load_session_state");
        if (cancelled) return;

        if (restored) {
          const restoredDrafts = {
            ...defaultDrafts,
            ...(restored.drafts ?? {}),
          };
          const restoredMode = isMode(restored.mode) ? restored.mode : mode;
          const restoredHistory = Array.isArray(restored.history)
            ? restored.history.filter(isToolRun).slice(0, 6)
            : [];
          const restoredLastRun = isToolRun(restored.lastRun)
            ? restored.lastRun
            : restoredHistory[0] ?? null;
          const shouldClearRestoredPrompt = Boolean(restoredLastRun);
          const nextDrafts = shouldClearRestoredPrompt
            ? { ...restoredDrafts, [restoredMode]: "" }
            : restoredDrafts;

          setDrafts(nextDrafts);
          setMode(restoredMode);
          setComposerValue(nextDrafts[restoredMode] ?? defaultDrafts[restoredMode]);
          // session_state.json is written on a 300ms debounce (see the save
          // effect below), while localStorage mirrors codingCwd/tabs
          // synchronously — so the file can only ever be *staler* than the
          // boot-hydrated state. Treat it as a fill-in for empty local state
          // (legacy migration / cleared localStorage), never an override:
          // unconditionally applying it here used to clobber the correct
          // tab-hydrated conversation when the app quit inside the debounce
          // window, and the tab-mirror effect then persisted the wrong
          // messages into the active tab.
          if (typeof restored.codingCwd === "string") {
            const restoredCwd = restored.codingCwd;
            setCodingCwd((current) => current || restoredCwd);
          }
          if (typeof restored.shellCommand === "string") setShellCommand(restored.shellCommand);
          if (isActionPolicy(restored.actionPolicy)) setActionPolicy(restored.actionPolicy);
          if (typeof restored.codingWorkflow === "string") {
            setCodingWorkflow(restored.codingWorkflow);
          }
          if (isThemeMode(restored.themeMode)) {
            setThemeMode(restored.themeMode);
          }
          setHistory(restoredHistory);
          setLastRun(restoredLastRun);

          const restoredMessages = Array.isArray(restored.messages)
            ? restored.messages.filter(isChatMessage).slice(-120)
            : [];
          if (restoredMessages.length > 0) {
            const cleaned = restoredMessages.map((message) =>
              message.role === "assistant" && message.status === "streaming"
                ? { ...message, status: "stopped" as ChatMessageStatus }
                : message,
            );
            // Same staleness rule as codingCwd above: only adopt the file's
            // conversation when nothing hydrated locally.
            setMessages((current) => (current.length === 0 ? cleaned : current));
          }

          const effectiveMessageCount = Math.max(restoredMessages.length, storedMessages().length);
          if (restoredHistory.length > 0 || restoredLastRun || effectiveMessageCount > 0) {
            const runWord = restoredHistory.length === 1 ? "run" : "runs";
            const messagePart =
              effectiveMessageCount > 0
                ? `, ${effectiveMessageCount} chat message${effectiveMessageCount === 1 ? "" : "s"}`
                : "";
            setSessionNotice(`Restored ${restoredHistory.length} recent ${runWord}${messagePart}.`);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setSessionNotice(
            `Session restore failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } finally {
        if (!cancelled) setSessionLoaded(true);
      }
    }

    loadDesktopSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.mode, mode);
  }, [mode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.localStorage.setItem(storageKeys.drafts, JSON.stringify(drafts));
    }, 250);
    return () => clearTimeout(timer);
  }, [drafts]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.themeMode, themeMode);
    window.localStorage.setItem(storageKeys.cleanLayoutTheme, "true");
    // CRITICAL: drive the `data-theme` attribute, not just the `theme-*`
    // className. The legacy palette (--app-bg, --panel, …) flips via the
    // `.app-shell.theme-light` class, but the v0.4.0 mono tokens
    // (--bg-0..5, --text-1..4, used by CommandPalette / FilePicker /
    // TraceTimeline) flip via the `[data-theme="light"]` attribute selector.
    // Without this line the new components stay dark in light mode — that's
    // what produced the black block behind the tab strip.
    document.documentElement.setAttribute("data-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.codingCwd, codingCwd);
  }, [codingCwd]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.shellCommand, shellCommand);
  }, [shellCommand]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.actionPolicy, actionPolicy);
  }, [actionPolicy]);

  useEffect(() => {
    window.localStorage.setItem(storageKeys.codingWorkflow, codingWorkflow);
  }, [codingWorkflow]);

  useEffect(() => {
    const cleanComposerMigrated = window.localStorage.getItem(storageKeys.cleanComposer) === "true";
    if (!cleanComposerMigrated && lastRun) {
      const clearedDrafts = { ...drafts, [mode]: "" };
      setDrafts(clearedDrafts);
      setComposerValue("");
      window.localStorage.setItem(storageKeys.drafts, JSON.stringify(clearedDrafts));
    }
    window.localStorage.setItem(storageKeys.safeRuntimeDefaults, "true");
    window.localStorage.setItem(storageKeys.cleanComposer, "true");
  }, [drafts, lastRun, mode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.localStorage.setItem(storageKeys.runHistory, JSON.stringify(history));
    }, 300);
    return () => clearTimeout(timer);
  }, [history]);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.localStorage.setItem(storageKeys.messages, JSON.stringify(messages));
    }, 300);
    return () => clearTimeout(timer);
  }, [messages]);

  useEffect(() => {
    if (lastRun) {
      window.localStorage.setItem(storageKeys.lastRun, JSON.stringify(lastRun));
    } else {
      window.localStorage.removeItem(storageKeys.lastRun);
    }
  }, [lastRun]);

  useEffect(() => {
    if (!sessionLoaded || !hasTauriRuntime()) return;

    const timer = window.setTimeout(() => {
      const state: SessionState = {
        mode,
        drafts,
        codingCwd,
        shellCommand,
        actionPolicy,
        codingWorkflow,
        themeMode,
        lastRun,
        history,
        messages,
      };

      invoke<void>("save_session_state", { state }).catch((error) => {
        setSessionNotice(
          `Session save failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [
    actionPolicy,
    codingCwd,
    codingWorkflow,
    drafts,
    history,
    lastRun,
    messages,
    mode,
    sessionLoaded,
    shellCommand,
    themeMode,
  ]);

  return {
    mode,
    setMode,
    drafts,
    setDrafts,
    codingCwd,
    setCodingCwd,
    shellCommand,
    setShellCommand,
    actionPolicy,
    setActionPolicy,
    codingWorkflow,
    setCodingWorkflow,
    themeMode,
    setThemeMode,
    lastRun,
    setLastRun,
    history,
    setHistory,
    totalRuns,
    setTotalRuns,
    messages,
    setMessages,
    sessionLoaded,
    recordRun,
    appendMessage,
  };
}
