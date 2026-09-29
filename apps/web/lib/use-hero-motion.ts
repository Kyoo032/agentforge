"use client";

import { type RefObject, useEffect } from "react";
import { attachHeroMotion } from "@/lib/hero-motion";

/** Binds `attachHeroMotion` to the hero for as long as it is mounted. */
export function useHeroMotion(hero: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = hero.current;
    if (!element) {
      return;
    }
    return attachHeroMotion(element);
  }, [hero]);
}
