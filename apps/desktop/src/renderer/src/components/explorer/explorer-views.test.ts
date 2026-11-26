import { describe, expect, it } from "vitest";
import type { ExplorerFileEntry } from "../../../../shared/explorer-api";
import { buildChangeTree } from "./change-list";
import { buildFileTree } from "./file-tree";

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
