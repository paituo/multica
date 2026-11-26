// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseNameStatus, parseNumstat, parsePorcelain } from "./explorer-git-parse";

// The record shapes below were produced by a real `git` run against a throwaway
// repository (see the file header) rather than transcribed from the manual: the
// three `-z` formats disagree about which side of a rename comes first, and
// getting that backwards shows the pre-rename path to the user.

describe("parsePorcelain", () => {
  it("reads a modified file as XY plus path", () => {
    expect(parsePorcelain(" M src/app.ts\0")).toEqual([
      { status: " M", path: "src/app.ts" },
    ]);
  });

  it("reads an untracked file", () => {
    expect(parsePorcelain("?? docs/new.md\0")).toEqual([
      { status: "??", path: "docs/new.md" },
    ]);
  });

  it("keeps the target path and the source for a rename (target first)", () => {
    // `git status --porcelain=v1 -z` on a staged rename emits `R  NEW\0OLD\0`.
    expect(parsePorcelain("R  new-name.txt\0old-name.txt\0")).toEqual([
      { status: "R ", path: "new-name.txt", origPath: "old-name.txt" },
    ]);
  });

  it("does not consume the following entry as a rename source", () => {
    const entries = parsePorcelain(" M a.ts\0R  new.txt\0old.txt\0 M b.ts\0");
    expect(entries.map((entry) => entry.path)).toEqual(["a.ts", "new.txt", "b.ts"]);
  });
});

describe("parseNumstat", () => {
  it("maps additions and deletions by path", () => {
    expect(parseNumstat("12\t3\tsrc/app.ts\0")).toEqual(
      new Map([["src/app.ts", { additions: 12, deletions: 3 }]]),
    );
  });

  it("keeps binary counts as null", () => {
    expect(parseNumstat("-\t-\tlogo.png\0").get("logo.png")).toEqual({
      additions: null,
      deletions: null,
    });
  });

  it("keys a rename to its target path", () => {
    // A binary-free rename emits `2\t1\t\0OLD\0NEW\0`: the path field is empty.
    const totals = parseNumstat("2\t1\t\0old-name.txt\0new-name.txt\0");
    expect(totals.get("new-name.txt")).toEqual({ additions: 2, deletions: 1 });
    expect(totals.has("old-name.txt")).toBe(false);
  });

  it("recovers after a rename record", () => {
    const totals = parseNumstat("0\t0\t\0old.txt\0new.txt\0 7\t1\tafter.ts\0");
    expect([...totals.keys()]).toEqual(["new.txt", "after.ts"]);
  });
});

describe("parseNameStatus", () => {
  it("reads a plain entry", () => {
    expect(parseNameStatus("M\0src/app.ts\0", new Map())).toEqual([
      { path: "src/app.ts", status: "M", additions: null, deletions: null },
    ]);
  });

  it("reads the target of a rename (source first)", () => {
    // `git diff --name-status -z` emits `R084\0OLD\0NEW\0` — the opposite
    // ordering from `git status`, which is why this is pinned by a test.
    const totals = new Map([["new-name.txt", { additions: 2, deletions: 1 }]]);
    expect(parseNameStatus("R084\0old-name.txt\0new-name.txt\0", totals)).toEqual([
      { path: "new-name.txt", status: "R", additions: 2, deletions: 1 },
    ]);
  });

  it("does not swallow the entry that follows a rename", () => {
    const entries = parseNameStatus(
      "R100\0old.txt\0new.txt\0A\0added.ts\0D\0gone.ts\0",
      new Map(),
    );
    expect(entries.map((entry) => entry.path)).toEqual(["new.txt", "added.ts", "gone.ts"]);
  });
});
