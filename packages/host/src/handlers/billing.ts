/**
 * The billing routes (Phase 5 lane B).
 *
 *   POST /api/v1/billing/webhook   ← a payment provider's server. No session, no CSRF, a secret.
 *   POST /api/v1/billing/top-up    ← the signed-in tenant. D3(c)'s self-serve path out of a block.
 *   GET  /api/v1/billing/plan      ← the signed-in tenant. What it is entitled to, and why blocked.
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
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import {
  currentPlanRecord,
  findBillingEvent,
  findPlanRecord,
  recordBillingEvent,
  savePlanRecord,
  seatsInUse,
  tenantExists,
} from "../entitlement-store";
import { BILLING_TOKEN_HEADER, verifyBillingRequest } from "../billing/authenticate";
import { log } from "../log";
import type { HostJsonResult, HostRequest } from "../types";

/** What the route did with a delivery. Reported to the provider and stored on the event row. */
export type BillingWebhookOutcome = "applied" | "duplicate" | "stale" | "unknown_tenant";

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
    // Two different reads, on purpose.
    //
    // The ORDERING test uses the stored row and only the stored row (`findPlanRecord`), because
    // "older than what is already written" is a question about something that was written. A
    // tenant with no row has nothing to be older than, and the default record's `updatedAt` is
    // just the clock — using it would make the first event about every tenant arrive stale.
    //
    // The VALUE the event is applied to is `currentPlanRecord`, which fills in the default and
    // rolls the period, because that is the record the next gateway call will read.
    const written = known ? findPlanRecord(event.tenantId) : null;
    const decision = billingEventDecision({
      event,
      alreadySeen: Boolean(seen),
      recordUpdatedAt: written?.updatedAt ?? null,
    });

    let outcome: BillingWebhookOutcome;
    if (!decision.apply) {
      outcome = decision.reason;
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
    const url = process.env.AGENTFORGE_BILLING_TOPUP_URL?.trim();
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
