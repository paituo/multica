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
// base editor worker (no TypeScript/JSON/CSS language services are enabled:
// browsers cannot run them over a git blob and the extra ~3 MB is dead weight).
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

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
 * Language id for a path. Monaco ships every `basic-languages` grammar with the
 * default entry point, so these ids always resolve; anything unknown falls back
 * to plain text rather than guessing and mis-colouring.
 */
const BY_EXTENSION: Record<string, string> = {
  bash: "shell",
  c: "c",
  cc: "cpp",
  cfg: "ini",
  cjs: "javascript",
  conf: "ini",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  dart: "dart",
  env: "ini",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  php: "php",
  properties: "ini",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "shell",
  sql: "sql",
  svelte: "html",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  vue: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

export function languageFor(path: string): string {
  const base = path.split("/").pop() ?? path;
  if (/^dockerfile$/i.test(base)) return "dockerfile";
  if (/^makefile$/i.test(base)) return "makefile";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "plaintext";
  return BY_EXTENSION[base.slice(dot + 1).toLowerCase()] ?? "plaintext";
}

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
