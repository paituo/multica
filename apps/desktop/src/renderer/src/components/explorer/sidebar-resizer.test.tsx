import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
} from "@/stores/explorer-view-prefs";
import { SidebarResizer } from "./sidebar-resizer";

const label = "Resize sidebar";

function renderResizer(width = DEFAULT_SIDEBAR_WIDTH) {
  const onResize = vi.fn();
  const onCommit = vi.fn();
  const onReset = vi.fn();
  render(
    <SidebarResizer width={width} onResize={onResize} onCommit={onCommit} onReset={onReset} label={label} />,
  );
  const handle = screen.getByRole("separator", { name: label });
  // jsdom does not implement pointer capture, and the component releases it on
  // pointer-up; stubbing the four methods keeps the drag path testable.
  handle.setPointerCapture = () => undefined;
  handle.releasePointerCapture = () => undefined;
  handle.hasPointerCapture = () => false;
  return { handle, onResize, onCommit, onReset };
}

/**
 * `MouseEvent` rather than `PointerEvent`: jsdom has no `PointerEvent`
 * constructor, but React dispatches by event *type*, so a `pointerdown`
 * `MouseEvent` reaches `onPointerDown` with `clientX` intact.
 */
function pointer(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, clientX, button: 0 });
}

describe("SidebarResizer", () => {
  it("tracks the pointer while dragging and commits once on release", () => {
    const { handle, onResize, onCommit } = renderResizer();

    handle.dispatchEvent(pointer("pointerdown", 300));
    handle.dispatchEvent(pointer("pointermove", 340));
    handle.dispatchEvent(pointer("pointermove", 380));
    // Persisting on every move would be 60 synchronous localStorage writes per
    // second; only the release commits.
    expect(onCommit).not.toHaveBeenCalled();
    expect(onResize).toHaveBeenLastCalledWith(DEFAULT_SIDEBAR_WIDTH + 80);

    handle.dispatchEvent(pointer("pointerup", 380));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("clamps a drag that would push the sidebar past its bounds", () => {
    const { handle, onResize } = renderResizer();

    handle.dispatchEvent(pointer("pointerdown", 300));
    handle.dispatchEvent(pointer("pointermove", 5_000));
    expect(onResize).toHaveBeenLastCalledWith(MAX_SIDEBAR_WIDTH);

    handle.dispatchEvent(pointer("pointermove", -5_000));
    expect(onResize).toHaveBeenLastCalledWith(MIN_SIDEBAR_WIDTH);
  });

  it("ignores a drag started with a non-primary button", () => {
    const { handle, onResize } = renderResizer();

    const right = new MouseEvent("pointerdown", { bubbles: true, clientX: 300, button: 2 });
    handle.dispatchEvent(right);
    handle.dispatchEvent(pointer("pointermove", 400));
    expect(onResize).not.toHaveBeenCalled();
  });

  it("is keyboard operable, because a drag handle that only drags is unreachable", () => {
    const { handle, onResize, onCommit } = renderResizer();

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResize).toHaveBeenCalledWith(DEFAULT_SIDEBAR_WIDTH + 16);
    expect(onCommit).toHaveBeenCalled();

    onResize.mockClear();
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenCalledWith(DEFAULT_SIDEBAR_WIDTH - 16);
  });

  it("resets to the default width on double-click", () => {
    const { handle, onReset } = renderResizer(480);
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe("clampSidebarWidth", () => {
  it("keeps a usable width inside the window's minimum size", () => {
    expect(clampSidebarWidth(120)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(10_000)).toBe(MAX_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(320)).toBe(320);
    // A corrupt stored value must not collapse the sidebar to zero.
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});
