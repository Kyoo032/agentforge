"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PLAN_TIERS, formatPlanPrice, type PlanTier } from "@agentforge/core/plans";
import { PlanBlockedScreen } from "./plan-blocked-screen";
import { useHostCapabilities } from "@/lib/host-capabilities";
import { getLocale, t } from "@/lib/i18n";
import { isPlanBlockCode, type PlanBlockCode } from "@/lib/plan-block";
import { fetchCheckoutOffer, fetchCurrentTier, type CheckoutOffer } from "@/lib/plans-api";
import { useSession, type SessionStatus } from "@/lib/session";

/**
 * Phase 9 lane G — the price list, at `/pricing`.
 *
 * **It renders from an import, in every mode.** `PLAN_TIERS` comes from `@agentforge/core/plans`
 * (phase 9 open decision 9), so the two tiers, their prices, their seat lines and their features
 * are on screen before a request goes out — and stay there when every request fails. That case is
 * the normal one right now: the host on `:3000` predates lane F's `GET /api/v1/billing/plans`, and
 * a signed-out visitor on the hosted server is refused it. Neither may take the page down. The one
 * thing the host is asked is which tier *this* tenant is on, and that is an overlay: absent, the
 * page is a price list with nothing marked, which is exactly right for a visitor.
 *
 * **Every number on it is a placeholder** (catalog header; owner open decisions 7 and 8), so the
 * page carries a strip that says so while `tier.placeholder` is true. Nothing here may be quoted
 * to a customer until the owner replaces the figures and clears that flag.
 *
 * **There is no self-serve purchase on this page.** Personal is the Mac and Windows app and does
 * not start a seat subscription. Enterprise stays a contact with DPS even when the deployment has
 * a billing top-up URL — that URL is for the blocked screen's payment update, not for buying
 * Enterprise here. A call to action is either a plain statement when the tenant is already on that
 * tier, or a control that asks. A greyed-out "Buy" that does nothing would be worse than either.
 */

/** `?preview=<code>` renders a blocked screen — only where plans are demonstrably not enforced. */
function previewCode(search: URLSearchParams, local: boolean): PlanBlockCode | null {
  if (!local) {
    return null;
  }
  const value = search.get("preview");
  return isPlanBlockCode(value) ? value : null;
}

/** A null cap is not a seat count. Personal is the desktop app, so it has no seats line. */
function seatsLine(tier: PlanTier): string | null {
  return tier.seatCap === null ? null : t("plans.seats.capped", { count: tier.seatCap });
}

/**
 * Neither published offer checks out from this page.
 * Personal does not start a seat subscription. Enterprise stays contact-DPS even when `checkout`
 * carries a top-up URL. Any other kind would still use that URL; these two never do.
 */
function checkoutHrefForTier(tier: PlanTier, checkout: CheckoutOffer | undefined): string | null {
  if (tier.kind === "personal" || tier.kind === "enterprise") {
    return null;
  }
  return checkout?.available === true && checkout.checkoutUrl ? checkout.checkoutUrl : null;
}

function askLabel(tier: PlanTier): string {
  return tier.kind === "enterprise" ? t("plans.cta.contact") : t("plans.cta.personalApp");
}

const CARD_BASE = "flex flex-col gap-4 rounded-xl border bg-[var(--surface)] p-5 text-[var(--text)] transition-shadow";

