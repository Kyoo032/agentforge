import { ApiError } from "../../errors";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type GatewayMediaOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
  imageUrl?: string;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  pollMs?: number;
  maxPolls?: number;
};

function originFrom(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function gatewayHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": BROWSER_UA,
  };
}

export function httpStatusForGatewayFailure(status: number): number {
  if (status === 401 || status === 403 || status === 404 || status === 429 || status === 503) {
    return status;
  }
  return 502;
}

export function formatVideoGatewayFailure(status: number, detail: string): string {
  if (status === 503) {
    return `${detail} This video model has no live gateway channel (HTTP 503). Prefer grok-imagine-video; other catalog ids often fail on auto.`;
  }
  if (status === 401 || status === 403) {
    return `${detail} Gateway rejected the API key (HTTP ${status}). Check Settings.`;
  }
  return detail;
}

export function studioVideoFailureStatus(message: string): number {
  if (/HTTP 503/i.test(message) || /no live gateway channel/i.test(message)) {
    return 503;
  }
  if (/HTTP 401|HTTP 403|rejected the API key/i.test(message)) {
    return 401;
  }
  return 400;
}

export function readGatewayError(body: Record<string, unknown>, fallback: string): string {
  const error = body.error;
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  if (typeof body.message === "string" && body.message.trim()) {
    return body.message.trim();
  }
  return fallback;
}

export function openaiImageSize(aspectRatio?: string): string {
  if (aspectRatio === "landscape") {
    return "1536x1024";
  }
  if (aspectRatio === "portrait") {
    return "1024x1536";
  }
  return "1024x1024";
}

export function gatewayVideoSize(aspectRatio?: string): string {
  if (aspectRatio === "9:16") {
    return "720x1280";
  }
  if (aspectRatio === "1:1") {
    return "1024x1024";
  }
  return "1280x720";
}

export function parseGatewayImage(body: Record<string, unknown>): string | undefined {
  const data = body.data;
  if (Array.isArray(data)) {
    const first = asRecord(data[0]);
    const url = asString(first.url) ?? asString(asRecord(first.file_output).public_url);
    if (url) {
      return url;
    }
    const b64 = asString(first.b64_json);
    if (b64) {
      return `data:image/png;base64,${b64}`;
    }
  } else if (data && typeof data === "object") {
    const record = asRecord(data);
    const nestedData = record.data;
    const nestedFirst = Array.isArray(nestedData) ? asRecord(nestedData[0]) : {};
    const url =
      asString(record.result_url) ??
      asString(record.url) ??
      asString(asRecord(record.file_output).public_url) ??
      asString(nestedFirst.url) ??
      asString(asRecord(nestedFirst.file_output).public_url);
    if (url) {
      return url;
    }
    const b64 = asString(record.b64_json) ?? asString(nestedFirst.b64_json);
    if (b64) {
      return `data:image/png;base64,${b64}`;
    }
  }
  return asString(body.url) ?? asString(body.result_url);
}

export function videoTaskId(body: Record<string, unknown>): string | undefined {
  const data = asRecord(body.data);
  return asString(body.task_id) ?? asString(body.id) ?? asString(data.task_id) ?? asString(data.id);
}

export function extractGatewayVideoUrl(body: Record<string, unknown>): string | undefined {
  const data = asRecord(body.data);
  const nested = asRecord(data.data);
  const metadata = asRecord(body.metadata ?? data.metadata);
  const video = body.video;
  return (
    asString(data.result_url) ??
    asString(data.url) ??
    asString(body.url) ??
    asString(nested.url) ??
    asString(metadata.url) ??
    asString(asRecord(video).url) ??
    asString(asRecord(video).public_url) ??
    asString(video)
  );
}

function mediaStatus(body: Record<string, unknown>): string {
  const data = asRecord(body.data);
  return String(data.status ?? body.status ?? "").trim();
}

function isMediaSuccess(status: string): boolean {
  return /^(completed|succeeded|success)$/i.test(status);
}

