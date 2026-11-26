import { create } from "zustand";

/**
 * View preferences for the explorer window (font size, word wrap, change-list
 * layout).
 *
 * Kept as its own store rather than explorer-tabs because these are window-wide
 * reader settings shared by every file/diff tab: zooming one tab should zoom the
 * next one too, otherwise the window feels inconsistent. Persisted to a single
 * global key (not per issue) — a developer who prefers 14 px wants 14 px in every
 * task.
 */

export const MIN_CODE_FONT_SIZE = 9;
export const MAX_CODE_FONT_SIZE = 22;
export const DEFAULT_CODE_FONT_SIZE = 12;

export type ChangesViewMode = "list" | "tree";

/**
 * Diff presentation, mirroring VS Code's diff editor: side-by-side is the
 * default there and inline is the fallback when the editor is too narrow.
 */
export type DiffLayout = "split" | "inline";

/** Below this width a two-column diff cannot show a useful amount of code. */
export const SPLIT_MIN_WIDTH = 640;

type Stored = {
  codeFontSize: number;
  wordWrap: boolean;
  changesView: ChangesViewMode;
  diffLayout: DiffLayout;
  /**
   * VS Code's `diffEditor.ignoreTrimWhitespace`, which defaults to **true**:
   * a line that only differs in trailing whitespace is not a change. Kept on by
   * default for the same reason VS Code does it — it is what makes reformatting
   * commits readable.
   */
  ignoreTrimWhitespace: boolean;
  /**
   * Collapse runs of unchanged lines into a clickable band. On by default here,
   * unlike VS Code, because this window is for reviewing a change set rather
   * than reading a whole file; `minimumLineCount` keeps small files untouched.
   */
  collapseUnchanged: boolean;
  /**
   * Show markdown files rendered instead of as source. Off by default, as in
   * VS Code, where opening a `.md` gives you the text and the preview is a
   * deliberate act (`Ctrl+Shift+V`).
   */
  markdownPreview: boolean;
  /**
   * VS Code's `scm.showUntrackedFiles`, default on. Untracked files are the
   * noisiest part of a fresh working tree (build output, scratch scripts), so
   * hiding them is a common way to read a change set.
   */
  showUntracked: boolean;
};

const STORAGE_KEY = "multica_explorer_view_prefs";

const DEFAULTS: Stored = {
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  wordWrap: true,
  changesView: "list",
  diffLayout: "split",
  ignoreTrimWhitespace: true,
  collapseUnchanged: true,
  markdownPreview: false,
  showUntracked: true,
};

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CODE_FONT_SIZE;
  return Math.min(MAX_CODE_FONT_SIZE, Math.max(MIN_CODE_FONT_SIZE, Math.round(value)));
}

export function readViewPrefs(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<keyof Stored, unknown>>;
    return {
      codeFontSize: clampFontSize(
        typeof parsed.codeFontSize === "number" ? parsed.codeFontSize : DEFAULTS.codeFontSize,
      ),
      wordWrap: typeof parsed.wordWrap === "boolean" ? parsed.wordWrap : DEFAULTS.wordWrap,
      changesView: parsed.changesView === "tree" ? "tree" : "list",
      diffLayout: parsed.diffLayout === "inline" ? "inline" : "split",
      ignoreTrimWhitespace:
        typeof parsed.ignoreTrimWhitespace === "boolean"
          ? parsed.ignoreTrimWhitespace
          : DEFAULTS.ignoreTrimWhitespace,
      collapseUnchanged:
        typeof parsed.collapseUnchanged === "boolean"
          ? parsed.collapseUnchanged
          : DEFAULTS.collapseUnchanged,
      markdownPreview:
        typeof parsed.markdownPreview === "boolean" ? parsed.markdownPreview : DEFAULTS.markdownPreview,
      showUntracked:
        typeof parsed.showUntracked === "boolean" ? parsed.showUntracked : DEFAULTS.showUntracked,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeViewPrefs(state: Stored): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Reader settings are a convenience; losing them is not a failure.
  }
}

