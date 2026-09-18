/**
 * Deterministic generator for the `doc-laporan-tahunan` eval case.
 *
 * The same kind of figures the budget cases deliver as a spreadsheet, delivered as a DOCUMENT:
 * a four-page annual-report excerpt with narrative paragraphs, a real Word table for the two-year
 * income statement and a second table for the cash position. It exercises the
 * anydoc -> Markdown -> figures path rather than the spreadsheet importer.
 *
 * A `.pdf` twin is written with a small text-PDF writer modelled on the repo's own
 * `packages/core/src/pdf/__fixtures__/build-pdf.ts` (same uncompressed, hand-assembled structure,
 * extended here from one line per page to many). No dependency is added for it.
 *
 * Fixed numbers, no randomness, no clock, no import of the Finance engine. `truth` is an
 * independent oracle; every figure carries its formula and a `source` of "table" or "prose".
 *
 * All data is synthetic. "PT Bahtera Nusantara Jaya" is an invented company.
 *
 * Run: node packages/host/eval/finance/cases/doc-laporan-tahunan/build.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { Document, HeadingLevel, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";

const HERE = dirname(fileURLToPath(import.meta.url));

const YEARS = ["2023", "2024"];

/** Income statement, in full rupiah. Index 0 is 2023, index 1 is 2024. */
const INCOME_STATEMENT = [
  { label: "Pendapatan usaha", category: "revenue", values: [18_420_000_000, 21_965_000_000] },
  { label: "Beban pokok pendapatan", category: "cost", values: [11_052_000_000, 12_960_350_000] },
  { label: "Laba kotor", category: "subtotal", values: [7_368_000_000, 9_004_650_000] },
  { label: "Beban penjualan", category: "cost", values: [2_210_400_000, 2_635_800_000] },
  { label: "Beban umum dan administrasi", category: "cost", values: [3_132_000_000, 3_514_400_000] },
  { label: "Laba usaha", category: "subtotal", values: [2_025_600_000, 2_854_450_000] },
  { label: "Beban bunga", category: "cost", values: [385_200_000, 412_700_000] },
  { label: "Pendapatan lain-lain", category: "revenue", values: [96_400_000, 143_250_000] },
  { label: "Laba sebelum pajak", category: "subtotal", values: [1_736_800_000, 2_585_000_000] },
  { label: "Beban pajak penghasilan", category: "cost", values: [382_096_000, 568_700_000] },
  { label: "Laba bersih tahun berjalan", category: "subtotal", values: [1_354_704_000, 2_016_300_000] },
];

/** Cash position and cash flow, in full rupiah. Negative values print in parentheses. */
const CASH_POSITION = [
  { label: "Kas dan setara kas awal tahun", category: "cash", values: [1_120_000_000, 1_586_500_000] },
  { label: "Arus kas dari aktivitas operasi", category: "cashflow", values: [1_842_300_000, 2_418_900_000] },
  { label: "Arus kas dari aktivitas investasi", category: "cashflow", values: [-985_400_000, -1_312_600_000] },
  { label: "Arus kas dari aktivitas pendanaan", category: "cashflow", values: [-390_400_000, -342_800_000] },
  { label: "Kas dan setara kas akhir tahun", category: "cash", values: [1_586_500_000, 2_350_000_000] },
];

const pick = (rows, label) => {
  const row = rows.find((candidate) => candidate.label === label);
  if (!row) {
    throw new Error(`build: no row "${label}"`);
  }
  return row.values;
};

// Shorthands used by the oracle below; [2023, 2024].
const revenue = pick(INCOME_STATEMENT, "Pendapatan usaha");
const cogs = pick(INCOME_STATEMENT, "Beban pokok pendapatan");
const grossProfit = pick(INCOME_STATEMENT, "Laba kotor");
const selling = pick(INCOME_STATEMENT, "Beban penjualan");
const admin = pick(INCOME_STATEMENT, "Beban umum dan administrasi");
const operatingProfit = pick(INCOME_STATEMENT, "Laba usaha");
const interest = pick(INCOME_STATEMENT, "Beban bunga");
const preTax = pick(INCOME_STATEMENT, "Laba sebelum pajak");
const tax = pick(INCOME_STATEMENT, "Beban pajak penghasilan");
const netProfit = pick(INCOME_STATEMENT, "Laba bersih tahun berjalan");
const cashOpen = pick(CASH_POSITION, "Kas dan setara kas awal tahun");
const cfo = pick(CASH_POSITION, "Arus kas dari aktivitas operasi");
const cfi = pick(CASH_POSITION, "Arus kas dari aktivitas investasi");
const cashClose = pick(CASH_POSITION, "Kas dan setara kas akhir tahun");

