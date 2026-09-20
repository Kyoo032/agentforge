/**
 * The entitlement rules, with no database anywhere near them (Phase 5 lane B).
 *
 * Everything a tenant can be refused for is decided by the functions below, so this is where the
 * "99% passes, 101% is refused" case from the plan's own Tests list actually lives — the host's
 * suite drives the same rules through SQL, and the browser drives them through HTTP, but neither
 * of those can enumerate the boundary the way a pure function can.
 */
import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_BLOCKS,
  PASS_THROUGH_MARGIN_MICROS,
  WARN_AT_FRACTION,
  calendarMonthPeriod,
  defaultPlanRecord,
  entitlementBlock,
  isEntitlementBlock,
  quotedPriceUsdMicros,
  resolveEntitlement,
  rolledPlan,
  seatAdmission,
  type TenantPlanRecord,
} from "./types";

const MARCH = Date.UTC(2026, 2, 14, 9, 30);

function plan(over: Partial<TenantPlanRecord> = {}): TenantPlanRecord {
  return { ...defaultPlanRecord("tenant-a", MARCH), ...over };
}

describe("the billing period", () => {
  it("is the calendar month containing the instant, in UTC", () => {
    expect(calendarMonthPeriod(MARCH)).toEqual({
      periodStart: Date.UTC(2026, 2, 1),
      periodEnd: Date.UTC(2026, 3, 1),
    });
  });

  it("rolls December into January of the next year", () => {
    // `Date.UTC(y, 12, 1)` is January of y+1, so December needs no special case — asserted rather
    // than assumed, because getting this wrong gives one tenant a 13-month period once a year.
    expect(calendarMonthPeriod(Date.UTC(2026, 11, 31, 23, 59, 59))).toEqual({
      periodStart: Date.UTC(2026, 11, 1),
      periodEnd: Date.UTC(2027, 0, 1),
    });
  });

  it("puts the last millisecond of a month inside it and the first of the next outside", () => {
    const end = Date.UTC(2026, 3, 1);
    expect(calendarMonthPeriod(end - 1).periodEnd).toBe(end);
    expect(calendarMonthPeriod(end).periodStart).toBe(end);
  });
});

describe("rolling a period", () => {
  it("leaves a record alone while the clock is still inside it", () => {
    const record = plan({ spentUsdMicros: 500 });
    expect(rolledPlan(record, MARCH)).toBe(record);
  });

  it("resets both counters and nothing else when the clock has left it", () => {
    const record = plan({
      spentUsdMicros: 9_000,
      unpricedCount: 4,
      allowanceUsdMicros: 10_000,
      seatCap: 5,
      status: "past_due",
    });
    const rolled = rolledPlan(record, Date.UTC(2026, 3, 2));

    expect(rolled.spentUsdMicros).toBe(0);
    expect(rolled.unpricedCount).toBe(0);
    expect(rolled).toMatchObject({ periodStart: Date.UTC(2026, 3, 1), periodEnd: Date.UTC(2026, 4, 1) });
    // The subscription is not the month: a rolled period does not pay an overdue invoice, and it
    // does not give anybody a bigger allowance or an extra seat.
    expect(rolled).toMatchObject({ allowanceUsdMicros: 10_000, seatCap: 5, status: "past_due" });
  });

  it("is idempotent once the period matches", () => {
    const once = rolledPlan(plan({ spentUsdMicros: 9_000 }), Date.UTC(2026, 3, 2));
    expect(rolledPlan(once, Date.UTC(2026, 3, 3))).toBe(once);
  });
});

