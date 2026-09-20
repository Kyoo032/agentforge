# Phase 5 lane A — the tenant usage ledger, and what it leaves open

Written 2026-09-20, alongside the branch `feat/web-phase5-metering-jk2wvg`.
Spec: [`web-phase5-plans-billing-decisions.md`](web-phase5-plans-billing-decisions.md) §4, lane A.
Code map: [`maps/tenant-usage-ledger.md`](maps/tenant-usage-ledger.md).

Lane A was the one piece of Phase 5 that depended on none of Kyo's five open decisions. It is
closed: every mode that calls the gateway now leaves a tenant-scoped, priced usage row. Nothing in
this lane refuses a call, charges anybody, or adds a plan — that is lanes B to E.

---

## 1. What was wrong

Three holes, all of them recorded in the decision doc's §1 table against `main` at `b482611`:

1. **Chat spend** went to `runs.usage`, scoped by `organizationId`. Fine as far as it went.
2. **Job and edit-agent spend** was appended to `desk-usage.json` — **one global file on disk with
   no tenant dimension**. On a hosted deployment every tenant would have been appending to the same
   array.
3. **Images and videos recorded nothing at all.** The prices those screens show come from a curated
   list-price table, which is a renderer estimate for choosing between two models, not a meter.

And even for what was recorded, USD was never persisted. It was recomputed per read from whatever
pricing catalog happened to be cached, and `estimateRunUsd` returned `null` — not a number — for an
unknown model, a tiered-billing model or a missing catalog. A `null` is honest for a spend display
and useless for an allowance: you cannot subtract it, and it does not tell you it is there.

> An allowance enforced against that data would not have seen a single image or video, and would
> have undercounted every model the catalog could not price — **silently**.

## 2. What this lane built

**`tenant_usage`, migration `0016`.** One row per gateway call. Carries `tenant_id`,
`organization_id`, `workspace_id`, `user_id`, `mode`, `model`, `unit`, `quantity`, `input_tokens`,
`output_tokens`, `cost_usd_micros`, `unpriced_reason`, `run_id`, `at`. Indexed on `(tenant_id, at)`,
`(tenant_id, mode, at)` and `(unpriced_reason, at)`.

**Three units, never reconciled.** `tokens`, `images`, `seconds`. Only `cost_usd_micros` is
comparable across rows — which is the other reason it is recorded even when it is null.

**Cost as an integer of USD millionths.** An allowance decremented in floats bills the wrong number.
A micro is about 1/500th of the gateway's own quota unit (`QUOTA_PER_USD = 500_000`), so nothing
this catalog can express is lost to the rounding.

**Unpriced became a first-class outcome.** `explainRunUsd` returns the *reason* beside the null, and
the row is written either way with its unit and quantity intact. Five reasons, each a different fix:

| Reason | Means | Closed by |
|---|---|---|
| `catalog_unavailable` | No gateway pricing catalog in memory at write time | A repricing pass (does not exist yet — see §4) |
| `model_not_in_catalog` | The catalog was there and does not list the model | A catalog refresh, or a wrong model id someone has to look at |
| `tiered_billing` | The gateway prices this model by a tier expression the host cannot evaluate | Nothing local. The gateway's own metering is the only source |
| `no_list_price` | A media model nobody has transcribed a vendor price for | A row in `packages/core/src/models/media-pricing.ts` |
| `usage_unknown` | The runtime reported a run it could not attribute token counts to | Nothing. The call happened; its size is unknown |

**Pricing happens once, at write time, and never touches the network.** Token runs price against the
already-cached catalog (`cachedPricingCatalog` never fetches, by design — it sits on the studio hot
path). Media prices off the repo's own curated table. A cold desk therefore writes
`catalog_unavailable` rows rather than delaying a generation on a gateway round trip.

**Every mode writes a row:**

| Mode | Unit | Entry point |
|---|---|---|
| chat | tokens | `recordChatRunUsage`, from `runs.ts`, gated on `finishRun`'s own return so one run is one row |
| documents, presentations, research, data, finance, market, legal, knowledge | tokens | `rememberJobUsage`, in the one shared job runtime callback in `job-regen.ts` |
| edit agent | tokens | `rememberJobUsage`, both call sites in `edit/agent-run.ts` |
| images | images | `recordImageUsage`, in `studio-generate.ts` |
| videos | seconds | `recordVideoUsage`, in `studio-generate.ts` |

The mode label is **derived** from the `runPrefix` every job call site already carries, rather than
added as an argument at twenty sites. An unrecognised prefix lands under `other` and still leaves a
row.

**`desk-usage.json` is now read-only legacy.** Nothing writes it. Its readers stay so a desktop that
has been generating since before this migration keeps the history the account screen already showed
it; the two cannot double-count, because nothing new goes to the file.

## 3. What did not change

- **`runs.usage` is untouched.** It still carries the per-run detail on the run row. Chat is
  therefore in two stores on purpose — one is a property of a run, the other is a billable event.
  The account screen reads chat from `runs.usage` and everything else from the ledger, so it does
  not double-count.
