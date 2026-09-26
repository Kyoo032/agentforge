/**
 * The dictionary that places a statement row without asking a model.
 *
 * Read it as one ordered list: the first rule whose pattern matches the normalised label wins, so
 * the order is the meaning. `Beban Penyusutan dan Amortisasi` has to be seen as depreciation before
 * the generic "anything starting with Beban is an operating expense" rule gets to it, and
 * `Bagian Lancar Utang Jangka Panjang` has to be seen as the current portion of a term loan before
 * the words "jangka panjang" send it to long-term debt.
 *
 * Every pattern is matched against a label that has already been lowercased and had its punctuation
 * flattened to single spaces (see `normalizeRatioLabel`), so patterns spell things with spaces and
 * never with hyphens or brackets. Indonesian and English spellings sit in the same rule on purpose:
 * one sheet routinely mixes them.
 *
 * Confidences are a statement about the *evidence*, not about the company: a rule that keys off an
 * unambiguous term ("persediaan") scores higher than one that keys off a prefix ("beban ...").
 */
import type { RatioBucket } from "./buckets";

export type RatioLabelRule = {
  readonly id: string;
  readonly bucket: RatioBucket;
  readonly confidence: number;
  readonly pattern: RegExp;
  /** When this also matches, the rule stands down — "utang bank" is not cash, however much "bank" it says. */
  readonly veto?: RegExp;
};

export const RATIO_LABEL_RULES: readonly RatioLabelRule[] = Object.freeze([
  {
    id: "contra-accumulated",
    bucket: "contra-asset",
    confidence: 0.97,
    pattern:
      /\b(akumulasi|accumulated)\s+(penyusutan|depresiasi|amortisasi|amorti[sz]ation|depreciation|impairment)\b|\b(penyisihan|cadangan)\s+(kerugian\s+)?piutang\b|allowance for (doubtful|impairment)/,
  },
  {
    id: "accrued-liability",
    bucket: "current-liability",
    confidence: 0.94,
    pattern: /(beban|biaya) yang masih harus dibayar|utang beban|accrued (expense|liabilit|charge)/,
  },
  {
    id: "prepaid-asset",
    bucket: "other-current-asset",
    confidence: 0.93,
    pattern: /dibayar di ?muka|prepaid|prepayment/,
  },
  {
    id: "principal-repayment",
    bucket: "principal-repayment",
    confidence: 0.95,
    pattern:
      /(pembayaran|angsuran|pelunasan|cicilan) pokok|pokok pinjaman|principal (repayment|payment|amorti)|repayment of (loan )?principal/,
  },
  {
    id: "depreciation-expense",
    bucket: "depreciation",
    confidence: 0.94,
    pattern:
      /(beban|biaya) (penyusutan|depresiasi|amortisasi)|penyusutan dan amortisasi|depreciation and amorti|\bdepreciation\b|\bamorti[sz]ation\b/,
  },
  {
    id: "interest-expense",
    bucket: "interest",
    confidence: 0.95,
    pattern: /(beban|biaya) bunga|bunga (pinjaman|bank|utang)|interest (expense|cost|paid|charge)|finance cost/,
  },
  {
    id: "tax-expense",
    bucket: "tax",
    confidence: 0.94,
    pattern: /(beban|biaya) pajak|pajak penghasilan|income tax|tax expense|\bpph\b/,
    veto: /\b(utang|hutang)\b|payable/,
  },
  {
    id: "cost-of-sales",
    bucket: "cogs",
    confidence: 0.95,
    pattern:
      /harga pokok (penjualan|produksi)|beban pokok (penjualan|pendapatan)|\bhpp\b|cost of (goods sold|sales|revenue)|\bcogs\b/,
  },
  {
    id: "other-income",
    bucket: "other-income",
    confidence: 0.88,
    pattern: /lain lain|other (income|expense|gain|charge)|non operating|pendapatan lain|beban lain/,
  },
  {
    id: "cash",
    bucket: "cash",
    confidence: 0.95,
    pattern: /\bkas\b|setara kas|cash and cash equivalent|\bcash\b|\bbank\b|\bdeposito\b/,
    veto: /\b(utang|hutang|pinjaman|kredit)\b|payable|\bloan\b|\bdebt\b|arus kas|cash flow/,
  },
  { id: "receivables", bucket: "receivables", confidence: 0.94, pattern: /\bpiutang\b|receivable/ },
  {
    id: "inventory",
    bucket: "inventory",
    confidence: 0.95,
    pattern: /persediaan|inventor(y|ies)|barang (jadi|dagang)|stock in trade/,
  },
  {
    id: "current-portion-ltd",
    bucket: "current-portion-ltd",
    confidence: 0.96,
    pattern: /bagian lancar|bagian jangka pendek|current (portion|maturit)/,
  },
  {
    id: "short-term-debt",
    bucket: "short-term-debt",
    confidence: 0.92,
    pattern:
      /(utang|hutang|pinjaman|kredit|wesel)[^|]*jangka pendek|short term (bank )?(loan|debt|borrowing|note)|wesel bayar|(utang|hutang) bank(?! jangka panjang)/,
  },
  {
    id: "long-term-debt",
    bucket: "long-term-debt",
    confidence: 0.93,
    pattern:
      /(utang|hutang|pinjaman|kredit|obligasi)[^|]*jangka panjang|long term (loan|debt|borrowing)|\bobligasi\b|bonds? payable|sewa pembiayaan|lease liabilit/,
  },
  {
    id: "other-noncurrent-liability",
    bucket: "other-noncurrent-liability",
    confidence: 0.9,
    pattern:
      /imbalan (pasca ?)?kerja|liabilitas imbalan|employee benefit|pajak tangguhan|deferred tax liabilit|provisi jangka panjang|liabilitas jangka panjang lain/,
  },
  // Whole-label totals a person types in one sentence. They sit above the generic "utang" rule so
  // a bare "utang" is the debt they named, while "utang usaha" stays a payable.
  {
    id: "stated-current-assets",
    bucket: "other-current-asset",
    confidence: 0.91,
    pattern: /^(?:jumlah |total )?(?:current assets|aset lancar)$/,
  },
  {
    id: "stated-current-liabilities",
    bucket: "current-liability",
    confidence: 0.91,
    pattern: /^(?:jumlah |total )?(?:current liabilities|liabilitas lancar|kewajiban lancar)$/,
  },
  {
    id: "stated-debt",
    bucket: "long-term-debt",
    confidence: 0.9,
    pattern: /^(?:jumlah |total )?(?:debt|utang|hutang|pinjaman|borrowings)$/,
  },
  {
    id: "stated-ebitda",
    bucket: "ebitda",
    confidence: 0.92,
    pattern: /^ebitda$/,
  },
  {
    id: "payables",
    bucket: "current-liability",
    confidence: 0.9,
    pattern: /\b(utang|hutang)\b|payable|liabilitas jangka pendek|current liabilit/,
  },
  {
    id: "equity",
    bucket: "equity",
    confidence: 0.93,
    pattern:
      /\bekuitas\b|\bmodal\b|saldo laba|laba ditahan|retained earnings|share capital|paid in capital|\bequity\b|agio saham|kepentingan non ?pengendali/,
  },
  {
    id: "fixed-asset",
    bucket: "fixed-asset",
    confidence: 0.92,
    pattern:
      /\btanah\b|bangunan|gedung|\bmesin\b|peralatan|kendaraan|inventaris|aset tetap|propert(y|i)|plant and equipment|machinery|building|\bland\b|vehicle|furniture|aset dalam penyelesaian/,
  },
  {
    id: "other-noncurrent-asset",
    bucket: "other-noncurrent-asset",
    confidence: 0.88,
    pattern: /tak berwujud|intangible|goodwill|deferred tax asset|investasi jangka panjang|aset (tidak lancar|lain)/,
  },
  {
    id: "operating-expense",
    bucket: "opex",
    confidence: 0.86,
    pattern:
      /^(beban|biaya)\b|beban (usaha|operasional|penjualan|umum|administrasi)|operating expense|selling expense|general and admin|\bsg&a\b|\bopex\b|\bgaji\b|payroll|\bsewa\b|pemasaran|marketing expense/,
  },
  {
    id: "revenue",
    bucket: "revenue",
    confidence: 0.9,
    pattern: /penjualan|pendapatan|\bomzet\b|\brevenue\b|net sales|\bsales\b|turnover/,
  },
]);

