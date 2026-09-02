/** Fast tools still show a completed row; they skip the long "Working…" spinner. */
const COMPACT_TOOLS = new Set(["calculator", "datetime"]);

const ACTIVITY_LABELS: Record<string, string> = {
  web_search: "Searching…",
  image_generate: "Creating image…",
  video_generate: "Creating video…",
  past_sessions: "Looking up past chats…",
  calculator: "Calculating…",
  datetime: "Reading the clock…",
};

const DONE_LABELS: Record<string, string> = {
  web_search: "Search",
  image_generate: "Image",
  video_generate: "Video",
  past_sessions: "Past chats",
  calculator: "Calculator",
  datetime: "Clock",
};

export function showsToolActivity(_toolKey: string): boolean {
  return true;
}

export function showsToolSpinner(toolKey: string): boolean {
  return !COMPACT_TOOLS.has(toolKey);
}

export function toolActivityLabel(toolKey: string): string {
  return ACTIVITY_LABELS[toolKey] ?? "Working…";
}

export function toolDoneLabel(toolKey: string): string {
  return DONE_LABELS[toolKey] ?? toolKey.replace(/_/g, " ");
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