- **Nothing on screen changed.** Same numbers, from a tenant-scoped source.
- **No plan, no tier, no entitlement check, no webhook, no `plan_*` refusal code.**
  `requireGatewayAllowed` is exactly as it was: synchronous, no tenant argument.
- **`getTenant`, the session backend, `csrf.ts` and the lane-A edit-store scope functions** were not
  touched.

## 4. What is left open

Ordered by how much it matters to lanes B–E.

1. **There is no repricing pass.** A `catalog_unavailable` row sits at `cost_usd_micros = null`
   forever. The index `tenant_usage_unpriced_idx` exists so that a job which walks those rows and
   prices them once a catalog is warm is cheap to write, but nobody has written it. Until then a
   cold desk's spend is visible as *count and unit* but not as *dollars*. **Lane B should decide
   whether the allowance treats an unpriced row as zero, as a block, or as a warning** — the ledger
   deliberately does not decide that.
2. **Media spend is metered but not on the account screen.** A `RunUsageRecord` has nowhere to put
   an image or a second, so `listJobUsageRecords` filters the ledger to token rows for the existing
   estimator. The cost is in the ledger in micros; surfacing it means widening
   `AccountUsagePayload` and the renderer, which is account-screen work this lane left alone.
3. **`quantity` is an integer.** Fine for tokens and images; a fractional-second clip would round.
   No model in the table bills sub-second today.
4. **One image per call is assumed.** `recordImageUsage` takes a `count` and the studio passes 1,
   because `imageGenerateTool` returns one image. If batch generation lands, pass the real count.
5. **Pooled spend across several organizations in one tenant.** The ledger keys on `tenant_id` and
   carries `organization_id` beside it, so both readings are available. Which one an Enterprise
   allowance is drawn against is decision-doc open question 6 and is still Kyo's.
6. **The gateway's number and the host's number will disagree.** The ledger is the host's estimate
   from the catalog; the gateway meters its own calls. Under D1(b) (an operator-minted token per
   tenant) the gateway's number is the one that blocks, so the account screen will have to lead with
   it. The decision doc says this; the ledger does not try to reconcile them.
7. **No retention or rollup.** The ledger only grows. `tenant_usage_tenant_at_idx` makes the period
   query cheap, but a long-lived tenant eventually wants a monthly rollup rather than a `SUM` over
   every row. `USAGE_LIST_LIMIT` caps one read at 5 000 rows so nothing can page the whole ledger
   into memory by accident.

## 5. New by-id routes for the lane E harness

**None.** This lane adds no HTTP route at all — no handler was added, and no existing handler's path
or method changed. The lane E tenancy harness has nothing new to sweep from lane A.

## 6. How this was verified

No app was booted: this is a cloud session, so `.cursor/skills/verify-agentforge/scripts/doctor.mjs`
has nothing on `127.0.0.1:3000` to talk to, and the pstack verifier and mapper half of that skill
lives in the Cursor plugin rather than the repo. What was done instead:

- **The suites were run for real**, using the `xlsx` install workaround in
  [`handover-2026-09-20.md`](handover-2026-09-20.md): `@agentforge/core` 2 080 passing,
  `@agentforge/db` 89 passing, `@agentforge/host` 1 761 passing. Two host tests fail
  (`edit/ffmpeg-binary.test.ts`, `edit/import-ipc.test.ts`) — both fail identically on `main` at
  `df11317` and neither touches metering.
- **63 new tests**, listed in the map page's Verify section.
- **`tsc --noEmit`** on all three packages: the error count is identical to `main` (core 52, host
  18, both pre-existing in test files), so this branch adds none.
- **The map-rot pass**: every `file:line` citation in `docs/internal/maps/` and
  `.cursor/skills/verify-agentforge/features/` that pointed into a file this branch changed was
  re-anchored **by content** — the exact lines the citation pointed at on `main` were located in the
  new file, and only a unique match was rewritten. 100 citations across 19 pages; the 18 the
  content match could not resolve uniquely were resolved by hand and each anchor line read back.

## 7. Live tests still owed on Kyo's machine

Nothing here reaches a gateway from the cloud, so all of the following are unverified against a real
call:

- Generate an image and a video in the studios, then read `tenant_usage`: expect one row each, units
  `images` and `seconds`, the seconds matching the snapped clip length, and a cost in micros
  matching the studio's own estimate line.
- Send a chat message and run a Documents draft: one `tenant_usage` row each, `mode` `chat` and
  `documents`, and the chat row's token counts matching `runs.usage` on the same run.
- Run one generation on a model the gateway catalog does not price: expect a row with the right unit
  and quantity, `cost_usd_micros` null, `unpriced_reason` `model_not_in_catalog`.
- Open Settings → Usage before and after: the numbers should be the same as they were, now sourced
  from the ledger for everything except chat.
- On a desk with an existing `desk-usage.json`: confirm the old history still shows, and that the
  file's modified time does not change after a generation.
