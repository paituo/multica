import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Columns2, Copy, Rows3, WrapText } from "@multica/ui/icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@multica/ui/components/ui/context-menu";
import type { ExplorerFilePair } from "../../../../shared/explorer-api";
import { SPLIT_MIN_WIDTH, useExplorerViewPrefs } from "@/stores/explorer-view-prefs";
import { CodeToolbar } from "./code-toolbar";
import { BASE_EDITOR_OPTIONS, currentThemeName, languageFor, monaco } from "./monaco-setup";
import type { ExplorerStrings } from "./strings";
import { useCtrlWheelZoom } from "./use-ctrl-wheel-zoom";
import { useElementSize } from "./use-element-size";
import { useMonacoTheme } from "./use-monaco-theme";

/**
 * Diff surface, rendered by Monaco's diff editor.
 *
 * The hand-written renderer this replaces only ever had a unified patch, so
 * "collapse unchanged lines", "expand a block" and "search inside the diff" were
 * not implementable — there was nothing to expand and nothing to search. Monaco
 * takes two documents instead, the same model VS Code uses, so those behaviours
 * come from the same engine rather than being imitated:
 *
 *   Unified / Split   → `renderSideBySide`
 *   Hide whitespace   → `ignoreTrimWhitespace`
 *   Expand by block   → `hideUnchangedRegions` + its native reveal buttons
 *   Find in diff      → the built-in find widget (Ctrl+F)
 *
 * What stays ours: the toolbar, Ctrl+wheel zoom, F7 navigation, the context
 * menu, and the theme, so the window keeps its palette instead of looking like
 * an embedded IDE.
 */

/** VS Code's own defaults for the collapsed bands. */
const UNCHANGED_REGION = {
  contextLineCount: 3,
  minimumLineCount: 8,
  revealLineCount: 20,
} as const;

/**
 * `hideOriginalLineNumbers` exists in monaco 0.58
 * (`esm/vs/editor/browser/widget/diffEditor/diffEditorOptions.js`, default
 * `false`) but has not reached the published typings, hence the cast.
 *
 * It matters: in inline view with the default, Monaco reserves a ~20 px strip
 * for the original editor and lets *both* gutters print, so every unchanged row
 * reads "147147". Turning it on collapses that strip to zero width, which is
 * what VS Code's inline diff looks like.
 */
const INLINE_ONLY: monaco.editor.IDiffEditorOptions = {
  hideOriginalLineNumbers: true,
} as unknown as monaco.editor.IDiffEditorOptions;

