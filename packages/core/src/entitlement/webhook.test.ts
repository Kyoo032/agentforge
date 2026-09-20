/**
 * The provider-neutral billing event: what a delivery may say, what it does to a plan row, and
 * when it must be ignored (Phase 5 lane B).
 *
 * The three properties every provider forces on this route — authenticated, idempotent on the
 * event id, safe against out-of-order retries — are the reason these cases exist. The first is the
 * host's (`billing/authenticate.ts`); the other two are decided here and driven end to end in
 * `packages/host/src/handlers/billing.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { applyBillingEvent, billingEventDecision, parseBillingEvent, type BillingEvent } from "./webhook";
import { defaultPlanRecord, type TenantPlanRecord } from "./types";

const NOW = Date.UTC(2026, 2, 14, 9, 30);

function plan(over: Partial<TenantPlanRecord> = {}): TenantPlanRecord {
  return { ...defaultPlanRecord("tenant-a", NOW), ...over };
}

function event(over: Partial<BillingEvent> = {}): BillingEvent {
  return { eventId: "evt-1", tenantId: "tenant-a", kind: "entitlement.set", occurredAt: NOW, ...over };
}

describe("reading a delivery", () => {
  it("accepts the camelCase and the snake_case spelling of every field", () => {
    // Providers differ, and an adapter that has to rename six fields is an adapter with a bug in
    // it. Both spellings are read here so the adapter can pass a body through nearly untouched.
    const parsed = parseBillingEvent(
      {
        event_id: "evt-9",
        tenant_id: "tenant-b",
        kind: "entitlement.set",
        occurred_at: NOW,
        plan: { status: "past_due", allowance_usd_micros: 500, seat_cap: 3 },
      },
      NOW,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event).toMatchObject({ eventId: "evt-9", tenantId: "tenant-b", occurredAt: NOW });
    expect(parsed.event.entitlement).toEqual({ status: "past_due", allowanceUsdMicros: 500, seatCap: 3 });
  });

  it("refuses a delivery with no event id, because it cannot be deduplicated", () => {
    expect(parseBillingEvent({ tenantId: "t", kind: "entitlement.set" }, NOW)).toEqual({
      ok: false,
      reason: "billing_event_id_missing",
    });
  });

  it("refuses a delivery that names no tenant", () => {
    expect(parseBillingEvent({ eventId: "e", kind: "entitlement.set" }, NOW)).toEqual({
      ok: false,
      reason: "billing_event_tenant_missing",
    });
  });

  it("refuses a kind it does not know rather than guessing", () => {
    expect(parseBillingEvent({ eventId: "e", tenantId: "t", kind: "subscription.exploded" }, NOW)).toEqual({
      ok: false,
      reason: "billing_event_kind_unknown",
    });
  });

  it("refuses a top-up with no amount", () => {
    expect(parseBillingEvent({ eventId: "e", tenantId: "t", kind: "allowance.topup" }, NOW)).toEqual({
      ok: false,
      reason: "billing_event_topup_amount_missing",
    });
    expect(parseBillingEvent({ eventId: "e", tenantId: "t", kind: "allowance.topup", topUpUsdMicros: 0 }, NOW).ok).toBe(
      false,
    );
  });

  it("treats a missing timestamp as now, which orders it after everything stored", () => {
    const parsed = parseBillingEvent({ eventId: "e", tenantId: "t", kind: "period.reset" }, NOW);
    expect(parsed.ok && parsed.event.occurredAt).toBe(NOW);
  });

  it("ignores fields it does not understand instead of rejecting the delivery", () => {
    // A 400 to a webhook is a retry storm. An extra field is the provider's business.
    const parsed = parseBillingEvent(
      { eventId: "e", tenantId: "t", kind: "period.reset", providerNoise: { anything: true } },
      NOW,
    );
    expect(parsed.ok).toBe(true);
  });

  it("drops a plan field whose value is the wrong shape rather than writing it", () => {
    const parsed = parseBillingEvent(
      { eventId: "e", tenantId: "t", kind: "entitlement.set", entitlement: { status: "vibes", seatCap: -4 } },
      NOW,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event.entitlement).toBeUndefined();
  });

  it("keeps a null allowance, because removing one is a thing a provider may say", () => {
    const parsed = parseBillingEvent(
      { eventId: "e", tenantId: "t", kind: "entitlement.set", entitlement: { allowanceUsdMicros: null } },
      NOW,
    );
    expect(parsed.ok && parsed.event.entitlement).toEqual({ allowanceUsdMicros: null });
  });

  it("refuses a body that is not an object at all", () => {
    expect(parseBillingEvent("nope", NOW).ok).toBe(false);
    expect(parseBillingEvent(null, NOW).ok).toBe(false);
  });
});

describe("applying a delivery", () => {
  it("sets only the fields the event states", () => {
    const before = plan({ allowanceUsdMicros: 1_000, seatCap: 4, currency: "USD" });
    const after = applyBillingEvent(before, event({ entitlement: { status: "past_due" } }), NOW + 5);
    expect(after).toMatchObject({ status: "past_due", allowanceUsdMicros: 1_000, seatCap: 4 });
  });

  it("never writes the counters, whatever the event says", () => {
    // A provider cannot know what a tenant spent, and letting a replay un-spend a month is the
    // failure this rule exists to prevent. Only a period roll resets them.
    const before = plan({ spentUsdMicros: 700, unpricedCount: 3 });
    const noisy = { ...event(), entitlement: { status: "active" as const }, spentUsdMicros: 0 };
    const after = applyBillingEvent(before, noisy, NOW + 5);
    expect(after).toMatchObject({ spentUsdMicros: 700, unpricedCount: 3 });
  });

  it("unblocks an exhausted tenant by raising the allowance", () => {
    // The plan's own done-when: a blocked tenant recovers when the webhook flips the row.
    const before = plan({ allowanceUsdMicros: 100, spentUsdMicros: 100 });
    const after = applyBillingEvent(before, event({ entitlement: { allowanceUsdMicros: 5_000 } }), NOW + 5);
    expect(after.allowanceUsdMicros).toBe(5_000);
  });

  it("adds a top-up to the allowance and leaves the spend where it is", () => {
    const after = applyBillingEvent(
      plan({ allowanceUsdMicros: 100, spentUsdMicros: 100 }),
      event({ kind: "allowance.topup", topUpUsdMicros: 400 }),
      NOW + 5,
    );
    expect(after).toMatchObject({ allowanceUsdMicros: 500, spentUsdMicros: 100 });
  });

  it("tops up a tenant that had no allowance at all rather than doing nothing", () => {
    const after = applyBillingEvent(
      plan({ allowanceUsdMicros: null }),
      event({ kind: "allowance.topup", topUpUsdMicros: 400 }),
      NOW + 5,
    );
    expect(after.allowanceUsdMicros).toBe(400);
  });

  it("resets the counters and the period on period.reset", () => {
    const after = applyBillingEvent(
      plan({ spentUsdMicros: 900, unpricedCount: 2 }),
      event({ kind: "period.reset" }),
      NOW,
    );
    expect(after).toMatchObject({ spentUsdMicros: 0, unpricedCount: 0, periodStart: Date.UTC(2026, 2, 1) });
  });

  it("lets a provider state its own period, which is what an anniversary plan needs", () => {
    const after = applyBillingEvent(
      plan(),
      event({ entitlement: { periodStart: Date.UTC(2026, 2, 7), periodEnd: Date.UTC(2026, 3, 7) } }),
      NOW,
    );
    expect(after).toMatchObject({ periodStart: Date.UTC(2026, 2, 7), periodEnd: Date.UTC(2026, 3, 7) });
  });
});

describe("whether a delivery should be applied at all", () => {
  it("drops a delivery whose id has already been seen", () => {
    expect(billingEventDecision({ event: event(), alreadySeen: true, lastAppliedOccurredAt: null })).toEqual({
      apply: false,
      reason: "duplicate",
    });
  });

  it("drops a delivery older than the newest webhook already applied", () => {
    // Out-of-order retries are normal. A retried `past_due` must not land on top of the `active`
    // that already fixed it. The bar is the last APPLIED delivery, not the plan row's mtime.
    expect(
      billingEventDecision({ event: event({ occurredAt: NOW - 1 }), alreadySeen: false, lastAppliedOccurredAt: NOW }),
    ).toEqual({ apply: false, reason: "stale" });
  });

  it("applies a delivery that is exactly as old as the last applied one", () => {
    // Same millisecond is not out of order: two writes inside one millisecond are ordinary, and
    // refusing them would drop legitimate deliveries on a fast machine.
    expect(
      billingEventDecision({ event: event({ occurredAt: NOW }), alreadySeen: false, lastAppliedOccurredAt: NOW }).apply,
    ).toBe(true);
  });

  it("applies the first delivery about a tenant the webhook has never touched", () => {
    expect(billingEventDecision({ event: event(), alreadySeen: false, lastAppliedOccurredAt: null }).apply).toBe(true);
  });

  it("calls a replay duplicate even when it is also newer", () => {
    expect(
      billingEventDecision({ event: event({ occurredAt: NOW + 10 }), alreadySeen: true, lastAppliedOccurredAt: NOW }),
    ).toEqual({ apply: false, reason: "duplicate" });
  });
});
