# Map — Per-tenant object storage and the quota

Last verified: 2026-09-21 at 208ee85 + the Phase 6 branch `claude/web-phase6-tenant-storage-l9sxnd`

## Overview

Where a tenant's **bytes** go, who is allowed to read them back, and how many of them one tenant may
hold. Phase 3 lane D gave every tenant a disjoint *directory*; Phase 6 puts that layout behind one
interface with two backends — the local disk, and a Tencent COS bucket — and adds a per-tenant
ceiling that is reported and enforced.

It is **not** about which directory a path lands in: that is
[`tenant-storage.md`](tenant-storage.md), lane D, and this page depends on it rather than repeating
it. It is not about who a request belongs to ([`tenant-resolution.md`](tenant-resolution.md)) and
not about what a tenant is entitled to *spend* ([`tenant-entitlement.md`](tenant-entitlement.md)) —
money and bytes are two different ceilings with two different codes.

## How it works

### The rule

> **The backend is chosen by mode, never by tenant.** `AGENTFORGE_STORAGE=cos` → the bucket;
> anything else → the files lane D placed, at the exact paths lane D placed them.

`objectStorageKind` (`packages/core/src/server-mode.ts:127-129`) is the whole picker, read per call
rather than frozen at import because the suites and `apps/web` both set environment after the module
graph is loaded. There is no per-tenant branch to get wrong and **no fallback at read time**: with
`cos` set and the bucket unconfigured, `createCosObjectStore` throws
(`packages/host/src/tenant-storage-cos.ts:89-105`) rather than handing back the disk. A silent fall
back to a directory nobody backs up is the failure the module exists to prevent — the same shape
Phase 4 gave `tenant-state-store.ts`.

It is deliberately **not** `AGENTFORGE_SERVER`. A hosted box without a bucket is a real deployment
(the runbook's own §12 says nothing talks to COS yet), and tying the two together would break every
such box on upgrade.

### A key is the on-disk layout, spelled with slashes

`tenants/<id>/<org>/<uuid>.png` in the bucket is `<mediaRoot>/tenants/<id>/<org>/<uuid>.png` on
disk, and `local-tenant` keeps the bare root in both. So a `media.storage_path` written before this
phase resolves verbatim under either backend, and switching a deployment to COS is a copy of the
tree rather than a rewrite of the database.

### Two guards, in this order

1. **`assertObjectKey`** (`packages/host/src/tenant-object-keys.ts:45-71`) — pure string work, no
   filesystem, no network. Refuses an empty key, one over 512 characters, a NUL, a backslash, a
   drive letter, a leading `/`, and any empty, `.` or `..` segment; then requires this tenant's
   prefix. For `local-tenant` the prefix is empty and the rule inverts: anything **except**
   `tenants/…`, which is `tenantDeniedRoots` as a string test. It runs before any IO in both
   backends, so a crafted key never becomes a request or an `open()`.
2. **`resolveInsideTenantRoot`** (lane D, `packages/host/src/tenant-paths.ts`) — only the file
   backend needs it, through `objectPath` (`packages/host/src/tenant-storage.ts:124-131`): a symlink
   planted inside a tenant's own subtree passes any lexical test while pointing anywhere on disk.
   COS has no symlinks, so there the first guard is the whole story.

A key that is not the caller's is a **404, not a 403** (`objectNotFound`,
`packages/host/src/tenant-object-keys.ts:28-30`): a 403 would tell the asker the object exists.

### An upload, end to end

`POST /api/v1/media` → `handlePostMedia` → `saveMedia` (`packages/host/src/media.ts:67-108`) builds
the key with `mediaRelativePath` and calls `putTenantObject`
(`packages/host/src/tenant-storage.ts:447-464`), which does three things in this order and no other:

1. `head()` the key, so an overwrite is charged the difference rather than the whole object again.
2. `assertStorageAdmits` (`packages/host/src/tenant-storage.ts:489-501`) — the check runs **before**
   the write, so a refusal never leaves a partial object.
3. `put()`, then `addTenantStorageBytes` (`packages/host/src/tenant-storage-store.ts:126-145`) — the
   counter moves only after the backend took the write, so a failed put never charges for bytes
   nobody stored.

A read is `readTenantObjectRange` (`packages/host/src/tenant-storage.ts:594-600`) from
`handleGetMediaFile` (`packages/host/src/handlers/media.ts:25-51`). The file backend streams only
the requested bytes; the COS backend HEADs for the size and then GETs with a `Range` header.

### The quota

- **The ceiling** is `tenantStorageLimitBytes` (`packages/core/src/storage/quota.ts:81-99`):
  `null` off server mode — a desk measures and reports and refuses nothing — and in server mode the
  parsed `AGENTFORGE_TENANT_STORAGE_BYTES`, defaulting to 20 GiB. **Junk falls back to the default,
  never to `null`**, so a typo cannot remove the only bound between one tenant and the disk. `0`,
  `off`, `none` and `unlimited` turn it off explicitly.
