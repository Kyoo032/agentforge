/**
 * Stage transitions as job events.
 *
 * Deliberately no parallel protocol: this reuses `job.phase` / `job.step` from
 * `@agentforge/core/jobs`, the same events Research, Finance and Data stream, so the renderer's
 * existing `reduceJobProgress` and the SSE plumbing in `job-stream.ts` work unchanged over both
 * webdev HTTP and Electron IPC. The only addition to that contract is the optional `state` /
 * `durationMs` pair on `job.phase`, which older producers simply never send.
 */
import type { JobEmitter } from "@agentforge/core/jobs";
import { appendComponentLog } from "./log";
import type { ComponentId, ComponentStage, ComponentStageState } from "./types";

/** English only, host-side: these are diagnostic stage names, not product copy (see AGENTS Locale). */
const STAGE_LABELS: Readonly<Record<ComponentStage, string>> = Object.freeze({
  check: "Checking",
  download: "Downloading",
  verify: "Verifying",
  unpack: "Unpacking",
  probe: "Loading",
  marker: "Finishing",
});

export function stageLabel(stage: ComponentStage): string {
  return STAGE_LABELS[stage];
}

export type StageReporter = {
  phase(stage: ComponentStage, state: ComponentStageState, durationMs?: number): void;
  progress(stage: ComponentStage, received: number, total: number, detail: string): void;
};

/** One reporter per install: every transition goes to the stream (if any) and always to the log. */
export function stageReporter(id: ComponentId, emit?: JobEmitter): StageReporter {
  return {
    phase(stage, state, durationMs) {
      emit?.({ type: "job.phase", phase: stage, label: STAGE_LABELS[stage], state, durationMs });
      appendComponentLog(`${id} ${stage} ${state}${durationMs === undefined ? "" : ` ${Math.round(durationMs)}ms`}`);
    },
    progress(stage, received, total, detail) {
      emit?.({ type: "job.step", phase: stage, label: STAGE_LABELS[stage], detail, current: received, total });
    },
  };
}
