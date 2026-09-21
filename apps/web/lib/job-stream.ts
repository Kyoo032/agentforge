import { isJobEvent, type JobEvent } from "@agentforge/core/jobs";
import { apiFetch } from "./api-client";
import { reportPlanBlocked } from "./plan-block";
import { consumeSse } from "./sse-client";

/** Pull job events out of an SSE buffer; returns the unconsumed tail. */
export function parseJobEvents(buffer: string): { events: JobEvent[]; rest: string } {
  const { events, rest } = consumeSse(buffer);
  return { events: events.filter(isJobEvent), rest };
}

export class JobStreamError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "JobStreamError";
    this.code = code;
    this.status = status;
  }
}

const FALLBACK_CODE = "request_failed";
const FALLBACK_MESSAGE = "Request failed";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * A JSON refusal → the typed error a studio shows.
 *
 * Two shapes reach here. Nearly every route answers the envelope
 * `{ error: { code, message } }` (`packages/host/src/errors.ts`). The two **blocked** errors are
 * flat instead — `{ error: "<code>", message }` — and one of those is a plan refusal
 * (`plan_past_due`, `plan_cancelled`, `plan_allowance_exhausted` at 403, `plan_unavailable` at
 * 503, `packages/host/src/entitlement-store.ts`). Read only through the enveloped shape, as this
 * did, a past-due tenant's job answered `request_failed` / "Request failed": a dead end with no
 * code to branch on and nothing to read.
 *
 * So the flat shape is read **only** for plan codes, and `reportPlanBlocked` is called first so the
 * boundary in `App.tsx` puts the right screen up whatever this error then does. `gateway_blocked`
 * is deliberately left as it was: it is the other flat code, nothing consumes it from a job stream
 * today, and it has its own parser and its own screen.
 */
export function errorFromJson(payload: unknown, status: number): JobStreamError {
  // Before anything is narrowed: a plan refusal is a whole-app state, not this job's error.
  const plan = reportPlanBlocked(payload);
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  if (plan) {
    return new JobStreamError(plan, text(record?.message) ?? FALLBACK_MESSAGE, status);
  }
  const error =
    record?.error && typeof record.error === "object"
      ? (record.error as { code?: unknown; message?: unknown })
      : null;
  return new JobStreamError(
    text(error?.code) ?? FALLBACK_CODE,
    text(error?.message) ?? FALLBACK_MESSAGE,
    status,
  );
}

/** Fold a job stream: resolves the `job.done` payload, rejects on `job.error` or a JSON error. */
export function settleJobEvents<T>(events: JobEvent[], onEvent?: (event: JobEvent) => void): T | undefined {
  let result: T | undefined;
  for (const event of events) {
    onEvent?.(event);
    if (event.type === "job.error") {
      throw new JobStreamError(event.code, event.message, event.status);
    }
    if (event.type === "job.done") {
      result = event.result as T;
    }
  }
  return result;
}

export async function runJobStream<T>(input: {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  onEvent?: (event: JobEvent) => void;
}): Promise<T> {
  const res = await apiFetch(input.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.body),
    signal: input.signal,
  });
  const contentType = res.headers.get("Content-Type") ?? "";
  if (!res.ok || contentType.includes("application/json")) {
    throw errorFromJson(await res.json().catch(() => null), res.status);
  }
  const reader = res.body?.getReader();
  if (!reader) {
    throw new JobStreamError("stream_failed", "The job stream could not be opened", 502);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  let finished = false;
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseJobEvents(buffer);
      buffer = parsed.rest;
      const settled = settleJobEvents<T>(parsed.events, input.onEvent);
      if (settled !== undefined) {
        result = settled;
        finished = true;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (result === undefined) {
    throw new JobStreamError("stream_ended", "The job ended without a result", 502);
  }
  return result;
}
