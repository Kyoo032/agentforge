# Map — Tenant usage ledger

Last verified: 2026-09-20 at a053245 + the Phase 4 branch `feat/web-phase4-tenant-secrets-rcbu9c` (through e37b3a1)

## Overview

One row per gateway call, for every mode, keyed on the tenant. This is what an allowance will be
enforced against in Phase 5 lane C; today it only records, and nothing reads it to refuse a call.

It replaces three separate answers to "what did this cost". Chat spend was in `runs.usage`, scoped
by organization. Job and edit-agent spend was appended to `desk-usage.json` — **one global file with
no tenant dimension**. Images, videos, music and meeting transcriptions recorded nothing at all,
and the numbers those screens showed came from a static list-price table, which is a renderer
estimate and not a meter. On top of
that, USD was never persisted: it was recomputed per read from whatever pricing catalog happened to
be cached, and a run the catalog could not price simply vanished from the sum.

This page is the ledger only. Plans, tiers, the entitlement check in `requireGatewayAllowed`, the
billing webhook and the `plan_*` refusal codes are lanes B to E and do not exist yet
([`../web-phase5-lane-a.md`](../web-phase5-lane-a.md),
[`../web-phase5-plans-billing-decisions.md`](../web-phase5-plans-billing-decisions.md) §4).

## How it works

**The table.** `tenant_usage` (`packages/db/src/schema.ts:49`, migration
`packages/db/drizzle/0016_tenant_usage.sql`) carries the tenant, the organization, the workspace and
the user; the `mode` and `model`; the `unit` and `quantity`; `input_tokens` / `output_tokens`; a
nullable `cost_usd_micros` with an `unpriced_reason` beside it; the `run_id`; and `at` in epoch
milliseconds. Three indexes: `(tenant_id, at)` for the allowance query, `(tenant_id, mode, at)` for
the per-mode split, `(unpriced_reason, at)` for finding what a repricing pass has to close.

**Units.** `tokens`, `images`, `seconds` or `jobs` (`USAGE_UNITS`,
`packages/core/src/usage/metering.ts:54`). One row carries exactly one unit and they are never
reconciled — only `cost_usd_micros` is comparable across rows, which is also why it is nullable
rather than absent. `seconds` covers both a generated clip and a stretch of audio sent to a
recogniser. `jobs` is the unit for anything the gateway bills a flat rate per call for,
whatever it hands back: a music job is one charge and returns two takes, and a lyrics draft is one
charge and returns text.

**Cost is an integer.** `usdToMicros` (`packages/core/src/usage/metering.ts:119`) stores USD as
millionths. An allowance decremented in floats bills the wrong number; a micro is ~1/500th of the
gateway's own quota unit (`QUOTA_PER_USD = 500_000`, `packages/core/src/gateway.ts:96`), so no price
this catalog can express is lost to the rounding.

**Unpriced is a row, not an absence.** `explainRunUsd` (`packages/core/src/gateway/account.ts:139`)
returns `{ usd }` or `{ usd: null, reason }`, where the reason is one of `usage_unknown`,
`model_not_in_catalog` or `tiered_billing`; the recorder adds `catalog_unavailable` (no catalog in
memory) and `no_list_price` (a media model nobody has transcribed a price for). The row is written
either way, with its unit and quantity intact. `estimateRunUsd` is now a one-line wrapper over
`explainRunUsd` (`:165`), so every existing caller and test is unchanged.

**Pricing happens once, at write time, from memory only.**
`packages/host/src/usage-record.ts` prices each call as it happens. Token runs go through
`cachedPricingCatalog(resolvedGatewayBaseUrl())` (`packages/host/src/account-usage.ts:164`), which
**never fetches** — it reads the 10-minute in-memory cache, so a generation is never delayed by a
gateway round trip. Media goes through `findMediaListPrice` + `estimateImageCost` /
`estimateVideoCost` (`packages/core/src/models/media-pricing.ts:497`, `:573`, `:602`), the same
curated table the studios quote from. Music has no vendor list price at all — Suno sells a consumer
subscription, not an API — so `priceJobUsage` (`packages/host/src/usage-record.ts:119`) falls
through to `gatewayFlatPrice` for the `track` unit, and records `catalog_unavailable` rather than
`no_list_price` when there is no catalog to read. An uncached desk therefore writes `catalog_unavailable` rows
that keep their unit and quantity, which a later pass can price in place.

