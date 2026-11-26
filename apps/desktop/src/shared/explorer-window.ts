import { parseWorkspaceSlug } from "./workspace-window";

export const EXPLORER_WINDOW_ARGUMENT_PREFIX = "--multica-explorer-window=";

const MAX_PATH_LENGTH = 2_048;
const MAX_ROOT_LENGTH = 1_024;
const MAX_TITLE_LENGTH = 256;
const MAX_BRANCH_LENGTH = 200;
const ISSUE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * The renderer-supplied half of an explorer window launch. Deliberately separate
 * from `IssueWindowRequest`: this window is opened on a *directory* as well as
 * an issue route, so the directory has to survive the same validation pass
 * before it can become a `BrowserWindow` argument.
 */
export type ExplorerWindowRequest = {
  /** `/<slug>/issues/<id>` — the task whose first tab is the detail page. */
  path: string;
  title: string;
  /** Absolute path of the task worktree, when one was live at click time. */
  worktree: string | null;
  /** Absolute path of the durable project directory, when the task finished. */
  project: string | null;
  branch: string | null;
};

export type ExplorerWindowContext = ExplorerWindowRequest & {
  kind: "explorer";
  workspaceSlug: string;
  issueId: string;
};

/**
 * Shape-only absolute-path check. This module is imported by the renderer too,
 * so it must not pull in `node:path`; the main process re-validates for real
 * (`path.isAbsolute` + existence + containment) before any I/O happens.
 */
function isAbsolutePathLike(value: string): boolean {
  if (value.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return value.startsWith("\\\\");
}

function parseRootLike(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ROOT_LENGTH) return null;
  if (trimmed.includes("\0") || trimmed.includes("\n") || trimmed.includes("\r")) return null;
  if (!isAbsolutePathLike(trimmed)) return null;
  return trimmed;
}

function parseBranch(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_BRANCH_LENGTH) return null;
  if (trimmed.includes("..")) return null;
  return BRANCH_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Duplicated (not imported) from `issue-window.ts` on purpose: that module
 * consumes this one for its `DesktopWindowContext` union, so importing it back
 * would create a cycle. Both validate the same shape — a workspace-scoped issue
 * detail route with no query or hash.
 */
function parseIssuePath(
  value: unknown,
): { path: string; workspaceSlug: string; issueId: string } | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;

  let url: URL;
  try {
    url = new URL(value, "https://desktop.multica.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://desktop.multica.invalid") return null;

  const segments = url.pathname.split("/");
  if (segments.length !== 4 || segments[0] !== "" || segments[2] !== "issues") return null;

  let workspaceSlug: string;
  let issueId: string;
  try {
    workspaceSlug = decodeURIComponent(segments[1] ?? "");
    issueId = decodeURIComponent(segments[3] ?? "");
  } catch {
    return null;
  }

  if (!parseWorkspaceSlug(workspaceSlug)) return null;
  if (!ISSUE_REF_PATTERN.test(issueId)) return null;

  const path = `/${workspaceSlug}/issues/${encodeURIComponent(issueId)}`;
  if (path.length > MAX_PATH_LENGTH) return null;

  return { path, workspaceSlug, issueId };
}

export function parseExplorerWindowRequest(value: unknown): ExplorerWindowContext | null {
  if (!value || typeof value !== "object") return null;

  const input = value as Record<string, unknown>;
  const parsedPath = parseIssuePath(input.path);
  if (!parsedPath) return null;

  const worktree = parseRootLike(input.worktree);
  const project = parseRootLike(input.project);
  // A window with neither root would open onto nothing — refuse, so the button
  // surfaces "no directory" instead of a blank window.
  if (!worktree && !project) return null;

  const rawTitle = typeof input.title === "string" ? input.title.trim() : "";
  const title = rawTitle.slice(0, MAX_TITLE_LENGTH) || "Explorer";

  return {
    kind: "explorer",
    path: parsedPath.path,
    title,
    workspaceSlug: parsedPath.workspaceSlug,
    issueId: parsedPath.issueId,
    worktree,
    project,
    branch: parseBranch(input.branch),
  };
}

export function encodeExplorerWindowArgument(request: ExplorerWindowRequest): string {
  const context = parseExplorerWindowRequest(request);
  if (!context) {
    throw new Error("Invalid explorer window request");
  }
  return `${EXPLORER_WINDOW_ARGUMENT_PREFIX}${encodeURIComponent(
    JSON.stringify({
      path: context.path,
      title: context.title,
      worktree: context.worktree,
      project: context.project,
      branch: context.branch,
    }),
  )}`;
}

export function readExplorerWindowArgument(
  argv: readonly string[],
): ExplorerWindowContext | null {
  const argument = argv.find((item) => item.startsWith(EXPLORER_WINDOW_ARGUMENT_PREFIX));
  if (!argument) return null;

  try {
    const encoded = argument.slice(EXPLORER_WINDOW_ARGUMENT_PREFIX.length);
    const decoded = JSON.parse(decodeURIComponent(encoded)) as unknown;
    return parseExplorerWindowRequest(decoded);
  } catch {
    return null;
  }
}
