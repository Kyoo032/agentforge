export { diffDocuments } from "./diff";
export {
  DEFINITION_MAX_CHARS,
  HEADING_MAX_CHARS,
  NUMBER_TOKEN_RE,
  type NumberKind,
  type NumberMatch,
  detectDefinedTerms,
  detectHeading,
  detectNumber,
  headingText,
} from "./paragraph-analysis";
export { readDocx } from "./read";
export { splitClauses } from "./sections";
export { WORD_DIFF_CAP, diceSimilarity, wordDiff, words } from "./similarity";
export { type BodyItem, type QuoteHit, bodyOrder, documentText, findQuote, paragraphByAnchor } from "./text";
export type * from "./types";
export { validateDocx } from "./validate";
export { DOCX_MAX_INFLATED_BYTES, declaredInflatedBytes } from "./zip-limits";
export { applyRedline } from "./write";
