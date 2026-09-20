# Phase 5 lane B — entitlement, the allowance block and the seat cap

Written 2026-09-20, alongside the branch `feat/web-phase5-lane-b-entitlement-dmqhyr`, from `main`
at `3724e2d` (Phase 4 merged as `aec91dc`).
Spec: [`web-phase5-plans-billing-decisions.md`](web-phase5-plans-billing-decisions.md) §2 and §3.
Lane A, the ledger this reads: [`web-phase5-lane-a.md`](web-phase5-lane-a.md).
Code map: [`maps/tenant-entitlement.md`](maps/tenant-entitlement.md).

Lane A made every gateway call leave a priced, tenant-scoped row and deliberately refused nothing.
Lane B is the refusal. A hosted tenant now has a plan, an allowance it can exhaust, a seat cap it
can hit, and a provider-neutral webhook that raises either one back up. **The desk — the local
tenant, every desktop and every webdev — is exempt by construction and never opens a database for
any of it.**

---

## 1. What this lane had to decide before it could build

Five of kyo's answers were still open when this lane started. The coordinator took the recommended
default for each so the lane could ship; **each one is a value in a column or a constant, not a
shape, so changing kyo's mind later is an `UPDATE` or a one-line edit, never a migration.** Where
to change each is the last column.

| # | Question | Default taken | Where kyo changes it |
|---|---|---|---|
| D4 | Quote currency | **USD.** The ledger is USD micros already, so anything else needs an FX rate nobody has sourced | `tenant_plan.currency`, per tenant. `DEFAULT_QUOTE_CURRENCY` in `packages/core/src/entitlement/types.ts:82` is only the default for a row nobody has written |
| D4 | Margin multiple | **1.0, pass-through.** Charge exactly gateway cost until kyo picks a number | `tenant_plan.margin_multiple_micros`, per tenant. `1_500_000` is 1.5×. `PASS_THROUGH_MARGIN_MICROS` (`types.ts:79`) is the default for an unwritten row |
| D3 | Monthly vs anniversary reset | **Calendar month, UTC.** It needs no provider event to roll, so a deployment whose webhook has never fired still rolls correctly | `calendarMonthPeriod` (`types.ts:151-159`) is the default period. An anniversary window can be **set** without a code change — `period.reset`, or an `entitlement.set` carrying `periodStart`/`periodEnd` — but it does not survive its own end: `rolledPlan` (`types.ts:174`) rolls into the **calendar** month whenever `now >= periodEnd`, so an anniversary period snaps back unless the provider fires `period.reset` before each window closes. Making anniversary self-sustaining is a change in `rolledPlan` (§9) |
| open | Does an unpriced usage row count against the allowance? | **Zero against the allowance, surfaced as a warning count.** Blocking on a row nobody could price refuses a call the tenant cannot see the cost of; hiding it loses the signal | `tenant_plan.unpriced_count` is maintained either way. The `unpriced_usage` warning is in `ENTITLEMENT_WARNINGS` (`types.ts:70`). Making it count would be a change in `accrueSpend`, one statement |
| D4 | Billing provider (Xendit / Paddle / Stripe) | **Left abstract.** This lane defines the entitlement record and a provider-neutral inbound contract; the Xendit or Paddle adapter is a later lane | Nothing here to change. The adapter translates a provider's payload into one of three `BILLING_EVENT_KINDS` and POSTs it, or calls `parseBillingEvent` directly |

Two decisions were **not** defaults — they are in the decision doc and were followed as written:

- **D5(b): a seat is held until an admin revokes it.** Seats are never derived from `auth_sessions`.
  Signing out does not free a seat; that is the point, or a company of ten buys three seats and
  rotates them.
- **§3(b): a plan refusal is not `gateway_blocked`.** See §4 below — this is the one that would have
  been a support incident.

## 2. The schema — migration `0017`

`packages/db/drizzle/0017_tenant_plan.sql`, journalled at `when = 1788820000011`.

