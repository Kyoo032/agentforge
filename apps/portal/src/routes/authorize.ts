/**
 * The browser login: `GET /authorize`, then two form posts.
 *
 *   GET  /authorize          validate the client -> signed in? redirect with a code : sign-in form
 *   POST /authorize/email    send a code (or not), always the same page
 *   POST /authorize/verify   check the code -> login gate -> 302 with code+state, or ?error=
 *
 * The client and the `redirect_uri` are re-validated on **every one of those three**, not just the
 * first. The values travel in hidden fields so they stay out of the URL bar and out of any
 * `Referer`, and a hidden field is a field the user edits -- so it is re-checked against the
 * registered allowlist each time, exactly as if it had just arrived in the query string.
 */
import {
  checkClient,
  issueAuthorizationCode,
  readAuthorizeParams,
  redirectWithCode,
  redirectWithError,
  type AuthorizeParams,
  MAX_EMAIL_LENGTH,
} from "../flows/authorize";
import type { PortalRuntime } from "../flows/context";
import { runBrowserLoginGate, webInstallId } from "../flows/login";
import { redirectErrorReason } from "../flows/reasons";
import { sendLoginOtp } from "../otp/send";
import { verifyLoginOtp } from "../otp/verify";
import { OTP_TTL_MINUTES } from "../otp/send";
import { versionIsLive, webSessionCookieFor } from "../flows/web-session";
import { boundedField, stringField } from "../security/body";
import { htmlResponse, redirectResponse } from "../security/headers";
import type { WebSession } from "../security/web-session";
import type { PortalRequest, PortalResponse, PortalRoute } from "../server";
import { enterCodePage, signInPage } from "../views/pages";
import {
  codeErrorMessage,
  csrfOk,
  ensureCsrf,
  htmlError,
  limit,
  readForm,
  requestContext,
  type RequestContext,
} from "./support";

const EMAIL_PATH = "/authorize/email";
const VERIFY_PATH = "/authorize/verify";

const CLIENT_ERROR_COPY: Readonly<Record<string, string>> = Object.freeze({
  invalid_request: "error.badRequest",
  invalid_client: "error.invalidClient",
  invalid_redirect: "error.invalidRedirect",
});

/** The three values that travel across the two posts. */
function hiddenFor(params: AuthorizeParams, extra: Readonly<Record<string, string>> = {}) {
  return {
    response_type: "code",
    client_id: params.clientId ?? "",
    redirect_uri: params.redirectUri ?? "",
    state: params.state ?? "",
    ...extra,
  };
}

/**
 * The one extra `form-action` source a page in this flow carries.
 *
 * **Only call this after `checkClient` has returned ok on the same params.** The value it returns
 * is the client's `redirect_uri`, which by then has been exact-matched against that client's
 * registered allowlist; `security/headers.ts` reduces it to `new URL(x).origin` and refuses
 * anything that is not an http(s) origin. Before that check the `redirect_uri` is attacker input
 * and naming it in a policy would be the same mistake as redirecting to it.
 *
 * It has to be named at all because a browser applies `form-action` to every hop of a
 * submission's redirect chain, and the successful `POST /authorize/verify` ends on the client's
 * origin. With `'self'` alone Chromium blocks the post and the page simply does nothing.
 */
function clientFormAction(params: AuthorizeParams): readonly string[] {
  return params.redirectUri ? [params.redirectUri] : [];
}

function paramsFromFields(fields: Readonly<Record<string, unknown>>): AuthorizeParams {
  return readAuthorizeParams({
    get: (name) => {
      const value = fields[name];
      return typeof value === "string" ? value : null;
    },
  });
}

export function authorizeRoutes(runtime: PortalRuntime): readonly PortalRoute[] {
  return [
    { method: "GET", path: "/authorize", handle: (request) => getAuthorize(runtime, request) },
    { method: "POST", path: EMAIL_PATH, handle: (request) => postEmail(runtime, request) },
    { method: "POST", path: VERIFY_PATH, handle: (request) => postVerify(runtime, request) },
  ];
}

