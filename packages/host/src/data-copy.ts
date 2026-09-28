import { parseAppLocale, type AppLocale } from "@agentforge/core";

/**
 * Host copy for the Data harness. The same strings live in
 * `apps/web/locales/{en,id}/data.json` under `harness` — the host does not import those catalogs.
 */
const COPY = {
  en: {
    cutting: "Choosing the cuts",
    analyzing: "Querying with SQL",
    repairing: "Rewriting a sentence the query does not support",
    verifying: "Checking sentences against the queries",
    cannotForecast: "This sheet cannot forecast. The figures are the cuts the columns support.",
    cannotOtherTable: "This sheet is one table. The figures are the cuts its columns support.",
    fallbackTitle: "What this sheet shows",
    fallbackSummary: "Every figure below is a query result.",
    blanks: "Blank cells",
    rowsTitle: "Rows in this sheet",
    noRows: "The query returned no rows.",
    cutsFailed: "The sheet could not be queried.",
    repair:
      "Rewrite the JSON. The previous draft used a number or a query the results do not support. Copy figures only from the cut results. Do not forecast and do not use another table.",
    invalidJson: "The previous draft was not valid JSON.",
    noFindings: "The previous draft had no findings.",
    by: (measure: string, group: string) => `${measure} by ${group}`,
    over: (measure: string, when: string) => `${measure} over ${when}`,
    split: (group: string) => `Rows by ${group}`,
    queryRows: (count: number) => (count === 1 ? `${count} row` : `${count} rows`),
    queryFailed: (error: string) => `failed: ${error}`,
  },
  id: {
    cutting: "Memilih potongan",
    analyzing: "Mengueri dengan SQL",
    repairing: "Menulis ulang kalimat yang kuerinya tidak mendukung",
    verifying: "Mencocokkan kalimat dengan kueri",
    cannotForecast: "Lembar ini tidak bisa meramalkan. Angka di bawah adalah potongan yang kolomnya mendukung.",
    cannotOtherTable: "Lembar ini satu tabel. Angka di bawah adalah potongan yang kolomnya mendukung.",
    fallbackTitle: "Isi lembar ini",
    fallbackSummary: "Setiap angka di bawah adalah hasil kueri.",
    blanks: "Sel kosong",
    rowsTitle: "Baris pada lembar ini",
    noRows: "Kueri tidak mengembalikan baris.",
    cutsFailed: "Lembar ini tidak bisa dikueri.",
    repair:
      "Tulis ulang JSON. Draf sebelumnya memakai angka atau kueri yang hasilnya tidak mendukung. Salin angka hanya dari hasil potongan. Jangan meramalkan dan jangan memakai tabel lain.",
    invalidJson: "Draf sebelumnya bukan JSON yang valid.",
    noFindings: "Draf sebelumnya tidak punya temuan.",
    by: (measure: string, group: string) => `${measure} menurut ${group}`,
    over: (measure: string, when: string) => `${measure} sepanjang ${when}`,
    split: (group: string) => `Baris menurut ${group}`,
    queryRows: (count: number) => `${count} baris`,
    queryFailed: (error: string) => `gagal: ${error}`,
  },
} as const;

export function dataCopy(locale: AppLocale) {
  return COPY[parseAppLocale(locale)];
}
