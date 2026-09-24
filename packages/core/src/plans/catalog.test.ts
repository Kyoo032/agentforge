import { describe, expect, it } from "vitest";
import { PLAN_KINDS, defaultPlanRecord, isPlanKind, seatAdmission } from "../entitlement/types";
import { PLAN_CATALOG_CURRENCY, PLAN_TIERS, findTier, formatPlanPrice, matchTier } from "./catalog";
import type { PlanTier } from "./catalog";

/** A tier the catalog does not contain, used to prove the functions are not table-bound. */
const FREE: PlanTier = {
  id: "test-free",
  kind: "personal",
  nameKey: "plans.tier.test.name",
  descriptionKey: "plans.tier.test.description",
  priceMinor: 0,
  currency: PLAN_CATALOG_CURRENCY,
  period: "month",
  seatCap: null,
  featureKeys: [],
  placeholder: true,
};

describe("plan catalog shape", () => {
  it("publishes exactly two tiers, one per plan kind", () => {
    expect(PLAN_TIERS).toHaveLength(2);
    expect(PLAN_TIERS.map((tier) => tier.kind)).toEqual([...PLAN_KINDS]);
  });

  it("gives every tier a unique id that is a stable slug and names its kind", () => {
    const ids = PLAN_TIERS.map((tier) => tier.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tier of PLAN_TIERS) {
      expect(tier.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(isPlanKind(tier.kind)).toBe(true);
      expect(tier.id).toBe(tier.kind);
    }
  });

  it("marks every tier a placeholder, because no owner has set a number yet", () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.placeholder).toBe(true);
    }
  });

  it("meters nothing: no tier carries a token allowance or any allowance field at all", () => {
    for (const tier of PLAN_TIERS) {
      expect(Object.keys(tier)).not.toContain("tokenAllowance");
      expect(Object.keys(tier)).not.toContain("allowanceUsdMicros");
    }
  });

  it("points Personal at the desktop app and Enterprise at the web contact offer", () => {
    const personal = findTier("personal") as PlanTier;
    const enterprise = findTier("enterprise") as PlanTier;
    expect(personal.featureKeys).toEqual(["plans.feature.macWindowsApp", "plans.feature.tokenComplement"]);
    expect(enterprise.featureKeys).toEqual([
      "plans.feature.webProduct",
      "plans.feature.contactDps",
      "plans.feature.knowledgeStorage",
      "plans.feature.agentTraffic",
      "plans.feature.implementationMaintenance",
      "plans.feature.seatsAndTokensSeparate",
    ]);
  });

  it("leaves the seat cap null on Personal, where D2 says it is meaningless", () => {
    const personal = findTier("personal") as PlanTier;
    expect(personal.seatCap).toBeNull();
    // A null cap must admit everybody, or "uncapped" would read as "locked out".
    expect(seatAdmission({ seatCap: personal.seatCap, seatsInUse: 9_999, alreadyHoldsSeat: false })).toEqual({
      ok: true,
      claim: true,
    });
  });

  it("gives Enterprise a positive whole seat cap and the highlighted card", () => {
    const enterprise = findTier("enterprise") as PlanTier;
    expect(Number.isInteger(enterprise.seatCap as number)).toBe(true);
    expect(enterprise.seatCap as number).toBeGreaterThan(0);
    expect(PLAN_TIERS.filter((tier) => tier.highlighted === true)).toEqual([enterprise]);
  });

  it("prices every tier in whole rupiah, ascending, in the catalog currency", () => {
    expect(PLAN_CATALOG_CURRENCY).toBe("IDR");
    for (const tier of PLAN_TIERS) {
      expect(tier.currency).toBe(PLAN_CATALOG_CURRENCY);
      expect(tier.period).toBe("month");
      expect(Number.isInteger(tier.priceMinor)).toBe(true);
      expect(tier.priceMinor).toBeGreaterThan(0);
    }
    const prices = PLAN_TIERS.map((tier) => tier.priceMinor);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("names nothing in English: every user-visible string is an i18n key", () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.nameKey).toBe(`plans.tier.${tier.id}.name`);
      expect(tier.descriptionKey).toBe(`plans.tier.${tier.id}.description`);
      expect(tier.featureKeys.length).toBeGreaterThan(0);
      for (const key of tier.featureKeys) {
        expect(key).toMatch(/^plans\.feature\.[a-zA-Z0-9.]+$/);
      }
    }
    const serialised = JSON.stringify(PLAN_TIERS);
    for (const word of ["Personal", "Enterprise", "month", "seat"]) {
      expect(serialised).not.toContain(` ${word}`);
    }
  });

  it("is frozen all the way down", () => {
    expect(Object.isFrozen(PLAN_TIERS)).toBe(true);
    for (const tier of PLAN_TIERS) {
      expect(Object.isFrozen(tier)).toBe(true);
      expect(Object.isFrozen(tier.featureKeys)).toBe(true);
    }
    expect(() => {
      (PLAN_TIERS as PlanTier[]).push(FREE);
    }).toThrow();
  });
});

