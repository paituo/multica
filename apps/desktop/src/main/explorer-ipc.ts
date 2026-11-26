import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  EXPLORER_FILE_PAIR_CHANNEL,
  EXPLORER_GIT_STATUS_CHANNEL,
  EXPLORER_LIST_FILES_CHANNEL,
  EXPLORER_READ_FILE_CHANNEL,
  EXPLORER_ROOT_INFO_CHANNEL,
  type ExplorerChangeSet,
  type ExplorerFailure,
  type ExplorerFileContent,
  type ExplorerFileEntry,
  type ExplorerFilePair,
  type ExplorerResult,
  type ExplorerRootInfo,
  type ExplorerTarget,
} from "../shared/explorer-api";
import { parseNameStatus, parseNumstat, parsePorcelain } from "./explorer-git-parse";
import { existingDirectory, failure, resolveInside } from "./explorer-paths";

/**
 * Filesystem and git access for task explorer windows.
 *
 * The security model is "the root belongs to the window": `registerExplorerRoots`
 * records the two directories a window was opened on, keyed by its
 * `webContents.id`, and every request resolves against that record. A renderer
 * never supplies an absolute path, so it cannot reach outside the task it was
 * opened for even though the renderer itself runs with `webSecurity: false`.
 *
 * Read-only by construction: there is no write, rename, or delete channel here.
 */

export type ExplorerRoots = {
  worktree: string | null;
  project: string | null;
  branch: string | null;
};

const rootsByWindow = new Map<number, ExplorerRoots>();

export function registerExplorerRoots(webContentsId: number, roots: ExplorerRoots): void {
  rootsByWindow.set(webContentsId, roots);
}

export function unregisterExplorerRoots(webContentsId: number): void {
  rootsByWindow.delete(webContentsId);
}

const MAX_LISTED_FILES = 5_000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8_192;
const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

function ok<T extends object>(value: T): ExplorerResult<T> {
  return Object.assign({ ok: true as const }, value);
}

// --- git ------------------------------------------------------------------

/**
 * Windows GUI launches inherit an edited PATH (`main/index.ts:141-143` notes the
 * same hazard for spawning), so `git` is not guaranteed to resolve. Probe the
 * installer default locations once and cache whichever answers.
 */
function gitCandidates(): string[] {
  if (process.platform !== "win32") return ["git"];
  return [
    "git",
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
  ];
}

let cachedGitBinary: string | null = null;

function runBinary(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs = GIT_TIMEOUT_MS,
  maxBuffer = GIT_MAX_BUFFER,
): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      bin,
      args,
      { cwd, timeout: timeoutMs, maxBuffer, windowsHide: true, encoding: null },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise(Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout), "utf8"));
      },
    );
  });
}

async function resolveGitBinary(): Promise<string | null> {
  if (cachedGitBinary) return cachedGitBinary;
  for (const candidate of gitCandidates()) {
    try {
      await runBinary(candidate, ["--version"], process.cwd(), 5_000, 1024 * 1024);
      cachedGitBinary = candidate;
      return candidate;
    } catch {
      // Probe the next candidate.
    }
  }
  return null;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const bin = await resolveGitBinary();
  if (!bin) throw new Error("git_not_found");
  const stdout = await runBinary(bin, args, cwd);
  return stdout.toString("utf8");
}

/**
 * Blob output must not go through `toString("utf8")` on the way in: a binary
 * file would be silently mangled into replacement characters and then look like
 * a text file full of U+FFFD. Read raw, sniff, then decode.
 */
async function gitBuffer(cwd: string, args: string[]): Promise<Buffer> {
  const bin = await resolveGitBinary();
  if (!bin) throw new Error("git_not_found");
  return runBinary(bin, args, cwd);
}

// --- root + path containment ---------------------------------------------

async function rootsForWindow(event: IpcMainInvokeEvent): Promise<ExplorerRoots | null> {
  if (!BrowserWindow.fromWebContents(event.sender)) return null;
  return rootsByWindow.get(event.sender.id) ?? null;
}

async function rootForTarget(
  roots: ExplorerRoots,
  target: unknown,
): Promise<{ root: string; target: ExplorerTarget } | ExplorerFailure> {
  // Anything that is not an explicit "project" request falls back to the
  // worktree, so a malformed argument can never reach the project directory.
  const kind: ExplorerTarget = target === "project" ? "project" : "worktree";
  const candidate = kind === "project" ? roots.project : roots.worktree;
  if (!candidate) return failure("no-root", `Target ${kind} has no directory`);
  const dir = await existingDirectory(candidate);
  if (!dir) return failure("not-a-directory", `${candidate} is gone`);
  return { root: dir, target: kind };
}

