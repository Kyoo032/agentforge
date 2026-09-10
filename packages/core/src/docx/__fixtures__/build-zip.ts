/**
 * Test-only zip builders. A real decompression bomb would need hundreds of megabytes of memory to
 * construct, so instead these build a structurally valid archive with JSZip and then rewrite the
 * "uncompressed size" fields in its headers — exactly what a bomb declares, without the bytes.
 */
import JSZip from "jszip";

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
/** Byte offset of the uncompressed-size field inside each header kind. */
const LOCAL_SIZE_OFFSET = 22;
const CENTRAL_SIZE_OFFSET = 24;

export type ZipEntry = { name: string; body: string };

/** A minimal but valid archive; `docxLikeEntries()` gives it the shape `readDocx` expects. */
export async function buildZip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.name, entry.body);
  }
  return zip.generateAsync({ type: "uint8array" });
}

/** Rewrites every header's uncompressed-size field so the archive *claims* `declaredBytes` per entry. */
export function forgeUncompressedSize(bytes: Uint8Array, declaredBytes: number): Uint8Array {
  const out = Uint8Array.from(bytes);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i + 4 <= out.length; i += 1) {
    const signature = view.getUint32(i, true);
    const offset =
      signature === LOCAL_HEADER ? LOCAL_SIZE_OFFSET : signature === CENTRAL_HEADER ? CENTRAL_SIZE_OFFSET : -1;
    if (offset >= 0 && i + offset + 4 <= out.length) {
      view.setUint32(i + offset, declaredBytes, true);
    }
  }
  return out;
}

/** A zip that looks like a .docx but declares `declaredBytes` of inflated XML per entry. */
export async function buildZipBomb(declaredBytes: number): Promise<Uint8Array> {
  const zip = await buildZip([
    { name: "[Content_Types].xml", body: "<Types/>" },
    { name: "word/document.xml", body: "<w:document/>" },
  ]);
  return forgeUncompressedSize(zip, declaredBytes);
}
