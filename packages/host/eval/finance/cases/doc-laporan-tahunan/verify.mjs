/**
 * Independent checker for `doc-laporan-tahunan`.
 *
 * Re-opens both inputs without adding a dependency:
 *  - `input.docx` is unzipped here with `node:zlib` (central directory walked by hand) and
 *    `word/document.xml` is parsed for its tables and its narrative paragraphs;
 *  - `input.pdf` is read as latin1 and its uncompressed content streams are scanned for `(...) Tj`.
 *
 * Every table row and every derived figure is then recomputed from what came back out of the files
 * and compared with case.json. The prose-only claim is tested as a property: the figure's formatted
 * value must appear in the narrative and must equal no table cell.
 *
 * Run: node packages/host/eval/finance/cases/doc-laporan-tahunan/verify.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const failures = [];
let assertions = 0;

function check(name, actual, expected, tolerance = 0) {
  assertions += 1;
  const delta = Math.abs(Number(actual) - Number(expected));
  if (!(delta <= tolerance)) {
    failures.push(`${name}: got ${actual}, want ${expected} (delta ${delta} > tol ${tolerance})`);
  }
}

function checkTrue(name, condition, detail) {
  assertions += 1;
  if (!condition) {
    failures.push(`${name}: ${detail}`);
  }
}

// --- minimal zip reader (stored + deflate), enough for an OOXML part ------------------------

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

function findEocd(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error("verify: no zip end-of-central-directory record");
}

/** Reads one named entry out of a zip archive. */
function readZipEntry(buffer, wanted) {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error("verify: corrupt central directory");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name === wanted) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.subarray(start, start + compressedSize);
      return method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`verify: "${wanted}" is not in the archive`);
}

// --- OOXML parsing ---------------------------------------------------------------------------

const unescapeXml = (value) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const runsOf = (xml) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((match) => unescapeXml(match[1])).join("");

/** Every `<w:tbl>` as an array of rows of cell strings. */
function docxTables(xml) {
  return [...xml.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)].map((table) =>
    [...table[1].matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((row) =>
      [...row[0].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((cellXml) => runsOf(cellXml[1]).trim()),
    ),
  );
}

/** Paragraph text with every table stripped out first, so only the narrative is left. */
function docxNarrative(xml) {
  const withoutTables = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, " ");
  return [...withoutTables.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)]
    .map((match) => runsOf(match[1]).trim())
    .filter((line) => line.length > 0);
}

// --- PDF parsing -----------------------------------------------------------------------------

