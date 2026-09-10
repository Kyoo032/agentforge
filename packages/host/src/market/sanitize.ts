/**
 * Sanitizer for every external string the market adapters store (C7).
 * Mirrors the Python reference (`dps_market_mcp/ingest/sanitize.py`):
 *
 * 0. cap the raw input at RAW_MAX_CHARS before any work touches it;
 * 1. strip HTML with an empty allow-list (linear scanner, see strip-tags.ts), decode entities;
 * 2. NFKC-normalise and drop zero-width / bidi / control code points;
 * 3. collapse whitespace and cap the length;
 * 4. flag instruction-like phrases (ID + EN). Flagged text is kept, never dropped.
 *
 * Pure: returns a new object, never mutates its input.
 */
import { scanInjection } from "@agentforge/core";
import { stripTags } from "./strip-tags";

export const SANITIZE_MAX_CHARS = 20_000;
/** Raw characters looked at before stripping; markup can only shrink, so twice the output cap is enough. */
export const RAW_MAX_CHARS = SANITIZE_MAX_CHARS * 2;
export const SUMMARY_MAX_CHARS = 400;
const ELLIPSIS = "…";

export type SanitizedText = {
  text: string;
  /** True when the text reads like an instruction to the model. Kept, but excluded from findings. */
  injectionSuspect: boolean;
};

/** Instruction-like phrases in English and Indonesian. Matched against the cleaned text. */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|preceding|earlier)\b/i,
  /\bsystem\s*:/i,
  /\bsystem\s+prompt\b/i,
  /\byou\s+are\s+(?:now\s+)?(?:a\s+|an\s+|the\s+)?(?:helpful\s+|friendly\s+|large\s+)?(?:assistant|ai|chatbot|language\s+model|dan)\b/i,
  /\byou\s+are\s+now\b/i,
  /\bas\s+an\s+ai\b/i,
  /<\|im_start\|>|<\|im_end\|>|<\|system\|>|\[INST\]|<<\s*SYS\s*>>|\[SYSTEM\]/i,
  /\b(?:reveal|print|show|dump|repeat|output|leak)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:hidden\s+)?(?:system\s+)?(?:prompt|instructions)\b/i,
  /\babaikan\s+(?:semua\s+|seluruh\s+)?(?:instruksi|perintah|aturan)\b/i,
  /\blupakan\s+(?:semua\s+|seluruh\s+)?(?:instruksi|perintah|aturan)\b/i,
  /\bjangan\s+(?:hiraukan|pedulikan|ikuti)\s+(?:semua\s+)?(?:instruksi|perintah|aturan)\b/i,
  /\bsebagai\s+asisten\b/i,
  /\bsebagai\s+(?:sebuah\s+)?ai\b/i,
  /\b(?:kamu|anda|kau)\s+(?:adalah|sekarang)\s+(?:sekarang\s+|adalah\s+)?(?:seorang\s+|sebuah\s+)?(?:asisten|ai|chatbot|model\s+bahasa)\b/i,
  /\bsistem\s*:/i,
  /\bprompt\s+sistem\b/i,
  /\b(?:tampilkan|bocorkan|ungkapkan|cetak)\s+(?:prompt|instruksi)\s+(?:sistem|rahasia)\b/i,
];

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
};

const MAX_CODE_POINT = 0x10ffff;

function codePointOrNull(code: number): string | null {
  const surrogate = code >= 0xd800 && code <= 0xdfff;
  return Number.isFinite(code) && code >= 0 && code <= MAX_CODE_POINT && !surrogate ? String.fromCodePoint(code) : null;
}

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return codePointOrNull(Number.parseInt(entity.slice(2), 16)) ?? match;
    }
    if (entity.startsWith("#")) {
      return codePointOrNull(Number.parseInt(entity.slice(1), 10)) ?? match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Strip twice: feeds often entity-encode their HTML, so decoding can reveal a second layer of tags. */
function stripHtml(input: string): string {
  return decodeEntities(stripTags(decodeEntities(stripTags(input))));
}

/**
 * Code points that can hide or reorder text: C0/C1 controls (minus tab/newline, which
 * whitespace collapsing handles), soft hyphen, zero-width family, line/paragraph
 * separators, bidi overrides and isolates, word joiner and friends, BOM, interlinear annotation.
 */
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
];

// Built from code points (none of them are regex metacharacters) so the source stays free of escapes.
const INVISIBLE_RE = new RegExp(
  `[${INVISIBLE_RANGES.map(([from, to]) =>
    from === to ? String.fromCodePoint(from) : `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`,
  ).join("")}]`,
  "gu",
);

function normalizeUnicode(input: string): string {
  return input.normalize("NFKC").replace(INVISIBLE_RE, "");
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function truncate(input: string, max: number): string {
  if (input.length <= max) {
    return input;
  }
  return `${input.slice(0, max - 1).trimEnd()}${ELLIPSIS}`;
}

export function looksLikeInstruction(text: string): boolean {
  if (!text) {
    return false;
  }
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text)) || scanInjection(text) !== null;
}

export function sanitizeExternalText(raw: string): SanitizedText {
  const capped = (raw ?? "").slice(0, RAW_MAX_CHARS);
  const text = truncate(collapseWhitespace(normalizeUnicode(stripHtml(capped))), SANITIZE_MAX_CHARS);
  return { text, injectionSuspect: looksLikeInstruction(text) };
}

/**
 * First whole sentences that fit under `max` characters. No model involved.
 * When even the first sentence is too long, it is cut at a word boundary with an ellipsis.
 */
export function extractiveSummary(text: string, max = SUMMARY_MAX_CHARS): string {
  const clean = collapseWhitespace(text ?? "");
  if (clean.length <= max) {
    return clean;
  }
  const sentences = clean.split(/(?<=[.!?…])\s+/);
  const kept = sentences.reduce<string>((out, sentence) => {
    const next = out ? `${out} ${sentence}` : sentence;
    return next.length > max ? out : next;
  }, "");
  if (kept) {
    return kept;
  }
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const head = space > max * 0.5 ? cut.slice(0, space) : cut;
  return `${head.trimEnd()}${ELLIPSIS}`;
}
