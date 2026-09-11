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

/** Characters a chunk aims for. A chunk is never longer; it is shorter when a boundary lands early. */
export const CHUNK_TARGET = 800;

/** Characters the next chunk repeats from the previous one, so a fact astride a split is still whole. */
export const CHUNK_OVERLAP = 120;

/** Split points are looked for in the last fifth of a window only, so chunks stay near the target. */
const BOUNDARY_WINDOW = 0.2;

/** How far back a page marker can pull a split. A marker is ~20 characters, so this is generous. */
const MARKER_LOOKBACK = 48;

const PAGE_MARKER = /<!-- page \d+ -->/g;

/**
 * Where a chunk may end, best first. A markdown heading starts the *next* chunk (so a section keeps
 * its title), a blank line and a sentence end close the current one, and a bare space is the last
 * resort before a hard cut — which is what keeps a split out of the middle of a word.
 */
const SPLIT_RULES: Array<{ pattern: RegExp; at: (match: RegExpExecArray) => number }> = [
  { pattern: /\n#{1,6} /, at: (match) => match.index + 1 },
  { pattern: /\n[ \t]*\n/, at: (match) => match.index + match[0].length },
  { pattern: /[.?!]["')\]]?\s/, at: (match) => match.index + match[0].length },
  { pattern: /\s/, at: (match) => match.index + 1 },
];

/** Offset of the last match of `pattern` inside `region`, or null. Deterministic, left to right. */
function lastMatchOffset(
  region: string,
  pattern: RegExp,
  at: (match: RegExpExecArray) => number,
): number | null {
  const scanner = new RegExp(pattern.source, "g");
  let found: number | null = null;
  let match = scanner.exec(region);
  while (match !== null) {
    found = at(match);
    if (match.index === scanner.lastIndex) {
      scanner.lastIndex += 1;
    }
    match = scanner.exec(region);
  }
  return found;
}

/** The best boundary in the tail of `[start, end)`, or `end` when the window holds none. */
function findSplit(text: string, start: number, end: number): number {
  const from = start + Math.floor((end - start) * (1 - BOUNDARY_WINDOW));
  const region = text.slice(from, end);
  for (const rule of SPLIT_RULES) {
    const offset = lastMatchOffset(region, rule.pattern, rule.at);
    if (offset !== null && from + offset > start && from + offset < end) {
      return from + offset;
    }
  }
  return end;
}

/**
 * A `<!-- page N -->` marker names the page the text after it came from, so a split must never cut
 * it in half or strand it at the end of a chunk. Both cases move the split back to the marker start.
 */
function keepPageMarkerWithText(text: string, start: number, split: number): number {
  const from = Math.max(start, split - MARKER_LOOKBACK);
  const region = text.slice(from, Math.min(text.length, split + MARKER_LOOKBACK));
  const scanner = new RegExp(PAGE_MARKER.source, "g");
  let markerStart: number | null = null;
  let markerEnd = 0;
  let match = scanner.exec(region);
  while (match !== null) {
    if (from + match.index >= split) {
      break;
    }
    markerStart = from + match.index;
    markerEnd = markerStart + match[0].length;
    match = scanner.exec(region);
  }
  if (markerStart === null || markerStart <= start) {
    return split;
  }
  const stranded = markerEnd > split || text.slice(markerEnd, split).trim().length === 0;
  return stranded ? markerStart : split;
}

/**
 * Heading-aware overlapping chunker. Each chunk is at most `size` characters and starts `overlap`
 * characters before the previous split, so a fact that straddles a boundary is whole in one of them.
 * Pure and deterministic: the same text always yields the same chunks.
 */
export function chunkKnowledgeText(text: string, size = CHUNK_TARGET, overlap = CHUNK_OVERLAP): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) {
    return [];
  }
  const target = Math.max(1, Math.floor(size));
  const step = Math.min(Math.max(0, Math.floor(overlap)), Math.floor(target / 2));
  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(start + target, cleaned.length);
    const split = end === cleaned.length ? end : keepPageMarkerWithText(cleaned, start, findSplit(cleaned, start, end));
    const body = cleaned.slice(start, split);
    if (body.trim().length > 0) {
      chunks.push(body);
    }
    if (split >= cleaned.length) {
      break;
    }
    start = Math.max(split - step, start + 1);
  }
  return chunks;
}
