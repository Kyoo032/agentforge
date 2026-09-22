import type { AppLocale } from "@agentforge/core/locale";
import { apiFetch } from "@/lib/api-client";
import { isPlanBlockCode, type PlanBlockCode } from "./plan-block";

/**
 * Phase 9 lane G — the three reads the plan surfaces make, and their parsers.
 *
 * **The catalog is not one of them.** `PLAN_TIERS` is imported from `@agentforge/core/plans`, so
 * the pricing page has two tiers and two prices before any request goes out and keeps them if
 * every request fails (phase 9 open decision 9). The host is asked for exactly one thing an import
 * cannot answer — which tier *this* tenant is on — and that answer is an overlay, never a
 * prerequisite.
 *
 * **A failure is null, never an exception, and never a silent swallow of a bug.** Each reader
 * catches on the network call and on `res.json()` and nowhere else; the parsers below are pure and
 * total, so a `TypeError` in this file rejects the promise instead of being reported to the page as
 * "the host said nothing". That distinction matters on `:3000` right now: the host process there
 * predates lane F's `/api/v1/billing/plans`, so that GET 404s, and the pricing page has to render
 * exactly as well as it does against a host that has it.
 *
 * **No allowance, no spend, no fraction.** `GET /api/v1/billing/plan` still carries
 * `allowanceUsdMicros`, `spentUsdMicros` and `usedFraction`, because the enforcement path needs
 * them. The owner's ruling of 2026-09-21 is that nobody is metered against a budget, so none of
 * them is parsed here — a number that never enters the renderer cannot be rendered by accident.
 */

/** A `Record` view of a payload, unwrapping the `{ body: … }` the desktop IPC transport nests. */
function record(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const outer = payload as Record<string, unknown>;
  const inner = outer.body;
  return inner && typeof inner === "object" && !Array.isArray(inner) ? (inner as Record<string, unknown>) : outer;
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A finite, non-negative whole number, or `null`. The host's own reading of a seat count. */
function seatCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

const PLAN_STATUSES = ["active", "past_due", "cancelled"] as const;
export type AccountPlanStatus = (typeof PLAN_STATUSES)[number];

const PLAN_WARNINGS = ["allowance_low", "unpriced_usage"] as const;
export type AccountPlanWarning = (typeof PLAN_WARNINGS)[number];

/** What the plan panel renders. Seats and standing; deliberately no money and no usage. */
export type AccountPlan = {
  /** False on a desk and on webdev: the host answers `{ enforced: false }` off server mode. */
  readonly enforced: boolean;
  /** The catalog tier the host matched this entitlement to, or `null` for a hand-set plan. */
  readonly tierId: string | null;
  readonly kind: string | null;
  readonly status: AccountPlanStatus | null;
  readonly seatCap: number | null;
  readonly seatsInUse: number;
  /** Epoch milliseconds, UTC by construction (`calendarMonthPeriod`). */
  readonly periodEnd: number | null;
  readonly block: PlanBlockCode | null;
  readonly warnings: readonly AccountPlanWarning[];
};

/** `GET /api/v1/billing/plans` → the tier this tenant is on, or `null` when it is on none. */
export function currentTierFrom(payload: unknown): string | null {
  const body = record(payload);
  return body ? trimmedOrNull(body.current) : null;
}

/** `GET /api/v1/billing/plan` → the panel's view of it, or `null` when the body is not one. */
export function parseAccountPlan(payload: unknown): AccountPlan | null {
  const body = record(payload);
  if (!body || typeof body.enforced !== "boolean") {
    return null;
  }
  const status = PLAN_STATUSES.find((known) => known === body.status) ?? null;
  const warnings = Array.isArray(body.warnings)
    ? PLAN_WARNINGS.filter((known) => (body.warnings as unknown[]).includes(known))
    : [];
  return {
    enforced: body.enforced,
    tierId: trimmedOrNull(body.tierId),
    kind: trimmedOrNull(body.kind),
    status,
    seatCap: seatCount(body.seatCap),
    seatsInUse: seatCount(body.seatsInUse) ?? 0,
    periodEnd: typeof body.periodEnd === "number" && Number.isFinite(body.periodEnd) ? body.periodEnd : null,
    block: isPlanBlockCode(body.block) ? body.block : null,
    warnings,
  };
}

/**
 * An operator's checkout link, or `null` for anything that is not one.
 *
 * `AGENTFORGE_BILLING_TOPUP_URL` is a string from the deployment's environment that the host hands
 * back verbatim and this page turns into an `href`. `javascript:` and `data:` URLs in an `href`
 * run in the tenant's own session, so the scheme is checked rather than trusted — a mis-set
 * environment variable must not become script execution.
 */
export function safeCheckoutUrl(value: unknown): string | null {
  const raw = trimmedOrNull(value);
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? raw : null;
  } catch {
    return null;
  }
}

