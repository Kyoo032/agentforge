import type { FindingKind } from "./types";
import type { LegalLocale } from "./locale";

export type LegalOutputCopy = {
  stubError: string;
  unsupportedFile: string;
  closingLine: string;
  memoTitle: string;
  privilegeLine: string;
  headerTo: string;
  headerFrom: string;
  headerDate: string;
  headerRe: string;
  firmLabel: string;
  summaryHeading: string;
  fallbackSummary: string;
  missingWhy: string;
  unmarkedTitle: string;
  unmarkedAdded: string;
  unmarkedPrior: string;
  noPriorTurn: string;
  unmarkedChanges: string;
  noClauses: string;
  allMapped: string;
  noPlaybook: string;
  noHighSeverity: string;
  noRedlineBytes: string;
  droppedOutput: string;
  instructingAuthor: string;
  skipped: string;
  roundOf: string;
  passedFailed: string;
  reservedFor: string;
  noCitation: string;
  findingNotFound: string;
  noneIdentified: string;
  positionLine: string;
  basisComment: string;
  deviationsSheet: string;
  summarySheet: string;
  sheetMatter: string;
  sheetPosition: string;
  sheetFindings: string;
  sheetReserved: string;
  sheetSeverity: string;
  sheetKind: string;
  sheetCount: string;
  verificationHeading: string;
  verificationNotRun: string;
  allChecksPassed: string;
  someChecksFailed: string;
  checkPassed: string;
  checkFailed: string;
  roundLine: string;
  memoColumns: readonly string[];
  deviationColumns: readonly string[];
  findingColumns: readonly string[];
  reservedColumns: readonly string[];
  redFlagSections: readonly string[];
  kindLabels: Readonly<Record<FindingKind, string>>;
  phase: Readonly<Record<string, string>>;
};

const EN: LegalOutputCopy = {
  stubError: "Legal needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
  unsupportedFile: "Only .docx files are accepted in v1. Convert PDF or other formats to .docx first.",
  closingLine: "Draft work product prepared with automated assistance for review by a qualified lawyer.",
  memoTitle: "MEMORANDUM",
  privilegeLine: "PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT",
  headerTo: "To",
  headerFrom: "From",
  headerDate: "Date",
  headerRe: "Re",
  firmLabel: "Firm",
  summaryHeading: "Summary",
  fallbackSummary: "{party} reviewed the counterparty draft against {counterparty}.",
  missingWhy: 'Required provision "{title}" is not present in the counterparty draft.',
  unmarkedTitle: "Unmarked change",
  unmarkedAdded: "Paragraph added without a tracked change.",
  unmarkedPrior: "Prior text: {before}",
  noPriorTurn: "No prior turn to compare",
  unmarkedChanges: "{count} unmarked changes",
  noClauses: "No clauses to review",
  allMapped: "All checklist items mapped",
  noPlaybook: "No playbook",
  noHighSeverity: "No high-severity findings",
  noRedlineBytes: "No original bytes for redline",
  droppedOutput: "Dropped invalid model output after retry",
  instructingAuthor: "instructing author",
  skipped: "skipped",
  roundOf: "Round {round} of {total}",
  passedFailed: "{passed} passed, {failed} failed",
  reservedFor: "Reserved for {who}",
  noCitation: "no citation recorded",
  findingNotFound: "[finding not found]",
  noneIdentified: "None identified.",
  positionLine: "Acting for {party} ({role}) against {counterparty}.",
  basisComment: "{title}. Basis: {basis}.",
  deviationsSheet: "Deviations",
  summarySheet: "Summary",
  sheetMatter: "Matter",
  sheetPosition: "Position",
  sheetFindings: "Findings",
  sheetReserved: "Reserved for partner decision",
  sheetSeverity: "Severity",
  sheetKind: "Kind",
  sheetCount: "Count",
  verificationHeading: "Verification",
  verificationNotRun: "Verification was not run.",
  allChecksPassed: "All code checks passed.",
  someChecksFailed: "One or more code checks failed.",
  checkPassed: "passed",
  checkFailed: "failed",
  roundLine: "Round {round}. {outcome}",
  memoColumns: ["Clause", "Provision", "Why adverse", "Severity", "Proposed language", "Basis"],
  deviationColumns: [
    "Clause",
    "Kind",
    "Title",
    "Provision (quote)",
    "Why adverse",
    "Severity",
    "Negotiability",
    "Proposed language",
    "Basis",
    "Reserved for",
  ],
  findingColumns: ["Clause", "Title", "Severity", "Negotiability", "Why adverse", "Proposed language", "Basis"],
  reservedColumns: ["Clause", "Title", "Severity", "Reserved for", "Why adverse", "Basis"],
  redFlagSections: [
    "Adverse provisions",
    "Missing provisions",
    "Unmarked changes",
    "Interactions",
    "Reserved for partner decision",
  ],
  kindLabels: {
    adverse: "Adverse provision",
    deviation: "Deviation from playbook",
    "unmarked-change": "Unmarked change",
    interaction: "Interaction",
    missing: "Missing provision",
    ok: "Conforms",
  },
  phase: {
    classify: "Classifying documents",
    diff: "Comparing with the prior turn",
    review: "Reviewing provisions",
    missing: "Checking required provisions",
    interactions: "Checking interactions",
    draft: "Drafting deliverables",
    verify: "Verifying",
    edit: "Applying corrections",
    package: "Packaging",
  },
};

