// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseCommitLog,
  parseDecorations,
  parseNameStatus,
  parseNumstat,
  parsePorcelain,
  parseSubmoduleStatus,
} from "./explorer-git-parse";

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

const US = "\x1f";

describe("parseDecorations", () => {
  it("strips the HEAD arrow and the tag prefix", () => {
    // `%D` on the checked-out commit of this repository.
    expect(parseDecorations("HEAD -> main, origin/main, tag: v1.2.3")).toEqual([
      "main",
      "origin/main",
      "v1.2.3",
    ]);
  });

  it("drops a detached HEAD rather than showing it as a name", () => {
    expect(parseDecorations("HEAD")).toEqual([]);
  });

  it("returns nothing for an undecorated commit", () => {
    // Every commit below the first one on a branch carries an empty `%D`.
    expect(parseDecorations("")).toEqual([]);
  });

  it("de-duplicates a branch that is both HEAD and a ref", () => {
    expect(parseDecorations("HEAD -> main, main")).toEqual(["main"]);
  });
});

describe("parseCommitLog", () => {
  // Verbatim `git log --format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%D%x1f%P -3`
  // from this repository, with the unit separators written as ${US}.
  const REAL = [
    [
      "64a0c00582b8c56a99953f6fa5ebffabbbdd430a",
      "64a0c0058",
      "paituo",
      "2026-11-26T09:39:21+08:00",
      "feat(explorer): give the text view grammars, find and a markdown preview",
      "HEAD -> main, origin/main, origin/HEAD",
      "cb66c392264cba603f1742fe7dcf5ff523d323f9",
    ].join(US),
    [
      "cb66c392264cba603f1742fe7dcf5ff523d323f9",
      "cb66c3922",
      "paituo",
      "2026-11-26T09:36:22+08:00",
      "feat(explorer): expose the tab strip as a real tablist",
      "",
      "182014982c3f1d0b8f469793ce45465da2eca38b",
    ].join(US),
  ].join("\n");

  it("reads the seven fields of a record", () => {
    const [first] = parseCommitLog(REAL);
    expect(first).toEqual({
      hash: "64a0c00582b8c56a99953f6fa5ebffabbbdd430a",
      shortHash: "64a0c0058",
      author: "paituo",
      date: "2026-11-26T09:39:21+08:00",
      subject: "feat(explorer): give the text view grammars, find and a markdown preview",
      refs: ["main", "origin/main", "origin/HEAD"],
      parents: ["cb66c392264cba603f1742fe7dcf5ff523d323f9"],
    });
  });

  it("keeps an undecorated commit in the list", () => {
    const commits = parseCommitLog(REAL);
    expect(commits).toHaveLength(2);
    expect(commits[1]?.refs).toEqual([]);
  });

  it("keeps a subject that contains a pipe and a tab", () => {
    // This is why the format uses `%x1f` rather than `|`: commit subjects are
    // free text, and `fix: a|b` would otherwise split into two fields.
    const line = ["abc1234", "abc1234", "t", "2026-01-01T00:00:00Z", `fix: a|b\tc`, "", ""].join(
      US,
    );
    expect(parseCommitLog(line)[0]?.subject).toBe("fix: a|b\tc");
  });

  it("records both parents of a merge", () => {
    const line = ["abc1234", "abc1234", "t", "2026-01-01T00:00:00Z", "Merge", "", "a1 b2"].join(US);
    expect(parseCommitLog(line)[0]?.parents).toEqual(["a1", "b2"]);
  });

  it("tolerates a truncated record", () => {
    // `--format` cannot omit fields, but a fatal warning on stderr can still
    // leave a short line; it must not throw and it must not yield undefined.
    const commits = parseCommitLog("abc1234\x1fabc1234");
    expect(commits[0]?.refs).toEqual([]);
    expect(commits[0]?.parents).toEqual([]);
    expect(commits[0]?.subject).toBe("");
  });

  it("ignores the trailing newline of the output", () => {
    expect(parseCommitLog(`${REAL}\n`)).toHaveLength(2);
  });
});

describe("parseSubmoduleStatus", () => {
  // Record shapes from `git help submodule`: a leading space (clean), `-`
  // (not initialised), `+` (checked out at another commit) or `U` (conflict),
  // then the recorded sha, the path, and optionally `(describe)`.
  // This machine's `git submodule` is unusable (its shell helper cannot find
  // `basename`/`sed`), so these are the documented shapes rather than a capture.
  it("reads a clean module and its describe suffix", () => {
    expect(parseSubmoduleStatus(" 8f4e2c1d3a5b7e9f0a2c4e6b8d1f3a5c7e9b0d2f libs/core (v1.4.0-3-g8f4e2c1)\n")).toEqual([
      {
        path: "libs/core",
        sha: "8f4e2c1d3a5b7e9f0a2c4e6b8d1f3a5c7e9b0d2f",
        state: "clean",
        describe: "v1.4.0-3-g8f4e2c1",
      },
    ]);
  });

  it("keeps a path that contains a space", () => {
    // Split on whitespace would turn this into path "apps/my" + describe "module".
    const [module] = parseSubmoduleStatus("-8f4e2c1d3a5b7e9f0a2c4e6b8d1f3a5c7e9b0d2f apps/my module\n");
    expect(module).toEqual({
      path: "apps/my module",
      sha: "8f4e2c1d3a5b7e9f0a2c4e6b8d1f3a5c7e9b0d2f",
      state: "uninitialized",
      describe: null,
    });
  });

  it("maps the three state prefixes", () => {
    const output = [
      "+8f4e2c1d3a5b7e9f0a2c4e6b8d1f3a5c7e9b0d2f vendor/ahead",
      "U8f4e2c1d3a5b7e9f0a2c4e6b8d1f3a5c7e9b0d2f vendor/conflicted",
    ].join("\n");
    expect(parseSubmoduleStatus(output).map((module) => module.state)).toEqual([
      "moved",
      "conflict",
    ]);
  });

  it("skips blank and unparseable lines", () => {
    expect(parseSubmoduleStatus("\nnot a submodule record\n")).toEqual([]);
  });
});
