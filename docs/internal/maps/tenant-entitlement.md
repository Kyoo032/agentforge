# Map — Tenant entitlement: the allowance, the seat cap and the billing webhook

Last verified: 2026-09-21 at 4938747 + working tree. Eight citations had drifted since 2026-09-20
and were re-anchored by hand; the tier-label and plan-refusal sections were rewritten again after
the fix pass of the same day.

## Overview

What a tenant is entitled to, and the refusal when it is not. Phase 5 lane B
([`../web-phase5-lane-b.md`](../web-phase5-lane-b.md); spec
[`../web-phase5-plans-billing-decisions.md`](../web-phase5-plans-billing-decisions.md)).

Lane A gave every gateway call a tenant-scoped, priced row in `tenant_usage`
([`tenant-usage-ledger.md`](tenant-usage-ledger.md)); it records and refuses nothing. This page is
the half that refuses: a plan row per tenant, a spend counter maintained beside the ledger, a hard
block at the allowance with a warning at 80 per cent, a seat cap enforced at sign-in, and a
provider-neutral webhook that is the only writer of a plan's `status`.

It is **hosted only**, by construction rather than by configuration: every entry point returns
before it asks for a database connection when `isServerMode()` is false. A desktop install never
reads a plan and cannot be blocked by one. What this page is **not**: the account and plan screen,
and the adapter from a specific payment provider's payload and signature — those are the lanes that
follow, and the seams they plug into are named in Gotchas.

## How it works

**The vocabulary is pure and lives in core.** `packages/core/src/entitlement/types.ts` holds the
plan kinds (`PLAN_KINDS`, `:24`), the statuses (`PLAN_STATUSES`, `:36`), the refusal codes
(`ENTITLEMENT_BLOCKS`, `:54`), the non-refusals (`ENTITLEMENT_WARNINGS`, `:70`) and every rule as a
function of its arguments — no clock, no database. That is what lets "99 per cent passes, 101 per
cent is refused" be a unit test rather than an integration one.

**Two numbers that never become one.** `allowance_usd_micros` and `spent_usd_micros` are USD of
**gateway cost**, the same unit the ledger records, because the allowance is compared against the
ledger (decision doc D2). `margin_multiple_micros` is what a subscription *charges* for that cost;
it is carried per tenant so kyo can change it without a migration, and it takes no part in the
block decision — `quotedPriceUsdMicros` (`packages/core/src/entitlement/types.ts:268`) is the only
thing that reads it, and nothing in the enforcement path calls it.

**The period is the calendar month, in UTC.** `calendarMonthPeriod`
(`packages/core/src/entitlement/types.ts:151-168`), rolled by
`rolledPlan` (`packages/core/src/entitlement/types.ts:170-180`). A roll resets the spend
and the unpriced count and nothing else: the allowance, the seat cap, the margin and the status
belong to the subscription, not to the month. `rolledPlan` is pure and idempotent, so a read path
can roll a record in memory and answer correctly even when the write that makes it durable loses a
race.

**The block rule, in order.** `entitlementBlock` (`packages/core/src/entitlement/types.ts:186`):
`cancelled` → `plan_cancelled`; `past_due` → `plan_past_due`; spend at or past the allowance →
`plan_allowance_exhausted`. A tenant that is both past due and over its allowance is told about the
payment, because paying is what unblocks it. `resolveEntitlement` (`:205`) adds the live seat count
and the warnings: `allowance_low` at `WARN_AT_FRACTION` (`:79`, 0.8) and `unpriced_usage` whenever
this period holds calls nobody could price.

**Enforcement is one line inside the gateway gate.** `requireGatewayAllowed`
(`packages/host/src/gateway-gate.ts:476-483`) calls `requireEntitlementAllowed`
(`packages/host/src/entitlement-store.ts:459-480`) before it derives the gate. Every gateway call
site gained the allowance without one of them changing, and none of them gained an `await`:
`better-sqlite3` is synchronous, so the entitlement read costs no asynchrony (decision doc §3(a)).
The refusal is a `PlanBlockedError` (`packages/host/src/entitlement-store.ts:418`) — a flat 403 in
the same shape `jsonError` and the renderer's parser already handle, carrying a `plan_*` code and
**never** `gateway_blocked`, which routes the renderer to the paste-your-key onboarding screen.

