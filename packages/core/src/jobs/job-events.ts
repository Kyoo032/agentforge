/**
 * Progress events for long-running job modes (Research, Data, Finance).
 * Streamed over the same SSE channel as RuntimeEvent; the renderer reduces
 * them into a phase list instead of a silent spinner.
 */

export const JOB_SOURCE_STATUSES = ["found", "read", "unreachable"] as const;
export type JobSourceStatus = (typeof JOB_SOURCE_STATUSES)[number];

/**
 * Jobs whose phases can end in more than one way (the component installer: a stage succeeds, is
 * skipped because the work was already done, or fails) announce the outcome here. Optional, so a
 * single-pass job that only marks a phase as started keeps emitting exactly what it always did.
 */
export const JOB_PHASE_STATES = ["running", "succeeded", "skipped", "failed"] as const;
export type JobPhaseStateName = (typeof JOB_PHASE_STATES)[number];

export type JobPhaseEvent = {
  type: "job.phase";
  /** Machine id: planning | searching | reading | drafting | distilling | saving. */
  phase: string;
  /** Human label shown in the progress list. */
  label: string;
  /** Present only on jobs that report per-phase outcomes; absent means "started". */
  state?: JobPhaseStateName;
  /** Wall time of the phase, on the event that ends it. */
  durationMs?: number;
};

export type JobStepEvent = {
  type: "job.step";
  phase: string;
  label: string;
  detail?: string;
  current?: number;
  total?: number;
};

export type JobSourceEvent = {
  type: "job.source";
  id: string;
  title: string;
  url: string;
  status: JobSourceStatus;
};

export type JobDeltaEvent = { type: "job.delta"; text: string };

/** Verify / edit loop counter for modes that iterate (Legal). */
export type JobRoundEvent = { type: "job.round"; round: number; total: number; label: string };

export type JobDoneEvent = { type: "job.done"; result: unknown };

export type JobErrorEvent = { type: "job.error"; code: string; message: string; status: number };

export type JobEvent =
  | JobPhaseEvent
  | JobStepEvent
  | JobSourceEvent
  | JobDeltaEvent
  | JobRoundEvent
  | JobDoneEvent
  | JobErrorEvent;

export const JOB_EVENT_TYPES = new Set<JobEvent["type"]>([
  "job.phase",
  "job.step",
  "job.source",
  "job.delta",
  "job.round",
  "job.done",
  "job.error",
]);

export function isJobEvent(value: unknown): value is JobEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && JOB_EVENT_TYPES.has(type as JobEvent["type"]);
}

export type JobEmitter = (event: JobEvent) => void;

export type JobPhaseState = {
  phase: string;
  label: string;
  status: "active" | "done";
  steps: Array<{ label: string; detail?: string; current?: number; total?: number }>;
};

export type JobProgress = {
  phases: JobPhaseState[];
  sources: JobSourceEvent[];
  text: string;
  /** Latest round announced by a looping job, or null for single-pass jobs. */
  round: { round: number; total: number; label: string } | null;
  done: boolean;
  error: JobErrorEvent | null;
};

export const EMPTY_JOB_PROGRESS: JobProgress = {
  phases: [],
  sources: [],
  text: "",
  round: null,
  done: false,
  error: null,
};

function closeActive(phases: JobPhaseState[]): JobPhaseState[] {
  return phases.map((phase) => (phase.status === "active" ? { ...phase, status: "done" } : phase));
}

function appendStep(phases: JobPhaseState[], event: JobStepEvent): JobPhaseState[] {
  const step = { label: event.label, detail: event.detail, current: event.current, total: event.total };
  const index = phases.findIndex((phase) => phase.phase === event.phase);
  if (index === -1) {
    return [...phases, { phase: event.phase, label: event.phase, status: "active", steps: [step] }];
  }
  return phases.map((phase, at) => (at === index ? { ...phase, steps: [...phase.steps, step] } : phase));
}

function upsertSource(sources: JobSourceEvent[], event: JobSourceEvent): JobSourceEvent[] {
  const index = sources.findIndex((source) => source.id === event.id);
  if (index === -1) {
    return [...sources, event];
  }
  return sources.map((source, at) => (at === index ? event : source));
}

/** Pure reducer: fold one event into the progress view. Never mutates `state`. */
export function reduceJobProgress(state: JobProgress, event: JobEvent): JobProgress {
  switch (event.type) {
    case "job.phase":
      return {
        ...state,
        phases: [...closeActive(state.phases), { phase: event.phase, label: event.label, status: "active", steps: [] }],
      };
    case "job.step":
      return { ...state, phases: appendStep(state.phases, event) };
    case "job.source":
      return { ...state, sources: upsertSource(state.sources, event) };
    case "job.delta":
      return { ...state, text: state.text + event.text };
    case "job.round":
      return { ...state, round: { round: event.round, total: event.total, label: event.label } };
    case "job.done":
      return { ...state, phases: closeActive(state.phases), done: true };
    case "job.error":
      return { ...state, phases: closeActive(state.phases), done: true, error: event };
    default:
      return state;
  }
}
