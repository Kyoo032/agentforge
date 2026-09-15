import { parseAppLocale, type AppLocale } from "@agentforge/core";

const DEFAULT_TITLES: Record<AppLocale, string> = {
  en: "New thread",
  id: "Percakapan baru",
};

/** English default kept exported for callers that compare against the historical constant. */
export const DEFAULT_THREAD_TITLE = DEFAULT_TITLES.en;

/** Every locale's untouched-thread title. A stored row may carry any of them. */
export const DEFAULT_THREAD_TITLES: readonly string[] = Object.values(DEFAULT_TITLES);

/** Title a freshly created thread carries until the first user message renames it. */
export function defaultThreadTitle(locale: AppLocale): string {
  return DEFAULT_TITLES[parseAppLocale(locale)];
}

/** True when the thread has not been renamed yet, in any locale. */
export function isDefaultThreadTitle(title: string): boolean {
  return DEFAULT_THREAD_TITLES.includes(title);
}

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