**The plan is checked before the key.** Both are refusals; only one is actionable. A hosted tenant
that is past due or out of allowance holds no gateway key of its own, so `needs_key` would send it
to a screen whose only exits are a key, a re-check, or deleting a file on the server's disk
(decision doc §3(b)).

**Spend accrues on the ledger write.** `recordUsage` (`packages/host/src/tenant-usage.ts:300`)
calls `accrueSpend` (`packages/host/src/entitlement-store.ts:275`) in the same request, before the
row is written, and stamps the period it returns onto `tenant_usage.billing_period_start`. The
counter is maintained on write rather than re-summed per gateway call, because a `SUM` on the
request path is a scan of an append-only table at every call. An unpriced call adds **zero** to the
spend and one to `unpriced_count`: a tenant is never blocked by a row the host could not price, and
never silently undercounted either. The update is a SQL `UPDATE … SET x = x + ?`, not a
read-modify-write, so two concurrent generations both land.

**Seats are held until an admin revokes them** (decision doc D5(b)), never freed by going idle and
never derived from `auth_sessions`. `claimSeat` (`packages/host/src/entitlement-store.ts:217`) runs
at sign-in, from `handleLogin` (`packages/host/src/auth/routes.ts:407`, at the call
`packages/host/src/auth/routes.ts:382`) through the injected
`claimSeat` dependency (`packages/host/src/auth/routes.ts:94`, wired at
`packages/host/src/auth/index.ts:145-155`), **after** provisioning, because the seat row has a
foreign key to the tenant that provisioning writes. `seatAdmission`
(`packages/core/src/entitlement/types.ts:246`) is the rule: somebody who already holds a seat is
always admitted, so lowering a cap stops the next person rather than signing the company out; a
null cap admits everybody. A refusal is `seat_cap_reached`, the code the host has carried in both
languages since Phase 2.

**The webhook is provider-neutral.** D4 turns on kyo's selling entity, so
`packages/core/src/entitlement/webhook.ts` defines the event shape a provider's payload is
translated *into* (`BILLING_EVENT_KINDS`, `:47`), how it is read (`parseBillingEvent`, `:115`), what
it does to a plan row (`applyBillingEvent`, `:189`) and when it must be ignored
(`billingEventDecision`, `:224` — `duplicate` on an event id already **applied**, `stale` when the
event is older than the newest delivery this host has applied for the tenant).
`handlePostBillingWebhook` (`packages/host/src/handlers/billing.ts:60`) is the route: authenticate,
parse, decide, apply, and record the delivery in `billing_events` **either way**.

**The ordering bar is `lastAppliedEventAt`, never `tenant_plan.updated_at`** — the trap this route
fell into once and the thing to check first if a provider reports deliveries vanishing.
`accrueSpend` bumps `updated_at` on every ledger write and the persisted period roll bumps it
again, so comparing against it makes any tenant that is generating look newer than the provider,
and every top-up and seat-cap raise arrives `stale` forever. Only a webhook can date a webhook.
Because `applied = 1` is the filter, a delivery refused as `stale` or `unknown_tenant` never raises
the bar for the ones after it — which is also what lets a retry land a plan sold before the
tenant's first sign-in. Every authenticated, parseable delivery answers 200 — a non-2xx to a webhook means "retry",
and retrying a delivery the host has deliberately refused ends with the provider retiring the event.

**Three exemptions, because no browser calls it** (decision doc §3(c)): the session gate
(`UNGATED_POSTS`, `packages/host/src/auth/routes.ts:69`, read by `isSessionExemptPath` at `:151-157`),
the CSRF and Origin rule (`CSRF_EXEMPT_PATHS`, `packages/host/src/http-adapter.ts:680`, applied at
`:482`), and in their place a shared secret compared in constant time (`verifyBillingRequest`,
`packages/host/src/billing/authenticate.ts:47`). Each exemption is a single literal path, never a
prefix. A deployment with no secret configured refuses every delivery rather than accepting any.

**Three routes stay open to a blocked tenant.** `GET /api/v1/billing/plan`, `POST
/api/v1/billing/top-up` and — since Phase 9 lane F — `GET /api/v1/billing/plans`
(`handleGetBillingPlans`, `packages/host/src/handlers/billing.ts:204`, routed at
`packages/host/src/router.ts:292`) are session-gated and deliberately not behind the gateway gate:
a tenant that cannot see why it is blocked, what it could buy, or how to pay, is a churned tenant.

