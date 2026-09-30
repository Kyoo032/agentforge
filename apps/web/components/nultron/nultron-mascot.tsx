"use client";

import { type CSSProperties, useEffect } from "react";
import { NxImageRig } from "@/components/nultron/nx-image-rig";
import { hasClip, hasLoop } from "@/components/nultron/nx-picture";
import { warmMascotAtIdle } from "@/components/nultron/nx-warm";
import { t } from "@/lib/i18n";
import {
  isMascotBusy,
  type MascotPlacement,
  type MascotState,
  mascotLabelKey,
  STATE_MOTION,
} from "@/lib/mascot-states";
import "@/components/nultron/nultron.css";

/** The head picture below this box size, the whole body from it up. */
export const NX_FULL_MIN = 64;

/** Box sizes when a caller passes neither `size` nor `variant`: a chip beside a job, a character on an empty desk. */
export const NX_SIZE_BESIDE = 40;
export const NX_SIZE_EMPTY = 72;

export type NultronVariant = "head" | "full";

/** The head below `NX_FULL_MIN`, the body from it up, so no size falls between the two. */
export function variantForSize(size: number): NultronVariant {
  return size >= NX_FULL_MIN ? "full" : "head";
}

export type NultronMascotProps = {
  state: MascotState;
  placement?: MascotPlacement;
  mode?: string;
  /** The caller knows a job is really running. A working pose alone is not proof of that. */
  busy?: boolean;
  /** Box side in px. Below 64 draws the head, from 64 the body. Omit to size by placement, or from CSS with `variant`. */
  size?: number;
  /** Pick the picture without fixing a size, for a box the stylesheet sizes (the Chat hero). */
  variant?: NultronVariant;
  /**
   * The text next to it already says what the character shows (a status line, an error, a button's own
   * name), so a screen reader gets nothing from it: no role, no name, no tooltip. Leave it off where the
   * character stands alone (an empty desk, the onboarding hero).
   */
  decorative?: boolean;
  /**
   * The states this mount point can reach from where it stands. Their stills are fetched when the browser
   * is idle (and their strips too, while a job runs), so the change of state finds them in the cache.
   * Keep the array stable (a constant or a memo): it is an effect dependency. Omit it and nothing else loads.
   */
  next?: readonly MascotState[];
  className?: string;
};

/**
 * The Nultron character. One root span carries every fact the CSS reads: `data-state`, how it moves
 * (`data-motion`: still, once, loop-busy), which picture it uses (`data-variant`, `data-clip`,
 * `data-loop`) and, only while a job is really running, `data-busy`. Changing state changes attributes
 * and the picture; the desk's ambient-pause and reduced-motion rules in `app/globals.css` target
 * `.chat-mascot` and `data-busy`, so the root class stays.
 */
export function NultronMascot({
  state,
  placement = "beside",
  mode,
  busy = false,
  size,
  variant,
  decorative = false,
  next,
  className,
}: NultronMascotProps) {
  const box = size ?? (variant ? undefined : placement === "empty" ? NX_SIZE_EMPTY : NX_SIZE_BESIDE);
  const rig = variant ?? variantForSize(box ?? NX_SIZE_BESIDE);
  const running = busy && isMascotBusy(state, placement);
  const label = t(mascotLabelKey(state));
  const vars: Record<string, string | number> = {};
  if (box) {
    vars["--nx-size"] = `${box}px`;
  }

  useEffect(
    () => (next && next.length > 0 ? warmMascotAtIdle(next, rig, { sheet: running }) : undefined),
    [next, rig, running],
  );

  return (
    <span
      className={className ? `chat-mascot nx-root ${className}` : "chat-mascot nx-root"}
      data-testid="chat-mascot"
      data-mascot="nultron"
      data-state={state}
      data-motion={STATE_MOTION[state]}
      data-variant={rig}
      data-clip={hasClip(state, rig) ? "true" : undefined}
      data-loop={hasLoop(state, rig) ? "true" : undefined}
      data-placement={placement}
      data-busy={running ? "true" : undefined}
      data-mode={mode}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? "true" : undefined}
      title={decorative ? undefined : label}
      style={Object.keys(vars).length > 0 ? (vars as CSSProperties) : undefined}
    >
      <NxImageRig state={state} kind={rig} busy={running} />
    </span>
  );
}
