/**
 * Mascot states as data. Which picture a state shows is a file per state under
 * `components/nultron/images/` (`manifest.json`); what this file owns is everything the desk decides
 * about a state: its name, its accessible label (`common.mascot.<state>`), how it moves, and which state
 * a mode's job phase or a moment of the app calls for.
 */

export const MASCOT_STATES = [
  "wave",
  "idle",
  "sleep",
  "thinking",
  "writing",
  "answering",
  "searching",
  "calculating",
  "charting",
  "reviewing",
  "listening",
  "painting",
  "filming",
  "editing",
  "presenting",
  "celebrating",
  "error",
  "surprised",
  "love",
  "charging",
  "lets-go",
] as const;

export type MascotState = (typeof MASCOT_STATES)[number];

export const MASCOT_MODES = [
  "chat",
  "documents",
  "research",
  "finance",
  "data",
  "market",
  "legal",
  "meeting",
  "images",
  "videos",
  "music",
  "edit",
  "presentations",
  "education",
  "knowledge",
] as const;

export type MascotMode = (typeof MASCOT_MODES)[number];

export type MascotPlacement = "empty" | "beside";

/**
 * How a state moves. This is the performance contract (the packaged Windows app has no GPU, so one
 * running CSS loop costs a full software-composited frame sixty times a second):
 * - `still`: no animation at all (idle, sleep).
 * - `once`: one finite clip when the state is entered, 600 to 1200 ms, that ends on the still.
 * - `loop-busy`: loops, stepped, and only while the caller says a job is really running (`data-busy`).
 *   Without it the state holds its still.
 */
export type MascotMotion = "still" | "once" | "loop-busy";

export const STATE_MOTION: Record<MascotState, MascotMotion> = {
  wave: "once",
  idle: "still",
  sleep: "still",
  thinking: "loop-busy",
  writing: "loop-busy",
  answering: "loop-busy",
  searching: "loop-busy",
  calculating: "loop-busy",
  charting: "loop-busy",
  reviewing: "loop-busy",
  listening: "loop-busy",
  painting: "loop-busy",
  filming: "loop-busy",
  editing: "loop-busy",
  presenting: "loop-busy",
  celebrating: "once",
  error: "once",
  surprised: "once",
  love: "once",
  charging: "loop-busy",
  "lets-go": "once",
};

/** `common.mascot.<state>`, the catalog key of the accessible name. */
export function mascotLabelKey(state: MascotState): string {
  return `common.mascot.${state}`;
}

/** What the character does on that desk when no phase has arrived yet. */
export const MASCOT_MODE_HOME: Record<MascotMode, MascotState> = {
  chat: "idle",
  documents: "writing",
  research: "searching",
  finance: "calculating",
  data: "calculating",
  market: "charting",
  legal: "reviewing",
  meeting: "listening",
  images: "painting",
  videos: "filming",
  music: "listening",
  edit: "editing",
  presentations: "presenting",
  education: "presenting",
  knowledge: "searching",
};

/**
 * `job.phase` / `job.step` ids the host actually emits, mapped to a pose.
 * An unknown id falls through to the mode's home pose.
 */
const PHASE_STATE: Record<string, MascotState> = {
  planning: "thinking",
  searching: "searching",
  reading: "searching",
  indexing: "searching",
  resolving: "searching",
  drafting: "writing",
  minuting: "writing",
  saving: "writing",
  translating: "writing",
  synthesis: "writing",
  distilling: "thinking",
  computing: "calculating",
  profiling: "calculating",
  analyzing: "calculating",
  quotes: "calculating",
  verifying: "reviewing",
  analysts: "charting",
  macro: "charting",
  debate: "thinking",
  risk: "thinking",
  extracting: "listening",
  transcribing: "listening",
};

/** Every pose a job phase can call for, once each. A job's chip can move to any of these while it runs. */
export const PHASE_POSES: readonly MascotState[] = [...new Set(Object.values(PHASE_STATE))];

/**
 * True when a mascot is a status indicator: a `loop-busy` state beside a job the caller says is
 * running (`NultronMascot` also requires its `busy` prop, because a dropped job stream leaves the
 * pose behind). Everything else (the hero's idle and wave, a finished job, an empty desk's home
 * pose) is decoration. The desk's ambient pause stops decoration as soon as nobody is using the
 * window, but a status indicator keeps moving through a long run with the hands off the mouse and
 * stops only when the window is hidden (`app/globals.css`, "Ambient pause").
 */
export function isMascotBusy(state: MascotState, placement: MascotPlacement): boolean {
  return placement === "beside" && STATE_MOTION[state] === "loop-busy";
}

export function isMascotState(value: string | null | undefined): value is MascotState {
  return Boolean(value && (MASCOT_STATES as readonly string[]).includes(value));
}

export function isMascotMode(value: string | null | undefined): value is MascotMode {
  return Boolean(value && (MASCOT_MODES as readonly string[]).includes(value));
}

export type MascotContext = {
  mode: MascotMode;
  placement: MascotPlacement;
  /** Active `job.phase` or `job.step` id, when the host has sent one. */
  phase?: string | null;
  busy?: boolean;
  failed?: boolean;
  done?: boolean;
};

/** Pick the pose from the mode and the latest job phase. Pure. */
export function mascotStateFor(context: MascotContext): MascotState {
  if (context.failed) {
    return "error";
  }
  if (context.done) {
    return "celebrating";
  }
  const phase = context.phase?.trim();
  if (phase && PHASE_STATE[phase]) {
    return PHASE_STATE[phase];
  }
  if (context.busy || context.placement === "empty" || phase) {
    return MASCOT_MODE_HOME[context.mode];
  }
  return "idle";
}
