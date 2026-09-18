/**
 * Which column of a finance table identifies a person, read from its header and nothing else.
 *
 * Free-text name detection is deliberately absent. A guesser would have to decide whether
 * "Pendapatan Budi" is a person or a revenue line, and a wrong guess costs the brief a number —
 * so a name is only a name when the column above it says so.
 */
import type { PiiKind } from "../security/pii";
import { isPeriodHeader, isPeriodLabel } from "./import-table/periods";

export type FinanceColumnKind = Extract<PiiKind, "name" | "nik" | "npwp" | "account" | "phone" | "email">;

/** Stable, order-of-appearance pseudonym so per-person rows stay distinguishable after redaction. */
export const FINANCE_NAME_PSEUDONYM_PREFIX = "Karyawan";

const NIK_HEADER_RE = /\b(?:nik|ktp)\b|no\.?\s*ktp|nomor\s*induk\s*kependudukan/i;
const NPWP_HEADER_RE = /\bnpwp\b|nomor\s*pokok\s*wajib\s*pajak/i;

/**
 * An amount header outranks every rule below it: a column of money is never an identifying column,
 * whatever else its words say. "Gaji Karyawan" is a payroll amount, not a person.
 */
const AMOUNT_HEADER_RE =
  /(jumlah|amount|total|gaji|salary|nominal|saldo|balance|harga|price|biaya|cost|nilai|value|debit|kredit|credit|pendapatan|revenue|beban|expense|bonus|tunjangan|allowance|potongan|deduction|netto|bruto|gross|upah|wage|qty|kuantitas|unit|jam|hour|persen|percent|rate)/i;

const EMAIL_HEADER_RE = /\b(?:e-?mail|surel)\b/i;
const PHONE_HEADER_RE = /\b(?:telp|telepon|telephone|phone|hp|handphone|wa|whatsapp|mobile|seluler)\b|no\.?\s*hp/i;
const NAME_HEADER_RE = /\b(?:nama|name|karyawan|employee|pegawai|penerima|payee|staff)\b/i;

/** "Nama Akun", "Account Name", "Nama Barang" title a ledger line, not a person. */
const NAME_HEADER_VETO_RE =
  /\b(?:akun|account|perkiraan|barang|item|produk|product|jasa|service|proyek|project|bank|pos|kategori|category|sheet|kolom|column|file|berkas|dokumen|document|periode|period|mata\s*uang|currency)\b/i;

/**
 * An account NUMBER, never a bank's name. "Bank" on its own titles the column that says where the
 * money went ("Bank Nusantara Sejahtera") — masking that as `[account]` hid a fact that identifies
 * nobody and cost the reader the payout route, so the word only counts with a number word beside it.
 */
const ACCOUNT_HEADER_RE =
  /no\.?\s*rek|nomor\s*rek|\b(?:rekening|norek|acct)\b|a\/c|account\s*(?:no\.?|number|#)|\bbank\s*(?:account|acct|a\/c|no\.?|number|#)/i;

/**
 * True when a column holds figures: a header that names money, or one that names a period.
 *
 * The period half is not decoration. A profit-and-loss sheet heads its columns `2024` and `2023`, a
 * projection heads them `Tahun 3`, a budget `Q1 Budget` — no word in any of them says "amount", so
 * the 2024 cost of sales under the first of those fell through to free-text masking and came back
 * `[phone])`. The importer already knows these shapes (`./import-table/periods.ts`), so they are read
 * from there rather than spelled again here.
 */
export function financeHeaderIsAmount(header: string): boolean {
  const text = header.trim();
  if (text === "" || NIK_HEADER_RE.test(text) || NPWP_HEADER_RE.test(text)) {
    return false;
  }
  return AMOUNT_HEADER_RE.test(text) || isPeriodLabel(text) || isPeriodHeader(text);
}

/**
 * The kind a whole column carries, or `null` when the column holds figures or ordinary labels.
 * Order matters: the two tax/identity headers are read before the amount veto (so "Nomor Pokok
 * Wajib Pajak" is not thrown away as a tax amount), and everything else is read after it.
 */
export function classifyFinanceHeader(header: string): FinanceColumnKind | null {
  const text = header.trim();
  if (text === "") {
    return null;
  }
  if (NIK_HEADER_RE.test(text)) {
    return "nik";
  }
  if (NPWP_HEADER_RE.test(text)) {
    return "npwp";
  }
  if (financeHeaderIsAmount(text)) {
    return null;
  }
  if (EMAIL_HEADER_RE.test(text)) {
    return "email";
  }
  if (PHONE_HEADER_RE.test(text)) {
    return "phone";
  }
  if (NAME_HEADER_RE.test(text) && !NAME_HEADER_VETO_RE.test(text)) {
    return "name";
  }
  return ACCOUNT_HEADER_RE.test(text) ? "account" : null;
}

/**
 * A pseudonym allocator for one scan. The same spelling always gets the same number within a scan
 * and the numbers follow first appearance, so totals still group per person after redaction.
 */
export function pseudonymAllocator(): (value: string) => string {
  const seen = new Map<string, string>();
  return (value: string) => {
    const key = value.trim().toLowerCase();
    const known = seen.get(key);
    if (known) {
      return known;
    }
    const next = `${FINANCE_NAME_PSEUDONYM_PREFIX} ${seen.size + 1}`;
    seen.set(key, next);
    return next;
  };
}
