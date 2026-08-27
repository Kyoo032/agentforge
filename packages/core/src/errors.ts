export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export class ContentParseError extends ApiError {
  constructor(code: string, message: string) {
    super(code, message, 400);
    this.name = "ContentParseError";
  }
}
