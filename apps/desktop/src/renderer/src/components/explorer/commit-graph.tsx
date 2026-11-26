import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "@multica/ui/icons";
import { useLocale } from "@multica/views/i18n";
import type {
  ExplorerCommit,
  ExplorerFileEntry,
  ExplorerTarget,
} from "../../../../shared/explorer-api";
import { relativeTime } from "./relative-time";
import type { ExplorerStrings } from "./strings";

type GraphState =
  | { status: "loading" }
  | { status: "ready"; commits: ExplorerCommit[]; branch: string | null; truncated: boolean }
  | { status: "error" };

type FilesState = { status: "loading" } | { status: "ready"; files: ExplorerFileEntry[] } | { status: "error" };

/** Badge colours by ref kind, mirroring VS Code's graph decorations. */
function refClass(ref: string): string {
  if (ref.startsWith("origin/") || ref.startsWith("upstream/")) {
    return "bg-violet-500/15 text-violet-700 dark:text-violet-300";
  }
  if (ref.includes("/")) return "bg-sky-500/15 text-sky-700 dark:text-sky-300";
  if (/^v?\d+\.\d+/.test(ref)) return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-primary/15 text-primary";
}

/**
 * The source-control graph: recent commits, newest first.
 *
 * Not a lane-drawing graph. VS Code's own graph is predominantly a styled list
 * with ref decorations; drawing lanes from `git log --graph` would mean parsing
 * ASCII art, and drawing them from parent links is a layout engine this window
 * does not need. What it does need is the second half of the graph's value —
 * "what did this commit touch" — so a row expands into the file list, and each
 * file opens its diff at that revision.
 */
export function CommitGraph({
  target,
  refreshToken,
  onOpenCommitFile,
  strings,
}: {
  target: ExplorerTarget;
  refreshToken: number;
  onOpenCommitFile: (rev: ExplorerCommit, path: string) => void;
  strings: ExplorerStrings;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<GraphState>({ status: "loading" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [files, setFiles] = useState<FilesState>({ status: "loading" });
  const locale = useLocale();

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void window.desktopAPI.explorer.gitLog(target, { limit: 50 }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({ status: "error" });
        return;
      }
      setState({
        status: "ready",
        commits: result.commits,
        branch: result.branch,
        truncated: result.truncated,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [target, refreshToken]);

  // Fetch the file list only for the row that is open; collapsing forgets it so
  // a refresh cannot show the previous commit's files.
  useEffect(() => {
    if (!expanded) {
      setFiles({ status: "loading" });
      return;
    }
    let cancelled = false;
    setFiles({ status: "loading" });
    void window.desktopAPI.explorer.commitFiles(target, expanded).then((result) => {
      if (cancelled) return;
      setFiles(result.ok ? { status: "ready", files: result.files } : { status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [target, expanded, refreshToken]);

  const commits = state.status === "ready" ? state.commits : [];

  return (
    <div className="shrink-0 border-t border-border/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-accent/40"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{strings.graph}</span>
        {state.status === "ready" && (
          <span className="ml-auto truncate pl-2 normal-case tracking-normal text-muted-foreground/70">
            {state.branch ?? ""}
          </span>
        )}
      </button>

      {open && (
        <div className="max-h-72 overflow-auto pb-1">
          {state.status === "loading" && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">{strings.loading}</p>
          )}
          {state.status === "error" && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">{strings.loadFailed}</p>
          )}
          {state.status === "ready" && commits.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">{strings.graphEmpty}</p>
          )}

          {commits.map((commit) => {
            const isOpen = expanded === commit.hash;
            return (
              <div key={commit.hash}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : commit.hash)}
                  // eslint-disable-next-line no-restricted-syntax -- the tooltip is the sha plus the commit's own subject: repository data, never UI copy
                  title={`${commit.hash}\n${commit.subject}`}
                  className="flex w-full items-start gap-2 px-2 py-1 text-left hover:bg-accent/60"
                >
                  <span
                    className="mt-[5px] size-2 shrink-0 rounded-full border border-foreground/40 bg-background"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">
                        {commit.subject}
                      </span>
                      {commit.refs.slice(0, 2).map((ref) => (
                        <span
                          key={ref}
                          className={`shrink-0 rounded-sm px-1 text-[10px] font-medium ${refClass(ref)}`}
                        >
                          {ref}
                        </span>
                      ))}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {commit.parents.length > 1 ? "merge · " : ""}
                      {commit.author} · {relativeTime(commit.date, locale)}
                    </span>
                  </span>
                </button>

                {isOpen && (
                  <div className="border-l border-border/60 pl-3 ml-3">
                    {files.status === "loading" && (
                      <p className="px-2 py-1 text-[11px] text-muted-foreground">{strings.loading}</p>
                    )}
                    {files.status === "error" && (
                      <p className="px-2 py-1 text-[11px] text-muted-foreground">
                        {strings.loadFailed}
                      </p>
                    )}
                    {files.status === "ready" &&
                      files.files.map((file) => (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => onOpenCommitFile(commit, file.path)}
                          title={file.path}
                          className="flex w-full items-center gap-1.5 rounded-sm px-1 py-[2px] text-left text-[11px] hover:bg-accent/60"
                        >
                          <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] uppercase text-muted-foreground">
                            {file.status ?? "?"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-foreground/80">
                            {file.path}
                          </span>
                          {file.additions !== null && file.additions > 0 && (
                            <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">
                              +{file.additions}
                            </span>
                          )}
                          {file.deletions !== null && file.deletions > 0 && (
                            <span className="shrink-0 tabular-nums text-red-600 dark:text-red-400">
                              −{file.deletions}
                            </span>
                          )}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            );
          })}

          {state.status === "ready" && state.truncated && (
            <p className="px-3 py-1 text-[11px] text-muted-foreground">{strings.graphMore}</p>
          )}
        </div>
      )}
    </div>
  );
}
