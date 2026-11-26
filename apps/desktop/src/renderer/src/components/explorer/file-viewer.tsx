import { useCallback, useEffect, useRef, useState } from "react";
import { Code, Copy, Eye } from "@multica/ui/icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@multica/ui/components/ui/context-menu";
import { Markdown } from "@multica/ui/markdown";
import type { ExplorerCommit, ExplorerTarget } from "../../../../shared/explorer-api";
import { DEFAULT_CODE_FONT_SIZE, useExplorerViewPrefs } from "@/stores/explorer-view-prefs";
import { CodeToolbar } from "./code-toolbar";
import { BASE_EDITOR_OPTIONS, currentThemeName, languageFor, monaco } from "./monaco-setup";
import { PreviewFindBar } from "./preview-find-bar";
import { useHighlightMatches, usePreviewMatches } from "./preview-find";
import "./preview-find.css";
import type { ExplorerStrings } from "./strings";
import { FileTimeline } from "./timeline";
import { useCtrlWheelZoom } from "./use-ctrl-wheel-zoom";
import { useMonacoTheme } from "./use-monaco-theme";

type ViewerState =
  | { status: "loading" }
  | { status: "text"; text: string }
  | { status: "note"; message: string }
  | { status: "error"; message: string };

/**
 * Visual gutter inside the preview, in unscaled pixels. Divided by the zoom
 * ratio at render time so the margin looks the same at every font size.
 */
const PREVIEW_GUTTER_PX = 32;

/**
 * Documents above this size are not pre-rendered in the background: the idle
 * pass would block the window for longer than the wait it saves.
 */
const PRERENDER_MAX_CHARS = 200_000;

/**
 * Read-only text viewer, on Monaco.
 *
 * The hand-written line renderer this replaces could only show monochrome text:
 * it had no grammar, no find, no caret. Monaco brings the whole VS Code text
 * surface for free — syntax highlighting for the ~50 languages already mapped
 * in `languageFor`, `Ctrl+F`, bracket matching, sticky-free scrolling — and,
 * because it virtualises lines, the old 5 000-line render cap is gone: a 60 k
 * line file is one viewport of DOM nodes, not 60 k.
 *
 * Markdown gets a second face: `Ctrl+Shift+V` (or the toolbar switch) renders it
 * through the app's own `Markdown` component, so a `.md` in a task reads the way
 * the same file reads in an issue description.
 */
