/**
 * The plan catalog: the tiers the pricing page renders, in one editable file.
 *
 * # EVERY NUMBER AND EVERY NAME IN THIS FILE IS A PLACEHOLDER.
 *
 * Nobody has priced this product yet. The owner's open decisions 7 and 8 in
 * `docs/internal/web-phase9-portal-login.md` are exactly "real tier names, prices, seat caps" and
 * the tier shape — so the rupiah prices, the Enterprise seat cap and the tier copy below are shapes
 * waiting for a figure, not offers. Every tier carries `placeholder: true` so a surface that
 * renders one can say so out loud, and nothing here may be quoted to a customer until the owner
 * replaces the numbers and clears that flag. `docs/internal/web-phase5-plans-billing-decisions.md`
 * §D2 says the same thing from the other side: there is no number in this repo to derive a tier
 * from, and inventing one would be the kind of answer the pivot record forbids.
 *
 * What is *not* a placeholder is the shape, fixed by three decisions already made:
 *
 * - **Two tiers, one per plan kind** (owner, 2026-09-21). `PLAN_KINDS` in `../entitlement/types`
 *   is `personal | enterprise`; a tier's `id` *is* its kind, so nothing has to map between them.
 * - **Nothing is metered against a token budget** (owner, 2026-09-21). There is no token allowance
 *   here and no token/USD conversion: both tiers leave `tenant_plan.allowance_usd_micros` `null`,
 *   which `entitlementBlock` reads as "no allowance is enforced — spend is recorded and never
 *   refused". Selling a tier therefore never sets an allowance; only a webhook can, and until one
 *   does, a tenant on either tier is uncapped. Should the owner ever want a cap, it stays USD
 *   micros of gateway cost (§D2): a token count means nothing across a catalogue whose prices move
 *   and cannot price an image or a second of video at all.
 * - **A seat cap is meaningless on Personal** (§D2: "must be nullable, not defaulted to 1"), so
 *   Personal's `seatCap` is `null`, and `seatAdmission` reads that as "no cap configured", which
 *   admits everybody. Enterprise carries a placeholder number.
 *
 * Pure, browser-safe and frozen: the renderer imports it through `@agentforge/core/plans` and
 * renders the catalog in every mode without asking the host anything (phase 9 open decision 9).
 */

import { isPlanKind } from "../entitlement/types";
import type { PlanKind } from "../entitlement/types";

/**
 * The currency every price in this file is quoted in. ISO 4217.
 *
 * The plan doc's D4 ties the quote currency to the payment provider, which is undecided — so this
 * is a placeholder too, chosen because the selling entity is expected to be Indonesian.
 */
export const PLAN_CATALOG_CURRENCY = "IDR";

/**
 * Rupiah has no sub-unit in practice, so a "minor unit" price is a whole rupiah.
 *
 * Named rather than inlined because the day the catalog quotes a currency with cents, this is the
 * one number that changes — and `priceMinor / 1` is not something a reader should infer from a
 * currency code.
 */
const MINOR_UNITS_PER_MAJOR = 1;

/**
 * One purchasable tier.
 *
 * Every user-visible string is an i18n key, never English: the catalog is data, and the `plans`
 * locale namespace (en + id, parity-tested) owns the copy.
 */
export type PlanTier = {
  /** Stable slug, equal to `kind`. It reaches the wire and the plan label, so it is never renamed lightly. */
  readonly id: string;
  /** Which of the two entitlement kinds this tier provisions. */
  readonly kind: PlanKind;
  /** `plans.tier.<id>.name` in the `plans` namespace. */
  readonly nameKey: string;
  /** `plans.tier.<id>.description` in the `plans` namespace. */
  readonly descriptionKey: string;
  /** Whole rupiah, per `period`. An integer: the catalog currency has no sub-unit. */
  readonly priceMinor: number;
  /** ISO 4217, always `PLAN_CATALOG_CURRENCY` today; carried per tier so a mixed catalog is legal. */
  readonly currency: string;
  /** Only monthly subscriptions exist; an annual tier would be a second row, not a second field. */
  readonly period: "month";
  /** `null` is "no cap configured", which `seatAdmission` admits. Personal is always `null` (§D2). */
  readonly seatCap: number | null;
  /** `plans.feature.*` keys, in display order. */
  readonly featureKeys: readonly string[];
  /** At most one tier sets this; the pricing page gives it the emphasised card. */
  readonly highlighted?: boolean;
  /** Always `true` until the owner supplies real figures. A surface may render a caveat on it. */
  readonly placeholder: true;
};

/**
 * PLACEHOLDER tiers, in ascending price order — which is also the order the pricing page renders.
 *
 * No `tokenAllowance`, and no allowance of any kind: see the file header. What distinguishes them
 * is the kind and the seat cap, and both of those are entitlement columns the host already has.
 */
