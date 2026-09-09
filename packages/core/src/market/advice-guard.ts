/**
 * C1 output guard: deterministic advice-phrase scan over serialized payloads.
 *
 * Port of dps-market-mcp `guard/output_filter.py`, relaxed for Market Watch
 * v2: only imperative directives ("beli sekarang", "you should sell") are
 * forbidden. Rankings, sentiment, quoted vendor labels (STRONG_BUY), target
 * and stop levels discussed as levels, and "signals to watch" are the
 * briefing's job and pass. Every string in a payload (values and object keys,
 * recursively) is matched against ADVICE_PATTERN. A match raises
 * AdviceLeakError; nothing is ever redacted (C8: fail loud).
 *
 * Masks are exact serialized paths ("a.b[0].c", "counts.strongBuy.$key"). No
 * globbing, no name-based exemptions: a plain object is scanned strictly unless
 * the caller passes the exact paths it vouches for.
 *
 * `guardAdviceInText` is the prose-side companion for model-written sections:
 * it replaces an offending sentence with ADVICE_MARKER and reports the count,
 * so the studio can show what was removed instead of hiding it.
 */

export const ADVICE_PATTERN =
  /\b(beli sekarang|jual sekarang|belilah|juallah|buy now|sell now|masuk sekarang|akumulasi sekarang|you should (buy|sell)|kamu harus (beli|jual)|anda harus (beli|jual)|harus (beli|jual) sekarang)\b/i;

/** Path suffix that marks an object key (as opposed to the value under it). */
export const KEY_MARKER = "$key";
export const ADVICE_MARKER = "[removed: directive language]";
export const NO_MASK: ReadonlySet<string> = new Set();

export type AdviceHit = { path: string; match: string };

type PathElem = string | number;
type StringAtPath = { path: readonly PathElem[]; value: string };

export class AdviceLeakError extends Error {
  readonly path: string;
  readonly match: string;

  constructor(path: string, match: string) {
    super(`C1 advice leak at '${path}': matched ${JSON.stringify(match)}`);
    this.name = "AdviceLeakError";
    this.path = path;
    this.match = match;
  }
}

/** ("bull", 0, "text") -> "bull[0].text"; ("counts", "buy", "$key") -> "counts.buy.$key". */
export function formatPath(path: readonly PathElem[]): string {
  return path
    .map((elem) => (typeof elem === "number" ? `[${elem}]` : `.${elem}`))
    .join("")
    .replace(/^\./, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every string value and object key in the payload, with its serialized path. */
export function* iterStrings(payload: unknown, path: readonly PathElem[] = []): Generator<StringAtPath> {
  if (typeof payload === "string") {
    yield { path, value: payload };
    return;
  }
  if (Array.isArray(payload)) {
    for (const [index, item] of payload.entries()) {
      yield* iterStrings(item, [...path, index]);
    }
    return;
  }
  if (isRecord(payload)) {
    for (const [key, value] of Object.entries(payload)) {
      const keyPath = [...path, key];
      yield { path: [...keyPath, KEY_MARKER], value: key };
      yield* iterStrings(value, keyPath);
    }
  }
}

function* adviceHits(payload: unknown, masked: ReadonlySet<string>): Generator<AdviceHit> {
  for (const { path, value } of iterStrings(payload)) {
    const formatted = formatPath(path);
    if (masked.has(formatted)) {
      continue;
    }
    const match = ADVICE_PATTERN.exec(value);
    if (match !== null) {
      yield { path: formatted, match: match[0] };
    }
  }
}

/** Every advice match outside `masked`, in document order. Never throws. */
export function scanForAdvice(payload: unknown, masked: ReadonlySet<string> = NO_MASK): AdviceHit[] {
  return [...adviceHits(payload, masked)];
}

/** Throws AdviceLeakError on the first advice match outside `masked`. The payload is never modified. */
export function assertNoAdvice(payload: unknown, masked: ReadonlySet<string> = NO_MASK): void {
  for (const hit of adviceHits(payload, masked)) {
    throw new AdviceLeakError(hit.path, hit.match);
  }
}

/**
 * Sentence boundaries: whitespace after a terminator, or a bare newline. The
 * capturing group keeps the separators so the text can be re-joined verbatim.
 * "9.500" and "12.4%" are not boundaries because no whitespace follows the dot.
 */
const SENTENCE_SPLIT = /((?<=[.!?])\s+|\n)/;

export type GuardedText = { text: string; replaced: number };

/** Replace every sentence that matches ADVICE_PATTERN with ADVICE_MARKER. Returns a new string. */
export function guardAdviceInText(text: string): GuardedText {
  const parts = text.split(SENTENCE_SPLIT);
  const guarded = parts.map((part) => (ADVICE_PATTERN.test(part) ? ADVICE_MARKER : part));
  const replaced = guarded.filter((part, index) => part !== parts[index]).length;
  return { text: guarded.join(""), replaced };
}
