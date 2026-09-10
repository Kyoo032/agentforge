/**
 * C8: an adapter never guesses. When a vendor payload lacks a key the row
 * depends on, the adapter throws this instead of filling a default.
 */
export class AdapterSchemaError extends Error {
  readonly adapter: string;
  readonly ticker: string;
  readonly missing: readonly string[];

  constructor(adapter: string, ticker: string, missing: readonly string[]) {
    super(`${adapter} returned an unexpected shape for ${ticker}: missing ${missing.join(", ")}`);
    this.name = "AdapterSchemaError";
    this.adapter = adapter;
    this.ticker = ticker;
    this.missing = [...missing];
  }
}

export function isAdapterSchemaError(error: unknown): error is AdapterSchemaError {
  return error instanceof AdapterSchemaError;
}
