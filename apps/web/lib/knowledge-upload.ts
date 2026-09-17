/**
 * The one list of file types the Knowledge Base takes.
 *
 * The picker's `accept` used to name six of them by hand while the host read sixteen, so every
 * format the converter added was hidden behind a dialog that would not offer it. The renderer
 * cannot import `packages/host`, so this is the mirror — and `knowledge-upload.test.ts` reads the
 * host's own `knowledge-extract.ts` and fails the moment the two lists disagree.
 *
 * Order is the order the owner thinks in: plain text, then documents, then the office formats.
 */

/** Every extension `extractText` reads today, dot included and lower-cased. */
export const KNOWLEDGE_UPLOAD_EXTENSIONS = [
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".html",
  ".htm",
  ".pdf",
  ".docx",
  ".doc",
  ".rtf",
  ".epub",
  ".pptx",
  ".ppt",
  ".xlsx",
  ".xls",
  ".odt",
  ".ods",
  ".odp",
] as const;

/**
 * Media types for the formats a file dialog is most likely to filter by name alone. Extensions are
 * what the host actually decides on, so these only widen the dialog; they never narrow it.
 */
const KNOWLEDGE_UPLOAD_MIMES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

/** The `accept` attribute of the knowledge file input. */
export const KNOWLEDGE_UPLOAD_ACCEPT = [...KNOWLEDGE_UPLOAD_EXTENSIONS, ...KNOWLEDGE_UPLOAD_MIMES].join(",");

/** The same list as a sentence fragment, for help copy that has to name the formats. */
export const KNOWLEDGE_UPLOAD_FORMATS = KNOWLEDGE_UPLOAD_EXTENSIONS.join(" ");

/** True when a filename ends in a type the Knowledge Base indexes. */
export function knowledgeUploadAllowed(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  return KNOWLEDGE_UPLOAD_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
