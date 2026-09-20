# Phase 5: plans, metering and billing — the five decisions

**Status:** decision doc, 2026-09-20. **Nothing is implemented and nothing is decided here.** Each
section below lays out the options, prices them against the code as it stands, and recommends one.
Kyo decides; a PR must not treat a recommendation as an answer.

**Verified against `main` at `b482611`.** Every `file:line` below was read in that tree.

Parents: [`web-migration-plan.md`](web-migration-plan.md) §Phase 5 and open questions 3-7,
[`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md) open decision 8,
[`web-phase3-tenancy-spec.md`](web-phase3-tenancy-spec.md) (the lane format this doc copies).

---

## 0. Corrections to the parent plan

Five things the Phase 5 section of `web-migration-plan.md` states that are no longer true of the tree.
None of them changes the shape of the phase; all of them change what is owed.

1. **`requireGatewayAllowed` moved.** It is at `packages/host/src/gateway-gate.ts:435`, not `:411-417`.
   The **30 call sites** figure is correct and still exact — `packages/host/src/handlers/`:
   `jobs.ts` ×10, `knowledge.ts` ×8, `finance.ts` ×4, `market.ts` ×3, `edit.ts` ×2, and one each in
   `runs.ts`, `legal.ts`, `enhance-prompt.ts`. Three more handlers carry a comment saying they are
   deliberately *not* gated (`finance-export.ts:116`, `finance-import.ts:287`, `components.ts:4`),
   and `components.test.ts:84-89` asserts that in a test. Those three stay ungated in Phase 5 too.

2. **"`apps/web/lib/gateway-gate.ts:83-89` must fail closed on the web build" is already done.**
   Phase 1 landed it: `resolveGate` is now at `:94` and returns `"onboarding"` when
   `hosted || isElectron` (`:97`). Nothing is owed here. The plan line is stale, not wrong about
   the requirement.

3. **The webhook needs three exemptions, not one.** The plan names CSRF. A `POST` to
   `/api/v1/billing/webhook` is stopped by three separate rules before any route code runs:
   the **trusted-origin allowlist** (`mutatingRejection`, `http-adapter.ts:516-545`, called at
   `:424`; a missing `Origin` is rejected at `local-request.ts:99-105`, and a provider's POST
   carries either no Origin or its own), the **CSRF double-submit** (same function, `:532-535`),
   and the **session gate** (`router.ts:317-345`, which 401s before the route table is consulted;
   its exemption list is `auth/routes.ts:44,94` and is **GET-only**, so there is no existing
   mechanism to exempt a POST path).

4. **The webhook also needs the raw request body**, which the adapter currently discards.
   `readBody` (`http-adapter.ts:124-158`) `JSON.parse`s an `application/json` body and hands the
   parsed object on; the buffer is dropped. Paddle and Stripe both sign the raw bytes, and
   re-serialising a parsed object does not reproduce them. See D4.

5. **The seat counter's data already exists, but it does not measure what the rule says.**
   `auth_sessions` (`packages/db/src/schema.ts:663-681`) carries `tenant_id`, `org_id` and
   `user_id`, and the index at `:678` was added for exactly this counter — its comment says so.
   What it can answer is "signed in at some point in the last 30 days", not "has a live session":
   see D5.

**One stale map page, found on the way.** `.cursor/skills/verify-agentforge/features/gateway-gate.md`
still opens with "The gate is advisory and fails **open** … this is a UX signal, never an
entitlement check." That has been false in server mode since Phase 1 (`gateway-gate.ts:275,288-290`)
and it is the exact opposite of what Phase 5 makes the gate. It is left alone here on purpose —
this PR is the doc only — and belongs in the first Phase 5 code PR, per the AGENTS.md rule that a
change which makes a map false refreshes it in the same PR.

---

## 1. What the code does today

Facts, not a target design. Everything in the decisions below is priced against this table.

| Fact | Where |
|---|---|
| `requireGatewayAllowed(settings, opts)` is **synchronous** and takes no tenant. It reads a JSON file and throws. | `gateway-gate.ts:435-441`, via `reportGatewayGate` `:384` |
| Every one of the 30 call sites already has a `tenant` in scope and passes only `loadSettings(tenant.workspaceId)` | e.g. `handlers/jobs.ts:64`, `handlers/knowledge.ts:177` |
| A blocked gate is a flat `403 {"error":"gateway_blocked","status","message"}`, not the nested envelope | `GatewayBlockedError`, `gateway-gate.ts:415-423` |
| `GatewayGateStatus` is a closed union of six values, all of them about a **key**: `stub`, `needs_key`, `ok`, `invalid_key`, `unreachable`, `error` | `packages/core/src/gateway/gate-types.ts:5`; the host's guard `isGatewayGateStatus` enumerates it at `gateway-gate.ts:117-125` |
| The renderer sends any `allowed: false` to the onboarding screen — the paste-your-key screen, with no rail and no Settings | `apps/web/lib/gateway-gate.ts:94-99`; behaviour described in `features/gateway-gate.md` |
| Routes deliberately left open on a closed gate so it is recoverable: settings, workspaces, threads, artifacts, media, usage, model refresh | `features/gateway-gate.md` (`gate-open-routes`) |
| Chat run spend is written to `runs.usage`, scoped by `organizationId` | `finishRun`, `threads.ts:312-330`; called from `runs.ts:362,409` |
| Edit-agent and regen spend is appended to `desk-usage.json` — **one global file, no tenant dimension** | `job-usage.ts:11-16` → `desk-usage.ts:66-77` |
| Image and video generation records **no usage at all** | `studio-generate.ts` (290 lines; no usage write), reached from `handlers/jobs.ts:64,102` |
| `estimateRunUsd` returns `null` for an unknown model, a tiered-billing model, or a missing catalog — "do not invent a number" | `packages/core/src/gateway/account.ts:127-151` |
| USD is never persisted; it is recomputed per read from a cached catalog | `account-usage.ts:153,181,297` |
| `listRunUsage` selects **every** run row for the org, with no date bound | `threads.ts:332-337` |
| Gateway quota unit: `QUOTA_PER_USD = 500_000` | `packages/core/src/gateway.ts:96` |
| The gateway already reports per-key `total_used` / `total_available` / `unlimited_quota` / `expires_at`, and the host already parses it | `parseTokenUsage`, `account.ts:243-268`; fetched by `fetchThisKeyUsage`, `:372` |
| Session: idle 12 h, absolute 30 days, `lastSeenAt` slides at most once per 5 min; sign-out sets `revoked_at` rather than deleting the row | `auth/session.ts:40-43`, `:132`; schema `schema.ts:663-681` |
| The portal already owns a seat count and already has a `seat_cap_reached` reason with host-side copy in both languages | `docs/internal/portal/schema.md:318-330`; `auth/routes.ts:61` |

### The metering hole

This is the single most important input to the decisions and the plan does not name it.

Spend lands in **two** stores and one whole class of spend lands in **neither**:

- Chat runs → `runs.usage`, org-scoped SQLite rows.
- Edit-agent runs and job regen → `desk-usage.json`, a single untenanted file on disk.
- **Images and videos → nothing.** `studio-generate.ts` writes no record. The numbers the user sees
  on those screens come from a static list-price table (`packages/core/src/models/media-pricing.ts`
  via `apps/web/lib/media-estimate.ts`) — a renderer estimate, not a meter.

And even for what is recorded, `estimateRunUsd` returns `null` rather than a number whenever the
catalog cannot price the model (`account.ts:132-141`). A `null` is counted as "unpriced" in the UI,
which is honest for a spend display and useless for an allowance: you cannot subtract it.

> **An allowance enforced against today's data would not see a single image or video, and would
> silently undercount every model the gateway catalog does not price.**

Nothing in D1-D5 is safe until that is closed, which is why it is lane A below and has no
dependency on any decision.

---

## 2. The five decisions

### D1 — Who holds the gateway key on Personal

*Plan open question 3. Blocks D3, and the enforceability of the whole Personal plan.*

| Option | What it costs, given this code |
|---|---|
| **(a) One operator key for everyone** | Cheapest to start: the key already lives in `settings.enc` per workspace and Phase 3 lane D makes that per tenant. But the gateway sees one caller, so **it can enforce nothing per tenant**. Every limit is host-side only, measured after the call from the incomplete data above. One tenant's runaway loop bills the operator until a human notices — this is blocker `b8` in `blockers-2026-09-15.md`, still open, now with paying customers attached. |
| **(b) An operator-minted gateway token per tenant, with a quota** | The gateway enforces the allowance **on the call**, which is the only thing that closes the plan's own overshoot risk. Needs no new host concept: the per-tenant key slot is Phase 3 lane D's `settings.enc` row, and the reading half already exists — `parseTokenUsage` (`account.ts:243-268`) already returns used, remaining, unlimited and expiry per token, and `fetchThisKeyUsage` (`:372`) already calls it. Cost: an operator path to mint, rotate and suspend tokens against the gateway, and the operator's own wallet is the float. |
| **(c) Each Personal user pastes their own key (BYOK)** | Free to build — it is what the desktop does today, and the onboarding screen already exists for it. But then DPSBuddy sells software, not usage: the allowance is advisory (the plan says so), there is nothing to meter for billing, and "Personal subscription with a monthly token allowance included" is not the product any more. It also keeps the paste-a-key onboarding screen on the hosted build, which is the screen the whole hosted sign-in flow is meant to replace. |

**Recommendation: (b).** It is the only option under which the words "allowance included" are
enforceable, and the host-side work it needs is smaller than it looks — the code that reads a
token's remaining quota is already written and already on the settings read path. It also makes the
overshoot risk in D3 disappear rather than be managed.

**What it does not solve:** the gateway enforces USD against its own metering, while the account
screen shows the host's. Those two will disagree (the usage page already carries a footer saying
desk estimate and this-key wallet will not match). Under (b) the **gateway's** number is the one
that blocks, so it must be the one the account screen leads with.

---

### D2 — Tier sizes

*Plan open question 5.*

There is no number in this repo to derive tiers from, and inventing one in a doc would be the kind
of answer the pivot record forbids. What the code does constrain:

- The allowance is stored as `allowance_usd_micros` — **USD of gateway cost**, not tokens. That is
  the right unit: `QUOTA_PER_USD = 500_000` (`gateway.ts:96`) is the only conversion the host knows,
  model prices move, and a token count means nothing across a catalogue that spans
  `gpt-5.6-luna` at 0.2/1.2 per Mtok and `gpt-5.6-sol` at 4/20 (`gateway-model-selection.md:474-481`).
- `seat_cap` is meaningless on Personal and must be nullable, not defaulted to 1.
- Media is priced per image and per second of video from a different table entirely
  (`media-pricing.ts`), so a single USD allowance is also the only unit that can cover both text and
  media in one number — another reason not to express a tier in tokens.

**Recommendation: the shape, for Kyo to fill in.** Three Personal tiers, each a monthly
subscription price plus an included `allowance_usd_micros`, with the ratio between them set by one
decision: what multiple of the gateway cost the subscription charges. Pick that multiple once
(it is the gross margin), then the tiers are arithmetic, and tier sizes can be re-cut later without
touching code because the allowance is a column.

**What Kyo must supply before lane B writes the table:** the currency the price is quoted in (which
follows D4), the margin multiple, and whether the allowance resets on the calendar month or on the
subscription anniversary — `tenant_plan` has `period_start` / `period_end`, so either works, but
the answer decides whether the period roll is a cron or a webhook effect.

**What makes this cheap to get wrong and cheap to fix:** it is one row per tenant. Getting it wrong
costs a migration of values, not of schema — as long as the allowance is USD micros and not a token
count or a tier enum.

---

### D3 — Overage on Personal: block, or meter and bill

*Plan open question 4.*

| Option | What it costs, given this code |
|---|---|
| **(a) Hard block at the allowance** | Under D1(b) this is exact and nearly free: the gateway refuses the call and the host reports it. Under D1(a) it is the plan's stated risk — enforced before the call, measured after it, so one expensive run overshoots — and with the metering hole above, it overshoots silently and without limit on media. |
| **(b) Meter and bill the excess** | Needs a payment method on file, a second direction of traffic to the provider (charges out, not just webhooks in), invoice lines, a dispute path, and a number accurate enough to charge someone. Today's number is not accurate enough to charge someone: see §1. It also triples the billing surface for the first paying customers. |
| **(c) Hard block plus self-serve top-up** | (a) plus one purchase flow. The purchase is the same webhook the plan already needs, with a different event kind, and under D1(b) a top-up is literally "raise the gateway token's quota". |

**Recommendation: (c), with a warning at 80% and the block at 100%.** It is the only option that is
both enforceable on day one and not a dead end for the user, and it never charges anyone for a
number this codebase cannot yet defend. Metering-and-billing stays available later: it is the same
tables, with the block turned off.

**Non-negotiable either way — the refusal must not be `gateway_blocked`.** A Personal user over
their allowance holds no key, and `gateway_blocked` puts them on the onboarding screen, where
`features/gateway-gate.md` records that "the only ways past are a key that validates, a re-check
that succeeds, or deleting `gateway-gate.json` on disk." None of the three is available to a hosted
tenant. Phase 5 needs its own reason codes and its own renderer branch, to the account screen. See
§3(b).

---

### D4 — Billing provider

*Plan open question 6. The real question is the selling entity; the API is downstream of it.*

Read on 2026-09-20 from the four provider pages linked in the table below: Stripe's "Requirements to
open a Stripe account in Indonesia", Paddle's supported-countries help page and its webhook
signature-verification doc, and Xendit's "Handling webhooks". Each quoted phrase comes from the page
it is linked to. **Confirm against those pages before D4 is answered and before anything is signed** —
these are commercial terms that change without notice, and two of the three answers turn on facts
about Kyo's selling entity that are not in this repo and that no page can settle.

| Provider | Seller eligibility | Webhook authentication | Cost against this code |
|---|---|---|---|
| **Stripe** | Indonesia is **invite-only**, payouts **IDR only**, and "we don't support cross-border or international transactions from a Stripe account based in Indonesia" ([Stripe support](https://support.stripe.com/questions/requirements-to-open-a-stripe-account-in-indonesia)) | `Stripe-Signature`, HMAC-SHA256 over `timestamp.rawBody` | **Needs the raw-body path** (correction 4). If that page still holds when Kyo asks, an Indonesian entity on Stripe cannot bill a foreign customer at all, which would leave it serving a domestic-only Personal plan and nothing else. Confirm with Stripe directly: this is the one option a single line on a support page eliminates, so it deserves a real answer rather than an inference. |
| **Xendit** | Indonesian entity, IDR, and the local rails the portal's tenants actually pay with (QRIS, VA, e-wallets, cards) | A static token in the `x-callback-token` header, retried up to six times with exponential backoff ([Xendit docs](https://docs.xendit.co/docs/handling-webhooks)) | **Cheapest by a wide margin**: a constant-time compare of one header — `csrf.ts:84-101` already has the constant-time helper — and **no raw body needed**, so correction 4 does not apply. No tax handling: the entity invoices and remits PPN itself. The six retries mean the route must be idempotent on event id. |
| **Paddle** | Merchant of record — Paddle is the seller, and handles VAT, sales tax and invoicing worldwide. Sellers are accepted anywhere not on its sanctions list; Indonesia is not on it ([Paddle help](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle)) | `Paddle-Signature`, HMAC-SHA256 over `ts:rawBody`, with an explicit "don't transform or process the raw body" ([Paddle docs](https://developer.paddle.com/webhooks/signature-verification)) | **Needs the raw-body path.** Costs more per transaction than a PSP, and buys away the entire cross-border tax problem. |

**Recommendation: it follows the buyer, and Kyo is the only one who can name the buyer.**

- If the first paying customers are the Indonesian organisations the portal is built around —
  the whitelabel tenants named in `portal/schema.md:53-57` are Indonesian — then **Xendit**, and it
  is also the cheapest webhook in this codebase by a long way.
- If Personal is sold internationally, **Paddle**, and accept the fee for not building tax handling.
- **Stripe only if the selling entity is outside Indonesia.** An Indonesian Stripe account cannot
  take a cross-border payment, so it cannot serve both plans.

**Build the raw-body path regardless.** Two of the three providers require it, the provider can
change, and threading a raw buffer through `readBody` for one allowlisted path is a contained
change to `http-adapter.ts:124-158`. Deciding the provider then costs a signature function, not an
adapter change.

---

### D5 — Does an idle member free a seat

*Plan open question 7.*

The portal's rule is time-based: a seat is a member with a session seen in the last 30 days
(`portal/schema.md:318-330`). Two problems with re-implementing it host-side.

**First, the host's data answers a looser question than the rule asks.** Counting distinct
`user_id` in `auth_sessions` with `last_seen_at` inside 30 days is not "has a live session": rows
survive sign-out (`revoked_at` is set, the row stays), the idle timeout is 12 hours and the absolute
lifetime is exactly 30 days (`session.ts:40-42`), and `last_seen_at` only moves once per 5 minutes
(`:43,132`). So the host's count is "signed in at least once in the last 30 days" — which, for a
tool people use during a working month, is close to "everyone". A tenant at its cap by the portal's
count and under it by the host's will produce a support ticket neither number explains.

**Second, two implementations of one rule will drift.** The portal already counts seats, already
refuses, and already has the reason code — the host even carries the copy for it in both languages
(`auth/routes.ts:61`, plus `apps/web/locales/{en,id}/auth.json`).

| Option | What it costs |
|---|---|
| **(a) Port the portal's 30-day rule into the host** | A member back from 31 days' leave is refused at sign-in through no fault of theirs, and neither they nor their admin can do anything about it in the product. Plus the drift above. |
| **(b) Hold the seat until an admin revokes it** | Predictable for the customer, matches how seats are contracted (`seat_band` ≥ `seat_cap`, `portal/schema.md:71-72`), and removes a refusal the user cannot fix. Costs an admin surface to revoke, and an "idle 30 days" report so admins can reclaim deliberately. |
| **(c) Free on idle, re-admit into any spare seat** | Keeps the portal's rule and softens it, but the refusal still happens when the org is genuinely full, and it is the most code for the least clarity. |

**Recommendation: (b), and the host should not be the seat authority at all.** Enterprise
entitlement in `requireGatewayAllowed` should read the org status the portal already decided
(`active` / `past_due` / `suspended`, carried on the plan row the webhook writes) rather than
recompute a seat count from `auth_sessions`. Seat enforcement belongs at sign-in, where the portal
already does it and already has the reason code; the gateway gate is the wrong place to discover
you have no seat, because by then you are signed in and working.

This narrows Phase 5's Enterprise check to one comparison — plan status — and deletes the seat
counter, its index dependency and its test from the host's scope. If Kyo wants the count visible,
it is a read for the admin screen, not a gate.

---

## 3. What follows, whichever way D1-D5 go

Three consequences that are true under every option above, and should be settled before lane C
starts.

### (a) The entitlement is resolved once per request, not thirty times

`requireGatewayAllowed` is synchronous (`gateway-gate.ts:435`). An allowance or plan check is a
database read. Making the function `async` changes all 30 call sites, every `catch` around them,
and the gate tests (`gateway-gate.test.ts:401,599`) — for a value that is identical at all 30 sites
within one request.

Resolve it where the identity is already resolved. `dispatch` already runs a session gate and
attaches a verified `HostSession` to the request (`router.ts:317-345`, wired `:352-359`). The plan's
own inventory row for `TenantContext` already promises this: it "gains `tenantId` and a resolved
`plan`", phases 3 and 5. So Phase 3 lane C puts the tenant on the request; Phase 5 puts the resolved
plan beside it, `requireGatewayAllowed` gains a second synchronous argument, and the 30 call sites
stay one line each.

This also fixes a cost problem: `listRunUsage` (`threads.ts:332`) reads **every** run row for the
org with no date bound. Summing that on the request path, at every gateway call, is a full scan per
call. `tenant_usage` needs `(tenant_id, at)` indexed, and the period total wants to be a counter
maintained on write and read in O(1) — not a `SUM` computed per call.

### (b) A plan refusal is not a gateway refusal

`GatewayGateStatus` (`packages/core/src/gateway/gate-types.ts:5`) is six values about a key. `GatewayBlockedError`
(`:415-423`) throws a flat 403 that the renderer turns into onboarding (`apps/web/lib/gateway-gate.ts:97`)
— a screen with one input, the key, and no rail and no Settings.

Phase 5 needs:
- its own reason codes (`plan_past_due`, `plan_allowance_exhausted`, `plan_cancelled`, …), in the
  same flat-403 shape so `jsonError` and the renderer's parser keep working;
- its own renderer branch, to the account and plan screen rather than onboarding;
- the account, plan and top-up routes added to the deliberately-open list that already carries
  settings, threads, workspaces, media and `/api/v1/usage` — a blocked tenant who cannot see why
  they are blocked, or pay, is a churned tenant;
- copy for every new reason in both `en` and `id`, as the nine portal reasons already have.

### (c) The webhook is four changes, not one route

1. A path exemption in `mutatingRejection` (`http-adapter.ts:516-545`) so the origin allowlist and
   CSRF do not reject it.
2. A POST-capable exemption in the session gate — `isSessionExemptPath` (`auth/routes.ts:94-100`)
   is GET-only by design, and its comment says so, so this is a deliberate widening and wants its
   own test.
3. A raw-body path through `readBody` (`:124-158`) for that one path, for D4.
4. Idempotency on the provider's event id. Xendit retries six times; the others retry too. The
   webhook is "the only writer of `status`" per the plan, so a replayed event must be a no-op, not
   a second write.

---

## 4. Work breakdown — five lanes

No two lanes write the same file. Order: **A and B first and in parallel**, then C, D, E.
Lane A depends on no decision at all and should start whatever Kyo answers.

**Lane A — close the metering hole.** *No dependencies. Start immediately.*
Files: `packages/host/src/studio-generate.ts`, `job-usage.ts`, `desk-usage.ts`,
`packages/core/src/gateway/account.ts`, `packages/host/src/account-usage.ts` + their tests.
Work: record a usage row for every image and video generation; give `desk-usage` a tenant dimension
or route it to the same store as run usage; make "unpriced" a first-class outcome that an allowance
can refuse to ignore, rather than a `null` that silently vanishes from a sum.
**Done when:** a generated image and a generated video each leave a priced usage record; no usage
record is written to an untenanted path; the sum of a tenant's spend over a period is a number with
a stated confidence, and a run the catalog cannot price is visible in it rather than absent.

**Lane B — `tenant_plan`, `tenant_usage`, migration `0016`.** *No dependencies (Phase 3's is `0015`,
journal idx 14 today).*
Files: `packages/db/src/schema.ts`, `drizzle/0016_tenant_plans.sql`, `drizzle/meta/_journal.json`,
`packages/db/src/ensure-schema.ts`, `migrate-0016.test.ts` (new), `packages/core/src/tenancy/types.ts`.
Work: both tables per the plan, `seat_cap` nullable, allowance in USD micros, `(tenant_id, at)`
indexed on `tenant_usage`, and the resolved plan added to `TenantContext`. If Phase 3 lane D landed
first it will already have created `tenant_usage` with only the columns Phase 3 needed
(`web-phase3-tenancy-spec.md:207,264-266`), so this lane **alters** that table rather than creating
it — check which before writing `0016`.
**Done when:** the migration test passes on a real copy and a baseline-stamped copy; the desktop
boots against an existing database with no plan row and behaves exactly as it does today.

**Lane C — the entitlement check and the refusal.** *Depends on B, and on Phase 3 lane C.*
Files: `packages/host/src/gateway-gate.ts`, `router.ts`, `types.ts`, `handlers/*.ts` (the 30 sites,
one argument each), `apps/web/lib/gateway-gate.ts`, `apps/web/locales/{en,id}/*.json` + tests.
Work: resolve the plan once per request beside the session; the second argument to
`requireGatewayAllowed`; the new `plan_*` reason codes and their renderer branch; the account and
plan routes added to the open list.
**Done when:** a `past_due` tenant is refused with a plan reason and lands on the account screen,
not onboarding; a tenant at 99% of allowance passes and at 101% is refused; a tenant with no plan
row behaves as the desktop does; no handler gained an `await` it did not have.

**Lane D — the billing webhook.** *Depends on B and on D4.*
Files: `packages/host/src/handlers/billing.ts` (new), `router.ts`, `http-adapter.ts`,
`auth/routes.ts`, `packages/host/src/billing/` (signature verification) + tests.
Work: the three exemptions, the raw-body path, provider signature verification, idempotency on
event id, and the plan-row write — the only writer of `status`.
**Done when:** a webhook with a bad signature changes nothing and says so; the same event delivered
twice writes once; an unexempted path still 401s and 403s exactly as before; a `past_due` → `active`
event unblocks a blocked tenant on the next call.

**Lane E — the account and plan screen, and the harness.** *Depends on B and C.*
Files: `apps/web/components/` (account/plan screen), `apps/web/lib/media-estimate.ts`,
`packages/host/src/handlers/account.ts` (new), `packages/host/src/plans-harness.test.ts` (new),
`.cursor/skills/verify-agentforge/features/gateway-gate.md` and `usage.md` (correction 0.5).
Work: the screen that shows allowance, spend and plan state and carries the top-up path; a harness
that drives each refusal reason; refresh the two map pages the phase makes false.
**Done when:** every `plan_*` reason is in the harness and green; a blocked tenant can still reach
the account screen and see the reason; the map pages describe the gate as it is.

---

## 5. Still Kyo's to answer

The five, restated as the one-line answers lane B and lane D need:

1. **D1** — operator key, per-tenant operator-minted token, or BYOK? *Recommended: per-tenant token.*
2. **D2** — the margin multiple, the quote currency, and calendar month vs anniversary period.
3. **D3** — block, meter, or block with top-up? *Recommended: block with top-up, warn at 80%.*
4. **D4** — the selling entity, and therefore Xendit, Paddle or Stripe. *Stripe appears ruled out if
   the entity is Indonesian — confirm with Stripe before relying on it.*
5. **D5** — free an idle seat, or hold until revoked? *Recommended: hold, and let the portal remain
   the seat authority.*

And four this doc surfaced that the plan does not list:

6. **Tenant or org for pooled spend.** `runs.usage` is scoped by `organizationId` (`threads.ts:332`)
   and `tenant_usage` keys on `tenant_id`. An Enterprise tenant with several orgs needs one of them
   named as the billing boundary before lane B writes the table.
7. **Who is the seat authority**, the host or the portal (D5). If the host, the drift in §D5 is
   accepted deliberately and wants a written rule for which number support quotes.
8. **What a cancelled tenant keeps** — the plan's open question 10, but Phase 5 is where `cancelled`
   first becomes a real status, so it needs an answer here rather than at Phase 8. Does `cancelled`
   block the gateway only, or the whole product?
9. **Does the Personal user ever see a key field again?** Under D1(b) they never hold a key, so the
   hosted onboarding screen stops being about keys entirely. That is a renderer decision that lands
   in lane C and is easier to make now than after the refusal codes are written.

---

## Related docs

- [`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md) — the decision record and the deploy log
- [`web-migration-plan.md`](web-migration-plan.md) — phases 0-8; §Phase 5 is this doc's parent
- [`web-phase3-tenancy-spec.md`](web-phase3-tenancy-spec.md) — Phase 3 must land before lane C
- [`portal/schema.md`](portal/schema.md) — orgs, `seat_cap`, `seat_band`, the seat count
- [`portal/device-code-login.md`](portal/device-code-login.md) — reason codes the refusals extend
- [`maps/settings-and-gateway-gate.md`](maps/settings-and-gateway-gate.md) — the gate as it is today