/** Figures stated only in the narrative — they are in no table. */
const PROSE_ONLY = {
  headcount2024: 148,
  stores2023: 12,
  stores2024: 17,
  currentRatio2024: 1.84,
  capex2024: 1_180_000_000,
  longTermBankDebt2024: 3_420_000_000,
  dividendPaid2024: 250_000_000,
};

// ---------------------------------------------------------------------------
// Formatting: Indonesian thousands separator, negatives in parentheses.
// ---------------------------------------------------------------------------

function formatId(value) {
  const digits = Math.abs(value)
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return value < 0 ? `(${digits})` : digits;
}

// ---------------------------------------------------------------------------
// Narrative. Every sentence that carries a prose-only figure is marked in the comment.
// ---------------------------------------------------------------------------

const PARAGRAPHS = {
  ikhtisar1:
    `Sepanjang tahun 2024 PT Bahtera Nusantara Jaya membukukan pendapatan usaha sebesar Rp ${formatId(revenue[1])}, ` +
    `naik dari Rp ${formatId(revenue[0])} pada tahun sebelumnya. Pertumbuhan tersebut ditopang oleh pembukaan gerai baru ` +
    "di kawasan Jawa Timur serta kenaikan kontribusi penjualan daring yang mulai stabil sejak kuartal kedua.",
  ikhtisar2:
    `Laba bersih tahun berjalan tercatat Rp ${formatId(netProfit[1])}, dibandingkan Rp ${formatId(netProfit[0])} pada tahun 2023. ` +
    "Perbaikan margin berasal dari negosiasi ulang kontrak pemasok utama dan dari efisiensi biaya distribusi, " +
    "sementara beban umum dan administrasi tumbuh lebih lambat dibanding pendapatan.",
  ikhtisar3:
    // prose-only: headcount 2024, gerai 2023 dan 2024
    `Pada akhir tahun 2024 Perseroan mempekerjakan ${PROSE_ONLY.headcount2024} karyawan tetap, dan jumlah gerai aktif ` +
    `bertambah dari ${PROSE_ONLY.stores2023} gerai menjadi ${PROSE_ONLY.stores2024} gerai. Penambahan gerai dilakukan ` +
    "secara bertahap agar beban sewa dan beban penjualan tidak melonjak dalam satu periode.",
  labaRugi:
    "Tabel berikut menyajikan ikhtisar laba rugi Perseroan untuk tahun yang berakhir pada 31 Desember 2024 " +
    "dengan angka pembanding tahun 2023. Seluruh angka disajikan dalam rupiah penuh.",
  labaRugiCatatan:
    `Beban pajak penghasilan tahun 2024 sebesar Rp ${formatId(tax[1])} setara dengan tarif efektif yang sama dengan tahun ` +
    "sebelumnya, karena tidak terdapat koreksi fiskal yang signifikan. Beban bunga naik seiring penarikan fasilitas " +
    "investasi pada semester kedua.",
  kas:
    "Tabel berikut menyajikan posisi kas dan ikhtisar arus kas Perseroan. Angka dalam tanda kurung menunjukkan arus kas keluar.",
  kasCatatan:
    // The closing cash figure is also in the table above: this sentence repeats it in words.
    `Dengan demikian kas dan setara kas per 31 Desember 2024 sebesar Rp 2,35 miliar, naik dibandingkan posisi awal tahun. ` +
    // prose-only: belanja modal 2024
    `Belanja modal sepanjang tahun 2024 mencapai Rp ${formatId(PROSE_ONLY.capex2024)}, terutama untuk renovasi gerai ` +
    "dan pengadaan sistem kasir terpadu.",
  catatan1:
    // prose-only: rasio lancar 2024
    `Rasio lancar Perseroan per 31 Desember 2024 tercatat ${String(PROSE_ONLY.currentRatio2024).replace(".", ",")} kali, ` +
    "masih di atas ambang yang disyaratkan dalam perjanjian kredit. Manajemen menilai likuiditas jangka pendek berada " +
    "pada tingkat yang memadai untuk membiayai kebutuhan modal kerja tahun 2025.",
  catatan2:
    // prose-only: saldo utang bank jangka panjang 2024, dividen tunai 2024
    `Saldo utang bank jangka panjang per 31 Desember 2024 sebesar Rp ${formatId(PROSE_ONLY.longTermBankDebt2024)}, ` +
    `sedangkan dividen tunai yang dibagikan pada tahun 2024 sebesar Rp ${formatId(PROSE_ONLY.dividendPaid2024)} ` +
    "sesuai keputusan Rapat Umum Pemegang Saham Tahunan.",
  catatan3:
    "Tidak terdapat peristiwa penting setelah tanggal pelaporan yang berdampak material terhadap laporan keuangan " +
    "Perseroan. Seluruh angka dalam dokumen ini adalah data uji sintetis dan tidak menggambarkan entitas nyata mana pun.",
};

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

