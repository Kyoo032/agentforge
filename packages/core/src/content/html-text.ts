/**
 * Readability-lite: turn an HTML page into plain text for the research reader
 * and Knowledge Base ingestion. No DOM, no dependencies; deterministic caps.
 */

export const HTML_TEXT_DEFAULT_MAX_CHARS = 8_000;
export const TRUNCATION_MARKER = "[truncated]";

const DROP_BLOCKS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
];
const BLOCK_TAGS = [
  "p",
  "div",
  "section",
  "article",
  "main",
  "li",
  "ul",
  "ol",
  "table",
  "tr",
  "blockquote",
  "pre",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "dd",
  "dt",
  "figcaption",
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

export type HtmlTextResult = {
  title: string;
  text: string;
  truncated: boolean;
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

function dropBlocks(html: string): string {
  return DROP_BLOCKS.reduce(
    (out, tag) => out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " "),
    html.replace(/<!--[\s\S]*?-->/g, " "),
  );
}

const MAIN_REGION_MIN_CHARS = 200;

function strippedLength(fragment: string): number {
  return fragment.replace(/<[^>]+>/g, "").trim().length;
}

/** Prefer the largest main content container when the page marks one (teaser cards also use <article>). */
function pickMainRegion(html: string): string {
  const candidates = ["main", "article"].flatMap((tag) =>
    [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"))].map((match) => match[1] ?? ""),
  );
  const best = candidates.reduce<string | null>(
    (winner, candidate) => (strippedLength(candidate) > strippedLength(winner ?? "") ? candidate : winner),
    null,
  );
  if (best && strippedLength(best) > MAIN_REGION_MIN_CHARS) {
    return best;
  }
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
  return body?.[1] ?? html;
}

export function extractHtmlTitle(html: string): string {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "";
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1] ?? "";
  const raw = title.trim() || heading.replace(/<[^>]+>/g, "").trim();
  return decodeEntities(raw).replace(/\s+/g, " ").trim();
}

function tagsToText(fragment: string): string {
  const blockRe = new RegExp(`<\\/?(?:${BLOCK_TAGS.join("|")})\\b[^>]*>`, "gi");
  return fragment.replace(blockRe, "\n").replace(/<[^>]+>/g, " ");
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function capText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  const cut = text.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  const clean = lastBreak > maxChars * 0.6 ? cut.slice(0, lastBreak + 1) : cut;
  return { text: `${clean.trimEnd()}\n${TRUNCATION_MARKER}`, truncated: true };
}

export function htmlToText(html: string, options: { maxChars?: number } = {}): HtmlTextResult {
  const maxChars = options.maxChars ?? HTML_TEXT_DEFAULT_MAX_CHARS;
  const title = extractHtmlTitle(html);
  const region = pickMainRegion(dropBlocks(html));
  const text = collapseWhitespace(decodeEntities(tagsToText(region)));
  const capped = capText(text, maxChars);
  return { title, text: capped.text, truncated: capped.truncated };
}

/** Plain text / Markdown / JSON bodies: no tag stripping, same cap. */
export function plainToText(body: string, options: { maxChars?: number } = {}): HtmlTextResult {
  const capped = capText(collapseWhitespace(body), options.maxChars ?? HTML_TEXT_DEFAULT_MAX_CHARS);
  return { title: "", text: capped.text, truncated: capped.truncated };
}

/** HTML by header, or by markup when the server mislabels it as plain text (or sends no type). */
export function isHtmlContent(contentType: string, body: string): boolean {
  if (/text\/html|application\/xhtml/i.test(contentType)) {
    return true;
  }
  if (contentType && !/^text\/plain\b/i.test(contentType)) {
    return false;
  }
  return /<!doctype html|<html\b|<body\b|<div\b|<p\b/i.test(body.slice(0, 2_000));
}