- **What is counted** is objects **plus** the job trees that stay on local disk under either backend
  because the processes that write them take paths: ffmpeg scratch, Knowledge uploads, dataset
  files, Meeting recordings and Legal matter files (`tenantJobRoots`,
  `packages/host/src/tenant-storage.ts:308-330`). Objects are held in the counter row; the job trees
  are walked and memoised for ten seconds (`measureTenantJobBytes`,
  `packages/host/src/tenant-storage.ts:344-359`). Knowledge uploads moved out of the media root into
  `<tenantDataDir>/knowledge/` to get here: inside the media root the file backend measured them but
  no write moved the counter, so a tenant's number changed on an operator's recompute rather than on
  their own upload. The old location is still read by `deleteSource` and `reindexSource` so an
  upgraded desk keeps the bytes it has.
- **One tenant's writes are serialised.** `putTenantObject` runs them in a promise chain, so a second
  write cannot read the counter between the first one's check and its increment. It is per tenant, so
  a 500 MB import queues nobody else, and per process — two hosts would still race, which is a
  conditional SQL update rather than a mutex.
- **The counter is a cache, the backend is the truth.** A tenant with no row is seeded from a real
  measure on first use (`objectUse`, `packages/host/src/tenant-storage.ts:414-432`) rather than from
  zero, so an upgraded data volume is not declared empty; `recomputeTenantStorage`
  (`packages/host/src/tenant-storage.ts:542-556`) is the operator's reconciliation.
- **The refusal** is `StorageQuotaError` (`packages/host/src/tenant-storage.ts:448-458`): a flat 403
  with code `storage_quota_exceeded`, the same shape as `GatewayBlockedError` and `PlanBlockedError`
  and deliberately a third code. `gateway_blocked` routes the renderer to the paste-your-key
  onboarding screen, which is a dead end for a tenant whose problem is that their prefix is full.
- **The report** is `GET /api/v1/storage/usage` (`packages/host/src/handlers/storage.ts:16-23`),
  readable by a tenant that is already blocked — it is the screen that tells them what to delete.

### The COS backend

`createCosObjectStore` (`packages/host/src/tenant-storage-cos.ts:291-583`) signs its own requests
rather than vendoring the SDK, because the adapter has to be provable against a stub in an
environment that cannot reach Tencent. `signCosRequest`
(`packages/host/src/tenant-storage-cos.ts:242-260`) is the v5 scheme:

```
SignKey      = HMAC-SHA1(SecretKey, KeyTime)
HttpString   = method\npath\nquery\nheaders\n
StringToSign = sha1\nKeyTime\nSHA1(HttpString)\n
Signature    = HMAC-SHA1(SignKey, StringToSign)
```

`host` is always signed; `content-length` and `content-type` are signed on a PUT; `range` is not,
because it changes which bytes come back and nothing about who may have them. Credentials come from
`COS_SECRET_ID`/`COS_SECRET_KEY` or, in production, the CVM instance role via the metadata service,
refreshed five minutes before expiry and only once per burst
(`createCredentialProvider`, `packages/host/src/tenant-storage-cos.ts:119-191`).

`measure` lists the tenant's prefix, following the marker through pages, and **filters every entry
through `isObjectKeyInsideTenant`** — the local tenant's prefix is empty, so a plain listing would
bill it for the whole bucket.

### ffmpeg, which cannot be handed bytes

`materializeTenantObject` (`packages/host/src/tenant-storage.ts:629-658`) is the one seam between an
object store and a process that takes a path. Under the file backend it returns the object's own
resolved path and copies nothing. Under COS it downloads once into `tenantObjectCacheRoot`
(`packages/host/src/tenant-paths.ts:104-106`), keyed by the SHA-256 of the key, reused while the size
still matches. That cache is **outside** `tenantJobRoots` on purpose: it is the host's cost, not the
tenant's, and charging a tenant twice for one video because the host had to make a local copy would
be wrong.

**The cache root has to be in the ffmpeg allowlist, or none of this works.** `editAllowlist`
(`packages/host/src/edit/ffmpeg/paths.ts:63-74`) lists three roots — the tenant's media root, the
project's scratch root, and the cache root — because under COS a materialized asset is in the third
and `assertInsidePath` refuses anything outside them. Without it every probe, frame, render, silence
scan and audio extract on a COS-backed asset fails as `path_denied` before ffmpeg is invoked. The
denials still run first, so the local tenant cannot reach another tenant's cache through it.

**Every writer of media bytes goes through the store.** `saveMedia`, the Edit import route
(`packages/host/src/handlers/edit.ts:70-99`) and the starter-media seeder
(`packages/host/src/edit/starter-media.ts:133-151`) all call `putTenantObject`; a writer that builds
a path from `mediaRoot()` and writes it is unmetered under the file backend and, under COS, writes to
a disk the read path never consults. `packages/host/src/tenant-storage-writers.test.ts` sweeps the
host tree for that shape, because the two writers above were missed by tests that named `saveMedia`.

## Where things live

