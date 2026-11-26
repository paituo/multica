import { useEffect, useMemo, useRef, useState } from "react";
import type { ExplorerTarget } from "../../../../shared/explorer-api";
import { useExplorerViewPrefs } from "@/stores/explorer-view-prefs";
import { CodeToolbar } from "./code-toolbar";
import type { ExplorerStrings } from "./strings";
import { useCtrlWheelZoom } from "./use-ctrl-wheel-zoom";
import { useElementSize } from "./use-element-size";

type ViewerState =
  | { status: "loading" }
  | { status: "text"; text: string }
  | { status: "note"; message: string }
  | { status: "error"; message: string };

/**
 * A file larger than this many lines is rendered up to the cap. A 2 MiB file
 * can be ~60 k lines, and one DOM row per line at that size freezes the window
 * for seconds on every reflow (including each step of a resize).
 */
const MAX_RENDERED_LINES = 5_000;

/**
 * Read-only text viewer.
 *
 * Rows are flex lines rather than table rows, for the same reasons as the diff
 * view: a `width: 100%` table distributes spare width into the line-number
 * column and takes the wrap point away from the pane width. Sizes come from a
 * ResizeObserver so a window resize, a scrollbar appearing or a font-size step
 * all re-wrap immediately.
 */
export function FileViewer({
  target,
  path,
  refreshToken,
  strings,
}: {
  target: ExplorerTarget;
  path: string;
  refreshToken: number;
  strings: ExplorerStrings;
}) {
  const [state, setState] = useState<ViewerState>({ status: "loading" });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fontSize = useExplorerViewPrefs((pref) => pref.codeFontSize);
  const wordWrap = useExplorerViewPrefs((pref) => pref.wordWrap);
  const zoomCode = useExplorerViewPrefs((pref) => pref.zoomCode);
  const { width } = useElementSize(scrollRef);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    void window.desktopAPI.explorer.readFile(target, path).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({
          status: "error",
          message: result.reason === "outside-root" ? strings.outsideRoot : strings.loadFailed,
        });
        return;
      }
      const content = result.content;
      if (content.kind === "text") {
        setState({ status: "text", text: content.text });
        return;
      }
      setState({
        status: "note",
        message: content.kind === "binary" ? strings.binary : strings.tooLarge,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [target, path, refreshToken, strings]);

  // CRLF files would otherwise carry a U+000D at the end of every line, which
  // `white-space: pre-wrap` treats as a segment break — the line would wrap one
  // character early at the right edge.
  const allLines = useMemo(
    () => (state.status === "text" ? state.text.split("\n").map((line) => line.replace(/\r$/, "")) : []),
    [state],
  );
  const lines = allLines.length > MAX_RENDERED_LINES ? allLines.slice(0, MAX_RENDERED_LINES) : allLines;
  const overflow = allLines.length > MAX_RENDERED_LINES;

  useCtrlWheelZoom(scrollRef, zoomCode, state.status === "text");

  // A new file starts at the top; after a background refresh the reader keeps
  // their line, which is why this only runs when the path changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [path]);

  const toolbar = <CodeToolbar strings={strings} />;

  if (state.status === "loading") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        <div className="flex flex-1 items-center justify-center text-body text-muted-foreground">
          {strings.loading}
        </div>
      </div>
    );
  }

  if (state.status === "note" || state.status === "error") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        <div className="flex flex-1 items-center justify-center p-6 text-center text-body text-muted-foreground">
          {state.message}
        </div>
      </div>
    );
  }

  const style = {
    fontSize: `${fontSize}px`,
    lineHeight: `${Math.round(fontSize * 1.6)}px`,
    tabSize: 4,
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        <div
          className={wordWrap ? "" : "inline-block min-w-full"}
          style={{ ...style, width: wordWrap && width > 0 ? width : undefined }}
        >
          {lines.map((line, index) => (
            <div key={index} data-code-row={index} className="flex items-stretch">
              <span
                className="w-12 shrink-0 select-none border-r border-border/40 px-2 text-right text-muted-foreground/60 tabular-nums"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <div
                className={[
                  "min-h-[1em] py-0 pl-3 pr-4",
                  wordWrap ? "min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]" : "shrink-0 whitespace-pre",
                ].join(" ")}
              >
                {line.length > 0 ? line : " "}
              </div>
            </div>
          ))}
          {overflow && (
            <p className="sticky bottom-0 border-t border-border bg-background/95 px-3 py-1.5 text-caption text-muted-foreground">
              {strings.truncated}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
