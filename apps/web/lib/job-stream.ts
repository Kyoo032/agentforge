import { isJobEvent, type JobEvent } from "@agentforge/core/jobs";
import { apiFetch } from "./api-client";
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

function errorFromJson(payload: unknown, status: number): JobStreamError {
  const error =
    payload && typeof payload === "object"
      ? (payload as { error?: { code?: unknown; message?: unknown } }).error
      : null;
  const code = error && typeof error.code === "string" ? error.code : "request_failed";
  const message = error && typeof error.message === "string" && error.message.trim() ? error.message : "Request failed";
  return new JobStreamError(code, message, status);
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
