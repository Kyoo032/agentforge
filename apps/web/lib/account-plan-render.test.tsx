/**
 * The Settings plan panel, actually rendered.
 *
 * What this file is really holding is the owner's ruling of 2026-09-21: **no token allowance,
 * anywhere**. The Phase 5 plan and the map page both describe a usage panel with a bar that turns
 * amber at 80 per cent, and `GET /api/v1/billing/plan` still carries `allowanceUsdMicros`,
 * `spentUsdMicros` and `usedFraction` because the enforcement path needs them. The panel must show
 * seats and plan standing and nothing else, so the assertion below is blunt: no figure the host
 * sends about money or usage may appear in the text, whatever it sends.
 *
 * The second thing is the local branch. `capabilities.plans` is false on the Personal desktop app
 * and on webdev, and a panel about billing on a machine where nothing is billed is noise. It used to
 * print one line and a `/pricing` link, which the packaged shell blocks (0.15.0 changelog §7.4), so
 * it now renders nothing there — no card, no link. Where the host has plans, the link stays.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostCapabilities } from "@agentforge/core/capabilities";
import { AccountPlanPanel, AccountPlanView } from "@/components/account-plan-panel";
import { EVERYTHING_OFF, HostCapabilitiesFixture } from "./host-capabilities";
import { applyLocale, resetLocaleForTests, t } from "./i18n";
import type { AccountPlan } from "./plans-api";

vi.mock("@/lib/api-client", () => ({
  apiFetch: async () => {
    throw new Error("the panel must not fetch where the host says there are no plans");
  },
}));

const HOSTED = hostCapabilities({ AGENTFORGE_SERVER: "1" });
const DESK = hostCapabilities({});

const ENTERPRISE: AccountPlan = {
  enforced: true,
  tierId: "enterprise",
  kind: "enterprise",
  status: "active",
  seatCap: 20,
  seatsInUse: 3,
  periodEnd: Date.UTC(2026, 9, 1),
  block: null,
  warnings: [],
};

function view(plan: AccountPlan | null, loaded = true): string {
  return renderToStaticMarkup(<AccountPlanView plan={plan} loaded={loaded} />);
}

function panel(capabilities = DESK): string {
  return renderToStaticMarkup(
    <HostCapabilitiesFixture capabilities={capabilities}>
      <AccountPlanPanel />
    </HostCapabilitiesFixture>,
  );
}

/**
 * Only what a person reads: tags stripped, and the entities React escapes put back, so an
 * apostrophe in the copy is compared as an apostrophe rather than as `&#x27;`.
 */