export function FileViewer({
  target,
  path,
  refreshToken,
  onOpenCommit,
  strings,
}: {
  target: ExplorerTarget;
  path: string;
  refreshToken: number;
  /** Opens a revision of this file in a diff tab; wired to the timeline rows. */
  onOpenCommit: (rev: ExplorerCommit) => void;
  strings: ExplorerStrings;
}) {
  const [state, setState] = useState<ViewerState>({ status: "loading" });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modelSeq = useRef(0);

  const fontSize = useExplorerViewPrefs((pref) => pref.codeFontSize);
  const wordWrap = useExplorerViewPrefs((pref) => pref.wordWrap);
  const zoomCode = useExplorerViewPrefs((pref) => pref.zoomCode);
  const previewPref = useExplorerViewPrefs((pref) => pref.markdownPreview);
  const setPreview = useExplorerViewPrefs((pref) => pref.setMarkdownPreview);

  const language = languageFor(path);
  const isMarkdown = language === "markdown";
  const text = state.status === "text" ? state.text : null;
  const hasText = text !== null;
  // A non-markdown file keeps the preference but never honours it.
  const previewing = isMarkdown && previewPref && hasText;
  /** 1 at the reference font size; the preview scales its whole subtree by it. */
  const previewRatio = fontSize / DEFAULT_CODE_FONT_SIZE;

  // --- preview find -------------------------------------------------------

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const matches = usePreviewMatches(previewRef, previewing && findOpen, findQuery);
  const activeMatch = matches.length > 0 ? matches[Math.min(findIndex, matches.length - 1)] : undefined;
  useHighlightMatches(matches, activeMatch);

  // A new query restarts at the first hit rather than staying on a stale index.
  useEffect(() => {
    setFindIndex(0);
  }, [findQuery]);

  // Closing the preview must not leave the bar (or a registered highlight)
  // pointing at a pane that is no longer displayed.
  useEffect(() => {
    if (!previewing) setFindOpen(false);
  }, [previewing]);

  // Bring the active hit into view. `scrollIntoView` walks up to the nearest
  // scrollable ancestor, which is the preview pane, not the window.
  useEffect(() => {
    if (!activeMatch) return;
    const element =
      activeMatch.startContainer.parentElement ?? (activeMatch.startContainer as HTMLElement);
    element?.scrollIntoView({ block: "center" });
  }, [activeMatch]);

  /**
   * Pre-render the markdown while the reader is still looking at the source.
   *
   * Measured cause of the "opening the preview takes a moment" complaint: the
   * first render walks react-markdown over the whole document and every
   * `CodeBlock` inside it loads a Shiki grammar asynchronously, so the pane
   * appears empty and then fills in. Rendering one idle frame ahead of the
   * click makes the toggle a pure `display` change.
   */
  const [prerendered, setPrerendered] = useState(false);
  useEffect(() => {
    if (!isMarkdown || !hasText || previewing || prerendered) return;
    if ((text?.length ?? 0) > PRERENDER_MAX_CHARS) return;
    const idle = window.requestIdleCallback(() => setPrerendered(true), { timeout: 1_200 });
    return () => window.cancelIdleCallback(idle);
  }, [isMarkdown, hasText, previewing, prerendered, text]);

  const previewMounted = previewing || prerendered;

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

  useMonacoTheme();
  useCtrlWheelZoom(hostRef, zoomCode, hasText && !previewing);
  useCtrlWheelZoom(previewRef, zoomCode, previewing);

  // --- editor lifecycle ----------------------------------------------------

  // Created once, when the first document arrives, and kept across refreshes and
  // across a switch to the preview: re-creating it would throw away the scroll
  // position, the find widget and the undo stack on every toggle.
  useEffect(() => {
    const host = hostRef.current;
    if (!hasText || !host) return;

    const editor = monaco.editor.create(host, {
      ...BASE_EDITOR_OPTIONS,
      theme: currentThemeName(),
      value: "",
      language: "plaintext",
    });
    editorRef.current = editor;

    return () => {
      editor.dispose();
      editorRef.current = null;
      modelRef.current?.dispose();
      modelRef.current = null;
    };
  }, [hasText]);

  // A fresh model per document — the URI has to differ, and the old model must
  // stay the editor's until the swap has happened.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || text === null) return;

    const seq = (modelSeq.current += 1);
    const model = monaco.editor.createModel(
      text,
      language,
      monaco.Uri.parse(`inmemory://v/${seq}/${encodeURIComponent(baseName(path))}`),
    );
    const previous = modelRef.current;
    // Regaining focus re-reads the file (D13); the reader should not be thrown
    // back to line 1 because an agent touched the file they are reading.
    const scrollTop = editor.getScrollTop();
    editor.setModel(model);
    modelRef.current = model;
    previous?.dispose();
    if (previous) editor.setScrollTop(scrollTop);
  }, [text, language, path]);

  // Options are pushed, never re-created: `updateOptions` keeps the scroll
  // position and the find widget alive. This also covers the case where the
  // editor was created after the preference was already changed.
  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize,
      wordWrap: wordWrap ? "on" : "off",
    });
  }, [fontSize, wordWrap, hasText]);

  // Monaco measures its container; while the preview is showing the host is
  // `display: none` and measures zero, so it has to be re-laid out on return.
  useEffect(() => {
    if (!previewing) editorRef.current?.layout();
  }, [previewing]);

  // VS Code's "open preview to the side"; here it flips the same pane.
  useEffect(() => {
    if (!isMarkdown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "v") return;
      event.preventDefault();
      setPreview(!useExplorerViewPrefs.getState().markdownPreview);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMarkdown, setPreview]);

  /**
   * `Ctrl+F` over the preview.
   *
   * Only intercepted while the preview is the visible surface — in the source
   * view the key still belongs to Monaco's own find widget.
   */
  useEffect(() => {
    if (!previewing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
        return;
      }
      if (event.key === "Escape" && findOpen) {
        event.preventDefault();
        setFindOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewing, findOpen]);

  const copyPath = useCallback(() => {
    void navigator.clipboard.writeText(path);
  }, [path]);

  // --- render --------------------------------------------------------------

  const previewToggle =
    isMarkdown && hasText ? { previewing, onChange: setPreview } : undefined;

  if (state.status === "loading" || state.status === "note" || state.status === "error") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <CodeToolbar strings={strings} />
        <div className="flex flex-1 items-center justify-center p-6 text-center text-body text-muted-foreground">
          {state.status === "loading" ? strings.loading : state.message}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <CodeToolbar strings={strings} previewToggle={previewToggle} />
      <ContextMenu>
        <ContextMenuTrigger className="relative min-h-0 flex-1" render={<div />}>
          {/* Kept mounted while previewing so the editor survives the toggle. */}
          <div
            ref={hostRef}
            className={previewing ? "hidden" : "h-full w-full"}
            data-file-host="monaco"
          />
          {previewMounted && (
            <div
              ref={previewRef}
              // Pre-rendered but not selected: mounted, not displayed, so the
              // toggle is instant. `hidden` still lets React and Shiki finish
              // their work, and costs no layout.
              className={previewing ? "h-full overflow-auto [scrollbar-gutter:stable]" : "hidden"}
              data-file-host="markdown"
            >
              {/*
               * Zooming goes through `zoom`, not through `--content-size`.
               * Measured: the app's `text-*` tokens are resolved where they are
               * *declared* (`:root`), so `--text-body` already computes to
               * `calc(14px * 1)` there and redefining `--content-size` on a
               * descendant changes nothing inside it. A font-size on this
               * wrapper is no better — it would scale only the elements that
               * inherit it, leaving every heading, table and code block fixed.
               *
               * Two consequences of `zoom` that the sizing has to absorb:
               *
               * - It scales the element's box too, so `width: 100%` at 125%
               *   renders 125% of the pane and forces a horizontal scrollbar.
               *   Dividing the width by the ratio keeps the *rendered* width
               *   equal to the pane's — the preview reflows instead of
               *   scrolling sideways, and the text still gets bigger.
               * - Padding is scaled as well, so it is divided by the same ratio
               *   to keep the visual gutter constant.
               *
               * There is deliberately no max-width: a fixed measure left large
               * empty bands on both sides in a wide window (measured 880 px of
               * content inside a ~1 100 px pane at 125%). VS Code's preview
               * fills the pane, and so does this one.
               */}
              <article
                className="mx-auto w-full"
                style={{
                  zoom: previewRatio,
                  width: `calc(100% / ${previewRatio})`,
                  paddingLeft: PREVIEW_GUTTER_PX / previewRatio,
                  paddingRight: PREVIEW_GUTTER_PX / previewRatio,
                  paddingTop: PREVIEW_GUTTER_PX / previewRatio,
                  paddingBottom: PREVIEW_GUTTER_PX / previewRatio,
                }}
              >
                <Markdown mode="full">{state.text}</Markdown>
              </article>
            </div>
          )}
          {previewing && findOpen && (
            <PreviewFindBar
              strings={strings}
              query={findQuery}
              onChange={setFindQuery}
              total={matches.length}
              index={Math.min(findIndex, Math.max(0, matches.length - 1))}
              onPrev={() =>
                setFindIndex((current) =>
                  matches.length === 0 ? 0 : (current - 1 + matches.length) % matches.length,
                )
              }
              onNext={() =>
                setFindIndex((current) => (matches.length === 0 ? 0 : (current + 1) % matches.length))
              }
              onClose={() => setFindOpen(false)}
            />
          )}
        </ContextMenuTrigger>

        <ContextMenuContent>
          {isMarkdown && (
            <>
              <ContextMenuItem onClick={() => setPreview(!previewPref)}>
                {previewing ? <Code /> : <Eye />}
                {previewing ? strings.viewSource : strings.viewPreview}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={copyPath}>
            <Copy />
            {strings.copyPath}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/*
       * VS Code's Timeline, docked under the editor rather than in a sidebar.
       * Only rendered once the file has loaded — a timeline of a path that
       * failed to read would be a list of commits for something the reader
       * cannot see.
       */}
      <FileTimeline
        target={target}
        path={path}
        refreshToken={refreshToken}
        onOpenCommit={onOpenCommit}
        strings={strings}
      />
    </div>
  );
}

function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}
