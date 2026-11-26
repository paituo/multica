// Must be evaluated **before** `monaco-editor` (ES module imports run in
// source order). The bundled languages set `globalThis._VSCODE_NLS_MESSAGES`
// and `globalThis._VSCODE_NLS_LANGUAGE` as a side effect, and Monaco reads both
// while its own modules are being evaluated (`localize()` runs at module scope
// in dozens of contributions) — import it afterwards and every string stays
// English. Specifier is the shallow form for the same `exports` reason as the
// worker below: `esm/vs/nls/...` would be doubled.
import "monaco-editor/nls/lang/zh-cn.js";
import * as monaco from "monaco-editor";
// `monaco-editor/editor/editor.worker.js` — not the deep `esm/vs/...` path.
// Monaco 0.58 declares `"./*": "./esm/vs/*.js"` in its `exports`, so a deep
// specifier gets doubled into `esm/vs/esm/vs/...` and Vite fails to resolve it.
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";

/**
 * Monaco bootstrap for the explorer window.
 *
 * Kept in its own module for two reasons:
 *
 * 1. `MonacoEnvironment` must be assigned **before** any editor is created, and
 *    a module import is the only place that ordering is guaranteed.
 * 2. The themes below are the single point where the editor is taught our
 *    palette. Monaco only accepts hex / rgba, while the app's Tailwind v4
 *    variables resolve to `oklch(...)`, so the values are pinned here next to
 *    the swatches they imitate rather than converted at runtime.
 */

declare global {
  var MonacoEnvironment: monaco.Environment | undefined;
}

// Monaco asks for a worker per language service. The explorer only needs the
// base editor worker: the TypeScript/JSON/CSS/HTML services are kept out of the
// bundle by `electron.vite.monaco.ts`, because a read-only blob viewer has no
// project for them to analyse and their workers alone cost ~9 MB.
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

/**
 * Belt and braces for the build-time exclusion in `electron.vite.monaco.ts`.
 *
 * That plugin keeps the four language services the `monaco-editor` barrel
 * registers (TypeScript, JSON, CSS, HTML) out of the module graph, which is
 * what actually fixes the worker errors: measured in the harness, opening a
 * `.ts` file raised `Missing requestHandler or method: provideInlayHints`,
 * then `getSyntacticDiagnostics`, and a `.json` file raised `resetSchema`.
 * Nothing here can substitute for it — `setModeConfiguration({})` was tried
 * first and still let `resetSchema` through, because the JSON mode sends that
 * while it sets up, before any provider is consulted.
 *
 * What is left is the case where some other entry point imports the barrel
 * without going through the build hook (a test runner, a scratch page): the
 * services come back, and every provider then posts to the editor worker,
 * which has no handler for any of it. Disabling every mode flag stops the
 * providers that *are* reached that way, so the failure degrades to missing
 * hovers rather than a thrown worker error.
 *
 * The namespaces are reached with a bracket lookup because when the build hook
 * does its job they do not exist at all, and a typed access would read as if
 * they did.
 */
type ModeConfiguration = Record<string, boolean>;
interface LanguageDefaults {
  setModeConfiguration?(configuration: ModeConfiguration): void;
}
interface LanguageNamespace {
  defaults?: LanguageDefaults;
  typescriptDefaults?: LanguageDefaults;
  javascriptDefaults?: LanguageDefaults;
  cssDefaults?: LanguageDefaults;
  lessDefaults?: LanguageDefaults;
  scssDefaults?: LanguageDefaults;
  htmlDefaults?: LanguageDefaults;
  handlebarDefaults?: LanguageDefaults;
  razorDefaults?: LanguageDefaults;
}

function disableLanguageServices(): void {
  const languages = monaco.languages as unknown as Record<string, LanguageNamespace | undefined>;
  const namespaces = ["typescript", "json", "css", "html"];
  for (const namespace of namespaces) {
    const group = languages[namespace];
    if (!group) continue;
    for (const value of Object.values(group)) {
      // Every entry of these namespaces is a `LanguageServiceDefaultsImpl`;
      // `defaults` is the one non-defaults field and simply lacks the method.
      value?.setModeConfiguration?.({});
    }
  }
}

disableLanguageServices();

export const LIGHT_THEME = "multica-light";
export const DARK_THEME = "multica-dark";

