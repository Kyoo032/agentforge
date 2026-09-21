/**
 * Why the person is looking at the sign-in screen, in words they can read.
 *
 * One vocabulary, three sources, one mapping:
 *
 *   - the host's thirteen `AUTH_REASONS` (`packages/host/src/auth/session.ts`), which arrive as the
 *     `code` of the `{ error: { code, message } }` envelope or as `reason` on
 *     `GET /api/v1/auth/session`;
 *   - `login_not_configured` (`packages/host/src/auth/portal-config.ts`), which is not a session
 *     verdict at all but an operator's missing environment variable, and reads as one;
 *   - `?reason=` in the address bar, which the portal put there and anybody can retype.
 *
 * **The code chooses a key; it never becomes text.** Everything renderable is on a fixed list, and
 * anything off it collapses to one generic sentence. That is the control behind "never render raw
 * query text": a visitor who navigates to `/sign-in?reason=<img onerror=…>` gets the generic line,
 * because their string never leaves this module.
 *
 * The host also sends `message` / the portal's `message_en` alongside the code. This renderer
 * prefers its own catalog for known codes, per the locale rule in the root AGENTS.md — the host's
 * copy is English-only and this app has to speak Indonesian too.
 */
import { t } from "@/lib/i18n";

/**
 * The host's vocabulary, in the order `packages/host/src/auth/session.ts` declares it. Thirteen,
 * and both catalogs carry all thirteen (`apps/web/locales/{en,id}/auth.json`).
 */
export const AUTH_REASONS = [
  "tenant_inactive",
  "org_inactive",
  "org_past_due",
  "user_inactive",
  "seat_cap_reached",
  "device_revoked",
  "session_revoked",
  "refresh_reused",
  "refresh_expired",
  "invalid_request",
  "invalid_grant",
  "session_required",
  "portal_unavailable",
] as const;

export type AuthReason = (typeof AUTH_REASONS)[number];

/**
 * Not a session verdict: the deployment has no portal URL, client id or client secret, so nobody
 * can sign in here at all. `GET /api/v1/auth/start` answers 503 with this code, and the copy behind
 * it is addressed to whoever runs the box rather than to the person in front of it.
 */
export const LOGIN_NOT_CONFIGURED = "login_not_configured";

/** The one sentence anything unrecognised renders as. */
export const UNKNOWN_REASON_KEY = "auth.reason.unknown";

const RENDERABLE: ReadonlySet<string> = new Set<string>([...AUTH_REASONS, LOGIN_NOT_CONFIGURED]);

export function isAuthReason(value: unknown): value is AuthReason {
  return typeof value === "string" && (AUTH_REASONS as readonly string[]).includes(value);
}

/** A code this module has copy for → its catalog key; everything else → the generic one. */
export function authReasonKey(value: unknown): string {
  return typeof value === "string" && RENDERABLE.has(value) ? `auth.reason.${value}` : UNKNOWN_REASON_KEY;
}

/** The sentence to show. Never the caller's own string. */
export function authReasonMessage(value: unknown): string {
  return t(authReasonKey(value));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The reason code out of an error body, or null.
 *
 * Reads the host's envelope (`{ error: { code, message } }`, `packages/host/src/errors.ts`) through
 * the optional `{ body: … }` wrapper the desktop IPC transport adds — the same unwrapping
 * `brandFromUnknown` and the storage card already do, for the same reason.
 */
export function errorCodeFrom(body: unknown): string | null {
  const outer = record(body);
  if (!outer) {
    return null;
  }
  const inner = record(outer.body) ?? outer;
  const error = record(inner.error);
  const code = error?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}