describe("the block rule", () => {
  it("passes a tenant at 99% of its allowance and refuses it at 101%", () => {
    // The plan's own Tests list, to the micro.
    expect(entitlementBlock(plan({ allowanceUsdMicros: 100_000, spentUsdMicros: 99_000 }))).toBeNull();
    expect(entitlementBlock(plan({ allowanceUsdMicros: 100_000, spentUsdMicros: 101_000 }))).toBe(
      "plan_allowance_exhausted",
    );
  });

  it("blocks at exactly the allowance, not one micro past it", () => {
    // "Hard block at 100%" has to mean at, or the last call of every period is free.
    expect(entitlementBlock(plan({ allowanceUsdMicros: 100_000, spentUsdMicros: 99_999 }))).toBeNull();
    expect(entitlementBlock(plan({ allowanceUsdMicros: 100_000, spentUsdMicros: 100_000 }))).toBe(
      "plan_allowance_exhausted",
    );
  });

  it("never blocks a tenant whose allowance is null, however much it has spent", () => {
    expect(entitlementBlock(plan({ allowanceUsdMicros: null, spentUsdMicros: 10_000_000 }))).toBeNull();
  });

  it("names the payment before the allowance, because paying is what unblocks it", () => {
    const both = plan({ status: "past_due", allowanceUsdMicros: 10, spentUsdMicros: 999 });
    expect(entitlementBlock(both)).toBe("plan_past_due");
  });

  it("names a cancelled plan before an overdue one", () => {
    expect(entitlementBlock(plan({ status: "cancelled" }))).toBe("plan_cancelled");
  });

  it("has a block value for every code the renderer has to branch on", () => {
    for (const code of ENTITLEMENT_BLOCKS) {
      expect(isEntitlementBlock(code)).toBe(true);
      // Never `gateway_blocked`: that code routes a hosted tenant to the paste-your-key screen,
      // which is a dead end for somebody who holds no key (decision doc §3(b)).
      expect(code.startsWith("plan_")).toBe(true);
    }
    expect(isEntitlementBlock("gateway_blocked")).toBe(false);
  });
});

describe("resolving an entitlement", () => {
  it("warns at 80% and still allows the call", () => {
    const resolved = resolveEntitlement(plan({ allowanceUsdMicros: 100_000, spentUsdMicros: 80_000 }), 0, MARCH);
    expect(resolved.block).toBeNull();
    expect(resolved.warnings).toContain("allowance_low");
    expect(resolved.usedFraction).toBeCloseTo(WARN_AT_FRACTION);
  });

  it("says nothing at 79%", () => {
    const resolved = resolveEntitlement(plan({ allowanceUsdMicros: 100_000, spentUsdMicros: 79_000 }), 0, MARCH);
    expect(resolved.warnings).toEqual([]);
  });

  it("drops the allowance warning once the call is actually blocked", () => {
    // A blocked tenant does not need to be told it is nearly out; the account screen has to
    // explain one thing, not two.
    const resolved = resolveEntitlement(plan({ allowanceUsdMicros: 100, spentUsdMicros: 100 }), 0, MARCH);
    expect(resolved.block).toBe("plan_allowance_exhausted");
    expect(resolved.warnings).not.toContain("allowance_low");
  });

  it("surfaces unpriced calls as a warning and counts them as zero spend", () => {
    const resolved = resolveEntitlement(
      plan({ allowanceUsdMicros: 100_000, spentUsdMicros: 10, unpricedCount: 7 }),
      0,
      MARCH,
    );
    // The answer lane A left open: an unpriced row must not block, and must not vanish either.
    expect(resolved.block).toBeNull();
    expect(resolved.warnings).toContain("unpriced_usage");
    expect(resolved.unpricedCount).toBe(7);
    expect(resolved.remainingUsdMicros).toBe(99_990);
  });

  it("rolls the period as part of resolving, so a blocked tenant recovers when the month turns", () => {
    const exhausted = plan({ allowanceUsdMicros: 100, spentUsdMicros: 100 });
    expect(resolveEntitlement(exhausted, 0, MARCH).block).toBe("plan_allowance_exhausted");
    expect(resolveEntitlement(exhausted, 0, Date.UTC(2026, 3, 1)).block).toBeNull();
  });

  it("reports no allowance as an uncapped remainder rather than zero", () => {
    const resolved = resolveEntitlement(plan({ allowanceUsdMicros: null, spentUsdMicros: 5 }), 0, MARCH);
    expect(resolved.remainingUsdMicros).toBeNull();
    expect(resolved.usedFraction).toBe(0);
  });

  it("floors the remainder at zero rather than reporting a negative one", () => {
    // Enforced before the call, measured after it: one expensive run can overshoot the allowance,
    // which is the plan's own stated risk. It must read as "nothing left", never as minus money.
    const resolved = resolveEntitlement(plan({ allowanceUsdMicros: 100, spentUsdMicros: 250 }), 0, MARCH);
    expect(resolved.remainingUsdMicros).toBe(0);
    expect(resolved.usedFraction).toBeCloseTo(2.5);
  });
});

