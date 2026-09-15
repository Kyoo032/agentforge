const SAMPLING_KEYS = [
  "temperature",
  "top_p",
  "topP",
  "top_k",
  "topK",
  "presence_penalty",
  "frequency_penalty",
  "n",
] as const;

/** Strip vendor/ prefix; match packages/core/src/runtime/api-mode.ts bareModelId. */
export function bareModelId(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

export function isResponsesRequestUrl(url: unknown): boolean {
  return /\/responses(?:\?|$)/.test(String(url));
}

/**
 * Models that reject non-1 temperature (or mixing temperature with top_p).
 * Locked: Claude 5 family, Claude 4.x, claude-4…, OpenAI o1–o4, GPT-6 / Astra.
 */
export function temperatureMustBeOneOrOmitted(modelId: string): boolean {
  const id = bareModelId(modelId);
  if (/^o[1-4]/.test(id)) {
    return true;
  }
  if (/^claude-(?:opus|sonnet|haiku|fable)-5/.test(id)) {
    return true;
  }
  if (/^claude-(opus|sonnet|haiku)-4/.test(id)) {
    return true;
  }
  if (/^claude-4/.test(id)) {
    return true;
  }
  if (/^gpt-6/.test(id) || id.includes("astra")) {
    return true;
  }
  return false;
}

export type ModelRequestCheck = {
  ok: boolean;
  issues: string[];
  sanitized: unknown;
};

function dropSamplingKeys(next: Record<string, unknown>, issues: string[], reason: string): void {
  for (const key of SAMPLING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      delete next[key];
      issues.push(`omitted ${key} ${reason}`);
    }
  }
}

export function checkModelRequest(modelId: string, body: unknown, url?: unknown): ModelRequestCheck {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: true, issues: [], sanitized: body };
  }

  const next: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  const issues: string[] = [];
  const locked = temperatureMustBeOneOrOmitted(modelId);
  const responses = isResponsesRequestUrl(url);

  for (const key of SAMPLING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(next, key) && next[key] === null) {
      delete next[key];
      issues.push(`dropped null ${key}`);
    }
  }

  if (responses) {
    dropSamplingKeys(next, issues, "for /v1/responses");
  } else if (locked) {
    if (Object.prototype.hasOwnProperty.call(next, "temperature") && next.temperature !== 1) {
      const was = next.temperature;
      delete next.temperature;
      issues.push(`omitted temperature (was ${JSON.stringify(was)}) for locked model`);
    }
    if (Object.prototype.hasOwnProperty.call(next, "top_p")) {
      delete next.top_p;
      issues.push("omitted top_p for locked model");
    }
    if (Object.prototype.hasOwnProperty.call(next, "topP")) {
      delete next.topP;
      issues.push("omitted topP for locked model");
    }
    if (Object.prototype.hasOwnProperty.call(next, "n")) {
      delete next.n;
      issues.push("omitted n for locked model");
    }
  }

  return { ok: issues.length === 0, issues, sanitized: next };
}

export function sanitizeGatewayRequestBody(body: unknown, modelId: string, url?: unknown): unknown {
  return checkModelRequest(modelId, body, url).sanitized;
}

/**
 * Zero retention: never ask the vendor to store the turn.
 * OpenRouter additionally gets provider.zdr — only when the saved URL is OpenRouter.
 */
export function applyZeroRetention(body: unknown, baseUrl: string): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return body;
  }
  const next: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  next.store = false;
  delete next.previous_response_id;
  return next;
}

/** Cap how long we wait for a non-OK body so a held-open 403 cannot wedge Chat. */
export const GATEWAY_ERROR_BODY_MS = 2_000;

export async function readHttpErrorBody(response: Response, timeoutMs = GATEWAY_ERROR_BODY_MS): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const decoder = new TextDecoder();
  let text = "";
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      const remaining = Math.max(1, timeoutMs - (Date.now() - started));
      const result = await Promise.race([
        reader.read(),
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
          setTimeout(() => resolve({ done: true }), remaining);
        }),
      ]);
      if (result.done) {
        break;
      }
      if (result.value) {
        text += decoder.decode(result.value, { stream: true });
        if (text.length >= 8_000) {
          break;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

/**
 * Prefer the gateway's inner error message; always make the HTTP status discoverable.
 */
/** The upstream sentence plus the code the gateway meant, for the log and for classification. */
export function parseGatewayHttpDetail(status: number, bodyText: string): { message: string; code: number } {
  const trimmed = typeof bodyText === "string" ? bodyText.trim() : "";
  let message = "";
  let statusCode: number | undefined;

  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "string") {
        message = parsed;
      } else if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const err = record.error;
        if (typeof err === "string") {
          message = err;
        } else if (err && typeof err === "object") {
          const errRec = err as Record<string, unknown>;
          if (typeof errRec.message === "string") {
            message = errRec.message;
          }
          if (typeof errRec.status_code === "number") {
            statusCode = errRec.status_code;
          }
        }
        if (!message && typeof record.message === "string") {
          message = record.message;
        }
        if (typeof record.status_code === "number") {
          statusCode = record.status_code;
        }
      }
    } catch {
      message = trimmed;
    }
  }

  if (!message) {
    message = `Gateway request failed with HTTP ${status}`;
  }

  const code = statusCode ?? status;
  if (!/status_code\s*=/i.test(message) && !new RegExp(`\\b${code}\\b`).test(message)) {
    return { message: `${message} (status_code=${code})`, code };
  }
  return { message, code };
}

/** The upstream sentence as-is. User-facing paths go through `gatewayHttpFailure` instead. */
export function parseGatewayHttpError(status: number, bodyText: string): string {
  return parseGatewayHttpDetail(status, bodyText).message;
}
