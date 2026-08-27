import type { RuntimeEvent } from "./types";

function asText(part: Record<string, unknown>): string {
  if (typeof part.textDelta === "string" && part.textDelta.length > 0) {
    return part.textDelta;
  }
  if (typeof part.text === "string" && part.text.length > 0) {
    return part.text;
  }
  if (typeof part.delta === "string" && part.delta.length > 0) {
    return part.delta;
  }
  return "";
}

function toolKey(part: Record<string, unknown>): string {
  if (typeof part.toolName === "string" && part.toolName.length > 0) {
    return part.toolName;
  }
  if (typeof part.tool_name === "string" && part.tool_name.length > 0) {
    return part.tool_name;
  }
  return "tool";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "The model stream failed";
}

export function mapStreamPart(part: unknown): RuntimeEvent | undefined {
  if (typeof part !== "object" || part === null) {
    return undefined;
  }
  const record = part as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const text = asText(record);

  if ((type === "text-delta" || type === "text") && text) {
    return { type: "assistant.delta", text };
  }
  if ((type === "reasoning" || type === "reasoning-delta") && text) {
    return { type: "assistant.thinking", text };
  }
  if (type === "tool-call" || type === "tool-call-streaming-start") {
    return { type: "tool.started", toolKey: toolKey(record), input: record.args ?? record.input ?? null };
  }
  if (type === "tool-result") {
    return { type: "tool.completed", toolKey: toolKey(record), output: record.result ?? record.output ?? null };
  }
  if (type === "error") {
    return { type: "run.failed", message: errorMessage(record.error) };
  }
  return undefined;
}
