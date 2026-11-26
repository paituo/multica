import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorerWindowContext } from "../../../../shared/explorer-window";
import { useExplorerTabs } from "@/stores/explorer-tabs";
import { EXPLORER_STRINGS } from "./strings";

// The three complaints this file exists for:
//
//   1. the rail's Files/Git buttons "reloaded the list" — both panels were
//      conditionally rendered, so each switch unmounted one and re-ran four git
//      commands for it;
//   2. switching between open file and diff tabs "reloaded" — the viewer was
//      unmounted, re-read over IPC and rebuilt its Monaco model;
//   3. the timeline sat under the editor instead of under the file tree.
//
// Every assertion below is about *requests*, not pixels: the point is that a
// switch costs nothing, and a mock that counts calls proves it.

const tabs = vi.hoisted(() => ({
  mounts: [] as string[],
  unmounts: [] as string[],
}));

/** Stands in for Monaco; counts mounts so "kept alive" is checkable. */
vi.mock("./file-viewer", async () => {
  const React = await import("react");
  return {
    FileViewer: ({ path, visible }: { path: string; visible: boolean }) => {
      React.useEffect(() => {
        tabs.mounts.push(path);
        return () => {
          tabs.unmounts.push(path);
        };
      }, [path]);
      return React.createElement("div", {
        "data-testid": `viewer:${path}`,
        "data-visible": String(visible),
      });
    },
  };
});

vi.mock("./diff-view", async () => {
  const React = await import("react");
  return {
    DiffView: ({ path }: { path?: string }) =>
      React.createElement("div", { "data-testid": `diff:${path ?? ""}` }),
  };
});

vi.mock("../issue-window", async () => {
  const React = await import("react");
  return { IssueWindow: () => React.createElement("div", { "data-testid": "issue-window" }) };
});

// The auth store is a registered singleton created at app boot; the window only
// reads two fields from it.
vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (state: { user: unknown; isLoading: boolean }) => unknown) =>
    selector({ user: { id: "user-1" }, isLoading: false }),
}));

// `useExplorerStrings` resolves through i18next; pinning it to the English
// dictionary keeps the assertions readable without booting a provider.
vi.mock("./strings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./strings")>();
  return { ...actual, useExplorerStrings: () => actual.EXPLORER_STRINGS.en };
});

vi.mock("../window-toolbar", () => ({ TRAFFIC_LIGHT_CLEARANCE: 78 }));

const strings = EXPLORER_STRINGS.en;

const listFiles = vi.fn();
const gitStatus = vi.fn();
const repos = vi.fn();
const gitLog = vi.fn();
const fileHistory = vi.fn();
const filePair = vi.fn();
const rootInfo = vi.fn();

const context: ExplorerWindowContext = {
  kind: "explorer",
  path: "/acme/issues/MUL-1",
  title: "MUL-1",
  worktree: "/worktree/MUL-1",
  project: null,
  branch: "main",
  workspaceSlug: "acme",
  issueId: "issue-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  tabs.mounts.length = 0;
  tabs.unmounts.length = 0;
  window.localStorage.clear();

  rootInfo.mockResolvedValue({
    ok: true,
    worktree: "/worktree/MUL-1",
    project: null,
    branch: "main",
    label: "MUL-1",
    defaultTarget: "worktree",
    worktreeGone: false,
  });
  listFiles.mockResolvedValue({ ok: true, files: ["a.ts", "b.ts", "src/c.ts"], truncated: false });
  gitStatus.mockResolvedValue({ ok: true, entries: [], truncated: false, base: null, baseStrategy: "head" });
  repos.mockResolvedValue({ ok: true, repos: [] });
  gitLog.mockResolvedValue({ ok: true, commits: [], branch: "main", truncated: false });
  fileHistory.mockResolvedValue({ ok: true, revisions: [], truncated: false });
  filePair.mockResolvedValue({
    ok: true,
    original: "",
    modified: "",
    originalPath: "src/c.ts",
    modifiedPath: "src/c.ts",
    problem: null,
  });

  vi.stubGlobal("desktopAPI", {
    explorer: { rootInfo, listFiles, gitStatus, repos, gitLog, fileHistory, filePair },
    closeWindow: vi.fn(),
  });
});

async function renderWindow() {
  const { ExplorerWindow } = await import("./explorer-window");
  render(<ExplorerWindow context={context} />);
  // The tree is what proves `listFiles` has landed.
  await screen.findByText("src");
}