| File | Role |
|---|---|
| `packages/core/src/storage/quota.ts` | The ceiling, the report and the admission test. Pure. |
| `packages/core/src/server-mode.ts:127-129` | `objectStorageKind` — the one variable that picks a backend |
| `packages/host/src/tenant-object-keys.ts` | What a key is and whose it is. Imported by both backends |
| `packages/host/src/tenant-storage.ts` | The interface, the file backend, the accounting, the quota |
| `packages/host/src/tenant-storage-cos.ts` | The COS backend: config, credentials, signature, five verbs |
| `packages/host/src/tenant-storage-store.ts` | The `tenant_storage` counter row |
| `packages/host/src/tenant-storage-db.ts` | Hands the store a connection; imported by `router.ts` |
| `packages/host/src/handlers/storage.ts` | `GET /api/v1/storage/usage` |
| `packages/db/drizzle/0019_tenant_storage.sql` | The counter table, and why it is a counter |

## Gotchas

- **Server mode does not turn COS on.** Two variables, on purpose (see the rule above). A box with
  `AGENTFORGE_SERVER=1` and no `AGENTFORGE_STORAGE` keeps writing to its disk, tenant-prefixed.
- **The quota is server-mode only.** Not a configuration choice: `tenantStorageLimitBytes` returns
  `null` off server mode before it reads the variable at all, so a desktop cannot be limited even by
  setting it. The desk's disk is the owner's own disk.
- **The job trees are counted but not pre-refused.** A dataset or an ffmpeg render is admitted on
  the inputs that were already admitted; only the object store checks a ceiling before writing. The
  report is still honest about the bytes, and the next object upload sees them.
- **`edit/<projectId>/…` was not tenant-prefixed before this phase.** `resolveGenerateAsset` wrote a
  bare `edit/<projectId>/<assetId>.<ext>` into the asset, which resolves at the media root's top
  level — inside `local-tenant`'s subtree and outside every hosted tenant's, so a hosted tenant's
  generated asset failed its own containment check and answered 404. It now goes through
  `mediaRelativePath` (`packages/host/src/edit/jobs.ts:264`). Desktop rows are unchanged, because
  the local tenant's prefix is empty.
- **`assetAbsPath` is async now.** It has to be: under COS the object may have to be fetched before
  ffmpeg can open it. Every call site was already inside an async function.
- **A COS listing is billed per request.** `measure` is for a seed and an operator's recompute, not
  for the request path — that is the whole reason the counter row exists.
- **Nothing migrates the existing `media/` tree into a bucket.** Turning `AGENTFORGE_STORAGE=cos` on
  over a populated disk makes every existing object unreadable until the tree is copied. The
  runbook's §12 owns that step; this phase deliberately ships no automatic mover.

## Verify

`packages/host/src/tenant-storage.test.ts` (the key guard in every spelling, two disjoint tenants,
the symlink, the quota, the seed-from-measure, the job trees),
`packages/host/src/tenant-storage-cos.test.ts` (the signature recomputed independently, each verb's
request line, the credential refresh, the listing walk, a foreign key never reaching the bucket),
`packages/host/src/handlers/storage.test.ts` (the routes through `dispatch`: an upload refused with
`storage_quota_exceeded`, the usage route readable while blocked, one tenant's media a 404 for
another) and `packages/db/src/migrate-0019.test.ts` (the table, the cascade, the journal ordering,
and that the migration really ran rather than being healed into place).

**Not driven.** No COS call has been made against a real bucket from this environment; the network
policy blocks it. That is the outstanding proof and it belongs on kyo's machine —
[`../web-phase6-tenant-storage.md`](../web-phase6-tenant-storage.md) §8 lists it step by step.

## Why

**Why a counter rather than a sum.** `[Direct]` the check runs on the upload path. Summing
`media.size_bytes` misses every byte that is not a media row and still scans; listing a COS prefix
is a billed, paginated call per upload. `[Direct]` Phase 5 lane B made the same call for
`tenant_plan.spent_usd_micros` (`packages/db/drizzle/0017_tenant_plan.sql`). **Confidence: high.**
The cost is drift, which is why `measured_at` and `recomputeTenantStorage` exist and why a fresh
tenant is seeded from a measure.

**Why the quota is one deployment-wide number and not a plan column.** `[Inferred]` a per-tenant
storage entitlement needs its own webhook event, its own top-up path and its own reconciliation
against the provider, none of which exists; Phase 5's adapter is still waiting on kyo's selling
entity. **Confidence: high for the reasoning, medium for the shape** — moving the ceiling onto
`tenant_plan` later changes `tenantStorageLimitBytes` and nothing else, which is why it is one
function.

**Why the signature is hand-rolled.** `[Direct]` this container cannot reach Tencent, so the only
way to prove the adapter here is to assert the bytes that would go on the wire; a mocked SDK proves
nothing about them. `[Direct]` the store needs five requests. **Confidence: high**, with the caveat
that "the signature matches Tencent's published algorithm" is proved by construction and by
recomputation in the test, not by a 200 from COS — that is the live test.
