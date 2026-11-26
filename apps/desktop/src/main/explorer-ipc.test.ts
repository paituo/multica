// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Drives the real IPC handlers against a throwaway git repository, so the git
// invocations, the containment checks and the porcelain parsing are exercised
// together rather than asserted piecemeal.

// Every case spawns real `git` subprocesses — dozens per run on a cold cache —
// so the 5 s default is nowhere near enough once the whole suite competes for
// the machine. A timeout here is not a slow assertion, it is a killed test that
// leaves the shared repository mid-flight for the next case.
vi.setConfig({ testTimeout: 30_000 });

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => ({ id: 1 })) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }),
  },
}));

const {
  EXPLORER_COMMIT_FILES_CHANNEL,
  EXPLORER_FILE_HISTORY_CHANNEL,
  EXPLORER_FILE_PAIR_AT_CHANNEL,
  EXPLORER_FILE_PAIR_CHANNEL,
  EXPLORER_GIT_LOG_CHANNEL,
  EXPLORER_GIT_STATUS_CHANNEL,
  EXPLORER_LIST_FILES_CHANNEL,
  EXPLORER_READ_BYTES_CHANNEL,
  EXPLORER_READ_FILE_CHANNEL,
  EXPLORER_REPOS_CHANNEL,
  EXPLORER_ROOT_INFO_CHANNEL,
} = await import("../shared/explorer-api");
const { registerExplorerRoots, setupExplorerIpc, unregisterExplorerRoots } = await import("./explorer-ipc");

const WEB_CONTENTS_ID = 4242;
const event = { sender: { id: WEB_CONTENTS_ID } };

const BASE_BRANCH = "agent/agent/t1";
const BASELINE_MESSAGE = "chore(agent): baseline - test";

let repo: string;
let baselineSha: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

/** The dirty state the worktree-mode assertions rely on; re-applied after any
 * forced checkout, since `-f` discards it. */
function makeDirty(): void {
  writeFileSync(join(repo, "src/app.ts"), "export const a = 3;\n");
  writeFileSync(join(repo, "untracked.md"), "# untracked\n");
}

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event, ...args) as Promise<T>;
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "explorer-ipc-"));
  git("init", "-q", "-b", "main", ".");
  git("config", "user.email", "test@multica.invalid");
  git("config", "user.name", "Explorer Test");
  git("config", "commit.gpgsign", "false");
  // The host's system gitconfig sets `core.autocrlf=true` on some machines; left
  // alone, a forced checkout would rewrite the working tree with CRLF and the
  // document assertions would compare line endings instead of content.
  git("config", "core.autocrlf", "false");

  writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "app.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  git("add", "-A");
  git("commit", "-qm", "initial");

  // The daemon cuts the task branch and writes a tagged baseline commit, then the
  // agent's own commits follow it.
  git("checkout", "-q", "-b", BASE_BRANCH);
  writeFileSync(join(repo, "baseline.txt"), "baseline\n");
  git("add", "-A");
  git("commit", "-qm", BASELINE_MESSAGE);
  baselineSha = git("rev-parse", "HEAD");

  writeFileSync(join(repo, "src", "app.ts"), "export const a = 2;\n");
  writeFileSync(join(repo, "src", "added.ts"), "export const b = 2;\n");
  git("add", "-A");
  git("commit", "-qm", "agent: change app and add file");

  // A dirty working tree on top, for worktree-mode assertions.
  makeDirty();

  registerExplorerRoots(WEB_CONTENTS_ID, { worktree: repo, project: repo, branch: BASE_BRANCH });
  setupExplorerIpc();
});

// Restore the shared repository *before* each case rather than at the tail of the
// mutating ones: a case that throws or times out never reaches its own cleanup,
// and every later case would then assert against whatever branch and working tree
// the dead one left behind.
beforeEach(() => {
  git("checkout", "-q", "-f", BASE_BRANCH);
  registerExplorerRoots(WEB_CONTENTS_ID, { worktree: repo, project: repo, branch: BASE_BRANCH });
  makeDirty();
});

