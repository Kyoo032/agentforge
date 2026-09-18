import type { ContentPart } from "../content/types";
import { scanIndonesianIds } from "./pii-id";

export type PiiKind = "email" | "phone" | "id" | "card" | "nik" | "npwp" | "account" | "name";

export const PII_MASK: Record<PiiKind, string> = {
  email: "[email]",
  phone: "[phone]",
  id: "[id]",
  card: "[card]",
  nik: "[nik]",
  npwp: "[npwp]",
  account: "[account]",
  name: "[name]",
};

export type PiiFinding = {
  kind: PiiKind;
  match: string;
  index: number;
};

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Intl-ish phones: optional +, country code, groups of digits with spaces/dashes/parens. */
const PHONE_RE = /(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{1,4})?/g;

/** 13–19 digit runs, allowing common separators. */
const CARD_CANDIDATE_RE = /\b(?:\d[ -]*?){13,19}\b/g;

/** Long ID-like numbers: SSN / national-id style with separators. Bare digit runs are quantities. */
const ID_RE = /\b(?:\d{3}[-\s]\d{2}[-\s]\d{4}|\d{2}[-\s]\d{2}[-\s]\d{2}[-\s]\d{2,4})\b/g;

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Luhn checksum — rejects random digit runs that look card-like. */
export function passesLuhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) {
    return false;
  }
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function pushUnique(findings: PiiFinding[], finding: PiiFinding): void {
  const exists = findings.some(
    (item) => item.kind === finding.kind && item.index === finding.index && item.match === finding.match,
  );
  if (!exists) {
    findings.push(finding);
  }
}

function overlapsFinding(findings: PiiFinding[], index: number, length: number): boolean {
  return findings.some((item) => index < item.index + item.match.length && index + length > item.index);
}

/** Bare digit runs are quantities (market cap, volume), not phones. Require + / 00 or separators. */
function hasPhoneFormatting(raw: string): boolean {
  return /^(?:\+|00)/.test(raw.trim()) || /[\s().-]/.test(raw);
}

/**
 * A bare digit run that ends in four zeros is a total, not a number to call. It is the same reading
 * {@link CARD_ROUND_TAIL_RE} gives a card-length run, and it is what keeps a signed or bracketed
 * `(1.000.000.000)` out of the phone detector: the wrapper looks like formatting, the digits do not.
 */
const ROUND_TOTAL_RE = /^\d+0{4}$/;

/**
 * Uniform three-digit groups with at most a two-digit decimal tail: `1.250.000`, `1,234,567.89`,
 * `23 960 000 000`. That is how money is written and it is not how a phone is written — phones group
 * by 3-4 and stop at fifteen digits, so no real number reaches four uniform groups.
 */
const GROUPED_THOUSANDS_RE = /^\d{1,3}(?:[.,\u00a0 ]\d{3})+(?:[.,]\d{1,2})?$/;

/**
 * The wrapper a sheet puts around a figure, taken off before the grouping is judged: accounting
 * brackets, a leading sign, padding. The closing bracket is peeled on its own because the matcher
 * hands over `(23.960.000.000` — it read the opening bracket as phone formatting and stopped at the
 * one it never reached.
 */
function amountBody(raw: string): string {
  return raw
    .trim()
    .replace(/^[(\s]+/, "")
    .replace(/[)\s]+$/, "")
    .replace(/^[-+]\s*/, "")
    .trim();
}

/**
 * `1.250.000.000.000` is a rupiah total, not a phone, and so is `(23.960.000.000)` — the accounting
 * way to write the negative of one. Both used to come back as `[phone]`, which silently rewrote the
 * one thing a Finance brief may not lose: a 2024 cost of sales reached the parser as `[phone])`.
 *
 * Peeling the bracket cannot turn a phone into money: a bracketed phone closes its area code before
 * the rest of the number (`(021) 555-1234`), so the `)` stays inside the body and no uniform
 * grouping survives it. A currency mark never enters the match at all — the phone pattern holds no
 * letters — so `Rp (1.250.000.000)` is judged on its digits like any other figure.
 */
function looksLikeAmount(raw: string): boolean {
  const body = amountBody(raw);
  return GROUPED_THOUSANDS_RE.test(body) || ROUND_TOTAL_RE.test(body);
}

/**
 * A phone is a whole token, so a match that begins or ends inside a longer number is a slice of one.
 *
 * A PDF flattens its table to one line and two figures end up side by side: `7.368.000.000
 * 9.004.650.000`. The matcher offers `368.000.000 9`, which is phone-shaped and passes every test
 * above, and masking it took both figures out of an annual report at once.
 *
 * The sentence-ending full stop is not "inside" anything, so only a separator with a digit behind it
 * counts. A match that opens with `+` is exempt on the left: no amount runs into a country code.
 */
function slicedFromNumber(text: string, index: number, raw: string): boolean {
  const after = text[index + raw.length] ?? "";
  if (/\d/.test(after) || (/[.,]/.test(after) && /\d/.test(text[index + raw.length + 1] ?? ""))) {
    return true;
  }
  return !raw.startsWith("+") && /[\d.,-]/.test(text[index - 1] ?? "");
}

/**
 * Issuer prefixes a run has to open with before an unseparated 13-19 digit number is read as a card.
 * Luhn alone passes roughly one bare digit run in ten, so a 16-digit rupiah total was being masked
 * as `[card]` about that often. A card written out by a person keeps its groups (`4111 1111 …`) and
 * still takes the formatted path below; only the bare case has to prove itself.
 */
const CARD_PREFIX_RE = /^(?:4|5[1-5]|2[2-7]|34|37|6011|64[4-9]|65|35|30[0-5]|36|3[89]|62)/;

