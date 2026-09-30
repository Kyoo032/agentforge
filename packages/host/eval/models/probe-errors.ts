import type { TokenField } from "./probe-request";

/** What a record keeps of a gateway's message: enough to read, never a body. */
export const MAX_ERROR_CHARS = 300;

export type ParsedError = { code?: string; message?: string };

/** One line, at most `max` characters, ending in an ellipsis when it was cut. */
export function flatten(text: string, max: number = MAX_ERROR_CHARS): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, Math.max(0, max - 1))}…`;
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() ? value : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/** The message and code out of an error object as OpenAI, Anthropic, Google and NewAPI gateways spell it. */
export function errorFromObject(value: unknown): ParsedError {
  if (typeof value === "string") {
    return value.trim() ? { message: value } : {};
  }
  if (!value || typeof value !== "object") {
    return {};
  }
  const record = value as Record<string, unknown>;
  const inner = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : record;
  const message =
    asText(inner.message) ??
    asText(record.message) ??
    asText(record.detail) ??
    (typeof record.error === "string" ? asText(record.error) : undefined);
  const code = asText(inner.code) ?? asText(inner.type) ?? asText(inner.status) ?? asText(record.code);
  return { ...(message === undefined ? {} : { message }), ...(code === undefined ? {} : { code }) };
}

/** An HTTP error body: JSON in one of the usual shapes, or the raw text. Empty when there is nothing. */
export function parseErrorBody(text: string): ParsedError {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = errorFromObject(JSON.parse(trimmed));
    if (parsed.message !== undefined || parsed.code !== undefined) {
      return parsed;
    }
    return {};
  } catch {
    return { message: trimmed };
  }
}

export type FailureKind = "token_floor" | "token_field" | "timeout" | "network" | "other";

const TOKEN_WORDS = /max(?:imum)?[_ ]?(?:output[_ ]|completion[_ ])?tokens|output tokens|maxOutputTokens/i;
const FLOOR_WORDS = /below|minimum|at least|>=|too small|greater than|must be (?:at least|greater|larger)/i;
const FLOOR_NUMBER = /(?:>=|at least|minimum(?: value)?(?: of| is)?|greater than or equal to)\s*(\d+)/i;

/**
 * Is this refusal about the output budget rather than the Thinking level? Two things are worth a second
 * try with a small change: a budget under the model's floor (reasoning models want 16 or more), and a
 * budget spelled the way the model does not take (`max_tokens` against `max_completion_tokens`).
 */
export function classifyFailure(input: {
  status: number;
  message: string;
  tokenField: TokenField;
}): { kind: FailureKind; tokenFloor?: number } {
  const message = input.message;
  if (input.status >= 400 && input.status < 500) {
    if (/max_completion_tokens/i.test(message)) {
      const refused =
        input.tokenField === "max_tokens"
          ? /unsupported|not supported|instead|\buse\b/i
          : /unrecogni[sz]ed|unknown|unsupported|not supported|unexpected/i;
      if (refused.test(message)) {
        return { kind: "token_field" };
      }
    }
    if (TOKEN_WORDS.test(message) && FLOOR_WORDS.test(message)) {
      const floor = FLOOR_NUMBER.exec(message)?.[1];
      return { kind: "token_floor", ...(floor === undefined ? {} : { tokenFloor: Number(floor) }) };
    }
  }
  return { kind: "other" };
}
