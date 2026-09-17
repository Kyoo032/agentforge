/**
 * Every cap the local file → Markdown pipeline enforces, in one place.
 *
 * Nothing here is new policy: the byte cap is the cap the PDF and knowledge uploads already use, the
 * deadline is the PDF deadline, and the row / column / cell caps are the ones Finance already applies
 * to a spreadsheet. Naming them here keeps `extractFile` free of literals and keeps a document import
 * inside exactly the same envelope a spreadsheet import has always had.
 */
import {
  FINANCE_IMPORT_MAX_CELL_CHARS,
  FINANCE_IMPORT_MAX_COLS,
  FINANCE_IMPORT_MAX_ROWS,
  FINANCE_IMPORT_MAX_BYTES,
} from "@agentforge/core/finance";
import { PDF_MAX_BYTES, PDF_TIMEOUT_MS } from "@agentforge/core/pdf";
import { KNOWLEDGE_TEXT_MAX_CHARS } from "../knowledge-text";

/**
 * Largest file read as a document. Both existing caps are 25 MB; the lower of the two is taken so a
 * later change to either one can only tighten this, never loosen it behind our back.
 */
export const FILE_EXTRACT_MAX_BYTES = Math.min(PDF_MAX_BYTES, FINANCE_IMPORT_MAX_BYTES);

/** Wall clock for one conversion, matching the PDF deadline the knowledge path already uses. */
export const FILE_EXTRACT_TIMEOUT_MS = PDF_TIMEOUT_MS;

/** Markdown longer than this is cut on a line boundary and `meta.truncated` is set. */
export const FILE_EXTRACT_MAX_MARKDOWN_CHARS = KNOWLEDGE_TEXT_MAX_CHARS;

/** Most tables parsed out of one document. A deck or a workbook past this is prose, not figures. */
export const FILE_EXTRACT_MAX_TABLES = 200;

/** Most rows kept per parsed table, header included. Mirrors the spreadsheet import cap. */
export const FILE_EXTRACT_MAX_TABLE_ROWS = FINANCE_IMPORT_MAX_ROWS;

/** Most columns kept per parsed table. Mirrors the spreadsheet import cap. */
export const FILE_EXTRACT_MAX_TABLE_COLS = FINANCE_IMPORT_MAX_COLS;

/** Longest single cell kept. Mirrors the spreadsheet import cap: past this it is sheet prose. */
export const FILE_EXTRACT_MAX_CELL_CHARS = FINANCE_IMPORT_MAX_CELL_CHARS;
