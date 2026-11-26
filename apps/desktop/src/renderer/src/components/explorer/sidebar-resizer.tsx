import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
} from "@/stores/explorer-view-prefs";

/** One arrow key nudge, in CSS pixels. */
const KEY_STEP = 16;

/**
 * Drag handle between the sidebar and the viewer.
 *
 * The hit area is 5 px wide but only 1 px of it is painted, so the divider
 * looks like the border it replaces while still being grabbable. Pointer events
 * are captured on the handle itself: a plain `mousemove` on the divider loses
 * the drag the moment the cursor outruns it, which it always does when the
 * mouse moves fast.
 *
 * `onResize` fires on every move so the pane tracks the cursor, but persistence
 * is deferred to `onCommit` — `localStorage.setItem` is synchronous disk I/O,
 * and 60 of those per second during a drag is a visible stutter.
 */
export function SidebarResizer({
  width,
  onResize,
  onCommit,
  label,
  onReset,
}: {
  width: number;
  onResize: (width: number) => void;
  /** Called once the drag ends, with the final width. */
  onCommit: () => void;
  label: string;
  onReset: () => void;
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const endDrag = (element: HTMLElement, pointerId: number) => {
    if (!drag.current) return;
    drag.current = null;
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onCommit();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Only the primary button drags; a middle-click paste or a right-click menu
    // would otherwise start a width drag that never ends.
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
    // The divider is 5 px tall in hit area and the pointer routinely leaves it,
    // so the cursor has to be pinned on the document for the whole drag.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    onResize(clampSidebarWidth(state.startWidth + (event.clientX - state.startX)));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    endDrag(event.currentTarget, event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0;
    if (step === 0) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onReset();
      }
      return;
    }
    event.preventDefault();
    onResize(clampSidebarWidth(width + step));
    onCommit();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className="group relative -ml-px w-[5px] shrink-0 cursor-col-resize touch-none outline-none"
      data-sidebar-resizer="true"
    >
      {/* Painted only on hover/drag/focus: an always-on 5 px groove next to the
          panel edge reads as a second border. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary/70 group-active:bg-primary/70"
      />
    </div>
  );
}
