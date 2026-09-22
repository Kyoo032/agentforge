"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useHostCapabilities } from "@/lib/host-capabilities";
import { t } from "@/lib/i18n";
import { usePlanBlock, type PlanBlockCode } from "@/lib/plan-block";
import { fetchCheckoutOffer, type CheckoutOffer } from "@/lib/plans-api";

/**
 * Phase 9 lane G — the screen a tenant sees when the **plan** refused the call.
 *
 * The rule that shapes every line of this file is
 * `docs/internal/web-phase5-plans-billing-decisions.md` §3(b): a `plan_*` refusal must never route
 * to the paste-your-key onboarding screen. That screen's exits are a gateway key, a re-check, or
 * deleting a file on the server's disk, and a hosted tenant has none of them — which is precisely
 * why the host answers `plan_past_due` instead of `gateway_blocked` in the first place. So the only
 * link this screen ever renders is `/pricing`, plus an operator's checkout when one is configured.
 *
 * **`plan_unavailable` is not a paywall.** It is the 503 the host throws when the plan cannot be
 * read at all (`packages/host/src/entitlement-store.ts:470`), and the tenant it lands on may be
 * perfectly paid up. Selling them something is the wrong answer: it offers a retry and no price.
 *
 * **`plan_allowance_exhausted` carries no number.** Its branch is kept because the host can still
 * send it, but since the owner's ruling of 2026-09-21 nothing sets an allowance, so there is no
 * honest figure to quote — and a made-up one on a paywall is worse than none.
 */

type BlockShape = {
  /** Whether a payment link, when one exists, belongs on this state. */
  readonly offersPayment: boolean;
  /** Whether the price list belongs on this state. False for the 503, which sells nothing. */
  readonly offersPlans: boolean;
  /** Whether this state can simply be tried again. */
  readonly offersRetry: boolean;
};

const SHAPES: Record<PlanBlockCode, BlockShape> = {
  plan_past_due: { offersPayment: true, offersPlans: true, offersRetry: false },
  plan_cancelled: { offersPayment: false, offersPlans: true, offersRetry: false },
  plan_allowance_exhausted: { offersPayment: true, offersPlans: true, offersRetry: false },
  plan_unavailable: { offersPayment: false, offersPlans: false, offersRetry: true },
};

export type PlanBlockedScreenProps = {
  readonly code: PlanBlockCode;
  /** Where a payment would happen, when the deployment has one. Absent reads as "it has none". */
  readonly checkout?: CheckoutOffer;
  /** What the retry presses. Omitted, it reloads — which is what a 503 usually wants. */
  readonly onRetry?: () => void;
};

/**
 * Pure: it is handed the code and the offer and renders them.
 *
 * The fetching lives in `PlanBlockBoundary` below, so this can be rendered in a test, in a preview
 * and in the app from the same code path — and so a screen that says "contact us" can never be the
 * result of a request that is merely still in flight.
 */
export function PlanBlockedScreen({ code, checkout, onRetry }: PlanBlockedScreenProps) {
  const shape = SHAPES[code];
  const payable = shape.offersPayment && checkout?.available === true && checkout.checkoutUrl !== null;

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-app px-6 py-12 text-[var(--text)]"
      data-testid="plan-blocked"
      data-plan-block={code}
    >
      <section
        className="w-full max-w-md space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6"
        role="alert"
      >
        <div className="kicker">{t("plans.kicker")}</div>
        <h1 className="text-xl font-medium tracking-[var(--track)] text-[var(--text)]">
          {t(`plans.blocked.${code}.title`)}
        </h1>
        <p className="text-sm leading-relaxed text-[var(--text-2)]">{t(`plans.blocked.${code}.body`)}</p>

        <div className="flex flex-wrap gap-3 pt-1">
          {payable && checkout?.checkoutUrl ? (
            <a
              className="btn btn-primary"
              href={checkout.checkoutUrl}
              rel="noreferrer noopener"
              data-testid="plan-blocked-checkout"
            >
              {t("plans.blocked.topUp")}
            </a>
          ) : null}
          {shape.offersPlans ? (
            <a
              className={payable ? "btn btn-secondary" : "btn btn-primary"}
              href="/pricing"
              data-testid="plan-blocked-plans"
            >
              {t("plans.blocked.seePlans")}
            </a>
          ) : null}
          {shape.offersRetry ? (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="plan-blocked-retry"
              onClick={() => {
                if (onRetry) {
                  onRetry();
                  return;
                }
                if (typeof window !== "undefined") {
                  window.location.reload();
                }
              }}
            >
              {t("plans.blocked.retry")}
            </button>
          ) : null}
        </div>

        {shape.offersPayment && !payable ? (
          <p className="text-xs text-[var(--text-3)]" data-testid="plan-blocked-contact">
            {t("plans.cta.contactHelp")}
          </p>
        ) : null}
      </section>
    </main>
  );
}

/**
 * The seam: wrap a subtree, and a reported plan refusal replaces it with the screen above.
 *
 * Nothing in this renderer inspects a 403 body centrally today — `parseGatewayBlocked` has exactly
 * two call sites, both of them the answer to one POST — so rather than grow an interceptor inside
 * `apiFetch` or a branch inside `App.tsx` (neither of which is this lane's file), a handler that
 * has read a refusal body calls `reportPlanBlocked(body)` and this boundary hears it.
 *
 * The checkout is read **after** a refusal arrives, never on boot: it is a POST, and a page that
 * posted to the billing route on every load would do it for every signed-out visitor too.
 */
export function PlanBlockBoundary({ children }: { children: ReactNode }) {
  const { code, clear } = usePlanBlock();
  const capabilities = useHostCapabilities();
  const [checkout, setCheckout] = useState<CheckoutOffer | undefined>(undefined);

  useEffect(() => {
    if (!code || !capabilities.plans || !SHAPES[code].offersPayment) {
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
  }, [code, capabilities.plans]);

  if (!code) {
    return <>{children}</>;
  }
  return <PlanBlockedScreen code={code} checkout={checkout} onRetry={clear} />;
}
