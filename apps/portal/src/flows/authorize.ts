/**
 * `GET /authorize` -- the browser half of the login, and the one place an open redirect could be
 * introduced.
 *
 * The order is the whole security property, and it is the order `packages/host/src/auth/portal-client.ts`
 * documents as the frozen contract:
 *
 *   1. `response_type`, `client_id` and `redirect_uri` must all be present;
 *   2. the client must exist and be active;
 *   3. the `redirect_uri` must be on **that client's** registered allowlist, matched exactly.
 *
 * Only after all three does anything render, and only after all three may a response redirect. A
 * failure of any of them renders an error page and **never** issues a `Location` header, because
 * redirecting to an unvalidated `redirect_uri` is the open redirect -- and here it would be an
 * open redirect that eventually carries an authorization code.
 *
 * `state` is the host's login-CSRF nonce (`packages/host/src/auth/login-state.ts`). The portal
 * stores only `sha256(state)` and echoes the raw value back unchanged; it never interprets it.
 */
import { randomToken } from "../crypto";
import type { PortalRuntime } from "./context";
import type { PortalReason } from "./reasons";
import type { Device, PortalOps, User } from "../store/types";

/** Long enough for any real `state`, short enough that nothing unbounded reaches a page. */
export const MAX_STATE_LENGTH = 512;
export const MAX_REDIRECT_URI_LENGTH = 2048;
export const MAX_CLIENT_ID_LENGTH = 64;
export const MAX_EMAIL_LENGTH = 254;

export interface AuthorizeParams {
  readonly responseType: string | null;
  readonly clientId: string | null;
  readonly redirectUri: string | null;
  readonly state: string | null;
}

export function readAuthorizeParams(source: {
  get(name: string): string | null;
}): AuthorizeParams {
  const bounded = (name: string, max: number): string | null => {
    const value = source.get(name)?.trim();
    return value && value.length <= max ? value : null;
  };
  return Object.freeze({
    responseType: bounded("response_type", 32),
    clientId: bounded("client_id", MAX_CLIENT_ID_LENGTH),
    redirectUri: bounded("redirect_uri", MAX_REDIRECT_URI_LENGTH),
    state: bounded("state", MAX_STATE_LENGTH),
  });
}

export type ClientCheck =
  | { readonly ok: true; readonly tenantId: string }
  | {
      readonly ok: false;
      /** Which copy key the error page shows. No variant says whether the client exists. */
      readonly reason: "invalid_request" | "invalid_client" | "invalid_redirect";
    };

/**
 * Resolve and validate the client. Run on **every** hop of the flow, including the two form posts,
 * because the hidden fields that carry these values across a post are fields the user controls.
 */
export async function checkClient(
  runtime: PortalRuntime,
  params: AuthorizeParams,
): Promise<ClientCheck> {
  if (params.responseType !== "code" || !params.clientId || !params.redirectUri) {
    return { ok: false, reason: "invalid_request" };
  }
  const tenantId = await runtime.store.resolve.byClientId(params.clientId);
  if (!tenantId) {
    return { ok: false, reason: "invalid_client" };
  }
  const allowed = await runtime.store.tx(tenantId, (ops) =>
    ops.oauthClients.allowsRedirect(params.clientId as string, params.redirectUri as string),
  );
  return allowed ? { ok: true, tenantId } : { ok: false, reason: "invalid_redirect" };
}

export interface IssueCodeInput {
  readonly tenantId: string;
  readonly user: User;
  readonly device: Device;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly ip?: string | null;
}

/** 32 random bytes base64url, stored only as sha256, 60 s and single use (`auth_codes`). */
export async function issueAuthorizationCode(ops: PortalOps, input: IssueCodeInput): Promise<string> {
  const rawCode = randomToken();
  const issued = await ops.authCodes.issue({
    rawCode,
    tenantId: input.tenantId,
    orgId: input.user.orgId,
    userId: input.user.id,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    state: input.state,
    createdIp: input.ip ?? null,
  });
  await ops.audit.append({
    tenantId: input.tenantId,
    orgId: input.user.orgId,
    actorKind: "user",
    actorUserId: input.user.id,
    action: "auth_code.issued",
    targetKind: "auth_code",
    targetId: issued.id,
    // The client and the device, never the code: `src/log.ts` would drop the field anyway, and
    // `audit_log.after` is read by support.
    after: { client_id: input.clientId, device_id: input.device.id },
    ip: input.ip ?? null,
  });
  return rawCode;
}

/**
 * `URL` rather than string concatenation: a registered `redirect_uri` may legitimately carry its
 * own query string, and `searchParams.set` merges into it without letting either value escape its
 * slot.
 */
function redirectTo(
  redirectUri: string,
  params: ReadonlyArray<readonly [string, string]>,
): string {
  const url = new URL(redirectUri);
  for (const [name, value] of params) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

export function redirectWithCode(redirectUri: string, code: string, state: string): string {
  return redirectTo(redirectUri, [
    ["code", code],
    ["state", state],
  ]);
}

/** A denial the client can render: the reason, and the same `state` it sent. */
export function redirectWithError(redirectUri: string, reason: PortalReason, state: string): string {
  return redirectTo(redirectUri, [
    ["error", reason],
    ["state", state],
  ]);
}
