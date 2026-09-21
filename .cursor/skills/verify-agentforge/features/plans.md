# Plans and pricing

Three surfaces over one placeholder catalog: the public `/pricing` page, the plan panel on Settings, and the blocked screens a refused tenant lands on. **Every price, tier name and seat number is a placeholder** — `packages/core/src/plans/catalog.ts` marks each tier `placeholder: true` and the page says so out loud — so nothing here may be quoted to anybody, and a number that looks wrong is a number nobody has set yet, not a bug. Prices come from an **imported** catalog, so `/pricing` renders in every mode, on a desk, and before anyone signs in. Full mechanism: [`maps/tenant-entitlement.md`](../../../../docs/internal/maps/tenant-entitlement.md). Sign-in itself is [login.md](./login.md).

## Sub-features

- **plans-page** — `/pricing` renders `pricing-page`, `pricing-placeholder` (the "Indicative pricing — not final." note, `role="note"`), and one card per tier: `pricing-tier-personal` / `pricing-tier-enterprise`, each with `pricing-price-<id>`, `pricing-seats-<id>`, `pricing-features-<id>` and `pricing-cta-<id>`.
- **plans-cta** — the call to action is one of exactly three real things, never a dead fourth: a link to the operator's checkout when `AGENTFORGE_BILLING_TOPUP_URL` is set, a plain statement when the tenant is already on that tier, or a control that says who to ask. When there is no checkout, `pricing-contact-help` explains that there is no self-serve purchase yet.
- **plans-panel** — `account-plan` on Settings, gated on `capabilities.plans`: `account-plan-tier`, `account-plan-status` (Active / Payment overdue / Cancelled), `account-plan-seats` ("{used} of {cap} seats in use"), `account-plan-period`, `account-plan-warnings`.
- **plans-blocked** — `plan-blocked` is the whole-app screen for `plan_past_due`, `plan_cancelled`, `plan_allowance_exhausted` and `plan_unavailable`, with `plan-blocked-plans`, `plan-blocked-checkout`, `plan-blocked-retry` and `plan-blocked-contact`. It is **never** the onboarding screen: a past-due tenant must not be asked to paste a gateway key.
- **plans-unavailable** — `plan_unavailable` is a `503` and a **retry**, not a paywall. Its screen offers `plan-blocked-retry` and says the server could not read the plan, not that anything is owed.
- **plans-route** — `GET /api/v1/billing/plans` → `{ currency, tiers, current }`, session-gated and **not** behind the gateway gate, so a closed gate still shows prices.
- **plans-locale** — the whole `plans` namespace exists in `en` and `id`, held aligned by `apps/web/lib/plans-locale.test.ts`.

## How to get to it (user POV)

- `/pricing` directly, on any build, signed in or not. There is no rail entry: the page is reached from a blocked screen's `plan-blocked-plans`, from `account-plan`'s "See plans", and from a link.
- Rail → Settings, below the sign-in row, is `account-plan` — on a hosted deployment. On a desk the panel renders "Plans are not enforced on this installation." or nothing at all, and that is the pass.
- A blocked screen arrives on its own, replacing the app, when the host refuses a call with a plan code.

## Driving it with the DPSBuddy harness

**Preconditions.**

- Doctor exits 0. `/pricing` works on `:3000`; everything else on this page needs the **review instance** in server mode with a signed-in tenant ([login.md](./login.md)).
- Never simulate a plan state on the operator's `:3000` desk. The webhook writes `tenant_plan`.

**On any desk, no key, no session.**

