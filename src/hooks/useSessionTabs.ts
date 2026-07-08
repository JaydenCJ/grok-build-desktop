// Multi-session tabs for App. Tabs are a *facade* — the active tab's
// cwd/messages mirror to App's flat session state, so the rest of the app
// is unaware; see lib/tabs.ts for the design rationale. Owns tab
// persistence, create/switch/delete, and the active-tab mirror effect.
// Extracted from App.tsx unchanged apart from the injected callbacks
// (composer seeding/focus, palette close, per-conversation metadata drop).
import { useEffect, useRef, useState } from "react";
import type { ToolRun } from "../lib/grok";
import { defaultTabName, makeTab, type Tab, type TabMessage } from "../lib/tabs";
import type { ChatMessage, Mode } from "../app/types";
import { storageKeys, tabsActiveKey, tabsStorageKey } from "../app/constants";
import { storedMessages } from "../app/storage";

export interface SessionTabsDeps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  codingCwd: string;
  setCodingCwd: React.Dispatch<React.SetStateAction<string>>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<Mode, string>>>;
  setLastRun: (run: ToolRun | null) => void;
  setSessionNotice: (notice: string | null) => void;
  setComposerValue: (value: string) => void;
  focusComposer: () => void;
  closePalette: () => void;
  /** Drop per-conversation metadata (pin/label/group/archive) + close menus. */
  onConversationDeleted: (id: string) => void;
}

