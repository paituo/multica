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
import type { ExplorerTarget } from "../../../../shared/explorer-api";
import { DEFAULT_CODE_FONT_SIZE, useExplorerViewPrefs } from "@/stores/explorer-view-prefs";
import { CodeToolbar } from "./code-toolbar";
import { BASE_EDITOR_OPTIONS, currentThemeName, languageFor, monaco } from "./monaco-setup";
import type { ExplorerStrings } from "./strings";
import { useCtrlWheelZoom } from "./use-ctrl-wheel-zoom";
import { useMonacoTheme } from "./use-monaco-theme";

type ViewerState =
  | { status: "loading" }
  | { status: "text"; text: string }
  | { status: "note"; message: string }
  | { status: "error"; message: string };

/** Rendered measure of the preview column, before zoom. Same idea as the docs. */
const PREVIEW_COLUMN_PX = 880;

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
  strings,
}: {
  target: ExplorerTarget;
  path: string;
  refreshToken: number;
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
          {previewing && (
            <div
              ref={previewRef}
              className="h-full overflow-auto [scrollbar-gutter:stable]"
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
               * `zoom` scales the whole subtree; the column width is divided by
               * it so the rendered measure stays 880 px and the preview
               * reflows instead of scrolling sideways.
               */}
              <article
                className="mx-auto w-full px-10 py-8"
                style={{
                  zoom: fontSize / DEFAULT_CODE_FONT_SIZE,
                  maxWidth: `${PREVIEW_COLUMN_PX / (fontSize / DEFAULT_CODE_FONT_SIZE)}px`,
                }}
              >
                <Markdown mode="full">{state.text}</Markdown>
              </article>
            </div>
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
    </div>
  );
}

function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}
