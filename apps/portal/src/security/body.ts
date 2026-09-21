/**
 * Reading a request body, at the boundary and nowhere else.
 *
 * `src/server.ts` caps everything at 64 KB. That is the ceiling for the whole service; the limits
 * here are the ones each shape actually needs, because a login body is a few hundred bytes and
 * nothing the portal accepts has a reason to be larger. A smaller cap costs nothing and removes a
 * class of "parse 60 KB of JSON on an unauthenticated endpoint" entirely.
 *
 * Both parsers answer a union rather than throwing: a malformed body is an expected outcome on an
 * unauthenticated endpoint, and the caller has a specific error to return for it.
 */

/** A JSON login body: `install_id`, a token, a client id. Never more. */
export const MAX_JSON_BODY_BYTES = 8 * 1024;
/** A form body: an e-mail, six digits, a `state`, a `user_code`, two hidden fields. */
export const MAX_FORM_BODY_BYTES = 8 * 1024;

export type BodyResult =
  | { readonly ok: true; readonly fields: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: "too_large" | "malformed" };

export function parseJsonBody(raw: string, maxBytes = MAX_JSON_BODY_BYTES): BodyResult {
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  if (raw.trim() === "") {
    return { ok: true, fields: Object.freeze({}) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // An array or a scalar is not a request body; treating `[1,2]` as `{}` would make a missing
  // field look like a missing value rather than a malformed call.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, fields: Object.freeze(parsed as Record<string, unknown>) };
}

export function parseFormBody(raw: string, maxBytes = MAX_FORM_BODY_BYTES): BodyResult {
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  const fields: Record<string, string> = {};
  try {
    for (const [name, value] of new URLSearchParams(raw)) {
      // Last write wins, which is what a browser does with a duplicated field name.
      fields[name] = value;
    }
  } catch {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, fields: Object.freeze(fields) };
}

/** A field that must be a non-empty string, trimmed. Anything else is absent. */
export function stringField(fields: Readonly<Record<string, unknown>>, name: string): string | null {
  const value = fields[name];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** A length ceiling for a free-text field, so nothing unbounded reaches a query or a page. */
export function boundedField(
  fields: Readonly<Record<string, unknown>>,
  name: string,
  maxLength: number,
): string | null {
  const value = stringField(fields, name);
  return value !== null && value.length <= maxLength ? value : null;
}