const TIERS: readonly PlanTier[] = [
  {
    id: "personal",
    kind: "personal",
    nameKey: "plans.tier.personal.name",
    descriptionKey: "plans.tier.personal.description",
    priceMinor: 299_000,
    currency: PLAN_CATALOG_CURRENCY,
    period: "month",
    // §D2: a seat cap is meaningless here. Never 1 — a defaulted 1 is a lockout waiting to happen.
    seatCap: null,
    featureKeys: ["plans.feature.allWorkModes", "plans.feature.privateWorkspaces", "plans.feature.emailSupport"],
    placeholder: true,
  },
  {
    id: "enterprise",
    kind: "enterprise",
    nameKey: "plans.tier.enterprise.name",
    descriptionKey: "plans.tier.enterprise.description",
    priceMinor: 2_999_000,
    currency: PLAN_CATALOG_CURRENCY,
    period: "month",
    // Placeholder. 20 is the draft seat number in AGENTS.md, and the owner has not confirmed it.
    seatCap: 20,
    featureKeys: [
      "plans.feature.allWorkModes",
      "plans.feature.sharedWorkspaces",
      "plans.feature.seatManagement",
      "plans.feature.usageReports",
      "plans.feature.prioritySupport",
    ],
    highlighted: true,
    placeholder: true,
  },
];

function freezeTier(tier: PlanTier): PlanTier {
  Object.freeze(tier.featureKeys);
  return Object.freeze(tier);
}

/** Frozen, so a renderer cannot edit the table it shares with every other caller. */
export const PLAN_TIERS: readonly PlanTier[] = Object.freeze(TIERS.map(freezeTier));

const BY_ID: ReadonlyMap<string, PlanTier> = new Map(PLAN_TIERS.map((tier) => [tier.id.toLowerCase(), tier] as const));

/** A finite, non-negative whole number, or `null` for everything else — including `null` itself. */
function seatCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** The tier with this id, or `null`. Trims and lowercases, so a URL or a stored label can be passed raw. */
export function findTier(id: string): PlanTier | null {
  const key = typeof id === "string" ? id.trim().toLowerCase() : "";
  return key ? (BY_ID.get(key) ?? null) : null;
}

/**
 * Which tier a stored plan was cut from, or `null` when it matches none.
 *
 * The host stores an entitlement, not a tier: the webhook writes a kind and a seat cap, and nothing
 * persists a tier id. So the plan panel labels the stored row by matching those two columns back
 * against the catalog. The kind decides first — it is the column a webhook always sets — and the
 * seat cap has to agree exactly, so a tenant on a hand-set cap is not labelled with a tier it is
 * not on.
 *
 * A miss is ordinary and must stay silent: a hand-set cap, a tenant on an older cut of this table,
 * or any row from before the catalog existed all land here, and the caller shows the raw numbers
 * rather than guessing at a name.
 *
 * **ONLY EVER CALL THIS WITH A STORED ROW.** It is a pure lookup on two columns and it cannot tell
 * where they came from, so the caller has to. The host's `defaultPlanRecord` — personal,
 * `seatCap: null`, `active` — is byte-for-byte the shape this function reads as the Personal tier,
 * and that default is handed out to every tenant that has NO plan row at all, because entitlement
 * enforcement fails open. Labelling it made `GET /api/v1/billing/plan` answer `tierId: "personal"`
 * and the pricing page replace the Personal CTA with "This is your plan" for tenants nobody had
 * sold anything to. `packages/host/src/handlers/billing.ts` reads `findPlanRecord` (null when there
 * is no row) for the label and keeps `currentPlanRecord` for enforcement; the two questions have
 * different answers on purpose.
 */
export function matchTier(args: { kind: PlanKind; seatCap: number | null }): string | null {
  if (!isPlanKind(args.kind)) {
    return null;
  }
  const seatCap = seatCount(args.seatCap);
  const found = PLAN_TIERS.find((tier) => tier.kind === args.kind && seatCount(tier.seatCap) === seatCap);
  return found ? found.id : null;
}

/**
 * The price as a person in `locale` reads it: "IDR 299,000" in English, "Rp 299.000" in Indonesian.
 *
 * No decimals, because rupiah has no sub-unit on a price tag. A tag `Intl` rejects falls back to
 * English rather than throwing — a bad locale must not take the pricing page down.
 */
export function formatPlanPrice(tier: PlanTier, locale: string): string {
  const amount = (seatCount(tier.priceMinor) ?? 0) / MINOR_UNITS_PER_MAJOR;
  const options: Intl.NumberFormatOptions = {
    style: "currency",
    currency: tier.currency || PLAN_CATALOG_CURRENCY,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  };
  try {
    return new Intl.NumberFormat(locale, options).format(amount);
  } catch {
    return new Intl.NumberFormat("en", options).format(amount);
  }
}
