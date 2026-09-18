/**
 * One cell to one plain figure.
 *
 * A sheet does not write its numbers one way. Cells Excel formatted arrive comma-grouped
 * ("5,400,000,000", or the accounting format's " Rp7,570,000,000 " with padding and no gap), while
 * the rows someone typed by hand in the same sheet are point-grouped ("512.000.000", "(245.000.000)").
 * So the point and the comma are decided *separately* per sheet, and a value with two or more
 * separators of the same kind is thousands whatever the sheet style says — three digits can be a
 * decimal tail, but `1.250.000` cannot be anything else.
 */
import { isCurrencyCode } from "./currency";

/** How a sheet writes "1.250": Indonesian thousands, or an English decimal point. */
export type PointStyle = "thousands" | "decimal";

/** What a single point group and a single comma group mean in this sheet, decided independently. */
export type NumberStyle = { readonly point: PointStyle; readonly comma: PointStyle };

const PARENTHESISED = /^\((.*)\)$/;
/** A three-letter word in front of the figure. Whether it is a currency is decided by the allowlist. */
const LEADING_WORD = /^([A-Za-z]{3})\.?\s*(?=[\d(.,-])/;
const CURRENCY_MARK = /^(rp|\$|€|£|¥)\s*/i;
const PERCENT_SUFFIX = /%\s*$/;
/** "Rp" and "IDR" are how a sheet says its points are thousands, whatever else it does with commas. */
const RUPIAH = /^(rp|idr)$/i;
const NUMERIC_BODY = /^[-+]?[\d.,]*\d[\d.,]*$/;

type Parts = { readonly inner: string; readonly body: string; readonly code: string; readonly mark: string };

/** Split a cell into its sign wrapper, currency and bare number, without deciding what it means yet. */
function cellParts(raw: string): { readonly negated: boolean; readonly parts: Parts } {
  const trimmed = raw.trim();
  const parenthesised = PARENTHESISED.exec(trimmed);
  const inner = (parenthesised ? (parenthesised[1] ?? "") : trimmed).trim();
  const word = LEADING_WORD.exec(inner);
  const code = word && isCurrencyCode(word[1] ?? "") ? (word[1] ?? "") : "";
  const afterCode = code ? inner.slice(word?.[0].length ?? 0) : inner;
  const mark = CURRENCY_MARK.exec(afterCode)?.[1] ?? "";
  const body = afterCode.replace(CURRENCY_MARK, "").replace(PERCENT_SUFFIX, "").trim();
  return { negated: parenthesised !== null, parts: { inner, body, code, mark } };
}

/** The bare number inside a cell: no parentheses, currency mark, ISO code or percent sign. */
export function magnitudeText(raw: string): string {
  return cellParts(raw).parts.body;
}

function groupsOf(text: string, separator: string): string[] {
  return text.split(separator);
}

/** `1.250` / `1,250`: a single group of three that only the sheet's own style can settle. */
function ambiguousGroup(head: string, tail: string): boolean {
  return tail.length === 3 && head.length >= 1 && head.length <= 3;
}

function fromSingleSeparator(text: string, separator: string, style: PointStyle): number | null {
  const parts = groupsOf(text, separator);
  const head = parts[0] ?? "";
  const tail = parts[1] ?? "";
  if (ambiguousGroup(head, tail)) {
    return Number(style === "thousands" ? `${head}${tail}` : `${head}.${tail}`);
  }
  // A thousands group is always exactly three digits, so anything else can only be a decimal tail.
  return Number(`${head}.${tail}`);
}

/** The bare number to a value, with the two separator meanings already decided for this sheet. */
export function parseGrouped(raw: string, style: NumberStyle): number | null {
  const text = raw.replace(/\s/g, "");
  if (!NUMERIC_BODY.test(text)) {
    return null;
  }
  const sign = text.startsWith("-") ? -1 : 1;
  const digits = text.replace(/^[-+]/, "");
  const points = digits.split(".").length - 1;
  const commas = digits.split(",").length - 1;
  const value = (() => {
    if (points > 0 && commas > 0) {
      // Both appear, so the later one is the decimal mark and the other groups the thousands.
      const decimal = digits.lastIndexOf(".") > digits.lastIndexOf(",") ? "." : ",";
      const grouping = decimal === "." ? "," : ".";
      return Number(digits.split(grouping).join("").replace(decimal, "."));
    }
    if (points > 1) {
      return Number(digits.split(".").join(""));
    }
    if (commas > 1) {
      return Number(digits.split(",").join(""));
    }
    if (points === 1) {
      return fromSingleSeparator(digits, ".", style.point);
    }
    if (commas === 1) {
      return fromSingleSeparator(digits, ",", style.comma);
    }
    return Number(digits);
  })();
  return value === null || !Number.isFinite(value) ? null : sign * value;
}

/** `1.250.000`, `1.250.000,50` — evidence that only a point-thousands sheet produces. */
const MULTI_POINT = /^\d{1,3}(?:\.\d{3}){2,}(?:,\d+)?$/;
const MULTI_COMMA = /^\d{1,3}(?:,\d{3}){2,}(?:\.\d+)?$/;
/** `12,5`, `0,25` — a comma with one or two digits behind it is a decimal mark, never a group. */
const COMMA_DECIMAL = /^\d+,(?:\d{1,2}|\d{4,})$/;
const POINT_DECIMAL = /^\d+\.(?:\d{1,2}|\d{4,})$/;
/** `120.000` on its own: thousands in Jakarta, three decimals in New York. The sheet decides. */
const AMBIGUOUS_POINT_GROUP = /^\d{1,3}(?:\.\d{3})+$/;
/** `0.250`, `0,25`: nothing groups thousands behind a lone zero, so this is always a decimal mark. */
const LEADING_ZERO_DECIMAL = /^0([.,])\d+$/;

type Evidence = { point: PointStyle | null; comma: PointStyle | null };

function evidenceOf(body: string): Evidence {
  if (MULTI_POINT.test(body)) {
    return { point: "thousands", comma: null };
  }
  if (MULTI_COMMA.test(body)) {
    return { point: null, comma: "thousands" };
  }
  if (body.includes(".") && body.includes(",")) {
    // One of each: whichever comes last is the decimal mark, so the other groups thousands.
    const decimalIsPoint = body.lastIndexOf(".") > body.lastIndexOf(",");
    return decimalIsPoint ? { point: "decimal", comma: "thousands" } : { point: "thousands", comma: "decimal" };
  }
  const zero = LEADING_ZERO_DECIMAL.exec(body);
  if (zero) {
    return zero[1] === "." ? { point: "decimal", comma: null } : { point: null, comma: "decimal" };
  }
  if (COMMA_DECIMAL.test(body)) {
    return { point: null, comma: "decimal" };
  }
  return POINT_DECIMAL.test(body) ? { point: "decimal", comma: null } : { point: null, comma: null };
}

function firstVote(votes: ReadonlyArray<PointStyle | null>): PointStyle | null {
  return votes.find((vote) => vote !== null) ?? null;
}

/**
 * Decided once per sheet, never per cell, and separately for each separator. A sheet that writes
 * `1.250.000,50` or `12,5` anywhere reads a bare `750.000` as 750,000 too; a sheet that writes
 * `1,250.75` reads `12.500` as 12.5. With no evidence at all, a bare three-digit point group is
 * still thousands — money is written `120.50`, not `120.000` — and a comma group is thousands too.
 */
export function sheetNumberStyle(rows: ReadonlyArray<ReadonlyArray<string>>): NumberStyle {
  const bodies = rows.flatMap((row) => row.map(magnitudeText)).filter((body) => body !== "");
  const evidence = bodies.map(evidenceOf);
  const comma = firstVote(evidence.map((item) => item.comma)) ?? "thousands";
  const point =
    firstVote(evidence.map((item) => item.point)) ??
    // A sheet that uses the comma as its decimal mark is writing points as thousands.
    (comma === "decimal" || bodies.some((body) => AMBIGUOUS_POINT_GROUP.test(body)) ? "thousands" : "decimal");
  return { point, comma };
}

/** Back-compatible view of {@link sheetNumberStyle}: what a bare `1.250` means in this sheet. */
export function sheetPointStyle(rows: ReadonlyArray<ReadonlyArray<string>>): PointStyle {
  return sheetNumberStyle(rows).point;
}

function asNumberStyle(style: PointStyle | NumberStyle): NumberStyle {
  return typeof style === "string" ? { point: style, comma: "thousands" } : style;
}

function formatPlain(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

/**
 * One cell to a plain figure: "Rp 1.250.000,50" → "Rp 1250000.5", "(750.000)" → "-750000",
 * " Rp7,570,000,000 " → "Rp 7570000000", "12,5%" → "12.5%". Null when the cell is not a number, so
 * the caller keeps the text as written. `style` only decides what a lone `1.250` or `1,250` means.
 */
export function normalizeAmount(raw: string, style: PointStyle | NumberStyle = "decimal"): string | null {
  const { negated, parts } = cellParts(raw);
  if (parts.body === "") {
    return null;
  }
  const sheet = asNumberStyle(style);
  // "Rp 1.250" is 1250 in any sheet: the rupiah mark is itself the statement that points group.
  const rupiah = RUPIAH.test(parts.code) || RUPIAH.test(parts.mark);
  const value = parseGrouped(parts.body, rupiah ? { ...sheet, point: "thousands" } : sheet);
  if (value === null) {
    return null;
  }
  const signed = negated && value !== 0 ? -value : value;
  const prefix = parts.code ? `${parts.code.toUpperCase()} ` : parts.mark ? `${parts.mark} ` : "";
  return `${prefix}${formatPlain(signed)}${PERCENT_SUFFIX.test(parts.inner) ? "%" : ""}`;
}

/** The value a cell carries, with no currency mark or percent sign in the way. */
export function cellValue(raw: string, style: PointStyle | NumberStyle = "decimal"): number | null {
  const { negated, parts } = cellParts(raw);
  if (parts.body === "") {
    return null;
  }
  const sheet = asNumberStyle(style);
  const rupiah = RUPIAH.test(parts.code) || RUPIAH.test(parts.mark);
  const value = parseGrouped(parts.body, rupiah ? { ...sheet, point: "thousands" } : sheet);
  if (value === null) {
    return null;
  }
  return negated && value !== 0 ? -value : value;
}
