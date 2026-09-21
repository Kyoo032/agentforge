/**
 * The provider-neutral billing webhook contract (Phase 5 lane B).
 *
 * D4 — Xendit, Paddle or Stripe — turns on kyo's selling entity, which is not settled and is not a
 * fact this repository can settle (`web-phase5-plans-billing-decisions.md` §2 D4). So lane B
 * defines the *inside* of the route and leaves the provider adapter for the lane that follows: the
 * event shape a provider's payload is translated INTO, the rules that apply it to a plan row, and
 * the idempotency the route needs. Adding Xendit later is then a function from that provider's
 * body to `BillingEvent`, and nothing below changes.
 *
 * Three properties the route must have, whatever the provider (§3(c)):
 *
 * 1. **Authenticated, and not by a session.** No browser is signing in; the caller is a server.
 *    The route is exempt from the session gate and from CSRF, and authenticates on a shared secret
 *    instead — compared in constant time, in `@agentforge/host`'s `billing/authenticate.ts`.
 * 2. **Idempotent on `eventId`.** Xendit retries up to six times; every provider retries. The
 *    webhook is the only writer of `status`, so a replay must be a no-op and not a second write.
 * 3. **Replay-safe in order.** Providers do not promise ordering. An event older than the row it
 *    would write is dropped rather than applied, so a retried "past_due" cannot land on top of the
 *    "active" that already fixed it.
 *
 * Pure: everything here is a function of its arguments. The route, the secret and the table live
 * in the host.
 */
import {
  DEFAULT_QUOTE_CURRENCY,
  PASS_THROUGH_MARGIN_MICROS,
  calendarMonthPeriod,
  isPlanKind,
  isPlanStatus,
  type PlanKind,
  type PlanStatus,
  type TenantPlanRecord,
} from "./types";

/**
 * - `entitlement.set` — the whole statement of what a tenant is entitled to. A subscription
 *   created, upgraded, downgraded, renewed, suspended or cancelled is all this one kind with
 *   different fields, because a provider's own vocabulary is the adapter's problem and not this
 *   route's.
 * - `allowance.topup` — D3(c)'s self-serve top-up: raise this period's allowance by an amount,
 *   without touching the subscription. Under D1(b) this is "raise the gateway token's quota".
 * - `period.reset` — roll the period now. The calendar-month default needs no such event; it is
 *   here because an anniversary period, which kyo may still choose, is exactly this event fired by
 *   the provider on the renewal date.
 */
export const BILLING_EVENT_KINDS = ["entitlement.set", "allowance.topup", "period.reset"] as const;

export type BillingEventKind = (typeof BILLING_EVENT_KINDS)[number];

export function isBillingEventKind(value: unknown): value is BillingEventKind {
  return typeof value === "string" && (BILLING_EVENT_KINDS as readonly string[]).includes(value);
}

/** The fields an `entitlement.set` may state. Anything left out keeps the value the row has. */
export type BillingEntitlementPatch = {
  readonly kind?: PlanKind;
  readonly status?: PlanStatus;
  /** `null` is meaningful: it REMOVES the allowance. Absent leaves it as it is. */
  readonly allowanceUsdMicros?: number | null;
  readonly seatCap?: number | null;
  readonly marginMultipleMicros?: number;
  readonly currency?: string;
  readonly periodStart?: number;
  readonly periodEnd?: number;
};

export type BillingEvent = {
  /** The provider's own id for this delivery. The idempotency key; never generated host-side. */
  readonly eventId: string;
  readonly tenantId: string;
  readonly kind: BillingEventKind;
  /** When the provider says it happened, epoch ms. Decides ordering against the stored row. */
  readonly occurredAt: number;
  readonly entitlement?: BillingEntitlementPatch;
  /** `allowance.topup` only: how much to add to this period's allowance, in USD micros. */
  readonly topUpUsdMicros?: number;
};

