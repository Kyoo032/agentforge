/** Fast tools — no status line in chat; the answer carries the result. */
const SILENT_TOOLS = new Set(["calculator", "datetime"]);

const ACTIVITY_LABELS: Record<string, string> = {
  web_search: "Searching…",
  image_generate: "Creating image…",
  video_generate: "Creating video…",
  past_sessions: "Looking up past chats…",
};

export function showsToolActivity(toolKey: string): boolean {
  return !SILENT_TOOLS.has(toolKey);
}

/** Short in-progress line for chat. Falls back to a generic label for unknown tools. */
export function toolActivityLabel(toolKey: string): string {
  return ACTIVITY_LABELS[toolKey] ?? "Working…";
}
