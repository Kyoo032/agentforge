import { bookReadMessage, readPagePng, type BookReadKind } from "@agentforge/university";
import { FileExtractError } from "../file-extract/errors";
import { extractFile } from "../file-extract";

export type BookRead = {
  kind: BookReadKind;
  text: string;
  message: string;
};

function isPng(bytes: Uint8Array, filename: string): boolean {
  const magic = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return magic || filename.toLowerCase().endsWith(".png");
}

function isPdf(bytes: Uint8Array, filename: string): boolean {
  const magic = bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  return magic || filename.toLowerCase().endsWith(".pdf");
}

/**
 * Read a page on this machine.
 * A PNG is recognised by the local page face. A PDF uses the existing text-layer reader.
 * A scan that the reader refuses stays here and comes back as a local empty result.
 */
export async function readBookFile(locale: unknown, file: { filename: string; bytes: Uint8Array }): Promise<BookRead> {
  const finish = (kind: BookReadKind, text: string): BookRead => ({
    kind,
    text,
    message: bookReadMessage(locale, kind),
  });

  if (isPng(file.bytes, file.filename)) {
    const text = readPagePng(file.bytes).trim();
    return finish(text ? "local-ocr" : "local-ocr-empty", text);
  }

  if (!isPdf(file.bytes, file.filename)) {
    return finish("unsupported", "");
  }

  try {
    const extracted = await extractFile({ filename: file.filename, bytes: file.bytes });
    const text = (extracted.text || extracted.markdown).trim();
    if (!text) {
      return finish("local-ocr-empty", "");
    }
    return finish("text-layer", text);
  } catch (error) {
    if (error instanceof FileExtractError && error.code === "needs_ocr") {
      return finish("local-ocr-empty", "");
    }
    if (
      error instanceof FileExtractError &&
      (error.code === "unsupported" || error.code === "format_mismatch" || error.code === "empty")
    ) {
      return finish("unsupported", "");
    }
    throw error;
  }
}
