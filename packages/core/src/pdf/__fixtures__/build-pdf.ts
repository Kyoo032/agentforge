/**
 * Hand-built PDF fixtures for the extractor tests.
 *
 * No generator library is used on purpose: the whole point of these fixtures is to be a few hundred
 * bytes of uncompressed, readable PDF so a failing extraction test is debuggable by eye. Everything
 * here returns new values; nothing mutates its input.
 */

const HEADER = "%PDF-1.4\n";
const CATALOG_ID = 1;
const PAGES_ID = 2;
const FONT_ID = 3;
/** Page and content-stream object ids start after the three fixed objects and come in pairs. */
const FIRST_PAGE_ID = 4;

/** Escapes the three characters that are special inside a PDF literal string. */
function pdfString(text: string): string {
  return text.replace(/[\\()]/g, (match) => `\\${match}`);
}

function contentStream(text: string): string {
  if (!text) {
    return "";
  }
  return `BT\n/F1 24 Tf\n72 720 Td\n(${pdfString(text)}) Tj\nET\n`;
}

function pageObject(contentId: number): string {
  return (
    `<< /Type /Page /Parent ${PAGES_ID} 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /Font << /F1 ${FONT_ID} 0 R >> >> /Contents ${contentId} 0 R >>`
  );
}

function streamObject(body: string): string {
  return `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}endstream`;
}

function bodyObjects(pages: readonly string[]): readonly string[] {
  const pageIds = pages.map((_, index) => FIRST_PAGE_ID + index * 2);
  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  const fixed = [
    `<< /Type /Catalog /Pages ${PAGES_ID} 0 R >>`,
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const perPage = pages.flatMap((text, index) => [
    pageObject(FIRST_PAGE_ID + index * 2 + 1),
    streamObject(contentStream(text)),
  ]);
  return [...fixed, ...perPage];
}

/**
 * Builds a valid, uncompressed, single-column PDF with one line of Helvetica text per page.
 * Pass an empty string for a page with no text layer at all (the "scanned image" stand-in).
 */
export function buildTextPdf(pages: readonly string[]): Uint8Array {
  if (pages.length === 0) {
    throw new Error("buildTextPdf: at least one page is required");
  }
  const objects = bodyObjects(pages);
  const chunks: string[] = [HEADER];
  const offsets: number[] = [];
  let offset = Buffer.byteLength(HEADER, "latin1");
  objects.forEach((body, index) => {
    const serialized = `${index + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(offset);
    chunks.push(serialized);
    offset += Buffer.byteLength(serialized, "latin1");
  });
  const xrefRows = offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("");
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefRows}`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG_ID} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from([...chunks, xref, trailer].join(""), "latin1"));
}

/** Bytes that look like a PDF for one line and are garbage after it. */
export function buildGarbagePdf(): Uint8Array {
  return new Uint8Array(Buffer.from("%PDF-1.4\nthis is not a pdf body at all\n", "latin1"));
}
