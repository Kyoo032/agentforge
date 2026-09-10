/**
 * Single-pass HTML tag stripper with an empty allow-list, linear in the input.
 *
 * A regex such as `<\/?[a-z][^>]*>` backtracks quadratically on text with many
 * `<` and no `>` (a 200k-char `<a<a<a…` took ~95 s). This scanner walks the
 * string once: on `<` it looks for the closing `>`; a `<` that does not close
 * within TAG_MAX_CHARS is emitted as text and the scan moves on. The position
 * of the next `>` is memoised so a run of unclosed `<` never rescans.
 *
 * Semantics kept from the regex version: comments and the bodies of
 * DROP_BLOCKS elements vanish, CDATA wrappers are removed and their content is
 * scanned like ordinary markup, inline formatting tags are removed without
 * inserting a space (so "(<b>BBCA</b>)" stays "(BBCA)"), every other tag becomes
 * one space. Pure: returns a new string.
 */

/** A `<` with no `>` within this many characters is text, not a tag. */
export const TAG_MAX_CHARS = 512;

/** Elements whose content is dropped along with the tags. */
const DROP_BLOCKS: ReadonlySet<string> = new Set(["script", "style", "noscript", "template", "svg", "iframe"]);
/** Inline formatting tags are removed without inserting a space. */
const INLINE_TAGS: ReadonlySet<string> = new Set([
  "a",
  "b",
  "i",
  "u",
  "em",
  "strong",
  "span",
  "small",
  "sup",
  "sub",
  "mark",
  "code",
  "abbr",
]);

const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";
const CDATA_OPEN = "<![CDATA[";
const CDATA_CLOSE = "]]>";

const LT = "<".charCodeAt(0);
const SLASH = "/".charCodeAt(0);
const BANG = "!".charCodeAt(0);
const QUESTION = "?".charCodeAt(0);
const HYPHEN = "-".charCodeAt(0);

/** One closing-tag matcher per droppable element, e.g. /<\/script\s*>/gi. */
const CLOSERS: ReadonlyMap<string, RegExp> = new Map(
  [...DROP_BLOCKS].map((name) => [name, new RegExp(`</${name}\\s*>`, "gi")]),
);

function isLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/** First character after `<` (or `</`) that makes it a tag: [a-z!?]. */
function isTagStart(code: number): boolean {
  return isLetter(code) || code === BANG || code === QUESTION;
}

function isNameChar(code: number): boolean {
  return isLetter(code) || isDigit(code) || code === HYPHEN;
}

/** Index just past `</name>` at or after `from`, or -1. Names without a closer are remembered. */
class ClosingTagFinder {
  private readonly missing = new Set<string>();

  constructor(private readonly input: string) {}

  find(name: string, from: number): number {
    if (this.missing.has(name)) {
      return -1;
    }
    const closer = CLOSERS.get(name);
    if (!closer) {
      return -1;
    }
    closer.lastIndex = from;
    const match = closer.exec(this.input);
    if (!match) {
      this.missing.add(name);
      return -1;
    }
    return match.index + match[0].length;
  }
}

/** indexOf(">") with a memo: a run of `<` with no `>` ahead is answered once. */
class NextGtFinder {
  private from = -1;
  private at = -1;

  constructor(private readonly input: string) {}

  find(from: number): number {
    const cached = this.from !== -1 && from >= this.from && (this.at === -1 || from <= this.at);
    if (!cached) {
      this.from = from;
      this.at = this.input.indexOf(">", from);
    }
    return this.at;
  }
}

type TagStep = { emit: string; next: number };

/** Reads one tag starting at `input[at] === "<"`; a non-tag `<` is emitted as text. */
function readTag(input: string, at: number, close: number, closers: ClosingTagFinder): TagStep {
  let cursor = at + 1;
  const closing = input.charCodeAt(cursor) === SLASH;
  if (closing) {
    cursor += 1;
  }
  if (cursor >= close || !isTagStart(input.charCodeAt(cursor))) {
    return { emit: "<", next: at + 1 };
  }
  const nameStart = cursor;
  while (cursor < close && isNameChar(input.charCodeAt(cursor))) {
    cursor += 1;
  }
  const name = input.slice(nameStart, cursor).toLowerCase();
  if (!closing && DROP_BLOCKS.has(name)) {
    const end = closers.find(name, close + 1);
    return { emit: " ", next: end === -1 ? close + 1 : end };
  }
  return { emit: INLINE_TAGS.has(name) ? "" : " ", next: close + 1 };
}

export function stripTags(input: string): string {
  const length = input.length;
  const out: string[] = [];
  const nextGt = new NextGtFinder(input);
  const closers = new ClosingTagFinder(input);
  let cdataEnd = -1;
  let i = 0;
  while (i < length) {
    if (i === cdataEnd) {
      cdataEnd = -1;
      i += CDATA_CLOSE.length;
      continue;
    }
    if (input.charCodeAt(i) !== LT) {
      const lt = input.indexOf("<", i);
      const stop = Math.min(lt === -1 ? length : lt, cdataEnd === -1 ? length : cdataEnd);
      out.push(input.slice(i, stop));
      i = stop;
      continue;
    }
    if (input.startsWith(COMMENT_OPEN, i)) {
      // An unclosed comment hides the rest of the document, as in HTML.
      const end = input.indexOf(COMMENT_CLOSE, i + COMMENT_OPEN.length);
      out.push(" ");
      i = end === -1 ? length : end + COMMENT_CLOSE.length;
      continue;
    }
    if (cdataEnd === -1 && input.startsWith(CDATA_OPEN, i)) {
      const end = input.indexOf(CDATA_CLOSE, i + CDATA_OPEN.length);
      if (end !== -1) {
        cdataEnd = end;
        i += CDATA_OPEN.length;
        continue;
      }
    }
    const close = nextGt.find(i);
    if (close === -1 || close - i > TAG_MAX_CHARS) {
      out.push("<");
      i += 1;
      continue;
    }
    const step = readTag(input, i, close, closers);
    out.push(step.emit);
    i = step.next;
  }
  return out.join("");
}
