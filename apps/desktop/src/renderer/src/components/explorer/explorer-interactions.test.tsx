import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorerFileEntry } from "../../../../shared/explorer-api";
import { ChangeList } from "./change-list";
import { FileTree } from "./file-tree";
import { EXPLORER_STRINGS } from "./strings";

// These drive the components the way a reader does — click a section header,
// type in the filter, hide untracked files — because the first version of this
// pane was correct in units and wrong when used: the badge said one thing, the
// list another, and a collapsed group could hide every match.

const strings = EXPLORER_STRINGS.en;

/** One `git status --porcelain` record, as the main process now sends it. */
function entry(path: string, x: string, y: string): ExplorerFileEntry {
  const untracked = x === "?" && y === "?";
  return {
    path,
    additions: 3,
    deletions: 1,
    status: untracked ? "??" : x.trim() || y.trim() || null,
    untracked,
    indexStatus: x,
    worktreeStatus: y,
  };
}

const staged = entry("src/staged.ts", "M", " ");
const unstaged = entry("src/edited.ts", " ", "M");
const both = entry("src/both.ts", "M", "M");
const untracked = entry("notes/new.md", "?", "?");

const gitStatus = vi.fn();

beforeEach(() => {
  gitStatus.mockReset();
  gitStatus.mockResolvedValue({
    ok: true,
    entries: [staged, unstaged, both, untracked],
    truncated: false,
    base: "abc1234",
    baseStrategy: "head",
  });
  // Only the one channel this pane touches; the rest of the bridge is unused.
  vi.stubGlobal("desktopAPI", { explorer: { gitStatus } });
});

function renderChangeList(onOpenDiff = vi.fn(), selectedPath: string | null = null) {
  render(
    <ChangeList
      target="worktree"
      refreshToken={0}
      selectedPath={selectedPath}
      onOpenDiff={onOpenDiff}
      strings={strings}
    />,
  );
  return onOpenDiff;
}

describe("ChangeList", () => {
  it("splits staged work from worktree edits, with a count per group", async () => {
    renderChangeList();

    const stagedHeader = await screen.findByRole("button", { name: /staged changes/i });
    const changesHeader = screen.getByRole("button", { name: /^changes/i });

    // `both.ts` is edited on both sides of the index, so it appears in both.
    expect(stagedHeader).toHaveTextContent("2");
    expect(changesHeader).toHaveTextContent("3");
  });

  it("abbreviates an untracked file to U", async () => {
    renderChangeList();
    const row = await screen.findByTitle(/notes\/new\.md/);
    expect(within(row).getByText("U")).toBeInTheDocument();
  });

  it("opens the diff of the row that was clicked, with the base it was listed against", async () => {
    const onOpenDiff = renderChangeList();
    // `both.ts` is listed twice, once per group; either row opens the same diff.
    const rows = await screen.findAllByTitle("src/both.ts");
    fireEvent.click(rows[0]);
    expect(onOpenDiff).toHaveBeenCalledWith(expect.objectContaining({ path: "src/both.ts" }), "abc1234");
  });

  it("hides a group's rows when its header is collapsed", async () => {
    renderChangeList();
    const header = await screen.findByRole("button", { name: /staged changes/i });
    expect(screen.getByTitle("src/staged.ts")).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.queryByTitle("src/staged.ts")).not.toBeInTheDocument();
    // The other group is untouched — collapse state is per group.
    expect(screen.getByTitle("src/edited.ts")).toBeInTheDocument();
  });

  it("filters both groups and re-counts them", async () => {
    renderChangeList();
    const input = await screen.findByRole("textbox", { name: strings.filterChanges });
    fireEvent.change(input, { target: { value: "BOTH" } });

    // Only `src/both.ts` survives, in both groups.
    expect(screen.getAllByTitle("src/both.ts")).toHaveLength(2);
    expect(screen.queryByTitle("notes/new.md")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /staged changes/i })).toHaveTextContent("1");
  });

  it("says so when the filter matches nothing, rather than claiming a clean tree", async () => {
    renderChangeList();
    const input = await screen.findByRole("textbox", { name: strings.filterChanges });
    fireEvent.change(input, { target: { value: "no-such-file" } });

    expect(await screen.findByText(strings.filterNoMatch)).toBeInTheDocument();
    expect(screen.queryByText(strings.noChanges)).not.toBeInTheDocument();
  });

  it("drops untracked files when the eye is switched off", async () => {
    renderChangeList();
    expect(await screen.findByTitle(/notes\/new\.md/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: strings.showUntracked }));

    await waitFor(() => expect(screen.queryByTitle(/notes\/new\.md/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^changes/i })).toHaveTextContent("2");
  });

  it("keeps the open diff's row highlighted, and only that row", async () => {
    renderChangeList(vi.fn(), "src/edited.ts");

    expect(await screen.findByTitle("src/edited.ts")).toHaveAttribute("aria-current", "true");
    // Every other row — including the same file listed in the other group —
    // stays unmarked, otherwise the highlight says "something is open" instead
    // of "this is what is open".
    expect(screen.getAllByTitle("src/both.ts")[0]).not.toHaveAttribute("aria-current");
    expect(screen.getByTitle("src/staged.ts")).not.toHaveAttribute("aria-current");
  });
});

