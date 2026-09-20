/**
 * The vocabulary of a tenant's entitlement: what plan it is on, what it may spend, how many seats
 * it may fill, and — derived from those — whether the next gateway call is allowed.
 *
 * Phase 5 lane B (`docs/internal/web-phase5-lane-b.md`), spec
 * `docs/internal/web-phase5-plans-billing-decisions.md` §2 D2/D3/D5 and §3.
 *
 * Nothing here touches the network, a database or a clock of its own: every function takes the
 * time it needs as an argument. It is the shared type vocabulary plus the pure arithmetic, and the
 * store lives in `@agentforge/host`'s `entitlement-store.ts`. That split is the same one lane A
 * made for metering, and it is what lets every rule below be unit-tested with no database at all.
 *
 * **Two numbers that are not the same number, and never become one.**
 * - `spentUsdMicros` and `allowanceUsdMicros` are USD of **gateway cost**, the same unit the
 *   ledger records (`usage/metering.ts`). The allowance is compared against the ledger, so it has
 *   to be in the ledger's unit; D2 says so explicitly.
 * - `marginMultipleMicros` is what a subscription **charges** for that gateway cost. It is a
 *   billing-provider number, it is carried per tenant so kyo can change it without a migration,
 *   and it deliberately takes no part in the block decision — multiplying the counter by a margin
 *   would put a rounding error between the ledger and the counter for no gain.
 */

/** Personal buys an allowance; Enterprise buys seats. Both may carry both columns. */
export const PLAN_KINDS = ["personal", "enterprise"] as const;

export type PlanKind = (typeof PLAN_KINDS)[number];

export function isPlanKind(value: unknown): value is PlanKind {
  return typeof value === "string" && (PLAN_KINDS as readonly string[]).includes(value);
}

/**
 * The plan's standing, written **only** by the billing webhook (the plan doc's rule, kept).
 * `active` is the only one that admits a gateway call; the other two are refusals a payment fixes.
 */
export const PLAN_STATUSES = ["active", "past_due", "cancelled"] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

export function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === "string" && (PLAN_STATUSES as readonly string[]).includes(value);
}

/**
 * Why a call was refused on the plan rather than on the key.
 *
 * These are deliberately NOT `gateway_blocked` (decision doc §3(b), non-negotiable). A hosted
 * tenant over its allowance holds no gateway key, and `gateway_blocked` routes the renderer to the
 * paste-your-key onboarding screen, whose only exits are a key, a re-check or deleting a file on
 * the server's disk — none of which a Personal user has. A `plan_*` code is a flat 403 in the same
 * shape, so `jsonError` and the renderer's parser keep working, and the renderer can branch to the
 * account screen instead.
 */
export const ENTITLEMENT_BLOCKS = ["plan_past_due", "plan_cancelled", "plan_allowance_exhausted"] as const;

export type EntitlementBlock = (typeof ENTITLEMENT_BLOCKS)[number];

export function isEntitlementBlock(value: unknown): value is EntitlementBlock {
  return typeof value === "string" && (ENTITLEMENT_BLOCKS as readonly string[]).includes(value);
}

/**
 * Not a refusal: something the account screen should say out loud while the call goes through.
 *
 * - `allowance_low` — at or past `WARN_AT_FRACTION` of the allowance (D3's 80%).
 * - `unpriced_usage` — this period holds calls nobody could price. They count as **zero** against
 *   the allowance (kyo's open question, answered by the coordinator default in the lane doc), so
 *   the only honest thing to do is say how many there are rather than block on them or hide them.
 */
export const ENTITLEMENT_WARNINGS = ["allowance_low", "unpriced_usage"] as const;

export type EntitlementWarning = (typeof ENTITLEMENT_WARNINGS)[number];

export function isEntitlementWarning(value: unknown): value is EntitlementWarning {
  return typeof value === "string" && (ENTITLEMENT_WARNINGS as readonly string[]).includes(value);
}

/** D3: warn here, block at 1. One constant, so the renderer and the host cannot disagree. */
export const WARN_AT_FRACTION = 0.8;

/** A margin multiple of exactly 1.0 in micros — pass-through, the default until kyo sets one. */
export const PASS_THROUGH_MARGIN_MICROS = 1_000_000;

/** The quote currency, which follows the billing provider (D4) and defaults to the ledger's USD. */
export const DEFAULT_QUOTE_CURRENCY = "USD";