function isMediaFailure(status: string): boolean {
  return /^(failed|failure|error|cancelled|canceled)$/i.test(status);
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

const IMAGE_TIMEOUT_MESSAGE =
  "Gateway image request timed out. The gateway may already have billed and generated the image — do not retry immediately.";

function isPollEndpointMissing(status: number, body: Record<string, unknown>): boolean {
  if (status < 400 || status >= 500) {
    return false;
  }
  const message = readGatewayError(body, "").toLowerCase();
  return status === 404 || /invalid url|not found|no such|unknown task/i.test(message);
}

export async function generateGatewayImage(options: GatewayMediaOptions): Promise<{ url: string; model: string }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const payload: Record<string, unknown> = {
    model: options.model,
    prompt: options.prompt,
    size: openaiImageSize(options.aspectRatio),
  };
  if (/gpt-image/i.test(options.model)) {
    payload.quality = "medium";
  }
  if (options.imageUrl) {
    payload.image = options.imageUrl;
  }
  let response: Response;
  try {
    response = await fetchImpl(`${originFrom(options.baseUrl)}/images/generations`, {
      method: "POST",
      headers: gatewayHeaders(options.apiKey),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ApiError("tool_failed", IMAGE_TIMEOUT_MESSAGE, 504);
    }
    throw error;
  }
  const body = asRecord(await response.json().catch(() => ({})));
  const immediate = parseGatewayImage(body);
  if (immediate) {
    return { url: immediate, model: options.model };
  }
  const createdStatus = mediaStatus(body);
  if (isMediaFailure(createdStatus)) {
    throw new ApiError(
      "tool_failed",
      readGatewayError(body, asString(asRecord(body.data).fail_reason) ?? "Gateway image job failed"),
      502,
    );
  }
  const taskId = videoTaskId(body);
  if (taskId) {
    const maxPolls = options.maxPolls ?? 90;
    const pollMs = options.pollMs ?? 2_000;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      let statusRes: Response;
      try {
        statusRes = await fetchImpl(`${originFrom(options.baseUrl)}/images/generations/${taskId}`, {
          headers: gatewayHeaders(options.apiKey),
          signal: AbortSignal.timeout(180_000),
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new ApiError("tool_failed", IMAGE_TIMEOUT_MESSAGE, 504);
        }
        throw error;
      }
      const statusBody = asRecord(await statusRes.json().catch(() => ({})));
      const url = parseGatewayImage(statusBody);
      const status = mediaStatus(statusBody);
      if (url && (isMediaSuccess(status) || status.length === 0)) {
        return { url, model: options.model };
      }
      if (isPollEndpointMissing(statusRes.status, statusBody)) {
        throw new ApiError(
          "tool_failed",
          "Gateway image poll endpoint not found — async status lookup is unavailable for this task",
          502,
        );
      }
      if (isMediaFailure(status)) {
        throw new ApiError(
          "tool_failed",
          readGatewayError(statusBody, asString(asRecord(statusBody.data).fail_reason) ?? "Gateway image job failed"),
          502,
        );
      }
      if (!statusRes.ok && !url) {
        throw new ApiError(
          "tool_failed",
          readGatewayError(statusBody, `Gateway images poll returned HTTP ${statusRes.status}`),
          502,
        );
      }
      await wait(pollMs);
    }
    throw new ApiError("tool_failed", "Gateway image job timed out", 504);
  }
  if (!response.ok) {
    throw new ApiError("tool_failed", readGatewayError(body, `Gateway images returned HTTP ${response.status}`), 502);
  }
  throw new ApiError("tool_failed", "Gateway returned no image data", 502);
}

export async function generateGatewayVideo(options: GatewayMediaOptions): Promise<{ url: string; model: string }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const payload: Record<string, unknown> = {
    model: options.model,
    prompt: options.prompt,
    duration: 5,
    size: gatewayVideoSize(options.aspectRatio),
  };
  if (options.imageUrl) {
    payload.image = options.imageUrl;
  }
  const created = await fetchImpl(`${originFrom(options.baseUrl)}/video/generations`, {
    method: "POST",
    headers: gatewayHeaders(options.apiKey),
    body: JSON.stringify(payload),
  });
  const createdBody = asRecord(await created.json().catch(() => ({})));
  if (!created.ok) {
    throw new ApiError(
      "tool_failed",
      formatVideoGatewayFailure(
        created.status,
        readGatewayError(createdBody, `Gateway video returned HTTP ${created.status}`),
      ),
      httpStatusForGatewayFailure(created.status),
    );
  }
  const immediate = extractGatewayVideoUrl(createdBody);
  const createdStatus = mediaStatus(createdBody);
  if (immediate && (isMediaSuccess(createdStatus) || createdStatus.length === 0)) {
    return { url: immediate, model: options.model };
  }
  const taskId = videoTaskId(createdBody);
  if (!taskId) {
    throw new ApiError("tool_failed", "Gateway video did not return a task id", 502);
  }
  const maxPolls = options.maxPolls ?? 90;
  const pollMs = options.pollMs ?? 2_000;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const statusRes = await fetchImpl(`${originFrom(options.baseUrl)}/video/generations/${taskId}`, {
      headers: gatewayHeaders(options.apiKey),
    });
    const statusBody = asRecord(await statusRes.json().catch(() => ({})));
    const status = mediaStatus(statusBody);
    const url = extractGatewayVideoUrl(statusBody);
    if (url && (isMediaSuccess(status) || status.length === 0)) {
      return { url, model: options.model };
    }
    if (isMediaFailure(status) || !statusRes.ok) {
      throw new ApiError(
        "tool_failed",
        readGatewayError(statusBody, asString(asRecord(statusBody.data).fail_reason) ?? "Gateway video job failed"),
        502,
      );
    }
    await wait(pollMs);
  }
  throw new ApiError("tool_failed", "Gateway video job timed out", 504);
}
