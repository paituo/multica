import { describe, expect, it } from "vitest";
import type { ExplorerFileEntry } from "../../../../shared/explorer-api";
import { buildChangeTree, shortenDirectory, splitChangeGroups } from "./change-list";
import { buildFileTree, filterFilePaths, parentDirectories } from "./file-tree";
import { relativeTime } from "./relative-time";
import { statusBadgeClass, statusLetter } from "./status-badge";

describe("buildFileTree", () => {
  it("nests by directory and puts directories first", () => {
    const tree = buildFileTree(["src/b.ts", "README.md", "src/a.ts", "docs/x/y.md"]);

    expect(tree.map((node) => node.name)).toEqual(["docs", "src", "README.md"]);
    const src = tree.find((node) => node.name === "src");
    expect(src?.dir).toBe(true);
    expect(src?.children.map((node) => node.name)).toEqual(["a.ts", "b.ts"]);
    expect(tree.find((node) => node.name === "README.md")?.dir).toBe(false);
  });

  it("reuses a directory node shared by several files", () => {
    const tree = buildFileTree(["a/b/c.ts", "a/b/d.ts", "a/e.ts"]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].children.map((node) => node.name)).toEqual(["c.ts", "d.ts"]);
  });

  it("ignores empty entries", () => {
    expect(buildFileTree(["", "a.ts"])).toHaveLength(1);
  });
});

describe("buildChangeTree", () => {
  const entry = (path: string, additions: number, deletions: number): ExplorerFileEntry => ({
    path,
    additions,
    deletions,
    status: "M",
  });

  it("rolls additions and deletions up to the folder", () => {
    const tree = buildChangeTree([
      entry("src/a.ts", 10, 2),
      entry("src/deep/b.ts", 5, 1),
      entry("README.md", 3, 0),
    ]);

    const src = tree.find((node) => node.name === "src");
    expect(src?.dir).toBe(true);
    expect(src?.additions).toBe(15);
    expect(src?.deletions).toBe(3);
    expect(src?.files).toBe(2);

    const readme = tree.find((node) => node.name === "README.md");
    expect(readme?.dir).toBe(false);
    expect(readme?.entry?.path).toBe("README.md");
  });

  it("puts directories before files and sorts siblings by name", () => {
    const tree = buildChangeTree([entry("z.ts", 1, 0), entry("a/b.ts", 1, 0), entry("a.ts", 1, 0)]);
    expect(tree.map((node) => node.name)).toEqual(["a", "a.ts", "z.ts"]);
  });

  it("treats missing line counts as zero", () => {
    const [node] = buildChangeTree([{ path: "x.ts", additions: null, deletions: null, status: "??" }]);
    expect(node).toMatchObject({ additions: 0, deletions: 0, files: 1 });
  });
});

describe("filterFilePaths", () => {
  const files = ["src/app.ts", "src/app.test.ts", "docs/guide.md", "README.md"];

  it("returns the list untouched for a blank filter", () => {
    expect(filterFilePaths(files, "   ")).toEqual(files);
  });

  it("matches a substring, case-insensitively", () => {
    // "app.ts" is not a substring of "app.test.ts" — the dot is not a wildcard.
    expect(filterFilePaths(files, "APP.TS")).toEqual(["src/app.ts"]);
    expect(filterFilePaths(files, "TEST")).toEqual(["src/app.test.ts"]);
  });

  it("requires every whitespace-separated term", () => {
    // VS Code's file filter is an AND over the words, not a single substring.
    expect(filterFilePaths(files, "src test")).toEqual(["src/app.test.ts"]);
    expect(filterFilePaths(files, "docs test")).toEqual([]);
  });

  it("ignores entries that do not match", () => {
    expect(filterFilePaths(files, "nothing-here")).toEqual([]);
  });
});