**Who writes a row**

| Mode | Where | Unit |
|---|---|---|
| chat | `recordChatRunUsage`, called from `packages/host/src/runs.ts:370` and `:417`, gated on `finishRun`'s return | tokens |
| documents, presentations, research, data, finance, market, legal, knowledge | `rememberJobUsage` in the shared job runtime callback, `packages/host/src/job-regen.ts:145` | tokens |
| edit agent | `rememberJobUsage`, `packages/host/src/edit/agent-run.ts:185` (live) and `:363` (stub) | tokens |
| images | `recordImageUsage`, `packages/host/src/studio-generate.ts:295` | images |
| videos | `recordVideoUsage`, `packages/host/src/studio-generate.ts:363` | seconds |
| music | `recordMusicUsage`, `packages/host/src/studio-generate.ts:471` (a song) and `:534` (a lyrics draft) | jobs |
| meetings | `recordTranscriptionUsage`, `packages/host/src/meeting/run.ts:188` (the recording) — the minutes and the translation are token runs under the same mode | seconds |

**The mode label is derived, not passed.** `usageModeFromRunPrefix`
(`packages/core/src/usage/metering.ts:141`) maps the `runPrefix` every job call site already carries
(`document-section`, `finance-ratios-buckets`, `knowledge-verifier`, `meeting-minutes`, …) onto a
`UsageMode`. That
beats adding a required argument at twenty call sites, and beats `JobMode`, which five of those
prefixes have no value for. An unrecognised prefix lands under `other` — it still leaves a row.

**Exactly one row per chat run.** `finishRun` (`packages/host/src/threads.ts:312`) only transitions a
`streaming` row and returns whether it did. Whichever of the watchdog, the client abort and the model
completion settles first gets `true`; the others get `false` and write nothing.

**The media rows are written before the file is stored.** The gateway has already charged for the
image or clip by then, so a failure to save it must not be a call that vanishes from the ledger. The
model recorded is the one that answered (`toolModel(output, model)`), not the one that was asked
for, and a video's billable length is the snapped one
(`snapVideoSeconds`, `packages/host/src/studio-generate.ts:340`) — a model that only does 5 s clips
bills 5 s for a 4 s request.

**Failure modes**

| Case | What happens |
|---|---|
| The ledger write throws | `recordUsage` (`packages/host/src/tenant-usage.ts:300`) logs `usage_write_failed` and swallows it. Metering never fails a generation the tenant has already been charged for. The cost is a lost row, which is why it is a warning and not a debug line |
| No tenant, organization or model on the event | `validate` (`:102`) returns null and nothing is written. A row that cannot be attributed inflates the unpriced count without saying whose call it was |
| A cost with no reason, or a reason with a cost | Reconciled in `validate`: a null cost always gets a reason, defaulting to `catalog_unavailable` |
| The pricing catalog is cold | `catalog_unavailable` rows; unit and quantity are still right |
| The tenant row is deleted | The ledger goes with it (`ON DELETE cascade` on `tenant_id`) |
| An organization is deleted | **The ledger stays.** `organization_id` is deliberately not a foreign key: deleting one org inside a live tenant must not erase spend still to be billed |
| A database baseline-stamped past 0016 | `ensureTenantUsageTable` (`packages/db/src/ensure-schema.ts:473`, called at `:245`) re-creates the table and its indexes |

## Where things live

