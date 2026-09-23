/**
 * The host's half of the Toko Token portal contract
 * (docs/internal/portal/device-code-login.md).
 *
 * What the doc freezes and this file implements verbatim:
 *   - `POST /auth/token` with `grant_type=refresh_token` (doc §"POST /auth/token", :196-224),
 *     carrying the **server-side** `device_id`, never the client-minted `install_id`.
 *   - `POST /auth/logout`, Bearer access token, body `{ all_devices: false }`, always idempotent
 *     (doc :228-230).
 *   - the error body `{ error, reason, message_en, message_id, retry_after }` (doc :85-94) and the
 *     reason-code list (doc :222 and the table at :409-423), reused **verbatim**: this file never
 *     invents a code.
 *
 * # THE BROWSER LOGIN WIRE CONTRACT (Phase 9, frozen 2026-09-21)
 *
 * The doc's client half is the Electron device-code flow (`/auth/device/code` → `/activate` →
 * `/auth/device/approve` → `/auth/device/token`) and it says at the top that the hosted web app
 * "needs a browser-session variant of this flow" — open decision 2 in web-pivot-2026-09-18.md.
 * Phase 9 settles that variant. **The portal implements the other side of exactly this and nothing
 * else; neither half deviates without changing this comment.**
 *
 * 1. **Authorize** — a top-level browser navigation, built by `buildAuthorizeUrl` below and handed
 *    to the browser by `GET /api/v1/auth/start`:
 *
 *        {AGENTFORGE_PORTAL_URL}/authorize
 *          ?response_type=code
 *          &client_id=<AGENTFORGE_PORTAL_CLIENT_ID>
 *          &redirect_uri=<public base>/auth/callback
 *          &state=<opaque>
 *
 *    `redirect_uri` is validated by the portal against that client's registered allowlist; `state`
 *    is the host's login-CSRF binding (`./login-state.ts`) and is echoed back unchanged.
 *
 * 2. **Code exchange** — confidential client, so it is made by the host process and never by the
 *    browser:
 *
 *        POST {AGENTFORGE_PORTAL_URL}/auth/token
 *        { "grant_type": "authorization_code", "code": "<code>", "redirect_uri": "<the same one>",
 *          "client_id": "<id>", "client_secret": "<secret>" }
 *
 *    The answer is the same token body `/auth/device/token` returns, read by `toTokens` below.
 *
 * 3. **Refresh and logout are unchanged**, and so are the response and error bodies: `toTokens`
 *    and `mapPortalError` are exactly what they were before Phase 9.
 *
 * Rules that are not negotiable here: 5 s timeout on every call, the base URL comes from
 * `AGENTFORGE_PORTAL_URL` (never from user input), and no token, code, state or client secret is
 * ever logged or put in an error message.
 */
import { assertAllowedEndpointUrl } from "@agentforge/core";
import type { EnvLike } from "@agentforge/core";
import { isAuthReason, type AuthReason } from "./session";

export const PORTAL_TIMEOUT_MS = 5000;
export const PORTAL_URL_ENV = "AGENTFORGE_PORTAL_URL";
/** Step 1 of the contract above: where the browser is sent to sign in. */
export const PORTAL_AUTHORIZE_PATH = "/authorize";

/** What the host must present to redeem a browser code. Every field is required — see step 2. */
export type PortalExchangeInput = {
  readonly code: string;
  /** Byte-identical to the one in the authorize URL; the portal compares them. */
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
};

/** The portal's token response, in this repo's camelCase. Tokens never leave the host process. */
export type PortalTokens = {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
  readonly refreshExpiresIn: number;
  readonly sessionId: string;
  readonly deviceId: string | null;
  readonly userId: string;
  readonly orgId: string;
  readonly tenantId: string;
};

/**
 * A refresh. With both client credentials it authenticates as the confidential client, exactly as
 * the code exchange does, and the portal counts it against the client (20,000 / 10 min) rather than
 * the caller's address (300 / 10 min) — which matters because the host refreshes every hosted
 * session from one address. Both halves or neither: one without the other is never sent.
 */
export type PortalRefreshInput = {
  readonly refreshToken: string;
  readonly deviceId?: string | null;
  readonly clientId?: string | null;
  readonly clientSecret?: string | null;
};

export interface PortalClient {
  /** Browser login: redeem the one-time code the portal handed the browser (contract step 2). */
  exchangeCode(input: PortalExchangeInput): Promise<PortalTokens>;
  /** `grant_type=refresh_token`; rotation and reuse detection are the portal's job. */
  refresh(input: PortalRefreshInput): Promise<PortalTokens>;
  /**
   * Idempotent at the portal. Rejects with a `PortalError` when the portal did not sign the session
   * out (a stale access token, an unreachable portal), so the caller can see it happened; keeping
   * the local sign-out going regardless is the caller's rule (`./routes.ts` `handleLogout`).
   */
  logout(input: { accessToken: string; allDevices?: boolean }): Promise<void>;
}

