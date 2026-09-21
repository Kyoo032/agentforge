/**
 * `/pricing`, actually rendered.
 *
 * The page's contract is that it owes the host nothing. `PLAN_TIERS` is an import
 * (`@agentforge/core/plans`, phase 9 open decision 9), so two tiers, two prices, two seat lines and
 * two calls to action have to be on screen before any request goes out and stay there if every
 * request fails. That is not hypothetical: the host process on `:3000` predates lane F's
 * `/api/v1/billing/plans` route, so that GET 404s there today, and a signed-out visitor gets a 401
 * from it on the hosted server. Both must look like a working price list — which is why the
 * `apiFetch` this file mocks throws.
 *
 * The second contract is the placeholder. Every number in the catalog is a shape waiting for a
 * figure (`packages/core/src/plans/catalog.ts` header; owner open decisions 7 and 8), so while
 * `tier.placeholder` is true the page has to say so out loud rather than let a reader take 299,000
 * for an offer.
 *
 * The third is the preview door, which exists so the owner can look at the blocked screens on a
 * local build and is dead in hosted mode by construction — it is refused whenever the host says
 * plans are enforced *or* has not answered yet.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostCapabilities, type HostCapabilities } from "@agentforge/core/capabilities";
import { PLAN_TIERS, formatPlanPrice } from "@agentforge/core/plans";
import { PricingPage, PricingView, shouldReadCurrentTier } from "@/components/pricing-page";
import { EVERYTHING_OFF, HostCapabilitiesFixture } from "./host-capabilities";
import { applyLocale, resetLocaleForTests, t } from "./i18n";
import type { CheckoutOffer } from "./plans-api";

vi.mock("@/lib/api-client", () => ({
  apiFetch: async () => {
    throw new Error("the pricing page must not need the network to render");
  },
}));

const HOSTED = hostCapabilities({ AGENTFORGE_SERVER: "1" });
const DESK = hostCapabilities({});

function view(props: { currentTierId?: string | null; checkout?: CheckoutOffer } = {}): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PricingView currentTierId={props.currentTierId ?? null} checkout={props.checkout} />
    </MemoryRouter>,
  );
}

function page(capabilities: HostCapabilities, path = "/pricing"): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <HostCapabilitiesFixture capabilities={capabilities}>
        <PricingPage />
      </HostCapabilitiesFixture>
    </MemoryRouter>,
  );
}

/** The opening tag carrying a testid, whatever order its attributes happen to be written in. */
function tag(markup: string, testId: string): string {
  return markup.match(new RegExp(`<[a-zA-Z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
}

/** A dotted key that reached the DOM is `t()` saying the catalog has no copy for it. */
function rawKeys(markup: string): string[] {
  return [...markup.matchAll(/plans\.[\w.]+/g)].map((match) => match[0]);
}

beforeEach(() => {
  applyLocale("en");
});

afterEach(() => {
  resetLocaleForTests();
});

describe("the price list", () => {
  it("renders every catalog tier with nothing fetched at all", () => {
    const markup = view();
    expect(markup).toContain('data-testid="pricing-page"');
    for (const tier of PLAN_TIERS) {
      expect(tag(markup, `pricing-tier-${tier.id}`), tier.id).not.toBe("");
      expect(tag(markup, `pricing-cta-${tier.id}`), tier.id).not.toBe("");
      expect(markup, tier.id).toContain(t(tier.nameKey));
      expect(markup, tier.id).toContain(t(tier.descriptionKey));
    }
    expect(rawKeys(markup)).toEqual([]);
  });

  it("prints each tier's price in the reader's own language, with the period", () => {
    // The separator `Intl` puts after the currency is a non-breaking space, not a space.
    for (const [locale, personal] of [
      ["en", "IDR 299,000"],
      ["id", "Rp 299.000"],
    ] as const) {
      resetLocaleForTests();
      applyLocale(locale);
      const markup = view();
      expect(markup, locale).toContain(personal);
      for (const tier of PLAN_TIERS) {
        expect(markup, `${locale} / ${tier.id}`).toContain(formatPlanPrice(tier, locale));
      }
      expect(markup, locale).toContain(t("plans.period.month"));
    }
  });

  it("says a seat cap where there is one and names one seat where there is not", () => {
    const markup = view();
    // Enterprise's placeholder cap is a number a buyer would act on, so it is on the card.
    expect(markup).toContain("Up to 20 seats");
    expect(markup).toContain("One seat");
  });

  it("lists every feature the catalog gives a tier", () => {
    const markup = view();
    for (const tier of PLAN_TIERS) {
      expect(tag(markup, `pricing-features-${tier.id}`), tier.id).not.toBe("");
      for (const key of tier.featureKeys) {
        expect(markup, `${tier.id} / ${key}`).toContain(t(key));
      }
    }
    // Together with the line above: every feature sentence is printed, and none of them is a key.
    expect(rawKeys(markup)).toEqual([]);
  });

  it("emphasises exactly one tier, the one the catalog highlights", () => {
    const markup = view();
    expect([...markup.matchAll(/data-highlighted="true"/g)]).toHaveLength(1);
    expect(tag(markup, "pricing-tier-enterprise")).toContain('data-highlighted="true"');
    expect(tag(markup, "pricing-tier-personal")).toContain('data-highlighted="false"');
  });

  it("says out loud that the prices are not real yet", () => {
    expect(PLAN_TIERS.every((tier) => tier.placeholder)).toBe(true);
    const markup = view();
    expect(tag(markup, "pricing-placeholder")).not.toBe("");
    expect(markup).toContain("Indicative pricing");
  });

  it("marks the tenant's own tier when the host has said which it is", () => {
    const markup = view({ currentTierId: "enterprise" });
    expect(tag(markup, "pricing-tier-enterprise")).toContain('data-current="true"');
    expect(tag(markup, "pricing-tier-personal")).toContain('data-current="false"');
    // Nothing is marked when the host has not said — the signed-out visitor and the 404 both here.
    expect(view()).not.toContain('data-current="true"');
  });
});

describe("the call to action", () => {
  it("sends a buyer to the operator's checkout when the deployment has one", () => {
    const markup = view({ checkout: { available: true, checkoutUrl: "https://pay.example.com/x" } });
    for (const tier of PLAN_TIERS) {
      expect(tag(markup, `pricing-cta-${tier.id}`), tier.id).toContain('href="https://pay.example.com/x"');
    }
  });

  it("offers a way to ask rather than a button that does nothing, when there is no checkout", () => {
    // Every deployment today: no payment provider is bound (plan D4, still open).
    const markup = view({ checkout: { available: false, checkoutUrl: null } });
    expect(tag(markup, "pricing-contact-help")).not.toBe("");
    expect(markup).not.toContain("pay.example.com");
    for (const tier of PLAN_TIERS) {
      const cta = tag(markup, `pricing-cta-${tier.id}`);
      // Still a control, still labelled, still reachable by keyboard — never a disabled stub.
      expect(cta, tier.id).toContain("<button");
      expect(cta, tier.id).not.toContain("disabled");
    }
  });

  it("does not offer to sell a tenant the tier it is already on", () => {
    const markup = view({
      currentTierId: "personal",
      checkout: { available: true, checkoutUrl: "https://pay.example.com/x" },
    });
    expect(tag(markup, "pricing-cta-personal")).not.toContain("href=");
    expect(markup).toContain(t("plans.cta.current"));
    expect(tag(markup, "pricing-cta-enterprise")).toContain('href="https://pay.example.com/x"');
  });
});

describe("the preview door", () => {
  it("shows a blocked screen on a local build, which is what the owner reviews", () => {
    const markup = page(DESK, "/pricing?preview=plan_past_due");
    expect(markup).toContain('data-testid="plan-blocked"');
    expect(markup).toContain('data-plan-block="plan_past_due"');
  });

  it("is dead on the hosted server, where plans are real", () => {
    const markup = page(HOSTED, "/pricing?preview=plan_cancelled");
    expect(markup).not.toContain('data-testid="plan-blocked"');
    expect(markup).toContain('data-testid="pricing-page"');
  });

  it("is dead before the host has said what it is", () => {
    // Capabilities default to all-false, so `plans` being false alone would read as "local" on a
    // hosted server in the moment between first paint and ping answering. `singleOwner` is the
    // positive fact that only a non-hosted deployment reports.
    const markup = page(EVERYTHING_OFF, "/pricing?preview=plan_cancelled");
    expect(markup).not.toContain('data-testid="plan-blocked"');
    expect(markup).toContain('data-testid="pricing-page"');
  });

  it("ignores a preview value that is not a block code", () => {
    for (const value of ["gateway_blocked", "", "plan_", "needs_key"]) {
      expect(page(DESK, `/pricing?preview=${value}`), value).toContain('data-testid="pricing-page"');
    }
  });

  it("renders the ordinary price list with no preview at all", () => {
    expect(page(DESK)).toContain('data-testid="pricing-page"');
    expect(page(DESK)).not.toContain('data-testid="plan-blocked"');
  });
});

/**
 * The one request this page makes, and when it is worth making.
 *
 * `/pricing` is reachable signed out on purpose — a `seat_cap_reached` refusal sends people here
 * while they are, by definition, not signed in — and the tier read was made on every visit anyway.
 * On the hosted server that is a `401 session_required` per signed-out visit to a public page,
 * logged by the host and printed in the browser, for an answer the page discards. A visitor is on
 * no tier, which is what `currentTierId: null` already renders.
 *
 * The predicate is tested rather than the effect because `renderToStaticMarkup` runs no effects at
 * all; the live behaviour is driven on the review instance.
 */
describe("shouldReadCurrentTier", () => {
  it("asks only when there is a tenant to ask about and a route to ask", () => {
    expect(shouldReadCurrentTier(true, "signed-in")).toBe(true);
  });

  it("never asks while signed out, whatever the deployment says", () => {
    expect(shouldReadCurrentTier(true, "signed-out")).toBe(false);
  });

  it("waits rather than guessing before the session has resolved", () => {
    expect(shouldReadCurrentTier(true, "unknown")).toBe(false);
  });

  it("never asks on a deployment that enforces no plans", () => {
    // The desk and webdev: the route does not exist there, and a 404 is no more useful than a 401.
    for (const status of ["signed-in", "signed-out", "unknown", "unavailable"] as const) {
      expect(shouldReadCurrentTier(false, status), status).toBe(false);
    }
  });
});
