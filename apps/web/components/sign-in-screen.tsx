/**
 * Phase 9 lane C — the only door into the hosted deployment.
 *
 * One button. Pressing it asks the host for the portal's authorize URL
 * (`GET /api/v1/auth/start`, which also sets the `state` cookie the login is bound to) and hands
 * the browser over with a top-level navigation. There is nothing to type here: the product has no
 * password and never will (root AGENTS.md, "Two doors, no password") — the portal emails a code.
 *
 * Two rules on this screen are controls rather than polish:
 *
 *   - **The reason never becomes text.** `?reason=` is whatever is in the address bar. It selects a
 *     catalog key from a fixed list or it selects the generic one (`lib/auth-reason.ts`), so a
 *     visitor's own string is never rendered, escaped or otherwise.
 *   - **The authorize URL is validated before it is followed.** A 200 from our own host is not a
 *     permission to navigate anywhere its body names; `safeAuthorizeUrl` refuses everything that is
 *     not an absolute `http(s)` URL, which is what keeps a `javascript:` value out of
 *     `location.assign`.
 */
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { apiFetch } from "@/lib/api-client";
import { authReasonMessage, errorCodeFrom } from "@/lib/auth-reason";
import { t } from "@/lib/i18n";
import { useProductBrand } from "@/lib/product-brand";

export const START_PATH = "/api/v1/auth/start";

export type StartResult = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * An absolute `http(s)` URL, normalised — or null.
 *
 * `new URL` without a base already refuses everything relative, including the protocol-relative
 * `//host/path` that would otherwise read as same-origin. The protocol check is what refuses
 * `javascript:` and `data:`, which are absolute URLs and would otherwise pass.
 */
export function safeAuthorizeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
}

/**
 * Hop one: ask the host where to send the person.
 *
 * Every failure comes back as a code with copy behind it rather than as an exception — the host's
 * own (`login_not_configured`, a portal reason, `not_found` off a hosted server), or
 * `portal_unavailable` when there was no usable answer at all.
 */
export async function startSignIn(): Promise<StartResult> {
  let response: Response;
  try {
    response = await apiFetch(START_PATH);
  } catch {
    return { ok: false, reason: "portal_unavailable" };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, reason: errorCodeFrom(body) ?? "portal_unavailable" };
  }
  const outer = record(body);
  const url = safeAuthorizeUrl((record(outer?.body) ?? outer)?.authorizeUrl);
  return url ? { ok: true, url } : { ok: false, reason: "portal_unavailable" };
}

export function SignInScreen() {
  const location = useLocation();
  const { productName, logoSrc } = useProductBrand();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // What the portal sent us back with, until the button produces something newer to say.
  const arrivedWith = new URLSearchParams(location.search).get("reason");
  const reason = failure ?? arrivedWith;

  async function onStart(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const result = await startSignIn();
    if (result.ok) {
      // Top-level navigation, not a fetch: the portal has its own page and its own cookie, and the
      // code comes back to `/auth/callback` in this app's address bar.
      window.location.assign(result.url);
      return;
    }
    setFailure(result.reason);
    setBusy(false);
  }

  return (
    <main
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-8 text-[var(--text)]"
      data-testid="auth-signin"
    >
      {logoSrc ? <img src={logoSrc} alt={productName} className="mb-6 h-8 w-8" /> : null}
      <h1 className="text-2xl font-medium tracking-[var(--track)]">{t("auth.signIn.title", { productName })}</h1>
      <p className="mt-2 text-[var(--text-2)]">{t("auth.signIn.intro")}</p>
      {reason ? (
        <p className="mt-6 rounded-lg border border-[var(--line)] px-3 py-2 text-sm text-[var(--danger)]" data-testid="auth-reason">
          {authReasonMessage(reason)}
        </p>
      ) : null}
      <button
        type="button"
        className="btn btn-primary mt-6 disabled:opacity-50"
        onClick={() => void onStart()}
        disabled={busy}
        data-testid="auth-signin-start"
      >
        {busy ? t("auth.signIn.working") : t("auth.signIn.action")}
      </button>
      <p className="mt-4 text-xs text-[var(--text-3)]">{t("auth.signIn.noPassword")}</p>
    </main>
  );
}
