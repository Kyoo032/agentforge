/** Currency-ish tokens that mark money even when the amount itself is written in words. */
const CURRENCY_TOKEN = /\bIDR\b|\bRp\b|\bUSD\b|\bEUR\b|[$€£¥%]/i;

/**
 * True when a brief carries figures worth sending to `/api/v1/finance/parse`.
 *
 * Any digit counts, which covers magnitude suffixes such as "18.4B", "7,9 M" and "900k";
 * a bare currency token counts on its own. A brief with neither is a plain request for a
 * narrative, so the studio asks for line items instead of guessing.
 */
export function briefLooksLikeFigures(text: string): boolean {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed === "") {
    return false;
  }
  return /\d/.test(trimmed) || CURRENCY_TOKEN.test(trimmed);
}

/**
 * The paste box after an upload hands its figures over.
 *
 * An empty box takes the uploaded text as it is. A box the owner already typed in keeps every
 * character of it and the upload lands on the next line, so two files (or a file after a paste)
 * parse as one list instead of one silently replacing the other.
 */
export function mergeFigures(current: string, added: string): string {
  const typed = typeof current === "string" ? current : "";
  const incoming = typeof added === "string" ? added.trim() : "";
  if (incoming === "") {
    return typed;
  }
  return typed.trim() === "" ? incoming : `${typed.replace(/\s+$/, "")}\n${incoming}`;
}

/** The host code for a parse that read no figures out of otherwise valid text. */
const NO_FIGURES_CODE = "invalid_finance";

function codeOf(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/** Join two sentences without doubling the full stop the first one may already carry. */
function joinSentences(first: string, second: string): string {
  return /[.!?…:]$/.test(first) ? `${first} ${second}` : `${first}. ${second}`;
}

/**
 * What to show when parsing the brief failed.
 *
 * A 422 `invalid_finance` says the parse found nothing but not what to do next, so the
 * add-line-items hint is appended. Any other failure (gateway 503, network) keeps the
 * host's own message alone — it already tells the owner what to fix.
 */
export function parseFailureMessage(error: unknown, fallback: string, addItemsHint: string): string {
  const raw = error instanceof Error ? error.message.trim() : "";
  const message = raw === "" ? fallback : raw;
  return codeOf(error) === NO_FIGURES_CODE ? joinSentences(message, addItemsHint) : message;
}
