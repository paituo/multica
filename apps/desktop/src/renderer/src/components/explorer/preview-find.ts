import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Find-in-preview for the rendered markdown pane.
 *
 * Monaco's find widget cannot be reused: the preview is not an editor, it is a
 * react-markdown tree. Electron's `webContents.findInPage` is wrong too — it
 * searches the whole window, so a hit inside the file tree would scroll the
 * sidebar instead of the document.
 *
 * So matches are collected by walking the pane's text nodes and painted with the
 * CSS Custom Highlight API, which styles ranges without wrapping them in
 * elements — important because the pane's HTML is owned by react-markdown and
 * rewriting it would fight the renderer.
 *
 * Two hazards this code exists to survive:
 *
 * - **Late DOM replacement.** `CodeBlock` renders the raw `<pre>` first and
 *   swaps in Shiki's highlighted HTML once the async grammar load finishes, so
 *   every Range taken before that swap points at detached nodes. A
 *   MutationObserver recomputes on every subtree change (debounced).
 * - **Case folding length drift.** `toLowerCase()` can change a string's length
 *   (Turkish İ, ﬁ ligatures), which would shift every offset after it. Offsets
 *   are only trusted when the folded string has the same length.
 */

const HIGHLIGHT_ALL = "explorer-find";
const HIGHLIGHT_ACTIVE = "explorer-find-active";

/** Caps the work on a pathological document; also the counter's ceiling. */
export const MAX_PREVIEW_MATCHES = 2_000;

type HighlightRegistryLike = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => boolean;
};

function highlightSupport(): { registry: HighlightRegistryLike; ctor: new (...ranges: Range[]) => unknown } | null {
  const registry = (CSS as unknown as { highlights?: HighlightRegistryLike }).highlights;
  const ctor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  return registry && ctor ? { registry, ctor } : null;
}

/** True when this Electron build can paint arbitrary text ranges. */
export const hasHighlightApi = (): boolean => highlightSupport() !== null;

/**
 * Every occurrence of `query` inside `root`, in document order.
 *
 * Matches never span element boundaries — that is what makes the search behave
 * like a browser's find rather than a regex over serialized HTML.
 */
export function collectMatches(
  root: Node,
  query: string,
  limit = MAX_PREVIEW_MATCHES,
): Range[] {
  const needle = query.trim();
  if (!needle) return [];
  const folded = needle.toLowerCase();
  const ranges: Range[] = [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") {
        return NodeFilter.FILTER_REJECT;
      }
      return (node.nodeValue?.length ?? 0) > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  let node = walker.nextNode();
  while (node && ranges.length < limit) {
    const value = node.nodeValue ?? "";
    const lower = value.toLowerCase();
    const haystack = lower.length === value.length ? lower : value;

    let from = 0;
    for (;;) {
      const at = haystack.indexOf(folded, from);
      if (at < 0) break;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
      if (ranges.length >= limit) break;
      from = at + Math.max(1, needle.length);
    }
    node = walker.nextNode();
  }

  return ranges;
}

/**
 * Matches for the current query, kept in sync with the pane as it mutates.
 *
 * Returns an empty list while `enabled` is false so a closed find bar costs
 * nothing on a 60 000-line document.
 */
export function usePreviewMatches(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  query: string,
): Range[] {
  const [matches, setMatches] = useState<Range[]>([]);
  // Kept in a ref so the observer callback always reads the latest query
  // without re-subscribing on every keystroke.
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !query.trim() || !root) {
      setMatches([]);
      return;
    }

    let timer: number | undefined;
    const recompute = () => setMatches(collectMatches(root, queryRef.current));
    recompute();

    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      // Shiki swaps several code blocks in quick succession; one pass after the
      // burst beats one pass per mutation.
      timer = window.setTimeout(recompute, 120);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [rootRef, enabled, query]);

  return matches;
}

/**
 * Paints `matches` into the highlight registry, with `active` on its own layer
 * so it can be styled differently. Cleans both layers up on unmount, otherwise
 * a stale registry entry keeps ranges (and their nodes) alive.
 */
export function useHighlightMatches(matches: readonly Range[], active: Range | undefined): void {
  useEffect(() => {
    const support = highlightSupport();
    if (!support) return;
    const { registry, ctor } = support;

    if (matches.length === 0) {
      registry.delete(HIGHLIGHT_ALL);
      registry.delete(HIGHLIGHT_ACTIVE);
      return;
    }

    registry.set(HIGHLIGHT_ALL, new ctor(...matches));
    if (active) registry.set(HIGHLIGHT_ACTIVE, new ctor(active));

    return () => {
      registry.delete(HIGHLIGHT_ALL);
      registry.delete(HIGHLIGHT_ACTIVE);
    };
  }, [matches, active]);
}