describe("splitChangeGroups", () => {
  /** One porcelain record: `x` is index-vs-HEAD, `y` worktree-vs-index. */
  const porcelain = (path: string, x: string, y: string): ExplorerFileEntry => ({
    path,
    additions: null,
    deletions: null,
    status: x.trim() || y.trim() || null,
    indexStatus: x,
    worktreeStatus: y,
  });

  it("separates staged work from worktree edits", () => {
    const groups = splitChangeGroups([
      porcelain("staged.ts", "M", " "),
      porcelain("worktree.ts", " ", "M"),
    ]);

    expect(groups.map((group) => group.id)).toEqual(["staged", "unstaged"]);
    expect(groups[0].entries.map((entry) => entry.path)).toEqual(["staged.ts"]);
    expect(groups[1].entries.map((entry) => entry.path)).toEqual(["worktree.ts"]);
  });

  it("keeps a file edited on both sides in both groups", () => {
    // `MM` is what VS Code shows under Staged Changes *and* Changes; dropping
    // one of the two would hide half of the user's work.
    const groups = splitChangeGroups([porcelain("both.ts", "M", "M")]);
    expect(groups.map((group) => group.entries.map((entry) => entry.path))).toEqual([
      ["both.ts"],
      ["both.ts"],
    ]);
  });

  it("puts untracked files in Changes only", () => {
    const groups = splitChangeGroups([porcelain("new.ts", "?", "?")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("unstaged");
  });

  it("treats entries without porcelain columns as plain changes", () => {
    // A branch diff has no index to be staged into.
    const groups = splitChangeGroups([{ path: "a.ts", additions: 1, deletions: 0, status: "M" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("unstaged");
  });

  it("omits an empty group instead of rendering a bare header", () => {
    expect(splitChangeGroups([porcelain("a.ts", "A", " ")]).map((group) => group.id)).toEqual([
      "staged",
    ]);
    expect(splitChangeGroups([])).toEqual([]);
  });
});

describe("shortenDirectory", () => {
  it("keeps the tail, because the head is what every row shares", () => {
    // Measured in the harness: twelve rows of `apps/desktop/src/...` were
    // indistinguishable once the browser truncated the right end.
    expect(shortenDirectory("apps/desktop/src/components/explorer/")).toBe("…/explorer/");
  });

  it("keeps as many trailing segments as fit the budget", () => {
    // Two segments fit, three do not: the description stays inside the 320 px
    // sidebar instead of being clipped a second time.
    expect(shortenDirectory("apps/desktop/src/main/")).toBe("…/src/main/");
    expect(shortenDirectory("very/long/directory/name/")).toBe("…/directory/name/");
  });

  it("leaves a short path alone", () => {
    expect(shortenDirectory("src/")).toBe("src/");
    expect(shortenDirectory("src/components/")).toBe("src/components/");
    expect(shortenDirectory("docs/")).toBe("docs/");
    expect(shortenDirectory("")).toBe("");
  });

  it("keeps the trailing slash so a directory never reads like a file", () => {
    expect(shortenDirectory("a/b/c/d/e/f/")).toMatch(/\/$/);
    expect(shortenDirectory("a/b/c/d/e/f")).not.toMatch(/\/$/);
  });
});

describe("status letters", () => {
  it("abbreviates untracked files to U, as VS Code does", () => {
    expect(statusLetter("??", true)).toBe("U");
    expect(statusLetter("??", false)).toBe("?");
  });

  it("takes the first letter of a porcelain status", () => {
    expect(statusLetter("MM")).toBe("M");
    expect(statusLetter("m")).toBe("M");
    expect(statusLetter(null)).toBeNull();
    expect(statusLetter(" ")).toBeNull();
  });

  it("gives both new-file shapes the same colour", () => {
    expect(statusBadgeClass("A")).toBe(statusBadgeClass("??", true));
  });
});

describe("parentDirectories", () => {
  it("lists every ancestor of every path", () => {
    expect([...parentDirectories(["src/a/b.ts", "src/c.ts", "README.md"])].sort()).toEqual([
      "src",
      "src/a",
    ]);
  });

  it("stops at the last segment", () => {
    expect(parentDirectories(["top.md"]).size).toBe(0);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-11-26T11:00:00Z");

  it("formats in the app locale, not the OS one", () => {
    expect(relativeTime("2026-11-26T09:00:00Z", "en", now)).toBe("2 hours ago");
    expect(relativeTime("2026-11-26T09:00:00Z", "zh", now)).toBe("2小时前");
  });

  it("uses the largest unit that fits", () => {
    // 1 day 2 hours reads as "yesterday", not "26 hours ago".
    expect(relativeTime("2026-11-25T09:00:00Z", "en", now)).toBe("yesterday");
  });

  it("returns an empty string for an unparseable date", () => {
    expect(relativeTime("not a date", "en", now)).toBe("");
  });
});