/** Text lines out of the uncompressed content streams, in order. */
function pdfLines(bytes) {
  const source = bytes.toString("latin1");
  const streams = [...source.matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map((match) => match[1]);
  return streams.flatMap((stream) =>
    [...stream.matchAll(/\((?:\\.|[^\\()])*\)\s*Tj/g)].map((match) =>
      match[0]
        .replace(/\s*Tj$/, "")
        .slice(1, -1)
        .replace(/\\([\\()])/g, "$1"),
    ),
  );
}

// --- number formatting, written out again --------------------------------------------------

function formatId(value) {
  const digits = Math.abs(value)
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return value < 0 ? `(${digits})` : digits;
}

/** "(985.400.000)" -> -985400000, "21.965.000.000" -> 21965000000. */
function parseId(value) {
  const negative = value.startsWith("(") && value.endsWith(")");
  const digits = value.replace(/[()\s.]/g, "");
  if (!/^\d+$/.test(digits)) {
    return Number.NaN;
  }
  return negative ? -Number(digits) : Number(digits);
}

async function main() {
  const caseJson = JSON.parse(readFileSync(join(HERE, "case.json"), "utf8"));
  const years = caseJson.params.years;

  const documentXml = readZipEntry(readFileSync(join(HERE, "input.docx")), "word/document.xml").toString("utf8");
  const tables = docxTables(documentXml);
  const narrative = docxNarrative(documentXml).join("\n");
  checkTrue("docx table count", tables.length === 2, `got ${tables.length} tables, want 2`);

  // label -> [2023, 2024] read back out of the Word tables, plus the raw cell strings.
  const fromTables = new Map();
  const cellStrings = new Set();
  for (const table of tables) {
    const [header, ...body] = table;
    for (const cell of header) {
      cellStrings.add(cell);
    }
    checkTrue("docx table header", header[0] === "Uraian" && header[1] === years[0] && header[2] === years[1], `got ${JSON.stringify(header)}`);
    for (const row of body) {
      for (const cell of row) {
        cellStrings.add(cell);
      }
      fromTables.set(row[0], [parseId(row[1]), parseId(row[2])]);
    }
  }

  // --- every truth line item is really in a Word table cell ---
  for (const item of caseJson.truth.lineItems) {
    const values = fromTables.get(item.label);
    if (!values) {
      failures.push(`lineItem "${item.label}" is in no Word table`);
      continue;
    }
    check(`docx ${item.label} ${item.period}`, values[years.indexOf(item.period)], item.amount, 0);
  }
  checkTrue(
    "docx rows vs truth labels",
    fromTables.size === new Set(caseJson.truth.lineItems.map((item) => item.label)).size,
    `docx has ${fromTables.size} rows, truth names ${new Set(caseJson.truth.lineItems.map((item) => item.label)).size}`,
  );

  // --- the PDF twin carries the same tables ---
  const lines = pdfLines(readFileSync(join(HERE, "input.pdf")));
  const fromPdf = new Map();
  for (const line of lines) {
    const match = line.match(/^(\D[^0-9]*?)\s{2,}([\d.()]+)\s+([\d.()]+)\s*$/);
    if (match) {
      fromPdf.set(match[1].trim(), [parseId(match[2]), parseId(match[3])]);
    }
  }
  for (const [label, values] of fromTables) {
    const pdfValues = fromPdf.get(label);
    if (!pdfValues) {
      failures.push(`pdf: row "${label}" is missing`);
      continue;
    }
    check(`pdf ${label} ${years[0]}`, pdfValues[0], values[0], 0);
    check(`pdf ${label} ${years[1]}`, pdfValues[1], values[1], 0);
  }

  // --- derived figures, recomputed from the cells that came back out of the docx ---
  const value = (label, year) => {
    const values = fromTables.get(label);
    if (!values) {
      throw new Error(`verify: "${label}" is not in the tables`);
    }
    return values[years.indexOf(year)];
  };
  const pctChange = (from, to) => ((to - from) / from) * 100;
  const share = (part, whole) => (part / whole) * 100;

  const expected = {
    "revenue.2024": value("Pendapatan usaha", "2024"),
    "revenueGrowthPct.2024": pctChange(value("Pendapatan usaha", "2023"), value("Pendapatan usaha", "2024")),
    "grossProfit.2024": value("Pendapatan usaha", "2024") - value("Beban pokok pendapatan", "2024"),
    "grossMarginPct.2023": share(value("Laba kotor", "2023"), value("Pendapatan usaha", "2023")),
    "grossMarginPct.2024": share(value("Laba kotor", "2024"), value("Pendapatan usaha", "2024")),
    "operatingMarginPct.2024": share(value("Laba usaha", "2024"), value("Pendapatan usaha", "2024")),
    "netMarginPct.2024": share(value("Laba bersih tahun berjalan", "2024"), value("Pendapatan usaha", "2024")),
    "netProfitGrowthPct.2024": pctChange(value("Laba bersih tahun berjalan", "2023"), value("Laba bersih tahun berjalan", "2024")),
    "opexTotal.2024": value("Beban penjualan", "2024") + value("Beban umum dan administrasi", "2024"),
    "effectiveTaxRatePct.2024": share(value("Beban pajak penghasilan", "2024"), value("Laba sebelum pajak", "2024")),
    "interestCoverage.2024": value("Laba usaha", "2024") / value("Beban bunga", "2024"),
    "freeCashFlow.2024": value("Arus kas dari aktivitas operasi", "2024") + value("Arus kas dari aktivitas investasi", "2024"),
    "cashEnd.2024": value("Kas dan setara kas akhir tahun", "2024"),
    "cashChange.2024": value("Kas dan setara kas akhir tahun", "2024") - value("Kas dan setara kas awal tahun", "2024"),
    "operatingCashFlowGrowthPct.2024": pctChange(
      value("Arus kas dari aktivitas operasi", "2023"),
      value("Arus kas dari aktivitas operasi", "2024"),
    ),
  };

  // The statement must also foot: each printed subtotal equals its own arithmetic.
  check("laba kotor 2024 foots", value("Pendapatan usaha", "2024") - value("Beban pokok pendapatan", "2024"), value("Laba kotor", "2024"), 0);
  check(
    "laba usaha 2024 foots",
    value("Laba kotor", "2024") - value("Beban penjualan", "2024") - value("Beban umum dan administrasi", "2024"),
    value("Laba usaha", "2024"),
    0,
  );
  check(
    "laba sebelum pajak 2024 foots",
    value("Laba usaha", "2024") - value("Beban bunga", "2024") + value("Pendapatan lain-lain", "2024"),
    value("Laba sebelum pajak", "2024"),
    0,
  );
  check("laba bersih 2024 foots", value("Laba sebelum pajak", "2024") - value("Beban pajak penghasilan", "2024"), value("Laba bersih tahun berjalan", "2024"), 0);
  for (const year of years) {
    check(
      `kas akhir ${year} foots`,
      value("Kas dan setara kas awal tahun", year) +
        value("Arus kas dari aktivitas operasi", year) +
        value("Arus kas dari aktivitas investasi", year) +
        value("Arus kas dari aktivitas pendanaan", year),
      value("Kas dan setara kas akhir tahun", year),
      0,
    );
  }

  const proseKeys = new Set(caseJson.truth.proseFigureKeys);
  for (const figure of caseJson.truth.figures) {
    if (figure.source === "table") {
      if (!(figure.key in expected)) {
        failures.push(`figure ${figure.key} is marked "table" but verify has no formula for it`);
        continue;
      }
      check(`figure ${figure.key}`, expected[figure.key], figure.value, figure.tolerance);
      continue;
    }
    if (figure.source !== "prose") {
      failures.push(`figure ${figure.key}: source must be "table" or "prose", got ${JSON.stringify(figure.source)}`);
      continue;
    }
    checkTrue(`proseFigureKeys has ${figure.key}`, proseKeys.has(figure.key), "prose figure missing from truth.proseFigureKeys");
    // A prose-only figure must be readable in the narrative and must equal no table cell.
    const written = figure.unit === "currency" ? formatId(figure.value) : String(figure.value).replace(".", ",");
    checkTrue(`prose ${figure.key} in narrative`, narrative.includes(written), `"${written}" is in no paragraph`);
    checkTrue(`prose ${figure.key} not in a table`, !cellStrings.has(written), `"${written}" is also a table cell, so it is not prose-only`);
    checkTrue(
      `prose ${figure.key} in pdf`,
      lines.some((line) => line.includes(written)),
      `"${written}" is in no PDF line`,
    );
  }

  // The narrative is really prose, not the tables leaking through.
  checkTrue("narrative length", narrative.length > 1_500, `narrative is only ${narrative.length} characters`);
  checkTrue("pdf pages", (readFileSync(join(HERE, "input.pdf")).toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length === 4, "expected 4 PDF pages");

  if (failures.length > 0) {
    process.stderr.write(`doc-laporan-tahunan verify FAILED (${failures.length}):\n- ${failures.slice(0, 40).join("\n- ")}\n`);
    process.exitCode = 1;
    return;
  }
  const prose = caseJson.truth.figures.filter((figure) => figure.source === "prose").length;
  process.stdout.write(
    `doc-laporan-tahunan verify OK: 2 Word tables (${fromTables.size} rows) re-read and re-footed, ${lines.length} PDF text lines, ` +
      `${caseJson.truth.figures.length} figures (${prose} prose-only) (${assertions} assertions).\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`doc-laporan-tahunan verify crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