type ExplorerViewPrefsState = Stored & {
  setCodeFontSize: (size: number) => void;
  /** `step > 0` zooms in, `step < 0` zooms out. */
  zoomCode: (step: number) => void;
  resetCodeFontSize: () => void;
  setWordWrap: (wrap: boolean) => void;
  toggleWordWrap: () => void;
  setChangesView: (mode: ChangesViewMode) => void;
  setDiffLayout: (layout: DiffLayout) => void;
  toggleDiffLayout: () => void;
  setIgnoreTrimWhitespace: (value: boolean) => void;
  toggleIgnoreTrimWhitespace: () => void;
  setCollapseUnchanged: (value: boolean) => void;
  toggleCollapseUnchanged: () => void;
  setMarkdownPreview: (value: boolean) => void;
  toggleMarkdownPreview: () => void;
  setShowUntracked: (value: boolean) => void;
  toggleShowUntracked: () => void;
};

const initial = readViewPrefs();

export const useExplorerViewPrefs = create<ExplorerViewPrefsState>((set, get) => ({
  ...initial,
  setCodeFontSize: (size) => {
    const codeFontSize = clampFontSize(size);
    if (codeFontSize === get().codeFontSize) return;
    set({ codeFontSize });
    writeViewPrefs({ ...get(), codeFontSize });
  },
  zoomCode: (step) => get().setCodeFontSize(get().codeFontSize + step),
  resetCodeFontSize: () => get().setCodeFontSize(DEFAULT_CODE_FONT_SIZE),
  setWordWrap: (wordWrap) => {
    if (wordWrap === get().wordWrap) return;
    set({ wordWrap });
    writeViewPrefs({ ...get(), wordWrap });
  },
  toggleWordWrap: () => get().setWordWrap(!get().wordWrap),
  setChangesView: (changesView) => {
    if (changesView === get().changesView) return;
    set({ changesView });
    writeViewPrefs({ ...get(), changesView });
  },
  setDiffLayout: (diffLayout) => {
    if (diffLayout === get().diffLayout) return;
    set({ diffLayout });
    writeViewPrefs({ ...get(), diffLayout });
  },
  toggleDiffLayout: () => get().setDiffLayout(get().diffLayout === "split" ? "inline" : "split"),
  setIgnoreTrimWhitespace: (ignoreTrimWhitespace) => {
    if (ignoreTrimWhitespace === get().ignoreTrimWhitespace) return;
    set({ ignoreTrimWhitespace });
    writeViewPrefs({ ...get(), ignoreTrimWhitespace });
  },
  toggleIgnoreTrimWhitespace: () => get().setIgnoreTrimWhitespace(!get().ignoreTrimWhitespace),
  setCollapseUnchanged: (collapseUnchanged) => {
    if (collapseUnchanged === get().collapseUnchanged) return;
    set({ collapseUnchanged });
    writeViewPrefs({ ...get(), collapseUnchanged });
  },
  toggleCollapseUnchanged: () => get().setCollapseUnchanged(!get().collapseUnchanged),
  setMarkdownPreview: (markdownPreview) => {
    if (markdownPreview === get().markdownPreview) return;
    set({ markdownPreview });
    writeViewPrefs({ ...get(), markdownPreview });
  },
  toggleMarkdownPreview: () => get().setMarkdownPreview(!get().markdownPreview),
  setShowUntracked: (showUntracked) => {
    if (showUntracked === get().showUntracked) return;
    set({ showUntracked });
    writeViewPrefs({ ...get(), showUntracked });
  },
  toggleShowUntracked: () => get().setShowUntracked(!get().showUntracked),
}));

/** Percentage shown in the toolbar; 12 px is the reference size. */
export function fontSizePercent(size: number): number {
  return Math.round((size / DEFAULT_CODE_FONT_SIZE) * 100);
}
