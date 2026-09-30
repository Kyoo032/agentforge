import { classifyEffortRejection, type ReasoningEffort, type ResolvedChatWire } from "@agentforge/core";
import type { GatewayCredentials } from "./credentials";
import {
  MAX_ERROR_CHARS,
  classifyFailure,
  flatten,
  parseErrorBody,
  type FailureKind,
} from "./probe-errors";
import { interpretFrame, mergeUsage, parseFrame, sseDataBlocks, type ProbeUsage } from "./probe-frames";
import type { ProbeRequest, TokenField } from "./probe-request";

export { MAX_ERROR_CHARS };

/** One request and what came of it. It holds no key, no request body and no response body. */
export type ProbeCallRecord = {
  model: string;
  wire: ResolvedChatWire;
  /** `baseline` is the call with no effort parameter at all. */
  level: ReasoningEffort | "baseline";
  /** The effort field as it was written, e.g. `reasoning_effort=high`. */
  sends: string;
  maxTokens: number;
  tokenField: TokenField;
  /** 1 for the first try of a call, 2 and 3 for the retries after an output-budget adjustment. */
  attempt: number;
  /** The HTTP status; 0 when no response arrived. */
  status: number;
  ok: boolean;
  errorCode?: string;
  /** The gateway's own words, one line, at most `MAX_ERROR_CHARS`, the key scrubbed. */
  errorMessage?: string;
  /** The core classifier's reading: the gateway refused the Thinking level (`value`) or parameter. */
  effortRefusal?: "value" | "parameter";
  failureKind?: FailureKind;
  /** The floor the gateway named for the output budget, when it named one. */
  tokenFloor?: number;
  ttftMs?: number;
  totalMs: number;
  /** Any answer text came back (thinking alone is not an answer). */
  answered: boolean;
  /** The first characters of the answer, to see it is `OK` and not a refusal. */
  answer?: string;
  finishReason?: string;
  usage?: ProbeUsage;
};

export type ProbeCallDeps = {
  credentials: Pick<GatewayCredentials, "authHeaders" | "redact">;
  fetch: typeof fetch;
  timeoutMs: number;
  /** Milliseconds; injected so a test can advance time exactly. */
  now: () => number;
  attempt?: number;
};

/** Enough of an error body to classify and quote; the rest of a large page is not read. */
const MAX_BODY_CHARS = 8_000;
const MAX_ANSWER_CHARS = 40;

class ProbeTimeout extends Error {
  constructor(ms: number) {
    super(`no complete answer within ${ms} ms`);
    this.name = "ProbeTimeout";
  }
}

/** Race a read against the abort signal, so a stream that stalls after its headers still times out. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function readCappedText(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < MAX_BODY_CHARS) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text.slice(0, MAX_BODY_CHARS);
}

export async function runProbeCall(request: ProbeRequest, deps: ProbeCallDeps): Promise<ProbeCallRecord> {
  const started = deps.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ProbeTimeout(deps.timeoutMs)), deps.timeoutMs);
  const identity = {
    model: request.model,
    wire: request.wire,
    level: request.level ?? ("baseline" as const),
    sends: request.sends,
    maxTokens: request.maxTokens,
    tokenField: request.tokenField,
    attempt: deps.attempt ?? 1,
  };
  const scrub = (text: string) => flatten(deps.credentials.redact(text));
  /** Set once headers arrive, so a stream that then stalls is still recorded with the status it opened with. */
  let openedWith = 0;

  try {
    const response = await deps.fetch(request.url, {
      method: "POST",
      headers: { ...request.headers, ...deps.credentials.authHeaders(request.wire) },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    openedWith = response.status;

    if (!response.ok) {
      const raw = await readCappedText(response, controller.signal);
      const parsed = parseErrorBody(raw);
      const message = parsed.message === undefined ? undefined : scrub(parsed.message);
      const failure = classifyFailure({ status: response.status, message: message ?? "", tokenField: request.tokenField });
      const refusal = classifyEffortRejection({ status: response.status, body: raw });
      return {
        ...identity,
        status: response.status,
        ok: false,
        ...(parsed.code === undefined ? {} : { errorCode: scrub(parsed.code) }),
        ...(message === undefined ? {} : { errorMessage: message }),
        ...(refusal ? { effortRefusal: refusal.kind } : {}),
        failureKind: failure.kind,
        ...(failure.tokenFloor === undefined ? {} : { tokenFloor: failure.tokenFloor }),
        totalMs: deps.now() - started,
        answered: false,
      };
    }

    let ttftMs: number | undefined;
    let answer = "";
    let usage: ProbeUsage | undefined;
    let finishReason: string | undefined;
    let streamError: { code?: string; message?: string } | undefined;
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (reader) {
        const { done, value } = await raceAbort(reader.read(), controller.signal);
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const split = sseDataBlocks(buffer);
        buffer = split.rest;
        for (const block of split.blocks) {
          const frame = parseFrame(block);
          if (frame === undefined) {
            continue;
          }
          const info = interpretFrame(request.wire, frame);
          if (info.token && ttftMs === undefined) {
            ttftMs = deps.now() - started;
          }
          if (info.text) {
            answer += info.text;
          }
          usage = mergeUsage(usage, info.usage);
          finishReason = info.finishReason ?? finishReason;
          streamError = info.error ?? streamError;
        }
      }
    } finally {
      await reader?.cancel().catch(() => undefined);
    }

    const totalMs = deps.now() - started;
    if (streamError) {
      const message = streamError.message === undefined ? undefined : scrub(streamError.message);
      const refusal = classifyEffortRejection({ status: 400, body: JSON.stringify({ error: streamError }) });
      return {
        ...identity,
        status: response.status,
        ok: false,
        ...(streamError.code === undefined ? {} : { errorCode: scrub(streamError.code) }),
        ...(message === undefined ? {} : { errorMessage: message }),
        ...(refusal ? { effortRefusal: refusal.kind } : {}),
        failureKind: "other",
        ...(ttftMs === undefined ? {} : { ttftMs }),
        totalMs,
        answered: false,
      };
    }
    const preview = answer.trim().slice(0, MAX_ANSWER_CHARS);
    return {
      ...identity,
      status: response.status,
      ok: true,
      ...(ttftMs === undefined ? {} : { ttftMs }),
      totalMs,
      answered: preview.length > 0,
      ...(preview ? { answer: preview } : {}),
      ...(finishReason === undefined ? {} : { finishReason }),
      ...(usage === undefined ? {} : { usage }),
    };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const message = timedOut
      ? `no complete answer within ${deps.timeoutMs} ms`
      : error instanceof Error && error.message
        ? scrub(error.message)
        : "the request failed before any response";
    return {
      ...identity,
      status: openedWith,
      ok: false,
      failureKind: timedOut ? "timeout" : "network",
      errorMessage: message,
      totalMs: deps.now() - started,
      answered: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The call a run makes for each request: the credentials, the fetch and the clock bound in once. */
export function makeProbeSender(
  deps: Omit<ProbeCallDeps, "attempt">,
): (request: ProbeRequest, attempt: number) => Promise<ProbeCallRecord> {
  return (request, attempt) => runProbeCall(request, { ...deps, attempt });
}
