import { t } from "@/lib/i18n";

/** Fast tools still show a completed row; they skip the long "Working…" spinner. */

const COMPACT_TOOLS = new Set(["calculator", "datetime"]);

const ACTIVITY_KEYS: Record<string, string> = {
  web_search: "chat.tool.searching",
  image_generate: "chat.tool.creatingImage",
  video_generate: "chat.tool.creatingVideo",
  past_sessions: "chat.tool.pastChats",
  calculator: "chat.tool.calculating",
  datetime: "chat.tool.clock",
};

const DONE_KEYS: Record<string, string> = {
  web_search: "chat.tool.search",
  image_generate: "chat.tool.image",
  video_generate: "chat.tool.video",
  past_sessions: "chat.tool.pastSessions",
  calculator: "chat.tool.calculator",
  datetime: "chat.tool.datetime",
};

export function showsToolActivity(_toolKey: string): boolean {
  return true;
}

export function showsToolSpinner(toolKey: string): boolean {
  return !COMPACT_TOOLS.has(toolKey);
}

export function toolActivityLabel(toolKey: string): string {
  return t(ACTIVITY_KEYS[toolKey] ?? "chat.tool.working");
}

export function toolDoneLabel(toolKey: string): string {
  const key = DONE_KEYS[toolKey];
  return key ? t(key) : toolKey.replace(/_/g, " ");
}

function previewValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value.length > 80 ? `${value.slice(0, 79).trimEnd()}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("result" in record) {
      return previewValue(record.result);
    }
    if ("expression" in record) {
      return previewValue(record.expression);
    }
    if ("iso" in record) {
      return previewValue(record.iso);
    }
    if ("query" in record) {
      return previewValue(record.query);
    }
    try {
      const raw = JSON.stringify(value);
      return raw.length > 80 ? `${raw.slice(0, 79)}…` : raw;
    } catch {
      return "";
    }
  }
  return "";
}

export function toolCallSummary(toolKey: string, input?: unknown, output?: unknown): string {
  const out = previewValue(output);
  const inn = previewValue(input);
  if (out && inn) {
    return `${toolDoneLabel(toolKey)} · ${inn} → ${out}`;
  }
  if (out) {
    return `${toolDoneLabel(toolKey)} · ${out}`;
  }
  if (inn) {
    return `${toolDoneLabel(toolKey)} · ${inn}`;
  }
  return toolDoneLabel(toolKey);
}