/**
 * The stored half of an entitlement: one row per tenant, exactly what `tenant_plan` holds.
 *
 * Every field here is a fact somebody wrote. Nothing derived lives in this type, and nothing
 * derived is stored — a persisted `blocked` column would be a second source of truth that goes
 * stale the moment a row is written by anything but the code that maintains it.
 */
export type TenantPlanRecord = {
  readonly tenantId: string;
  readonly kind: PlanKind;
  readonly status: PlanStatus;
  /** `null` means no allowance is enforced for this tenant — spend is recorded and never refused. */
  readonly allowanceUsdMicros: number | null;
  /** Gateway cost accrued **this period**, maintained on every ledger write. Never a float. */
  readonly spentUsdMicros: number;
  /** Ledger rows this period that carried no cost. Surfaced as a warning, counted as zero. */
  readonly unpricedCount: number;
  /** Epoch ms, inclusive. */
  readonly periodStart: number;
  /** Epoch ms, exclusive: `periodStart <= at < periodEnd`. */
  readonly periodEnd: number;
  /** `null` on Personal, where a seat cap is meaningless (D2). */
  readonly seatCap: number | null;
  /** What the subscription charges per unit of gateway cost, in micros. 1_000_000 is 1.0. */
  readonly marginMultipleMicros: number;
  /** ISO 4217, for display and invoicing only. The columns above are always USD. */
  readonly currency: string;
  readonly updatedAt: number;
};

/**
 * The resolved entitlement a request carries: the stored record, the live seat count, and the
 * verdict derived from both. This is the value `TenantContext` gains a reference to, resolved once
 * per request rather than at each of the 34 gateway call sites (decision doc §3(a)).
 */
export type TenantEntitlement = TenantPlanRecord & {
  /** Seats held right now — claimed and not revoked. `0` where nobody has signed in yet. */
  readonly seatsInUse: number;
  /** The refusal, or `null` when the next gateway call is allowed. */
  readonly block: EntitlementBlock | null;
  /** Everything worth saying that is not a refusal. Empty when there is nothing to say. */
  readonly warnings: readonly EntitlementWarning[];
  /** `spent / allowance`, clamped at 0 and uncapped above 1. `0` when no allowance is enforced. */
  readonly usedFraction: number;
  /** `allowance - spent`, floored at 0. `null` when no allowance is enforced. */
  readonly remainingUsdMicros: number | null;
};

function nonNegativeInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

/**
 * The calendar month containing `nowMs`, in **UTC**.
 *
 * The coordinator's default for D2's open "calendar month or subscription anniversary": a calendar
 * month needs no per-tenant anniversary date to be correct, and a period roll is then a pure
 * function of the clock rather than a cron job that can fail to fire. An anniversary period is the
 * same two columns with a different function writing them, which is why this is a default kyo can
 * overrule without a migration.
 *
 * UTC, not the server's zone: a Jakarta box and a London box must agree about which month a call
 * landed in, and the ledger's `at` is already epoch milliseconds.
 */
export function calendarMonthPeriod(nowMs: number): { periodStart: number; periodEnd: number } {
  const now = new Date(Number.isFinite(nowMs) ? nowMs : 0);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    periodStart: Date.UTC(year, month, 1),
    // Month 12 rolls to January of the next year in `Date.UTC`, so December needs no special case.
    periodEnd: Date.UTC(year, month + 1, 1),
  };
}

/**
 * The plan record as it stands at `nowMs`, with the period rolled if the clock has left it.
 *
 * The roll resets the two counters and nothing else: the allowance, the seat cap, the margin and
 * the status all belong to the subscription, not to the month. Pure — the caller persists the
 * result, so a read path can roll a record in memory and answer correctly even if the write that
 * makes it durable loses a race.
 */
export function rolledPlan(record: TenantPlanRecord, nowMs: number): TenantPlanRecord {
  if (nowMs < record.periodEnd) {
    return record;
  }
  const period = calendarMonthPeriod(nowMs);
  return { ...record, ...period, spentUsdMicros: 0, unpricedCount: 0, updatedAt: nowMs };
}

/**
 * The whole block rule, in one place.
 *
 * Order matters and is the order a support ticket wants to hear: a cancelled plan is a different
 * conversation from a card that bounced, which is a different conversation from "you used it all".
 * A tenant that is both past due and over its allowance is told about the payment, because paying
 * is what unblocks it.
 */