export type RatioSectionRule = { readonly id: string; readonly bucket: RatioBucket; readonly pattern: RegExp };

/**
 * The importer keeps the sheet's own headings (`[ASET / Aset Lancar] Kas dan Setara Kas`), which is
 * the second-best evidence there is: it says which half of the statement a row was printed under
 * even when nothing in the label itself does.
 */
export const RATIO_SECTION_RULES: readonly RatioSectionRule[] = Object.freeze([
  { id: "section-current-asset", bucket: "other-current-asset", pattern: /aset lancar|current asset/ },
  {
    id: "section-noncurrent-asset",
    bucket: "other-noncurrent-asset",
    pattern: /aset tidak lancar|aset tetap|non ?current asset|fixed asset/,
  },
  {
    id: "section-current-liability",
    bucket: "current-liability",
    pattern: /liabilitas jangka pendek|utang jangka pendek|current liabilit/,
  },
  {
    id: "section-noncurrent-liability",
    bucket: "other-noncurrent-liability",
    pattern: /liabilitas jangka panjang|non ?current liabilit|long ?term liabilit/,
  },
  { id: "section-equity", bucket: "equity", pattern: /\bekuitas\b|\bequity\b/ },
  { id: "section-opex", bucket: "opex", pattern: /beban usaha|beban operasi|operating expense/ },
  { id: "section-revenue", bucket: "revenue", pattern: /pendapatan|penjualan|revenue/ },
]);

/** Confidence a section heading earns on its own: enough to show, not enough to leave unread. */
export const RATIO_SECTION_CONFIDENCE = 0.6;
/** Confidence the brief's own line-item category earns when nothing else placed the row. */
export const RATIO_CATEGORY_CONFIDENCE = 0.45;
/** Confidence a row keeps when nothing placed it at all. The studio asks for a bucket. */
export const RATIO_UNKNOWN_CONFIDENCE = 0.15;
