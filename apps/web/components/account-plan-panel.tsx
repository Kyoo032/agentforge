"use client";

import { useEffect, useState } from "react";
import { findTier } from "@agentforge/core/plans";
import { useHostCapabilities } from "@/lib/host-capabilities";
import { getLocale, t } from "@/lib/i18n";
import { fetchAccountPlan, formatPeriodEnd, type AccountPlan } from "@/lib/plans-api";

/**
 * Phase 9 lane G — what this account is on, on the Settings page.
 *
 * **Seats and standing, and nothing that looks like a budget.** The Phase 5 plan and
 * `docs/internal/maps/tenant-entitlement.md` both describe a usage panel with an allowance bar that
 * turns amber at 80 per cent, and `GET /api/v1/billing/plan` still carries `allowanceUsdMicros`,
 * `spentUsdMicros` and `usedFraction` because the enforcement path needs them. The owner's ruling
 * of 2026-09-21 removed the customer-facing half of that: nobody is metered against a budget, both
 * tiers leave the allowance null, and so this panel shows the plan's name, its standing, its seats
 * and the end of the period. `plans-api.ts` does not even parse the other three fields, so there is
 * no number here to render by accident.
 *
 * **The tier's name is derived, never stored.** The host persists a kind and a seat cap and matches
 * them back against the catalog (`matchTier`), and it reads them off the STORED row — so
 * `tierId: null` means this account is on no tier the catalog sells: no plan row at all, or a
 * hand-set cap nobody is charged for. Either way the honest card is "no plan yet, see plans".
 * Until 2026-09-21 the host labelled the fail-open default instead, and this panel told every
 * tenant who had never bought anything that they were on Personal, Active.
 *
 * **On a machine where nothing is billed it renders nothing**, as `SettingsStorageCard` does.
 * `capabilities.plans` is false on the Personal desktop app and on webdev, so there is no plan to
 * report and no request worth making. It used to print "Plans are not enforced" with a `/pricing`
 * link, but the packaged app loads the renderer from `file://` under a `HashRouter`, so that link
 * resolved to a `file:` URL the shell's `will-navigate` guard blocks — a dead link on every desktop
 * (0.15.0 changelog §7.4). The price list is a hosted surface; the card lives only where plans do.
 */

function tierName(plan: AccountPlan): string | null {
  const tier = plan.tierId ? findTier(plan.tierId) : null;
  return tier ? t(tier.nameKey) : null;
}

/** The `/pricing` link, which is the only door to the price list on a build with no rail entry. */
function SeePlansLink() {
  return (
    <a className="text-[var(--text-3)] underline underline-offset-2 hover:text-[var(--text)]" href="/pricing">
      {t("plans.account.seePlans")}
    </a>
  );
}

const STATUS_TONE: Record<string, string> = {
  active: "tag tag-accent",
  past_due: "tag tag-outline text-[var(--danger)]",
  cancelled: "tag tag-outline text-[var(--danger)]",
};

const SECTION_CLASS = "mt-6 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4";

export type AccountPlanViewProps = {
  readonly plan: AccountPlan | null;
  /** False while the first read is still in flight; a card that says "failed" too early lies. */
  readonly loaded: boolean;
};

/** The hosted card, pure. The reading lives in `AccountPlanPanel`. */
export function AccountPlanView({ plan, loaded }: AccountPlanViewProps) {
  const periodEnd = plan ? formatPeriodEnd(plan.periodEnd, getLocale()) : null;

  return (
    <section className={SECTION_CLASS} data-testid="account-plan">
      <div>
        <h2 className="font-medium text-[var(--text)]">{t("plans.account.heading")}</h2>
      </div>

      {!plan ? (
        <p className="text-sm text-[var(--text-3)]">
          {loaded ? t("plans.account.failed") : t("plans.account.loading")}
        </p>
      ) : !tierName(plan) ? (
        /* No tier the catalog sells. Naming one would be a claim about a sale nobody made — and
           the fail-open default this used to read made that claim for every new tenant. */
        <p className="text-[13px] text-[var(--text-2)]" data-testid="account-plan-none">
          {t("plans.account.noPlan")} <SeePlansLink />
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--text)]" data-testid="account-plan-tier">
              {tierName(plan)}
            </span>
            {plan.status ? (
              <span
                className={STATUS_TONE[plan.status] ?? "tag tag-neutral"}
                data-testid="account-plan-status"
                data-status={plan.status}
              >
                {t(`plans.account.status.${plan.status}`)}
              </span>
            ) : null}
          </div>

          {/* A null cap is "no cap configured", which admits everybody. There is no number to show,
              and a defaulted 1 would be a claim the host does not enforce. */}
          {plan.seatCap !== null ? (
            <p className="text-[13px] text-[var(--text-2)]" data-testid="account-plan-seats">
              {t("plans.account.seats", { used: plan.seatsInUse, cap: plan.seatCap })}
            </p>
          ) : null}

          {periodEnd ? (
            <p className="text-xs text-[var(--text-3)]" data-testid="account-plan-period">
              {t("plans.account.periodEnd", { date: periodEnd })}
            </p>
          ) : null}

          {plan.warnings.length > 0 ? (
            <ul className="space-y-1 text-[13px] text-[var(--text-2)]" data-testid="account-plan-warnings">
              {plan.warnings.map((warning) => (
                <li key={warning}>{t(`plans.account.warning.${warning}`)}</li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs">
            <SeePlansLink />
          </p>
        </>
      )}
    </section>
  );
}

/**
 * The one line a hosted deployment gets when it reports the plans capability but the host answers
 * `{ enforced: false }`. Only reached where `capabilities.plans` is true, so `/pricing` resolves.
 */
function NotEnforcedCard() {
  return (
    <section className={SECTION_CLASS} data-testid="account-plan">
      <p className="text-[13px] text-[var(--text-2)]">
        {t("plans.account.notEnforced")}{" "}
        <a className="underline underline-offset-2 hover:text-[var(--text)]" href="/pricing">
          {t("plans.account.seePlans")}
        </a>
      </p>
    </section>
  );
}

/** The Settings entry point: reads the plan where the host has plans, and renders nothing where it has none. */
export function AccountPlanPanel() {
  const capabilities = useHostCapabilities();
  const [plan, setPlan] = useState<AccountPlan | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!capabilities.plans) {
      return;
    }
    let live = true;
    void fetchAccountPlan().then((next) => {
      if (live) {
        setPlan(next);
        setLoaded(true);
      }
    });
    return () => {
      live = false;
    };
  }, [capabilities.plans]);

  // No plans on this host (the Personal app, webdev, or a host that has not answered the ping yet):
  // no card and no `/pricing` link, which the packaged shell could not follow anyway.
  if (!capabilities.plans) {
    return null;
  }
  // A host that answers `{ enforced: false }` while reporting the plans capability is a deployment
  // mid-change; the honest card is the one that says there is nothing to enforce.
  if (plan && !plan.enforced) {
    return <NotEnforcedCard />;
  }

  return <AccountPlanView plan={plan} loaded={loaded} />;
}