/** No PAN ends in four zeros; a total nearly always does. */
const CARD_ROUND_TAIL_RE = /0{4}$/;

/** A bare run must look like an issued card, not like money. Separated runs keep the old rule. */
function bareRunLooksLikeCard(raw: string, digits: string): boolean {
  if (/[ -]/.test(raw)) {
    return true;
  }
  return CARD_PREFIX_RE.test(digits) && !CARD_ROUND_TAIL_RE.test(digits);
}

export function scanPii(text: string): PiiFinding[] {
  if (!text) {
    return [];
  }

  const findings: PiiFinding[] = [];

  // Indonesian identifiers go in first so a NIK that happens to pass Luhn reads as [nik] rather than
  // [card]. Each detector there needs a structure or a label an amount cannot have — see ./pii-id.ts.
  for (const found of scanIndonesianIds(text)) {
    pushUnique(findings, { kind: found.kind, match: found.match, index: found.index });
  }

  for (const match of text.matchAll(EMAIL_RE)) {
    if (match.index === undefined) {
      continue;
    }
    pushUnique(findings, { kind: "email", match: match[0], index: match.index });
  }

  for (const match of text.matchAll(PHONE_RE)) {
    if (match.index === undefined) {
      continue;
    }
    const raw = match[0];
    const digits = digitsOnly(raw);
    // Avoid short numbers (years, codes) and unformatted quantities (market cap).
    if (digits.length < 10 || digits.length > 15 || !hasPhoneFormatting(raw) || looksLikeAmount(raw)) {
      continue;
    }
    if (slicedFromNumber(text, match.index, raw)) {
      continue;
    }
    if (overlapsFinding(findings, match.index, raw.length)) {
      continue;
    }
    pushUnique(findings, { kind: "phone", match: raw, index: match.index });
  }

  for (const match of text.matchAll(CARD_CANDIDATE_RE)) {
    if (match.index === undefined) {
      continue;
    }
    const raw = match[0];
    const digits = digitsOnly(raw);
    if (!passesLuhn(digits) || !bareRunLooksLikeCard(raw, digits) || looksLikeAmount(raw)) {
      continue;
    }
    // An Indonesian identifier already claimed these digits; one span never gets two tokens.
    if (overlapsFinding(findings, match.index, raw.length)) {
      continue;
    }
    pushUnique(findings, { kind: "card", match: raw, index: match.index });
  }

  for (const match of text.matchAll(ID_RE)) {
    if (match.index === undefined) {
      continue;
    }
    const raw = match[0];
    const digits = digitsOnly(raw);
    if (digits.length < 9 || looksLikeAmount(raw)) {
      continue;
    }
    // Prefer card classification when Luhn-valid.
    if (passesLuhn(digits) && digits.length >= 13 && digits.length <= 19) {
      continue;
    }
    if (overlapsFinding(findings, match.index, raw.length)) {
      continue;
    }
    // Bare digit runs are quantities (market cap, volume), not IDs. Cards use Luhn.
    // SSN / national-id style needs separators.
    if (!/[-\s]/.test(raw)) {
      continue;
    }
    pushUnique(findings, { kind: "id", match: raw, index: match.index });
  }

  findings.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
  return findings;
}

const KIND_LABEL: Record<PiiKind, string> = {
  email: "email addresses",
  phone: "phone numbers",
  id: "ID numbers",
  card: "card numbers",
  nik: "NIK numbers",
  npwp: "NPWP numbers",
  account: "bank account numbers",
  name: "names",
};

/** Replace findings with stable tokens. The original string is not mutated. */
export function maskPii(text: string): string {
  const findings = scanPii(text);
  if (findings.length === 0) {
    return text;
  }
  const ordered = [...findings].sort((left, right) => {
    if (right.index !== left.index) {
      return right.index - left.index;
    }
    return right.match.length - left.match.length;
  });
  let result = text;
  const consumed: Array<{ index: number; end: number }> = [];
  for (const finding of ordered) {
    const end = finding.index + finding.match.length;
    if (consumed.some((span) => finding.index < span.end && end > span.index)) {
      continue;
    }
    result = result.slice(0, finding.index) + PII_MASK[finding.kind] + result.slice(end);
    consumed.push({ index: finding.index, end });
  }
  return result;
}

export function maskPiiInParts(parts: ContentPart[]): ContentPart[] {
  return parts.map((part) => {
    if (part.type === "text" || part.type === "thinking") {
      return { ...part, text: maskPii(part.text) };
    }
    return part;
  });
}

export function maskOutboundRunInput<
  T extends {
    version: { systemPrompt: string };
    history: Array<{ role: "user" | "assistant"; parts: ContentPart[] }>;
  },
>(input: T): T {
  return {
    ...input,
    version: { ...input.version, systemPrompt: maskPii(input.version.systemPrompt) },
    history: input.history.map((item) => ({ ...item, parts: maskPiiInParts(item.parts) })),
  };
}

export function piiWarning(findings: PiiFinding[]): string | null {
  if (findings.length === 0) {
    return null;
  }
  const kinds = [...new Set(findings.map((item) => item.kind))];
  const labels = kinds.map((kind) => KIND_LABEL[kind]);
  if (labels.length === 1) {
    return `This prompt may contain ${labels[0]}. Remove personal data before sending.`;
  }
  if (labels.length === 2) {
    return `This prompt may contain ${labels[0]} and ${labels[1]}. Remove personal data before sending.`;
  }
  const head = labels.slice(0, -1).join(", ");
  const last = labels[labels.length - 1];
  return `This prompt may contain ${head}, and ${last}. Remove personal data before sending.`;
}
