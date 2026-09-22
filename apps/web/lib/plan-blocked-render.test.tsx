/**
 * The four full-screen plan states, actually rendered.
 *
 * The rule this file exists to hold is one sentence from
 * `docs/internal/web-phase5-plans-billing-decisions.md` §3(b): a plan refusal must **never** put a
 * tenant on the paste-your-key onboarding screen. A hosted tenant holds no gateway key, so that
 * screen's three exits — paste a key, re-check, delete a file on the server's disk — are all
 * closed to them, and a paywall that lands there is a dead end rather than a sale. Every assertion
 * about hrefs below is that rule made executable.
 *
 * The second rule is the owner's, 2026-09-21: **no numbers**. `plan_allowance_exhausted` survives
 * because the host can still send it, but nobody is metered against a budget any more, so its copy
 * may not quote one — not a percentage, not a figure, not a token count.
 *
 * `renderToStaticMarkup` runs each state against the real `t()` and the real catalogs, so a state
 * whose copy is missing shows up here as a raw dotted key rather than on a customer's screen.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostCapabilities } from "@agentforge/core/capabilities";
import { PlanBlockBoundary, PlanBlockedScreen } from "@/components/plan-blocked-screen";
import { HostCapabilitiesFixture } from "./host-capabilities";
import { PLAN_BLOCK_CODES, type PlanBlockCode } from "./plan-block";
import { applyLocale, resetLocaleForTests } from "./i18n";
import type { CheckoutOffer } from "./plans-api";

const HOSTED = hostCapabilities({ AGENTFORGE_SERVER: "1" });

function render(code: PlanBlockCode, checkout?: CheckoutOffer): string {
  return renderToStaticMarkup(<PlanBlockedScreen code={code} checkout={checkout} />);
}

/** Every `href` in the markup, which is the whole of where this screen can send somebody. */
function hrefs(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
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

describe("PlanBlockedScreen", () => {
  it("renders a state for every code the host can send, in both languages", () => {
    for (const locale of ["en", "id"] as const) {
      resetLocaleForTests();
      applyLocale(locale);
      for (const code of PLAN_BLOCK_CODES) {
        const markup = render(code);
        expect(markup, `${locale} / ${code}`).toContain('data-testid="plan-blocked"');
        expect(markup, `${locale} / ${code}`).toContain(`data-plan-block="${code}"`);
        expect(rawKeys(markup), `${locale} / ${code} has copy missing`).toEqual([]);
      }
    }
  });

  it("never sends a blocked tenant to the onboarding screen", () => {
    for (const code of PLAN_BLOCK_CODES) {
      for (const link of hrefs(render(code))) {
        // The gate screen lives at the app root; a plan refusal may only ever offer the price list.
        expect(link, `${code} → ${link}`).toBe("/pricing");
      }
      expect(render(code)).not.toContain("onboarding.");
    }
  });

  it("offers the price list on a paywall and withholds it on the 503", () => {
    for (const code of ["plan_past_due", "plan_cancelled", "plan_allowance_exhausted"] as const) {
      expect(hrefs(render(code)), code).toContain("/pricing");
    }
    // `plan_unavailable` is a read that failed, not a plan that ran out. Offering to sell somebody
    // a plan they may already have paid for is the wrong answer to a 503.
    const unavailable = render("plan_unavailable");
    expect(hrefs(unavailable)).toEqual([]);
    expect(unavailable).toContain('data-testid="plan-blocked-retry"');
  });

  it("quotes no allowance, percentage or token count on the usage state", () => {
    // Only what a person reads: tags carry testids and Tailwind sizes, neither of which is a
    // statement about usage. In the text itself, any digit at all would be one.
    const text = render("plan_allowance_exhausted").replace(/<[^>]*>/g, " ");
    expect(text).not.toMatch(/\d/);
    for (const word of ["token", "%", "USD"]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("sends a payment somewhere real when the deployment has a checkout", () => {
    const checkout = { available: true, checkoutUrl: "https://pay.example.com/x" } as const;
    const markup = render("plan_past_due", checkout);
    expect(markup).toContain('data-testid="plan-blocked-checkout"');
    expect(hrefs(markup)).toContain("https://pay.example.com/x");
  });

  it("says who to talk to instead of showing a button that does nothing", () => {
    // No provider is bound yet, which is every deployment today.
    const markup = render("plan_past_due", { available: false, checkoutUrl: null });
    expect(markup).not.toContain('data-testid="plan-blocked-checkout"');
    expect(markup).toContain('data-testid="plan-blocked-contact"');
  });

  it("is a live region with a heading, so a screen reader is told the desk just closed", () => {
    const markup = render("plan_cancelled");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("<h1");
  });
});

describe("PlanBlockBoundary", () => {
  it("renders the app when no refusal has been reported", () => {
    const markup = renderToStaticMarkup(
      <HostCapabilitiesFixture capabilities={HOSTED}>
        <PlanBlockBoundary>
          <p>the desk</p>
        </PlanBlockBoundary>
      </HostCapabilitiesFixture>,
    );
    expect(markup).toContain("the desk");
    expect(markup).not.toContain('data-testid="plan-blocked"');
  });
});
