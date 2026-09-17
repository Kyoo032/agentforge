/**
 * Deciding what a file really is, twice: from its name and from its first bytes.
 *
 * A name is a claim and bytes are evidence, so both are read and a disagreement is refused rather
 * than resolved — a `.csv` that is really a workbook, or a `.pdf` that is really a zip, is the shape
 * a content-type confusion arrives in, and either one would hand the wrong parser a hostile file.
 *
 * anydoc's own detectors are authoritative when the binding is loaded (they read the package
 * mimetype, so .docx / .xlsx / .pptx are told apart properly). The small local maps below exist only
 * for the fallback path, where there is no binding to ask.
 */
import type { AnydocFormat, AnydocModule } from "./anydoc";
import { FileExtractError } from "./errors";

/** Extensions the fallback path can name without asking the converter. */
const BY_EXTENSION: Readonly<Record<string, AnydocFormat>> = {
  csv: "csv",
  doc: "doc",
  docx: "docx",
  epub: "epub",
  odp: "odp",
  ods: "ods",
  odt: "odt",
  pdf: "pdf",
  ppt: "ppt",
  pptx: "pptx",
  rtf: "rtf",
  xls: "xlsx",
  xlsx: "xlsx",
} as const;

/** What the first bytes are, coarsely. Enough to catch a lie about the extension. */
type Container = "pdf" | "zip" | "ole" | "rtf" | null;

const SIGNATURES: ReadonlyArray<{ readonly container: Container; readonly magic: ReadonlyArray<number> }> = [
  { container: "pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  { container: "zip", magic: [0x50, 0x4b, 0x03, 0x04] },
  { container: "ole", magic: [0xd0, 0xcf, 0x11, 0xe0] },
  { container: "rtf", magic: [0x7b, 0x5c, 0x72, 0x74, 0x66] },
];

/** The container each format arrives in. `null` means the format carries no signature (CSV). */
const CONTAINER_OF: Readonly<Record<AnydocFormat, Container>> = {
  csv: null,
  doc: "ole",
  docx: "zip",
  epub: "zip",
  odp: "zip",
  ods: "zip",
  odt: "zip",
  pdf: "pdf",
  ppt: "ole",
  pptx: "zip",
  rtf: "rtf",
  xlsx: "zip",
} as const;

/** The lower-cased extension of a filename, without the dot. "" when it has none. */
export function extensionOf(filename: string): string {
  const base = filename.trim().toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

function containerOf(bytes: Uint8Array): Container {
  const found = SIGNATURES.find(({ magic }) => magic.every((byte, index) => bytes[index] === byte));
  return found ? found.container : null;
}

/**
 * The format both the name and the bytes agree on.
 *
 * Throws `unsupported` when neither names a format we convert, and `format_mismatch` when they name
 * different ones. A signature-less format (CSV) is accepted on the extension alone — but only when
 * the bytes carry no signature at all, so a renamed workbook is still caught.
 */
export function detectFormat(filename: string, bytes: Uint8Array, anydoc: AnydocModule | null): AnydocFormat {
  const extension = extensionOf(filename);
  const named = anydoc ? anydoc.formatFromExtension(extension) : (BY_EXTENSION[extension] ?? null);
  const sniffed = anydoc ? anydoc.formatFromBytes(bytes) : null;
  const container = containerOf(bytes);
  if (named === null && sniffed === null) {
    throw new FileExtractError("unsupported");
  }
  if (named !== null && sniffed !== null && named !== sniffed) {
    throw new FileExtractError("format_mismatch");
  }
  const format = sniffed ?? (named as AnydocFormat);
  // The extension may still be lying about a format anydoc could not sniff: `.csv` bytes that open
  // with a zip or OLE signature, or `.docx` bytes that are plain text.
  if (sniffed === null && CONTAINER_OF[format] !== container) {
    throw new FileExtractError("format_mismatch");
  }
  return format;
}