function TierCard({
  tier,
  current,
  checkout,
  onAsk,
}: {
  tier: PlanTier;
  current: boolean;
  checkout: CheckoutOffer | undefined;
  onAsk: () => void;
}) {
  const highlighted = tier.highlighted === true;
  const checkoutHref = checkoutHrefForTier(tier, checkout);
  const seats = seatsLine(tier);

  return (
    <section
      className={`${CARD_BASE} ${highlighted ? "raise border-[var(--accent)]" : "border-[var(--line)]"}`}
      data-testid={`pricing-tier-${tier.id}`}
      data-highlighted={highlighted ? "true" : "false"}
      data-current={current ? "true" : "false"}
      aria-labelledby={`pricing-name-${tier.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={`pricing-name-${tier.id}`} className="text-lg font-medium tracking-[var(--track)]">
          {t(tier.nameKey)}
        </h2>
        {current ? <span className="tag tag-accent">{t("plans.currentBadge")}</span> : null}
      </div>

      <p className="text-[13px] leading-relaxed text-[var(--text-2)]">{t(tier.descriptionKey)}</p>

      <p className="flex flex-wrap items-baseline gap-1.5" data-testid={`pricing-price-${tier.id}`}>
        <span className="text-2xl font-medium tabular-nums tracking-[var(--track)]">
          {formatPlanPrice(tier, getLocale())}
        </span>
        <span className="text-[13px] text-[var(--text-3)]">{t("plans.period.month")}</span>
      </p>

      {seats ? (
        <p className="text-[13px] text-[var(--text-2)]" data-testid={`pricing-seats-${tier.id}`}>
          {seats}
        </p>
      ) : null}

      <div className="border-t border-[var(--line)] pt-4">
        <p className="panel-label">{t("plans.featuresLabel")}</p>
        <ul className="mt-2 space-y-1.5 text-[13px] text-[var(--text-2)]" data-testid={`pricing-features-${tier.id}`}>
          {tier.featureKeys.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </div>

      <div className="mt-auto pt-2">
        {current ? (
          <p
            className="text-[13px] font-medium text-[var(--text-2)]"
            data-testid={`pricing-cta-${tier.id}`}
            data-current="true"
          >
            {t("plans.cta.current")}
          </p>
        ) : checkoutHref ? (
          <a
            className={highlighted ? "btn btn-primary" : "btn btn-secondary"}
            data-testid={`pricing-cta-${tier.id}`}
            href={checkoutHref}
            rel="noreferrer noopener"
          >
            {askLabel(tier)}
          </a>
        ) : (
          <button
            type="button"
            className={highlighted ? "btn btn-primary" : "btn btn-secondary"}
            data-testid={`pricing-cta-${tier.id}`}
            onClick={onAsk}
          >
            {askLabel(tier)}
          </button>
        )}
      </div>
    </section>
  );
}

export type PricingViewProps = {
  /** The tier the host says this tenant is on, or `null` — which is the signed-out case too. */
  readonly currentTierId: string | null;
  /** Where a purchase would happen. Absent or unavailable reads as "ask the operator". */
  readonly checkout?: CheckoutOffer;
};

/**
 * The list itself, pure.
 *
 * Split from the route component so the same markup can be rendered in a test, in a preview and in
 * the app — and so a card that says "contact us" can never be the result of a request that is
 * merely still in flight.
 */
export function PricingView({ currentTierId, checkout }: PricingViewProps) {
  const [asked, setAsked] = useState(false);
  const placeholder = PLAN_TIERS.some((tier) => tier.placeholder);

  return (
    <main className="mx-auto max-w-[var(--content-wide)] px-6 py-10 text-[var(--text)]" data-testid="pricing-page">
      <div className="kicker">{t("plans.kicker")}</div>
      <h1 className="mt-2 text-2xl font-medium tracking-[var(--track)]">{t("plans.title")}</h1>
      <p className="mt-2 max-w-[var(--content-narrow)] text-[13px] leading-relaxed text-[var(--text-2)]">{t("plans.intro")}</p>

      {placeholder ? (
        <p
          className="mt-5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-2)]"
          data-testid="pricing-placeholder"
          role="note"
        >
          {t("plans.placeholderNotice")}
        </p>
      ) : null}

      {/* One column on a phone, two from the medium breakpoint: the cards stack rather than shrink. */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {PLAN_TIERS.map((tier) => (
          <TierCard
            key={tier.id}
            tier={tier}
            current={currentTierId !== null && currentTierId === tier.id}
            checkout={checkout}
            onAsk={() => setAsked(true)}
          />
        ))}
      </div>

      <p
        className="mt-5 text-[13px] text-[var(--text-2)]"
        data-testid="pricing-contact-help"
        role={asked ? "status" : undefined}
      >
        {t("plans.cta.contactHelp")}
      </p>
    </main>
  );
}

/**
 * The route: reads what the host will tell it, and renders the list either way.
 *
 * Both reads are best-effort and neither gates the render. The checkout probe is a POST to
 * `/api/v1/billing/top-up`, which raises nothing and writes nothing — it answers where a purchase
 * would happen — and it is made only where the host says plans exist, so a desk and a signed-out
 * visitor never post to a billing route at all.
 */
/**
 * Whether asking the host which tier this tenant is on can produce an answer.
 *
 * Both halves are required. Off `plans` there is no such route (a desk 404s it). Signed out there
 * is no tenant, and the hosted server answers `401 session_required` — which this page then
 * discards, having logged a refusal on every single signed-out visit to a public price list. A
 * status that has not resolved yet (`unknown`) waits rather than guessing.
 */
export function shouldReadCurrentTier(plansEnforced: boolean, status: SessionStatus): boolean {
  return plansEnforced && status === "signed-in";
}

export function PricingPage() {
  const capabilities = useHostCapabilities();
  const session = useSession();
  const [search] = useSearchParams();
  const [currentTierId, setCurrentTierId] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutOffer | undefined>(undefined);

  /**
   * Which tier this tenant is on — asked only when there is a tenant to ask about.
   *
   * `/pricing` is reachable signed out by design: a `seat_cap_reached` refusal sends people here
   * while they are, by definition, not signed in. This read was made anyway, so every signed-out
   * visit put a `401 session_required` in the hosted server's logs and the browser console, on a
   * page that never needed the answer — a signed-out visitor is on no tier, which is exactly what
   * the page renders when this stays `null`.
   */
  const ask = shouldReadCurrentTier(capabilities.plans, session.status);
  useEffect(() => {
    if (!ask) {
      return;
    }
    let live = true;
    void fetchCurrentTier().then((tier) => {
      if (live) {
        setCurrentTierId(tier);
      }
    });
    return () => {
      live = false;
    };
  }, [ask]);

  useEffect(() => {
    if (!capabilities.plans) {
      return;
    }
    let live = true;
    void fetchCheckoutOffer().then((offer) => {
      if (live) {
        setCheckout(offer);
      }
    });
    return () => {
      live = false;
    };
  }, [capabilities.plans]);

  // The owner's door onto the blocked screens, and it is dead in hosted mode by construction:
  // `singleOwner` is true only off server mode, and every capability is false until ping answers,
  // so an unanswered ping refuses the preview rather than opening it.
  const preview = previewCode(search, !capabilities.plans && capabilities.singleOwner);
  if (preview) {
    return <PlanBlockedScreen code={preview} checkout={checkout} />;
  }

  return <PricingView currentTierId={currentTierId} checkout={checkout} />;
}
