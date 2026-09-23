/**
 * `GET /activate` and the approval it leads to -- the browser half of the device-code flow.
 *
 *   GET  /activate?code=K7M4-PQ9T   sign in (if needed), then Approve / Deny
 *   POST /activate/email            send a code, neutrally
 *   POST /activate/verify           check it, then show Approve / Deny
 *   POST /auth/device/approve       the decision (form from this page, or JSON per the doc)
 *
 * The approve screen shows the requesting device's `platform` and `label` **from the
 * `device_codes` row**, never from the query string: the browser is a different party from the
 * device and must not be able to restate what the device claimed
 * (`device-code-login.md`, "Device metadata sent at registration").
 */
import { normaliseUserCode } from "../crypto";
import type { PortalRuntime } from "../flows/context";
import { decideDeviceCode, type ApproveDecision } from "../flows/device";
import { errorBody, statusFor } from "../flows/reasons";
import { OTP_TTL_MINUTES, sendLoginOtp } from "../otp/send";
import { verifyLoginOtp } from "../otp/verify";
import { MAX_EMAIL_LENGTH } from "../flows/authorize";
import { webSessionCookieFor, webSessionIsLive } from "../flows/web-session";
import { boundedField, stringField } from "../security/body";
import { htmlResponse } from "../security/headers";
import type { PortalRequest, PortalResponse, PortalRoute } from "../server";
import type { DeviceCode } from "../store/types";
import { approvePage, enterCodePage, outcomePage, signInPage, userCodePage } from "../views/pages";
import {
  codeErrorMessage,
  csrfOk,
  ensureCsrf,
  htmlError,
  jsonResponse,
  limit,
  readForm,
  readJson,
  requestContext,
  wantsJson,
  type RequestContext,
} from "./support";

const ACTIVATE_PATH = "/activate";
const EMAIL_PATH = "/activate/email";
const VERIFY_PATH = "/activate/verify";
const APPROVE_PATH = "/auth/device/approve";
/** `XXXX-XXXX`, or the eight characters without the dash. */
const MAX_USER_CODE_LENGTH = 9;

export function activateRoutes(runtime: PortalRuntime): readonly PortalRoute[] {
  return [
    { method: "GET", path: ACTIVATE_PATH, handle: (request) => getActivate(runtime, request) },
    { method: "POST", path: EMAIL_PATH, handle: (request) => postEmail(runtime, request) },
    { method: "POST", path: VERIFY_PATH, handle: (request) => postVerify(runtime, request) },
    { method: "POST", path: APPROVE_PATH, handle: (request) => postApprove(runtime, request) },
  ];
}

/** The pending row behind a `user_code`, inside its own tenant's scope. */
async function loadPending(
  runtime: PortalRuntime,
  userCode: string | null,
): Promise<{ readonly tenantId: string; readonly code: DeviceCode } | null> {
  if (!userCode) {
    return null;
  }
  const normalised = normaliseUserCode(userCode);
  const tenantId = await runtime.store.resolve.byUserCode(normalised);
  if (!tenantId) {
    return null;
  }
  const code = await runtime.store.tx(tenantId, (ops) => ops.deviceCodes.findByUserCode(normalised));
  if (code?.status !== "pending" || new Date(code.expiresAt) <= runtime.clock.now()) {
    return null;
  }
  return { tenantId, code };
}

function approveScreen(
  context: RequestContext,
  pending: { readonly code: DeviceCode },
  cookie: string | undefined,
  csrfToken: string,
): PortalResponse {
  return htmlResponse(
    approvePage({
      locale: context.locale,
      t: context.t,
      action: APPROVE_PATH,
      csrfToken,
      userCode: pending.code.userCode,
      platform: context.t(`platform.${pending.code.platform ?? "unknown"}`),
      deviceLabel: pending.code.clientName,
    }),
    { cookie },
  );
}

