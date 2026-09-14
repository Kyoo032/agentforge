export const LEGAL_LOCALES = ["en", "id"] as const;
export type LegalLocale = (typeof LEGAL_LOCALES)[number];

/** Accept an explicit locale from run context; unknown values fall back to `en`. */
export function resolveLegalLocale(...candidates: unknown[]): LegalLocale {
  for (const value of candidates) {
    if (value === "id" || value === "en") {
      return value;
    }
  }
  return "en";
}

const INDENT = "  ";

/** Extra LANGUAGE instruction so model-composed artifact text follows the run locale when provided. */
export function legalUserFacingLanguageInstruction(locale: LegalLocale): string {
  if (locale === "id") {
    return [
      `${INDENT}User-facing artifact text (finding titles, why, proposed language, memorandum paragraphs and headings you compose)`,
      `${INDENT}MUST be written in professional Bahasa Indonesia, polite Anda / infinitive. Keep defined terms, party names,`,
      `${INDENT}clause numbers, document ids, JSON keys, and verbatim quotations in the source language of the documents.`,
    ].join("\n");
  }
  return [
    `${INDENT}User-facing artifact text (finding titles, why, proposed language, memorandum paragraphs and headings you compose)`,
    `${INDENT}MUST be written in English. Keep defined terms, party names, clause numbers, document ids, JSON keys, and`,
    `${INDENT}verbatim quotations in the source language of the documents.`,
  ].join("\n");
}
