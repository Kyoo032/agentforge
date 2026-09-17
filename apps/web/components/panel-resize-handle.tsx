"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

type Props = {
  width: number;
  min: number;
  max: number;
  onWidth: (next: number) => void;
  label: string;
  testId: string;
};

/**
 * The grab strip is 8px wide and lives on the panel's own right edge, outside
 * whatever scrolls inside it (owner report 2026-09-17: "resize still hard to be
 * pressed, because it's in the same section with scroll"). The scrolling box
 * insets its 10px scrollbar away from this edge, so the two never stack at the
 * same x and the pointer always lands on the separator.
 *
 * The 8px is hit area only: the line the user sees is the 2px child, centred in
 * the strip and painted with `--accent` while hovered, focused or dragged.
 */
const HIT_AREA = "absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none select-none bg-transparent";
/* No `bg-transparent` here: it is the same `background-color` utility as the lit
   state, and which of the two wins is decided by their order in the stylesheet,
   not by their order in the attribute — with both present the drag highlight
   came out invisible. The line's rest state is the browser default (transparent)
   and only the state classes ever paint it. */
const LINE =
  "pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors";
const LINE_LIT = "bg-[var(--accent)]";
const LINE_HOVER =
  "group-hover:bg-[color-mix(in_srgb,var(--accent)_70%,transparent)] group-focus-visible:bg-[var(--accent)]";

export function PanelResizeHandle({ width, min, max, onWidth, label, testId }: Props) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) {
      return;
    }
    onWidth(drag.current.startWidth + (event.clientX - drag.current.startX));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onWidth(width - 8);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onWidth(width + 8);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      onWidth(min);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      onWidth(max);
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      data-testid={testId}
      data-dragging={dragging ? "true" : "false"}
      className={`group ${HIT_AREA}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true" className={`${LINE} ${dragging ? LINE_LIT : LINE_HOVER}`} />
    </div>
  );
}