> **The `when` hazard, and why that number.** The migration runner is forward-only and keyed on
> `when`, not on `idx` or filename. A `0017` stamped with a `when` below the largest one already
> applied is **silently skipped** — no error, no row, and a table that is simply not there at
> runtime. `packages/db/src/migrate-0018.test.ts` exists to assert exactly this, and the coordinator's
> brief reserved `0017` for this lane with a `when` above `1788820000010`. The journal entry is
> appended **last**, so array order and `when` order agree and neither reading is wrong.

Three new tables and one late column:

**`tenant_plan`** — one row per tenant, primary key `tenant_id`, `ON DELETE CASCADE` from `tenants`.
Columns: `kind`, `status`, `allowance_usd_micros` (nullable — `null` is "no allowance enforced"),
`spent_usd_micros`, `unpriced_count`, `period_start`, `period_end`, `seat_cap` (nullable),
`margin_multiple_micros`, `currency`, `updated_at`.

**`tenant_seat`** — composite primary key `(tenant_id, user_id)`, with `organization_id`,
`claimed_at` and a nullable `revoked_at`. A live seat is a row with `revoked_at IS NULL`, which
`tenant_seat_live_idx` serves. Revoking sets the timestamp rather than deleting, so "who held a seat
in March" survives a downgrade.

**`billing_events`** — primary key `event_id`, the **provider's** id, never generated host-side.
Carries `tenant_id`, `kind`, `occurred_at`, `received_at`, `outcome`. **No foreign key on
`tenant_id` on purpose:** a delivery naming a tenant this deployment does not have must still be
recorded as seen, or the provider retries it forever against a row that cannot exist.
`billing_events_tenant_idx` serves the per-tenant read.

**`tenant_usage.billing_period_start`**, plus `tenant_usage_period_idx` on
`(tenant_id, billing_period_start)`. Every ledger row now carries the period it was counted into,
which makes the audit an exact equality rather than a timestamp-range guess:

```sql
SELECT SUM(cost_usd_micros) FROM tenant_usage
 WHERE tenant_id = ? AND billing_period_start = ?;
-- must equal tenant_plan.spent_usd_micros for that tenant
```

The ALTER is preceded by a defensive `CREATE TABLE IF NOT EXISTS tenant_usage`. A database stamped
at a baseline that never ran `0016` would otherwise abort the whole migration transaction on an
`ALTER` against a table that is not there.

Every one of the four is mirrored in `ensure-schema.ts` — `ensureTenantPlanTables` (`:517`) and the
late column added inside `ensureTenantUsageTable` (`:499-503`) — because a baseline-stamped database
never runs the SQL file at all. That is the same belt-and-braces the tenancy tables have had since
Lane B of Phase 3.

## 3. The rules, with no database and no clock

`packages/core/src/entitlement/types.ts` holds the arithmetic; every function takes the time it
needs as an argument, so all of it is unit-tested with no SQLite at all. The split mirrors what
lane A did for metering.

**Two numbers that never become one.** `spent_usd_micros` and `allowance_usd_micros` are both USD
of **gateway cost** — the ledger's unit, because the allowance is compared against the ledger (D2
says so). `margin_multiple_micros` is what the subscription **charges** for that cost. It takes no
part in the block decision. Multiplying the counter by a margin would put a rounding error between
the ledger and the counter in exchange for nothing.

**Nothing derived is stored.** `block`, `warnings`, `usedFraction` and `remainingUsdMicros` are
computed by `resolveEntitlement` (`types.ts:205`) on each read. A persisted `blocked` column would be
a second source of truth that goes stale the moment anything writes the row without maintaining it.

**The period rolls on read.** `rolledPlan` (`types.ts:170-177`) returns a record with a fresh period
and zeroed counters when `now >= periodEnd`; `currentPlanRecord` persists that roll. So a deployment
that was asleep across a month boundary is correct on its first request back, with no cron, no
timer and no provider event.