describe("FileTree", () => {
  const files = ["src/app.ts", "src/deep/util.ts", "README.md"];
  const decorations = new Map([
    ["src/app.ts", { status: "M", untracked: false }],
    ["README.md", { status: "??", untracked: true }],
  ]);

  function renderTree(expanded: ReadonlySet<string> = new Set()) {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(
      <FileTree
        files={files}
        selectedPath="src/app.ts"
        filter=""
        expanded={expanded}
        onToggle={onToggle}
        decorations={decorations}
        onOpen={onOpen}
        strings={strings}
      />,
    );
    return { onToggle, onOpen };
  }

  it("marks changed files with their git letter", () => {
    renderTree(new Set(["src", "src/deep"]));
    expect(screen.getByTitle("src/app.ts")).toHaveTextContent("M");
    expect(screen.getByTitle("README.md")).toHaveTextContent("U");
    // A clean file gets no letter at all.
    expect(screen.getByTitle("src/deep/util.ts")).not.toHaveTextContent(/[MAU]/);
  });

  it("keeps directories closed until the caller expands them", () => {
    const { onToggle } = renderTree();
    expect(screen.queryByTitle("src/app.ts")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("src"));
    expect(onToggle).toHaveBeenCalledWith("src");
  });

  it("opens a file rather than toggling it", () => {
    const { onOpen } = renderTree(new Set(["src"]));
    fireEvent.click(screen.getByTitle("src/app.ts"));
    expect(onOpen).toHaveBeenCalledWith("src/app.ts");
  });

  it("walks the visible rows with the arrow keys", () => {
    renderTree(new Set(["src", "src/deep"]));
    const tree = screen.getByRole("group", { name: strings.files });

    // Nothing focused yet: the first arrow press lands on the first row.
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTitle("src"));

    // DOM order is display order: `src`, `src/deep`, `src/deep/util.ts`, …
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTitle("src/deep"));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTitle("src/deep/util.ts"));

    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByTitle("src"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(screen.getByTitle("README.md"));
  });

  it("folds and unfolds a directory with left and right", () => {
    const { onToggle } = renderTree();
    const tree = screen.getByRole("group", { name: strings.files });

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    // Collapsed directory: right opens it instead of moving.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(onToggle).toHaveBeenCalledWith("src");
  });

  it("steps into an open directory with right", () => {
    renderTree(new Set(["src"]));
    const tree = screen.getByRole("group", { name: strings.files });

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    // Already open, so right moves to the first child rather than re-toggling.
    // Directories sort first, so that child is `src/deep`, not `src/app.ts`.
    expect(document.activeElement).toBe(screen.getByTitle("src/deep"));
  });

  it("walks back out of a directory with left", () => {
    const { onToggle } = renderTree(new Set(["src", "src/deep"]));
    const tree = screen.getByRole("group", { name: strings.files });

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTitle("src/deep/util.ts"));

    // A file has nothing to collapse, so left climbs to its directory.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(screen.getByTitle("src/deep"));

    // On an open directory, left collapses it.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(onToggle).toHaveBeenCalledWith("src/deep");
  });
});
