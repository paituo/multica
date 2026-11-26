import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History } from "@multica/ui/icons";
import { useLocale } from "@multica/views/i18n";
import type { ExplorerCommit, ExplorerTarget } from "../../../../shared/explorer-api";
import { relativeTime } from "./relative-time";
import type { ExplorerStrings } from "./strings";

type TimelineState =
  | { status: "loading" }
  | { status: "ready"; revisions: ExplorerCommit[]; truncated: boolean }
  | { status: "error" };

/**
 * Per-file commit history, the explorer's answer to VS Code's Timeline view.
 *
 * VS Code puts it under the editor as a collapsible panel with one row per
 * revision; clicking a row opens that revision's diff. Same shape here, except
 * the panel sits at the bottom of the viewer rather than in a separate viewlet —
 * this window is a single-task workbench, not a full IDE.
 *
 * `--follow` is what makes it useful on a renamed file, and it is also why the
 * list can show revisions that predate the current path.
 */
export function FileTimeline({
  target,
  path,
  refreshToken,
  onOpenCommit,
  strings,
}: {
  target: ExplorerTarget;
  path: string;
  refreshToken: number;
  onOpenCommit: (rev: ExplorerCommit) => void;
  strings: ExplorerStrings;
}) {
  const [open, setOpen] = useState(true);
  const [state, setState] = useState<TimelineState>({ status: "loading" });
  const locale = useLocale();

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void window.desktopAPI.explorer
      .fileHistory(target, path, { limit: 30 })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ status: "error" });
          return;
        }
        setState({ status: "ready", revisions: result.revisions, truncated: result.truncated });
      });

    return () => {
      cancelled = true;
    };
  }, [target, path, refreshToken]);

  const count = state.status === "ready" ? state.revisions.length : 0;

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
        <History className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{strings.timeline}</span>
        {state.status === "ready" && count > 0 && (
          <span className="ml-auto tabular-nums normal-case tracking-normal">{count}</span>
        )}
      </button>

      {open && (
        <div className="max-h-56 overflow-auto pb-1">
          {state.status === "loading" && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">{strings.loading}</p>
          )}
          {state.status === "error" && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">{strings.historyFailed}</p>
          )}
          {state.status === "ready" && count === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">{strings.timelineEmpty}</p>
          )}
          {state.status === "ready" &&
            state.revisions.map((revision) => (
              <button
                key={revision.hash}
                type="button"
                onClick={() => onOpenCommit(revision)}
                title={`${revision.shortHash} ${revision.subject}`}
                className="flex w-full items-start gap-2 px-3 py-1 text-left hover:bg-accent/60"
              >
                <span
                  className="mt-[6px] size-1.5 shrink-0 rounded-full bg-foreground/30"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-foreground/90">
                    {revision.subject}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {revision.author}
                    {revision.author ? " · " : ""}
                    {relativeTime(revision.date, locale)}
                  </span>
                </span>
              </button>
            ))}
          {state.status === "ready" && state.truncated && (
            <p className="px-3 py-1 text-[11px] text-muted-foreground">{strings.truncated}</p>
          )}
        </div>
      )}
    </div>
  );
}