function openTab(kind: "file" | "diff", path: string) {
  act(() => {
    useExplorerTabs.getState().open({
      id: `${kind}:${path}`,
      kind,
      title: path,
      path,
    });
  });
}

/** Lets the pane's async load settle inside `act`, so it cannot land mid-teardown. */
async function flush() {
  await act(async () => {
    // A macrotask, not two microtasks: the panes chain `then` on several
    // awaited IPC calls, and the last of those lands after the microtask queue
    // drains.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Opens a tab and waits for its IPC to land; the panes all fetch on mount. */
async function openTabAndSettle(kind: "file" | "diff", path: string) {
  openTab(kind, path);
  await flush();
}

describe("ExplorerWindow panels", () => {
  it("does not reload the file tree when the rail switches to Git and back", async () => {
    await renderWindow();
    expect(listFiles).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: strings.git }));
    // The changes panel is mounted lazily: its first visit pays for its own
    // three requests, once.
    await vi.waitFor(() => expect(repos).toHaveBeenCalledTimes(1));
    expect(gitLog).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: strings.files }));
    expect(listFiles).toHaveBeenCalledTimes(1);
    // Two independent consumers of the status: the tree decoration and the
    // change list. Two calls total, and none of them repeats on a switch back.
    expect(gitStatus).toHaveBeenCalledTimes(2);
  });

  it("keeps the hidden panel's data instead of re-reading it", async () => {
    await renderWindow();
    fireEvent.click(screen.getByRole("button", { name: strings.git }));
    await vi.waitFor(() => expect(gitLog).toHaveBeenCalledTimes(1));

    // Visiting Files again and returning to Git must not repeat the graph call.
    fireEvent.click(screen.getByRole("button", { name: strings.files }));
    fireEvent.click(screen.getByRole("button", { name: strings.git }));
    expect(gitLog).toHaveBeenCalledTimes(1);
    expect(repos).toHaveBeenCalledTimes(1);
  });
});

describe("ExplorerWindow tabs", () => {
  it("keeps an open file mounted while another tab is active", async () => {
    await renderWindow();
    await openTabAndSettle("file", "one.ts");
    expect(await screen.findByTestId("viewer:one.ts")).toBeInTheDocument();

    await openTabAndSettle("file", "two.ts");
    // Both viewers exist; the inactive one is hidden, not unmounted. Before
    // this, `two.ts` mounting meant `one.ts` was gone and would be re-read on
    // return.
    expect(screen.getByTestId("viewer:one.ts")).toHaveAttribute("data-visible", "false");
    expect(screen.getByTestId("viewer:two.ts")).toHaveAttribute("data-visible", "true");
    expect(tabs.unmounts).not.toContain("one.ts");

    act(() => useExplorerTabs.getState().activate("file:one.ts"));
    expect(screen.getByTestId("viewer:one.ts")).toHaveAttribute("data-visible", "true");
    // Still exactly one mount of each: activation is a display change.
    expect(tabs.mounts.filter((path) => path === "one.ts" || path === "two.ts")).toEqual([
      "one.ts",
      "two.ts",
    ]);
    expect(tabs.unmounts).not.toContain("one.ts");
  });

  it("keeps a file and its diff alive at the same time", async () => {
    await renderWindow();
    await openTabAndSettle("file", "keep.ts");
    await openTabAndSettle("diff", "src/keep-diff.ts");
    expect(await screen.findByTestId("diff:src/keep-diff.ts")).toBeInTheDocument();

    // The file viewer survives a diff tab taking over.
    expect(screen.getByTestId("viewer:keep.ts")).toHaveAttribute("data-visible", "false");
    expect(tabs.unmounts).not.toContain("keep.ts");
    await flush();
  });
});

describe("ExplorerWindow timeline", () => {
  it("puts the timeline under the file tree in the sidebar", async () => {
    await renderWindow();
    await openTabAndSettle("file", "a.ts");

    const filesPanel = document.querySelector('[data-explorer-panel="files"]');
    expect(filesPanel).not.toBeNull();
    // Rendered in the sidebar, next to the tree it belongs to…
    expect(within(filesPanel as HTMLElement).getByText(strings.timeline)).toBeInTheDocument();

    // …and only while a file tab is active: a diff tab has its own history.
    await openTabAndSettle("diff", "src/c.ts");
    await screen.findByTestId("diff:src/c.ts");
    expect(within(filesPanel as HTMLElement).queryByText(strings.timeline)).not.toBeInTheDocument();
    await flush();
  });
});