// --- collectors -----------------------------------------------------------

async function headCommit(root: string): Promise<string | null> {
  try {
    const sha = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * Locate the baseline commit a task branch was cut from. The daemon writes a
 * fixed message (`local_worktree.go:843-850`) with three possible suffixes, and
 * several tasks can share one parent, so the search has to be scoped to the
 * branch's *own* commits: the fork point with HEAD bounds them, and the daemon
 * commits the baseline immediately after cutting the branch, so the oldest
 * match after that point is the one this task started from.
 *
 * Scoping matters because a finished task's baseline stays in the repository and
 * is merged into the project branch. A "most recent baseline anywhere" search
 * would hand the next task a stale base and its diff would swallow everything
 * merged since. When the branch has own commits but none of them is a baseline,
 * there is no baseline for it at all — fall to `merge-base` rather than reaching
 * back into merged history.
 */
async function resolveBaseline(
  root: string,
  branch: string,
): Promise<{ base: string | null; strategy: ExplorerChangeSet["baseStrategy"] }> {
  const baselinesIn = async (range: string[]): Promise<string[]> => {
    try {
      const out = await git(root, [
        "log",
        "-F",
        "--grep=chore(agent): baseline",
        "--reverse",
        "--format=%H",
        ...range,
      ]);
      return out
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      // Branch may not exist locally, or HEAD is unborn.
      return [];
    }
  };

  let mergeBase: string | null = null;
  try {
    mergeBase = (await git(root, ["merge-base", branch, "HEAD"])).trim() || null;
  } catch {
    mergeBase = null;
  }

  if (mergeBase) {
    const ownCommits = await git(root, ["rev-list", `${mergeBase}..${branch}`])
      .then((out) => out.split("\n").filter((line) => line.trim()).length)
      .catch(() => 0);
    if (ownCommits > 0) {
      const own = await baselinesIn([`${mergeBase}..${branch}`]);
      if (own.length > 0) return { base: own[0], strategy: "baseline" };
      return { base: mergeBase, strategy: "merge-base" };
    }
  }

  // HEAD sits on the branch itself (or the range is empty), so the whole history
  // is the branch's own story.
  const all = await baselinesIn([branch]);
  if (all.length > 0) return { base: all[0], strategy: "baseline" };
  if (mergeBase) return { base: mergeBase, strategy: "merge-base" };
  return { base: null, strategy: "none" };
}

async function collectWorktreeChanges(root: string): Promise<ExplorerChangeSet> {
  const [statusOut, numstatOut, head] = await Promise.all([
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(root, ["diff", "--numstat", "-z", "HEAD"]).catch(() => ""),
    headCommit(root),
  ]);

  const statuses = parsePorcelain(statusOut);
  const totals = parseNumstat(numstatOut);
  const entries: ExplorerFileEntry[] = statuses.map((entry) => {
    const total = totals.get(entry.path);
    return {
      path: entry.path,
      status: entry.status.trim() || entry.status,
      additions: total?.additions ?? null,
      deletions: total?.deletions ?? null,
      untracked: entry.status === "??",
    };
  });

  return { entries, truncated: false, base: head, baseStrategy: head ? "head" : "none" };
}

async function collectBranchChanges(root: string, branch: string): Promise<ExplorerChangeSet> {
  const { base, strategy } = await resolveBaseline(root, branch);
  if (!base) return { entries: [], truncated: false, base: null, baseStrategy: "none" };

  const range = `${base}..${branch}`;
  const [nameStatusOut, numstatOut] = await Promise.all([
    git(root, ["diff", "--name-status", "-z", range]).catch(() => ""),
    git(root, ["diff", "--numstat", "-z", range]).catch(() => ""),
  ]);

  const totals = parseNumstat(numstatOut);
  return {
    entries: parseNameStatus(nameStatusOut, totals),
    truncated: false,
    base,
    baseStrategy: strategy,
  };
}

// --- file pairs -----------------------------------------------------------

type BlobSide =
  | { status: "text"; text: string; size: number }
  | { status: "problem"; problem: "too-large" | "binary"; size: number }
  | { status: "absent" };

/**
 * One side of a diff, read from a git object.
 *
 * `cat-file -s` runs first: `cat-file -p` on a 200 MB blob would be buffered in
 * full before any size check could reject it. A missing object is the ordinary
 * case for an added file, not an error.
 */
async function readBlobSide(root: string, rev: string, path: string): Promise<BlobSide> {
  const spec = `${rev}:${path}`;
  let size: number;
  try {
    size = Number((await git(root, ["cat-file", "-s", spec])).trim());
  } catch {
    return { status: "absent" };
  }
  if (!Number.isFinite(size)) return { status: "absent" };
  if (size > MAX_TEXT_BYTES) return { status: "problem", problem: "too-large", size };

  let buffer: Buffer;
  try {
    buffer = await gitBuffer(root, ["cat-file", "-p", spec]);
  } catch {
    return { status: "absent" };
  }
  if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return { status: "problem", problem: "binary", size };
  }
  return { status: "text", text: buffer.toString("utf8"), size };
}

/** The working-tree half of a pair: same checks, straight off the disk. */
async function readDiskSide(absolutePath: string): Promise<BlobSide> {
  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) return { status: "absent" };
    if (info.size > MAX_TEXT_BYTES) {
      return { status: "problem", problem: "too-large", size: info.size };
    }
    const buffer = await readFile(absolutePath);
    if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      return { status: "problem", problem: "binary", size: info.size };
    }
    return { status: "text", text: buffer.toString("utf8"), size: info.size };
  } catch {
    return { status: "absent" };
  }
}