async function getAuthorize(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const context = requestContext(runtime, request);
  if (!limit([runtime.limiters.authorizeIp, context.ipKey]).ok) {
    return htmlError(context, "error.rateLimited", { status: 429 });
  }

  const params = readAuthorizeParams(request.query);
  const client = await checkClient(runtime, params);
  if (!client.ok) {
    // Nothing redirects here. An unvalidated redirect_uri is an open redirect, and this one would
    // eventually carry an authorization code.
    return htmlError(context, CLIENT_ERROR_COPY[client.reason]);
  }

  const session = context.webSession;
  if (session && session.tenantId === client.tenantId) {
    // `resume` is what makes the 30-day convenience revocable: the cookie's version is compared
    // against `web_session_versions` inside the same transaction that reads the user, so a
    // `POST /auth/logout { all_devices: true }` ends it here on the very next request (SR-21).
    const done = await completeSignIn(runtime, context, params, client.tenantId, session.userId, {
      resume: session,
    });
    if (done) {
      return done;
    }
    // The session's user no longer exists, its cookie has been revoked, or it is for another
    // tenant's user: fall through to the form rather than answering an error nobody can act on.
  }

  const csrf = ensureCsrf(runtime, context);
  return htmlResponse(
    signInPage({
      locale: context.locale,
      t: context.t,
      action: EMAIL_PATH,
      csrfToken: csrf.token,
      hidden: hiddenFor(params),
    }),
    { cookie: csrf.cookie, formActionOrigins: clientFormAction(params) },
  );
}

async function postEmail(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const context = requestContext(runtime, request);
  const body = readForm(request);
  if (!body.ok) {
    return htmlError(context, "error.badRequest", { status: body.reason === "too_large" ? 413 : 400 });
  }
  if (!csrfOk(runtime, context, body.fields)) {
    return htmlError(context, "error.expiredForm", { status: 403 });
  }
  if (!limit([runtime.limiters.authorizeIp, context.ipKey], [runtime.limiters.otpSendIp, context.ipKey]).ok) {
    return htmlError(context, "error.rateLimited", { status: 429 });
  }

  const params = paramsFromFields(body.fields);
  const client = await checkClient(runtime, params);
  if (!client.ok) {
    return htmlError(context, CLIENT_ERROR_COPY[client.reason]);
  }

  const email = boundedField(body.fields, "email", MAX_EMAIL_LENGTH);
  if (email) {
    // The outcome is audited and never rendered: an unknown address, an address in two tenants,
    // an address in another tenant and a real one all produce the page below.
    await sendLoginOtp(
      { store: runtime.store, mailer: runtime.mailer, log: runtime.log, clock: runtime.clock },
      {
        email,
        requiredTenantId: client.tenantId,
        purpose: "portal_login",
        locale: context.locale,
        ip: context.ip,
      },
    );
  }

  const csrf = ensureCsrf(runtime, context);
  return htmlResponse(
    enterCodePage({
      locale: context.locale,
      t: context.t,
      action: VERIFY_PATH,
      csrfToken: csrf.token,
      hidden: hiddenFor(params, { email: email ?? "" }),
      expiresInMinutes: OTP_TTL_MINUTES,
    }),
    { cookie: csrf.cookie, formActionOrigins: clientFormAction(params) },
  );
}