**A tenant with no plan row behaves exactly as the product behaved before Phase 5 existed.**
`defaultPlanRecord` (`types.ts:281-295`) is `active`, allowance `null`, seat cap `null`,
pass-through margin. That is lane B's own done-when: a deployment the billing webhook has never
spoken to signs people in and runs generations exactly as it did yesterday. A default that blocked
would turn "the webhook has not fired yet" into a simultaneous outage for every tenant.

**Seat admission never evicts.** `seatAdmission` (`types.ts:246`) admits anyone who already holds a
seat, whatever the cap — a downgrade below the current headcount must not sign out the whole
company. It admits everybody when `seatCap` is `null`. Only a new claimant against a full cap is
refused.

## 4. Enforcement — one choke point, no new `await`

The allowance check lives **inside `requireGatewayAllowed`**
(`packages/host/src/gateway-gate.ts:475`), as its first statement, before the key gate:

```ts
export function requireGatewayAllowed(settings: StoredSecrets, opts: GatewayGateOptions = {}): GatewayGatePayload {
  requireEntitlementAllowed(tenantOf(opts));
  const gate = reportGatewayGate(settings, opts);
  ...
}
```

**Why there.** That function is already the single thing every gateway path calls, across chat,
jobs, edit, media, meetings and channels — directly, or through `requireGatewayAllowedFor`, which
is a one-line wrapper around it. Putting the check inside it covers every one of them with no
call-site change, which is decision doc §3(a) satisfied by construction rather than by a sweep
somebody has to keep green. `better-sqlite3` is synchronous, so the check adds no `await` to a
synchronous function and no call site had to change shape.

**Why first.** The order is the whole point of §3(b). A hosted tenant over its allowance holds no
gateway key of its own, and `gateway_blocked` routes the renderer to the paste-your-key onboarding
screen, whose only exits are a key, a re-check, or deleting a file on the server's disk — none of
which a Personal user has. So the plan refusal has to come out *first*, and it carries its own code:
`plan_past_due`, `plan_cancelled` or `plan_allowance_exhausted` (`ENTITLEMENT_BLOCKS`), a flat 403 in
the same shape `jsonError` and the renderer's parser already handle, which the renderer can branch on
to the account screen. Three tests assert **which** refusal comes out of a gate that could produce
either, which is a stronger claim than asserting a call was allowed.

**The desk is exempt before any connection is required.** Every entry point in
`entitlement-store.ts` returns `null` — or, for `requireEntitlementAllowed`, returns — *before*
`requireSql()`. The exemption is structural, not a flag someone can forget: with no connection
registered at all, the desk path still runs clean, and the test that proves it registers nothing.
In server mode the same `requireSql()` throws `entitlement_backend_missing` rather than admitting the
call, which is the fail-closed rule from Phase 3 lane C.

**Spend accrues on the ledger write.** `recordUsage` (`tenant-usage.ts:300`) calls `accrueSpend`
(`:311`) inside its existing `try`, and stamps the returned period onto the row it writes. One
`UPDATE … SET spent_usd_micros = spent_usd_micros + ?` — a read-modify-write would lose concurrent
generations. Off-request work (jobs, the edit runner, channels) already carries its tenant
explicitly since Phase 3 lane D, so nothing here reads an ambient session.

**The seat cap is checked at sign-in.** `handleLogin` (`auth/routes.ts:261`) provisions the tenant,
then claims a seat (`:290`) **before** `createSession`, and refuses with `seat_cap_reached`, 403.
Claiming is an idempotent upsert that clears `revoked_at`, so a returning user re-takes their own
seat and a re-claim never double-counts. The dependency is injected (`AuthRouteDeps.claimSeat`) and
wired in `auth/index.ts:145` behind a dynamic import, for the same reason `provision` is: the desktop
imports the router and never signs in, so `@agentforge/db` must not be pulled in statically.

## 5. The billing webhook, provider-neutral

