"use client";

import { useEffect, useState } from "react";
import { PlaceholderMascot } from "@/components/placeholder-mascot";
import {
  isMascotMode,
  isMascotState,
  mascotStateFor,
  type MascotContext,
  type MascotMode,
  type MascotState,
} from "@/lib/mascot-states";

/** How long an empty desk waves before settling into its home pose. */
const WAVE_MS = 1400;
/** Empty and untouched long enough that the character nods off. */
const SLEEP_MS = 45_000;

type Preview = { state: MascotState | null; mode: MascotMode | null };

function readPreview(): Preview {
  if (typeof window === "undefined") {
    return { state: null, mode: null };
  }
  const params = new URLSearchParams(window.location.search);
  const state = params.get("mascot");
  const mode = params.get("mascotMode");
  return {
    state: isMascotState(state) ? state : null,
    mode: isMascotMode(mode) ? mode : null,
  };
}

/**
 * Where a mode puts the one mascot. `empty` sits in the unused desk.
 * `beside` sits next to a running job and follows `job.phase` / `job.step`.
 * Pass `mode` — do not copy the art.
 */
export function MascotSlot(context: MascotContext) {
  const [preview, setPreview] = useState<Preview>({ state: null, mode: null });
  const [waving, setWaving] = useState(context.placement === "empty");
  const [asleep, setAsleep] = useState(false);

  useEffect(() => {
    setPreview(readPreview());
  }, []);

  useEffect(() => {
    if (context.placement !== "empty" || preview.state) {
      setWaving(false);
      return;
    }
    setWaving(true);
    const timer = window.setTimeout(() => setWaving(false), WAVE_MS);
    return () => window.clearTimeout(timer);
  }, [context.placement, preview.state]);

  useEffect(() => {
    if (context.placement !== "empty" || context.busy || context.failed || context.done || preview.state) {
      setAsleep(false);
      return;
    }
    const timer = window.setTimeout(() => setAsleep(true), SLEEP_MS);
    return () => window.clearTimeout(timer);
  }, [context.placement, context.busy, context.failed, context.done, preview.state]);

  const mode = preview.mode ?? context.mode;
  let state = preview.state ?? mascotStateFor({ ...context, mode });
  if (!preview.state && waving && !context.busy && !context.failed && !context.done) {
    state = "wave";
  } else if (!preview.state && asleep && state !== "error" && state !== "celebrating") {
    state = "sleep";
  }

  return <PlaceholderMascot state={state} placement={context.placement} mode={mode} />;
}