async function getActivate(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const context = requestContext(runtime, request);
  if (!limit([runtime.limiters.authorizeIp, context.ipKey]).ok) {
    return htmlError(context, "error.rateLimited", { status: 429 });
  }

  const asked = request.query.get("code");
  const userCode = asked && asked.length <= MAX_USER_CODE_LENGTH ? asked : null;
  const pending = await loadPending(runtime, userCode);
  const csrf = ensureCsrf(runtime, context);

  if (pending) {
    await runtime.store.tx(pending.tenantId, (ops) =>
      ops.audit.append({
        tenantId: pending.tenantId,
        actorKind: "system",
        action: "activate.viewed",
        targetKind: "device_code",
        targetId: pending.code.id,
        ip: context.ip,
      }),
    );
  }

  // A cookie is not a session until its version has been checked: a revoked one falls through to
  // the sign-in form exactly as an absent one does (SR-21).
  const session = (await webSessionIsLive(runtime, context.webSession)) ? context.webSession : null;
  if (!session) {
    return htmlResponse(
      signInPage({
        locale: context.locale,
        t: context.t,
        action: EMAIL_PATH,
        csrfToken: csrf.token,
        hidden: { user_code: userCode ?? "" },
      }),
      { cookie: csrf.cookie },
    );
  }

  if (pending && pending.tenantId === session.tenantId) {
    return approveScreen(context, pending, csrf.cookie, csrf.token);
  }
  return htmlResponse(
    userCodePage({
      locale: context.locale,
      t: context.t,
      action: ACTIVATE_PATH,
      csrfToken: csrf.token,
      userCode: userCode ?? undefined,
      error: userCode ? context.t("approve.unknownCode") : undefined,
    }),
    { status: userCode ? 400 : 200, cookie: csrf.cookie },
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

  const userCode = boundedField(body.fields, "user_code", MAX_USER_CODE_LENGTH);
  const email = boundedField(body.fields, "email", MAX_EMAIL_LENGTH);
  // "the tenant is resolved before a code is minted -- from device_codes.tenant_id when ?code=
  // carried a tenant_hint" (device-code-login.md, GET /activate).
  const pending = await loadPending(runtime, userCode);

  if (email) {
    await sendLoginOtp(
      { store: runtime.store, mailer: runtime.mailer, log: runtime.log, clock: runtime.clock },
      {
        email,
        requiredTenantId: pending?.tenantId ?? null,
        purpose: "activate",
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
      hidden: { user_code: userCode ?? "", email: email ?? "" },
      expiresInMinutes: OTP_TTL_MINUTES,
    }),
    { cookie: csrf.cookie },
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

  const userCode = boundedField(body.fields, "user_code", MAX_USER_CODE_LENGTH);
  const email = boundedField(body.fields, "email", MAX_EMAIL_LENGTH);
  const code = stringField(body.fields, "code");
  const pending = await loadPending(runtime, userCode);
  const csrf = ensureCsrf(runtime, context);

  const retry = (message: string): PortalResponse =>
    htmlResponse(
      enterCodePage({
        locale: context.locale,
        t: context.t,
        action: VERIFY_PATH,
        csrfToken: csrf.token,
        hidden: { user_code: userCode ?? "", email: email ?? "" },
        expiresInMinutes: OTP_TTL_MINUTES,
        error: message,
      }),
      { status: 400, cookie: csrf.cookie },
    );

  if (!email || !code) {
    return retry(context.t("code.missing"));
  }

  const verified = await verifyLoginOtp(
    { store: runtime.store, log: runtime.log, clock: runtime.clock },
    { email, code, requiredTenantId: pending?.tenantId ?? null, purpose: "activate", ip: context.ip },
  );
  if (!verified.ok) {
    return retry(codeErrorMessage(context, verified));
  }

  // The session cookie is the response's one Set-Cookie, so the CSRF token already in the
  // browser is reused rather than reminted.
  const cookie = await runtime.store.tx(verified.tenantId, (ops) =>
    webSessionCookieFor(runtime, ops, {
      tenantId: verified.tenantId,
      userId: verified.user.id,
      orgId: verified.user.orgId,
      installId: `web-client-activate-${verified.user.id}`,
    }),
  );

  if (pending && pending.tenantId === verified.tenantId) {
    return approveScreen(context, pending, cookie, csrf.token);
  }
  return htmlResponse(
    userCodePage({
      locale: context.locale,
      t: context.t,
      action: ACTIVATE_PATH,
      csrfToken: csrf.token,
      userCode: userCode ?? undefined,
      error: userCode ? context.t("approve.unknownCode") : undefined,
    }),
    { cookie },
  );
}

async function postApprove(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const context = requestContext(runtime, request);
  const json = wantsJson(request);
  const body = json ? readJson(request) : readForm(request);
  if (!body.ok) {
    return json
      ? jsonResponse(statusFor("invalid_request"), errorBody("invalid_request"))
      : htmlError(context, "error.badRequest", { status: 400 });
  }

  const session = (await webSessionIsLive(runtime, context.webSession)) ? context.webSession : null;
  if (!session) {
    return json
      ? jsonResponse(statusFor("invalid_client"), errorBody("invalid_client"))
      : htmlError(context, "error.expiredForm", { status: 401 });
  }
  // The doc: "authenticated by the portal session cookie + CSRF token". Both halves, both shapes.
  if (!csrfOk(runtime, context, body.fields)) {
    return json
      ? jsonResponse(statusFor("invalid_request"), errorBody("invalid_request"))
      : htmlError(context, "error.expiredForm", { status: 403 });
  }
  if (!limit([runtime.limiters.approveUser, session.userId]).ok) {
    return json
      ? jsonResponse(statusFor("rate_limited"), errorBody("rate_limited"))
      : htmlError(context, "error.rateLimited", { status: 429 });
  }

  const userCode = boundedField(body.fields, "user_code", MAX_USER_CODE_LENGTH);
  const raw = stringField(body.fields, "decision");
  const decision: ApproveDecision = raw === "deny" ? "deny" : "approve";
  if (!userCode || (raw !== "deny" && raw !== "approve")) {
    return json
      ? jsonResponse(statusFor("invalid_request"), errorBody("invalid_request"))
      : htmlError(context, "error.badRequest", { status: 400 });
  }

  const result = await decideDeviceCode(runtime, {
    userCode: normaliseUserCode(userCode),
    decision,
    tenantId: session.tenantId,
    userId: session.userId,
    ip: context.ip,
  });

  if (!result.ok) {
    return json
      ? jsonResponse(statusFor(result.reason), errorBody(result.reason))
      : htmlResponse(
          outcomePage({
            locale: context.locale,
            t: context.t,
            title: context.t("error.title"),
            message: context.t(`reason.${result.reason}`),
          }),
          { status: statusFor(result.reason) },
        );
  }

  if (json) {
    return jsonResponse(200, { status: result.status, device_label: result.deviceLabel });
  }
  const approved = result.status === "approved";
  return htmlResponse(
    outcomePage({
      locale: context.locale,
      t: context.t,
      title: context.t(approved ? "approved.title" : "denied.title"),
      message: context.t(approved ? "approved.body" : "denied.body"),
    }),
  );
}
