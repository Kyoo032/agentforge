/** Hard cap on a text extracted from any source (paste, URL, PDF, DOCX) before it is chunked. */
export const KNOWLEDGE_TEXT_MAX_CHARS = 2_000_000;

/** Marker appended when an extracted text is cut at `KNOWLEDGE_TEXT_MAX_CHARS`. */
export const KNOWLEDGE_TEXT_TRUNCATED = "\n\n[truncated: source exceeded the 2,000,000 character cap]";

/** Source names are rendered into the system prompt as `[n] <name>`, so one name is one line. */
export const SOURCE_NAME_MAX = 120;

/**
 * A source name is prompt surface: it is rendered as the `[n] <name>` citation marker inside the
 * trusted `## Retrieved sources` block. Multipart filenames, pasted names and remote `<title>` text
 * can all carry newlines, so a raw name could forge a second citation or a whole instruction line.
 *
 * This folds every name to a single short line: line breaks and tabs become spaces, whitespace runs
 * collapse, leading markdown control characters (`#`, `>`, `*`, `-`) are dropped so a name cannot
 * open a heading or a quote, and the result is capped. Returns "" when nothing survives; callers
 * pick their own fallback. Applied both when a source is indexed and again when it is rendered.
 */
export function sanitizeSourceName(name: string): string {
  const oneLine = name
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return oneLine
    .replace(/^[#>*\-\s]+/, "")
    .trim()
    .slice(0, SOURCE_NAME_MAX)
    .trim();
}

/** Cut an extracted text to the shared cap, never throwing: an over-long source is truncated, not lost. */
export function capKnowledgeText(text: string, max = KNOWLEDGE_TEXT_MAX_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}${KNOWLEDGE_TEXT_TRUNCATED}`;
}

/** OR of the first meaningful words, each quoted as an FTS5 string so keywords and operators are literal. */
export function knowledgeFtsQuery(query: string): string {
  return query
    .trim()
    .replace(/['"]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 8)
    .map((word) => `"${word}"`)
    .join(" OR ");
}

export function chunkKnowledgeText(text: string, size = 800): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) {
    return [];
  }
  const chunks: string[] = [];
  for (let i = 0; i < cleaned.length; i += size) {
    chunks.push(cleaned.slice(i, i + size));
  }
  return chunks;
}
