// History-organization state for the conversations sidebar: pin / rename /
// group / archive / delete metadata (persisted per conversation id), the
// filter box, the transient action toast, and the derived recent/partitioned
// row views. Extracted from App.tsx unchanged.
import { useEffect, useMemo, useRef, useState } from "react";
import { upsertPrompt } from "../lib/prompts";
import type { Tab, TabMessage } from "../lib/tabs";
import type { ChatMessage, HistoryRow } from "../app/types";
import { storageKeys } from "../app/constants";
import { loadIdMap, loadIdSet } from "../app/storage";
import { timeLabel } from "../app/format";

export interface HistoryOrganizationDeps {
  tabs: Tab[];
  activeTabId: string;
  messages: ChatMessage[];
  sessionFirstPrompt: (id: string) => string | null;
  closeContextMenu: () => void;
}

export function useHistoryOrganization(deps: HistoryOrganizationDeps) {
  const { tabs, activeTabId, messages, sessionFirstPrompt, closeContextMenu } = deps;

  // History organization — pin / rename / group / archive / delete, persisted
  // by prompt id so the right-click actions survive restarts and have a
  // visible effect in the list (no decorative no-ops).
  const [pinnedPromptIds, setPinnedPromptIds] = useState<Set<string>>(() => loadIdSet(storageKeys.historyPinned));
  const [promptLabels, setPromptLabels] = useState<Record<string, string>>(() => loadIdMap(storageKeys.historyLabels));
  const [promptGroups, setPromptGroups] = useState<Record<string, string>>(() => loadIdMap(storageKeys.historyGroups));
  const [archivedPromptIds, setArchivedPromptIds] = useState<Set<string>>(() => loadIdSet(storageKeys.historyArchived));
  const [showArchived, setShowArchived] = useState(false);
  // Inline editing for a history row: rename (custom label) or new-group entry.
  const [rowEdit, setRowEdit] = useState<{ id: string; mode: "rename" | "newgroup" } | null>(null);
  // Transient toast for actions without an obvious list change (copy/save).
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  useEffect(() => {
    if (!historyNote) return;
    const t = window.setTimeout(() => setHistoryNote(null), 1700);
    return () => window.clearTimeout(t);
  }, [historyNote]);
  useEffect(() => {
    window.localStorage.setItem(storageKeys.historyPinned, JSON.stringify([...pinnedPromptIds]));
  }, [pinnedPromptIds]);
  useEffect(() => {
    window.localStorage.setItem(storageKeys.historyLabels, JSON.stringify(promptLabels));
  }, [promptLabels]);
  useEffect(() => {
    window.localStorage.setItem(storageKeys.historyGroups, JSON.stringify(promptGroups));
  }, [promptGroups]);
  useEffect(() => {
    window.localStorage.setItem(storageKeys.historyArchived, JSON.stringify([...archivedPromptIds]));
  }, [archivedPromptIds]);

  // ---- History row actions: all persisted, each with a visible effect ----
  function togglePinPrompt(id: string) {
    setPinnedPromptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleArchivePrompt(id: string) {
    setArchivedPromptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Archiving implies leaving the Pinned section.
    setPinnedPromptIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function setPromptGroupId(id: string, group: string | null) {
    setPromptGroups((prev) => {
      const next = { ...prev };
      if (group && group.trim()) next[id] = group.trim();
      else delete next[id];
      return next;
    });
  }

  function startRename(id: string) {
    closeContextMenu();
    setRowEdit({ id, mode: "rename" });
  }

  function startNewGroup(id: string) {
    closeContextMenu();
    setRowEdit({ id, mode: "newgroup" });
  }

  function commitRowEdit(value: string) {
    const edit = rowEdit;
    setRowEdit(null);
    if (!edit) return;
    const v = value.trim();
    if (edit.mode === "rename") {
      setPromptLabels((prev) => {
        const next = { ...prev };
        if (v) next[edit.id] = v;
        else delete next[edit.id];
        return next;
      });
    } else if (v) {
      setPromptGroupId(edit.id, v);
    }
  }

  async function savePromptToLibrary(id: string) {
    const text = sessionFirstPrompt(id);
    if (!text) return;
    const name = (promptLabels[id] ?? text.split("\n").find(Boolean) ?? "Saved prompt").slice(0, 60);
    try {
      await upsertPrompt({ name, body: text, category: "History" });
      setHistoryNote("Saved to Prompt Library");
    } catch {
      setHistoryNote("Couldn't save — Prompt Library unavailable");
    }
  }

  // Forget a deleted conversation's metadata so it doesn't linger.
  function removeConversationMeta(id: string) {
    setPinnedPromptIds((p) => { const n = new Set(p); n.delete(id); return n; });
    setArchivedPromptIds((p) => { const n = new Set(p); n.delete(id); return n; });
    setPromptLabels((p) => { const n = { ...p }; delete n[id]; return n; });
    setPromptGroups((p) => { const n = { ...p }; delete n[id]; return n; });
  }

  const [historyFilter, setHistoryFilter] = useState("");
  const historySearchInputRef = useRef<HTMLInputElement | null>(null);
  // HISTORY is a list of CONVERSATIONS (sessions/tabs), newest first — the way
  // Claude / ChatGPT show chats. Each row is one whole conversation, titled by
  // its first prompt; clicking it loads that conversation. (It used to list
  // every individual prompt, which read as "messages", not tasks.)
  const recentPrompts = useMemo(() => {
    const firstUserLine = (msgs: TabMessage[]): string => {
      const u = msgs.find((m) => m.role === "user");
      return u?.content.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
    };
    const rows: HistoryRow[] = tabs
      .map((t) => {
        const msgs =
          ((t.id === activeTabId ? (messages as unknown as TabMessage[]) : t.messages) ??
            []);
        const fp = firstUserLine(msgs);
        const promptCount = msgs.filter((m) => m.role === "user").length;
        const lastTs = msgs.length
          ? Math.max(...msgs.map((m) => (m as { ts?: number }).ts ?? 0))
          : t.createdAt;
        const fallback = fp ? (fp.length > 56 ? `${fp.slice(0, 56)}…` : fp) : "New conversation";
        return {
          id: t.id,
          title: promptLabels[t.id] ?? fallback,
          detail:
            promptCount > 0 ? `${promptCount} message${promptCount > 1 ? "s" : ""}` : "empty",
          time: timeLabel(lastTs),
          pinned: pinnedPromptIds.has(t.id),
          group: promptGroups[t.id] ?? null,
          archived: archivedPromptIds.has(t.id),
          lastTs,
          active: t.id === activeTabId,
        };
      })
      .sort((a, b) => b.lastTs - a.lastTs);
    if (!historyFilter.trim()) return rows;
    const needle = historyFilter.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        r.detail.toLowerCase().includes(needle) ||
        (r.group ?? "").toLowerCase().includes(needle),
    );
  }, [
    tabs,
    activeTabId,
    messages,
    historyFilter,
    pinnedPromptIds,
    promptLabels,
    promptGroups,
    archivedPromptIds,
  ]);

  // Partition the (filtered) rows into Pinned / named groups / Recent /
  // Archived sections for a Claude-style organized list.
  const historyView = useMemo(() => {
    const live = recentPrompts.filter((r) => !r.archived);
    const archived = recentPrompts.filter((r) => r.archived);
    const pinned = live.filter((r) => r.pinned);
    const groupMap = new Map<string, HistoryRow[]>();
    const ungrouped: HistoryRow[] = [];
    for (const r of live) {
      if (r.pinned) continue;
      if (r.group) {
        const arr = groupMap.get(r.group) ?? [];
        arr.push(r);
        groupMap.set(r.group, arr);
      } else {
        ungrouped.push(r);
      }
    }
    const groups = Array.from(groupMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return { pinned, groups, ungrouped, archived };
  }, [recentPrompts]);

  return {
    pinnedPromptIds,
    promptLabels,
    promptGroups,
    archivedPromptIds,
    showArchived,
    setShowArchived,
    rowEdit,
    setRowEdit,
    historyNote,
    setHistoryNote,
    historyFilter,
    setHistoryFilter,
    historySearchInputRef,
    recentPrompts,
    historyView,
    togglePinPrompt,
    toggleArchivePrompt,
    setPromptGroupId,
    startRename,
    startNewGroup,
    commitRowEdit,
    savePromptToLibrary,
    removeConversationMeta,
  };
}
