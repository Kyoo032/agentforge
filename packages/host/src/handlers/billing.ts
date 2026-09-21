/**
 * The billing routes (Phase 5 lane B).
 *
 *   POST /api/v1/billing/webhook   ← a payment provider's server. No session, no CSRF, a secret.
 *   POST /api/v1/billing/top-up    ← the signed-in tenant. D3(c)'s self-serve path out of a block.
 *   GET  /api/v1/billing/plan      ← the signed-in tenant. What it is entitled to, and why blocked.
 *   GET  /api/v1/billing/plans     ← Phase 9. The catalog, and which tier this tenant is on.
 *
 * The webhook is provider-neutral on purpose. D4 — Xendit, Paddle or Stripe — follows kyo's
 * selling entity, which this repository cannot settle, so what lands here is the event shape a
 * provider's payload is translated INTO (`@agentforge/core`'s `entitlement/webhook.ts`) and the
 * rules that apply it. The adapter from one provider's body and signature to a `BillingEvent` is
 * the next lane's, and it changes nothing below.
 *
 * **Every delivery is answered 200 once it is authenticated and parseable**, including duplicates
 * and stale ones. A provider reads a non-2xx as "retry", and retrying a delivery this host has
 * deliberately refused is a loop that ends in the provider retiring the event. The body says what
 * happened (`applied`, `duplicate`, `stale`, `unknown_tenant`) and the row in `billing_events`
 * records it either way, which is what an operator reads.
 */
import {
  ApiError,
  applyBillingEvent,
  billingEventDecision,
  isServerMode,
  parseBillingEvent,
  resolveEntitlement,
} from "@agentforge/core";
import { PLAN_CATALOG_CURRENCY, PLAN_TIERS, matchTier } from "@agentforge/core/plans";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import {
  currentPlanRecord,
  findBillingEvent,
  findPlanRecord,
  lastAppliedEventAt,
  recordBillingEvent,
  savePlanRecord,
  seatsInUse,
  tenantExists,
} from "../entitlement-store";
import { TOPUP_URL_ENV, topUpUrl } from "../billing/topup-url";
import { BILLING_TOKEN_HEADER, verifyBillingRequest } from "../billing/authenticate";
import { log } from "../log";
import type { HostJsonResult, HostRequest } from "../types";

/**
 * What the route did with a delivery. Reported to the provider and stored on the event row.
 *
 * `no_change` is the honest answer to a delivery this route read, accepted and then did nothing
 * with, which is what an `entitlement.set` that states no entitlement is. See `outcomeFor`.
 */
export type BillingWebhookOutcome = "applied" | "duplicate" | "stale" | "unknown_tenant" | "no_change";

/**
 * The webhook.
 *
 * Off server mode it does not exist: a desktop has no plan, no provider and no secret, and a route
 * that writes entitlements has no business answering on a machine where entitlements are not
 * enforced. 404, the same answer an unregistered path gets, so a desk leaks nothing about it.
 */
