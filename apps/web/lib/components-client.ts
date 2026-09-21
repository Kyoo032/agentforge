/**
 * Components: native dependencies the app installs for itself, seen from the renderer.
 *
 * The wire contract lives in `packages/host/src/components/types.ts`. It is mirrored here rather
 * than imported, because the renderer never imports the host — so the tuples below are the
 * renderer's copy of six stages, five states and seven error codes, and the tests pin them.
 *
 * The install streams `job.*` events, exactly like Research / Finance / Data, so it rides the
 * existing `runJobStream` helper over both webdev HTTP and the packaged IPC transport.
 *
 * FAIL SOFT. A component is optional: without it documents are read by a reduced local reader.
 * Nothing here may throw at the UI, because this panel renders next to the onboarding key form
 * and must never be able to hold up first run.
 */
import type { JobEvent } from "@agentforge/core/jobs";
import { apiFetch } from "./api-client";
import { runJobStream } from "./job-stream";

export const COMPONENTS_PATH = "/api/v1/components";
export const COMPONENT_INSTALL_PATH = "/api/v1/components/install/stream";

/** The stage runner always walks these, in this order. */
export const COMPONENT_SETUP_STAGES = ["check", "download", "verify", "unpack", "probe", "marker"] as const;
export type ComponentStageId = (typeof COMPONENT_SETUP_STAGES)[number];

export const COMPONENT_STATES = ["ready", "missing", "installing", "failed", "unsupported"] as const;
export type ComponentState = (typeof COMPONENT_STATES)[number];

export const COMPONENT_SOURCES = ["bundled", "downloaded"] as const;
export type ComponentSource = (typeof COMPONENT_SOURCES)[number];

export const COMPONENT_ERROR_CODES = [
  "offline",
  "download_failed",
  "integrity_mismatch",
  "unpack_failed",
  "probe_failed",
  "unsupported_platform",
  "busy",
] as const;
export type ComponentErrorCode = (typeof COMPONENT_ERROR_CODES)[number];

export type ComponentFailure = { readonly code: ComponentErrorCode; readonly message: string };

export type ComponentStatus = {
  readonly id: string;
  readonly version: string;
  readonly state: ComponentState;
  readonly source: ComponentSource | null;
  readonly auto: boolean;
  /**
   * Phase 7 — the server installed this component and the operator owns it; there is nothing here
   * to offer. Absent on an older host (the frozen desktop, a webdev that predates the field), which
   * is read as `false`: a desk has always owned its own components.
   */
  readonly managed: boolean;
  readonly bytes: number;
  readonly error?: ComponentFailure;
};

export type SetupStageState = "pending" | "running" | "succeeded" | "skipped" | "failed";
export type SetupStage = {
  readonly id: ComponentStageId;
  readonly state: SetupStageState;
  readonly durationMs?: number;
};

export type SetupStatus = "idle" | "running" | "done" | "failed";

export type SetupState = {
  readonly stages: readonly SetupStage[];
  readonly received: number;
  readonly total: number;
  readonly percent: number;
  readonly status: SetupStatus;
  readonly errorCode?: ComponentErrorCode;
};

export const EMPTY_SETUP: SetupState = Object.freeze({
  stages: COMPONENT_SETUP_STAGES.map((id) => Object.freeze({ id, state: "pending" as SetupStageState })),
  received: 0,
  total: 0,
  percent: 0,
  status: "idle" as SetupStatus,
});

function isOneOf<T extends string>(tuple: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (tuple as readonly string[]).includes(value);
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseFailure(value: unknown): ComponentFailure | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const { code, message } = value as { code?: unknown; message?: unknown };
  if (!isOneOf(COMPONENT_ERROR_CODES, code)) {
    return undefined;
  }
  return { code, message: typeof message === "string" ? message : "" };
}

/** One status row, or `null` when it is not the shape the host documents. */
export function parseComponent(value: unknown): ComponentStatus | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const bytes = asCount(row.bytes);
  if (typeof row.id !== "string" || !row.id) {
    return null;
  }
  if (typeof row.version !== "string" || typeof row.auto !== "boolean" || bytes === null || bytes < 0) {
    return null;
  }
  if (!isOneOf(COMPONENT_STATES, row.state)) {
    return null;
  }
  if (row.source !== null && row.source !== undefined && !isOneOf(COMPONENT_SOURCES, row.source)) {
    return null;
  }
  const failure = parseFailure(row.error);
  const status: ComponentStatus = {
    id: row.id,
    version: row.version,
    state: row.state,
    source: isOneOf(COMPONENT_SOURCES, row.source) ? row.source : null,
    auto: row.auto,
    managed: row.managed === true,
    bytes,
  };
  return failure ? { ...status, error: failure } : status;
}

/** `{ components: [...] }` from the host; anything else is read as "no components". */
export function parseComponents(payload: unknown): readonly ComponentStatus[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const rows = (payload as { components?: unknown }).components;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map(parseComponent).filter((row): row is ComponentStatus => row !== null);
}

