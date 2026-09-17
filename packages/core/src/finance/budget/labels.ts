/**
 * How two differently worded line labels are compared, locally.
 *
 * A budget sheet and an actuals sheet are written by different people in different months, so the
 * same line reads "Gaji & tunjangan karyawan" on one and "Beban gaji" on the other. Matching them on
 * string equality pairs nothing; matching them on a model's opinion pairs things nobody can argue
 * with. So the first two stages are a dictionary a reader can open: an acronym table ("ATK" is
 * "alat tulis kantor"), a finance synonym table in both languages, and a weighted token overlap that
 * counts the concept words fully and the filler words ("beban", "biaya", "dana") at a fifth.
 *
 * Character trigrams are the third local stage, for the typo an exact token never survives. They are
 * deliberately scored below token evidence: two labels that share letters but no words are a weak
 * claim, and a weak claim must not outrank a dictionary hit.
 */

/** A filler word still counts — it is evidence, just not much of it. */
export const GENERIC_TOKEN_WEIGHT = 0.2;
/** A concept word counts in full. */
export const CONTENT_TOKEN_WEIGHT = 1;
/** Trigram agreement is capped below a dictionary hit: shared letters are not shared meaning. */
export const TRIGRAM_DISCOUNT = 0.85;

const TRIGRAM_SIZE = 3;

/** Acronyms whose expansion is the only spelling the other sheet uses. */
const ACRONYMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  atk: ["alat", "tulis", "kantor"],
  rab: ["rencana", "anggaran", "biaya"],
  sdm: ["sumber", "daya", "manusia"],
  thr: ["tunjangan", "hari", "raya"],
  bpjs: ["jaminan", "sosial"],
  ppn: ["pajak"],
  pph: ["pajak"],
  pln: ["listrik"],
  pdam: ["air"],
  cogs: ["harga", "pokok"],
  opex: ["biaya", "operasional"],
  capex: ["belanja", "modal"],
  hpp: ["harga", "pokok"],
  it: ["teknologi"],
  hr: ["karyawan"],
  ga: ["umum"],
  rnd: ["riset"],
});

/**
 * The finance synonym dictionary: every member folds into the first word of its group, so two sheets
 * that name the same thing differently end up holding the same token.
 */
const SYNONYM_GROUPS: readonly (readonly string[])[] = Object.freeze([
  ["pendapatan", "penerimaan", "penghasilan", "hasil", "revenue", "revenues", "income", "sales", "turnover", "omzet", "omset"],
  ["biaya", "beban", "expense", "expenses", "cost", "costs", "charge", "charges", "pengeluaran", "belanja", "spend", "spending"],
  ["gaji", "upah", "salary", "salaries", "payroll", "wage", "wages", "tunjangan", "honorarium", "remunerasi"],
  ["sewa", "rent", "rental", "lease", "leasing"],
  ["utilitas", "utility", "utilities", "listrik", "electricity", "air", "water", "internet", "telepon", "telephone", "phone", "wifi"],
  ["kantor", "gedung", "office", "building", "ruangan"],
  ["perjalanan", "dinas", "travel", "trip", "transportasi", "transport", "transportation"],
  ["pelatihan", "training", "diklat", "workshop", "kursus", "course"],
  ["pemasaran", "marketing", "promosi", "promotion", "iklan", "advertising", "ads", "ad"],
  ["penyusutan", "depresiasi", "depreciation", "amortisasi", "amortization", "amortisation"],
  ["asuransi", "insurance"],
  ["pajak", "tax", "taxes"],
  ["bunga", "interest"],
  ["donasi", "donation", "donations", "sumbangan"],
  ["hibah", "grant", "grants"],
  ["korporasi", "korporat", "perusahaan", "corporate", "company", "companies", "enterprise"],
  ["individu", "perorangan", "pribadi", "personal", "individual"],
  ["beasiswa", "scholarship", "scholarships"],
  ["konsumsi", "katering", "catering", "jamuan", "meal", "meals", "refreshment"],
  ["rapat", "meeting", "meetings", "pertemuan"],
  ["perbaikan", "pemeliharaan", "perawatan", "repair", "repairs", "maintenance"],
  ["alat", "peralatan", "equipment", "tool", "tools"],
  ["tulis", "stationery"],
  ["persediaan", "inventaris", "inventory", "stok", "stock"],
  ["perangkat", "software", "aplikasi", "application", "apps"],
  ["bank", "banking", "perbankan"],
  ["profesional", "professional", "konsultan", "consultant", "consulting", "notaris", "audit"],
  ["cadangan", "reserve", "reserves", "contingency"],
  ["darurat", "emergency"],
  ["karyawan", "pegawai", "staf", "staff", "employee", "employees"],
  ["penyaluran", "pembayaran", "disbursement", "distribusi"],
  ["jasa", "layanan", "service", "services"],
  ["dana", "fund", "funds"],
]);