`POST /api/v1/billing/webhook`, hosted only — **404 off server mode**, the same answer an
unregistered path gets, so a desk leaks nothing about a route it has no business answering.

**Authentication** is a shared secret in `AGENTFORGE_BILLING_WEBHOOK_SECRET`, presented in the
`x-callback-token` header and compared with `timingSafeEqual`. An unset secret is
`billing_not_configured`, 503 — a deployment nobody has pointed a provider at should say so, not
quietly accept everything or quietly accept nothing. A wrong token is 401 rather than 403: the caller
may retry with the right secret. The route is exempt from the session gate (`UNGATED_POSTS`,
`auth/routes.ts:56`) and from the CSRF rule (`CSRF_EXEMPT_PATHS`, `http-adapter.ts:616`) because no
browser calls it and it holds a bearer secret instead; the header is forwarded explicitly at
`http-adapter.ts:534`.

**Three event kinds**, because a provider's own vocabulary is the adapter's problem:

- `entitlement.set` — the whole statement of what a tenant is entitled to. Created, upgraded,
  downgraded, renewed, suspended and cancelled are all this one kind with different fields.
- `allowance.topup` — D3(c)'s self-serve top-up: raise this period's allowance without touching the
  subscription.
- `period.reset` — roll now. The calendar-month default needs no such event; it exists so an
  anniversary period is a provider call rather than a code change.

**Idempotent and replay-safe, as two separate rules.** `duplicate` is the provider retrying a
delivery that **already applied**, caught on the `billing_events` primary key — expected, healthy,
and the reason the route answers **200** to it. `stale` is a delivery that arrived out of order and
would undo a newer one.

**The ordering rule compares one webhook against another, and nothing else.** `stale` is decided by
comparing the event's `occurredAt` with `max(occurred_at)` over the deliveries this host has
**applied** for the tenant (`lastAppliedEventAt`), never with `tenant_plan.updated_at`. The first
version of this route used `updated_at`, and that was a real bug the verifier caught: `accrueSpend`
bumps that column on **every ledger write**, and so does the persisted period roll, so a provider's
timestamp — which always precedes its own delivery — read as older than the row for any tenant that
was still generating. The consequence was that a busy tenant could never receive a top-up, a
seat-cap raise or any `entitlement.set` again: the 80% self-serve path led nowhere for exactly the
tenants who needed it. Two route-level tests hold the line now, one for each direction: a top-up
whose timestamp precedes the tenant's last generation is **applied**, and a genuinely out-of-order
`past_due` is still **stale** even with a generation in between.

**A plan sold before the tenant's first sign-in is not lost.** The plan row has a foreign key to
`tenants`, so an event naming a tenant this host has never seen cannot be applied; it is stored
unapplied as `unknown_tenant`. The provider's next retry of that same id is then **reconsidered**
rather than dismissed as a duplicate, and applies the moment the tenant exists — `alreadySeen` means
"already applied", and the `billing_events` upsert promotes a row only from unapplied to applied.
What this does **not** do is replay on its own: the table deliberately stores no payload, so if the
provider has already retired the event, an operator must re-send it with a fresh id. That is the
choice taken here rather than adding a payload column and a replay path on the sign-in hot path
(§9).

**The route always answers 200 once it is authenticated and parseable**, with
`{received, outcome}` where outcome is `applied`, `duplicate`, `stale` or `unknown_tenant`. A
provider that gets a 4xx retries, and none of those four is fixed by retrying.

**An event never writes the counters.** `applyBillingEvent` sets plan, allowance, seat cap, period,
margin and currency; `spent_usd_micros` and `unpriced_count` belong to the ledger and to
`accrueSpend` alone.

Two companion routes, both session-gated and both **deliberately not** behind
`requireGatewayAllowed` — a tenant the plan has blocked must be able to read why and pay, or the
block is a dead end:

- `GET /api/v1/billing/plan` — the resolved entitlement, including the derived block and warnings.
- `POST /api/v1/billing/top-up` — the self-serve top-up **stub**. It raises nothing itself; it
  returns the operator's `AGENTFORGE_BILLING_TOPUP_URL` if one is set, which is the escape hatch
  until the provider adapter lands. The real path is: the tenant pays the provider, the provider
  POSTs `allowance.topup`, and the block lifts on the next request with no restart.

## 6. What did not change

- **No renderer work.** The account screen that would show the 80% warning and offer the top-up is
  not in this lane; the host tells the truth and the codes are there for it to branch on.
- **No provider adapter.** No Xendit, Paddle or Stripe code exists in the repo.
- **No change to what lane A meters.** The gaps lane A left open — edit-timeline worker jobs,
  Edit-captions ASR, Knowledge and Finance embeddings, media tools inside chat runs, aborted runs —
  are still unmetered, and are therefore still invisible to the allowance. That is the most
  significant open item this lane inherits and does not close.
- **No repricing pass.** An `unpriced` row stays unpriced; it is counted as zero and surfaced.
- **`tenant_usage`'s existing columns are untouched.** One nullable column was added; no backfill,
  so rows written before this migration carry `billing_period_start = NULL` and are outside every
  period equality above. That is correct — they were never counted into a plan.

## 7. How this was verified

Per kyo's rule for cloud threads: read and trace, write the tests, run what the cloud can run.

**Tests run for real**, with the xlsx install workaround from the handover file, which was then
reverted and confirmed absent from `git diff --name-only` before every commit:

| Package | Result |
|---|---|
| `@agentforge/core` | **2267 passed, 1 skipped** |
| `@agentforge/db` | **141 passed** |
| `@agentforge/host` | **2156 passed** |

`tsc --noEmit` clean on all three. `biome check --formatter-enabled=false --assist-enabled=false`
clean on every changed file.

**119 new tests**, in five files:

- `packages/core/src/entitlement/types.test.ts` (31) — the arithmetic: the 80% boundary from both
  sides, a `null` allowance never blocking, exhaustion at exactly 100%, the roll, seat admission
  including the downgrade-below-headcount case, and margin never touching the block.
- `packages/core/src/entitlement/webhook.test.ts` (22) — parsing both camel and snake payloads, an
  explicit `null` allowance surviving (it does not, with `??`; it does with the `in` operator), the
  duplicate and stale decisions, and an event never writing the counters.
- `packages/db/src/migrate-0017.test.ts` (19) — a fresh database, a database stopped at `0016`
  (rebuilt in its real `0016` shape, because a healer-first helper hid the failure), the healer path
  on a baseline stamp, and **a database stamped at `0018`'s exact `when`, which drives the skip
  hazard directly.**
- `packages/host/src/entitlement.test.ts` (29) — the store against a real in-memory SQLite: accrual
  under repeated writes, the idempotent re-claim, revoke-and-re-claim, **the desk running the whole
  path with no connection registered at all**, fail-closed in server mode, and three gate-integration
  tests asserting which of `plan_allowance_exhausted`, `gateway_blocked` and
  `entitlement_backend_missing` comes out.
- `packages/host/src/handlers/billing.test.ts` (18) — 404 off server mode, 503 unconfigured, 401 on a
  wrong token, 400 on an unparseable body, and each of the four outcomes at 200.

**Four existing assertions were updated rather than loosened**, each with a comment saying why:
`migrate-0016.test.ts` (ledger column list), `migrate-0015.test.ts` (the `tenant_id` carriers are now
`auth_sessions`, `billing_events`, `tenant_plan`, `tenant_seat`, `tenant_state`, `tenant_usage`),
`tenant-usage.test.ts` (column list), `auth/routes.test.ts` (harness gains `claimSeat`).

**Static sweep guards stayed green**: `tenant-state.test.ts`'s filename guard and
`provider-env-sweep.test.ts` both pass unchanged.