export async function handlePostBillingWebhook(request: HostRequest): Promise<HostJsonResult> {
  try {
    if (!isServerMode()) {
      throw new ApiError("not_found", "Not found", 404);
    }
    const auth = verifyBillingRequest(request.headers[BILLING_TOKEN_HEADER]);
    if (!auth.ok) {
      // 401 rather than 403: the caller may retry with the right secret, and a provider's
      // dashboard shows the operator which of the two it is.
      log.warn("billing_webhook_rejected", { code: auth.code });
      throw new ApiError(auth.code, auth.message, auth.code === "billing_not_configured" ? 503 : 401);
    }
    const now = Date.now();
    const parsed = parseBillingEvent(request.body, now);
    if (!parsed.ok) {
      // The one non-2xx answer to an authenticated caller. An unparseable body is not something a
      // retry fixes, and answering 200 to it would hide a broken adapter behind a green dashboard.
      throw new ApiError(parsed.reason, "This billing event could not be read.", 400);
    }
    const event = parsed.event;

    const seen = findBillingEvent(event.eventId);
    const known = tenantExists(event.tenantId);
    // The ordering test compares this delivery against the newest delivery the webhook has
    // APPLIED for the tenant — never against `tenant_plan.updated_at`.
    //
    // That was the bug this route shipped with: `updated_at` moves on every ledger write and on
    // every persisted period roll, so a tenant that was still generating read as newer than the
    // provider and could never receive a top-up, a seat-cap raise or any `entitlement.set` again.
    // A provider's `occurred_at` always precedes its delivery, so the only question worth asking
    // is "would this undo a newer webhook?", and only another webhook can answer it.
    //
    // The VALUE the event is applied to is still `currentPlanRecord`, which fills in the default
    // and rolls the period, because that is the record the next gateway call will read.
    const decision = billingEventDecision({
      event,
      // A delivery already seen but never applied — an `unknown_tenant` from before this tenant
      // first signed in — is reconsidered rather than dismissed, so a provider that retries it
      // lands the sale instead of getting `duplicate` forever. Re-running an applied event is
      // still refused, which is what idempotency means here.
      alreadySeen: Boolean(seen?.applied),
      lastAppliedOccurredAt: lastAppliedEventAt(event.tenantId),
    });

    let outcome: BillingWebhookOutcome;
    if (!decision.apply) {
      outcome = decision.reason;
    } else if (event.kind === "entitlement.set" && !event.entitlement) {
      // A well-formed delivery that states nothing. `parseBillingEvent` is forgiving on purpose —
      // a 400 to a webhook is a retry storm, and an extra field is the provider's business — so a
      // patch under a key this contract does not know arrives here as an `entitlement.set` with no
      // `entitlement` at all. Applying it would write the record back byte for byte and report
      // `applied`, which is what an adapter that spelled the patch `data` got on every delivery
      // while the tenant's plan never moved: a green provider dashboard and a tenant that cannot
      // go active, with nothing anywhere connecting the two.
      //
      // Still 200 and still recorded, because retrying cannot fix a wrong field name. The answer,
      // the log line and the `billing_events` row now say what happened instead.
      outcome = "no_change";
      log.warn("billing_webhook_stated_nothing", { kind: event.kind, eventId: event.eventId });
    } else if (!known) {
      // The portal can sell to somebody before they first sign in, and the plan row has a foreign
      // key to `tenants`. Recording the event without applying it keeps the route idempotent and
      // tells an operator exactly what is waiting; it is not silently dropped.
      outcome = "unknown_tenant";
    } else {
      savePlanRecord(applyBillingEvent(currentPlanRecord(event.tenantId, now), event, now));
      outcome = "applied";
    }

    recordBillingEvent({
      eventId: event.eventId,
      tenantId: event.tenantId,
      kind: event.kind,
      occurredAt: event.occurredAt,
      receivedAt: now,
      applied: outcome === "applied",
      detail: outcome === "applied" ? null : outcome,
    });
    log.info("billing_webhook_handled", { kind: event.kind, outcome });
    return jsonOk({ received: true, outcome }) as HostJsonResult;
  } catch (error) {
    return jsonError(error) as HostJsonResult;
  }
}

/**
 * The catalog tier this tenant was actually sold, or `null`.
 *
 * Two things answer `null` here and both are right: a tenant with no `tenant_plan` row at all, and
 * a tenant whose stored kind and seat cap match no tier (a hand-set cap, or a row from an older cut
 * of the catalog). Neither is a purchase this repository can name, and the surfaces say "no plan"
 * rather than inventing one.
 *
 * ENFORCEMENT IS NOT AFFECTED. `currentPlanRecord` — default-filled, period-rolled, fail-open — is
 * still what `resolveEntitlement` and every gateway call read. This function is the LABEL, and only
 * the label.
 */
function storedTierId(tenantId: string): string | null {
  const stored = findPlanRecord(tenantId);
  return stored ? matchTier({ kind: stored.kind, seatCap: stored.seatCap }) : null;
}

/**
 * What this tenant is entitled to, for the account screen.
 *
 * Deliberately NOT behind `requireGatewayAllowed()`: a tenant that is blocked has to be able to
 * read why it is blocked and how to fix it, or the block is a dead end (decision doc §3(b)). This
 * route and the top-up below are the two that must answer while the plan refuses everything else.
 */
export async function handleGetBillingPlan(request: HostRequest): Promise<HostJsonResult> {
  try {
    const tenant = await getTenant(request);
    if (!isServerMode()) {
      // A desk has no plan, and saying so is better than inventing one: the renderer branches on
      // `enforced` rather than on the absence of fields.
      return jsonOk({ enforced: false }) as HostJsonResult;
    }
    const now = Date.now();
    const plan = currentPlanRecord(tenant.tenantId, now);
    const entitlement = resolveEntitlement(plan, seatsInUse(tenant.tenantId), now);
    return jsonOk({
      enforced: true,
      kind: entitlement.kind,
      status: entitlement.status,
      currency: entitlement.currency,
      allowanceUsdMicros: entitlement.allowanceUsdMicros,
      spentUsdMicros: entitlement.spentUsdMicros,
      remainingUsdMicros: entitlement.remainingUsdMicros,
      usedFraction: entitlement.usedFraction,
      unpricedCount: entitlement.unpricedCount,
      periodStart: entitlement.periodStart,
      periodEnd: entitlement.periodEnd,
      seatCap: entitlement.seatCap,
      seatsInUse: entitlement.seatsInUse,
      block: entitlement.block,
      warnings: entitlement.warnings,
      // Phase 9: which catalog tier this tenant's STORED plan was cut from, or `null`.
      //
      // Read off the stored row and nothing else. `currentPlanRecord` above fills in
      // `defaultPlanRecord` for a tenant that has no row — personal, `seatCap: null`, `active`,
      // which is precisely the Personal tier — so labelling from it told every tenant nobody had
      // ever sold anything to that they were on a paying Personal plan, and made the pricing page
      // replace the Personal CTA with "This is your plan". The default exists so enforcement fails
      // OPEN; it is not a purchase, and it must never be named like one.
      tierId: storedTierId(tenant.tenantId),
    }) as HostJsonResult;
  } catch (error) {
    return jsonError(error) as HostJsonResult;
  }
}