afterAll(() => {
  unregisterExplorerRoots(WEB_CONTENTS_ID);
  rmSync(repo, { recursive: true, force: true });
});

describe("setupExplorerIpc registration", () => {
  it("registers every channel the window uses", () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        EXPLORER_ROOT_INFO_CHANNEL,
        EXPLORER_LIST_FILES_CHANNEL,
        EXPLORER_READ_FILE_CHANNEL,
        EXPLORER_READ_BYTES_CHANNEL,
        EXPLORER_GIT_STATUS_CHANNEL,
        EXPLORER_FILE_PAIR_CHANNEL,
        EXPLORER_FILE_PAIR_AT_CHANNEL,
        EXPLORER_FILE_HISTORY_CHANNEL,
        EXPLORER_GIT_LOG_CHANNEL,
        EXPLORER_COMMIT_FILES_CHANNEL,
        EXPLORER_REPOS_CHANNEL,
      ].sort(),
    );
  });

  it("reports the live roots", async () => {
    const result = await call<{ ok: true; worktree: string | null; project: string | null; branch: string; defaultTarget: string; worktreeGone: boolean }>(
      EXPLORER_ROOT_INFO_CHANNEL,
    );
    expect(result).toMatchObject({
      ok: true,
      worktree: repo,
      project: repo,
      branch: BASE_BRANCH,
      defaultTarget: "worktree",
      worktreeGone: false,
    });
  });
});

describe("explorer:list-files", () => {
  it("lists tracked and untracked files but not ignored ones", async () => {
    writeFileSync(join(repo, ".gitignore"), "ignored.log\n");
    writeFileSync(join(repo, "ignored.log"), "noise\n");
    const result = await call<{ ok: true; files: string[]; truncated: boolean }>(EXPLORER_LIST_FILES_CHANNEL, "worktree");
    expect(result.ok).toBe(true);
    expect(result.files).toContain("src/app.ts");
    expect(result.files).toContain("untracked.md");
    expect(result.files).not.toContain("ignored.log");
    rmSync(join(repo, ".gitignore"));
    rmSync(join(repo, "ignored.log"));
  });
});