**CRLF endings** on `packages/core/src/index.ts`, `packages/host/src/handlers/jobs.ts` and
`handlers/settings.ts` were checked after touching `core/src/index.ts` and are intact.

**Maps.** New page `maps/tenant-entitlement.md`, stamped at `8dc684f`. `maps/settings-and-gateway-gate.md`
has its Enforcement section rewritten for the new ordering and the two new open routes. Roughly 45
other pages had citations re-anchored where this lane's insertions moved the lines they pointed at —
done by an old→new line map computed against `main`, **not** with `map-drift --write`, which
re-points citations onto import lines. `pnpm maps:check` reports **0 hard** findings (main's
baseline) and soft findings are back at main's 129, plus 2 on the new page: both are legitimate
call-site citations (a line that *calls* `rolledPlan` / `requireEntitlementAllowed` rather than
declaring it) that the checker's near-miss heuristic cannot distinguish.

**The verify-agentforge skill ran, against an isolated stub instance.** `:3000` did not answer in
this container, so the drive brought up its own webdev on `127.0.0.1:3117` with a throwaway
`AGENTFORGE_DATA_DIR`, `AGENTFORGE_RUNTIME=stub` and no gateway key, and stopped it afterwards by
its own PID.

- `node .cursor/skills/verify-agentforge/scripts/doctor.mjs --base http://127.0.0.1:3117` **exits 0**:
  `chatStatus: 200`, `runtime: "stub"`, `hasOpenai: false`, `gatewayName: "Toko Token"`. (`edit.ffmpeg`
  reports `found: false` — this container has no ffmpeg, and the skill says a missing edit endpoint or
  binary is a note, not a fail.)
- **A real chat send through the composer still works on the desk.** Playwright drove
  `composer-text` → `composer-send` on `/chat`: the message lands in `message-list`, `composer-send`
  returns to `Send`, `composer-error` count is **0**, and the reply is the ordinary
  "I need a Toko Token gateway key in Settings" — **no `plan_*` code, no `entitlement_backend_missing`
  and no `gateway_blocked` anywhere in the page.** That is the desk exemption proved on the running
  app rather than in a unit test: the entitlement check is in the path this send took, and it
  returned without a database.
- **The desk's answer on the three new routes**, by direct request against the same instance:
  `POST /api/v1/billing/webhook` → **404** `{"error":{"code":"not_found","message":"Not found"}}`;
  `GET /api/v1/billing/plan` → **200** `{"enforced":false}`; `GET /api/v1/settings` unchanged.

The doctor cannot reach the *server-mode* half of this lane — the allowance block, the seat cap and
an authenticated webhook all need `AGENTFORGE_SERVER=1`, a portal sign-in and a real gateway call.
That is exactly what §8 owes kyo's machine.

**Not run: GitHub Actions.** Every workflow run in this repository fails with no runner under the
account's billing lock. Noted once on the PR; only kyo can clear it, and it is not a failure of this
change.

## 8. Live tests still owed on kyo's machine

Nothing below can run in the cloud: the allowance path needs a real gateway call, and sign-in needs
the portal.

1. **Spend past 80%.** Set a small allowance on a tenant (`entitlement.set` through the webhook, or
   an `UPDATE tenant_plan`), generate until `GET /api/v1/billing/plan` reports the `allowance_low`
   warning, and confirm generations still go through.
2. **Spend past 100%.** Keep going. The next gateway call must refuse with
   `plan_allowance_exhausted` — **not** `gateway_blocked`, and the renderer must not land on the
   paste-your-key screen. Check `GET /api/v1/billing/plan` still answers while blocked.
3. **Recover on a webhook.** POST an `allowance.topup` with the `x-callback-token` header. The very
   next generation must succeed **with no restart**. Then POST the same delivery again and confirm
   the response is `{outcome: "duplicate"}` at 200 and the allowance did **not** rise twice.
