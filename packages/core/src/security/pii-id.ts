/**
 * Indonesian identifiers for the shared PII scanner.
 *
 * One rule shapes every detector in this file: **money is never masked.** A Finance prompt is mostly
 * long digit runs — a rupiah total is routinely 10 to 16 digits — so a detector may only fire when
 * the text carries something an amount cannot have: a NIK's embedded birth date, an NPWP's dotted
 * shape, the leading `0` of an `08xx` phone, or a label written immediately beside the number.
 *
 * Detectors that need a column header to be safe (a bank account with no label beside it, a person's
 * name) are deliberately not here. They live in `packages/core/src/finance/pii-scan.ts`, which only
 * ever sees a table and can read the header above a cell.
 */

export type IdPiiKind = "nik" | "npwp" | "account" | "phone";

export type IdPiiMatch = { kind: IdPiiKind; match: string; index: number };

/**
 * BPS province codes (the 38 provinces). The narrow list, rather than the whole 11–94 range the
 * format allows, is what keeps a 16-digit rupiah total out of the NIK detector: only 38 of the 100
 * leading pairs can open one. `99` is reserved for synthetic fixtures so no test ever needs a real
 * person's number.
 */
export const ID_PROVINCE_CODES: ReadonlySet<string> = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "21",
  "31", "32", "33", "34", "35", "36",
  "51", "52", "53",
  "61", "62", "63", "64", "65",
  "71", "72", "73", "74", "75", "76",
  "81", "82",
  "91", "92", "93", "94", "95", "96",
  "99",
]);

/** Longest day each month can hold; February is leap-tolerant because a NIK carries no century. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** A woman's NIK adds 40 to the birth day, which is the only reason day 41–71 is legal. */
const FEMALE_DAY_OFFSET = 40;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * `PPRRDD DDMMYY NNNN` with every field in range.
 *
 * `labelled` is set when the text already named the number ("NIK: …"). An unlabelled run has to earn
 * the finding on structure alone, so it is refused when the last four digits are a round thousand —
 * that is the shape of a rupiah total, not of a registration serial (which runs 0001–9999).
 */
export function isNikDigits(digits: string, options: { labelled?: boolean } = {}): boolean {
  if (!/^\d{16}$/.test(digits)) {
    return false;
  }
  if (!ID_PROVINCE_CODES.has(digits.slice(0, 2))) {
    return false;
  }
  if (Number(digits.slice(2, 4)) === 0 || Number(digits.slice(4, 6)) === 0) {
    return false;
  }
  const rawDay = Number(digits.slice(6, 8));
  const day = rawDay > FEMALE_DAY_OFFSET ? rawDay - FEMALE_DAY_OFFSET : rawDay;
  const month = Number(digits.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) {
    return false;
  }
  const serial = Number(digits.slice(12));
  if (serial === 0) {
    return false;
  }
  return options.labelled === true || serial % 1000 !== 0;
}

/** NPWP is 15 digits (classic) or 16 (the NIK-shaped one). There is no published checksum to lean on. */
export function isNpwpDigits(digits: string): boolean {
  return /^\d{15}$/.test(digits) || /^\d{16}$/.test(digits);
}

/** `NN.NNN.NNN.N-NNN.NNN` — a shape no amount is ever written in, so it needs no label. */
const NPWP_DOTTED_RE = /\b\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}\b/g;

/** A bare 16-digit run, never one cut out of a longer number or out of a separated amount. */
const NIK_BARE_RE = /(?<![\d.,-])\d{16}(?![\d.,-])/g;

/**
 * Words that make the next number an amount. A 16-digit run with no label passes the structure test
 * about 2.5% of the time by chance, so the text right before it gets a veto: `Total: 1234...` is a
 * ledger sum whatever its digits happen to spell. (A run ending in three zeros — how a rupiah total
 * is nearly always written — can never pass at all: its serial field would be a round thousand.)
 */
const MONEY_CUE_RE =
  /(?:rp|idr|usd|eur|sgd|myr|total|subtotal|jumlah|saldo|nilai|amount|balance|omzet|omset|kas|sum|[$€£¥])\s*[:=]?\s*$/i;

/** How far back the money veto looks. One short cue plus its punctuation, never a whole sentence. */
const MONEY_CUE_LOOKBACK = 24;

/**
 * `08xx` local mobile numbers. The leading `0` is the whole safety argument: no amount starts with
 * one, and the lookbehind stops `1.081.250.000` from donating an `081` to the match.
 */
const LOCAL_PHONE_RE = /(?<![\d.,-])08\d{1,2}[\s.-]?\d{3,4}[\s.-]?\d{3,5}\b/g;

