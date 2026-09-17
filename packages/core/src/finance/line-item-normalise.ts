/**
 * What a row *means*, in both languages, decided in code.
 *
 * Three questions, in order of how much they can be trusted:
 * 1. Its role — a tax line, an interest line, other income, a burn line, a contra-revenue line. These
 *    never belong in operating expenses, and putting them there is what turned an operating profit
 *    into something the brief called "net profit".
 * 2. Its section — `[BEBAN USAHA] Penyusutan` says "opex" far more reliably than "Penyusutan" does.
 * 3. Its name, against an Indonesian and English dictionary.
 *
 * Then one more pass that no dictionary can replace: a subtotal names its own parts. The rows a
 * "Total Cost of Revenue" adds up ARE the cost of revenue, whatever they are called, so the category
 * flows from the total down to the contiguous run above it. That is how "Hosting & Infrastructure"
 * becomes `cogs` without a model ever seeing the sheet.
 */
import { isTotalName } from "./derived-rows";
import { guessCategory } from "./line-items";
import type { LineItemCategory } from "./types";

/** The part a row plays that its category cannot carry. */
export type LineItemRole =
  | "contra_revenue"
  | "interest_expense"
  | "interest_income"
  | "tax"
  | "other_income"
  | "burn"
  | "depreciation"
  | "operating_cash_flow"
  | "investing_cash_flow"
  | "financing_cash_flow"
  | null;

const ROLE_PATTERNS: ReadonlyArray<readonly [RegExp, Exclude<LineItemRole, null>]> = [
  [/\b(?:beban pajak|pajak penghasilan|tax expense|income tax|provision for tax|pph)\b/i, "tax"],
  [/\b(?:beban bunga|bunga pinjaman|interest expense|interest paid|finance cost)\b/i, "interest_expense"],
  [/\b(?:pendapatan bunga|interest income|interest earned)\b/i, "interest_income"],
  [
    /\b(?:retur|potongan penjualan|diskon penjualan|sales returns?|returns? (?:and|&) allowances|sales discounts?|refunds?|rebates?)\b/i,
    "contra_revenue",
  ],
  [/\b(?:pendapatan lain-?lain|penghasilan lain-?lain|other income|non-?operating income)\b/i, "other_income"],
  [/\b(?:burn|cash burn|arus kas keluar bersih)\b/i, "burn"],
  [/\b(?:penyusutan|amortisasi|depreciation|amorti[sz]ation)\b/i, "depreciation"],
  // The three sections of a cash-flow statement. They are cash rows like any other — the role only
  // says WHICH cash they are, so free cash flow and the change in cash can be told apart from the
  // balance at the end of the year.
  [
    /\b(?:arus kas (?:bersih )?(?:dari |untuk )?(?:aktivitas )?operasi|kas (?:bersih )?dari (?:aktivitas )?operasi|operating cash ?flows?|cash ?flows? from operating|net cash (?:from|used in|provided by) operating)\b/i,
    "operating_cash_flow",
  ],
  [
    /\b(?:arus kas (?:bersih )?(?:dari |untuk )?(?:aktivitas )?investasi|kas (?:bersih )?(?:dari|untuk) (?:aktivitas )?investasi|investing cash ?flows?|cash ?flows? from investing|net cash (?:from|used in|provided by) investing)\b/i,
    "investing_cash_flow",
  ],
  [
    /\b(?:arus kas (?:bersih )?(?:dari |untuk )?(?:aktivitas )?(?:pendanaan|pembiayaan)|kas (?:bersih )?(?:dari|untuk) (?:aktivitas )?(?:pendanaan|pembiayaan)|financing cash ?flows?|cash ?flows? from financing|net cash (?:from|used in|provided by) financing)\b/i,
    "financing_cash_flow",
  ],
];

/** The role a label plays, or null when it is an ordinary line. */
export function roleOf(label: string): LineItemRole {
  return ROLE_PATTERNS.find(([pattern]) => pattern.test(label))?.[1] ?? null;
}

/** Roles that must stay out of every operating total, however their label reads. */
const NON_OPERATING_ROLES = new Set<LineItemRole>([
  "tax",
  "interest_expense",
  "interest_income",
  "other_income",
  "burn",
]);

export function isNonOperatingRole(role: LineItemRole): boolean {
  return NON_OPERATING_ROLES.has(role);
}

