"use client";

import { useEffect, useState } from "react";

/**
 * True for `ms` after it mounts active, then false for good. `active` false is false at once. Used to
 * let a one-shot mascot clip (`lets-go`) play out before the state that follows it takes over.
 */
export function useHoldOnMount(active: boolean, ms: number): boolean {
  const [held, setHeld] = useState(active);
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setTimeout(() => setHeld(false), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return active && held;
}
