/**
 * Typed failures for the local file → Markdown pipeline.
 *
 * Every message is a sentence the owner can act on, and every one of them is deliberately free of
 * parser detail: these strings are shown on screen and persisted against a source, so converter
 * internals (which quote file bytes and paths) must never reach them. Detail goes to the log.
 *
 * `localeKey` names the `finance.upload.errors.*` entry the web side shows instead of the English
 * text, so the same failure reads naturally in Bahasa Indonesia without the host knowing a locale.
 */

export type FileExtractErrorCode =
  /** The bytes are not a format we convert, or the extension names nothing we know. */
  | "unsupported"
  /** The extension and the real bytes disagree — a .csv that is really a workbook, and so on. */
  | "format_mismatch"
  /** A PDF whose pages are scans. OCR is not available locally, and nothing is ever sent away. */
  | "needs_ocr"
  /** Structurally unusable: no meaningful content could be read out of it. */
  | "malformed"
  /** Encrypted or password protected. */
  | "encrypted"
  /** The file crossed a fixed safety limit (decompression, nesting, node count). */
  | "resource_limit"
  /** A part the format needs for any meaningful output is missing. */
  | "missing_part"
  /** Over the byte cap. */
  | "too_large"
  /** The conversion ran past its deadline. */
  | "timeout"
  /** Nothing to read. */
  | "empty";

type Copy = { readonly message: string; readonly localeKey: string };

const MB = Math.round(25_000_000 / 1_000_000);

/**
 * The one place a failure becomes words. `needs_ocr` says plainly that nothing left the machine,
 * because that is the question an owner asks the moment a scan is refused.
 */
export const FILE_EXTRACT_COPY: Readonly<Record<FileExtractErrorCode, Copy>> = {
  unsupported: {
    message: "That file type cannot be read here.",
    localeKey: "finance.upload.errors.type",
  },
  format_mismatch: {
    message: "That file is not really the type its name claims.",
    localeKey: "finance.upload.errors.mismatch",
  },
  needs_ocr: {
    message: "This PDF is scanned; OCR is not available locally yet, and nothing was sent anywhere.",
    localeKey: "finance.upload.errors.needsOcr",
  },
  malformed: {
    message: "That file could not be read (it looks damaged).",
    localeKey: "finance.upload.errors.failed",
  },
  encrypted: {
    message: "That file is password protected. Remove the password and try again.",
    localeKey: "finance.upload.errors.encrypted",
  },
  resource_limit: {
    message: "That file is too deeply nested or too large once unpacked to read safely.",
    localeKey: "finance.upload.errors.tooLarge",
  },
  missing_part: {
    message: "That file is missing a part it needs, so nothing could be read from it.",
    localeKey: "finance.upload.errors.failed",
  },
  too_large: {
    message: `That file is over the ${MB} MB cap.`,
    localeKey: "finance.upload.errors.tooLarge",
  },
  timeout: {
    message: "That file took too long to read and was not imported.",
    localeKey: "finance.upload.errors.slow",
  },
  empty: { message: "That file is empty.", localeKey: "finance.upload.errors.failed" },
} as const;

/** A conversion failure the caller can map to its own HTTP code without reading a message. */
export class FileExtractError extends Error {
  readonly code: FileExtractErrorCode;
  /** The `finance.upload.errors.*` key the web side shows instead of `message`. */
  readonly localeKey: string;

  constructor(code: FileExtractErrorCode) {
    super(FILE_EXTRACT_COPY[code].message);
    this.name = "FileExtractError";
    this.code = code;
    this.localeKey = FILE_EXTRACT_COPY[code].localeKey;
  }
}

/** `code` values anydoc puts on its rejections, mapped onto ours. */
const FROM_ANYDOC: Readonly<Record<string, FileExtractErrorCode>> = {
  unsupported: "unsupported",
  needsOcr: "needs_ocr",
  malformed: "malformed",
  encrypted: "encrypted",
  resourceLimit: "resource_limit",
  missingPart: "missing_part",
  io: "malformed",
  // Only reachable with `ocr: 'hosted'`, which this module never passes. Mapped anyway so a future
  // caller cannot turn an unknown rejection into a stack trace on screen.
  hosted: "malformed",
} as const;

/** The converter's rejection as one of ours. Anything unrecognised reads as a damaged file. */
export function fileExtractErrorFrom(error: unknown): FileExtractError {
  if (error instanceof FileExtractError) {
    return error;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return new FileExtractError(typeof code === "string" ? (FROM_ANYDOC[code] ?? "malformed") : "malformed");
}

/** First 200 characters of a cause, for the log only — never for the client. */
export function extractDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}
