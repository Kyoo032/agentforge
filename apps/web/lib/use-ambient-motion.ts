"use client";

import { useEffect } from "react";
import { attachAmbientMotion } from "@/lib/ambient-motion";

/** Binds the desk's ambient-motion switch for as long as the app is mounted. Mount it once, at the root. */
export function useAmbientMotion(): void {
  useEffect(() => attachAmbientMotion(), []);
}
