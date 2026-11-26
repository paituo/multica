import { getPreviewKind, type PreviewKind } from "@multica/views/editor";

/**
 * What the file tab should put on screen for a given path.
 *
 * The decision itself is not re-implemented here: `getPreviewKind` in
 * `@multica/views/editor` is the table the attachment viewer dispatches on, and
 * the two hosts must agree — a `.csv` that renders as a table in an attachment
 * and as raw text in the explorer would be the same bug reported twice. What
 * this module adds is the explorer-specific regrouping: the attachment viewer
 * has one renderer for `text` (a highlighted `<pre>`) and a separate preview
 * mode for `markdown`, while here both land on Monaco, which already covers
 * them.
 */
export type ExplorerFileSurface =
  /** Monaco, read-only, no rendered alternative. */
  | "code"
  /** Monaco plus the rendered Markdown pane (Ctrl+Shift+V). */
  | "markdown"
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "table"
  | "structured"
  | "html";

/**
 * The surfaces that are *not* text. Their tab reads raw bytes instead of going
 * through `readFile`, which refuses binaries and anything over 2 MB — exactly
 * the files a preview is for. They also have no source mode: there is nothing
 * to toggle to.
 */
const MEDIA_SURFACES: ReadonlySet<ExplorerFileSurface> = new Set<ExplorerFileSurface>([
  "image",
  "pdf",
  "video",
  "audio",
]);

/** Surfaces whose bytes are read as UTF-8 text and may fall back to Monaco. */
const TEXT_SURFACES: ReadonlySet<ExplorerFileSurface> = new Set<ExplorerFileSurface>([
  "code",
  "markdown",
  "table",
  "structured",
  "html",
]);

export function fileSurfaceFor(path: string): ExplorerFileSurface {
  const kind: PreviewKind | null = getPreviewKind("", path);
  return kind === null ? "code" : kind === "text" ? "code" : kind;
}

export function isMediaSurface(surface: ExplorerFileSurface): boolean {
  return MEDIA_SURFACES.has(surface);
}

export function isTextSurface(surface: ExplorerFileSurface): boolean {
  return TEXT_SURFACES.has(surface);
}

/**
 * Whether the tab can switch between the rendered form and its source. Media
 * cannot; Markdown, tables, trees and HTML can, and start on the rendered side
 * because that is the whole reason those kinds are recognised.
 */
export function hasSourceMode(surface: ExplorerFileSurface): boolean {
  return surface === "markdown" || surface === "table" || surface === "structured" || surface === "html";
}
