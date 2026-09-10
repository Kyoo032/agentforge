export const DEFAULT_THREAD_TITLE = "New thread";
/** Caller-supplied titles (POST /threads) are trimmed to this length; derived titles use MAX_TITLE below. */
export const THREAD_TITLE_MAX = 200;

const MAX_TITLE = 48;

export function titleFromParts(parts: unknown): string | null {
  let text = "";
  if (typeof parts === "string") {
    text = parts;
  } else if (Array.isArray(parts)) {
    for (const part of parts) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "text" && "text" in part && typeof (part as { text: unknown }).text === "string") {
        text = (part as { text: string }).text;
        break;
      }
    }
  }
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }
  if (compact.length <= MAX_TITLE) {
    return compact;
  }
  return `${compact.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}
