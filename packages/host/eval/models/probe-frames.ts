import type { ResolvedChatWire } from "@agentforge/core";
import { errorFromObject, type ParsedError } from "./probe-errors";

export type ProbeUsage = { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };

/** What one streamed frame says, in the terms a probe cares about. */
export type FrameInfo = {
  /** The model produced something: an answer token or a thinking token. */
  token: boolean;
  /** Answer text (not thinking) carried by this frame. */
  text?: string;
  usage?: ProbeUsage;
  finishReason?: string;
  /** The gateway refused inside a 200 stream. */
  error?: ParsedError;
};

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function usageOf(fields: Array<[keyof ProbeUsage, unknown]>): ProbeUsage | undefined {
  const usage: ProbeUsage = {};
  for (const [key, value] of fields) {
    const n = num(value);
    if (n !== undefined) {
      usage[key] = n;
    }
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function usageField(fields: Array<[keyof ProbeUsage, unknown]>): { usage?: ProbeUsage } {
  const usage = usageOf(fields);
  return usage ? { usage } : {};
}

function chatFrame(frame: Record<string, unknown>): FrameInfo {
  const choice = rec((Array.isArray(frame.choices) ? frame.choices : [])[0]);
  const delta = rec(choice.delta);
  const text = str(delta.content);
  const thinking = str(delta.reasoning_content) ?? str(delta.reasoning);
  const usage = rec(frame.usage);
  return {
    token: text !== undefined || thinking !== undefined,
    ...(text === undefined ? {} : { text }),
    ...usageField([
      ["inputTokens", usage.prompt_tokens],
      ["outputTokens", usage.completion_tokens],
      ["reasoningTokens", rec(usage.completion_tokens_details).reasoning_tokens],
    ]),
    ...(str(choice.finish_reason) === undefined ? {} : { finishReason: str(choice.finish_reason) as string }),
  };
}

function responsesFrame(frame: Record<string, unknown>): FrameInfo {
  const type = str(frame.type);
  if (type === "response.output_text.delta") {
    const text = str(frame.delta);
    return { token: text !== undefined, ...(text === undefined ? {} : { text }) };
  }
  if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
    return { token: str(frame.delta) !== undefined };
  }
  if (type === "response.completed" || type === "response.incomplete") {
    const response = rec(frame.response);
    const usage = rec(response.usage);
    const reason = str(rec(response.incomplete_details).reason) ?? str(response.status);
    return {
      token: false,
      ...usageField([
        ["inputTokens", usage.input_tokens],
        ["outputTokens", usage.output_tokens],
        ["reasoningTokens", rec(usage.output_tokens_details).reasoning_tokens],
      ]),
      ...(reason === undefined ? {} : { finishReason: reason }),
    };
  }
  if (type === "error") {
    return { token: false, error: errorFromObject(frame.error ?? frame) };
  }
  if (type === "response.failed") {
    return { token: false, error: errorFromObject(rec(frame.response).error) };
  }
  return { token: false };
}

function anthropicFrame(frame: Record<string, unknown>): FrameInfo {
  const type = str(frame.type);
  if (type === "content_block_delta") {
    const delta = rec(frame.delta);
    const text = delta.type === "text_delta" ? str(delta.text) : undefined;
    const thinking = delta.type === "thinking_delta" ? str(delta.thinking) : undefined;
    return { token: text !== undefined || thinking !== undefined, ...(text === undefined ? {} : { text }) };
  }
  if (type === "message_start") {
    const usage = rec(rec(frame.message).usage);
    return { token: false, ...usageField([["inputTokens", usage.input_tokens]]) };
  }
  if (type === "message_delta") {
    const stop = str(rec(frame.delta).stop_reason);
    return {
      token: false,
      ...usageField([["outputTokens", rec(frame.usage).output_tokens]]),
      ...(stop === undefined ? {} : { finishReason: stop }),
    };
  }
  if (type === "error") {
    return { token: false, error: errorFromObject(frame.error ?? frame) };
  }
  return { token: false };
}

function googleFrame(frame: Record<string, unknown>): FrameInfo {
  if (frame.error) {
    return { token: false, error: errorFromObject(frame.error) };
  }
  const candidate = rec((Array.isArray(frame.candidates) ? frame.candidates : [])[0]);
  const parts = Array.isArray(rec(candidate.content).parts) ? (rec(candidate.content).parts as unknown[]) : [];
  let text = "";
  let token = false;
  for (const part of parts) {
    const piece = rec(part);
    const value = str(piece.text);
    if (value === undefined) {
      continue;
    }
    token = true;
    if (piece.thought !== true) {
      text += value;
    }
  }
  const meta = rec(frame.usageMetadata);
  return {
    token,
    ...(text ? { text } : {}),
    ...usageField([
      ["inputTokens", meta.promptTokenCount],
      ["outputTokens", meta.candidatesTokenCount],
      ["reasoningTokens", meta.thoughtsTokenCount],
    ]),
    ...(str(candidate.finishReason) === undefined ? {} : { finishReason: str(candidate.finishReason) as string }),
  };
}

/** One parsed SSE frame, read the way its wire spells it. An in-stream `error` object is a refusal on every wire. */
export function interpretFrame(wire: ResolvedChatWire, frame: unknown): FrameInfo {
  const record = rec(frame);
  if (wire !== "google_generate_content" && record.error && typeof record.error === "object" && !record.type) {
    return { token: false, error: errorFromObject(record.error) };
  }
  if (wire === "responses") {
    return responsesFrame(record);
  }
  if (wire === "anthropic_messages") {
    return anthropicFrame(record);
  }
  if (wire === "google_generate_content") {
    return googleFrame(record);
  }
  return chatFrame(record);
}

/** Later numbers win field by field: Anthropic sends input tokens first and output tokens last. */
export function mergeUsage(current: ProbeUsage | undefined, next: ProbeUsage | undefined): ProbeUsage | undefined {
  if (!next) {
    return current;
  }
  return { ...(current ?? {}), ...next };
}

/**
 * Split an SSE text stream into its JSON `data:` payloads. Blank-line separated, CRLF or LF, a frame may
 * arrive across reads; `[DONE]` and anything that is not JSON are skipped.
 */
export function sseDataBlocks(buffer: string): { blocks: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  const blocks: string[] = [];
  for (const part of parts) {
    const data = part
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n")
      .trim();
    if (data && data !== "[DONE]") {
      blocks.push(data);
    }
  }
  return { blocks, rest };
}

export function parseFrame(block: string): unknown | undefined {
  try {
    return JSON.parse(block) as unknown;
  } catch {
    return undefined;
  }
}