/** Indonesian and English hints, most specific first. English keeps `guessCategory` as its fallback. */
const CATEGORY_HINTS: ReadonlyArray<readonly [RegExp, LineItemCategory]> = [
  [/\b(?:harga pokok|hpp|bahan baku|tenaga kerja langsung|overhead pabrik|biaya produksi|beban pokok)\b/i, "cogs"],
  [/\bcost of (?:goods|sales|revenue)\b|\bdirect costs?\b/i, "cogs"],
  [
    /\b(?:beban usaha|beban operasional|beban penjualan|beban umum|gaji|tunjangan|upah|sewa|utilitas|listrik|pemasaran|promosi|iklan|transportasi|distribusi|penyusutan|amortisasi|administrasi|perjalanan|asuransi|perlengkapan|pemeliharaan)\b/i,
    "opex",
  ],
  [/\b(?:kas|setara kas|bank|saldo kas)\b/i, "cash"],
  [/\b(?:pinjaman|utang bank|hutang bank|kredit bank|obligasi)\b/i, "debt"],
  [/\b(?:modal|ekuitas|laba ditahan)\b/i, "equity"],
  [/\b(?:piutang|persediaan|aset|aktiva|inventaris)\b/i, "asset"],
  [/\b(?:liabilitas|kewajiban|utang usaha|hutang usaha|beban akrual)\b/i, "liability"],
  [/\b(?:pendapatan|penjualan|omzet|omset|penerimaan)\b/i, "revenue"],
];

/**
 * Most specific first, and revenue last: "HARGA POKOK PENJUALAN" contains "PENJUALAN", so a section
 * list that asked about revenue first would file every cost of goods row under sales.
 */
const SECTION_HINTS: ReadonlyArray<readonly [RegExp, LineItemCategory]> = [
  [/\b(?:harga pokok|hpp|beban pokok|cost of revenue|cost of sales|cost of goods|cogs)\b/i, "cogs"],
  [/\b(?:beban|biaya|operating expenses?|opex|expenses?|costs?)\b/i, "opex"],
  [/\b(?:kas|cash)\b/i, "cash"],
  [/\b(?:liabilitas|kewajiban|liabilit)\b/i, "liability"],
  [/\b(?:ekuitas|equity|modal)\b/i, "equity"],
  [/\b(?:pinjaman|utang bank|debt|borrowings?)\b/i, "debt"],
  [/\b(?:aset|aktiva|assets?)\b/i, "asset"],
  [/\b(?:pendapatan|penjualan|revenue|sales)\b/i, "revenue"],
];

/**
 * A section path reads inside out: `ASET / Aset Lancar` is current assets, and `Revenue / Cash` is
 * cash — the outermost heading is only the page the row was printed on.
 */
export function categoryForSection(section: string): LineItemCategory | null {
  const parts = section
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of [...parts].reverse()) {
    const found = SECTION_HINTS.find(([pattern]) => pattern.test(part))?.[1];
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * The category a label and its section imply. Roles that are not operating lines answer `other`,
 * because no monetary total in the engine may absorb a tax charge or a burn figure. The section wins
 * over the label: a sheet that grouped its own rows knows more than any dictionary does.
 */
export function categoryFor(label: string, section = ""): LineItemCategory {
  const role = roleOf(label);
  if (role === "contra_revenue") {
    return "revenue";
  }
  if (role !== null && isNonOperatingRole(role)) {
    return "other";
  }
  const sectioned = section ? categoryForSection(section) : null;
  if (sectioned) {
    return sectioned;
  }
  return CATEGORY_HINTS.find(([pattern]) => pattern.test(label))?.[1] ?? guessCategory(label);
}

export type CategorisedRow = {
  readonly label: string;
  readonly section?: string;
  readonly derived?: boolean;
};

/**
 * The category each row carries once its own name, its section and the subtotal above it have all had
 * a say. `rows` is one entry per sheet row, in sheet order.
 */
export function categoriseRows(rows: readonly CategorisedRow[]): LineItemCategory[] {
  const own = rows.map((row) => categoryFor(row.label, row.section ?? ""));
  const out = [...own];
  let runFrom = 0;
  rows.forEach((row, index) => {
    if (row.derived !== true) {
      return;
    }
    const parent = own[index];
    if (isTotalName(row.label) && parent && parent !== "other") {
      for (let at = runFrom; at < index; at += 1) {
        if (rows[at]?.derived !== true && roleOf(rows[at]?.label ?? "") === null) {
          out[at] = parent;
        }
      }
    }
    runFrom = index + 1;
  });
  return out;
}

/**
 * The magnitude of a set of amounts written under one convention. A sheet that writes every cost
 * negative gets its costs back as positive magnitudes; a sheet that mixes signs is summed as written,
 * because there the signs carry meaning (a contra-revenue line inside revenue).
 */
export function conventionTotal(amounts: readonly number[]): number | null {
  if (amounts.length === 0) {
    return null;
  }
  const sum = amounts.reduce((total, amount) => total + amount, 0);
  return sum < 0 && amounts.every((amount) => amount <= 0) ? -sum : sum;
}

/** The same convention for a single figure: a cost written as -289,080,000 is a charge of 289,080,000. */
export function costMagnitude(amount: number): number {
  return Math.abs(amount);
}