/** Canonical tokens that are filler: present in almost every label, so they decide almost nothing. */
const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  "pendapatan",
  "biaya",
  "dana",
  "jasa",
  "karyawan",
  "penyaluran",
  "program",
  "kegiatan",
  "jumlah",
  "total",
  "subtotal",
  "umum",
  "lain",
  "lainnya",
  "other",
  "others",
  "net",
  "gross",
  "line",
  "item",
  "items",
  "general",
  "misc",
  "dan",
  "and",
  "of",
  "for",
  "the",
  "per",
  "dari",
  "untuk",
  "di",
  "ke",
  "yang",
]);

function buildCanonical(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const group of SYNONYM_GROUPS) {
    const head = group[0];
    if (head === undefined) {
      continue;
    }
    for (const word of group) {
      map.set(word, head);
    }
  }
  return map;
}

const CANONICAL = buildCanonical();

/** The section and subtotal tags the spreadsheet importer writes in front of a label. */
const IMPORT_TAGS = /\[[^\]]*\]/g;

/** Lower case, tags gone, punctuation flattened: the one spelling every comparison uses. */
export function normaliseBudgetLabel(label: string): string {
  return label
    .replace(IMPORT_TAGS, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** One label as the set of canonical tokens it argues for, acronyms already expanded. */
export function budgetLabelTokens(label: string): readonly string[] {
  const words = normaliseBudgetLabel(label).split(" ").filter(Boolean);
  const expanded = words.flatMap((word) => ACRONYMS[word] ?? [word]);
  return [...new Set(expanded.map((word) => CANONICAL.get(word) ?? word))];
}

function tokenWeight(token: string): number {
  return GENERIC_TOKENS.has(token) ? GENERIC_TOKEN_WEIGHT : CONTENT_TOKEN_WEIGHT;
}

function weigh(tokens: Iterable<string>): number {
  let total = 0;
  for (const token of tokens) {
    total += tokenWeight(token);
  }
  return total;
}

/** Weighted Jaccard over canonical tokens: shared meaning divided by all the meaning on the table. */
export function tokenOverlapScore(left: string, right: string): number {
  const a = budgetLabelTokens(left);
  const b = new Set(budgetLabelTokens(right));
  const shared = a.filter((token) => b.has(token));
  const union = new Set([...a, ...b]);
  const total = weigh(union);
  return total === 0 ? 0 : weigh(shared) / total;
}

function trigrams(text: string): ReadonlySet<string> {
  const flat = text.replace(/ /g, "");
  if (flat.length < TRIGRAM_SIZE) {
    return new Set(flat === "" ? [] : [flat]);
  }
  const out = new Set<string>();
  for (let at = 0; at + TRIGRAM_SIZE <= flat.length; at += 1) {
    out.add(flat.slice(at, at + TRIGRAM_SIZE));
  }
  return out;
}

/** Dice coefficient over character trigrams — the stage that survives a typo. */
export function trigramScore(left: string, right: string): number {
  const a = trigrams(normaliseBudgetLabel(left));
  const b = trigrams(normaliseBudgetLabel(right));
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const gram of a) {
    if (b.has(gram)) {
      shared += 1;
    }
  }
  return (2 * shared) / (a.size + b.size);
}

/** Which stage produced a score. Shown to the reader beside every proposed pair. */
export type BudgetMatchStage = "exact" | "dictionary" | "trigram" | "embedding";

export type BudgetLabelScore = { readonly score: number; readonly stage: BudgetMatchStage };

/**
 * The local reading of two labels: exact first, then the dictionary, then trigrams. Nothing here
 * reaches the network, so this is also the answer when embeddings are unavailable.
 */
export function budgetLabelSimilarity(left: string, right: string): BudgetLabelScore {
  if (normaliseBudgetLabel(left) === normaliseBudgetLabel(right)) {
    return { score: 1, stage: "exact" };
  }
  const tokens = tokenOverlapScore(left, right);
  const letters = trigramScore(left, right) * TRIGRAM_DISCOUNT;
  return tokens >= letters ? { score: tokens, stage: "dictionary" } : { score: letters, stage: "trigram" };
}