/**
 * The plan catalog, and which tier this tenant is on (Phase 9).
 *
 * The tiers themselves are a pure module the renderer imports directly (`@agentforge/core/plans`,
 * open decision 9), so this route exists for the one thing an import cannot answer: `current`.
 *
 * Off server mode it answers anyway, with `current: null`. A desk has no plan and no session, and
 * the alternative — a 404 — would mean the pricing page had to branch on the deployment before it
 * could render a price list that is identical either way. It is session-gated on the hosted server
 * like every other `/api` read, and deliberately **not** behind `requireGatewayAllowed()`: a tenant
 * that is blocked is precisely the one that needs to see what it could buy.
 *
 * No token field of any kind: nobody is metered against a token budget (owner, 2026-09-21).
 */
export async function handleGetBillingPlans(request: HostRequest): Promise<HostJsonResult> {
  try {
    if (!isServerMode()) {
      return jsonOk({ currency: PLAN_CATALOG_CURRENCY, tiers: PLAN_TIERS, current: null }) as HostJsonResult;
    }
    const tenant = await getTenant(request);
    return jsonOk({
      currency: PLAN_CATALOG_CURRENCY,
      tiers: PLAN_TIERS,
      // The stored row or nothing — see `storedTierId`. A tenant with no plan is on no tier, and
      // the price list marks none of its cards as theirs.
      current: storedTierId(tenant.tenantId),
    }) as HostJsonResult;
  } catch (error) {
    return jsonError(error) as HostJsonResult;
  }
}

/**
 * The self-serve way out of an exhausted allowance (D3(c)) — as far as this lane can build it.
 *
 * **This is a stub, and it says so in its answer rather than pretending.** A top-up is a purchase,
 * a purchase needs a provider checkout, and the provider is D4, which is kyo's to answer. What
 * lane B can fix is the shape: the host does not raise its own allowance, ever. It hands back
 * where the purchase has to happen, and the allowance rises when the provider's
 * `allowance.topup` event comes back through the webhook above — which is already built, already
 * idempotent, and already tested. So the day a provider is chosen, this route gains a checkout URL
 * and nothing else in the path changes.
 *
 * `AGENTFORGE_BILLING_TOPUP_URL` is the operator's escape hatch in the meantime: point it at a
 * payment link, an invoice form or a support page and the account screen has somewhere to send a
 * blocked tenant today.
 */
export async function handlePostBillingTopUp(request: HostRequest): Promise<HostJsonResult> {
  try {
    const tenant = await getTenant(request);
    if (!isServerMode()) {
      throw new ApiError("not_found", "Not found", 404);
    }
    // Validated at the source rather than echoed. This string becomes an `href` on a page inside
    // the tenant's own session, so a `javascript:` or `data:` value in the deployment's environment
    // would be script execution; the renderer checks it too (`plans-api.ts safeCheckoutUrl`), and
    // neither check is a reason to drop the other. A value that is not an http(s) URL is treated as
    // no link at all, and the operator is told by NAME — the value never reaches a log.
    // Read by its literal name, not through `process.env[TOPUP_URL_ENV]`: `provider-env-sweep`
    // flags every dynamic environment read in the repo, and it is right to — a computed key is
    // exactly how a credential read hides from that sweep.
    const configured = process.env.AGENTFORGE_BILLING_TOPUP_URL;
    const url = topUpUrl(configured);
    if (configured?.trim() && !url) {
      log.warn("billing_topup_url_invalid", { variable: TOPUP_URL_ENV });
    }
    const plan = currentPlanRecord(tenant.tenantId);
    if (!url) {
      return jsonOk({
        available: false,
        reason: "billing_provider_not_configured",
        message:
          "Top-ups are not available on this deployment yet. Contact the operator to raise this account's allowance.",
        currency: plan.currency,
      }) as HostJsonResult;
    }
    return jsonOk({ available: true, checkoutUrl: url, currency: plan.currency }) as HostJsonResult;
  } catch (error) {
    return jsonError(error) as HostJsonResult;
  }
}