/** A refusal from the portal, already reduced to one reason code from the doc's list. */
export class PortalError extends Error {
  readonly code: AuthReason;
  readonly reason: AuthReason;
  readonly status: number;
  readonly messageEn: string | null;
  readonly messageId: string | null;
  readonly retryAfter: number | null;
  /**
   * The RFC 6749 `error` the portal sent (`invalid_grant`, `invalid_client`, …), for a log line. The
   * `reason` is what callers branch on; this only says which family the refusal came from.
   */
  readonly rfcError: string | null;

  constructor(
    reason: AuthReason,
    status: number,
    copy: {
      messageEn?: string | null;
      messageId?: string | null;
      retryAfter?: number | null;
      rfcError?: string | null;
    } = {},
  ) {
    // The message carries the reason only. Never a token, never the portal's raw body.
    super(`Portal refused the request: ${reason}`);
    this.name = "PortalError";
    this.code = reason;
    this.reason = reason;
    this.status = status;
    this.messageEn = copy.messageEn ?? null;
    this.messageId = copy.messageId ?? null;
    this.retryAfter = copy.retryAfter ?? null;
    this.rfcError = copy.rfcError ?? null;
  }
}

/** `AGENTFORGE_PORTAL_URL`, validated the same way every other outbound endpoint is. */
export function portalBaseUrl(env: EnvLike = process.env): string {
  const raw = env[PORTAL_URL_ENV]?.trim();
  if (!raw) {
    throw new Error(`${PORTAL_URL_ENV} is not set; the hosted server cannot reach the portal.`);
  }
  assertAllowedEndpointUrl(raw);
  return raw.replace(/\/+$/, "");
}

/**
 * Step 1 of the contract, as a pure function of its four arguments.
 *
 * `URLSearchParams` both orders and percent-encodes the query, so a `redirect_uri` with its own
 * query string survives intact and nothing a caller passes can inject a fifth parameter. The client
 * **secret** is not here and never is: the authorize hop happens in the browser's address bar.
 */
