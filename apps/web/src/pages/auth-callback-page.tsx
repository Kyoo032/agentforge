/**
 * Phase 9 lane C — where the portal drops the browser back.
 *
 * The portal redirects to `<public base>/auth/callback?code=…&state=…`, or
 * `?error=<reason>&state=…` when it refused. This page turns that one-shot query into a session and
 * then gets out of the way. It holds four rules, all of them deliberate:
 *
 * **The code leaves the address bar immediately.** `history.replaceState` runs before the exchange,
 * not after it, so the authorization code is out of the browser's history and out of any `Referer`
 * this page might generate whatever the exchange answers. It is single-use and 60 seconds long
 * (plan §Data model), but neither of those is a reason to leave it lying in the URL bar.
 *
 * **It runs exactly once.** The guard is module-level rather than a ref, because React StrictMode
 * mounts, unmounts and remounts a component in development: a ref is re-created, a module is not.
 * Without it the second pass reads a query that the first pass already stripped, concludes
 * `invalid_request`, and redirects a browser that has *just signed in* back to the sign-in screen.
 *
 * **Success is a full page load.** The CSRF token is bound to the session id
 * (`packages/host/src/http-adapter.ts`, `mintCsrfTokenFor`), so the token this page is holding was
 * minted for the signed-out request and the first mutation after a client-side navigation would
 * answer 403. `window.location.replace` re-primes it. That is also why there is no `useNavigate` in
 * this file and why it renders outside a router.
 *
 * **Every failure lands on `/sign-in?reason=<code>`**, where `lib/auth-reason.ts` has copy for the
 * host's vocabulary and one generic sentence for anything else.
 */
import { useEffect } from "react";
import { errorCodeFrom } from "@/lib/auth-reason";
import { apiFetch } from "@/lib/api-client";
import { t } from "@/lib/i18n";

export const LOGIN_PATH = "/api/v1/auth/login";
export const SIGN_IN_PATH = "/sign-in";
export const SIGNED_IN_PATH = "/chat";

export type CallbackParams = {
  readonly code: string | null;
  readonly state: string | null;
  readonly error: string | null;
};

export type CallbackOutcome = { readonly kind: "signed-in" } | { readonly kind: "failed"; readonly reason: string };

/** The two things this page does to the browser, injected so the whole run is drivable in a test. */
export type CallbackScope = {
  readonly search: string;
  readonly pathname: string;
  /** `history.replaceState` — same document, no query, no entry added. */
  readonly stripQuery: (path: string) => void;
  /** `window.location.replace` — a real page load, which re-mints the session-bound CSRF token. */
  readonly go: (url: string) => void;
};

/**
 * Did the host set a session cookie?
 *
 * Only the flag, not the identifiers: the cookie is already in the browser by the time this is
 * read, so treating a thin answer as a failure would bounce a signed-in person back to a sign-in
 * screen they no longer need — and the reload that follows re-reads the whole summary through
 * `GET /api/v1/auth/session` anyway (`lib/session.tsx`).
 */
function isSignedInAnswer(body: unknown): boolean {
  if (!body || typeof body !== "object") {
    return false;
  }
  const outer = body as Record<string, unknown>;
  const inner = outer.body && typeof outer.body === "object" ? (outer.body as Record<string, unknown>) : outer;
  return inner.signedIn === true;
}

function param(query: URLSearchParams, name: string): string | null {
  const value = query.get(name);
  return value && value.trim().length > 0 ? value.trim() : null;
}

export function readCallbackParams(search: string): CallbackParams {
  const query = new URLSearchParams(search);
  return { code: param(query, "code"), state: param(query, "state"), error: param(query, "error") };
}

export function nextLocation(outcome: CallbackOutcome): string {
  return outcome.kind === "signed-in"
    ? SIGNED_IN_PATH
    : `${SIGN_IN_PATH}?reason=${encodeURIComponent(outcome.reason)}`;
}

/**
 * The exchange itself.
 *
 * A landing with no code, or with a code and no state, never reaches the host: the state is the
 * login-CSRF binding and the host refuses the same pair anyway (`readState`,
 * `packages/host/src/auth/routes.ts`), so the round trip would only spend the person's time.
 */
export async function completeCallback(params: CallbackParams): Promise<CallbackOutcome> {
  if (params.error) {
    return { kind: "failed", reason: params.error };
  }
  if (!params.code || !params.state) {
    return { kind: "failed", reason: "invalid_request" };
  }
  let response: Response;
  try {
    response = await apiFetch(LOGIN_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: params.code, state: params.state }),
    });
  } catch {
    return { kind: "failed", reason: "portal_unavailable" };
  }
  const body = await response.json().catch(() => null);
  if (response.ok && isSignedInAnswer(body)) {
    return { kind: "signed-in" };
  }
  return { kind: "failed", reason: errorCodeFrom(body) ?? "invalid_grant" };
}

/** Module-level, so StrictMode's second mount joins the first run instead of starting a second. */
let started: Promise<void> | null = null;

async function execute(scope: CallbackScope): Promise<void> {
  const params = readCallbackParams(scope.search);
  scope.stripQuery(scope.pathname);
  scope.go(nextLocation(await completeCallback(params)));
}

export function runCallback(scope: CallbackScope): Promise<void> {
  started ??= execute(scope);
  return started;
}

export function resetCallbackGuardForTests(): void {
  started = null;
}

function browserScope(): CallbackScope | null {
  if (typeof window === "undefined") {
    return null;
  }
  return {
    search: window.location.search,
    pathname: window.location.pathname,
    stripQuery: (path) => {
      try {
        window.history.replaceState(null, "", path);
      } catch {
        // A browser that refuses the rewrite still gets the navigation below; the code is spent
        // either way, and failing here must not strand the person on a blank page.
      }
    },
    go: (url) => window.location.replace(url),
  };
}

export function AuthCallbackPage() {
  useEffect(() => {
    const scope = browserScope();
    if (scope) {
      void runCallback(scope);
    }
  }, []);

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-app text-inkbase"
      data-testid="auth-callback"
    >
      <p className="text-sm font-medium tracking-[var(--track)] text-[var(--text)]">{t("auth.callback.working")}</p>
    </main>
  );
}
