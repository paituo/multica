/**
 * Wire contract between the explorer window's renderer and the main process.
 *
 * Every request carries a `target`, never an absolute path: the main process
 * resolves the target against the root it recorded for *this* window when the
 * window was created (see `main/explorer-ipc.ts`). A renderer therefore cannot
 * ask for a directory it was not opened on, and `..` is rejected after
 * `path.resolve` normalisation.
 */

export const EXPLORER_OPEN_CHANNEL = "window:open-explorer";
export const EXPLORER_ROOT_INFO_CHANNEL = "explorer:root-info";
export const EXPLORER_LIST_FILES_CHANNEL = "explorer:list-files";
export const EXPLORER_READ_FILE_CHANNEL = "explorer:read-file";
export const EXPLORER_GIT_STATUS_CHANNEL = "explorer:git-status";
export const EXPLORER_FILE_PAIR_CHANNEL = "explorer:file-pair";
export const EXPLORER_FILE_PAIR_AT_CHANNEL = "explorer:file-pair-at";
export const EXPLORER_FILE_HISTORY_CHANNEL = "explorer:file-history";
export const EXPLORER_GIT_LOG_CHANNEL = "explorer:git-log";
export const EXPLORER_COMMIT_FILES_CHANNEL = "explorer:commit-files";
export const EXPLORER_REPOS_CHANNEL = "explorer:repos";

/** Which root a request is addressed to. */
export type ExplorerTarget = "worktree" | "project";

export type ExplorerFailureReason =
  | "no-root"
  | "no-git"
  | "outside-root"
  | "not-found"
  | "not-a-directory"
  | "failed";

export type ExplorerFailure = { ok: false; reason: ExplorerFailureReason; message?: string };
export type ExplorerResult<T> = ({ ok: true } & T) | ExplorerFailure;

export type ExplorerRootInfo = {
  /** Where the window was opened. Null when that root no longer exists. */
  worktree: string | null;
  project: string | null;
  /** Branch the task produced, when the server reported one. */
  branch: string | null;
  /** Display-only short name for the window subtitle. */
  label: string;
  /**
   * Which target the renderer should open with: a live worktree wins, a
   * finished task falls back to the durable project directory.
   */
  defaultTarget: ExplorerTarget;
  /** True when a worktree was expected but is gone (task finalised). */
  worktreeGone: boolean;
};

export type ExplorerFileEntry = {
  /** POSIX-style path relative to the target root. */
  path: string;
  /** Lines added, from `git diff --numstat`; null when unavailable. */
  additions: number | null;
  deletions: number | null;
  /** Porcelain status letters, e.g. "M", "A", "D", "??", "R". */
  status: string | null;
  untracked?: boolean;
  /**
   * The two columns of `git status --porcelain`: X compares the index to HEAD,
   * Y compares the worktree to the index. They are what lets the source-control
   * view split "Staged Changes" from "Changes" the way VS Code does; a file
   * with edits in both places appears in both groups.
   *
   * `null` when the entry does not come from a working-tree status (a branch
   * diff, or a commit's file list), where the split is meaningless.
   */
  indexStatus?: string | null;
  worktreeStatus?: string | null;
};

export type ExplorerChangeSet = {
  entries: ExplorerFileEntry[];
  /** True when the list was capped. */
  truncated: boolean;
  /** Base commit the diff is measured against, when known. */
  base: string | null;
  baseStrategy: "head" | "baseline" | "merge-base" | "none";
};

export type ExplorerFileContent =
  | { kind: "text"; text: string; size: number; truncated: boolean }
  | { kind: "binary"; size: number }
  | { kind: "too-large"; size: number };

/**
 * Both documents of one changed file.
 *
 * A unified patch cannot express the two things a real diff editor needs: where
 * the unchanged regions are and how long they are (git collapses them to three
 * context lines), and what the rest of the file says (so full-text search
 * inside the diff has nothing to match against). Monaco's diff editor works on
 * two documents, so this is the shape it is handed.
 */
export type ExplorerFilePair = {
  /** Base-side text. Empty when the file did not exist on that side. */
  original: string;
  /** Working-side text. Empty when the file was deleted. */
  modified: string;
  /**
   * Names to hand to the editor for language detection. They differ after a
   * rename, and using the old name on the left keeps syntax highlighting on
   * both sides.
   */
  originalPath: string;
  modifiedPath: string;
  originalSize: number;
  modifiedSize: number;
  /**
   * Set when a side could not be read as text. The renderer must degrade to a
   * message rather than show an empty editor, which would read as "no changes".
   */
  problem: null | "too-large" | "binary";
};

export type ExplorerApi = {
  rootInfo: () => Promise<ExplorerResult<ExplorerRootInfo>>;
  listFiles: (target: ExplorerTarget) => Promise<ExplorerResult<{ files: string[]; truncated: boolean }>>;
  readFile: (target: ExplorerTarget, path: string) => Promise<ExplorerResult<{ content: ExplorerFileContent }>>;
  gitStatus: (target: ExplorerTarget) => Promise<ExplorerResult<ExplorerChangeSet>>;
  filePair: (
    target: ExplorerTarget,
    path: string,
    options?: { base?: string | null },
  ) => Promise<ExplorerResult<ExplorerFilePair>>;
  /** The same file at one commit against its direct parent. */
  filePairAt: (
    target: ExplorerTarget,
    path: string,
    rev: string,
  ) => Promise<ExplorerResult<ExplorerFilePair>>;
  /** Commit history for one file, newest first (`git log --follow`). */
  fileHistory: (
    target: ExplorerTarget,
    path: string,
    options?: { limit?: number },
  ) => Promise<ExplorerResult<{ revisions: ExplorerCommit[]; truncated: boolean }>>;
  /** Recent commits of the repository, for the source-control graph. */
  gitLog: (
    target: ExplorerTarget,
    options?: { limit?: number },
  ) => Promise<ExplorerResult<{ commits: ExplorerCommit[]; branch: string | null; truncated: boolean }>>;
  /** Files a single commit touched, with line counts. */
  commitFiles: (
    target: ExplorerTarget,
    rev: string,
  ) => Promise<ExplorerResult<{ files: ExplorerFileEntry[] }>>;
  /** The root repository plus any submodules git reports. */
  repos: (target: ExplorerTarget) => Promise<ExplorerResult<{ repos: ExplorerRepoEntry[] }>>;
};

/**
 * One commit, reduced to what the timeline and the graph actually render.
 *
 * `refs` and `parents` exist so the renderer can badge `main` / `origin/main`
 * and mark merges without a second round trip; the graph is drawn from the
 * parent links rather than from `git log --graph`'s ASCII art, which cannot be
 * styled.
 */
export type ExplorerCommit = {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  /** Author date, ISO 8601. */
  date: string;
  refs: string[];
  parents: string[];
};

/** A repository the SCM view can talk about. */
export type ExplorerRepoEntry = {
  /** `root` for the window's own target, `sub:<path>` for a submodule. */
  id: string;
  label: string;
  /** Absolute path, display only — never round-tripped back into a request. */
  path: string;
  isRoot: boolean;
  branch: string | null;
  /** Uncommitted entries; `null` when git could not be read. */
  pending: number | null;
  /** Submodules that have not been checked out yet report false. */
  initialized: boolean;
};
