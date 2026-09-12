import { ApiError } from "../errors";
import { bareModelId } from "../models/request-constraints";
import type { ReasoningEffort } from "../models/reasoning-effort";
import { usesResponsesApi } from "./api-mode";

/**
 * Send-time Chat wire on the saved Endpoint URL. Probe stays GET /v1/models.
 * Catalog id does not lock the POST path.
 */
export const CHAT_WIRES = ["auto", "chat_completions", "responses", "anthropic_messages"] as const;
export type ChatWire = (typeof CHAT_WIRES)[number];
export type ResolvedChatWire = Exclude<ChatWire, "auto">;

export const CHAT_WIRE_LABELS: Record<ChatWire, string> = {
  auto: "Auto",
  chat_completions: "Completions",
  responses: "Responses",
  anthropic_messages: "Messages",
};

const WIRES = new Set<string>(CHAT_WIRES);

export const ANTHROPIC_API_VERSION = "2023-06-01";
/** Hard cap on thinking + text for Anthropic Messages. */
export const ANTHROPIC_MESSAGES_MAX_TOKENS = 16_384;

export type AnthropicOutputEffort = Exclude<ReasoningEffort, "none">;

export function isChatWire(value: unknown): value is ChatWire {
  return typeof value === "string" && WIRES.has(value);
}

export function readOptionalChatWire(body: unknown): ChatWire {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "auto";
  }
  const record = body as { wire?: unknown };
  if (record.wire === undefined || record.wire === null || record.wire === "") {
    return "auto";
  }
  if (typeof record.wire !== "string") {
    throw new ApiError("invalid_request", "wire must be auto, chat_completions, responses, or anthropic_messages", 400);
  }
  const normalized = record.wire.trim().toLowerCase();
  if (!isChatWire(normalized)) {
    throw new ApiError("invalid_request", "wire must be auto, chat_completions, responses, or anthropic_messages", 400);
  }
  return normalized;
}

/**
 * Claude 5 family plus Opus 4.7 / 4.8 → Anthropic Messages.
 * Haiku 4.5 / Sonnet 4.6 and other Claude 4.x stay Completions.
 */
export function usesAnthropicMessages(modelId: string): boolean {
  const id = bareModelId(modelId);
  if (/^claude-(?:opus|sonnet|haiku|fable)-5(?:$|[^0-9])/.test(id)) {
    return true;
  }
  return /^claude-opus-4[.-][78](?:$|[^0-9])/.test(id);
}

/**
 * Product Chat always sends `auto`. GPT-5 / o-series → Responses;
 * Claude 5 / Opus 4.7 / 4.8 → Messages; else Completions.
 * Explicit wires stay for host/tests.
 */
export function resolveChatWire(wire: ChatWire | undefined, modelId: string): ResolvedChatWire {
  if (!wire || wire === "auto") {
    if (usesResponsesApi(modelId)) {
      return "responses";
    }
    if (usesAnthropicMessages(modelId)) {
      return "anthropic_messages";
    }
    return "chat_completions";
  }
  return wire;
}

export function chatWireHeaders(
  wire: ResolvedChatWire,
  apiKey: string,
): Record<string, string> {
  if (wire === "anthropic_messages") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

export function isAnthropicMessagesUrl(url: unknown): boolean {
  const value = String(url);
  if (/\/chat\/completions(?:\?|$)/.test(value)) {
    return false;
  }
  return /\/messages(?:\?|$)/.test(value);
}

/** 404 / unknown-url only. A thinking 400 is not a missing wire. */
export function isMissingWireEndpoint(message: string): boolean {
  return (
    /(404|not found|unknown url|does not exist|no such endpoint)/i.test(message) ||
    /invalid url.*(responses|messages|chat\/completions)/i.test(message)
  );
}

export function shouldFallbackFromMessages(message: string): boolean {
  return isMissingWireEndpoint(message);
}

/**
 * `none` has no effort string — thinking is sent as `{ type: "disabled" }`.
 * Every other kernel string is passed through, including `ultra` (do not remap ultra → max).
 */
export function toAnthropicOutputEffort(effort: ReasoningEffort): AnthropicOutputEffort | undefined {
  if (effort === "none") {
    return undefined;
  }
  return effort;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Claude 5 Messages body: adaptive thinking + `output_config.effort`.
 * Never `thinking: { type: "enabled", budget_tokens }`, never `reasoning_effort`, never `store`.
 * Omitting `thinking` turns adaptive on — none must send `disabled`.
 */
export function applyAnthropicMessagesBody(body: unknown, effort: ReasoningEffort): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return body;
  }
  const next: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  delete next.reasoning_effort;
  delete next.reasoningEffort;
  delete next.store;
  delete next.previous_response_id;
  delete next.provider;

  if (effort === "none") {
    next.thinking = { type: "disabled" };
    delete next.output_config;
  } else {
    const mapped = toAnthropicOutputEffort(effort);
    next.thinking = { type: "adaptive" };
    const existing = asRecord(next.output_config) ?? {};
    const outputConfig: Record<string, unknown> = { ...existing };
    delete outputConfig.adaptive;
    if (mapped) {
      outputConfig.effort = mapped;
    }
    next.output_config = outputConfig;
  }

  const thinking = asRecord(next.thinking);
  if (thinking) {
    delete thinking.budget_tokens;
    delete thinking.budgetTokens;
    if (thinking.type === "enabled") {
      thinking.type = effort === "none" ? "disabled" : "adaptive";
    }
    next.thinking = thinking;
  }

  next.max_tokens = ANTHROPIC_MESSAGES_MAX_TOKENS;

  return next;
}