export function DiffView({
  pair,
  path,
  visible = true,
  strings,
}: {
  pair: ExplorerFilePair;
  path?: string;
  /**
   * False while this tab sits in the background (`display: none`). Monaco
   * measures zero for a hidden container, so the diff is re-laid out the moment
   * the tab comes back rather than being left with a 0 × 0 viewport.
   */
  visible?: boolean;
  strings: ExplorerStrings;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const modelsRef = useRef<monaco.editor.ITextModel[]>([]);
  const modelSeq = useRef(0);

  const fontSize = useExplorerViewPrefs((pref) => pref.codeFontSize);
  const wordWrap = useExplorerViewPrefs((pref) => pref.wordWrap);
  const zoomCode = useExplorerViewPrefs((pref) => pref.zoomCode);
  const layoutPref = useExplorerViewPrefs((pref) => pref.diffLayout);
  const ignoreTrimWhitespace = useExplorerViewPrefs((pref) => pref.ignoreTrimWhitespace);
  const collapseUnchanged = useExplorerViewPrefs((pref) => pref.collapseUnchanged);
  const toggleDiffLayout = useExplorerViewPrefs((pref) => pref.toggleDiffLayout);
  const toggleWordWrap = useExplorerViewPrefs((pref) => pref.toggleWordWrap);
  const toggleIgnoreTrimWhitespace = useExplorerViewPrefs((pref) => pref.toggleIgnoreTrimWhitespace);
  const toggleCollapseUnchanged = useExplorerViewPrefs((pref) => pref.toggleCollapseUnchanged);

  const { width } = useElementSize(hostRef);
  // VS Code calls this `useInlineViewWhenSpaceIsLimited`; two 200 px columns are
  // not a diff anyone can read.
  const splitViable = width === 0 || width >= SPLIT_MIN_WIDTH;
  const layout = layoutPref === "split" && splitViable ? "split" : "inline";

  const [changeCount, setChangeCount] = useState(0);

  const renderable = pair.problem === null;
  useCtrlWheelZoom(hostRef, zoomCode, renderable);

  // --- editor lifecycle ----------------------------------------------------

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const editor = monaco.editor.createDiffEditor(host, {
      ...BASE_EDITOR_OPTIONS,
      theme: currentThemeName(),
      renderSideBySide: true,
      originalEditable: false,
      renderIndicators: true,
      renderOverviewRuler: true,
      diffAlgorithm: "advanced",
      // Monaco's default and VS Code's default: a line that only differs in
      // trailing whitespace is not a change.
      ignoreTrimWhitespace: true,
      enableSplitViewResizing: true,
    });
    editorRef.current = editor;

    return () => {
      editor.dispose();
      editorRef.current = null;
      for (const model of modelsRef.current) model.dispose();
      modelsRef.current = [];
    };
  }, []);

  // Two documents, re-created whenever the pair changes. A disposed model must
  // never be the editor's current model, so the swap happens before the old
  // ones are released.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !renderable) return;

    const seq = (modelSeq.current += 1);
    const originalModel = monaco.editor.createModel(
      pair.original,
      languageFor(pair.originalPath),
      monaco.Uri.parse(`inmemory://o/${seq}/${encodeURIComponent(baseName(pair.originalPath))}`),
    );
    const modifiedModel = monaco.editor.createModel(
      pair.modified,
      languageFor(pair.modifiedPath),
      monaco.Uri.parse(`inmemory://m/${seq}/${encodeURIComponent(baseName(pair.modifiedPath))}`),
    );
    editor.setModel({ original: originalModel, modified: modifiedModel });

    const previous = modelsRef.current;
    modelsRef.current = [originalModel, modifiedModel];
    for (const model of previous) model.dispose();
  }, [pair, renderable]);

  // Options are pushed rather than re-creating the editor: `updateOptions` keeps
  // scroll position, selection and the find widget alive across a toggle.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({
      renderSideBySide: layout === "split",
      wordWrap: wordWrap ? "on" : "off",
      fontSize,
      ignoreTrimWhitespace,
      // Only meaningful in inline view; the split view keeps its two gutters.
      ...(layout === "inline" ? INLINE_ONLY : null),
      hideUnchangedRegions: {
        enabled: collapseUnchanged,
        ...UNCHANGED_REGION,
      },
    });
  }, [layout, wordWrap, fontSize, ignoreTrimWhitespace, collapseUnchanged]);

  // The window follows the app theme through `html.dark`; Monaco is told to
  // follow rather than being re-created.
  useMonacoTheme();

  // `automaticLayout` is a ResizeObserver, and a `display: none` element
  // reports a zero-size box: the diff would come back from a background tab
  // laid out at 0 px wide. Re-measuring on activation is one call.
  useEffect(() => {
    if (visible) editorRef.current?.layout();
  }, [visible]);

  // --- change navigation ---------------------------------------------------

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const sync = () => setChangeCount(editor.getLineChanges()?.length ?? 0);
    sync();
    const subscription = editor.onDidUpdateDiff(sync);
    return () => subscription.dispose();
  }, [pair, renderable]);

  const goToDiff = useCallback((direction: "next" | "previous") => {
    editorRef.current?.goToDiff(direction);
  }, []);

  // F7 / Shift+F7 is VS Code's next/previous change. This is its own
  // BrowserWindow, so there is no clash with the main app's shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F7") return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      event.preventDefault();
      goToDiff(event.shiftKey ? "previous" : "next");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToDiff]);

  // --- render --------------------------------------------------------------

  if (pair.problem !== null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <CodeToolbar strings={strings} />
        <div className="flex flex-1 items-center justify-center p-6 text-body text-muted-foreground">
          {pair.problem === "binary" ? strings.binary : strings.tooLarge}
        </div>
      </div>
    );
  }

  const empty = pair.original.length === 0 && pair.modified.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CodeToolbar
        strings={strings}
        layoutToggle={{ layout, splitViable }}
        leading={
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => goToDiff("previous")}
              disabled={changeCount < 2}
              title={strings.previousChange}
              aria-label={strings.previousChange}
              className="rounded p-1 hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronUp className="size-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => goToDiff("next")}
              disabled={changeCount < 2}
              title={strings.nextChange}
              aria-label={strings.nextChange}
              className="rounded p-1 hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronDown className="size-3" aria-hidden="true" />
            </button>
            <span className="ml-1 tabular-nums" aria-live="polite">
              {changeCount} {strings.changesUnit}
            </span>
          </div>
        }
      />

      <ContextMenu>
        <ContextMenuTrigger className="relative min-h-0 flex-1" render={<div />}>
          {empty ? (
            <div className="flex h-full items-center justify-center p-6 text-body text-muted-foreground">
              {strings.diffEmpty}
            </div>
          ) : (
            // Monaco measures its own container and re-lays out through
            // `automaticLayout`, so no width is injected here.
            <div ref={hostRef} className="h-full w-full" data-diff-host="monaco" />
          )}
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={toggleDiffLayout} disabled={layoutPref === "split" && !splitViable}>
            {layout === "split" ? <Rows3 /> : <Columns2 />}
            {layout === "split" ? strings.inlineView : strings.sideBySide}
          </ContextMenuItem>
          <ContextMenuItem onClick={toggleWordWrap}>
            <WrapText />
            {strings.wordWrap}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={toggleIgnoreTrimWhitespace}>
            {strings.ignoreWhitespace}
          </ContextMenuItem>
          <ContextMenuItem onClick={toggleCollapseUnchanged}>
            {strings.collapseUnchanged}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!path}
            onClick={() => {
              if (path) void navigator.clipboard.writeText(path);
            }}
          >
            <Copy />
            {strings.copyPath}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}
