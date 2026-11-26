import { describe, expect, it } from "vitest";
import {
  EXPLORER_WINDOW_ARGUMENT_PREFIX,
  encodeExplorerWindowArgument,
  parseExplorerWindowRequest,
  readExplorerWindowArgument,
} from "./explorer-window";
import { readDesktopWindowContext } from "./issue-window";

// The directory a window is opened on travels through `process.argv`, so it has
// to be validated as hostile input: the renderer builds the request and the main
// process turns it into a filesystem root.

const base = {
  path: "/acme/issues/abc-123",
  title: "TASK-1",
  worktree: "D:\\worktrees\\acme",
  project: null,
  branch: "agent/agent/abc123",
};

describe("parseExplorerWindowRequest", () => {
  it("accepts a worktree-only request", () => {
    expect(parseExplorerWindowRequest(base)).toMatchObject({
      kind: "explorer",
      workspaceSlug: "acme",
      issueId: "abc-123",
      worktree: "D:\\worktrees\\acme",
      project: null,
      branch: "agent/agent/abc123",
    });
  });

  it("accepts a project-only request", () => {
    expect(parseExplorerWindowRequest({ ...base, worktree: null, project: "/repos/acme" })).toMatchObject({
      worktree: null,
      project: "/repos/acme",
    });
  });

  it("refuses a request with no directory at all", () => {
    expect(parseExplorerWindowRequest({ ...base, worktree: null })).toBeNull();
  });

  it("drops a relative or non-string root instead of trusting it", () => {
    expect(parseExplorerWindowRequest({ ...base, worktree: "../../etc" })).toBeNull();
    expect(parseExplorerWindowRequest({ ...base, worktree: 42 })).toBeNull();
    // A rejected secondary root degrades to null; the request stays valid on the
    // other root, which is the whole point of the two-way worktree/project union.
    expect(parseExplorerWindowRequest({ ...base, project: "C:relative\\dir" })?.project).toBeNull();
    expect(parseExplorerWindowRequest({ ...base, project: "relative/dir" })?.project).toBeNull();
  });

  it("rejects control characters smuggled into a root", () => {
    expect(parseExplorerWindowRequest({ ...base, worktree: "D:\\a\nb" })).toBeNull();
    expect(parseExplorerWindowRequest({ ...base, worktree: "D:\\a\0b" })).toBeNull();
  });

  it("rejects a path that is not an issue detail route", () => {
    expect(parseExplorerWindowRequest({ ...base, path: "/acme/settings" })).toBeNull();
    expect(parseExplorerWindowRequest({ ...base, path: "/acme/issues/abc/settings" })).toBeNull();
    expect(parseExplorerWindowRequest({ ...base, path: "acme/issues/abc-123" })).toBeNull();
  });

  it("rejects a traversal branch but keeps a namespaced one", () => {
    expect(parseExplorerWindowRequest({ ...base, branch: "feature/../main" })?.branch).toBeNull();
    expect(parseExplorerWindowRequest({ ...base, branch: "feature/one" })?.branch).toBe("feature/one");
  });

  it("falls back to a default title", () => {
    expect(parseExplorerWindowRequest({ ...base, title: "   " })?.title).toBe("Explorer");
  });
});

describe("argument round trip", () => {
  it("survives encode plus argv parsing", () => {
    const argument = encodeExplorerWindowArgument(base);
    expect(argument.startsWith(EXPLORER_WINDOW_ARGUMENT_PREFIX)).toBe(true);
    expect(readExplorerWindowArgument(["--foo", argument])).toMatchObject({
      kind: "explorer",
      issueId: "abc-123",
      worktree: "D:\\worktrees\\acme",
    });
  });

  it("refuses to encode an invalid request", () => {
    expect(() => encodeExplorerWindowArgument({ ...base, worktree: null })).toThrow();
  });

  it("ignores an unreadable argument instead of throwing", () => {
    expect(readExplorerWindowArgument([`${EXPLORER_WINDOW_ARGUMENT_PREFIX}not-json`])).toBeNull();
    expect(readExplorerWindowArgument([])).toBeNull();
  });

  it("is detected before the workspace-restore path", () => {
    // `readDesktopWindowContext` restores a main window when no argument matches;
    // an explorer argument must not fall through to that branch.
    const argument = encodeExplorerWindowArgument(base);
    expect(readDesktopWindowContext(["electron", ".", argument])?.kind).toBe("explorer");
  });
});