- **The page.** `goto /pricing`, settle. `pricing-page` is visible. `pricing-placeholder` is visible — **if it is missing, the owner has cleared `placeholder: true` and the numbers are now real**, which is news for `docs/internal/unreleased.md`, not a pass. Two cards: `pricing-tier-personal` and `pricing-tier-enterprise`.
- **Seats line.** `pricing-seats-personal` reads "One seat" and `pricing-seats-enterprise` reads "Up to 20 seats". **Personal's copy and its behaviour disagree on purpose-not-yet-decided** — `seatCap: null` admits everybody. See the gotcha; record it, do not fix it.
- **No dead button.** With no checkout configured, `pricing-cta-<id>` is a control that asks rather than a greyed-out "Buy", and `pricing-contact-help` is visible. Press it; `pricing-contact-help` gains `role="status"`. Nothing is posted.
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), the strings come from `apps/web/locales/id/plans.json` and the price formats as `Rp 299.000` rather than `IDR 299,000`. Testids do not move.
- **Blocked screens, without a webhook.** On a **local** build only, `goto /pricing?preview=plan_past_due` renders `plan-blocked` with the past-due copy. Walk all four codes: `plan_past_due`, `plan_cancelled`, `plan_allowance_exhausted`, `plan_unavailable`. The last one must offer `plan-blocked-retry` and must not read as a payment problem. **This door is local-only by construction** — it is refused where the host says plans are enforced, and refused when the ping has not answered ([SR-35](../../../../docs/internal/security-register.md#sr-35)) — so do not expect it to work on the review instance.

**On the review instance, signed in.**

- **The panel.** Settings → `account-plan` is visible with `account-plan-tier`, `account-plan-status` and `account-plan-seats`. A tenant whose stored plan matches no catalog row shows "Custom plan" rather than guessing — `matchTier` needs the kind **and** an exact seat cap.
- **Simulating a state.** `POST /api/v1/billing/webhook` with the `x-callback-token` header, a **fresh `event_id` each time** (deliveries are idempotent on it and `applied = 1` is terminal), against a tenant that has signed in at least once. `entitlement.set` with `{kind,status,allowance_usd_micros,seat_cap,currency}` moves the plan; `status: past_due` or `cancelled` puts the blocked screen up; `seat_cap: 1` plus a second seeded user produces `seat_cap_reached` **on the sign-in screen**; `allowance.topup` with `top_up_usd_micros` raises the allowance. The route is the only writer of `tenant_plan.status`, so this is also the only way to reach these screens honestly.
- **Reload after a webhook.** The panel and the blocked boundary read at boot; they do not poll.
- Evidence under `evidence/plans/<run-id>/`: the pricing page in both locales, the plan panel, and one blocked screen per code.

**Automated proof already in the repo.** `packages/core/src/plans/catalog.test.ts` (23 — the shape, the frozen tables, `matchTier`'s refusal to guess, price formatting), `apps/web/lib/pricing-page-render.test.tsx` (15), `plans-api.test.ts` (24), `plan-block.test.ts` (10), `plan-blocked-render.test.tsx` (8), `account-plan-render.test.tsx` (10), `plans-locale.test.ts` (3), `packages/host/src/handlers/billing.test.ts` (34). All green on 2026-09-21.

## Gotchas

- **"One seat" is not enforced.** Personal renders `plans.seats.uncapped` — "One seat" — while `seatCap: null` means "no cap configured", which admits everybody. Both halves are deliberate and they contradict each other; it is an open owner decision, [SR-22](../../../../docs/internal/security-register.md#sr-22). A recipe that signs a second user into a Personal tenant and expects a refusal is asserting copy, not behaviour.
- **There is no token allowance, anywhere.** The owner ruled it out on 2026-09-21: tiers leave `allowance_usd_micros` null, the catalog has no `tokenAllowance`, there is no allowance bar, and the usage panel shows seats and plan status only. The `plan_allowance_exhausted` screen still exists because the host can still send that code — do not read its presence as evidence of a meter.
- **A plan refusal is flat, not enveloped.** Nearly every route answers `{ error: { code, message } }`; the plan codes answer `{ error: "<code>", message }` at 403 (or 503 for `plan_unavailable`). `errorFromJson` in `apps/web/lib/job-stream.ts` reads the flat shape **only** for plan codes. Before that, a past-due tenant's job came out as "Request failed" with nothing to branch on. If you see that string again, this is where it regressed.
- **`plan_unavailable` is not a paywall.** It is the server failing to read the plan. A recipe that treats it as "blocked" will send somebody to a checkout for a transient read error.
- **Prices need no network.** `/pricing` imports the catalog, so it renders with the gateway gate closed, with no session and with the host unreachable. A blank page there is a renderer fault, never a backend one.
- **`GET /api/v1/billing/plans` is session-gated but not gateway-gated**, deliberately: a tenant whose key is rejected must still be able to see what they are paying for.
- **A visited page stays mounted** — harness-wide gotcha **G3**. After `/settings` → `/pricing`, `settings-form` is still in the DOM. Assert `isVisible()`, never `count()`.
- **The checkout URL is whatever the operator set**, unvalidated today ([SR-31](../../../../docs/internal/security-register.md#sr-31)). If `plan-blocked-checkout` leads somewhere odd on a review instance, check `AGENTFORGE_BILLING_TOPUP_URL` before blaming the renderer.
