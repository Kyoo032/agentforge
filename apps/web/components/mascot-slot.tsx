"use client";

import { useEffect, useMemo, useState } from "react";
import { NultronMascot } from "@/components/nultron/nultron-mascot";
import {
  isMascotMode,
  isMascotState,
  mascotStateFor,
  type MascotContext,
  type MascotMode,
  type MascotState,
} from "@/lib/mascot-states";
import { slotNextStates } from "@/lib/mascot-triggers";

/** How long an empty desk waves before settling into its home pose. */
const WAVE_MS = 1400;
/** Empty and untouched long enough that the character nods off. */
const SLEEP_MS = 45_000;

/** Body size of a previewed busy mascot: the loops are drawn on the body only, and no desk has a body beside a job yet. */
const PREVIEW_BUSY_SIZE = 72;

type Preview = { state: MascotState | null; mode: MascotMode | null; busy: boolean };

function readPreview(): Preview {
  if (typeof window === "undefined") {
    return { state: null, mode: null, busy: false };
  }
  const params = new URLSearchParams(window.location.search);
  const state = params.get("mascot");
  const mode = params.get("mascotMode");
  return {
    state: isMascotState(state) ? state : null,
    mode: isMascotMode(mode) ? mode : null,
    // `?mascotBusy=1` with `?mascot=<state>`: a body-size mascot beside a running job, to see its loop.
    busy: params.get("mascotBusy") === "1",
  };
}

/**
 * Where a mode puts the one mascot. `empty` sits in the unused desk.
 * `beside` sits next to a running job and follows `job.phase` / `job.step`.
 * Pass `mode` — do not copy the art.
 */
export function MascotSlot(context: MascotContext & { decorative?: boolean }) {
  const [preview, setPreview] = useState<Preview>({ state: null, mode: null, busy: false });
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
  // What this slot can turn into from here; the mascot fetches those stills when idle.
  const next = useMemo(() => slotNextStates(mode, context.placement), [mode, context.placement]);
  let state = preview.state ?? mascotStateFor({ ...context, mode });
  if (!preview.state && waving && !context.busy && !context.failed && !context.done) {
    state = "wave";
  } else if (!preview.state && asleep && state !== "error" && state !== "celebrating") {
    state = "sleep";
  }

  const previewBusy = Boolean(preview.state) && preview.busy;
  return (
    <NultronMascot
      state={state}
      placement={previewBusy ? "beside" : context.placement}
      size={previewBusy ? PREVIEW_BUSY_SIZE : undefined}
      mode={mode}
      busy={previewBusy || Boolean(context.busy)}
      decorative={context.decorative}
      next={next}
    />
  );
}