const text = (value, bold = false) => new Paragraph({ children: [new TextRun({ text: value, bold })] });

function tableCell(value, bold, alignRight) {
  return new TableCell({
    width: { size: alignRight ? 25 : 50, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: [new TextRun({ text: value, bold })], alignment: alignRight ? "right" : "left" })],
  });
}

function figureTable(rows) {
  const header = new TableRow({
    tableHeader: true,
    children: [tableCell("Uraian", true, false), ...YEARS.map((year) => tableCell(year, true, true))],
  });
  const body = rows.map(
    (row) =>
      new TableRow({
        children: [
          tableCell(row.label, row.category === "subtotal", false),
          ...row.values.map((value) => tableCell(formatId(value), row.category === "subtotal", true)),
        ],
      }),
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] });
}

function docxChildren() {
  return [
    new Paragraph({ text: "PT Bahtera Nusantara Jaya", heading: HeadingLevel.TITLE }),
    new Paragraph({ text: "Kutipan Laporan Tahunan 2024", heading: HeadingLevel.HEADING_1 }),
    text("Dokumen uji sintetis - bukan laporan keuangan entitas nyata."),
    new Paragraph({ text: "Ikhtisar Kinerja", heading: HeadingLevel.HEADING_2 }),
    text(PARAGRAPHS.ikhtisar1),
    text(PARAGRAPHS.ikhtisar2),
    text(PARAGRAPHS.ikhtisar3),
    new Paragraph({ children: [new PageBreak()] }),

    new Paragraph({ text: "Laporan Laba Rugi Ringkas", heading: HeadingLevel.HEADING_2 }),
    text(PARAGRAPHS.labaRugi),
    figureTable(INCOME_STATEMENT),
    text(""),
    text(PARAGRAPHS.labaRugiCatatan),
    new Paragraph({ children: [new PageBreak()] }),

    new Paragraph({ text: "Posisi Kas dan Arus Kas", heading: HeadingLevel.HEADING_2 }),
    text(PARAGRAPHS.kas),
    figureTable(CASH_POSITION),
    text(""),
    text(PARAGRAPHS.kasCatatan),
    new Paragraph({ children: [new PageBreak()] }),

    new Paragraph({ text: "Catatan Operasional", heading: HeadingLevel.HEADING_2 }),
    text(PARAGRAPHS.catatan1),
    text(PARAGRAPHS.catatan2),
    text(PARAGRAPHS.catatan3),
  ];
}

// ---------------------------------------------------------------------------
// Reproducible repack.
//
// `docx` writes `dcterms:created` / `dcterms:modified` from the wall clock and stamps every zip
// entry with it, so two builds of identical content differ byte for byte. There is no option for
// it in docx 9, so the package is unpacked, those two timestamps are pinned, and it is written
// again as a stored (uncompressed) zip with one fixed DOS date. `[Content_Types].xml` goes first,
// as an OPC package expects.
// ---------------------------------------------------------------------------

