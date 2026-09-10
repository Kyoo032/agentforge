const MAX_DETAIL = 300;

function detailOf(body: unknown): string | null {
  if (typeof body === "string") {
    return body.trim() || null;
  }
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
    return ((error as Record<string, unknown>).message as string).trim() || null;
  }
  if (typeof error === "string") {
    return error.trim() || null;
  }
  if (typeof record.message === "string") {
    return record.message.trim() || null;
  }
  return null;
}

/** Owner-facing text for a failed generation; the upstream reason is kept, trimmed to a sane length. */
export function generateFailureMessage(status: number, body: unknown): string {
  const detail = detailOf(body);
  if (!detail) {
    return `Generation failed (${status})`;
  }
  const trimmed = detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL)}…` : detail;
  return `Generation failed (${status}): ${trimmed}`;
}
