export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly suggestModel?: string;

  constructor(code: string, message: string, status: number, suggestModel?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    if (suggestModel) {
      this.suggestModel = suggestModel;
    }
  }
}

export class ContentParseError extends ApiError {
  constructor(code: string, message: string) {
    super(code, message, 400);
    this.name = "ContentParseError";
  }
}
