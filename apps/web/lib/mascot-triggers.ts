import type { UpdateStatus } from "@/lib/app-updates-copy";
import type { SetupStatus } from "@/lib/components-client";
import {
  MASCOT_MODE_HOME,
  type MascotMode,
  type MascotPlacement,
  type MascotState,
  PHASE_POSES,
} from "@/lib/mascot-states";

/**
 * Which Nultron state each moment of the app calls for. Pure, so the mapping is one table to read and
 * one place to change; the components only mount a mascot with the answer.
 *
 *  - charging:  while the first-run component installer runs, or an update downloads.
 *  - surprised: an update is ready to install.
 *  - love:      onboarding is done (the last step, before the button that opens Chat).
 *  - lets-go:   once, on the first send of a new chat.
 */

/** The first-run component installer: charging while it runs, then how it ended. `null` draws nothing. */
export function componentSetupMascot(status: SetupStatus): MascotState | null {
  switch (status) {
    case "running":
      return "charging";
    case "done":
      return "celebrating";
    case "failed":
      return "error";
    case "idle":
      return null;
  }
}

/** The rail's updates panel: charging while the release downloads, surprised once it is ready. */
export function updateMascot(status: UpdateStatus): MascotState | null {
  switch (status) {
    case "downloading":
      return "charging";
    case "ready":
      return "surprised";
    case "error":
      return "error";
    case "checking":
    case "current":
    case "available":
    case "idle":
    case "unavailable":
      return null;
  }
}

export type OnboardingStep = "welcome" | "key" | "try";

/** Hello on the first step, calm while the key goes in, and love once the key is accepted. */
export function onboardingMascot(step: OnboardingStep): MascotState {
  switch (step) {
    case "welcome":
      return "wave";
    case "key":
      return "idle";
    case "try":
      return "love";
  }
}

/** How long the live turn of a new chat shows `lets-go` before the working state takes over. */
export const LETS_GO_MS = 900;

export type LiveTurnFacts = {
  failed?: boolean;
  streaming?: boolean;
  /** This is the assistant's first turn in the thread, and it has just begun. */
  launching?: boolean;
};

/** The mascot beside a live assistant turn in Chat. */
export function liveTurnMascot(live: LiveTurnFacts): MascotState {
  if (live.failed) {
    return "error";
  }
  if (live.launching) {
    return "lets-go";
  }
  return live.streaming ? "answering" : "thinking";
}

/*
 * What each mount point can reach from where it stands, so its pictures are fetched before the change and
 * a pose never finds an empty box (`NultronMascot`'s `next`; the strips of the hero and the onboarding
 * hero are warmed by the event that makes them likely, see `chat-hero.tsx` and `onboarding-screen.tsx`).
 * A mount point lists the states, not the files: which files draw a state at its size is `nx-picture.ts`.
 */

/** The Chat hero: a wave when the pointer or focus arrives, a cheer on a tap. */
export const HERO_NEXT: readonly MascotState[] = ["wave", "celebrating"];

/** The mascot beside a live Chat reply: the first-turn launch, working, answering, or the failure. */
export const LIVE_TURN_NEXT: readonly MascotState[] = ["lets-go", "thinking", "answering", "error"];

/** The installer panel and the updates panel: how a charging run can end. */
export const SETUP_NEXT: readonly MascotState[] = ["celebrating", "error"];
export const UPDATE_NEXT: readonly MascotState[] = ["surprised", "error"];

/** The onboarding hero starts on `wave`; calm and love are the other two steps. */
export const ONBOARDING_NEXT: readonly MascotState[] = ["idle", "love"];

/**
 * What a `MascotSlot` can turn into. An empty desk waves, then holds its home pose and nods off; a chip
 * beside a job follows the phases the host can send and ends on a cheer or a failure.
 */
export function slotNextStates(mode: MascotMode, placement: MascotPlacement): MascotState[] {
  const home = MASCOT_MODE_HOME[mode];
  const reachable: MascotState[] =
    placement === "empty" ? [home, "sleep"] : [home, ...PHASE_POSES, "celebrating", "error"];
  return [...new Set(reachable)];
}
