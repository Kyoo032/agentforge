"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

type Props = {
  width: number;
  min: number;
  max: number;
  onWidth: (next: number) => void;
  label: string;
  testId: string;
};

export function PanelResizeHandle({ width, min, max, onWidth, label, testId }: Props) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) {
      return;
    }
    onWidth(drag.current.startWidth + (event.clientX - drag.current.startX));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    drag.current = null;
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
      className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize bg-transparent hover:bg-[color-mix(in_srgb,var(--accent)_45%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}
