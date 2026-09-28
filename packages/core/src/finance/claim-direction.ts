/**
 * A sentence that quotes a computed figure and says the opposite of its direction.
 *
 * The number guard only asks whether the amount exists. "Marketing is favourable at 14,000" can
 * quote a real actual and still be the wrong way round. The direction itself was computed with the
 * figure — a budget line, a ratio band, a runway, the sign of NPV, profit versus loss — and this
 * check only compares the words. It never produces an amount.
 *
 * An agreeing phrase is masked before the opposite is looked for, and only when masking it cannot
 * eat the opposite: "does not run out" must still be found when the true phrase is "runs out", and
 * "menguntungkan" must not be found inside "tidak menguntungkan" when that longer phrase is the
 * true one.
 */
import { extractNumbers, matchesAllowed } from "./number-guard";
import type { ReportLocale } from "./report";

export type DirectionWord = { readonly en: string; readonly id: string };

export type DirectionClaim = {
  /** A figure the code computed. The sentence has to quote it. */
  readonly amount: number;
  /** Phrases that agree with that figure's direction, in both languages. */
  readonly agree: readonly DirectionWord[];
  /** Phrases that would say the opposite. */
  readonly contradict: readonly DirectionWord[];
};

/** Sentence ends that survive "Rp 1.250.000": a full stop between digits is not one. */
const SENTENCE_END = /(?<![0-9])([.!?])\s+(?=[A-ZÀ-ÖØ-Þ"“(])/g;

function phrases(words: readonly DirectionWord[], locale: ReportLocale): string[] {
  return words.map((word) => (locale === "id" ? word.id : word.en)).filter((phrase) => phrase.trim() !== "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(text: string, phrase: string): boolean {
  const needle = phrase.trim();
  if (needle === "") {
    return false;
  }
  if (/\s/u.test(needle)) {
    return text.toLocaleLowerCase("en").includes(needle.toLocaleLowerCase("en"));
  }
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

function maskPhrase(text: string, phrase: string): string {
  const needle = phrase.trim();
  if (needle === "") {
    return text;
  }
  if (/\s/u.test(needle)) {
    return text.replace(new RegExp(escapeRegExp(needle), "giu"), " ");
  }
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, "giu"), " ");
}

function quotesAmount(sentence: string, amount: number): boolean {
  return extractNumbers(sentence).some(
    (token) =>
      matchesAllowed(token.value, [amount]) ||
      (token.alternate !== undefined && matchesAllowed(token.alternate, [amount])),
  );
}

/**
 * True when the sentence quotes this claim's figure and, once the agreeing phrases are masked,
 * still says the opposite.
 */
export function sentenceContradictsClaim(sentence: string, claim: DirectionClaim, locale: ReportLocale): boolean {
  if (!quotesAmount(sentence, claim.amount)) {
    return false;
  }
  const agree = phrases(claim.agree, locale);
  const contradict = phrases(claim.contradict, locale);
  let masked = sentence;
  const longestAgree = [...agree].sort((left, right) => right.length - left.length);
  for (const phrase of longestAgree) {
    const swallowed = contradict.some(
      (opposite) =>
        opposite.length > phrase.length && opposite.toLocaleLowerCase("en").includes(phrase.toLocaleLowerCase("en")),
    );
    if (!swallowed) {
      masked = maskPhrase(masked, phrase);
    }
  }
  return contradict.some((phrase) => hasPhrase(masked, phrase));
}

function claimKey(claim: DirectionClaim, locale: ReportLocale): string {
  return phrases(claim.contradict, locale).join("\u0000");
}

/**
 * The sentence quotes one direction and says the opposite.
 *
 * Two figures with different directions in the same sentence are left alone: "14,000 unfavourable
 * and 49,000 favourable" is a reading of two lines, and this check will not guess which word
 * belongs to which amount.
 */
export function sentenceContradictsDirection(
  sentence: string,
  claims: readonly DirectionClaim[],
  locale: ReportLocale,
): boolean {
  const quoted = claims.filter((claim) => quotesAmount(sentence, claim.amount));
  if (quoted.length === 0) {
    return false;
  }
  const keys = new Set(quoted.map((claim) => claimKey(claim, locale)));
  const claim = quoted[0];
  return keys.size === 1 && claim !== undefined && sentenceContradictsClaim(sentence, claim, locale);
}

function splitSentences(body: string): string[] {
  return body
    .replace(SENTENCE_END, "$1\u0000")
    .split("\u0000")
    .filter((sentence) => sentence.trim() !== "");
}

/** Sentences in this body that say the opposite of a figure they quote. */
export function contradictingSentences(
  body: string,
  claims: readonly DirectionClaim[],
  locale: ReportLocale,
): string[] {
  return body
    .split(/\n{2,}/)
    .flatMap((paragraph) =>
      splitSentences(paragraph).filter((sentence) => sentenceContradictsDirection(sentence, claims, locale)),
    );
}

/** The body with those sentences taken out. A paragraph that empties goes with them. */
export function withoutContradictingSentences(
  body: string,
  claims: readonly DirectionClaim[],
  locale: ReportLocale,
): { readonly body: string; readonly removed: readonly string[] } {
  const removed: string[] = [];
  const paragraphs = body.split(/\n{2,}/).map((paragraph) => {
    const kept = splitSentences(paragraph).filter((sentence) => {
      if (!sentenceContradictsDirection(sentence, claims, locale)) {
        return true;
      }
      removed.push(sentence.trim());
      return false;
    });
    return kept.join(" ").replace(/\s+/g, " ").trim();
  });
  return { body: paragraphs.filter(Boolean).join("\n\n"), removed };
}
