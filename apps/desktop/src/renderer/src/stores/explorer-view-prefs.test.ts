import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CODE_FONT_SIZE,
  MAX_CODE_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  clampFontSize,
  fontSizePercent,
  readViewPrefs,
  useExplorerViewPrefs,
} from "./explorer-view-prefs";

beforeEach(() => {
  window.localStorage.clear();
  useExplorerViewPrefs.setState({
    codeFontSize: DEFAULT_CODE_FONT_SIZE,
    wordWrap: true,
    changesView: "list",
    diffLayout: "split",
    ignoreTrimWhitespace: true,
    collapseUnchanged: true,
  });
});

describe("clampFontSize", () => {
  it("keeps the value inside the readable range", () => {
    expect(clampFontSize(4)).toBe(MIN_CODE_FONT_SIZE);
    expect(clampFontSize(80)).toBe(MAX_CODE_FONT_SIZE);
    expect(clampFontSize(13.4)).toBe(13);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_CODE_FONT_SIZE);
  });
});

describe("useExplorerViewPrefs", () => {
  it("steps the font size and persists it", () => {
    useExplorerViewPrefs.getState().zoomCode(1);
    useExplorerViewPrefs.getState().zoomCode(1);
    expect(useExplorerViewPrefs.getState().codeFontSize).toBe(DEFAULT_CODE_FONT_SIZE + 2);

    const stored = JSON.parse(window.localStorage.getItem("multica_explorer_view_prefs") ?? "{}");
    expect(stored.codeFontSize).toBe(DEFAULT_CODE_FONT_SIZE + 2);
  });

  it("never zooms past the bounds", () => {
    for (let index = 0; index < 40; index += 1) useExplorerViewPrefs.getState().zoomCode(1);
    expect(useExplorerViewPrefs.getState().codeFontSize).toBe(MAX_CODE_FONT_SIZE);
    for (let index = 0; index < 40; index += 1) useExplorerViewPrefs.getState().zoomCode(-1);
    expect(useExplorerViewPrefs.getState().codeFontSize).toBe(MIN_CODE_FONT_SIZE);
  });

  it("toggles word wrap and switches the change-list layout", () => {
    useExplorerViewPrefs.getState().toggleWordWrap();
    useExplorerViewPrefs.getState().setChangesView("tree");
    const stored = JSON.parse(window.localStorage.getItem("multica_explorer_view_prefs") ?? "{}");
    expect(stored.wordWrap).toBe(false);
    expect(stored.changesView).toBe("tree");
  });

  it("restores a sane subset from storage", () => {
    window.localStorage.setItem(
      "multica_explorer_view_prefs",
      JSON.stringify({ codeFontSize: 500, wordWrap: false, changesView: "tree" }),
    );
    expect(readViewPrefs()).toEqual({
      codeFontSize: MAX_CODE_FONT_SIZE,
      wordWrap: false,
      changesView: "tree",
      diffLayout: "split",
      ignoreTrimWhitespace: true,
      collapseUnchanged: true,
    });
  });

  it("remembers the diff-specific toggles", () => {
    useExplorerViewPrefs.getState().toggleIgnoreTrimWhitespace();
    useExplorerViewPrefs.getState().toggleCollapseUnchanged();
    expect(useExplorerViewPrefs.getState().ignoreTrimWhitespace).toBe(false);
    expect(useExplorerViewPrefs.getState().collapseUnchanged).toBe(false);

    const stored = JSON.parse(window.localStorage.getItem("multica_explorer_view_prefs") ?? "{}");
    expect(stored.ignoreTrimWhitespace).toBe(false);
    expect(stored.collapseUnchanged).toBe(false);

    // A stored `false` has to survive the round trip; reading it back as the
    // default `true` would silently re-enable what the reader turned off.
    expect(readViewPrefs().ignoreTrimWhitespace).toBe(false);
    expect(readViewPrefs().collapseUnchanged).toBe(false);
  });

  it("remembers the diff layout and flips it", () => {
    useExplorerViewPrefs.getState().toggleDiffLayout();
    expect(useExplorerViewPrefs.getState().diffLayout).toBe("inline");

    const stored = JSON.parse(window.localStorage.getItem("multica_explorer_view_prefs") ?? "{}");
    expect(stored.diffLayout).toBe("inline");
  });

  it("falls back to side-by-side for an unknown layout value", () => {
    window.localStorage.setItem("multica_explorer_view_prefs", JSON.stringify({ diffLayout: "triple" }));
    expect(readViewPrefs().diffLayout).toBe("split");
  });

  it("survives corrupt storage", () => {
    window.localStorage.setItem("multica_explorer_view_prefs", "{oops");
    expect(readViewPrefs().codeFontSize).toBe(DEFAULT_CODE_FONT_SIZE);
  });
});

describe("fontSizePercent", () => {
  it("reports 12 px as 100%", () => {
    expect(fontSizePercent(DEFAULT_CODE_FONT_SIZE)).toBe(100);
    expect(fontSizePercent(DEFAULT_CODE_FONT_SIZE * 1.5)).toBe(150);
  });
});