/**
 * Start an install by ourselves only for a component the host marked both missing and automatic,
 * and never for one the server manages — `managed` cannot be true while `auto` is, but this panel
 * is the thing that would post the install, so it checks the flag that says "not yours" directly.
 */
export function shouldAutoInstall(status: ComponentStatus | null | undefined): boolean {
  return status?.auto === true && status?.managed !== true && status?.state === "missing";
}

/**
 * The one component this panel speaks for, or `null` when there is nothing to say.
 * `ready` and `unsupported` show nothing; so does a component the owner must install themselves,
 * and so does one the hosted server manages — there the answer to "it is missing" is the
 * operator's, and a tenant is shown no install screen at all (Phase 7).
 */
export function pickComponentToSetUp(components: readonly ComponentStatus[]): ComponentStatus | null {
  return (
    components.find((row) => row.auto && !row.managed && row.state !== "ready" && row.state !== "unsupported") ?? null
  );
}

export async function fetchComponents(signal?: AbortSignal): Promise<readonly ComponentStatus[]> {
  try {
    const res = await apiFetch(COMPONENTS_PATH, { signal });
    if (!res.ok) {
      return [];
    }
    return parseComponents(await res.json().catch(() => null));
  } catch {
    // An older host without the route, a closed window, or no host at all: the app works anyway.
    return [];
  }
}

/**
 * Run the install, reporting every stage through `onEvent`.
 * Rejects with the `JobStreamError` the shared helper throws; its `code` is a contract code.
 */
export async function installComponent(
  id: string,
  onEvent: (event: JobEvent) => void,
  signal?: AbortSignal,
): Promise<ComponentStatus | null> {
  const result = await runJobStream<unknown>({ url: COMPONENT_INSTALL_PATH, body: { id }, signal, onEvent });
  return parseComponent(result);
}

const FINISHED: ReadonlySet<SetupStageState> = new Set<SetupStageState>(["succeeded", "skipped", "failed"]);

/**
 * How far along the whole walk is, in percent.
 *
 * Each of the six stages is worth the same slice, and the one long stage — the download — fills
 * its own slice from the byte counts it streams. That keeps the bar moving during the download
 * without letting it claim the install is finished the moment the bytes have landed.
 */
function percentOf(stages: readonly SetupStage[], received: number, total: number): number {
  let filled = 0;
  for (const stage of stages) {
    if (FINISHED.has(stage.state)) {
      filled += 1;
    } else if (stage.state === "running" && stage.id === "download" && total > 0) {
      filled += Math.min(Math.max(received / total, 0), 1);
    }
  }
  return Math.min(100, Math.round((filled / stages.length) * 100));
}

/** `running`, unless the stream already ended: a late event never reopens a finished install. */
function stillRunning(state: SetupState): SetupStatus {
  return state.status === "failed" || state.status === "done" ? state.status : "running";
}

function withStages(state: SetupState, stages: readonly SetupStage[], patch: Partial<SetupState> = {}): SetupState {
  const received = patch.received ?? state.received;
  const total = patch.total ?? state.total;
  return { ...state, ...patch, stages, received, total, percent: percentOf(stages, received, total) };
}

function applyPhase(state: SetupState, event: Extract<JobEvent, { type: "job.phase" }>): SetupState {
  if (!isOneOf(COMPONENT_SETUP_STAGES, event.phase)) {
    return state;
  }
  const next = isOneOf(["running", "succeeded", "skipped", "failed"] as const, event.state)
    ? (event.state as SetupStageState)
    : "running";
  const stages = state.stages.map((stage) =>
    stage.id === event.phase
      ? { id: stage.id, state: next, ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }) }
      : stage,
  );
  return withStages(state, stages, { status: stillRunning(state) });
}

function applyStep(state: SetupState, event: Extract<JobEvent, { type: "job.step" }>): SetupState {
  const total = asCount(event.total);
  const current = asCount(event.current);
  if (event.phase !== "download" || total === null || total <= 0 || current === null) {
    return state;
  }
  return withStages(state, state.stages, {
    received: Math.max(current, 0),
    total,
    status: stillRunning(state),
  });
}

function applyError(state: SetupState, event: Extract<JobEvent, { type: "job.error" }>): SetupState {
  const stages = state.stages.map((stage) =>
    stage.state === "running" ? { ...stage, state: "failed" as const } : stage,
  );
  const code = isOneOf(COMPONENT_ERROR_CODES, event.code) ? event.code : undefined;
  const failed = withStages(state, stages, { status: "failed" });
  return code ? { ...failed, errorCode: code } : failed;
}

/** Pure: fold one job event into the setup view. Never mutates `state`. */
export function reduceSetup(state: SetupState, event: JobEvent): SetupState {
  switch (event.type) {
    case "job.phase":
      return applyPhase(state, event);
    case "job.step":
      return applyStep(state, event);
    case "job.done":
      return { ...state, status: "done", percent: 100 };
    case "job.error":
      return applyError(state, event);
    default:
      return state;
  }
}

/** A failure that never came from the stream (no host, a dropped socket) folded in the same way. */
export function failSetup(state: SetupState, code: string, message = ""): SetupState {
  return applyError(state, { type: "job.error", code, message, status: 0 });
}
