/**
 * One refusal, one reason code, one status -- and the copy that goes with it.
 *
 * `device-code-login.md` fixes three things this file owns end to end:
 *
 *   1. the error body `{ error, reason, message_en, message_id, retry_after }` (doc :85-94);
 *   2. `error` from the RFC 6749 / 8628 family, `reason` from **our** list, which is what the
 *      client branches on (doc :94);
 *   3. the reason vocabulary and its display copy (doc :409-423), which lives in
 *      `apps/portal/locales/{en,id}/portal.json` and is read from there rather than restated --
 *      the HTML pages and these JSON bodies say the same sentence because they read the same key.
 *
 * `HOST_AUTH_REASONS` is the other half of the contract: `packages/host/src/auth/session.ts`
 * (`AUTH_REASONS`) is the only vocabulary the product understands, and anything outside it is
 * flattened to `invalid_grant` by `mapPortalError` in `packages/host/src/auth/portal-client.ts`.
 * So `/auth/token` and `/auth/logout` -- the two endpoints the host calls -- may only emit a
 * reason from that list, and `tokenErrorBody` enforces it rather than trusting a call site.
 */
import { copyPair } from "../views/i18n";

/** The 11 checks of the login doc's reason table, plus the two poll-timing answers. */
export const PORTAL_REASONS = [
  "tenant_inactive",
  "org_inactive",
  "org_past_due",
  "user_inactive",
  "seat_cap_reached",
  "device_revoked",
  "session_revoked",
  "refresh_reused",
  "refresh_expired",
  "device_code_expired",
  "device_code_denied",
  "authorization_pending",
  "slow_down",
  "invalid_request",
  "invalid_grant",
  "invalid_client",
  "rate_limited",
] as const;

export type PortalReason = (typeof PORTAL_REASONS)[number];

/**
 * `AUTH_REASONS` from `packages/host/src/auth/session.ts`, copied because the portal imports
 * nothing from the product (`apps/portal/AGENTS.md`, rule 1). `session_required` and
 * `portal_unavailable` are the host's own and the portal never sends them.
 */
export const HOST_AUTH_REASONS: readonly string[] = [
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
];

/** The RFC family each reason is reported under. */
const ERROR_FAMILY: Readonly<Record<PortalReason, string>> = Object.freeze({
  tenant_inactive: "invalid_grant",
  org_inactive: "invalid_grant",
  org_past_due: "invalid_grant",
  user_inactive: "invalid_grant",
  seat_cap_reached: "invalid_grant",
  device_revoked: "invalid_grant",
  session_revoked: "invalid_grant",
  refresh_reused: "invalid_grant",
  refresh_expired: "invalid_grant",
  device_code_expired: "expired_token",
  device_code_denied: "access_denied",
  authorization_pending: "authorization_pending",
  slow_down: "slow_down",
  invalid_request: "invalid_request",
  invalid_grant: "invalid_grant",
  invalid_client: "invalid_client",
  rate_limited: "invalid_request",
});

/**
 * Statuses come straight from the doc: the login-gate checks are `403` at approve and token time,
 * the refresh failures are `401`, an expired device code is `410`, and the two poll answers are
 * `400` so the client keeps polling rather than treating them as terminal.
 */
const STATUS: Readonly<Record<PortalReason, number>> = Object.freeze({
  tenant_inactive: 403,
  org_inactive: 403,
  org_past_due: 403,
  user_inactive: 403,
  seat_cap_reached: 403,
  device_revoked: 403,
  session_revoked: 401,
  refresh_reused: 401,
  refresh_expired: 401,
  device_code_expired: 410,
  device_code_denied: 403,
  authorization_pending: 400,
  slow_down: 400,
  invalid_request: 400,
  invalid_grant: 400,
  invalid_client: 401,
  rate_limited: 429,
});

export interface ErrorBody {
  readonly error: string;
  readonly reason: PortalReason;
  readonly message_en: string;
  readonly message_id: string;
  readonly retry_after?: number;
}

export function statusFor(reason: PortalReason): number {
  return STATUS[reason];
}

/** `authorization_pending` and `slow_down` have no user-facing copy; the doc says so explicitly. */
const SILENT: ReadonlySet<PortalReason> = new Set(["authorization_pending", "slow_down"]);

export function errorBody(reason: PortalReason, retryAfter?: number): ErrorBody {
  const copy = SILENT.has(reason) ? { en: "", id: "" } : copyPair(`reason.${reason}`);
  return Object.freeze({
    error: ERROR_FAMILY[reason],
    reason,
    message_en: copy.en,
    message_id: copy.id,
    ...(retryAfter === undefined ? {} : { retry_after: retryAfter }),
  });
}

/**
 * The same body, narrowed to what the host can read.
 *
 * A reason outside `HOST_AUTH_REASONS` would be silently rewritten to `invalid_grant` by
 * `mapPortalError`, which loses the distinction the client branches on -- so this converts it
 * here, deliberately and in one place, rather than letting the host guess.
 */
export function tokenErrorBody(reason: PortalReason, retryAfter?: number): ErrorBody {
  if (HOST_AUTH_REASONS.includes(reason)) {
    return errorBody(reason, retryAfter);
  }
  // Only `reason` is narrowed. `error` keeps the RFC 6749 family the refusal actually belongs to
  // -- `invalid_client` for a failed client authentication -- because that field is the standard
  // one and narrowing it as well would make the response wrong rather than merely coarse.
  const narrowed = errorBody(reason === "rate_limited" ? "invalid_request" : "invalid_grant", retryAfter);
  return Object.freeze({ ...narrowed, error: ERROR_FAMILY[reason] });
}

/** The vocabulary `/authorize` may put in `?error=` on the way back to the client. */
export function redirectErrorReason(reason: PortalReason): PortalReason {
  return HOST_AUTH_REASONS.includes(reason) ? reason : "invalid_grant";
}