export type BillingEventParse =
  | { readonly ok: true; readonly event: BillingEvent }
  | { readonly ok: false; readonly reason: string };

function optionalMicros(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The first of two spellings that is actually PRESENT, which `??` cannot do: `null ?? other`
 * falls through, and `null` is a meaningful value here — it is how a provider says "remove this
 * tenant's allowance". Reaching for `??` between the camelCase and snake_case names silently
 * turned every explicit null into "field absent".
 */
function pick(raw: Record<string, unknown>, camel: string, snake: string): unknown {
  return camel in raw ? raw[camel] : raw[snake];
}

/**
 * Read an inbound body into a `BillingEvent`, or say why it is not one.
 *
 * Deliberately strict about the three fields idempotency and ordering depend on, and forgiving
 * about the rest: a provider that sends an extra field must not 400, because a 400 to a webhook is
 * a retry storm, but an event with no id cannot be deduplicated and must not be applied at all.
 */
export function parseBillingEvent(body: unknown, nowMs: number): BillingEventParse {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "billing_event_not_an_object" };
  }
  const raw = body as Record<string, unknown>;
  const eventId = str(pick(raw, "eventId", "event_id"));
  if (!eventId) {
    return { ok: false, reason: "billing_event_id_missing" };
  }
  const tenantId = str(pick(raw, "tenantId", "tenant_id"));
  if (!tenantId) {
    return { ok: false, reason: "billing_event_tenant_missing" };
  }
  const kind = raw.kind;
  if (!isBillingEventKind(kind)) {
    return { ok: false, reason: "billing_event_kind_unknown" };
  }
  const occurredRaw = pick(raw, "occurredAt", "occurred_at");
  // A provider that sends no timestamp is treated as "now", which orders it after everything
  // already stored — the same thing a same-millisecond delivery does, and the safe direction: a
  // dropped event needs a human, an applied one is what the provider asked for.
  const occurredAt =
    typeof occurredRaw === "number" && Number.isFinite(occurredRaw) ? Math.round(occurredRaw) : nowMs;

  const patchRaw = pick(raw, "entitlement", "plan") as Record<string, unknown> | undefined;
  const entitlement: BillingEntitlementPatch | undefined = patchRaw
    ? {
        ...(isPlanKind(patchRaw.kind) ? { kind: patchRaw.kind } : {}),
        ...(isPlanStatus(patchRaw.status) ? { status: patchRaw.status } : {}),
        ...(optionalMicros(pick(patchRaw, "allowanceUsdMicros", "allowance_usd_micros")) !== undefined
          ? { allowanceUsdMicros: optionalMicros(pick(patchRaw, "allowanceUsdMicros", "allowance_usd_micros")) }
          : {}),
        ...(optionalMicros(pick(patchRaw, "seatCap", "seat_cap")) !== undefined
          ? { seatCap: optionalMicros(pick(patchRaw, "seatCap", "seat_cap")) }
          : {}),
        ...(typeof patchRaw.marginMultipleMicros === "number" && patchRaw.marginMultipleMicros >= 0
          ? { marginMultipleMicros: Math.round(patchRaw.marginMultipleMicros) }
          : {}),
        ...(str(patchRaw.currency) ? { currency: str(patchRaw.currency).toUpperCase() } : {}),
        ...(typeof patchRaw.periodStart === "number" && Number.isFinite(patchRaw.periodStart)
          ? { periodStart: Math.round(patchRaw.periodStart) }
          : {}),
        ...(typeof patchRaw.periodEnd === "number" && Number.isFinite(patchRaw.periodEnd)
          ? { periodEnd: Math.round(patchRaw.periodEnd) }
          : {}),
      }
    : undefined;

  const topUp = optionalMicros(pick(raw, "topUpUsdMicros", "top_up_usd_micros"));
  if (kind === "allowance.topup" && (topUp === undefined || topUp === null || topUp <= 0)) {
    return { ok: false, reason: "billing_event_topup_amount_missing" };
  }
  return {
    ok: true,
    event: {
      eventId,
      tenantId,
      kind,
      occurredAt,
      ...(entitlement && Object.keys(entitlement).length > 0 ? { entitlement } : {}),
      ...(typeof topUp === "number" ? { topUpUsdMicros: topUp } : {}),
    },
  };
}

