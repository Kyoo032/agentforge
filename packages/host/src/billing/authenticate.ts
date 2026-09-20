/**
 * Who is allowed to write a tenant's plan.
 *
 * The billing webhook is the only writer of `tenant_plan.status`, and no browser ever calls it —
 * the caller is a payment provider's server. So it is exempt from the session gate and from the
 * CSRF rule (decision doc §3(c)), and everything that would normally authenticate a request has to
 * be replaced by something here. It is a shared secret in a header, compared in constant time.
 *
 * **Why a shared secret and not a signature, for now.** D4 is unanswered: the provider follows
 * kyo's selling entity, and two of the three candidates (Paddle, Stripe) verify an HMAC over the
 * RAW request body, which needs a raw-body path threaded through `readBody` that this lane does
 * not build, while the third (Xendit) authenticates on exactly this — a static token in a header,
 * no raw body needed. Lane B therefore ships the shape Xendit already wants and the shape a
 * provider-neutral integration test can drive, and leaves the signature adapter for the lane that
 * knows which provider it is writing for. `verifyBillingRequest` is the seam that adapter replaces.
 *
 * **Fail closed, loudly, when nothing is configured.** A deployment with no secret set refuses
 * every delivery rather than accepting any: an open webhook is a route by which anybody on the
 * internet can set any tenant's plan to `active` with an unlimited allowance.
 */
import { timingSafeEqual } from "node:crypto";
import type { EnvLike } from "@agentforge/core";

/** The header the shared secret arrives in. Xendit's own name, so its adapter needs no mapping. */
export const BILLING_TOKEN_HEADER = "x-callback-token";

/** Where the operator puts the secret. Not a provider credential — it authenticates a caller. */
export const BILLING_SECRET_ENV = "AGENTFORGE_BILLING_WEBHOOK_SECRET";

export type BillingAuthVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "billing_not_configured" | "billing_unauthorized"; readonly message: string };

/** `timingSafeEqual` throws on a length mismatch, so the lengths are compared first. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Is this delivery from the party that holds the secret?
 *
 * `env` is a parameter rather than a read of `process.env` so the tests drive both verdicts
 * without touching the process, the same way the rest of the host's mode-dependent code does.
 */
export function verifyBillingRequest(
  presented: string | null | undefined,
  env: EnvLike = process.env,
): BillingAuthVerdict {
  const secret = env[BILLING_SECRET_ENV]?.trim();
  if (!secret) {
    return {
      ok: false,
      code: "billing_not_configured",
      message: `No billing webhook secret is configured. Set ${BILLING_SECRET_ENV} before pointing a provider at this route.`,
    };
  }
  const token = presented?.trim() ?? "";
  if (!token || !constantTimeEquals(token, secret)) {
    return { ok: false, code: "billing_unauthorized", message: "This billing webhook call was not authenticated." };
  }
  return { ok: true };
}
