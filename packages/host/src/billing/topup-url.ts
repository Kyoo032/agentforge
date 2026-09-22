/**
 * `AGENTFORGE_BILLING_TOPUP_URL` — the operator's "where a purchase happens" link, judged once.
 *
 * The route used to hand this variable back to the browser verbatim, and the renderer turned it
 * into an `href`. A `javascript:` or `data:` value in the deployment's environment would then be
 * script execution inside the tenant's own session, which is a configuration mistake becoming a
 * vulnerability. The renderer checks the scheme too (`apps/web/lib/plans-api.ts safeCheckoutUrl`)
 * and keeps doing so — a control at the source and a control at the sink are not redundant, they
 * are the two ends of the same string.
 *
 * Owned by this module so the route and the boot check (`../hosted-env.ts`) ask the same question.
 * Whatever it refuses is `available: false` and a warning that names the VARIABLE and never the
 * value: an operator who mis-pasted a secret into this slot must not see it echoed in a log.
 */

export const TOPUP_URL_ENV = "AGENTFORGE_BILLING_TOPUP_URL";

/** Said at boot and on first use. Names the variable; carries nothing of what was in it. */
export const TOPUP_URL_INVALID_WARNING =
  `WARNING: ${TOPUP_URL_ENV} is set to something that is not an http(s) URL, so it is ignored. ` +
  "POST /api/v1/billing/top-up will answer available:false until it is fixed, and a blocked " +
  "tenant will be told to contact the operator. Only the variable name is reported, never its value.";

/**
 * The link, or `null` for anything that is not an absolute http(s) URL — including an empty
 * variable, a relative path, and every other scheme.
 */
export function topUpUrl(raw: string | undefined | null): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

/** True when the variable is set to something this deployment will not use. */
export function topUpUrlMisconfigured(raw: string | undefined | null): boolean {
  return Boolean(typeof raw === "string" && raw.trim()) && topUpUrl(raw) === null;
}
