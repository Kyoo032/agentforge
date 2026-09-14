"use client";

import { useCallback, useEffect, useState } from "react";
import { clampPanelWidth, readPanelWidth, writePanelWidth } from "@/lib/panel-width";

export function usePanelWidth(key: string, fallback: number, min: number, max: number): [number, (next: number) => void] {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    setWidth(readPanelWidth(key, fallback, min, max));
  }, [fallback, key, max, min]);

  const set = useCallback(
    (next: number) => {
      const clamped = clampPanelWidth(next, min, max);
      setWidth(clamped);
      writePanelWidth(key, clamped);
    },
    [key, max, min],
  );

  return [width, set];
}
