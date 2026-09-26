/**
 * Mascot states as data. The SVG in `placeholder-mascot.tsx` is the only art;
 * a new activity is a row here plus a pose layer in that file.
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

/** Which drawn pose a state uses. `answering` shares the writing pose. */
export type MascotPose =
  | "wave"
  | "idle"
  | "sleep"
  | "thinking"
  | "writing"
  | "searching"
  | "calculating"
  | "charting"
  | "reviewing"
  | "listening"
  | "painting"
  | "filming"
  | "editing"
  | "presenting"
  | "celebrating"
  | "error";

export type MascotMouth = "idle" | "talk" | "smile" | "sad" | "sleep";

export type MascotStateDef = {
  pose: MascotPose;
  mouth: MascotMouth;
  /** `common.mascot.<key>` */
  labelKey: string;
};

export const MASCOT_STATE_DATA: Record<MascotState, MascotStateDef> = {
  wave: { pose: "wave", mouth: "smile", labelKey: "common.mascot.wave" },
  idle: { pose: "idle", mouth: "idle", labelKey: "common.mascot.idle" },
  sleep: { pose: "sleep", mouth: "sleep", labelKey: "common.mascot.sleep" },
  thinking: { pose: "thinking", mouth: "idle", labelKey: "common.mascot.thinking" },
  writing: { pose: "writing", mouth: "talk", labelKey: "common.mascot.writing" },
  answering: { pose: "writing", mouth: "talk", labelKey: "common.mascot.answering" },
  searching: { pose: "searching", mouth: "idle", labelKey: "common.mascot.searching" },
  calculating: { pose: "calculating", mouth: "talk", labelKey: "common.mascot.calculating" },
  charting: { pose: "charting", mouth: "idle", labelKey: "common.mascot.charting" },
  reviewing: { pose: "reviewing", mouth: "idle", labelKey: "common.mascot.reviewing" },
  listening: { pose: "listening", mouth: "smile", labelKey: "common.mascot.listening" },
  painting: { pose: "painting", mouth: "smile", labelKey: "common.mascot.painting" },
  filming: { pose: "filming", mouth: "smile", labelKey: "common.mascot.filming" },
  editing: { pose: "editing", mouth: "talk", labelKey: "common.mascot.editing" },
  presenting: { pose: "presenting", mouth: "talk", labelKey: "common.mascot.presenting" },
  celebrating: { pose: "celebrating", mouth: "smile", labelKey: "common.mascot.celebrating" },
  error: { pose: "error", mouth: "sad", labelKey: "common.mascot.error" },
};

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
