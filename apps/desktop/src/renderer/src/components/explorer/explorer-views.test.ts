import { describe, expect, it } from "vitest";
import type { ExplorerFileEntry } from "../../../../shared/explorer-api";
import { buildChangeTree } from "./change-list";
import { buildFileTree, filterFilePaths } from "./file-tree";
import { relativeTime } from "./relative-time";

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