export function entitlementBlock(record: TenantPlanRecord): EntitlementBlock | null {
  if (record.status === "cancelled") {
    return "plan_cancelled";
  }
  if (record.status === "past_due") {
    return "plan_past_due";
  }
  if (record.allowanceUsdMicros !== null && record.spentUsdMicros >= record.allowanceUsdMicros) {
    return "plan_allowance_exhausted";
  }
  return null;
}

/**
 * Resolve a stored record plus a live seat count into the entitlement a request carries.
 *
 * `nowMs` is taken rather than read so a caller can resolve "as of" any instant — which is what
 * makes the period-roll cases testable without moving the system clock.
 */
export function resolveEntitlement(
  record: TenantPlanRecord,
  seatsInUse: number,
  nowMs: number,
): TenantEntitlement {
  const rolled = rolledPlan(record, nowMs);
  const allowance = rolled.allowanceUsdMicros;
  const spent = nonNegativeInt(rolled.spentUsdMicros);
  const block = entitlementBlock(rolled);
  const warnings: EntitlementWarning[] = [];
  const usedFraction = allowance !== null && allowance > 0 ? spent / allowance : 0;
  // A warning beside a block would be noise: the account screen already has to explain the block.
  if (!block && allowance !== null && allowance > 0 && usedFraction >= WARN_AT_FRACTION) {
    warnings.push("allowance_low");
  }
  if (rolled.unpricedCount > 0) {
    warnings.push("unpriced_usage");
  }
  return {
    ...rolled,
    seatsInUse: nonNegativeInt(seatsInUse),
    block,
    warnings,
    usedFraction,
    remainingUsdMicros: allowance === null ? null : Math.max(0, allowance - spent),
  };
}

/**
 * Whether this sign-in may take a seat.
 *
 * D5(b), which kyo's coordinator default confirms: a seat is **held until an admin revokes it**,
 * never freed by going idle, and the portal stays the seat authority. So the question the host
 * answers is narrow — is this person already holding one of this tenant's seats, and if not, is
 * there a free one. Someone who already holds a seat is admitted whatever the cap says: lowering a
 * cap must not lock out the people already inside it, or a downgrade signs out the whole company.
 *
 * `seatCap === null` is "no cap configured", which admits everybody. That is the desktop, every
 * Personal tenant, and any tenant the webhook has not spoken about yet — never a refusal invented
 * by the absence of a number.
 */
export function seatAdmission(
  args: { seatCap: number | null; seatsInUse: number; alreadyHoldsSeat: boolean },
): { readonly ok: true; readonly claim: boolean } | { readonly ok: false; readonly reason: "seat_cap_reached" } {
  if (args.alreadyHoldsSeat) {
    return { ok: true, claim: false };
  }
  if (args.seatCap === null) {
    return { ok: true, claim: true };
  }
  if (nonNegativeInt(args.seatsInUse) >= nonNegativeInt(args.seatCap)) {
    return { ok: false, reason: "seat_cap_reached" };
  }
  return { ok: true, claim: true };
}

/**
 * What a given gateway cost is quoted to the customer at, in micros of the plan's currency.
 *
 * Nothing in the enforcement path calls this — it exists so the margin multiple is a number the
 * product can actually use, and so the later billing adapter has one function to price against
 * rather than inventing its own. `1_000_000` (pass-through) makes it the identity.
 */
export function quotedPriceUsdMicros(gatewayCostUsdMicros: number, marginMultipleMicros: number): number {
  const cost = nonNegativeInt(gatewayCostUsdMicros);
  const margin = nonNegativeInt(marginMultipleMicros, PASS_THROUGH_MARGIN_MICROS);
  return Math.round((cost * margin) / PASS_THROUGH_MARGIN_MICROS);
}

/**
 * The plan a tenant has before anybody has sold it anything: active, uncapped, unmetered.
 *
 * "No plan row" must behave exactly as the product behaved before Phase 5 existed — that is lane
 * B's own done-when, and it is what keeps the desktop and webdev untouched. A default that blocked
 * would turn "the webhook has not fired yet" into an outage for every tenant at once.
 */
export function defaultPlanRecord(tenantId: string, nowMs: number): TenantPlanRecord {
  return {
    tenantId,
    kind: "personal",
    status: "active",
    allowanceUsdMicros: null,
    spentUsdMicros: 0,
    unpricedCount: 0,
    ...calendarMonthPeriod(nowMs),
    seatCap: null,
    marginMultipleMicros: PASS_THROUGH_MARGIN_MICROS,
    currency: DEFAULT_QUOTE_CURRENCY,
    updatedAt: nowMs,
  };
}
