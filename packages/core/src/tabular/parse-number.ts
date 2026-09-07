/**
 * Locale-tolerant number parsing.
 *
 * Accepted shapes (after an optional sign, an optional currency mark `$ € £ Rp`, and an optional trailing `%`):
 * - `1234`, `12.5`, `.5`                      plain, decimal point
 * - `1,234.56`                                comma thousands, point decimal
 * - `1.234,56`, `1.234.567`, `Rp 12.000`      point thousands (comma decimal); a single point group counts as
 *                                             thousands only with a comma decimal, several groups, or the `Rp` mark
 * - `1 234,56`, `1 234.5`                     space thousands
 * - `12,5`                                    comma decimal without grouping
 *
 * `%` is NOT applied: `"12%"` parses to `12`, `"-3%"` to `-3` (face value, so profiles stay in the unit the sheet shows).
 */

const PREFIX = /^([+-]?)\s*(\$|€|£|Rp)?\s*([+-]?)\s*/;
const PERCENT_SUFFIX = /\s*%$/;
const PLAIN = /^(\d+(\.\d+)?|\.\d+)$/;
const COMMA_GROUPS = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const POINT_GROUPS = /^\d{1,3}(\.\d{3})+(,\d+)?$/;
const SPACE_GROUPS = /^\d{1,3}( \d{3})+([.,]\d+)?$/;
const DECIMAL_COMMA = /^\d+,\d+$/;
const POINT_THOUSANDS_CURRENCY = "Rp";

function usesPointThousands(body: string, currency: string): boolean {
  if (!POINT_GROUPS.test(body)) {
    return false;
  }
  return body.includes(",") || currency === POINT_THOUSANDS_CURRENCY || body.split(".").length > 2;
}

function parseMagnitude(body: string, currency: string): number | null {
  if (usesPointThousands(body, currency)) {
    return Number(body.replace(/\./g, "").replace(",", "."));
  }
  if (PLAIN.test(body)) {
    return Number(body);
  }
  if (COMMA_GROUPS.test(body)) {
    return Number(body.replace(/,/g, ""));
  }
  if (SPACE_GROUPS.test(body)) {
    return Number(body.replace(/ /g, "").replace(",", "."));
  }
  if (DECIMAL_COMMA.test(body)) {
    return Number(body.replace(",", "."));
  }
  return null;
}

export function parseNumber(raw: string): number | null {
  const text = raw.trim();
  const prefix = PREFIX.exec(text);
  if (!prefix) {
    return null;
  }
  const [matched, signBefore, currency, signAfter] = prefix;
  if (signBefore && signAfter) {
    return null;
  }
  const body = text.slice(matched.length).replace(PERCENT_SUFFIX, "");
  const magnitude = parseMagnitude(body, currency ?? "");
  if (magnitude === null || !Number.isFinite(magnitude)) {
    return null;
  }
  const negative = signBefore === "-" || signAfter === "-";
  return negative && magnitude !== 0 ? -magnitude : magnitude;
}