| File | Role |
|---|---|
| `packages/core/src/usage/metering.ts` | The vocabulary: `USAGE_MODES`, `USAGE_UNITS`, `UNPRICED_REASONS`, `UsageEvent`, `usdToMicros`, `usageModeFromRunPrefix`. Pure, browser-safe |
| `packages/core/src/gateway/account.ts:139` | `explainRunUsd` — priced, or the reason it is not |
| `packages/db/src/schema.ts:49` | The `tenantUsage` drizzle table |
| `packages/db/drizzle/0016_tenant_usage.sql` | The migration, and the reasoning for every nullable column |
| `packages/db/src/ensure-schema.ts:473` | `ensureTenantUsageTable`, the baseline-stamp healer |
| `packages/host/src/tenant-usage.ts` | The store: `createUsageStore`, `recordUsage`, `listTenantUsage`, `tenantUsageTotals`, and the `listJobUsageRecords` shim the account screen reads |
| `packages/host/src/usage-record.ts` | Pricing at write time, and the seven entry points the modes call |
| `packages/host/src/job-usage.ts` | `rememberJobUsage` — runtime event → tenanted row |
| `packages/host/src/desk-usage.ts` | **Legacy, read-only.** The old untenanted `desk-usage.json`; nothing writes it any more |
| `packages/host/src/account-usage.ts:47` | `deskRecords` — ledger rows plus any legacy file rows, for the account screen |

## Gotchas

- **Chat is in two places on purpose.** `runs.usage` still carries the per-run detail on the run row
  and is unchanged; `tenant_usage` is the billable event beside it. Anything that sums both will
  double-count chat. The account screen does not: it reads chat from `runs.usage` and everything
  else from the ledger (`packages/host/src/account-usage.ts:43`).
- **`desk-usage.json` is still read.** A desktop that has been generating since before this
  migration keeps the history the account screen already showed it. The two cannot double-count
  because nothing writes the file any more — do not add a writer back.
- **Media rows are metered but not yet on screen.** A `RunUsageRecord` has nowhere to put an image or
  a second, so `listJobUsageRecords` filters to token rows. The cost is in the ledger in micros;
  widening `AccountUsagePayload` is account-screen work lane A deliberately left open.
- **The store is synchronous.** It writes through the same `better-sqlite3` handle as
  `artifacts.ts`, because every caller is inside a runtime `onEvent` or a generate handler, and a
  fire-and-forget promise there is a row that silently does not exist when the process exits.
- **`setUsageStoreForTests` is a test seam** (`packages/host/src/tenant-usage.ts:291`). Nothing in
  the app may call it.
- **ASR has no list price on file, and no gateway fallback.** `gatewayFlatPrice` only serves flat
  per-call rates, which is exactly the wrong shape for audio billed by the minute, so every
  transcription row is `no_list_price` until someone transcribes a per-second rate into
  `media-pricing.ts`. The seconds are recorded regardless, so one row there closes every meeting
  already in the ledger once a repricing pass exists.
- **The edit timeline's own worker jobs are not metered.** `defaultRunner`
  (`packages/host/src/edit/jobs.ts:151`) runs the timeline's `asr`, `generate_image` and
  `generate_video` jobs from a worker that has a `workspaceId` but no `TenantContext`, so there is
  nothing to key a row on. The edit **agent** is metered; these three are the hole lane A left
  open, and closing it means threading a tenant through the edit job row.
- **A repricing pass does not exist yet.** `catalog_unavailable` rows sit at null until someone
  writes one. `tenant_usage_unpriced_idx` is there so it is cheap when it happens.

## Verify

No `verify-agentforge` feature file: none of this is user-facing yet — nothing on screen changes,
and there is no testid to press. The proofs are the suite:

- `packages/db/src/migrate-0016.test.ts` — the table on a fresh database, on a database replayed
  through `0015` and stamped there, and on a baseline-stamped copy; the column set, the three
  indexes, the tenant cascade, and that an organization deletion leaves the ledger alone.
- `packages/host/src/tenant-usage.test.ts` — one row per call with the right tenant, organization,
  user, mode and unit; unpriced rows keep their unit and quantity; tenant isolation on every read;
  totals split priced from unpriced by reason; a row that cannot be attributed is refused.
- `packages/host/src/usage-record.test.ts` — every mode produces exactly one row of the right unit;
  an unpriced model still produces a row, for each of the five reasons; `rememberJobUsage` and
  `recordChatRunUsage` write through the real path; media priced off the list table; one meeting
  leaving three rows in two units.
- `packages/core/src/usage/metering.test.ts` — the micros conversion, the guards, and every real
  `runPrefix` in the repo mapped to its mode.

`features/usage.md` is the nearest user-facing page, and it asserts nothing about the ledger yet:
the account screen shows the same numbers it did before, from a tenant-scoped source.