export function buildAuthorizeUrl(input: {
  baseUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const query = new URLSearchParams([
    ["response_type", "code"],
    ["client_id", input.clientId],
    ["redirect_uri", input.redirectUri],
    ["state", input.state],
  ]);
  return `${input.baseUrl.replace(/\/+$/, "")}${PORTAL_AUTHORIZE_PATH}?${query.toString()}`;
}

/**
 * The exchange is never made half-configured. A blank client id or secret would be an
 * unauthenticated exchange and a blank `redirect_uri` an unverifiable one, so both refuse here —
 * in the client, where every implementation including the test double goes through it — rather
 * than relying on each caller to have checked.
 */
function assertExchangeInput(input: PortalExchangeInput): void {
  if (!input.redirectUri?.trim() || !input.clientId?.trim() || !input.clientSecret?.trim()) {
    throw new PortalError("invalid_request", 400);
  }
}

type PortalErrorBody = {
  error?: unknown;
  reason?: unknown;
  message_en?: unknown;
  message_id?: unknown;
  retry_after?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The portal's refusals always carry an RFC 6749 `error`, a `reason`, or both (doc :85-94). A 4xx
 * without either did not come from the portal's error path: a proxy's 404 page, a WAF block, a
 * misrouted base path.
 */
function speaksPortalErrors(record: PortalErrorBody): boolean {
  return typeof record.error === "string" || typeof record.reason === "string";
}

/**
 * Portal failure → one reason code. `reason` wins; otherwise the RFC 6749 family the doc lists
 * (`invalid_request` / `invalid_grant` are the two this vocabulary carries); a 5xx, an unreadable
 * body, or a 4xx that is not in the portal's error shape is `portal_unavailable`, the only code here
 * the portal itself cannot send.
 *
 * That last case matters since the session gate asks the portal on its own (`./portal-check.ts`):
 * read as `invalid_grant` it is a terminal refusal, and one misrouted URL would end every session
 * the gate checked.
 */
export function mapPortalError(status: number, body: unknown): PortalError {
  const record = (body ?? {}) as PortalErrorBody;
  const copy = {
    messageEn: asString(record.message_en),
    messageId: asString(record.message_id),
    retryAfter: asNumber(record.retry_after),
    rfcError: asString(record.error),
  };
  // Before `reason`: the portal narrows `invalid_client` to `reason: invalid_grant` for the host,
  // which would read as a terminal refusal. A wrong client secret says nothing about any session;
  // it is this deployment failing to use the portal.
  if (record.error === "invalid_client") {
    return new PortalError("portal_unavailable", 502, copy);
  }
  if (isAuthReason(record.reason)) {
    return new PortalError(record.reason, status, copy);
  }
  if (status >= 500 || status === 0 || !speaksPortalErrors(record)) {
    return new PortalError("portal_unavailable", 502, copy);
  }
  if (record.error === "invalid_request") {
    return new PortalError("invalid_request", status, copy);
  }
  return new PortalError("invalid_grant", status, copy);
}

function toTokens(body: unknown): PortalTokens {
  const record = (body ?? {}) as Record<string, unknown>;
  const accessToken = asString(record.access_token);
  const refreshToken = asString(record.refresh_token);
  const sessionId = asString(record.session_id);
  const userId = asString(record.user_id);
  const orgId = asString(record.org_id);
  const tenantId = asString(record.tenant_id);
  if (!accessToken || !refreshToken || !sessionId || !userId || !orgId || !tenantId) {
    // A 200 we cannot read is the portal misbehaving, not the user's fault.
    throw new PortalError("portal_unavailable", 502);
  }
  return {
    accessToken,
    refreshToken,
    expiresIn: asNumber(record.expires_in) ?? 0,
    refreshExpiresIn: asNumber(record.refresh_expires_in) ?? 0,
    sessionId,
    deviceId: asString(record.device_id),
    userId,
    orgId,
    tenantId,
  };
}

export type PortalClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  env?: EnvLike;
};

export function createPortalClient(options: PortalClientOptions = {}): PortalClient {
  const base = options.baseUrl?.replace(/\/+$/, "") ?? portalBaseUrl(options.env);
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PORTAL_TIMEOUT_MS;

  async function call(path: string, init: { body: unknown; accessToken?: string }): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (init.accessToken) {
      headers.authorization = `Bearer ${init.accessToken}`;
    }
    try {
      return await doFetch(`${base}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Timeout, DNS, TLS, refused connection: the portal is simply not there. No cause is attached,
      // because a fetch failure can carry the request (and therefore a token) in its message.
      throw new PortalError("portal_unavailable", 503);
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      const text = await response.text();
      return text.length === 0 ? {} : JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function tokenCall(body: unknown): Promise<PortalTokens> {
    const response = await call("/auth/token", { body });
    const parsed = await readJson(response);
    if (!response.ok) {
      throw mapPortalError(response.status, parsed);
    }
    if (parsed === null) {
      throw new PortalError("portal_unavailable", 502);
    }
    return toTokens(parsed);
  }

  return {
    async exchangeCode(input) {
      assertExchangeInput(input);
      return tokenCall({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: input.clientId,
        client_secret: input.clientSecret,
      });
    },
    async refresh({ refreshToken, deviceId, clientId, clientSecret }) {
      const client =
        clientId?.trim() && clientSecret?.trim() ? { client_id: clientId, client_secret: clientSecret } : {};
      return tokenCall({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        ...(deviceId ? { device_id: deviceId } : {}),
        ...client,
      });
    },
    async logout({ accessToken, allDevices = false }) {
      // Doc :230 — "Idempotent, always 204" for a token the portal accepts. Anything else is
      // reported rather than swallowed: it used to resolve on a 401 as well, so signing out with
      // an access token that had aged past its hour looked exactly like a portal sign-out that had
      // happened. The route refreshes first and keeps its local sign-out going either way.
      const response = await call("/auth/logout", { body: { all_devices: allDevices }, accessToken });
      if (!response.ok) {
        throw mapPortalError(response.status, await readJson(response));
      }
    },
  };
}

/** What a fake recorded, so a test can assert the call without asserting on the wire format. */
export type FakePortalCall =
  /** The client **secret** is deliberately absent: a recorded call is something a test may print. */
  | { kind: "exchange"; code: string; redirectUri: string; clientId: string }
  | { kind: "refresh"; refreshToken: string; deviceId: string | null; clientId?: string }
  | { kind: "logout"; allDevices: boolean };

export type FakePortalClient = PortalClient & { readonly calls: FakePortalCall[] };

const FAKE_TOKENS: PortalTokens = {
  accessToken: "fake-access",
  refreshToken: "fake-refresh",
  expiresIn: 3600,
  refreshExpiresIn: 2592000,
  sessionId: "ses_fake",
  deviceId: "dev_fake",
  userId: "usr_fake",
  orgId: "org_fake",
  tenantId: "tnt_fake",
};

/**
 * The test double for the portal. Lives beside the real client so the route tests and a webdev
 * driver use exactly the same interface; it never opens a socket.
 */
export function createFakePortalClient(
  options: { tokens?: Partial<PortalTokens>; failWith?: PortalError } = {},
): FakePortalClient {
  const tokens: PortalTokens = { ...FAKE_TOKENS, ...options.tokens };
  const calls: FakePortalCall[] = [];
  const guard = () => {
    if (options.failWith) {
      throw options.failWith;
    }
  };
  return {
    calls,
    async exchangeCode(input) {
      assertExchangeInput(input);
      calls.push({ kind: "exchange", code: input.code, redirectUri: input.redirectUri, clientId: input.clientId });
      guard();
      return tokens;
    },
    async refresh({ refreshToken, deviceId, clientId, clientSecret }) {
      const authenticated = clientId?.trim() && clientSecret?.trim() ? { clientId } : {};
      calls.push({ kind: "refresh", refreshToken, deviceId: deviceId ?? null, ...authenticated });
      guard();
      return tokens;
    },
    async logout({ allDevices = false }) {
      calls.push({ kind: "logout", allDevices });
    },
  };
}