function text(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function rawKeys(markup: string): string[] {
  return [...markup.matchAll(/plans\.[\w.]+/g)].map((match) => match[0]);
}

beforeEach(() => {
  applyLocale("en");
});

afterEach(() => {
  resetLocaleForTests();
});

describe("the hosted panel", () => {
  it("names the tier, its standing and the seats in use", () => {
    const markup = view(ENTERPRISE);
    expect(markup).toContain('data-testid="account-plan"');
    expect(markup).toContain(t("plans.tier.enterprise.name"));
    expect(markup).toContain('data-testid="account-plan-status" data-status="active"');
    expect(text(markup)).toContain("Active");
    expect(text(markup)).toContain("3 of 20 seats in use");
    expect(text(markup)).toContain("Oct 1, 2026");
    expect(rawKeys(markup)).toEqual([]);
  });

  it("shows no seat line at all where no cap is configured", () => {
    // `seatCap: null` is "no cap", which `seatAdmission` admits everybody against. A line reading
    // "1 of null seats" would be nonsense, and inventing a cap of 1 would be a claim nobody holds.
    const markup = view({ ...ENTERPRISE, tierId: "personal", kind: "personal", seatCap: null, seatsInUse: 1 });
    expect(markup).not.toContain('data-testid="account-plan-seats"');
    expect(text(markup)).not.toContain("seats in use");
  });

  it("carries no allowance bar and no usage figure, whatever the host sends", () => {
    const markup = view({ ...ENTERPRISE, warnings: ["allowance_low", "unpriced_usage"] });
    expect(markup).not.toContain("progressbar");
    for (const word of ["token", "%", "USD", "$"]) {
      expect(text(markup), word).not.toContain(word);
    }
    // The warnings themselves are words, not numbers, and both are said.
    expect(text(markup)).toContain(t("plans.account.warning.allowance_low"));
    expect(text(markup)).toContain(t("plans.account.warning.unpriced_usage"));
  });

  it("names a status pill for each standing the host can report", () => {
    for (const status of ["active", "past_due", "cancelled"] as const) {
      const markup = view({ ...ENTERPRISE, status });
      expect(markup, status).toContain(`data-status="${status}"`);
      expect(rawKeys(markup), status).toEqual([]);
    }
  });

  /**
   * `tierId: null` is the host saying this account is on no tier the catalog sells — either it has
   * no plan row at all, or a hand-set cap nobody is charged for. The card used to call that a
   * "custom plan" and pair it with whatever `status` the fail-open default carried, so a tenant
   * nobody had sold anything to read "Custom plan · Active". It now says there is no plan, and
   * points at the price list.
   */
  it("says there is no plan, rather than naming one, when the host matched no tier", () => {
    const markup = view({ ...ENTERPRISE, tierId: null, seatCap: 7 });
    expect(markup).toContain('data-testid="account-plan-none"');
    expect(text(markup)).toContain(t("plans.account.noPlan"));
    expect(text(markup)).toContain(t("plans.account.seePlans"));
    // And nothing that reads as a live subscription.
    expect(markup).not.toContain('data-testid="account-plan-tier"');
    expect(markup).not.toContain('data-testid="account-plan-status"');
    expect(rawKeys(markup)).toEqual([]);
  });

  it("says the same for a brand-new tenant the host reports with no tier and no seat cap", () => {
    const markup = view({ ...ENTERPRISE, tierId: null, seatCap: null, kind: "personal", status: "active" });
    expect(markup).toContain('data-testid="account-plan-none"');
    expect(text(markup)).not.toContain(t("plans.tier.personal.name"));
  });

  it("says the plan could not be read rather than showing an empty card", () => {
    expect(text(view(null))).toContain(t("plans.account.failed"));
    expect(text(view(null, false))).toContain(t("plans.account.loading"));
  });

  it("renders every state as Indonesian too", () => {
    resetLocaleForTests();
    applyLocale("id");
    for (const plan of [ENTERPRISE, { ...ENTERPRISE, status: "past_due" as const, tierId: null }, null]) {
      expect(rawKeys(view(plan))).toEqual([]);
    }
  });
});

describe("the panel on a machine where nothing is billed", () => {
  it("renders nothing at all — no card, no plans line, no /pricing link", () => {
    const markup = panel(DESK);
    expect(markup).toBe("");
    expect(markup).not.toContain('href="/pricing"');
    expect(markup).not.toContain(t("plans.account.notEnforced"));
    expect(markup).not.toContain(t("plans.account.seePlans"));
  });

  it("behaves the same before the host has answered at all", () => {
    expect(panel(EVERYTHING_OFF)).toBe("");
  });

  it("asks the host for a plan only where the host says there are plans", () => {
    // The mocked `apiFetch` throws; reaching it at all on a desk would fail this render.
    expect(() => panel(DESK)).not.toThrow();
    expect(() => panel(HOSTED)).not.toThrow();
  });
});

describe("the panel where the host has plans", () => {
  it("renders the card while the first read is in flight", () => {
    const markup = panel(HOSTED);
    expect(markup).toContain('data-testid="account-plan"');
    expect(text(markup)).toContain(t("plans.account.loading"));
  });

  it("keeps the /pricing link on a hosted card", () => {
    expect(view(ENTERPRISE)).toContain('href="/pricing"');
    expect(view({ ...ENTERPRISE, tierId: null })).toContain('href="/pricing"');
  });
});