export function useSessionTabs(deps: SessionTabsDeps) {
  const {
    messages,
    setMessages,
    codingCwd,
    setCodingCwd,
    setDrafts,
    setLastRun,
    setSessionNotice,
    setComposerValue,
    focusComposer,
    closePalette,
    onConversationDeleted,
  } = deps;

  // Multi-session tabs. The "active" tab's cwd and messages are mirrored back
  // into the existing flat state above so the rest of App.tsx (model picker,
  // mode dock, status bar, etc.) keeps working unchanged. Tabs are a thin
  // facade — see comment in lib/tabs.ts for the design rationale. Storage keys
  // live at module scope (near storedActiveTabMessages).
  const [tabs, setTabs] = useState<Tab[]>(() => {
    try {
      const raw = window.localStorage.getItem(tabsStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Tab[];
      }
    } catch {
      // fall through
    }
    // First-run: synthesize one tab from the legacy single-session state.
    const initialCwd = window.localStorage.getItem(storageKeys.codingCwd) ?? "";
    return [makeTab(initialCwd, storedMessages() as unknown as TabMessage[], defaultTabName(initialCwd, 0))];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const stored = window.localStorage.getItem(tabsActiveKey);
    if (stored) return stored;
    // Use the first tab's id from initial setup above.
    try {
      const raw = window.localStorage.getItem(tabsStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed[0]?.id) return parsed[0].id;
      }
    } catch {
      // fall through
    }
    return "";
  });
  // Very first run: neither tabs key exists yet when the initializers above
  // run (the synthesized first tab is only persisted by the effect below), so
  // activeTabId comes up "". Without an owner, the active-tab mirror effect
  // never writes the conversation into its tab — the first session shows as
  // "empty" in HISTORY and is silently lost on the first New Session. Adopt
  // the synthesized tab as active immediately.
  useEffect(() => {
    if (!activeTabId && tabs.length > 0) setActiveTabId(tabs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Multi-session tabs ───────────────────────────────────────────────────
  // Tabs are a *facade* — the active tab's cwd/messages mirror to the flat
  // state above, so the rest of App.tsx is unaware. See lib/tabs.ts.
  // Always-fresh mirror of the session state handleTabCreate needs. It is
  // invoked from stale closures (the ⌘N keydown listener and the ⌘K palette
  // memo, whose dep arrays don't include messages/tabs), so reading the
  // render-scope variables there could act on state that is many turns old.
  const sessionStateRef = useRef({ activeTabId, messages, tabs });
  sessionStateRef.current = { activeTabId, messages, tabs };
  function handleTabCreate() {
    const current = sessionStateRef.current;
    // Already on a clean slate? Reuse it instead of stacking another empty
    // "New conversation" row into HISTORY on every ⌘N / New Session click.
    const currentTab = current.tabs.find((t) => t.id === current.activeTabId);
    if (currentTab && currentTab.messages.length === 0 && current.messages.length === 0) {
      setDrafts({ standard: "", coding: "" });
      setComposerValue("");
      setSessionNotice(null);
      setLastRun(null);
      focusComposer();
      return;
    }
    // No pre-create snapshot of the active tab here: the sync effect below
    // already mirrors codingCwd/messages into it on every change, and a
    // snapshot taken from a stale closure (⌘N/⌘K) would overwrite that fresh
    // mirror with old messages and truncate the conversation's history.
    setTabs((existing) => [
      ...existing,
      makeTab("", [], defaultTabName("", existing.length)),
    ]);
    // The new tab id is generated inside the setter; pull it out via a
    // microtask so the state update has committed.
    queueMicrotask(() => {
      setTabs((current) => {
        const newest = current[current.length - 1];
        if (newest) {
          setActiveTabId(newest.id);
          setCodingCwd(newest.cwd);
          setMessages(newest.messages as unknown as ChatMessage[]);
        }
        return current;
      });
      // "Clean slate" — Claude-Desktop-style. Wipe the composer draft, any
      // leftover banner / notice, and the last-run card. The user opened a
      // new session because they wanted a *fresh* surface.
      setDrafts({ standard: "", coding: "" });
      setComposerValue("");
      setSessionNotice(null);
      setLastRun(null);
    });
  }

  // Persist tabs (and the active id) whenever the array changes. This is the
  // single source of truth across reloads; localStorage hydrates on next boot.
  useEffect(() => {
    try {
      window.localStorage.setItem(tabsStorageKey, JSON.stringify(tabs));
    } catch {
      // quota or serialization error — non-fatal; in-memory state survives.
    }
  }, [tabs]);
  useEffect(() => {
    if (activeTabId) window.localStorage.setItem(tabsActiveKey, activeTabId);
  }, [activeTabId]);

  // Whenever the global codingCwd or messages change, write them back into
  // the active tab. This keeps the tab "in sync" with the flat state without
  // requiring every existing setMessages/setCodingCwd call-site to know about
  // tabs.
  useEffect(() => {
    setTabs((current) =>
      current.map((t) =>
        t.id === activeTabId
          ? { ...t, cwd: codingCwd, messages: messages as unknown as TabMessage[] }
          : t,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codingCwd, messages]);


  // First user prompt of a conversation (session/tab id) — used for copy /
  // save-to-library actions in the history menu.
  function sessionFirstPrompt(id: string): string | null {
    const tab = tabs.find((t) => t.id === id);
    const msgs =
      ((id === activeTabId ? (messages as unknown as TabMessage[]) : tab?.messages) ?? []);
    return msgs.find((m) => m.role === "user")?.content ?? null;
  }

  // Clicking a HISTORY row returns you to THAT task's conversation (Claude /
  // Codex behaviour) — NOT just refilling the composer (that lives in the
  // right-click "Restore to composer" action). If the message lives in another
  // session tab we switch to it first, then scroll+flash the message in place.
  // Switch to a whole conversation (session/tab). The HISTORY list is now a
  // list of conversations — clicking one loads that conversation in full, the
  // way Claude / ChatGPT switch chats. `id` is a tab id.
  function switchToSession(id: string) {
    closePalette();
    if (id === activeTabId) return;
    const target = tabs.find((t) => t.id === id);
    if (!target) return;
    // Persist the current conversation back into its tab, then load the target.
    setTabs((current) =>
      current.map((t) =>
        t.id === activeTabId
          ? { ...t, cwd: codingCwd, messages: messages as unknown as TabMessage[] }
          : t,
      ),
    );
    setActiveTabId(target.id);
    setCodingCwd(target.cwd);
    setMessages(target.messages as unknown as ChatMessage[]);
    setSessionNotice(null);
  }

  // Delete a whole conversation. Works on ANY conversation (this is the fix for
  // "some conversations can't be deleted" — the old delete only hid a message
  // preview while the underlying message stayed). If the active conversation is
  // deleted, fall back to the newest remaining one, or a fresh empty session.
  function deleteSession(id: string) {
    const remaining = tabs.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      // Last conversation → reset to a single fresh, empty one.
      const fresh = makeTab("", []);
      setTabs([fresh]);
      setActiveTabId(fresh.id);
      setCodingCwd(fresh.cwd);
      setMessages([]);
    } else {
      if (id === activeTabId) {
        const next = remaining
          .slice()
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        setActiveTabId(next.id);
        setCodingCwd(next.cwd);
        setMessages(next.messages as unknown as ChatMessage[]);
      }
      setTabs(remaining);
    }
    // Drop any per-conversation metadata so it doesn't linger.
    onConversationDeleted(id);
  }

  return {
    tabs,
    activeTabId,
    handleTabCreate,
    switchToSession,
    deleteSession,
    sessionFirstPrompt,
  };
}
