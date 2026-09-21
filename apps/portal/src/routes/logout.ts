/**
 * The way out of the portal's own 30-day browser session.
 *
 *   GET  /logout?client_id=&post_logout_redirect_uri=   clear the cookie, then go back or explain
 *   POST /logout                                        the same, from a CSRF-protected form
 *
 * Why this exists (SR-21): the portal's session cookie is what makes the second and third sign-in
 * need no code, and nothing could end it. Signing out of the app cleared the app's cookie and left
 * the portal's, so pressing "Sign in" on a shared browser signed the *next* person in as the one
 * who had just left, with no address and no code. `clearCookie` had been written for this and was
 * called from nowhere.
 *
 * Two rules, and both are the security of this route:
 *
 *   - **The cookie is cleared on every answer**, including every refusal. There is no path through
 *     here that leaves a portal session behind, because a sign-out that quietly did nothing is the
 *     bug this route is fixing.
 *   - **`post_logout_redirect_uri` is only followed when its ORIGIN exactly matches the origin of
 *     one of that client's registered `redirect_uris`.** Same allowlist `/authorize` uses, same
 *     exact-match rule, no prefix and no wildcard — this response carries no authorization code,
 *     but an open redirect on the portal's own domain is still a phishing primitive and the portal
 *     is the domain people are told to trust with a sign-in code. Anything else renders the
 *     neutral "signed out" page instead, which is a true statement either way.
 *
 * `GET` is allowed to do the clearing because that is what RP-initiated logout is: a top-level
 * navigation the app sends the browser on. The worst a forged one can do is sign somebody out.
 */
import type { PortalRuntime } from "../flows/context";
import { auditWebSessionRevoked, clearedWebSessionCookie } from "../flows/web-session";
import { boundedField } from "../security/body";
import { htmlResponse, redirectResponse } from "../security/headers";
import type { PortalRequest, PortalResponse, PortalRoute } from "../server";
import { outcomePage } from "../views/pages";
import { csrfOk, htmlError, limit, readForm, requestContext, type RequestContext } from "./support";

export const LOGOUT_PATH = "/logout";
const MAX_CLIENT_ID = 64;
/** The same ceiling `readAuthorizeParams` puts on a `redirect_uri`. */
const MAX_REDIRECT = 512;

export function logoutRoutes(runtime: PortalRuntime): readonly PortalRoute[] {
  return [
    { method: "GET", path: LOGOUT_PATH, handle: (request) => getLogout(runtime, request) },
    { method: "POST", path: LOGOUT_PATH, handle: (request) => postLogout(runtime, request) },
  ];
}

/**
 * The origin of a registered callback this client is allowed to be returned to, or null.
 *
 * Exact origin match against `oauth_clients.redirect_uris`. The path is the client's business —
 * `/sign-in` is the one the product sends — but the origin is not, and `URL.origin` is what makes
 * "the same host on another port" a different answer.
 */
export async function allowedPostLogoutRedirect(
  runtime: PortalRuntime,
  clientId: string | null,
  candidate: string | null,
): Promise<string | null> {
  if (!clientId || !candidate) {
    return null;
  }
  let target: URL;
  try {
    target = new URL(candidate);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return null;
  }

  const tenantId = await runtime.store.resolve.byClientId(clientId);
  if (!tenantId) {
    return null;
  }
  const client = await runtime.store.tx(tenantId, (ops) => ops.oauthClients.findByClientId(clientId));
  if (client?.status !== "active") {
    return null;
  }

  for (const registered of client.redirectUris) {
    try {
      if (new URL(registered).origin === target.origin) {
        return target.toString();
      }
    } catch {
      // A row that is not a URL cannot match one. It also cannot have been seeded since
      // `src/seed/args.ts` started refusing anything but https and loopback http.
    }
  }
  return null;
}

function signedOutPage(context: RequestContext, cookie: string): PortalResponse {
  return htmlResponse(
    outcomePage({
      locale: context.locale,
      t: context.t,
      title: context.t("signedOut.title"),
      message: context.t("signedOut.body"),
    }),
    { cookie },
  );
}

/**
 * Clear, audit, then either go back to the client or say so on a page.
 *
 * The audit row is written only when the cookie carried a session: without one there is no tenant
 * to write it against (`audit_log.tenant_id` is NOT NULL) and nothing happened worth recording.
 * `after.scope` is `browser`, not `user` — this ends one cookie and leaves that person's other
 * browsers alone, which is what a shared-computer sign-out means.
 */
async function endBrowserSession(
  runtime: PortalRuntime,
  context: RequestContext,
  request: PortalRequest,
  fields: Readonly<Record<string, unknown>>,
): Promise<PortalResponse> {
  const cookie = clearedWebSessionCookie(runtime);
  const session = context.webSession;

  if (session) {
    try {
      await runtime.store.tx(session.tenantId, (ops) =>
        auditWebSessionRevoked(ops, {
          tenantId: session.tenantId,
          orgId: session.orgId,
          userId: session.userId,
          scope: "browser",
          ip: context.ip,
        }),
      );
    } catch {
      // An audit that could not be written must not keep somebody signed in. The cookie below is
      // the thing that matters, and it goes out either way.
    }
  }

  const clientId = boundedField(fields, "client_id", MAX_CLIENT_ID)
    ?? (request.query.get("client_id")?.slice(0, MAX_CLIENT_ID) || null);
  const candidate = boundedField(fields, "post_logout_redirect_uri", MAX_REDIRECT)
    ?? (request.query.get("post_logout_redirect_uri")?.slice(0, MAX_REDIRECT) || null);

  const back = await allowedPostLogoutRedirect(runtime, clientId, candidate);
  return back ? redirectResponse(back, { cookie }) : signedOutPage(context, cookie);
}

async function getLogout(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const context = requestContext(runtime, request);
  if (!limit([runtime.limiters.authorizeIp, context.ipKey]).ok) {
    return htmlError(context, "error.rateLimited", { status: 429 });
  }
  return endBrowserSession(runtime, context, request, {});
}

async function postLogout(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const context = requestContext(runtime, request);
  const body = readForm(request);
  if (!body.ok) {
    return htmlError(context, "error.badRequest", { status: body.reason === "too_large" ? 413 : 400 });
  }
  if (!csrfOk(runtime, context, body.fields)) {
    // A refusal here still clears the cookie: a stale form is not a reason to stay signed in, and
    // the page it renders says exactly what happened.
    return htmlError(context, "error.expiredForm", {
      status: 403,
      cookie: clearedWebSessionCookie(runtime),
    });
  }
  if (!limit([runtime.limiters.authorizeIp, context.ipKey]).ok) {
    return htmlError(context, "error.rateLimited", { status: 429 });
  }
  return endBrowserSession(runtime, context, request, body.fields);
}