async function postVerify(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const context = requestContext(runtime, request);
  const body = readForm(request);
  if (!body.ok) {
    return htmlError(context, "error.badRequest", { status: body.reason === "too_large" ? 413 : 400 });
  }
  if (!csrfOk(runtime, context, body.fields)) {
    return htmlError(context, "error.expiredForm", { status: 403 });
  }
  if (!limit([runtime.limiters.authorizeIp, context.ipKey]).ok) {
    return htmlError(context, "error.rateLimited", { status: 429 });
  }

  const params = paramsFromFields(body.fields);
  const client = await checkClient(runtime, params);
  if (!client.ok) {
    return htmlError(context, CLIENT_ERROR_COPY[client.reason]);
  }

  const email = boundedField(body.fields, "email", MAX_EMAIL_LENGTH);
  const code = stringField(body.fields, "code");
  if (!email || !code) {
    return retryCode(runtime, context, params, email, context.t("code.missing"));
  }

  const verified = await verifyLoginOtp(
    { store: runtime.store, log: runtime.log, clock: runtime.clock },
    {
      email,
      code,
      requiredTenantId: client.tenantId,
      purpose: "portal_login",
      ip: context.ip,
    },
  );
  if (!verified.ok) {
    return retryCode(runtime, context, params, email, codeErrorMessage(context, verified));
  }

  const done = await completeSignIn(runtime, context, params, client.tenantId, verified.user.id);
  return done ?? htmlError(context, "error.generic", { status: 500 });
}

function retryCode(
  runtime: PortalRuntime,
  context: RequestContext,
  params: AuthorizeParams,
  email: string | null,
  error: string,
): PortalResponse {
  const csrf = ensureCsrf(runtime, context);
  return htmlResponse(
    enterCodePage({
      locale: context.locale,
      t: context.t,
      action: VERIFY_PATH,
      csrfToken: csrf.token,
      hidden: hiddenFor(params, { email: email ?? "" }),
      expiresInMinutes: OTP_TTL_MINUTES,
      error,
    }),
    { status: 400, cookie: csrf.cookie, formActionOrigins: clientFormAction(params) },
  );
}

/**
 * The shared tail: login gate, authorization code, 302.
 *
 * A gate denial redirects with `?error=<reason>` rather than rendering, so the product's own
 * sign-in screen shows the copy -- which is where `seat_cap_reached` belongs, next to the admin
 * who can free a seat. `null` means the session's user has gone and the caller should render the
 * form instead.
 */
async function completeSignIn(
  runtime: PortalRuntime,
  context: RequestContext,
  params: AuthorizeParams,
  tenantId: string,
  userId: string,
  options: { readonly resume?: WebSession } = {},
): Promise<PortalResponse | null> {
  const clientId = params.clientId as string;
  const redirectUri = params.redirectUri as string;
  const state = params.state ?? "";
  const installId = webInstallId(clientId);

  const outcome = await runtime.store.tx(tenantId, async (ops) => {
    // Before the user is even read: a cookie whose version is behind the stored one was revoked,
    // and "sign in again" is the only honest answer.
    if (options.resume && !(await versionIsLive(ops, options.resume))) {
      return { kind: "unknown_user" as const };
    }
    const user = await ops.users.findById(userId);
    if (!user) {
      return { kind: "unknown_user" as const };
    }
    const gate = await runBrowserLoginGate(ops, { tenantId, user, installId });
    if (!gate.ok) {
      await ops.audit.append({
        tenantId,
        orgId: user.orgId,
        actorKind: "user",
        actorUserId: user.id,
        action: "login.denied",
        targetKind: "user",
        targetId: user.id,
        reasonCode: gate.reason,
        ip: context.ip,
      });
      return { kind: "denied" as const, reason: gate.reason };
    }
    const code = await issueAuthorizationCode(ops, {
      tenantId,
      user,
      device: gate.device,
      clientId,
      redirectUri,
      state,
      ip: context.ip,
    });
    // Minted inside the same transaction that issued the code, so the version it carries is the
    // one that was live when this sign-in happened.
    const cookie = await webSessionCookieFor(runtime, ops, {
      tenantId,
      userId: user.id,
      orgId: user.orgId,
      installId,
    });
    return { kind: "ok" as const, code, cookie };
  });

  if (outcome.kind === "unknown_user") {
    return null;
  }
  if (outcome.kind === "denied") {
    return redirectResponse(redirectWithError(redirectUri, redirectErrorReason(outcome.reason), state));
  }

  return redirectResponse(redirectWithCode(redirectUri, outcome.code, state), {
    cookie: outcome.cookie,
  });
}