describe("findTier", () => {
  it("finds every published tier by id", () => {
    for (const tier of PLAN_TIERS) {
      expect(findTier(tier.id)).toBe(tier);
    }
  });

  it("returns null for an unknown, empty or non-string id", () => {
    expect(findTier("scale")).toBeNull();
    expect(findTier("")).toBeNull();
    expect(findTier("  ")).toBeNull();
    expect(findTier(undefined as unknown as string)).toBeNull();
  });

  it("does not care about surrounding whitespace or case", () => {
    const first = PLAN_TIERS[0] as PlanTier;
    expect(findTier(`  ${first.id.toUpperCase()}  `)).toBe(first);
  });
});

describe("matchTier", () => {
  it("labels a stored plan with the tier it was cut from", () => {
    for (const tier of PLAN_TIERS) {
      expect(matchTier({ kind: tier.kind, seatCap: tier.seatCap })).toBe(tier.id);
    }
  });

  /**
   * The trap this function cannot see, pinned so nobody removes the guard at the call site.
   *
   * `defaultPlanRecord` is what the host hands out for a tenant with NO plan row, because
   * entitlement enforcement fails open — and its two columns are exactly the Personal tier's. So
   * `matchTier` says "personal" here and is not wrong: it was asked about a kind and a seat cap,
   * and those are Personal's. It was simply asked the wrong question. Deciding whether a row exists
   * belongs to the caller, and `packages/host/src/handlers/billing.ts` does it with `findPlanRecord`
   * so that `tierId` and `current` are `null` for a tenant nobody has sold anything to.
   */
  it("cannot tell a sale from the fail-open default, which is why the caller must", () => {
    const record = defaultPlanRecord("tenant-1", Date.UTC(2026, 8, 21));
    expect(matchTier({ kind: record.kind, seatCap: record.seatCap })).toBe("personal");
  });

  it("matches on the kind first: a seat-capped Personal row is no tier the catalog sells", () => {
    expect(matchTier({ kind: "personal", seatCap: 5 })).toBeNull();
  });

  it("returns null when the kind matches but the seat cap does not", () => {
    const enterprise = findTier("enterprise") as PlanTier;
    expect(matchTier({ kind: "enterprise", seatCap: (enterprise.seatCap as number) + 1 })).toBeNull();
    expect(matchTier({ kind: "enterprise", seatCap: null })).toBeNull();
  });

  it("returns null for a kind that is not a plan kind at all", () => {
    expect(matchTier({ kind: "scale" as never, seatCap: null })).toBeNull();
    expect(matchTier({ kind: undefined as never, seatCap: null })).toBeNull();
  });

  it("ignores a broken seat cap rather than rounding it into a match", () => {
    expect(matchTier({ kind: "enterprise", seatCap: Number.NaN })).toBeNull();
    expect(matchTier({ kind: "enterprise", seatCap: -1 })).toBeNull();
  });
});

describe("formatPlanPrice", () => {
  const first = PLAN_TIERS[0] as PlanTier;

  it("formats English with a grouped, decimal-free rupiah amount", () => {
    const text = formatPlanPrice(first, "en");
    expect(text).toContain("IDR");
    expect(text).toContain(first.priceMinor.toLocaleString("en-US"));
    expect(text).not.toMatch(/[.,]\d{2}$/);
  });

  it("formats Indonesian with the Rp symbol and dot grouping", () => {
    const text = formatPlanPrice(first, "id");
    expect(text).toContain("Rp");
    expect(text).toContain(first.priceMinor.toLocaleString("id-ID"));
    expect(text).not.toMatch(/[.,]\d{2}$/);
  });

  it("gives the two locales different strings, so the UI cannot hardcode one", () => {
    expect(formatPlanPrice(first, "en")).not.toBe(formatPlanPrice(first, "id"));
  });

  it("falls back to the default locale rather than throwing on a broken tag", () => {
    expect(formatPlanPrice(first, "not a locale")).toBe(formatPlanPrice(first, "en"));
    expect(formatPlanPrice(first, undefined as unknown as string)).toBe(formatPlanPrice(first, "en"));
  });

  it("formats a zero price without inventing a number", () => {
    expect(formatPlanPrice(FREE, "en")).toContain("0");
  });
});
