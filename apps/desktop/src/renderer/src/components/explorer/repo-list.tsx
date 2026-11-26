import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Package } from "@multica/ui/icons";
import type { ExplorerRepoEntry, ExplorerTarget } from "../../../../shared/explorer-api";
import type { ExplorerStrings } from "./strings";

type ReposState =
  | { status: "loading" }
  | { status: "ready"; repos: ExplorerRepoEntry[] }
  | { status: "error" };

/**
 * The Repositories section of the source-control view.
 *
 * VS Code lists every open repository here, and its submodules become rows of
 * their own — which is why a monorepo shows `root` plus one row per submodule.
 * This window is scoped to a single task directory, so the section reports the
 * root and its submodules and is deliberately **read-only**: switching the whole
 * panel to another repository would need every request to carry a repo id, and
 * that is a larger security-surface change than a status strip is worth.
 */
export function RepoList({
  target,
  refreshToken,
  strings,
}: {
  target: ExplorerTarget;
  refreshToken: number;
  strings: ExplorerStrings;
}) {
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<ReposState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void window.desktopAPI.explorer.repos(target).then((result) => {
      if (cancelled) return;
      setState(result.ok ? { status: "ready", repos: result.repos } : { status: "error" });
    });

    return () => {
      cancelled = true;
    };
  }, [target, refreshToken]);

  if (state.status === "error") return null;

  const repos = state.status === "ready" ? state.repos : [];

  return (
    <div className="shrink-0 border-b border-border/60">
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
        <Package className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{strings.repositories}</span>
        {state.status === "ready" && (
          <span className="ml-auto tabular-nums normal-case tracking-normal">{repos.length}</span>
        )}
      </button>

      {open && (
        <div className="pb-1">
          {state.status === "loading" && (
            <p className="px-3 py-1 text-[11px] text-muted-foreground">{strings.loading}</p>
          )}
          {repos.map((repo) => (
            <div
              key={repo.id}
              className="flex items-center gap-1.5 px-3 py-0.5 text-[11px]"
              title={repo.path}
            >
              <span className="min-w-0 flex-1 truncate text-foreground/90">{repo.label}</span>
              {repo.branch && (
                <span className="shrink-0 truncate rounded-sm bg-muted px-1 text-[10px] text-muted-foreground">
                  {repo.branch}
                </span>
              )}
              {repo.pending !== null && repo.pending > 0 && (
                <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] tabular-nums text-primary">
                  {repo.pending}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