/**
 * Where a renamed file used to live.
 *
 * Without this a rename renders as "the whole file was added": the base side has
 * no blob under the new name, the left editor comes back empty, and the reader
 * concludes every line is new. The lookup deliberately does **not** pass `-- path`
 * — a pathspec disables rename detection in git, so the scan has to cover the
 * whole change set and match on the destination path.
 */
async function renameSource(root: string, rangeArgs: string[], path: string): Promise<string | null> {
  try {
    const out = await git(root, ["diff", "--name-status", "-M", "-z", ...rangeArgs]);
    const parts = out.split("\0");
    let index = 0;
    while (index < parts.length) {
      const status = parts[index];
      if (!status) break;
      if (status.startsWith("R") || status.startsWith("C")) {
        if (parts[index + 2] === path) return parts[index + 1] || null;
        index += 3;
      } else {
        index += 2;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function emptyPair(path: string): ExplorerFilePair {
  return {
    original: "",
    modified: "",
    originalPath: path,
    modifiedPath: path,
    originalSize: 0,
    modifiedSize: 0,
    problem: null,
  };
}

// --- handlers -------------------------------------------------------------

export function setupExplorerIpc(): void {
  ipcMain.handle(EXPLORER_ROOT_INFO_CHANNEL, async (event): Promise<ExplorerResult<ExplorerRootInfo>> => {
    const roots = await rootsForWindow(event);
    if (!roots) return failure("no-root");

    const [worktree, project] = await Promise.all([
      existingDirectory(roots.worktree),
      existingDirectory(roots.project),
    ]);
    if (!worktree && !project) return failure("not-a-directory");

    return ok<ExplorerRootInfo>({
      worktree,
      project,
      branch: roots.branch,
      label: basename(project ?? worktree ?? ""),
      defaultTarget: worktree ? "worktree" : "project",
      worktreeGone: !worktree && Boolean(roots.worktree),
    });
  });

  ipcMain.handle(
    EXPLORER_LIST_FILES_CHANNEL,
    async (event, target: unknown): Promise<ExplorerResult<{ files: string[]; truncated: boolean }>> => {
      const roots = await rootsForWindow(event);
      if (!roots) return failure("no-root");
      const resolved = await rootForTarget(roots, target);
      if ("ok" in resolved) return resolved;

      try {
        // One call covers tracked and untracked files while honouring
        // .gitignore — cheaper and more faithful than a recursive readdir.
        const stdout = await git(resolved.root, [
          "ls-files",
          "-z",
          "--cached",
          "--others",
          "--exclude-standard",
        ]);
        const files = stdout.split("\0").filter(Boolean).sort();
        const truncated = files.length > MAX_LISTED_FILES;
        return ok({ files: truncated ? files.slice(0, MAX_LISTED_FILES) : files, truncated });
      } catch (error) {
        if (error instanceof Error && error.message === "git_not_found") return failure("no-git");
        return failure("failed", error instanceof Error ? error.message : undefined);
      }
    },
  );

  ipcMain.handle(
    EXPLORER_READ_FILE_CHANNEL,
    async (
      event,
      target: unknown,
      path: unknown,
    ): Promise<ExplorerResult<{ content: ExplorerFileContent }>> => {
      const roots = await rootsForWindow(event);
      if (!roots) return failure("no-root");
      const resolved = await rootForTarget(roots, target);
      if ("ok" in resolved) return resolved;

      const inside = await resolveInside(resolved.root, path);
      if (typeof inside !== "string") return inside;

      try {
        const info = await stat(inside);
        if (!info.isFile()) return failure("not-found");
        if (info.size > MAX_TEXT_BYTES) {
          return ok<{ content: ExplorerFileContent }>({
            content: { kind: "too-large", size: info.size },
          });
        }

        const buffer = await readFile(inside);
        const head = buffer.subarray(0, BINARY_SNIFF_BYTES);
        if (head.includes(0)) {
          return ok<{ content: ExplorerFileContent }>({
            content: { kind: "binary", size: info.size },
          });
        }

        return ok<{ content: ExplorerFileContent }>({
          content: { kind: "text", text: buffer.toString("utf8"), size: info.size, truncated: false },
        });
      } catch {
        return failure("not-found");
      }
    },
  );

  ipcMain.handle(
    EXPLORER_GIT_STATUS_CHANNEL,
    async (event, target: unknown): Promise<ExplorerResult<ExplorerChangeSet>> => {
      const roots = await rootsForWindow(event);
      if (!roots) return failure("no-root");
      const resolved = await rootForTarget(roots, target);
      if ("ok" in resolved) return resolved;

      try {
        if (target === "project") {
          if (!roots.branch) return ok<ExplorerChangeSet>({ entries: [], truncated: false, base: null, baseStrategy: "none" });
          return ok(await collectBranchChanges(resolved.root, roots.branch));
        }
        return ok(await collectWorktreeChanges(resolved.root));
      } catch (error) {
        if (error instanceof Error && error.message === "git_not_found") return failure("no-git");
        return failure("failed", error instanceof Error ? error.message : undefined);
      }
    },
  );

  ipcMain.handle(
    EXPLORER_FILE_PAIR_CHANNEL,
    async (
      event,
      target: unknown,
      path: unknown,
      options: unknown,
    ): Promise<ExplorerResult<ExplorerFilePair>> => {
      const roots = await rootsForWindow(event);
      if (!roots) return failure("no-root");
      const resolved = await rootForTarget(roots, target);
      if ("ok" in resolved) return resolved;
      if (typeof path !== "string" || path.length === 0) return failure("outside-root");

      // Deleted files have no realpath, so the lexical containment check is the
      // one that has to pass here (`resolveInside` still returns the resolved
      // path in that case).
      const inside = await resolveInside(resolved.root, path);
      if (typeof inside !== "string") return inside;

      const requestedBase =
        options && typeof options === "object" && typeof (options as { base?: unknown }).base === "string"
          ? (options as { base: string }).base
          : null;

      try {
        const isProject = target === "project";
        const base = isProject
          ? requestedBase ?? (await resolveBaseline(resolved.root, roots.branch ?? "")).base
          : "HEAD";
        if (!base) return ok(emptyPair(path));

        let original = await readBlobSide(resolved.root, base, path);
        let modified: BlobSide;
        if (isProject) {
          if (!roots.branch) return ok(emptyPair(path));
          modified = await readBlobSide(resolved.root, roots.branch, path);
        } else {
          modified = await readDiskSide(inside);
        }
        let originalPath = path;

        if (original.status === "absent") {
          const rangeArgs = isProject ? [`${base}..${roots.branch}`] : ["HEAD"];
          const from = await renameSource(resolved.root, rangeArgs, path);
          if (from && from !== path) {
            const renamed = await readBlobSide(resolved.root, base, from);
            if (renamed.status !== "absent") {
              original = renamed;
              originalPath = from;
            }
          }
        }

        const problem =
          original.status === "problem"
            ? original.problem
            : modified.status === "problem"
              ? modified.problem
              : null;

        return ok<ExplorerFilePair>({
          original: original.status === "text" ? original.text : "",
          modified: modified.status === "text" ? modified.text : "",
          originalPath,
          modifiedPath: path,
          originalSize: original.status === "absent" ? 0 : original.size,
          modifiedSize: modified.status === "absent" ? 0 : modified.size,
          problem,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "git_not_found") return failure("no-git");
        return failure("failed", error instanceof Error ? error.message : undefined);
      }
    },
  );
}
