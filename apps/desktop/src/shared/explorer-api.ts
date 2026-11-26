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
};
