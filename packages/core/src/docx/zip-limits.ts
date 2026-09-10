/**
 * Cheap zip-bomb screening for .docx uploads.
 *
 * `readDocx` inflates every part it needs (`file.async("string")`), so a 200 KB archive that declares
 * gigabytes of XML would be inflated into memory before any parser sees it. This reads only the zip
 * directory — JSZip's `loadAsync` parses headers and defers inflation — and sums the *declared*
 * uncompressed size of every entry, so a caller can reject the file without decompressing a byte.
 *
 * Declared sizes come from the archive itself and a liar can understate them; this is a cheap first
 * gate, not a proof. It is deliberately separate from `read.ts` so Legal's parsing behaviour is
 * unchanged — only callers that opt in (knowledge ingest) pay for it.
 */
import JSZip from "jszip";
import { docxError } from "./xml-utils";

/** Inflated bytes a knowledge .docx may declare across all parts before it is refused. */
export const DOCX_MAX_INFLATED_BYTES = 100 * 1024 * 1024;

type DeferredData = { uncompressedSize?: unknown };

function declaredSize(file: unknown): number {
  const data = (file as { _data?: DeferredData } | undefined)?._data;
  const size = data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 0;
}

/**
 * Total uncompressed size the archive claims, in bytes. Throws the shared docx error when the bytes
 * are not a readable zip at all, so the caller keeps its single "damaged file" path.
 */
export async function declaredInflatedBytes(bytes: Uint8Array): Promise<number> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw docxError(`not a zip archive (${detail})`);
  }
  return Object.values(zip.files).reduce((total, file) => total + declaredSize(file), 0);
}
