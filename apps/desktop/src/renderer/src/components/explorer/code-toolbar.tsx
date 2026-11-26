import type { ReactNode } from "react";
import { ChevronsUpDown, Columns2, Minus, Plus, Rows3, Space, WrapText } from "@multica/ui/icons";
import { fontSizePercent, useExplorerViewPrefs, type DiffLayout } from "@/stores/explorer-view-prefs";
import type { ExplorerStrings } from "./strings";

/**
 * Shared header for the read-only code surfaces (file viewer and diff view).
 *
 * The arrangement follows VS Code's diff toolbar: change navigation on the
 * left, then the view switches on the right (side-by-side / inline), then wrap,
 * then the font size — most-used first from the outside in, so the controls
 * that change least sit closest to the edge.
 */
export function CodeToolbar({
  strings,
  leading,
  layoutToggle,
}: {
  strings: ExplorerStrings;
  /** Left-hand cluster, e.g. diff hunk navigation. */
  leading?: ReactNode;
  /** Renders the side-by-side / inline switch. Diff view only. */
  layoutToggle?: { layout: DiffLayout; splitViable: boolean };
}) {
  const fontSize = useExplorerViewPrefs((state) => state.codeFontSize);
  const zoomCode = useExplorerViewPrefs((state) => state.zoomCode);
  const resetCodeFontSize = useExplorerViewPrefs((state) => state.resetCodeFontSize);
  const wordWrap = useExplorerViewPrefs((state) => state.wordWrap);
  const toggleWordWrap = useExplorerViewPrefs((state) => state.toggleWordWrap);
  const setDiffLayout = useExplorerViewPrefs((state) => state.setDiffLayout);
  const ignoreTrimWhitespace = useExplorerViewPrefs((state) => state.ignoreTrimWhitespace);
  const toggleIgnoreTrimWhitespace = useExplorerViewPrefs((state) => state.toggleIgnoreTrimWhitespace);
  const collapseUnchanged = useExplorerViewPrefs((state) => state.collapseUnchanged);
  const toggleCollapseUnchanged = useExplorerViewPrefs((state) => state.toggleCollapseUnchanged);

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2 text-[11px] text-muted-foreground">
      {leading}
      <div className="ml-auto flex items-center gap-0.5">
        {layoutToggle && (
          <div className="flex items-center rounded-md bg-muted/50 p-0.5">
            <ToolbarButton
              label={layoutToggle.splitViable ? strings.sideBySide : strings.splitTooNarrow}
              onClick={() => setDiffLayout("split")}
              pressed={layoutToggle.layout === "split"}
              disabled={!layoutToggle.splitViable}
            >
              <Columns2 className="size-3" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              label={strings.inlineView}
              onClick={() => setDiffLayout("inline")}
              pressed={layoutToggle.layout === "inline"}
            >
              <Rows3 className="size-3" aria-hidden="true" />
            </ToolbarButton>
          </div>
        )}
        <ToolbarButton label={strings.wordWrap} onClick={toggleWordWrap} pressed={wordWrap}>
          <WrapText className="size-3" aria-hidden="true" />
        </ToolbarButton>
        {layoutToggle && (
          <>
            <ToolbarButton
              label={strings.collapseUnchanged}
              onClick={toggleCollapseUnchanged}
              pressed={collapseUnchanged}
            >
              <ChevronsUpDown className="size-3" aria-hidden="true" />
            </ToolbarButton>
            <ToolbarButton
              label={strings.ignoreWhitespace}
              onClick={toggleIgnoreTrimWhitespace}
              pressed={ignoreTrimWhitespace}
            >
              <Space className="size-3" aria-hidden="true" />
            </ToolbarButton>
          </>
        )}
        <span className="mx-1 h-3 w-px bg-border" aria-hidden="true" />
        <ToolbarButton label={strings.zoomOut} onClick={() => zoomCode(-1)}>
          <Minus className="size-3" aria-hidden="true" />
        </ToolbarButton>
        <button
          type="button"
          onClick={resetCodeFontSize}
          title={strings.zoomReset}
          className="min-w-[38px] rounded px-1 py-0.5 tabular-nums hover:bg-accent"
        >
          {fontSizePercent(fontSize)}%
        </button>
        <ToolbarButton label={strings.zoomIn} onClick={() => zoomCode(1)}>
          <Plus className="size-3" aria-hidden="true" />
        </ToolbarButton>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={[
        "rounded p-1 hover:bg-accent",
        pressed ? "text-foreground" : "text-muted-foreground",
        disabled ? "pointer-events-none opacity-40" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
