import { describe, expect, it } from "vitest";
import { collectMatches } from "./preview-find";

/**
 * `collectMatches` walks a real DOM, so the fixtures are real elements rather
 * than mocks: jsdom provides the TreeWalker and the Range API the pane search
 * depends on, and the element-boundary and skip-a-tag cases can only be
 * expressed with actual markup.
 */
function pane(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const texts = (ranges: Range[]): string[] => ranges.map((range) => range.toString());

describe("collectMatches", () => {
  it("finds every occurrence in document order", () => {
    const root = pane("<p>alpha beta</p><p>gamma alpha</p>");
    expect(texts(collectMatches(root, "alpha"))).toEqual(["alpha", "alpha"]);
  });

  it("is case-insensitive", () => {
    const root = pane("<p>Alpha and alpha</p>");
    expect(collectMatches(root, "ALPHA")).toHaveLength(2);
  });

  it("does not match across an element boundary", () => {
    // A browser's find would not highlight "foo" here either; matching across
    // nodes would mean re-serialising the tree react-markdown owns.
    const root = pane("<p><em>fo</em>o</p>");
    expect(collectMatches(root, "foo")).toEqual([]);
  });

  it("skips script and style text", () => {
    const root = pane("<style>.x{color:red}</style><script>var x = 1;</script><p>red</p>");
    const ranges = collectMatches(root, "red");
    expect(texts(ranges)).toEqual(["red"]);
  });

  it("returns nothing for a blank query", () => {
    const root = pane("<p>anything</p>");
    expect(collectMatches(root, "   ")).toEqual([]);
  });

  it("stops at the limit", () => {
    const root = pane(`<p>${"x ".repeat(50)}</p>`);
    expect(collectMatches(root, "x", 5)).toHaveLength(5);
  });

  it("keeps offsets correct after a case-folding length change", () => {
    // "İ".toLowerCase() is two code units ("i" + a combining dot), so the folded
    // text is one unit longer than the real one. Searching the folded text would
    // put the range one unit to the right and highlight "lfa " instead of
    // "alfa"; the guard falls back to the unfolded text.
    const root = pane("<p>İstanbul alfa</p>");
    const [range] = collectMatches(root, "alfa");
    expect(range?.toString()).toBe("alfa");
    expect(range?.startOffset).toBe(9);
  });
});
