import { useLayoutEffect, useState, type RefObject } from "react";

export type ElementSize = { width: number; height: number };

/**
 * Tracks an element's content-box size.
 *
 * The code surfaces use this instead of letting CSS percentages drive the
 * layout: a `ResizeObserver` fires for every reason the pane can change width —
 * window resize, the vertical scrollbar appearing, a tab bar growing a row, a
 * font-size step — and an explicit pixel width makes wrapping recompute even in
 * the cases where a shrink-to-fit container keeps its old intrinsic size.
 *
 * `clientWidth`/`clientHeight` are read rather than `contentRect` so the number
 * matches what a scroll container actually hands to its children, and so
 * `scrollbar-gutter` is already accounted for.
 */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const read = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      );
    };

    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
