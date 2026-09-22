/**
 * Phase 9 lane C — who is signed in, and the way out.
 *
 * Mounted on Settings (lane G), which every target renders, so the first rule is that it is
 * invisible anywhere there is no session: the desk, webdev, and the hosted page before the boot
 * read has answered. `useSession()` already defaults to "this deployment has none", so that is one
 * `return null` rather than a capability check of its own.
 *
 * It shows the identifiers the host actually gives out — `sessionSummary` is
 * `{ signedIn, userId, orgId, tenantId, expiresAt }` and deliberately carries no token, no email
 * and no device label (`packages/host/src/auth/session.ts`). Nothing here asks for more.
 *
 * Signing out is a POST and then a **full page load**, in that order and for the same reason the
 * callback page reloads: the CSRF token is bound to the session id, and the next person to sign in
 * on this browser needs a token minted for their own session.
 *
 * Where that page load goes is the SR-21 fix. Clearing this deployment's cookie is only half a
 * sign-out: the portal keeps a 30-day browser session of its own, and while it is live pressing
 * "Sign in" goes straight through `/authorize` to a code with no e-mail and no OTP — so on a
 * shared browser the next person was signed in as the one who had just left. The host's sign-out
 * answer names the portal's own `/logout`, and the browser is sent through it and back to
 * `/sign-in`.
 */
import { useState } from "react";
import { safeAuthorizeUrl } from "@/components/sign-in-screen";
import { apiFetch } from "@/lib/api-client";
import { formatSessionExpiry, useSession } from "@/lib/session";
import { getLocale, t } from "@/lib/i18n";

export const SIGNED_OUT_PATH = "/sign-in";
export const LOGOUT_PATH = "/api/v1/auth/logout";

/**
 * The sign-out POST, returning what the host answered.
 *
 * `useSession().signOut` discards the body, and the body is where the portal hop is, so this row
 * makes the call itself. Nothing is lost by doing so: the very next line is a full page load, and
 * both ends of the sign-out are idempotent.
 */
export async function requestSignOut(): Promise<unknown> {
  const response = await apiFetch(LOGOUT_PATH, { method: "POST" });
  return response.json().catch(() => null);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Where the browser goes after the local sign-out: the portal's `/logout` when the host named a
 * usable one, otherwise this app's own sign-in screen.
 *
 * Validated exactly as the authorize URL is (`safeAuthorizeUrl`) and for the same reason: a 200
 * from our own host is not permission to navigate anywhere its body names, and `location.replace`
 * would happily follow a `javascript:` value.
 */
export function signedOutDestination(payload: unknown): string {
  const outer = record(payload);
  return safeAuthorizeUrl((record(outer?.body) ?? outer)?.portalLogoutUrl) ?? SIGNED_OUT_PATH;
}

/**
 * Revoke, then leave — never the other way round. A navigation started before the POST resolves
 * tears the request down and leaves a live row behind a cookie the browser has already dropped.
 * A failed logout still leaves: the cookie is no use to the person, and the next request that
 * answers 401 ends the row anyway. A failure also means no portal hop, so it lands on `/sign-in`
 * — signed out here, and still signed in at the portal, which is the honest half-outcome.
 */
export async function signOutAndLeave(
  signOut: () => Promise<unknown>,
  go: (url: string) => void,
): Promise<void> {
  let answer: unknown = null;
  try {
    answer = await signOut();
  } catch {
    // Reported by the next 401; never a reason to strand somebody on a desk they cannot use.
  }
  go(signedOutDestination(answer));
}

export function AccountSessionRow() {
  const session = useSession();
  const [busy, setBusy] = useState(false);

  if (session.status !== "signed-in" || !session.identity) {
    return null;
  }

  const { userId, orgId, expiresAt } = session.identity;
  const expires = formatSessionExpiry(expiresAt, getLocale());

  return (
    <section
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3"
      data-testid="auth-account"
    >
      <h3 className="text-sm font-semibold text-[var(--text)]">{t("auth.account.title")}</h3>
      <dl className="mt-2 space-y-1 text-sm text-[var(--text-2)]">
        <div className="flex flex-wrap gap-2">
          <dt className="text-[var(--text-3)]">{t("auth.account.user")}</dt>
          <dd className="font-mono text-xs">{userId}</dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="text-[var(--text-3)]">{t("auth.account.org")}</dt>
          <dd className="font-mono text-xs">{orgId}</dd>
        </div>
      </dl>
      {expires ? <p className="mt-2 text-xs text-[var(--text-3)]">{t("auth.account.expires", { when: expires })}</p> : null}
      <button
        type="button"
        className="mt-3 rounded-md border border-[var(--line)] px-4 py-2 text-sm text-[var(--text)] disabled:opacity-50"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signOutAndLeave(requestSignOut, (url) => window.location.replace(url));
        }}
        data-testid="auth-signout"
      >
        {busy ? t("auth.account.signingOut") : t("auth.account.signOut")}
      </button>
    </section>
  );
}