4. **The top-up lands on a tenant that is still working** — the regression the verifier caught.
   Generate once, then deliver an `allowance.topup` whose `occurredAt` is a minute or two in the
   **past**, as a real provider's will be. It must answer `{outcome: "applied"}`, not `stale`. This
   is the one to run first: before the fix, every top-up to an active tenant was dropped silently.
5. **A plan sold before first sign-in.** Deliver an `entitlement.set` for a tenant nobody has signed
   in as; expect `{outcome: "unknown_tenant"}`. Sign in as that tenant, re-send the **same**
   `eventId`, and confirm it now answers `applied` and the plan is there.
6. **Recover on the period roll.** Move the row's `period_end` into the past and confirm the next
   request rolls the period, zeroes `spent_usd_micros` and lifts the block.
7. **A seat past the cap is refused.** Set `seat_cap = 1` on a tenant that has one live seat. A
   second person signing in must get `seat_cap_reached`, 403. The person who already holds the seat
   must keep signing in fine — sign them out and back in to prove it.
8. **Seat recovery, both ways.** Raise the cap by webhook and confirm the second person gets in;
   then revoke the first seat and confirm a third person gets in on the freed one.
9. **The desk is untouched.** Open the desktop on an existing data directory. No `tenant_plan`,
   `tenant_seat` or `billing_events` behaviour may appear: generations run with no plan row, nothing
   asks for a seat, and `POST /api/v1/billing/webhook` answers **404**.
10. **The ledger audit holds.** After the runs above, confirm
    `SUM(cost_usd_micros) WHERE billing_period_start = tenant_plan.period_start` equals
    `tenant_plan.spent_usd_micros` for that tenant. A mismatch is only a bug if there is no
    `usage_write_failed` in the log: the counter and the ledger row are two statements, not one
    transaction, so a failed INSERT leaves the counter ahead on purpose (§9).

## 9. Open items this lane leaves

- **The unmetered gaps from lane A are unenforced gaps here.** Edit-timeline worker jobs
  (`asr`, `generate_image`, `generate_video`), Edit-captions ASR, Knowledge and Finance embeddings,
  media tools inside chat runs and aborted runs spend gateway money that no allowance sees. Closing
  them is a metering change, not an entitlement one — but until it happens, an allowance undercounts.
- **No provider adapter.** The webhook contract is defined and tested; nothing speaks Xendit's or
  Paddle's dialect yet. D4 has to be answered before that lane can start.
- **No account screen.** The codes and the warning are host-side only.
- **`POST /api/v1/billing/top-up` raises nothing.** It hands back an operator-configured URL.
- **A repricing pass still does not exist** (lane A's own open item). Unpriced rows stay zero.
- **The margin multiple is carried and quoted but never charged**, because nothing charges yet.
  `quotedPriceUsdMicros` exists so the later adapter has one function to price against.
- **The counter and the ledger row are not one transaction.** `recordUsage` runs `accrueSpend` and
  then the INSERT. An INSERT that throws leaves the counter ahead of the ledger — the safe
  direction, since the other one would let a call escape the allowance — but the §8 audit reads
  short by that call, and `usage_write_failed` in the log is how to tell that from a real gap.
  Fixing it means one `db.transaction` spanning this module and the usage store's own connection
  handle.
- **An anniversary period does not survive its own end.** `rolledPlan` rolls into the calendar
  month whenever `now >= periodEnd`, so a window set by `entitlement.set` snaps back unless the
  provider fires `period.reset` before it closes. Self-sustaining anniversary periods are a change
  in `rolledPlan`, and they are only worth making once kyo has answered D3.
- **A pre-sale event is replayed only if the provider retries it.** The route now reconsiders a
  stored `unknown_tenant` delivery instead of calling it a duplicate, so a retry after first
  sign-in lands. It does not replay on its own, because `billing_events` stores no payload;
  doing that means a payload column plus a replay step at provision, which this lane did not
  take. Until then a plan sold to a tenant who never signs in within the provider's retry window
  has to be re-sent with a fresh event id.