const ID: LegalOutputCopy = {
  stubError: "Legal memerlukan gerbang yang aktif. Tempel kunci API Toko Token di Settings, lalu coba lagi.",
  unsupportedFile: "Hanya berkas .docx yang diterima pada v1. Ubah PDF atau format lain ke .docx terlebih dahulu.",
  closingLine: "Draf hasil kerja yang disusun dengan bantuan otomatis untuk ditinjau oleh pengacara yang berkualifikasi.",
  memoTitle: "MEMORANDUM",
  privilegeLine: "RAHASIA DAN ISTIMEWA — HASIL KERJA PENGACARA",
  headerTo: "Kepada",
  headerFrom: "Dari",
  headerDate: "Tanggal",
  headerRe: "Perihal",
  firmLabel: "Kantor",
  summaryHeading: "Ringkasan",
  fallbackSummary: "{party} menelaah draf pihak lawan terhadap {counterparty}.",
  missingWhy: 'Ketentuan wajib "{title}" tidak terdapat dalam draf pihak lawan.',
  unmarkedTitle: "Perubahan tanpa markup",
  unmarkedAdded: "Paragraf ditambahkan tanpa jejak perubahan.",
  unmarkedPrior: "Teks sebelumnya: {before}",
  noPriorTurn: "Tidak ada giliran sebelumnya untuk dibandingkan",
  unmarkedChanges: "{count} perubahan tanpa markup",
  noClauses: "Tidak ada klausul untuk ditelaah",
  allMapped: "Semua butir daftar periksa terpetakan",
  noPlaybook: "Tanpa playbook",
  noHighSeverity: "Tidak ada temuan berkeparahan tinggi",
  noRedlineBytes: "Tidak ada bita asli untuk redline",
  droppedOutput: "Keluaran model yang tidak sah diabaikan setelah dicoba ulang",
  instructingAuthor: "pemberi instruksi",
  skipped: "dilewati",
  roundOf: "Putaran {round} dari {total}",
  passedFailed: "{passed} lulus, {failed} gagal",
  reservedFor: "Ditahan untuk {who}",
  noCitation: "tidak ada sitasi tercatat",
  findingNotFound: "[temuan tidak ditemukan]",
  noneIdentified: "Tidak ada yang teridentifikasi.",
  positionLine: "Bertindak untuk {party} ({role}) terhadap {counterparty}.",
  basisComment: "{title}. Dasar: {basis}.",
  deviationsSheet: "Penyimpangan",
  summarySheet: "Ringkasan",
  sheetMatter: "Perkara",
  sheetPosition: "Kedudukan",
  sheetFindings: "Temuan",
  sheetReserved: "Ditahan untuk keputusan mitra",
  sheetSeverity: "Tingkat",
  sheetKind: "Jenis",
  sheetCount: "Jumlah",
  verificationHeading: "Verifikasi",
  verificationNotRun: "Verifikasi tidak dijalankan.",
  allChecksPassed: "Semua cek kode lulus.",
  someChecksFailed: "Satu atau lebih cek kode gagal.",
  checkPassed: "lulus",
  checkFailed: "gagal",
  roundLine: "Putaran {round}. {outcome}",
  memoColumns: ["Klausul", "Ketentuan", "Mengapa merugikan", "Tingkat", "Usulan bahasa", "Dasar"],
  deviationColumns: [
    "Klausul",
    "Jenis",
    "Judul",
    "Ketentuan (kutipan)",
    "Mengapa merugikan",
    "Tingkat",
    "Daya tawar",
    "Usulan bahasa",
    "Dasar",
    "Ditahan untuk",
  ],
  findingColumns: ["Klausul", "Judul", "Tingkat", "Daya tawar", "Mengapa merugikan", "Usulan bahasa", "Dasar"],
  reservedColumns: ["Klausul", "Judul", "Tingkat", "Ditahan untuk", "Mengapa merugikan", "Dasar"],
  redFlagSections: [
    "Ketentuan yang merugikan",
    "Ketentuan yang hilang",
    "Perubahan tanpa markup",
    "Interaksi",
    "Ditahan untuk keputusan mitra",
  ],
  kindLabels: {
    adverse: "Ketentuan yang merugikan",
    deviation: "Penyimpangan dari playbook",
    "unmarked-change": "Perubahan tanpa markup",
    interaction: "Interaksi",
    missing: "Ketentuan yang hilang",
    ok: "Sesuai",
  },
  phase: {
    classify: "Mengklasifikasi dokumen",
    diff: "Membandingkan dengan giliran sebelumnya",
    review: "Menelaah ketentuan",
    missing: "Memeriksa ketentuan wajib",
    interactions: "Memeriksa interaksi",
    draft: "Menyusun hasil kerja",
    verify: "Memverifikasi",
    edit: "Menerapkan koreksi",
    package: "Mengemas",
  },
};

const BY_LOCALE: Readonly<Record<LegalLocale, LegalOutputCopy>> = { en: EN, id: ID };

export function legalOutputCopy(locale: LegalLocale = "en"): LegalOutputCopy {
  return BY_LOCALE[locale] ?? EN;
}

export function fillCopy(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}