/**
 * Apply an event to a plan row. Pure: the caller persists what comes back.
 *
 * **The counters are never written from an event.** `spentUsdMicros` and `unpricedCount` belong to
 * the ledger, and a provider has no way to know them; letting a webhook set them would make a
 * replayed delivery able to un-spend a tenant's month. The one thing that resets them is a period
 * roll, which is the clock's job (`rolledPlan`) and `period.reset`'s.
 */
export function applyBillingEvent(record: TenantPlanRecord, event: BillingEvent, nowMs: number): TenantPlanRecord {
  if (event.kind === "period.reset") {
    const period = calendarMonthPeriod(nowMs);
    return { ...record, ...period, spentUsdMicros: 0, unpricedCount: 0, updatedAt: nowMs };
  }
  if (event.kind === "allowance.topup") {
    const added = Math.max(0, Math.round(event.topUpUsdMicros ?? 0));
    // A top-up on a tenant with no allowance is still a top-up: it buys that much for this period,
    // rather than silently doing nothing to an uncapped plan.
    const base = record.allowanceUsdMicros ?? 0;
    return { ...record, allowanceUsdMicros: base + added, updatedAt: nowMs };
  }
  const patch = event.entitlement ?? {};
  return {
    ...record,
    kind: patch.kind ?? record.kind,
    status: patch.status ?? record.status,
    allowanceUsdMicros: patch.allowanceUsdMicros !== undefined ? patch.allowanceUsdMicros : record.allowanceUsdMicros,
    seatCap: patch.seatCap !== undefined ? patch.seatCap : record.seatCap,
    marginMultipleMicros: patch.marginMultipleMicros ?? record.marginMultipleMicros ?? PASS_THROUGH_MARGIN_MICROS,
    currency: patch.currency ?? record.currency ?? DEFAULT_QUOTE_CURRENCY,
    periodStart: patch.periodStart ?? record.periodStart,
    periodEnd: patch.periodEnd ?? record.periodEnd,
    updatedAt: nowMs,
  };
}

/**
 * Should this event be applied at all, given what the webhook has already applied?
 *
 * Two independent refusals, and they mean different things to whoever is reading the log:
 * `duplicate` is the provider retrying a delivery that already landed — expected, healthy, and the
 * reason the route answers 200 to it. `stale` is a delivery that arrived out of order and would
 * undo a newer one.
 *
 * **`lastAppliedOccurredAt` is the provider's timestamp on the newest event this host has applied
 * for the tenant — never the plan row's `updated_at`.** Those are not the same clock and the
 * difference is a bug that bites in production, not a nicety. `tenant_plan.updated_at` moves on
 * every ledger write (`accrueSpend`) and on every persisted period roll, so comparing against it
 * means any tenant that is still generating reads as "newer than the provider", and its top-up,
 * its seat-cap raise and every `entitlement.set` arrive `stale` forever. A provider's
 * `occurred_at` always precedes delivery — network, queueing, a retry an hour later — so the only
 * comparison that answers "would this undo a newer decision?" is one webhook against another.
 */
export function billingEventDecision(args: {
  readonly event: BillingEvent;
  readonly alreadySeen: boolean;
  readonly lastAppliedOccurredAt: number | null;
}): { readonly apply: true } | { readonly apply: false; readonly reason: "duplicate" | "stale" } {
  if (args.alreadySeen) {
    return { apply: false, reason: "duplicate" };
  }
  if (args.lastAppliedOccurredAt !== null && args.event.occurredAt < args.lastAppliedOccurredAt) {
    return { apply: false, reason: "stale" };
  }
  return { apply: true };
}
