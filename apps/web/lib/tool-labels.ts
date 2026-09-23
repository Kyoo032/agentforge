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

/**
 * A readable one-line gist for the tool row. This is the *summary* — the row is 12px and must
 * stay a single line — so the shape matters more than the content: a past-sessions call whose
 * output is `{"success":true,"sessions":[]}` should read as "no sessions", not as raw JSON.
 * Anything we do not recognise is dropped to a capped, unquoted string rather than dumped.
 */
function gist(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // A list result: say how many, not what they are.
    for (const key of ["sessions", "results", "items", "matches", "rows"]) {
      const list = record[key];
      if (Array.isArray(list)) {
        return list.length === 0 ? "none" : `${list.length} found`;
      }
    }
    for (const key of ["result", "expression", "query", "iso", "text", "message", "answer"]) {
      if (key in record) {
        return gist(record[key]);
      }
    }
    if ("success" in record && record.success === true) {
      return "ok";
    }
    // A single named argument (`{"action":"list"}`) is the argument's value, not "1 field".
    const keys = Object.keys(record);
    if (keys.length === 1) {
      const only = record[keys[0]!];
      if (typeof only === "string" || typeof only === "number" || typeof only === "boolean") {
        return gist(only);
      }
    }
    return keys.length === 0 ? "empty" : `${keys.length} field${keys.length === 1 ? "" : "s"}`;
  }
  return "";
}

export function toolCallSummary(toolKey: string, input?: unknown, output?: unknown): string {
  const label = toolDoneLabel(toolKey);
  const out = gist(output);
  const inn = gist(input);
  if (out && inn) {
    return `${label} · ${inn} → ${out}`;
  }
  if (out) {
    return `${label} · ${out}`;
  }
  if (inn) {
    return `${label} · ${inn}`;
  }
  return label;
}