describe("explorer:read-file", () => {
  it("returns text content", async () => {
    const result = await call<{ ok: true; content: { kind: string; text: string } }>(
      EXPLORER_READ_FILE_CHANNEL,
      "worktree",
      "src/app.ts",
    );
    expect(result.content.kind).toBe("text");
    expect(result.content.text).toContain("export const a = 3;");
  });

  it("flags a binary file instead of returning mojibake", async () => {
    const result = await call<{ ok: true; content: { kind: string; size: number } }>(
      EXPLORER_READ_FILE_CHANNEL,
      "worktree",
      "logo.png",
    );
    expect(result.content).toMatchObject({ kind: "binary" });
  });

  it("refuses to walk out of the root", async () => {
    expect(await call(EXPLORER_READ_FILE_CHANNEL, "worktree", "../../etc/passwd")).toEqual({
      ok: false,
      reason: "outside-root",
    });
  });

  it("refuses an absolute path", async () => {
    expect(await call(EXPLORER_READ_FILE_CHANNEL, "worktree", "C:\\Windows\\win.ini")).toEqual({
      ok: false,
      reason: "outside-root",
    });
  });

  it("reports a missing file as not-found", async () => {
    expect(await call(EXPLORER_READ_FILE_CHANNEL, "worktree", "nope.ts")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("explorer:git-status", () => {
  it("reports uncommitted worktree changes against HEAD", async () => {
    const result = await call<{
      ok: true;
      baseStrategy: string;
      entries: { path: string; status: string; untracked?: boolean }[];
    }>(EXPLORER_GIT_STATUS_CHANNEL, "worktree");

    expect(result.baseStrategy).toBe("head");
    const app = result.entries.find((entry) => entry.path === "src/app.ts");
    expect(app?.status).toBe("M");
    const untracked = result.entries.find((entry) => entry.path === "untracked.md");
    expect(untracked?.untracked).toBe(true);
    // Committed work is not a *working tree* change.
    expect(result.entries.some((entry) => entry.path === "src/added.ts")).toBe(false);
  });

  it("keeps the index and worktree columns apart", async () => {
    // Stage the modification the fixture already made, then edit again: `MM` is
    // the case the Staged Changes / Changes split is built on.
    git("add", "src/app.ts");
    writeFileSync(join(repo, "src/app.ts"), "export const a = 4;\n");

    const result = await call<{
      ok: true;
      entries: { path: string; status: string; indexStatus: string; worktreeStatus: string }[];
    }>(EXPLORER_GIT_STATUS_CHANNEL, "worktree");

    expect(result.entries.find((entry) => entry.path === "src/app.ts")).toMatchObject({
      status: "M",
      indexStatus: "M",
      worktreeStatus: "M",
    });
    // Untracked files are `?` in both columns, which is why the renderer must
    // not treat `?` as "staged".
    expect(result.entries.find((entry) => entry.path === "untracked.md")).toMatchObject({
      indexStatus: "?",
      worktreeStatus: "?",
    });
  });

  it("reports the agent's net branch changes from the tagged baseline", async () => {
    const result = await call<{
      ok: true;
      base: string | null;
      baseStrategy: string;
      entries: { path: string; status: string; additions: number | null }[];
    }>(EXPLORER_GIT_STATUS_CHANNEL, "project");

    // Locating the branch's own baseline (not merely the newest in the repo) is
    // what keeps this list to the agent's work instead of the whole task.
    expect(result.baseStrategy).toBe("baseline");
    expect(result.base).toBe(baselineSha);
    expect(result.entries.map((entry) => entry.path).sort()).toEqual(["src/added.ts", "src/app.ts"]);
    expect(result.entries.find((entry) => entry.path === "src/added.ts")?.status).toBe("A");
  });

  it("ignores a baseline commit that the project branch already merged", async () => {
    // A finished task's baseline stays in the repository and lands on the project
    // branch. A new task cut from there must not adopt it as its own base, or the
    // change list would swallow everything merged since.
    git("checkout", "-q", "-f", "main");
    git("merge", "-q", "--no-ff", "-m", "merge task branch", BASE_BRANCH);
    git("checkout", "-q", "-b", "next-task", "main");
    writeFileSync(join(repo, "next.txt"), "next\n");
    git("add", "next.txt");
    git("commit", "-qm", "agent: next task work");
    // The durable project directory stays on the project branch.
    git("checkout", "-q", "-f", "main");
    registerExplorerRoots(WEB_CONTENTS_ID, { worktree: repo, project: repo, branch: "next-task" });

    const result = await call<{ ok: true; baseStrategy: string; base: string | null; entries: { path: string }[] }>(
      EXPLORER_GIT_STATUS_CHANNEL,
      "project",
    );

    expect(result.baseStrategy).toBe("merge-base");
    expect(result.base).not.toBe(baselineSha);
    expect(result.entries.map((entry) => entry.path)).toEqual(["next.txt"]);

  });

  it("falls back to merge-base when the branch has no baseline commit of its own", async () => {
    git("checkout", "-q", "-f", "main");
    git("checkout", "-q", "-b", "no-baseline", "main");
    writeFileSync(join(repo, "plain.txt"), "plain\n");
    git("add", "plain.txt");
    git("commit", "-qm", "plain work without a baseline");
    // HEAD back on the project branch, as the durable project directory is.
    git("checkout", "-q", "-f", "main");
    registerExplorerRoots(WEB_CONTENTS_ID, { worktree: repo, project: repo, branch: "no-baseline" });

    const result = await call<{ ok: true; baseStrategy: string; entries: { path: string }[] }>(
      EXPLORER_GIT_STATUS_CHANNEL,
      "project",
    );
    expect(result.baseStrategy).toBe("merge-base");
    expect(result.entries.map((entry) => entry.path)).toEqual(["plain.txt"]);

  });
});

describe("explorer:file-pair", () => {
  type Pair = {
    ok: true;
    original: string;
    modified: string;
    originalPath: string;
    modifiedPath: string;
    originalSize: number;
    modifiedSize: number;
    problem: null | "too-large" | "binary";
  };

  it("returns both documents for a file changed in the working tree", async () => {
    const pair = await call<Pair>(EXPLORER_FILE_PAIR_CHANNEL, "worktree", "src/app.ts");
    // HEAD holds the agent's commit, the disk holds the uncommitted edit.
    expect(pair.original).toBe("export const a = 2;\n");
    expect(pair.modified).toBe("export const a = 3;\n");
    expect(pair.originalPath).toBe("src/app.ts");
    expect(pair.modifiedPath).toBe("src/app.ts");
    expect(pair.problem).toBeNull();
  });

  it("gives an untracked file an empty base side instead of failing", async () => {
    const pair = await call<Pair>(EXPLORER_FILE_PAIR_CHANNEL, "worktree", "untracked.md");
    expect(pair.original).toBe("");
    expect(pair.originalSize).toBe(0);
    expect(pair.modified).toBe("# untracked\n");
    expect(pair.problem).toBeNull();
  });

  it("flags a binary file rather than handing the editor mojibake", async () => {
    const pair = await call<Pair>(EXPLORER_FILE_PAIR_CHANNEL, "worktree", "logo.png");
    expect(pair.problem).toBe("binary");
    // Both sides still report sizes, so the viewer can say *why* it degraded.
    expect(pair.originalSize).toBeGreaterThan(0);
    expect(pair.modifiedSize).toBeGreaterThan(0);
  });

  it("reads the durable project directory from the branch range", async () => {
    const pair = await call<Pair>(EXPLORER_FILE_PAIR_CHANNEL, "project", "src/added.ts", {
      base: baselineSha,
    });
    expect(pair.original).toBe("");
    expect(pair.modified).toBe("export const b = 2;\n");
    expect(pair.problem).toBeNull();
  });

  it("refuses a path outside the root", async () => {
    expect(await call(EXPLORER_FILE_PAIR_CHANNEL, "worktree", "../../../etc/hosts")).toEqual({
      ok: false,
      reason: "outside-root",
    });
  });

  it("resolves the base side of a rename to the old path", async () => {
    // `git diff --name-status -- <path>` turns rename detection off for a
    // pathspec, so the handler has to scan the whole change set; this asserts
    // the resulting pair still sees the pre-rename document.
    git("mv", "a.txt", "a-renamed.txt");
    try {
      const pair = await call<Pair>(EXPLORER_FILE_PAIR_CHANNEL, "worktree", "a-renamed.txt");
      expect(pair.originalPath).toBe("a.txt");
      expect(pair.original).toBe("one\ntwo\n");
      expect(pair.modified).toBe("one\ntwo\n");
    } finally {
      git("reset", "-q", "--hard", BASE_BRANCH);
      git("clean", "-qfd");
      makeDirty();
    }
  });
});

describe("window binding", () => {
  it("rejects a sender that is not a known window", async () => {
    const stranger = { sender: { id: 999_999 } };
    const handler = handlers.get(EXPLORER_ROOT_INFO_CHANNEL);
    expect(await handler?.(stranger)).toEqual({ ok: false, reason: "no-root" });
  });

  it("does not leave git artefacts behind", () => {
    expect(readdirSync(repo).length).toBeGreaterThan(0);
  });
});

describe("explorer:git-log", () => {
  type Log = {
    ok: true;
    commits: { hash: string; shortHash: string; subject: string; refs: string[]; parents: string[] }[];
    branch: string | null;
    truncated: boolean;
  };

  it("lists the branch newest first and names it", async () => {
    const result = await call<Log>(EXPLORER_GIT_LOG_CHANNEL, "worktree");
    expect(result.branch).toBe(BASE_BRANCH);
    expect(result.truncated).toBe(false);
    expect(result.commits.map((commit) => commit.subject)).toEqual([
      "agent: change app and add file",
      BASELINE_MESSAGE,
      "initial",
    ]);
    expect(result.commits[0]?.hash).toBe(git("rev-parse", "HEAD"));
  });

  it("decorates the checked-out commit with the branch name", async () => {
    const result = await call<Log>(EXPLORER_GIT_LOG_CHANNEL, "worktree");
    // `%D` renders `HEAD -> agent/agent/t1`; the arrow is a pointer, not a name.
    expect(result.commits[0]?.refs).toEqual([BASE_BRANCH]);
    expect(result.commits[2]?.refs).toEqual([]);
  });

  it("reports truncation instead of silently cutting the list", async () => {
    const result = await call<Log>(EXPLORER_GIT_LOG_CHANNEL, "worktree", { limit: 1 });
    expect(result.commits).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});

describe("explorer:file-history", () => {
  type History = { ok: true; revisions: { hash: string; subject: string }[]; truncated: boolean };

  it("lists the commits that touched one file, newest first", async () => {
    const result = await call<History>(EXPLORER_FILE_HISTORY_CHANNEL, "worktree", "src/app.ts");
    expect(result.revisions.map((revision) => revision.subject)).toEqual([
      "agent: change app and add file",
      "initial",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("leaves out commits that did not touch the file", async () => {
    // The baseline commit only adds baseline.txt.
    const result = await call<History>(EXPLORER_FILE_HISTORY_CHANNEL, "worktree", "src/app.ts");
    expect(result.revisions.map((revision) => revision.hash)).not.toContain(baselineSha);
  });

  it("truncates on the same `limit` contract as the log", async () => {
    const result = await call<History>(EXPLORER_FILE_HISTORY_CHANNEL, "worktree", "src/app.ts", {
      limit: 1,
    });
    expect(result.revisions).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("refuses a path outside the root", async () => {
    expect(
      await call(EXPLORER_FILE_HISTORY_CHANNEL, "worktree", "../../../etc/hosts"),
    ).toEqual({ ok: false, reason: "outside-root" });
  });
});

describe("explorer:commit-files", () => {
  type CommitFiles = {
    ok: true;
    files: { path: string; status: string; additions: number | null; deletions: number | null }[];
  };

  it("lists what a commit changed", async () => {
    const result = await call<CommitFiles>(EXPLORER_COMMIT_FILES_CHANNEL, "worktree", baselineSha);
    expect(result.files.map((file) => [file.path, file.status])).toEqual([["baseline.txt", "A"]]);
    expect(result.files[0]?.additions).toBe(1);
  });

  it("rejects anything that is not a hex revision", async () => {
    // `HEAD:../../x` would be a different object spec if it reached `git show`.
    expect(await call(EXPLORER_COMMIT_FILES_CHANNEL, "worktree", "HEAD")).toEqual({
      ok: false,
      reason: "failed",
      message: "Invalid revision",
    });
  });

  it("lists what a merge commit brought in, rather than nothing", async () => {
    // `git show <merge>` prints no diff at all, so the naive implementation
    // reports an empty file list for every PR merge. Diffing against the first
    // parent is what the graph's expanded row needs.
    git("checkout", "-q", "-f", "-b", "merge-scratch", BASE_BRANCH);
    git("checkout", "-q", "-b", "merge-side");
    writeFileSync(join(repo, "side.txt"), "side\n");
    git("add", "side.txt");
    git("commit", "-qm", "side work");
    git("checkout", "-q", "merge-scratch");
    writeFileSync(join(repo, "main-side.txt"), "main\n");
    git("add", "main-side.txt");
    git("commit", "-qm", "main work");
    git("merge", "-q", "--no-ff", "-m", "merge side", "merge-side");
    const mergeSha = git("rev-parse", "HEAD");

    const result = await call<CommitFiles>(EXPLORER_COMMIT_FILES_CHANNEL, "worktree", mergeSha);
    // Everything the merge added *on top of its first parent* — which is the
    // side branch's file, not the commit made on the mainline before merging.
    expect(result.files.map((file) => file.path)).toEqual(["side.txt"]);

    // Scratch branches only: BASE_BRANCH must stay where the other cases expect.
    git("checkout", "-q", "-f", BASE_BRANCH);
    git("branch", "-q", "-D", "merge-scratch", "merge-side");
  });
});

describe("explorer:file-pair-at", () => {
  type Pair = { ok: true; original: string; modified: string; originalSize: number; problem: null | string };

  it("diffs a file against the commit that changed it", async () => {
    const head = git("rev-parse", "HEAD");
    const pair = await call<Pair>(EXPLORER_FILE_PAIR_AT_CHANNEL, "worktree", "src/app.ts", head);
    expect(pair.original).toBe("export const a = 1;\n");
    expect(pair.modified).toBe("export const a = 2;\n");
    expect(pair.problem).toBeNull();
  });

  it("treats a file added by the commit as an empty base", async () => {
    const head = git("rev-parse", "HEAD");
    const pair = await call<Pair>(EXPLORER_FILE_PAIR_AT_CHANNEL, "worktree", "src/added.ts", head);
    expect(pair.original).toBe("");
    expect(pair.originalSize).toBe(0);
    expect(pair.modified).toBe("export const b = 2;\n");
  });

  it("reads a root commit as an addition rather than an error", async () => {
    // The first commit has no parent, so `<rev>^` does not resolve.
    const root = git("rev-list", "--max-parents=0", "HEAD");
    const pair = await call<Pair>(EXPLORER_FILE_PAIR_AT_CHANNEL, "worktree", "src/app.ts", root);
    expect(pair.original).toBe("");
    expect(pair.modified).toBe("export const a = 1;\n");
  });

  it("rejects anything that is not a hex revision", async () => {
    expect(
      await call(EXPLORER_FILE_PAIR_AT_CHANNEL, "worktree", "src/app.ts", "HEAD~1"),
    ).toEqual({ ok: false, reason: "failed", message: "Invalid revision" });
  });
});

describe("explorer:repos", () => {
  type Repos = {
    ok: true;
    repos: {
      id: string;
      path: string;
      isRoot: boolean;
      branch: string | null;
      pending: number | null;
      initialized: boolean;
    }[];
  };

  it("reports the task repository with its branch and pending count", async () => {
    const result = await call<Repos>(EXPLORER_REPOS_CHANNEL, "worktree");
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]).toMatchObject({
      id: "root",
      isRoot: true,
      branch: BASE_BRANCH,
      // `makeDirty()` leaves one modified file and one untracked file.
      pending: 2,
      initialized: true,
    });
  });
});

describe("explorer:read-bytes", () => {
  type Bytes = { ok: true; file: { bytes: Uint8Array; mimeType: string; size: number } };

  it("returns the raw bytes with a MIME type from the extension", async () => {
    const result = await call<Bytes>(EXPLORER_READ_BYTES_CHANNEL, "worktree", "logo.png");
    expect(result.ok).toBe(true);
    expect(result.file.mimeType).toBe("image/png");
    expect(result.file.size).toBe(6);
    // A PNG signature, byte for byte: this path must not decode as UTF-8 on the
    // way through, which is exactly what `readFile` would refuse to do.
    expect([...result.file.bytes]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
  });

  it("refuses a path outside the window's root", async () => {
    const result = await call<{ ok: false; reason: string }>(
      EXPLORER_READ_BYTES_CHANNEL,
      "worktree",
      "../../etc/passwd",
    );
    expect(result).toMatchObject({ ok: false, reason: "outside-root" });
  });

  it("reports a missing file as not-found", async () => {
    const result = await call<{ ok: false; reason: string }>(
      EXPLORER_READ_BYTES_CHANNEL,
      "worktree",
      "nope.png",
    );
    expect(result).toMatchObject({ ok: false, reason: "not-found" });
  });

  it("refuses a window that was never given roots", async () => {
    const handler = handlers.get(EXPLORER_READ_BYTES_CHANNEL)!;
    // A sender with no registered root is the main window: the channel exists
    // there too, but it must not reach any directory.
    const result = (await handler({ sender: { id: 999_999 } }, "worktree", "logo.png")) as {
      ok: false;
      reason: string;
    };
    expect(result).toMatchObject({ ok: false, reason: "no-root" });
  });
});
