import { ApiError } from "../../errors";

const QUEUE_ORIGIN = "https://queue.fal.run";

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
    method: "POST",
    headers: falHeaders(options.apiKey),
    body: JSON.stringify(options.payload),
  });
  const submitted = asRecord(await submit.json().catch(() => ({})));
  if (!submit.ok) {
    throw new ApiError("tool_failed", readError(submitted, `FAL returned HTTP ${submit.status}`), 502);
  }
  if (falResultReady(submitted)) {
    return submitted;
  }
  const statusUrl = submitted.status_url;
  const responseUrl = submitted.response_url;
  if (typeof statusUrl !== "string" || typeof responseUrl !== "string") {
    throw new ApiError("tool_failed", "FAL did not return a queue handle", 502);
  }
  const maxPolls = options.maxPolls ?? 60;
  const pollMs = options.pollMs ?? 1_000;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const statusRes = await fetchImpl(statusUrl, { headers: falHeaders(options.apiKey) });
    const statusBody = asRecord(await statusRes.json().catch(() => ({})));
    const status = String(statusBody.status ?? "");
    if (status === "COMPLETED") {
      const resultRes = await fetchImpl(responseUrl, { headers: falHeaders(options.apiKey) });
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