const NIK_LABELLED_RE = /\b(?:nik|no\.?\s*ktp|nomor\s*ktp|ktp)\b\s*(?:no\.?|nomor)?\s*[:#=-]?\s*(\d[\d\s.-]{14,26})/gi;

const NPWP_LABELLED_RE = /\bnpwp\b\s*(?:no\.?|nomor)?\s*[:#=-]?\s*(\d[\d\s.-]{13,26})/gi;

/**
 * A bank account only when the cue sits immediately before the digits. "Rekening Bank: 1250000000"
 * therefore does not match (the word `Bank` is in the way) and neither does "Accounts payable
 * 450000000" — both are amounts, and an amount that lost its digits is a wrong brief.
 */
const ACCOUNT_LABELLED_RE =
  /\b(?:no\.?\s*rek(?:ening)?|nomor\s*rek(?:ening)?|norek|rekening|a\/c|acct\.?|account\s*(?:no\.?|number|#))\s*[:#=-]?\s*(\d[\d\s-]{6,23})(?!\d)/gi;

const ACCOUNT_MIN_DIGITS = 8;
const ACCOUNT_MAX_DIGITS = 20;
const LOCAL_PHONE_MIN_DIGITS = 10;
const LOCAL_PHONE_MAX_DIGITS = 13;

function overlaps(found: ReadonlyArray<IdPiiMatch>, index: number, length: number): boolean {
  return found.some((item) => index < item.index + item.match.length && index + length > item.index);
}

function add(found: IdPiiMatch[], candidate: IdPiiMatch): void {
  if (candidate.match.length > 0 && !overlaps(found, candidate.index, candidate.match.length)) {
    found.push(candidate);
  }
}

/** The capture group's own span, so masking replaces the number and leaves its label readable. */
function capturedSpan(match: RegExpMatchArray): { text: string; index: number } | null {
  const captured = match[1];
  if (captured === undefined || match.index === undefined) {
    return null;
  }
  const trimmed = captured.trimEnd();
  const offset = match[0].lastIndexOf(captured);
  return offset < 0 ? null : { text: trimmed, index: match.index + offset };
}

function collectLabelled(text: string, found: IdPiiMatch[]): void {
  for (const match of text.matchAll(NIK_LABELLED_RE)) {
    const span = capturedSpan(match);
    if (span && isNikDigits(digitsOnly(span.text), { labelled: true })) {
      add(found, { kind: "nik", match: span.text, index: span.index });
    }
  }
  for (const match of text.matchAll(NPWP_LABELLED_RE)) {
    const span = capturedSpan(match);
    if (span && isNpwpDigits(digitsOnly(span.text))) {
      add(found, { kind: "npwp", match: span.text, index: span.index });
    }
  }
  for (const match of text.matchAll(ACCOUNT_LABELLED_RE)) {
    const span = capturedSpan(match);
    const digits = span ? digitsOnly(span.text) : "";
    if (span && digits.length >= ACCOUNT_MIN_DIGITS && digits.length <= ACCOUNT_MAX_DIGITS) {
      add(found, { kind: "account", match: span.text, index: span.index });
    }
  }
}

function collectUnlabelled(text: string, found: IdPiiMatch[]): void {
  for (const match of text.matchAll(NPWP_DOTTED_RE)) {
    if (match.index !== undefined) {
      add(found, { kind: "npwp", match: match[0], index: match.index });
    }
  }
  for (const match of text.matchAll(NIK_BARE_RE)) {
    if (match.index === undefined || !isNikDigits(match[0])) {
      continue;
    }
    const before = text.slice(Math.max(0, match.index - MONEY_CUE_LOOKBACK), match.index);
    if (!MONEY_CUE_RE.test(before)) {
      add(found, { kind: "nik", match: match[0], index: match.index });
    }
  }
  for (const match of text.matchAll(LOCAL_PHONE_RE)) {
    const digits = match.index === undefined ? "" : digitsOnly(match[0]);
    if (match.index !== undefined && digits.length >= LOCAL_PHONE_MIN_DIGITS && digits.length <= LOCAL_PHONE_MAX_DIGITS) {
      add(found, { kind: "phone", match: match[0], index: match.index });
    }
  }
}

/**
 * Every Indonesian identifier in `text`, sorted by position. Labelled matches are collected first so
 * a number that carries its own label keeps that reading when two detectors could claim it.
 */
export function scanIndonesianIds(text: string): IdPiiMatch[] {
  if (!text) {
    return [];
  }
  const found: IdPiiMatch[] = [];
  collectLabelled(text, found);
  collectUnlabelled(text, found);
  return [...found].sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
}