**Phase 9 lane F: the catalog, and the tier label.** `/billing/plans` answers
`{ currency, tiers, current }` — the frozen `PLAN_TIERS` from `@agentforge/core/plans` plus the
one thing an import cannot answer, which tier *this* tenant is on. Off server mode it answers the
same catalog with `current: null`, so a desk can render the pricing page without branching on the
deployment. `/billing/plan` gained `tierId` the same way. **No token field on either route** —
nobody is metered against a token budget (owner, 2026-09-21), and both tiers leave
`allowance_usd_micros` null.

**The label reads the stored row; enforcement reads the default.** Both `tierId` and `current` come
from `storedTierId` (`packages/host/src/handlers/billing.ts:146-162`): `findPlanRecord`, which is
`null` when the tenant has no `tenant_plan` row, and `matchTier` on that row's `kind` and `seatCap`
only when there is one. Enforcement is untouched and still reads `currentPlanRecord`, which fills in
`defaultPlanRecord` and rolls the period so that a missing row fails **open**
(`packages/host/src/entitlement-store.ts:154-186`).

Conflating the two was a bug fixed on 2026-09-21. Labelling from `currentPlanRecord` described a
tenant with no row by the fail-open default — personal, `seatCap: null`, `active` — which is
byte-for-byte the Personal tier, so `matchTier` named it: `tierId: "personal"`, Settings showing
"Personal / Active", and `/pricing` replacing the Personal call to action with "This is your plan"
for tenants nobody had sold anything to. `matchTier` itself is unchanged and still pure — it is a
lookup on two columns and cannot tell where they came from, which is exactly why the caller must
(`packages/core/src/plans/catalog.ts:148-183`). A hand-set cap still matches nothing and is still
`null`, and the plan panel renders `account-plan-none` ("no plan on this account yet", plus the
link to `/pricing`) for either kind of `null`.

### Phase 9 lane G: the three renderer surfaces

Until this round the entitlement backend had **no reader**. A past-due tenant's job answered
`request_failed` / "Request failed" — a dead end with no code to branch on and nothing to read.

**`/pricing`** (`apps/web/components/pricing-page.tsx`) renders `PLAN_TIERS` directly from
`@agentforge/core/plans`, so it needs no session, no key and no network. It is one of the three
public routes in `apps/web/src/App.tsx`, which is why a `seat_cap_reached` refusal can send somebody
there while they are signed out by definition. Testids: `pricing-page`, `pricing-placeholder`, and
per tier `pricing-tier-<id>`, `pricing-price-<id>`, `pricing-seats-<id>`, `pricing-features-<id>`,
`pricing-cta-<id>`, plus `pricing-contact-help` when no checkout is configured. The call to action is
one of exactly three real things and never a dead fourth — an operator checkout link, a plain
statement for the tier the tenant is already on, or a control that says who to ask.

**The plan panel** (`apps/web/components/account-plan-panel.tsx`) sits on Settings, gated on
`capabilities.plans`, and renders nothing of substance on a desk. Testids: `account-plan`,
`account-plan-tier`, `account-plan-status`, `account-plan-seats`, `account-plan-period`,
`account-plan-warnings`.

**The blocked screens** (`apps/web/components/plan-blocked-screen.tsx`) are put up by
`PlanBlockBoundary` in `App.tsx`, wrapping both the loading and the onboarding branches — so a
past-due tenant is **never** routed to the paste-your-key screen. Four codes:
`plan_past_due`, `plan_cancelled`, `plan_allowance_exhausted` (403) and `plan_unavailable` (503),
the last of which is a **retry, not a paywall**. Testids: `plan-blocked`, `plan-blocked-plans`,
`plan-blocked-checkout`, `plan-blocked-retry`, `plan-blocked-contact`.

**The flat-error seam, and where it is read.** Plan refusals are flat — `{ error: "<code>", message }`
— while nearly every other route answers the envelope `{ error: { code, message } }`. Two readers,
with different jobs:

- **Every response**, in the shared path. `notePlanResponse` (`apps/web/lib/plan-block.ts`) is
  called from `apiFetch` beside `noteApiResponse` (`apps/web/lib/api-client.ts:174-181`). It does
  nothing off `403`/`503`; on those two it reads a **clone**, so the caller's body is untouched, and
  announces the code in either shape — flat, or an envelope carrying a plan code, which at that
  status is a plan refusal by any reading. Until 2026-09-21 the only caller of `reportPlanBlocked`
  was the job stream, so the same blocked tenant got the full-screen explanation for a job and an
  ordinary red banner for a chat send, a settings save or a music generate.
- **The job stream**, for the message. `errorFromJson` (`apps/web/lib/job-stream.ts:47-63`) still
  calls `reportPlanBlocked` before narrowing, which is what gives a blocked job a readable message
  instead of "Request failed".

`gateway_blocked` is deliberately left alone in both: it is the other flat code, it has its own
parser and its own screen, and a paywall in front of it would be a door that cannot open.
`session_required` belongs to `session-signal.ts` and raises nothing here.

**A local-only preview door.** `?preview=<code>` on `/pricing` renders a blocked screen, and
`previewCode` (`apps/web/components/pricing-page.tsx:34-40`) refuses unless the ping says plans are
not enforced and there is a single owner — so an unanswered ping refuses it rather than opening it
([SR-35](../security-register.md#sr-35)).

**One disagreement, unresolved on purpose.** Personal's `seatCap` is `null`, which `seatAdmission`
reads as "no cap configured" and admits everybody, while `pricing-seats-personal` renders
`plans.seats.uncapped` — **"One seat"**. Copy and behaviour contradict each other and it is an open
owner decision: [SR-22](../security-register.md#sr-22).

Where to press: [`features/plans.md`](../../../.cursor/skills/verify-agentforge/features/plans.md).

## Where things live

| File | Role |
|---|---|
| `packages/core/src/entitlement/types.ts` | The vocabulary and every rule: period math, the block order, warnings, seat admission, the margin, the default plan |
| `packages/core/src/entitlement/webhook.ts` | The provider-neutral event: its shape, how it is read, what it changes, and when it is ignored |
| `packages/host/src/entitlement-store.ts` | The IO: the plan row, the seats, the spend counter, the idempotency record, and `requireEntitlementAllowed` |
| `packages/host/src/entitlement-db.ts` | The three lines that hand the store a connection; imported by `router.ts` |
| `packages/host/src/billing/authenticate.ts` | Who may write a plan: the header, the env var, the constant-time compare |
| `packages/host/src/handlers/billing.ts` | The webhook, the plan read and the top-up stub |
| `packages/db/drizzle/0017_tenant_plan.sql` | `tenant_plan`, `tenant_seat`, `billing_events`, and the period stamp on the ledger |
| `packages/db/src/schema.ts:192` | `tenantPlan`; `tenantSeat` at `:160`, `billingEvents` at `:188`, `billingPeriodStart` at `:83` |
| `packages/db/src/ensure-schema.ts:519` | `ensureTenantPlanTables`, the healer for a baseline-stamped database; the ledger's late column at `:499` |
| `packages/host/src/gateway-gate.ts:476` | `requireGatewayAllowed` — where the plan check sits, before the key check |
| `packages/host/src/auth/routes.ts:407` | `handleLogin` — where the seat cap sits, after provisioning (the `claimSeat` call is at `:382`) |

## Gotchas

- **No row is a plan, not a missing one.** `defaultPlanRecord`
  (`packages/core/src/entitlement/types.ts:281-295`) gives a tenant with no plan row an active,
  uncapped, unmetered plan, and the migration seeds none. That is what makes a desktop database and
  a hosted database the webhook has never spoken to behave exactly as they did before Phase 5. A
  default that blocked would turn "the provider has not called yet" into an outage for every tenant
  at once. Reading a plan does **not** write one.
- **The desk exemption is structural.** `resolveTenantEntitlement`, `requireEntitlementAllowed` and
  `accrueSpend` each return before `requireSql()`. If any of them ever reached for the connection
  off server mode, the desktop would throw `entitlement_backend_missing` rather than pass — which is
  exactly what the "desk is exempt by construction" block in `entitlement.test.ts` drives.
- **A hosted process with no backend installed refuses rather than allows.** `router.ts:10` imports
  `entitlement-db.ts`; without it `requireSql` throws a 500. That is deliberate: a gateway call
  served against a plan nobody can read is worse than a refused one.
- **`spent_usd_micros` is gateway cost, never the quoted price.** Multiplying the counter by the
  margin would put a rounding error between the ledger and the counter for no gain. The audit is
  `SELECT SUM(cost_usd_micros) FROM tenant_usage WHERE tenant_id = ? AND billing_period_start = ?`
  and it is meant to be an exact equality.
- **The allowance is enforced before a call and measured after it**, so one expensive run can
  overshoot — the plan's own stated risk. `remainingUsdMicros` floors at zero rather than reporting
  negative money, and the *next* call is refused. Under D1(b) (an operator-minted token per tenant)
  the gateway's own quota is what would make this exact; the host's number will always trail it.
- **A webhook never writes the counters.** A provider cannot know what a tenant spent, and a
  replayed delivery that could un-spend a month is the failure `applyBillingEvent` refuses by
  construction. Only a period roll resets them.
- **`billing_events.tenant_id` carries no foreign key, on purpose.** An event can arrive for a
  tenant nobody has signed in as yet; refusing it on a foreign key would make the route
  un-replayable, because the provider retires the event and the plan never lands. It is stored with
  `applied` false and `detail` `unknown_tenant` instead.
- **The top-up route raises nothing.** It hands back where the purchase happens; the allowance moves
  when the provider's `allowance.topup` event comes back through the webhook. `AGENTFORGE_BILLING_TOPUP_URL`
  is the operator's escape hatch until a provider is chosen.
- **A shared secret is not a signature.** Paddle and Stripe verify an HMAC over the **raw** body,
  which needs a raw-body path through `readBody` that this lane does not build; Xendit
  authenticates on exactly the header shape shipped here. `verifyBillingRequest` is the seam the
  provider adapter replaces.
- **The `plan_*` codes have no renderer branch yet.** The host answers them; the account and plan
  screen that turns them into something a user can act on is the next lane, and until it exists a
  blocked tenant sees a generic 403 body.
- **Migration 0017's `when` is above 0018's** (1788820000011 against 1788820000010) and its journal
  entry sits **last** in the array. The runner is forward-only on `when`, not on `idx`, so a lower
  value would be silently skipped on every database that has already run 0018 — and the ALTER on
  the ledger with it. `packages/db/src/migrate-0017.test.ts` drives that case rather than asserting
  the comment.

## Verify

No `verify-agentforge` feature file yet: nothing here is on screen. The account and plan screen is
the lane that earns one, and it is where `features/gateway-gate.md` will need a second refusal path
described. The proofs are the suite:

- `packages/core/src/entitlement/types.test.ts` — the period math including the December roll and
  the month boundary to the millisecond; 99 vs 101 per cent and the exact-100 boundary; the block
  order; the 80 per cent warning and its absence at 79; unpriced as a warning and not a block; seat
  admission including a cap lowered under the people already inside; the margin proved not to move
  the block.
- `packages/core/src/entitlement/webhook.test.ts` — both field spellings; the refusals that protect
  idempotency; an explicit `null` allowance surviving the parse; the counters never written from an
  event; duplicate and stale decisions, including a same-millisecond delivery that must still apply.
- `packages/db/src/migrate-0017.test.ts` — the three tables and the ledger's new column on a fresh
  database, on one baseline-stamped past 0017, and on one that stopped at 0016; the cascade; the
  absent foreign key on `billing_events`; the `when` ordering and the journal's array position; the
  skip hazard driven against a database stamped at 0018's own `when`.
- `packages/host/src/entitlement.test.ts` — the whole store against a real database: the default
  plan, the block and its recovery by webhook, by status flip and by period roll; spend accruing
  with the ledger and reconciling against it; seats claimed, refused, revoked and re-seated; the
  gate carrying the plan check; and the desk block, which runs with no connection registered at all.
- `packages/host/src/handlers/billing.test.ts` — the routes through `dispatch` on a real database:
  the session-gate exemption and its narrowness, a wrong secret changing nothing, an unconfigured
  deployment refusing everything, duplicate and stale deliveries, an event for an unknown tenant
  recorded rather than dropped, and a blocked tenant reading its own plan and topping up.
