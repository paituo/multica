import { useEffect, type RefObject } from "react";

/**
 * Ctrl + wheel zoom for a scrollable code surface.
 *
 * A plain React `onWheel` handler is not enough here: Chromium treats ctrl+wheel
 * as a page-zoom gesture, and React attaches wheel listeners passively in some
 * builds, so `preventDefault()` would be ignored. This binds a non-passive
 * native listener instead.
 *
 * `deltaMode` has to be normalised first — a mouse reports lines (1), a page-up
 * reports pages (2) and a trackpad reports pixels (0); comparing raw `deltaY`
 * would make the trackpad unusably fast.
 */

export const WHEEL_PIXELS_PER_STEP = 50;

export function normalizedWheelPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * 100;
  return deltaY;
}

/** Accumulates wheel pixels so a trackpad glide produces one step, not twenty. */
export function createWheelStepAccumulator(pixelsPerStep = WHEEL_PIXELS_PER_STEP) {
  let accumulated = 0;
  return {
    /** Returns -1 / 0 / +1 for "smaller" / "no step yet" / "larger". */
    push(deltaY: number, deltaMode: number): number {
      accumulated += normalizedWheelPixels(deltaY, deltaMode);
      if (Math.abs(accumulated) < pixelsPerStep) return 0;
      const step = accumulated > 0 ? -1 : 1;
      accumulated = 0;
      return step;
    },
    reset() {
      accumulated = 0;
    },
  };
}

export function useCtrlWheelZoom(
  ref: RefObject<HTMLElement | null>,
  onStep: (step: number) => void,
  enabled = true,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;

    const accumulator = createWheelStepAccumulator();
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // Keep Chromium from zooming the whole window and from scrolling here.
      event.preventDefault();
      const step = accumulator.push(event.deltaY, event.deltaMode);
      if (step !== 0) onStep(step);
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [ref, onStep, enabled]);
}
