import { beforeEach, describe, expect, it } from "vitest";
import {
  TASK_TAB_ID,
  explorerTabId,
  loadExplorerTabs,
  saveExplorerTabs,
  useExplorerTabs,
} from "./explorer-tabs";

// The point of this store is isolation: an explorer window must never write the
// `multica_tabs` key that every main window shares, or opening a task explorer
// would rewrite the main window's tab list.

const taskTab = { id: TASK_TAB_ID, kind: "task" as const, title: "TASK-1" };
const fileTab = { id: explorerTabId("file", "src/app.ts"), kind: "file" as const, title: "app.ts", path: "src/app.ts" };
const otherTab = { id: explorerTabId("file", "README.md"), kind: "file" as const, title: "README.md", path: "README.md" };

beforeEach(() => {
  window.localStorage.clear();
  useExplorerTabs.getState().reset([taskTab], TASK_TAB_ID);
});

describe("useExplorerTabs", () => {
  it("opens a tab and activates it", () => {
    useExplorerTabs.getState().open(fileTab);
    const state = useExplorerTabs.getState();
    expect(state.tabs.map((tab) => tab.id)).toEqual([TASK_TAB_ID, fileTab.id]);
    expect(state.activeId).toBe(fileTab.id);
  });

  it("re-opens an existing tab without duplicating it", () => {
    useExplorerTabs.getState().open(fileTab);
    useExplorerTabs.getState().open(fileTab);
    expect(useExplorerTabs.getState().tabs).toHaveLength(2);
  });

  it("refuses to close the task tab", () => {
    useExplorerTabs.getState().open(fileTab);
    useExplorerTabs.getState().close(TASK_TAB_ID);
    expect(useExplorerTabs.getState().tabs.map((tab) => tab.id)).toContain(TASK_TAB_ID);
  });

  it("falls back to the left neighbour when the active tab closes", () => {
    useExplorerTabs.getState().open(fileTab);
    useExplorerTabs.getState().open(otherTab);
    useExplorerTabs.getState().close(otherTab.id);
    const state = useExplorerTabs.getState();
    expect(state.tabs.map((tab) => tab.id)).toEqual([TASK_TAB_ID, fileTab.id]);
    expect(state.activeId).toBe(fileTab.id);
  });

  it("keeps the active tab when a background tab closes", () => {
    useExplorerTabs.getState().open(fileTab);
    useExplorerTabs.getState().open(otherTab);
    useExplorerTabs.getState().activate(otherTab.id);
    useExplorerTabs.getState().close(fileTab.id);
    expect(useExplorerTabs.getState().activeId).toBe(otherTab.id);
  });

  it("closes every tab but the task anchor and the named one", () => {
    const thirdTab = { id: explorerTabId("file", "a.md"), kind: "file" as const, title: "a.md", path: "a.md" };
    useExplorerTabs.getState().open(fileTab);
    useExplorerTabs.getState().open(otherTab);
    useExplorerTabs.getState().open(thirdTab);
    useExplorerTabs.getState().activate(otherTab.id);
    useExplorerTabs.getState().closeOtherTabs(otherTab.id);

    const state = useExplorerTabs.getState();
    expect(state.tabs.map((tab) => tab.id)).toEqual([TASK_TAB_ID, otherTab.id]);
    expect(state.activeId).toBe(otherTab.id);
  });

  it("keeps only the task tab when close-others targets the task tab", () => {
    useExplorerTabs.getState().open(fileTab);
    useExplorerTabs.getState().closeOtherTabs(TASK_TAB_ID);
    expect(useExplorerTabs.getState().tabs.map((tab) => tab.id)).toEqual([TASK_TAB_ID]);
    expect(useExplorerTabs.getState().activeId).toBe(TASK_TAB_ID);
  });

  it("closes the tabs to the right and re-anchors a closed active tab", () => {
    const thirdTab = { id: explorerTabId("file", "a.md"), kind: "file" as const, title: "a.md", path: "a.md" };
    useExplorerTabs.getState().open(fileTab);
    useExplorerTabs.getState().open(otherTab);
    useExplorerTabs.getState().open(thirdTab);
    useExplorerTabs.getState().activate(thirdTab.id);
    useExplorerTabs.getState().closeTabsToRight(fileTab.id);

    const state = useExplorerTabs.getState();
    expect(state.tabs.map((tab) => tab.id)).toEqual([TASK_TAB_ID, fileTab.id]);
    expect(state.activeId).toBe(fileTab.id);
  });

  it("does nothing when the close-right target is the last tab", () => {
    useExplorerTabs.getState().open(fileTab);
    useExplorerTabs.getState().activate(fileTab.id);
    useExplorerTabs.getState().closeTabsToRight(fileTab.id);
    expect(useExplorerTabs.getState().tabs.map((tab) => tab.id)).toEqual([TASK_TAB_ID, fileTab.id]);
    expect(useExplorerTabs.getState().activeId).toBe(fileTab.id);
  });
});

describe("explorer tab persistence", () => {
  it("round-trips through its own key", () => {
    saveExplorerTabs("issue-1", [taskTab, fileTab], fileTab.id);
    expect(window.localStorage.getItem("multica_explorer_tabs:issue-1")).not.toBeNull();
    expect(loadExplorerTabs("issue-1")).toEqual({ tabs: [taskTab, fileTab], activeId: fileTab.id });
  });

  it("never touches the shared main-window key", () => {
    window.localStorage.setItem("multica_tabs", '{"v":2,"groups":{}}');
    saveExplorerTabs("issue-1", [taskTab, fileTab], fileTab.id);
    expect(window.localStorage.getItem("multica_tabs")).toBe('{"v":2,"groups":{}}');
  });

  it("forces the task tab to stay first after a restore", () => {
    window.localStorage.setItem(
      "multica_explorer_tabs:issue-1",
      JSON.stringify({ tabs: [fileTab, taskTab], activeId: fileTab.id }),
    );
    const restored = loadExplorerTabs("issue-1");
    expect(restored?.tabs.map((tab) => tab.id)).toEqual([TASK_TAB_ID, fileTab.id]);
  });

  it("drops a stale activeId and malformed tabs", () => {
    window.localStorage.setItem(
      "multica_explorer_tabs:issue-1",
      JSON.stringify({ tabs: [taskTab, { id: "x", title: "x", kind: "weird" }], activeId: "missing" }),
    );
    expect(loadExplorerTabs("issue-1")).toEqual({ tabs: [taskTab], activeId: TASK_TAB_ID });
  });

  it("returns null for missing or corrupt storage", () => {
    expect(loadExplorerTabs("nope")).toBeNull();
    window.localStorage.setItem("multica_explorer_tabs:bad", "{not json");
    expect(loadExplorerTabs("bad")).toBeNull();
  });
});
