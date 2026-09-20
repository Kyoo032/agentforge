import { ApiError } from "../../errors";

const QUEUE_ORIGIN = "https://queue.fal.run";

/**
 * Origins the queue handle is allowed to name (docs/internal/security-owasp-2026-09.md, A10-3).
 *
 * `status_url` and `response_url` come out of FAL's own JSON, and the two polls below carry the FAL
 * API key. Fetching them unchecked meant a hostile or compromised upstream — or anything that could
 * shape that response — could point the server at an arbitrary URL WITH the key attached: a
 * credential leak and an SSRF in one. FAL answers with `queue.fal.run` handles and, for some
 * models, `fal.run`; anything else is refused rather than followed.
 */
const POLL_ORIGINS: readonly string[] = [QUEUE_ORIGIN, "https://fal.run"];

/** No timeout at all used to be the rule here, so a black-holed upstream hung the job forever. */
const FAL_TIMEOUT_MS = 60_000;

/**
 * The queue handle, checked before anything is sent to it.
 *
 * `redirect: "manual"` for the same reason as the origin check: a 302 would carry the key onward to
 * a host that never passed it.
 */
function assertQueueUrl(url: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError("tool_failed", `FAL returned a ${field} that is not a URL`, 502);
  }
  if (!POLL_ORIGINS.includes(parsed.origin)) {
    // The rejected origin is deliberately not echoed: it is attacker-influenced text.
    throw new ApiError("tool_failed", `FAL returned a ${field} outside its own queue`, 502);
  }
  return parsed.toString();
}

function falRequestInit(apiKey: string): RequestInit {
  return {
    headers: falHeaders(apiKey),
    redirect: "manual",
    signal: AbortSignal.timeout(FAL_TIMEOUT_MS),
  };
}

export type FalQueueOptions = {
  endpoint: string;
  apiKey: string;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  pollMs?: number;
  maxPolls?: number;
};

function falHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Key ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readError(body: Record<string, unknown>, fallback: string): string {
  if (typeof body.error === "string" && body.error.trim()) {
    return body.error;
  }
  if (typeof body.detail === "string" && body.detail.trim()) {
    return body.detail;
  }
  return fallback;
}

export function falResultReady(body: Record<string, unknown>): boolean {
  return Boolean(body.images || body.image || body.video || body.data);
}

export async function runFalQueue(options: FalQueueOptions): Promise<Record<string, unknown>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const endpoint = options.endpoint.replace(/^\/+/, "");
  const submit = await fetchImpl(`${QUEUE_ORIGIN}/${endpoint}`, {
    ...falRequestInit(options.apiKey),
    method: "POST",
    body: JSON.stringify(options.payload),
  });
  const submitted = asRecord(await submit.json().catch(() => ({})));
  if (!submit.ok) {
    throw new ApiError("tool_failed", readError(submitted, `FAL returned HTTP ${submit.status}`), 502);
  }
  if (falResultReady(submitted)) {
    return submitted;
  }
  const rawStatusUrl = submitted.status_url;
  const rawResponseUrl = submitted.response_url;
  if (typeof rawStatusUrl !== "string" || typeof rawResponseUrl !== "string") {
    throw new ApiError("tool_failed", "FAL did not return a queue handle", 502);
  }
  // Both are checked here, before the first poll, so a bad `response_url` is refused up front
  // rather than after a minute of polling.
  const statusUrl = assertQueueUrl(rawStatusUrl, "status_url");
  const responseUrl = assertQueueUrl(rawResponseUrl, "response_url");
  const maxPolls = options.maxPolls ?? 60;
  const pollMs = options.pollMs ?? 1_000;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const statusRes = await fetchImpl(statusUrl, falRequestInit(options.apiKey));
    const statusBody = asRecord(await statusRes.json().catch(() => ({})));
    const status = String(statusBody.status ?? "");
    if (status === "COMPLETED") {
      const resultRes = await fetchImpl(responseUrl, falRequestInit(options.apiKey));
      const result = asRecord(await resultRes.json().catch(() => ({})));
      if (!resultRes.ok) {
        throw new ApiError("tool_failed", readError(result, `FAL result HTTP ${resultRes.status}`), 502);
      }
      return result;
    }
    if (status === "FAILED" || status === "CANCELLED") {
      throw new ApiError("tool_failed", readError(statusBody, `FAL job ${status.toLowerCase()}`), 502);
    }
    await wait(pollMs);
  }
  throw new ApiError("tool_failed", "FAL job timed out", 504);
}

export function falImageUrl(body: Record<string, unknown>): string | undefined {
  const images = body.images;
  if (Array.isArray(images) && images[0] && typeof images[0] === "object") {
    const url = (images[0] as { url?: unknown }).url;
    if (typeof url === "string" && url.trim()) {
      return url.trim();
    }
  }
  if (typeof body.image === "string" && body.image.trim()) {
    return body.image.trim();
  }
  if (typeof body.url === "string" && body.url.trim()) {
    return body.url.trim();
  }
  return undefined;
}

export function falVideoUrl(body: Record<string, unknown>): string | undefined {
  const video = body.video;
  if (typeof video === "string" && video.trim()) {
    return video.trim();
  }
  if (video && typeof video === "object") {
    const url = (video as { url?: unknown }).url;
    if (typeof url === "string" && url.trim()) {
      return url.trim();
    }
  }
  return undefined;
}