describe("seat admission", () => {
  it("admits somebody who already holds a seat, and claims nothing", () => {
    expect(seatAdmission({ seatCap: 2, seatsInUse: 5, alreadyHoldsSeat: true })).toEqual({ ok: true, claim: false });
  });

  it("refuses a new person once the seats are full", () => {
    expect(seatAdmission({ seatCap: 3, seatsInUse: 3, alreadyHoldsSeat: false })).toEqual({
      ok: false,
      reason: "seat_cap_reached",
    });
  });

  it("admits a new person while a seat is free", () => {
    expect(seatAdmission({ seatCap: 3, seatsInUse: 2, alreadyHoldsSeat: false })).toEqual({ ok: true, claim: true });
  });

  it("admits everybody when no cap is configured", () => {
    // Every Personal tenant, the desktop, and any tenant the billing webhook has not spoken about.
    // A refusal is never invented by the absence of a number.
    expect(seatAdmission({ seatCap: null, seatsInUse: 9_999, alreadyHoldsSeat: false })).toEqual({
      ok: true,
      claim: true,
    });
  });

  it("does not lock out the people already inside when a cap is lowered under them", () => {
    // A downgrade must not sign the whole company out; the cap stops the NEXT person.
    expect(seatAdmission({ seatCap: 1, seatsInUse: 4, alreadyHoldsSeat: true }).ok).toBe(true);
    expect(seatAdmission({ seatCap: 1, seatsInUse: 4, alreadyHoldsSeat: false }).ok).toBe(false);
  });

  it("refuses at a cap of zero", () => {
    expect(seatAdmission({ seatCap: 0, seatsInUse: 0, alreadyHoldsSeat: false }).ok).toBe(false);
  });
});

describe("the margin multiple", () => {
  it("is the identity at pass-through, which is the default", () => {
    expect(quotedPriceUsdMicros(1_234_567, PASS_THROUGH_MARGIN_MICROS)).toBe(1_234_567);
    expect(defaultPlanRecord("t", MARCH).marginMultipleMicros).toBe(PASS_THROUGH_MARGIN_MICROS);
  });

  it("multiplies a gateway cost into a quoted price", () => {
    expect(quotedPriceUsdMicros(2_000_000, 2_500_000)).toBe(5_000_000);
  });

  it("returns an integer, because a price in floating point bills the wrong number", () => {
    expect(Number.isInteger(quotedPriceUsdMicros(333, 1_500_000))).toBe(true);
  });

  it("takes no part in the block decision", () => {
    // Asserted, not assumed: multiplying the counter by a margin would put a rounding error
    // between the ledger and `spent_usd_micros` for no gain, so the block math must not see it.
    const cheap = plan({ allowanceUsdMicros: 100, spentUsdMicros: 99, marginMultipleMicros: 1_000_000 });
    const dear = plan({ allowanceUsdMicros: 100, spentUsdMicros: 99, marginMultipleMicros: 50_000_000 });
    expect(entitlementBlock(cheap)).toBe(entitlementBlock(dear));
  });
});

describe("a tenant with no plan row", () => {
  it("is active, uncapped and unmetered", () => {
    const record = defaultPlanRecord("tenant-new", MARCH);
    expect(record).toMatchObject({
      status: "active",
      allowanceUsdMicros: null,
      seatCap: null,
      spentUsdMicros: 0,
      currency: "USD",
    });
    expect(entitlementBlock(record)).toBeNull();
  });

  it("starts in the calendar month it was first read in", () => {
    expect(defaultPlanRecord("tenant-new", MARCH)).toMatchObject(calendarMonthPeriod(MARCH));
  });
});
