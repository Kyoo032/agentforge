/** Typed failures from the PDF text extractor. Callers map these onto their own error envelope. */
export type PdfExtractErrorCode = "too_large" | "timeout" | "no_text_layer" | "invalid";

export class PdfExtractError extends Error {
  readonly code: PdfExtractErrorCode;

  constructor(code: PdfExtractErrorCode, message: string) {
    super(message);
    this.name = "PdfExtractError";
    this.code = code;
  }
}

export function isPdfExtractError(error: unknown): error is PdfExtractError {
  return error instanceof PdfExtractError;
}