/** Whether there is somewhere to send a buyer, and where. Never "yes" without a usable link. */
export type CheckoutOffer = { readonly available: boolean; readonly checkoutUrl: string | null };

const NO_CHECKOUT: CheckoutOffer = Object.freeze({ available: false, checkoutUrl: null });

export function parseCheckoutOffer(payload: unknown): CheckoutOffer {
  const body = record(payload);
  if (body?.available !== true) {
    return NO_CHECKOUT;
  }
  const url = safeCheckoutUrl(body.checkoutUrl);
  // An `available: true` with nothing usable behind it is the dead button this lane must not ship.
  return url ? { available: true, checkoutUrl: url } : NO_CHECKOUT;
}

/** The body of a response, or `null` when the call or the JSON failed. Never throws for those two. */
async function readJson(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await apiFetch(path, init ?? {});
  } catch {
    return null;
  }
  if (!res.ok) {
    return null;
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Which tier this tenant is on, or `null`.
 *
 * `null` covers a signed-out visitor, a tenant on a hand-set plan, and a host with no such route —
 * and the page renders the same catalog in all three cases, with nothing marked as current.
 */
export async function fetchCurrentTier(): Promise<string | null> {
  return currentTierFrom(await readJson("/api/v1/billing/plans"));
}

/** This account's plan, or `null` when it could not be read. */
export async function fetchAccountPlan(): Promise<AccountPlan | null> {
  return parseAccountPlan(await readJson("/api/v1/billing/plan"));
}

/**
 * Whether this deployment has a checkout to send a buyer to.
 *
 * A POST, because that is the route's method; it raises nothing and writes nothing — it hands back
 * where a purchase would happen (`packages/host/src/handlers/billing.ts:218`). It 404s off server
 * mode, which reads as "no checkout", which is exactly true.
 */
export async function fetchCheckoutOffer(): Promise<CheckoutOffer> {
  return parseCheckoutOffer(await readJson("/api/v1/billing/top-up", { method: "POST" }));
}

const LOCALE_TAGS: Record<AppLocale, string> = { en: "en-US", id: "id-ID" };

/**
 * The end of the current billing period as a date, or `null` when there is no usable number.
 *
 * Formatted in **UTC** because the period itself is UTC by construction (`calendarMonthPeriod` in
 * `packages/core/src/entitlement/types.ts:151`): rendering midnight UTC in the browser's zone would
 * show the previous day to everyone west of Greenwich and disagree with the host's own boundary.
 */
export function formatPeriodEnd(ms: number | null | undefined, locale: AppLocale): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  const options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeZone: "UTC" };
  try {
    return new Intl.DateTimeFormat(LOCALE_TAGS[locale] ?? LOCALE_TAGS.en, options).format(new Date(ms));
  } catch {
    return new Intl.DateTimeFormat(LOCALE_TAGS.en, options).format(new Date(ms));
  }
}