monaco.editor.defineTheme(LIGHT_THEME, {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#18181b",
    "editorGutter.background": "#ffffff",
    "editorLineNumber.foreground": "#a1a1aa",
    "editorLineNumber.activeForeground": "#52525b",
    "editor.lineHighlightBackground": "#00000000",
    "editor.selectionBackground": "#3b82f633",
    "editorWidget.background": "#ffffff",
    "editorWidget.border": "#e4e4e7",
    "editorOverviewRuler.border": "#00000000",
    "diffEditor.insertedLineBackground": "#10b98114",
    "diffEditor.insertedTextBackground": "#10b98133",
    "diffEditor.removedLineBackground": "#ef444414",
    "diffEditor.removedTextBackground": "#ef444433",
    "diffEditor.diagonalFill": "#e4e4e7",
    "diffEditor.unchangedRegionBackground": "#f4f4f5",
    "diffEditor.unchangedRegionForeground": "#71717a",
    "diffEditor.unchangedCodeBackground": "#f4f4f5",
    "scrollbarSlider.background": "#00000014",
    "scrollbarSlider.hoverBackground": "#00000024",
    "scrollbarSlider.activeBackground": "#00000033",
  },
});

monaco.editor.defineTheme(DARK_THEME, {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#09090b",
    "editor.foreground": "#e4e4e7",
    "editorGutter.background": "#09090b",
    "editorLineNumber.foreground": "#52525b",
    "editorLineNumber.activeForeground": "#a1a1aa",
    "editor.lineHighlightBackground": "#00000000",
    "editor.selectionBackground": "#3b82f655",
    "editorWidget.background": "#18181b",
    "editorWidget.border": "#27272a",
    "editorOverviewRuler.border": "#00000000",
    "diffEditor.insertedLineBackground": "#10b9811f",
    "diffEditor.insertedTextBackground": "#10b98140",
    "diffEditor.removedLineBackground": "#ef44441f",
    "diffEditor.removedTextBackground": "#ef444440",
    "diffEditor.diagonalFill": "#27272a",
    "diffEditor.unchangedRegionBackground": "#18181b",
    "diffEditor.unchangedRegionForeground": "#a1a1aa",
    "diffEditor.unchangedCodeBackground": "#18181b",
    "scrollbarSlider.background": "#ffffff14",
    "scrollbarSlider.hoverBackground": "#ffffff24",
    "scrollbarSlider.activeBackground": "#ffffff33",
  },
});

/** `html.dark` is what next-themes toggles; the explorer window inherits it. */
export function currentThemeName(): string {
  return document.documentElement.classList.contains("dark") ? DARK_THEME : LIGHT_THEME;
}

/**
 * Language detection lives in `./languages` so it can be unit-tested without
 * booting Monaco (this module creates a worker and defines themes on import).
 * Re-exported here because every viewer already imports from this module.
 */
export { languageFor, MONACO_LANGUAGE_IDS } from "./languages";

/** Shared options so the inline and side-by-side editors cannot drift apart. */
export const BASE_EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  domReadOnly: true,
  // The explorer has its own gutter width and overview ruler; Monaco's
  // equivalents would duplicate them.
  minimap: { enabled: false },
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 4,
  lineNumbersMinChars: 3,
  renderLineHighlight: "none",
  scrollBeyondLastLine: false,
  contextmenu: false,
  occurrencesHighlight: "off",
  selectionHighlight: false,
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  /**
   * Off, because nothing can answer.
   *
   * Inlay hints come from a language service, and the explorer deliberately
   * ships only `editor.worker` (see `MonacoEnvironment` above). With the
   * default `"on"`, every render posts `provideInlayHints` to a worker that has
   * no handler for it — measured in the visual harness: opening a `.ts` file
   * produced `Error: Missing requestHandler or method: provideInlayHints` and
   * Vite's overlay covered the window. In the packaged app the same failed
   * request is merely silent, which is not better.
   */
  inlayHints: { enabled: "off" },
  // `automaticLayout` is a ResizeObserver under the hood. It is what makes a
  // window resize re-wrap and re-measure the diff, which the hand-written
  // renderer had to do by hand and got wrong.
  automaticLayout: true,
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: false,
    alwaysConsumeMouseWheel: false,
  },
  padding: { top: 6, bottom: 6 },
  stickyScroll: { enabled: false },
  guides: { indentation: false, bracketPairs: false },
};

export { monaco };
