/**
 * Legal mode — file-layer helpers for the matter store.
 *
 * Layout under `<rootDir>/<workspaceId>/<matterId>/`:
 *   matter.json          LegalMatterRecord
 *   files/<docId>.docx   original bytes
 *   parsed/<docId>.json  DocxDocument (cached reader output)
 *   runs/<runId>.json    LegalRunRecord
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ApiError } from "@agentforge/core";
import { type DocxDocument, readDocx } from "@agentforge/core/docx";
import { LEGAL_CAPS, type MatterDocCard } from "@agentforge/core/legal";

/** Per-file cap matches the IPC bytes envelope (tighter than LEGAL_CAPS.maxFileBytes). */
export const LEGAL_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const LEGAL_MATTER_MAX_BYTES = LEGAL_CAPS.maxTotalBytes;
export const LEGAL_LIST_LIMIT = 100;
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const UNSUPPORTED_FILE_MESSAGE =
  "Only .docx files are accepted in v1. Convert PDF or other formats to .docx first.";

const MATTER_FILE = "matter.json";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const DOC_ID_PATTERN = /^S(\d+)$/;
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DOCX_ERROR_PREFIX = "docx:";

export function assertSafeId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new ApiError("invalid_request", `${label} is malformed`, 400);
  }
  return value;
}

export function matterDir(rootDir: string, workspaceId: string, matterId: string): string {
  return path.join(rootDir, assertSafeId(workspaceId, "Workspace id"), assertSafeId(matterId, "Matter id"));
}

export function matterFile(dir: string): string {
  return path.join(dir, MATTER_FILE);
}

export function docFile(dir: string, docId: string): string {
  return path.join(dir, "files", `${assertSafeId(docId, "Document id")}.docx`);
}

export function parsedFile(dir: string, docId: string): string {
  return path.join(dir, "parsed", `${assertSafeId(docId, "Document id")}.json`);
}

export function runFile(dir: string, runId: string): string {
  return path.join(dir, "runs", `${assertSafeId(runId, "Run id")}.json`);
}

/** Directories under `<rootDir>/<workspaceId>/` that carry a matter.json. */
export function listMatterIds(rootDir: string, workspaceId: string): string[] {
  const dir = path.join(rootDir, assertSafeId(workspaceId, "Workspace id"));
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, MATTER_FILE)))
    .map((entry) => entry.name);
}

/** Write to a sibling temp name, then rename so readers never see a partial file. */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value), "utf8");
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Parsed JSON, or null when the file does not exist. Corrupt files raise so callers can decide. */
export function readJson(file: string): unknown {
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError("internal_error", `Stored record ${path.basename(file)} is unreadable: ${detail}`, 500);
  }
}

export function readBytesIfPresent(file: string): Uint8Array | null {
  return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name.trim()).replace(/[^\w.-]+/g, "_");
  return base || "document.docx";
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.byteLength >= ZIP_MAGIC.length && Buffer.from(bytes.subarray(0, ZIP_MAGIC.length)).equals(ZIP_MAGIC);
}

/** Next `S<n>` id: one past the highest existing number, so ids stay unique after deletions. */
export function nextDocId(docs: readonly MatterDocCard[]): string {
  const highest = docs.reduce((max, doc) => {
    const match = DOC_ID_PATTERN.exec(doc.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `S${highest + 1}`;
}

export function assertFileCaps(docs: readonly MatterDocCard[], bytes: Uint8Array): void {
  if (docs.length >= LEGAL_CAPS.maxFiles) {
    throw new ApiError("invalid_request", `A matter holds at most ${LEGAL_CAPS.maxFiles} files`, 413);
  }
  if (bytes.byteLength === 0) {
    throw new ApiError("invalid_request", "The uploaded file is empty", 400);
  }
  if (bytes.byteLength > LEGAL_FILE_MAX_BYTES) {
    throw new ApiError("invalid_request", "A file exceeds the 25 MB cap", 413);
  }
  const total = docs.reduce((sum, doc) => sum + doc.bytes, 0) + bytes.byteLength;
  if (total > LEGAL_MATTER_MAX_BYTES) {
    throw new ApiError("invalid_request", "The matter exceeds the 100 MB cap", 413);
  }
}

/**
 * Sniff the zip magic, then let the reader confirm the package parts. The reader raises
 * "docx:"-prefixed errors for anything that is not a Word document.
 */
export async function parseDocxOrThrow(bytes: Uint8Array): Promise<DocxDocument> {
  if (!isZip(bytes)) {
    throw new ApiError("unsupported_content_type", UNSUPPORTED_FILE_MESSAGE, 400);
  }
  try {
    return await readDocx(bytes);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(DOCX_ERROR_PREFIX)) {
      throw new ApiError("unsupported_content_type", UNSUPPORTED_FILE_MESSAGE, 400);
    }
    throw error;
  }
}

function previewText(doc: DocxDocument): string {
  const paragraphs = doc.paragraphs.map((paragraph) => paragraph.text);
  const rows = doc.tables.flatMap((table) => table.rows.map((row) => row.join(" | ")));
  return [...paragraphs, ...rows]
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .slice(0, LEGAL_CAPS.previewChars);
}

export function buildDocCard(input: {
  id: string;
  filename: string;
  bytes: Uint8Array;
  sha256: string;
  doc: DocxDocument;
}): MatterDocCard {
  const name = sanitizeFilename(input.filename);
  return {
    id: input.id,
    name,
    path: `files/${input.id}.docx`,
    mime: DOCX_MIME,
    bytes: input.bytes.byteLength,
    sha256: input.sha256,
    role: "context",
    status: "read",
    paragraphs: input.doc.stats.paragraphs,
    words: input.doc.stats.words,
    insertions: input.doc.stats.insertions,
    deletions: input.doc.stats.deletions,
    definedTerms: input.doc.definedTerms.length,
    preview: previewText(input.doc),
  };
}
