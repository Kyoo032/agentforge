/**
 * The three reads the plan surfaces make, and the one thing they are not allowed to do: fail loudly.
 *
 * The pricing page renders from the imported catalog and asks the host for exactly one fact —
 * which tier this tenant is on. That request can 404 (a host older than lane F, which is the case
 * on :3000 right now), 401 (a signed-out visitor), or never answer at all, and in every one of
 * those cases the page still has two tiers and two prices to show. So these readers answer `null`
 * on a failure rather than throwing.
 *
 * What they must NOT do is swallow a programmer error: the `catch` is on the network call and on
 * `res.json()` only, and the parsing below is pure and total, so a `TypeError` in this file surfaces
 * as a rejected promise instead of being reported as "the host said nothing".
 *
 * `safeCheckoutUrl` is the other half. `AGENTFORGE_BILLING_TOPUP_URL` is an operator's string that
 * the host hands back verbatim (`packages/host/src/handlers/billing.ts:224-235`), and it becomes an
 * `href` on a page. A `javascript:` URL in that variable would be script execution in the tenant's
 * session, so the scheme is checked here rather than trusted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentTierFrom,
  fetchAccountPlan,
  fetchCheckoutOffer,
  fetchCurrentTier,
  formatPeriodEnd,
  parseAccountPlan,
  parseCheckoutOffer,
  safeCheckoutUrl,
} from "./plans-api";

vi.mock("@/lib/api-client", () => ({
  apiFetch: (path: string, init?: { method?: string }) => fetched(path, init),
}));

type Answer = { status?: number; body?: unknown; throws?: boolean; badJson?: boolean };

let calls: Array<{ path: string; method: string }> = [];
let answer: (path: string) => Answer = () => ({ body: {} });

async function fetched(path: string, init?: { method?: string }): Promise<Response> {
  calls.push({ path, method: init?.method ?? "GET" });
  const reply = answer(path);
  if (reply.throws) {
    throw new Error("offline");
  }
  const status = reply.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (reply.badJson) {
        throw new SyntaxError("Unexpected token <");
      }
      return reply.body;
    },
  } as Response;
}

beforeEach(() => {
  calls = [];
  answer = () => ({ body: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("currentTierFrom", () => {
  it("reads the tier id the host says this tenant is on", () => {
    expect(currentTierFrom({ currency: "IDR", tiers: [], current: "enterprise" })).toBe("enterprise");
  });

  it("reads through the desktop IPC envelope, which nests the body", () => {
    expect(currentTierFrom({ body: { current: "personal" } })).toBe("personal");
  });

  it("answers null for a tenant on no catalog tier, and for anything unreadable", () => {
    expect(currentTierFrom({ current: null })).toBeNull();
    expect(currentTierFrom({ current: 7 })).toBeNull();
    expect(currentTierFrom({ current: "  " })).toBeNull();
    expect(currentTierFrom({})).toBeNull();
    expect(currentTierFrom(null)).toBeNull();
    expect(currentTierFrom("enterprise")).toBeNull();
  });
});

describe("fetchCurrentTier", () => {
  it("asks the catalog route and returns the tier", async () => {
    answer = () => ({ body: { current: "enterprise" } });
    expect(await fetchCurrentTier()).toBe("enterprise");
    expect(calls).toEqual([{ path: "/api/v1/billing/plans", method: "GET" }]);
  });

  it("answers null on the 404 a host older than lane F gives, without reading the body", async () => {
    answer = () => ({ status: 404, body: { error: { code: "not_found" } } });
    expect(await fetchCurrentTier()).toBeNull();
  });

  it("answers null when the request never lands, and when the body is not JSON", async () => {
    answer = () => ({ throws: true });
    expect(await fetchCurrentTier()).toBeNull();
    answer = () => ({ badJson: true });
    expect(await fetchCurrentTier()).toBeNull();
  });
});

describe("parseAccountPlan", () => {
  const hosted = {
    enforced: true,
    kind: "enterprise",
    status: "past_due",
    seatCap: 20,
    seatsInUse: 3,
    periodEnd: 1_788_000_000_000,
    block: "plan_past_due",
    warnings: ["unpriced_usage"],
    tierId: "enterprise",
    // Deliberately present and deliberately ignored: no allowance or spend number reaches a screen.
    allowanceUsdMicros: 5_000_000,
    spentUsdMicros: 4_900_000,
    usedFraction: 0.98,
  };

  it("reads the hosted answer", () => {
    expect(parseAccountPlan(hosted)).toEqual({
      enforced: true,
      tierId: "enterprise",
      kind: "enterprise",
      status: "past_due",
      seatCap: 20,
      seatsInUse: 3,
      periodEnd: 1_788_000_000_000,
      block: "plan_past_due",
      warnings: ["unpriced_usage"],
    });
  });

  it("carries no allowance, spend or fraction at all", () => {
    // The owner's ruling of 2026-09-21: nobody is metered against a budget, so no number that
    // looks like one may reach a plan surface, whatever the host happens to send.
    const parsed = parseAccountPlan(hosted) as Record<string, unknown>;
    for (const field of ["allowanceUsdMicros", "spentUsdMicros", "usedFraction", "remainingUsdMicros"]) {
      expect(Object.keys(parsed), field).not.toContain(field);
    }
  });

  it("reads the desk answer, where nothing is enforced", () => {
    expect(parseAccountPlan({ enforced: false })).toEqual({
      enforced: false,
      tierId: null,
      kind: null,
      status: null,
      seatCap: null,
      seatsInUse: 0,
      periodEnd: null,
      block: null,
      warnings: [],
    });
  });

  it("drops a status, block or warning the host has no business sending", () => {
    const parsed = parseAccountPlan({
      enforced: true,
      status: "trialling",
      block: "gateway_blocked",
      warnings: ["allowance_low", "made_up", 7],
    });
    expect(parsed?.status).toBeNull();
    expect(parsed?.block).toBeNull();
    expect(parsed?.warnings).toEqual(["allowance_low"]);
  });

  it("answers null for a body that is not a plan answer", () => {
    for (const body of [null, "enforced", 7, [], {}, { error: { code: "not_found" } }]) {
      expect(parseAccountPlan(body), String(body)).toBeNull();
    }
  });

  it("reads through the desktop IPC envelope", () => {
    expect(parseAccountPlan({ body: { enforced: false } })?.enforced).toBe(false);
  });
});

describe("fetchAccountPlan", () => {
  it("reads the plan route", async () => {
    answer = () => ({ body: { enforced: true, kind: "personal", status: "active", seatCap: null, seatsInUse: 1 } });
    const plan = await fetchAccountPlan();
    expect(calls).toEqual([{ path: "/api/v1/billing/plan", method: "GET" }]);
    expect(plan?.status).toBe("active");
    expect(plan?.seatCap).toBeNull();
  });

  it("answers null when the route refuses or never lands", async () => {
    answer = () => ({ status: 401, body: { error: { code: "unauthenticated" } } });
    expect(await fetchAccountPlan()).toBeNull();
    answer = () => ({ throws: true });
    expect(await fetchAccountPlan()).toBeNull();
  });
});

describe("safeCheckoutUrl", () => {
  it("passes an ordinary payment link through unchanged", () => {
    expect(safeCheckoutUrl("https://pay.example.com/checkout?plan=personal")).toBe(
      "https://pay.example.com/checkout?plan=personal",
    );
    expect(safeCheckoutUrl(" http://127.0.0.1:4000/pay ")).toBe("http://127.0.0.1:4000/pay");
  });

  it("refuses a scheme that would run script in the tenant's session", () => {
    for (const url of [
      "javascript:alert(document.cookie)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "/relative/path",
      "",
      "   ",
      null,
      42,
    ]) {
      expect(safeCheckoutUrl(url), String(url)).toBeNull();
    }
  });
});

describe("parseCheckoutOffer", () => {
  it("is available only when the host says so and hands back a usable link", () => {
    expect(parseCheckoutOffer({ available: true, checkoutUrl: "https://pay.example.com/x" })).toEqual({
      available: true,
      checkoutUrl: "https://pay.example.com/x",
    });
  });

  it("is unavailable when the host says it is not configured", () => {
    expect(parseCheckoutOffer({ available: false, reason: "billing_provider_not_configured" })).toEqual({
      available: false,
      checkoutUrl: null,
    });
  });

  it("is unavailable when the host claims availability with no usable link", () => {
    // Never a dead button: an `available: true` with a `javascript:` URL or no URL at all has to
    // land on the contact-us state, not on something that looks like a checkout and does nothing.
    expect(parseCheckoutOffer({ available: true })).toEqual({ available: false, checkoutUrl: null });
    expect(parseCheckoutOffer({ available: true, checkoutUrl: "javascript:alert(1)" })).toEqual({
      available: false,
      checkoutUrl: null,
    });
  });

  it("is unavailable for anything unreadable", () => {
    for (const body of [null, 7, "yes", {}, { error: { code: "not_found" } }]) {
      expect(parseCheckoutOffer(body), String(body)).toEqual({ available: false, checkoutUrl: null });
    }
  });
});

describe("fetchCheckoutOffer", () => {
  it("asks the top-up route with a POST", async () => {
    answer = () => ({ body: { available: true, checkoutUrl: "https://pay.example.com/x" } });
    expect(await fetchCheckoutOffer()).toEqual({ available: true, checkoutUrl: "https://pay.example.com/x" });
    expect(calls).toEqual([{ path: "/api/v1/billing/top-up", method: "POST" }]);
  });

  it("is unavailable when the route 404s on a desk or the request never lands", async () => {
    answer = () => ({ status: 404, body: { error: { code: "not_found" } } });
    expect(await fetchCheckoutOffer()).toEqual({ available: false, checkoutUrl: null });
    answer = () => ({ throws: true });
    expect(await fetchCheckoutOffer()).toEqual({ available: false, checkoutUrl: null });
  });
});

describe("formatPeriodEnd", () => {
  it("writes the date a person in that locale reads", () => {
    const end = Date.UTC(2026, 9, 1);
    expect(formatPeriodEnd(end, "en")).toBe("Oct 1, 2026");
    expect(formatPeriodEnd(end, "id")).toBe("1 Okt 2026");
  });

  it("answers null rather than a wrong date for a number that is not one", () => {
    for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, 0]) {
      expect(formatPeriodEnd(value, "en"), String(value)).toBeNull();
    }
  });
});