const FIXED_ISO = "2025-01-01T00:00:00.000Z";
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2025 - 1980) << 9) | (1 << 5) | 1; // 2025-01-01
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const CONTENT_TYPES = "[Content_Types].xml";

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Every file entry of a zip as `{ name, data }`, directories dropped. */
function unzipEntries(buffer) {
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== EOCD_SIGNATURE) {
    eocd -= 1;
  }
  if (eocd < 0) {
    throw new Error("build: docx package has no end-of-central-directory record");
  }
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (!name.endsWith("/")) {
      const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
      const raw = buffer.subarray(start, start + compressedSize);
      entries.push({ name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Writes entries back as a stored zip with one fixed timestamp, so the bytes are reproducible. */
function zipStored(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + entry.data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

function reproducibleDocx(packed) {
  const entries = unzipEntries(packed).map((entry) =>
    entry.name === "docProps/core.xml"
      ? {
          name: entry.name,
          data: Buffer.from(
            entry.data.toString("utf8").replace(/>\d{4}-\d{2}-\d{2}T[\d:.]+Z</g, `>${FIXED_ISO}<`),
            "utf8",
          ),
        }
      : entry,
  );
  const contentTypes = entries.filter((entry) => entry.name === CONTENT_TYPES);
  if (contentTypes.length !== 1) {
    throw new Error(`build: expected exactly one ${CONTENT_TYPES} in the package`);
  }
  return zipStored([...contentTypes, ...entries.filter((entry) => entry.name !== CONTENT_TYPES)]);
}

// ---------------------------------------------------------------------------
// PDF (same content as plain text lines) - modelled on packages/core/src/pdf/__fixtures__/build-pdf.ts
// ---------------------------------------------------------------------------

const PDF_HEADER = "%PDF-1.4\n";
const CATALOG_ID = 1;
const PAGES_ID = 2;
const FONT_ID = 3;
const FIRST_PAGE_ID = 4;
const PDF_LEADING = 13;
const PDF_TOP = 760;
const PDF_LEFT = 54;

/** Escapes the three characters that are special inside a PDF literal string. */
const pdfString = (value) => value.replace(/[\\()]/g, (match) => `\\${match}`);

function pdfContentStream(lines) {
  const body = lines.map((line) => `(${pdfString(line)}) Tj\nT*\n`).join("");
  return `BT\n/F1 9 Tf\n${PDF_LEADING} TL\n${PDF_LEFT} ${PDF_TOP} Td\n${body}ET\n`;
}

function pdfObjects(pages) {
  const pageIds = pages.map((_, index) => FIRST_PAGE_ID + index * 2);
  const fixed = [
    `<< /Type /Catalog /Pages ${PAGES_ID} 0 R >>`,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  const perPage = pages.flatMap((lines, index) => {
    const contentId = FIRST_PAGE_ID + index * 2 + 1;
    const stream = pdfContentStream(lines);
    return [
      `<< /Type /Page /Parent ${PAGES_ID} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${FONT_ID} 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`,
    ];
  });
  return [...fixed, ...perPage];
}

function buildTextPdf(pages) {
  const objects = pdfObjects(pages);
  const chunks = [PDF_HEADER];
  const offsets = [];
  let offset = Buffer.byteLength(PDF_HEADER, "latin1");
  objects.forEach((body, index) => {
    const serialized = `${index + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(offset);
    chunks.push(serialized);
    offset += Buffer.byteLength(serialized, "latin1");
  });
  const rows = offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("");
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG_ID} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  return Buffer.from([...chunks, xref, trailer].join(""), "latin1");
}

/** Wraps a paragraph to `width` characters so the PDF reads as a document, not one long line. */
function wrap(value, width = 96) {
  const words = value.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

/** The tables as fixed-width text: label padded to 40, then each year right-aligned in 20. */
function tableLines(title, rows) {
  const head = `${"Uraian".padEnd(40)}${YEARS.map((year) => year.padStart(20)).join("")}`;
  const body = rows.map((row) => `${row.label.padEnd(40)}${row.values.map((value) => formatId(value).padStart(20)).join("")}`);
  return [title, "", head, "-".repeat(80), ...body];
}

function pdfPages() {
  return [
    [
      "PT Bahtera Nusantara Jaya",
      "Kutipan Laporan Tahunan 2024",
      "Dokumen uji sintetis - bukan laporan keuangan entitas nyata.",
      "",
      "Ikhtisar Kinerja",
      "",
      ...wrap(PARAGRAPHS.ikhtisar1),
      "",
      ...wrap(PARAGRAPHS.ikhtisar2),
      "",
      ...wrap(PARAGRAPHS.ikhtisar3),
    ],
    [...wrap(PARAGRAPHS.labaRugi), "", ...tableLines("Laporan Laba Rugi Ringkas", INCOME_STATEMENT), "", ...wrap(PARAGRAPHS.labaRugiCatatan)],
    [...wrap(PARAGRAPHS.kas), "", ...tableLines("Posisi Kas dan Arus Kas", CASH_POSITION), "", ...wrap(PARAGRAPHS.kasCatatan)],
    ["Catatan Operasional", "", ...wrap(PARAGRAPHS.catatan1), "", ...wrap(PARAGRAPHS.catatan2), "", ...wrap(PARAGRAPHS.catatan3)],
  ];
}

/** The PDF writer serialises latin1; a character outside it would be silently mangled. */
function assertLatin1(pages) {
  for (const lines of pages) {
    for (const line of lines) {
      for (const char of line) {
        if ((char.codePointAt(0) ?? 0) > 0xff) {
          throw new Error(`build: "${char}" in "${line}" is outside latin1 and cannot go in the PDF`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Independent oracle
// ---------------------------------------------------------------------------

const pctChange = (from, to) => ((to - from) / from) * 100;
const marginPct = (part, whole) => (part / whole) * 100;

const FIGURES = [
  // --- from the income-statement table ---
  // direct read of "Pendapatan usaha" 2024
  { key: "revenue.2024", label: "Pendapatan usaha 2024", value: revenue[1], unit: "currency", tolerance: 1, source: "table" },
  // (21.965.000.000 - 18.420.000.000) / 18.420.000.000 * 100
  { key: "revenueGrowthPct.2024", label: "Pertumbuhan pendapatan 2024", value: pctChange(revenue[0], revenue[1]), unit: "percent", tolerance: 0.005, source: "table" },
  // pendapatan usaha - beban pokok pendapatan (matches the printed "Laba kotor")
  { key: "grossProfit.2024", label: "Laba kotor 2024", value: revenue[1] - cogs[1], unit: "currency", tolerance: 1, source: "table" },
  // laba kotor 2023 / pendapatan usaha 2023 * 100
  { key: "grossMarginPct.2023", label: "Marjin kotor 2023", value: marginPct(grossProfit[0], revenue[0]), unit: "percent", tolerance: 0.005, source: "table" },
  // laba kotor 2024 / pendapatan usaha 2024 * 100
  { key: "grossMarginPct.2024", label: "Marjin kotor 2024", value: marginPct(grossProfit[1], revenue[1]), unit: "percent", tolerance: 0.005, source: "table" },
  // laba usaha 2024 / pendapatan usaha 2024 * 100
  { key: "operatingMarginPct.2024", label: "Marjin usaha 2024", value: marginPct(operatingProfit[1], revenue[1]), unit: "percent", tolerance: 0.005, source: "table" },
  // laba bersih 2024 / pendapatan usaha 2024 * 100
  { key: "netMarginPct.2024", label: "Marjin laba bersih 2024", value: marginPct(netProfit[1], revenue[1]), unit: "percent", tolerance: 0.005, source: "table" },
  // (2.016.300.000 - 1.354.704.000) / 1.354.704.000 * 100
  { key: "netProfitGrowthPct.2024", label: "Pertumbuhan laba bersih 2024", value: pctChange(netProfit[0], netProfit[1]), unit: "percent", tolerance: 0.005, source: "table" },
  // beban penjualan 2024 + beban umum dan administrasi 2024
  { key: "opexTotal.2024", label: "Total beban usaha 2024", value: selling[1] + admin[1], unit: "currency", tolerance: 1, source: "table" },
  // beban pajak penghasilan 2024 / laba sebelum pajak 2024 * 100
  { key: "effectiveTaxRatePct.2024", label: "Tarif pajak efektif 2024", value: marginPct(tax[1], preTax[1]), unit: "percent", tolerance: 0.005, source: "table" },
  // laba usaha 2024 / beban bunga 2024
  { key: "interestCoverage.2024", label: "Kemampuan membayar bunga 2024", value: operatingProfit[1] / interest[1], unit: "ratio", tolerance: 0.005, source: "table" },
  // --- from the cash table ---
  // arus kas operasi 2024 + arus kas investasi 2024 (investasi is already negative)
  { key: "freeCashFlow.2024", label: "Arus kas bebas 2024", value: cfo[1] + cfi[1], unit: "currency", tolerance: 1, source: "table" },
  // direct read of "Kas dan setara kas akhir tahun" 2024 (also repeated in the narrative)
  { key: "cashEnd.2024", label: "Kas akhir tahun 2024", value: cashClose[1], unit: "currency", tolerance: 1, source: "table" },
  // kas akhir 2024 - kas awal 2024
  { key: "cashChange.2024", label: "Kenaikan kas 2024", value: cashClose[1] - cashOpen[1], unit: "currency", tolerance: 1, source: "table" },
  // (2.418.900.000 - 1.842.300.000) / 1.842.300.000 * 100
  { key: "operatingCashFlowGrowthPct.2024", label: "Pertumbuhan arus kas operasi 2024", value: pctChange(cfo[0], cfo[1]), unit: "percent", tolerance: 0.005, source: "table" },
  // --- stated only in the narrative, in no table ---
  // "mempekerjakan 148 karyawan tetap"
  { key: "headcount.2024", label: "Karyawan tetap akhir 2024", value: PROSE_ONLY.headcount2024, unit: "count", tolerance: 0, source: "prose" },
  // "bertambah dari 12 gerai menjadi 17 gerai"
  { key: "stores.2023", label: "Gerai aktif akhir 2023", value: PROSE_ONLY.stores2023, unit: "count", tolerance: 0, source: "prose" },
  { key: "stores.2024", label: "Gerai aktif akhir 2024", value: PROSE_ONLY.stores2024, unit: "count", tolerance: 0, source: "prose" },
  // "rasio lancar ... tercatat 1,84 kali"
  { key: "currentRatio.2024", label: "Rasio lancar 2024", value: PROSE_ONLY.currentRatio2024, unit: "ratio", tolerance: 0.005, source: "prose" },
  // "belanja modal sepanjang tahun 2024 mencapai Rp 1.180.000.000"
  { key: "capex.2024", label: "Belanja modal 2024", value: PROSE_ONLY.capex2024, unit: "currency", tolerance: 1, source: "prose" },
  // "saldo utang bank jangka panjang ... sebesar Rp 3.420.000.000"
  { key: "longTermBankDebt.2024", label: "Utang bank jangka panjang 2024", value: PROSE_ONLY.longTermBankDebt2024, unit: "currency", tolerance: 1, source: "prose" },
  // "dividen tunai yang dibagikan pada tahun 2024 sebesar Rp 250.000.000"
  { key: "dividendPaid.2024", label: "Dividen tunai 2024", value: PROSE_ONLY.dividendPaid2024, unit: "currency", tolerance: 1, source: "prose" },
];

function buildLineItems() {
  return [...INCOME_STATEMENT, ...CASH_POSITION].flatMap((row) =>
    YEARS.map((year, index) => ({ label: row.label, period: year, amount: row.values[index], category: row.category })),
  );
}

const caseJson = {
  id: "doc-laporan-tahunan",
  task: "brief",
  locale: "id",
  currency: "IDR",
  description:
    "Kutipan laporan tahunan sintetis empat halaman: paragraf naratif, satu tabel laba rugi dua tahun dan satu tabel posisi kas. Menguji jalur dokumen (anydoc -> Markdown -> angka), bukan jalur spreadsheet. Beberapa angka hanya muncul di narasi dan ditandai source \"prose\".",
  files: [
    { path: "input.docx" },
    { path: "input.pdf" },
  ],
  prompt:
    "Baca kutipan laporan tahunan ini dan buat ringkasan kinerja 2024 dibanding 2023: pendapatan, marjin, laba bersih, posisi kas, dan hal operasional penting yang disebut di dalamnya.",
  params: {
    years: YEARS,
    tables: ["Laporan Laba Rugi Ringkas", "Posisi Kas dan Arus Kas"],
  },
  truth: {
    /** Both tables, row by row, for both years. */
    lineItems: buildLineItems(),
    /** `source` splits table-derived figures from the ones stated only in the narrative. */
    figures: FIGURES,
    /** Exact sentences that carry a prose-only figure, for scoring the prose path on its own. */
    proseFigureKeys: FIGURES.filter((figure) => figure.source === "prose").map((figure) => figure.key),
    mustMention: ["laba bersih", "kas", "gerai"],
    mustNotContain: ["[unverified figure]"],
  },
};

async function main() {
  const doc = new Document({
    creator: "agentforge-eval",
    title: "Kutipan Laporan Tahunan 2024",
    description: "Dokumen uji sintetis",
    lastModifiedBy: "agentforge-eval",
    revision: 1,
    sections: [{ properties: {}, children: docxChildren() }],
  });
  const docxBuffer = reproducibleDocx(await Packer.toBuffer(doc));
  writeFileSync(join(HERE, "input.docx"), docxBuffer);

  const pages = pdfPages();
  assertLatin1(pages);
  writeFileSync(join(HERE, "input.pdf"), buildTextPdf(pages));

  writeFileSync(join(HERE, "case.json"), `${JSON.stringify(caseJson, null, 2)}\n`, "utf8");
  const prose = FIGURES.filter((figure) => figure.source === "prose").length;
  process.stdout.write(
    `doc-laporan-tahunan: wrote input.docx (${docxBuffer.length} bytes), input.pdf (${pages.length} pages) and case.json ` +
      `(${caseJson.truth.lineItems.length} line items, ${FIGURES.length} figures, ${prose} prose-only)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`doc-laporan-tahunan build failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
