import { create } from "zustand";

/**
 * Tab state for one explorer window.
 *
 * Kept out of `tab-store.ts` on purpose: that store is keyed by workspace slug
 * and every main window shares the single `multica_tabs` key with whole-group
 * overwrite semantics (`tab-store-storage.ts:68-73`). Reusing it here would let
 * an explorer window clobber the main window's tab list.
 */

export type ExplorerTabKind = "task" | "file" | "diff";

export type ExplorerTab = {
  id: string;
  kind: ExplorerTabKind;
  title: string;
  /** Relative path inside the target root; absent for the task tab. */
  path?: string;
};

export const TASK_TAB_ID = "task";

export function explorerTabId(kind: "file" | "diff", path: string): string {
  return `${kind}:${path}`;
}

type ExplorerTabsState = {
  tabs: ExplorerTab[];
  activeId: string;
  open: (tab: ExplorerTab) => void;
  close: (id: string) => void;
  /** Closes every tab except the task anchor and the one named here. */
  closeOtherTabs: (id: string) => void;
  /** Closes the tabs positioned after `id`; the task anchor always survives. */
  closeTabsToRight: (id: string) => void;
  activate: (id: string) => void;
  reset: (tabs: ExplorerTab[], activeId: string) => void;
};

export const useExplorerTabs = create<ExplorerTabsState>((set) => ({
  tabs: [],
  activeId: TASK_TAB_ID,
  open: (tab) =>
    set((state) => {
      if (state.tabs.some((item) => item.id === tab.id)) {
        return { activeId: tab.id };
      }
      return { tabs: [...state.tabs, tab], activeId: tab.id };
    }),
  close: (id) =>
    set((state) => {
      // The task tab is the window's anchor and cannot be closed.
      if (id === TASK_TAB_ID) return state;
      const index = state.tabs.findIndex((item) => item.id === id);
      if (index < 0) return state;
      if (state.tabs.length === 1) return state;
      const tabs = state.tabs.filter((item) => item.id !== id);
      // Closing the active tab falls back to the one on its left (nearest
      // neighbour), matching the main window's behaviour.
      const fallback = tabs[Math.max(0, index - 1)] ?? tabs[0];
      const activeId = state.activeId === id ? (fallback?.id ?? TASK_TAB_ID) : state.activeId;
      return { tabs, activeId };
    }),
  activate: (id) => set({ activeId: id }),
  closeOtherTabs: (id) =>
    set((state) => {
      const tabs = state.tabs.filter((item) => item.id === TASK_TAB_ID || item.id === id);
      const kept = tabs.some((item) => item.id === state.activeId)
        ? state.activeId
        : tabs.some((item) => item.id === id)
          ? id
          : TASK_TAB_ID;
      return { tabs, activeId: kept };
    }),
  closeTabsToRight: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((item) => item.id === id);
      if (index < 0) return state;
      // The task tab is index 0, so it is never to the right of anything and
      // never needs a special case here.
      const tabs = state.tabs.filter((_, position) => position <= index);
      if (tabs.length === state.tabs.length) return state;
      const activeId = tabs.some((item) => item.id === state.activeId)
        ? state.activeId
        : tabs[tabs.length - 1]?.id ?? TASK_TAB_ID;
      return { tabs, activeId };
    }),
  reset: (tabs, activeId) => set({ tabs, activeId }),
}));

// --- persistence ----------------------------------------------------------

type PersistedTabs = { tabs: ExplorerTab[]; activeId: string };

function storageKey(issueId: string): string {
  return `multica_explorer_tabs:${issueId}`;
}

function isTab(value: unknown): value is ExplorerTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Record<string, unknown>;
  if (typeof tab.id !== "string" || typeof tab.title !== "string") return false;
  if (tab.kind !== "task" && tab.kind !== "file" && tab.kind !== "diff") return false;
  if (tab.kind !== "task" && typeof tab.path !== "string") return false;
  return true;
}

export function loadExplorerTabs(issueId: string): PersistedTabs | null {
  try {
    const raw = window.localStorage.getItem(storageKey(issueId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tabs?: unknown; activeId?: unknown };
    if (!Array.isArray(parsed.tabs)) return null;
    const tabs = parsed.tabs.filter(isTab);
    if (tabs.length === 0) return null;
    // The task tab must always exist and must stay first.
    const withoutTask = tabs.filter((tab) => tab.id !== TASK_TAB_ID);
    const taskTab = tabs.find((tab) => tab.id === TASK_TAB_ID);
    const ordered = taskTab ? [taskTab, ...withoutTask] : withoutTask;
    const activeId =
      typeof parsed.activeId === "string" && ordered.some((tab) => tab.id === parsed.activeId)
        ? parsed.activeId
        : TASK_TAB_ID;
    return { tabs: ordered, activeId };
  } catch {
    return null;
  }
}

export function saveExplorerTabs(issueId: string, tabs: ExplorerTab[], activeId: string): void {
  try {
    window.localStorage.setItem(storageKey(issueId), JSON.stringify({ tabs, activeId }));
  } catch {
    // Storage full or unavailable — tab restoration is a convenience, not a
    // correctness requirement.
  }
}
