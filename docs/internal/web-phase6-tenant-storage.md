# Phase 6 — per-tenant media and job storage, with COS and a quota

Record of the Phase 6 change. Plan: [`web-migration-plan.md`](web-migration-plan.md) §"Phase 6 — Media
and job storage per tenant". Map: [`maps/tenant-object-storage.md`](maps/tenant-object-storage.md).
Runbook: [`tencent-cvm-setup.md`](tencent-cvm-setup.md) §12, which this phase fills in.
Predecessors: [`web-phase3-lane-d.md`](web-phase3-lane-d.md) (the directory layout this builds on),
[`web-phase4-tenant-secrets.md`](web-phase4-tenant-secrets.md) (the mode-picked-backend pattern),
[`web-phase5-lane-b.md`](web-phase5-lane-b.md) (why a refusal is never `gateway_blocked`).

Branch `claude/web-phase6-tenant-storage-l9sxnd`, cut from `main` at `208ee85`.

The plan's done-when: **"Two tenants upload and render on the hosted server with disjoint trees, and a
disk quota per tenant is reported."**

---

## 1. What was actually wrong

Lane D gave every tenant a disjoint *directory*. Three things were still true afterwards, and this
phase is those three things:

1. **The disk was the only medium.** Every byte a tenant stored was on the CVM's data disk, inside
   the hourly backup tarball that the runbook already warns stops being workable as it grows
   ([`tencent-cvm-setup.md`](tencent-cvm-setup.md) §12). The media bucket from §5 step 5 existed and
   was empty because nothing in `packages/host/src` could talk to COS.
2. **Nothing bounded one tenant.** There was no ceiling of any kind on bytes. One tenant filling the
   disk is an outage for every other tenant on the box, and on a shared box that is a denial of
   service between paying customers rather than a hypothetical.
3. **A hosted tenant's generated Edit asset was unreachable.** `resolveGenerateAsset` wrote a bare
   `edit/<projectId>/<assetId>.<ext>` into the asset document. That resolves at the media root's top
   level — inside `local-tenant`'s subtree and *outside* every hosted tenant's — so
   `mediaFilePath`'s own containment check refused it and the asset answered 404. A lane D gap that
   only shows up for a tenant that is not the local one, which is why nothing caught it.

---

## 2. The rule

> **The backend is chosen by mode, never by tenant.** `AGENTFORGE_STORAGE=cos` → a COS bucket;
> anything else → the files lane D placed, at the exact paths lane D placed them.

This is Phase 4's rule with a different noun, and for the same reasons: there is no per-tenant branch
to get wrong, and **no fallback from one backend to the other at read time**. With `cos` set and the
bucket unconfigured, the store throws `storage_not_configured` rather than writing to the disk,
because a silent fall back to a directory nobody backs up is how a tenant's uploads disappear.

**Why a second variable rather than `AGENTFORGE_SERVER`.** A hosted server without a bucket is a real
deployment — it is the box as it stands today, and it is the runbook's own staging step. Tying object
storage to the server flag would have Phase 6 break every such box the moment it deployed. The
operator turns COS on when the bucket is ready and the tree has been copied into it; the desk can
never turn it on by accident, because the desk is not what sets deployment environment.

**Keys are the on-disk layout, spelled with slashes.** `tenants/<id>/<org>/<uuid>.png` in the bucket
is `<mediaRoot>/tenants/<id>/<org>/<uuid>.png` on disk, and `local-tenant` keeps the bare root in
both. A `media.storage_path` row written before this phase resolves verbatim under either backend, so
switching a deployment to COS is a copy of a tree rather than a rewrite of a database — and a desktop
data directory is byte-identical before and after this change, as it was after lane D and Phase 4.

---

## 3. What was built

### `packages/core/src/storage/quota.ts` — the arithmetic, with no IO

Pure, like `entitlement/types.ts`, so the rule that decides whether a tenant may store another 40 MB
is readable and testable without a SQLite file or a bucket.

| Export | Line | Does |
|---|---|---|
| `DEFAULT_TENANT_STORAGE_BYTES` | `:40` | 20 GiB, sized against the runbook's 200 GB data disk |
| `tenantStorageLimitBytes` | `:81-99` | `null` off server mode; the parsed variable or the default on it |
| `storageReport` | `:123-147` | used, limit, percent to one decimal, remaining, warning, blocked |
| `storageAdmission` | `:160-175` | may this write land — tested on the **resulting** total |
| `STORAGE_BLOCK` | `:65` | `storage_quota_exceeded` |

Three decisions live there and nowhere else:

- **The ceiling is a deployment value, not a plan column.** Phase 5 already owns per-tenant commercial
  limits in `tenant_plan`; a storage-shaped entitlement needs its own webhook event, its own top-up
  path and its own reconciliation, and Phase 5's provider adapter is still waiting on kyo's selling
  entity. One number per deployment is the honest shape for what this phase can enforce, and moving it
  onto the plan row later changes one function.
- **Junk falls back to the default, never to `null`.** `20GB`, `2e10`, `twenty` and `-5` all yield
  20 GiB. A typo in a deployment variable must not be the thing that removes the only bound between
  one tenant and the whole disk. `0`, `off`, `none` and `unlimited` turn it off *explicitly*.
- **Server mode only, by construction.** Off server mode the function returns `null` before it reads
  the variable at all, so a desktop cannot be limited even by setting it. The desk's disk is the
  owner's own disk, and a hosted default becoming a regression for someone who is not part of
  multi-tenancy would be a bug, not a feature.

### `packages/host/src/tenant-object-keys.ts` — whose key is this

`assertObjectKey` (`:45-71`) is the pure, filesystem-free twin of lane D's `isInsideTenantRoot`. It
refuses an empty key, one over 512 characters, a NUL, a backslash, a Windows drive letter, a leading
`/`, and any empty, `.` or `..` segment; then it requires this tenant's prefix, **per segment** — so
`tenants/tenant-alpha-2/…` is not inside `tenant-alpha`, which a `startsWith` test would have allowed.
For `local-tenant` the prefix is empty and the rule inverts: anything except `tenants/…`, which is
`tenantDeniedRoots` written as a string test.

It lives in its own module so the COS backend can check a key without importing the module that builds
one; the two would otherwise be an import cycle, and a cycle around a security guard is the kind of
thing that resolves differently under a bundler than under `tsx`.

A key that is not the caller's is a **404, not a 403**. A 403 tells the asker the object exists, which
turns the error into an existence oracle over everyone else's ids. That is the answer `mediaFilePath`
has given since lane D.

### `packages/host/src/tenant-storage.ts` — the interface, the disk, the quota

`TenantObjectStore` is seven methods: `put`, `read`, `readRange`, `head`, `remove`, `measure`,
`describe`. `fileObjectStore` (`:171-246`) implements them over `mediaRoot()`, resolving every key
through lane D's `resolveInsideTenantRoot` (`objectPath`, `:116-123`) — **two guards, not one**: the
string test runs before any IO in both backends, and the file backend then also resolves symlinks,
because a link planted inside a tenant's own subtree passes any lexical test while pointing anywhere
on disk. COS has no symlinks, so there the first guard is the whole story.

`putTenantObject` (`:445-462`) does three things in this order and no other:

1. `head()` the key, so an overwrite is charged the *difference* rather than the whole object again.
2. `assertStorageAdmits` (`:424-436`) — **before** the write, so a refusal never leaves a partial
   object behind.
3. `put()`, then `addTenantStorageBytes` — **after** the backend took the write, so a failed put never
   charges the tenant for bytes nobody stored.

`StorageQuotaError` (`:383-393`) is a flat 403 with code `storage_quota_exceeded`, the same shape as
`GatewayBlockedError` and `PlanBlockedError` and deliberately a third code. This is Phase 5 lane B's
rule, kept: `gateway_blocked` routes the renderer to the paste-your-key onboarding screen, whose only
exits are a key, a re-check or deleting a file on the server — none of which helps a tenant whose
actual problem is that their prefix is full.

`materializeTenantObject` (`:505-534`) is the one seam between an object store and a process that
takes a path. ffmpeg and ffprobe open files themselves and seek in them; they cannot be handed a
buffer. Under the file backend it returns the object's own resolved path and copies nothing. Under COS
it downloads once into `<tenantDataDir>/cache/objects/<sha256(key)>/`, reused while the size still
matches. **That cache is outside `tenantJobRoots` on purpose**: it is the host's cost, not the
tenant's, and charging a tenant twice for one video because the host had to make a local copy would be
wrong.

### `packages/host/src/tenant-storage-cos.ts` — the bucket

`createCosObjectStore` signs its own requests rather than vendoring `cos-nodejs-sdk-v5`. Three reasons,
stated because they are the first thing a reviewer will ask:

1. **This environment cannot reach Tencent.** The network policy blocks it, so the adapter has to be
   provable against a stub here and live on kyo's machine. An injectable `fetch` and an injectable
   clock make every byte of the signature and every request line assertable; a mocked SDK would prove
   nothing about what goes on the wire.
2. **Five requests.** PUT, GET (with `Range`), HEAD, DELETE, and the bucket listing.
3. **Credentials.** Production is the CVM instance role, whose temporary credentials expire and have
   to be refreshed; that belongs in view rather than buried in a dependency.

`signCosRequest` (`:241-259`) is Tencent's v5 scheme:

```
SignKey      = HMAC-SHA1(SecretKey, KeyTime)
HttpString   = method\npath\nquery\nheaders\n
StringToSign = sha1\nKeyTime\nSHA1(HttpString)\n
Signature    = HMAC-SHA1(SignKey, StringToSign)
```

`host` is always signed; `content-length` and `content-type` are signed on a PUT so neither can be
swapped in flight; `range` deliberately is not, because it changes which bytes come back and nothing
about who may have them. Encoding is RFC 3986 (`!'()*` escaped too) rather than `encodeURIComponent`'s
defaults — a file called `it's (final)!.png` would otherwise sign one way and be requested another.

`createCredentialProvider` (`:118-190`) takes `COS_SECRET_ID`/`COS_SECRET_KEY` when both are set, and
otherwise the CAM instance role through the metadata service, refreshed five minutes before expiry and
**once per burst** (the metadata service rate-limits; a cold process taking an upload burst would
otherwise call it once per file and lose an upload to the first 429).

`measure` walks the listing by marker and filters every entry through `isObjectKeyInsideTenant` — the
local tenant's prefix is empty, so a plain listing would bill it for the whole bucket. It is for a seed
and for an operator's recompute, never for the request path: a COS listing is billed per request, and
that is the whole reason the counter row exists.

### `tenant_storage` — migration `0019`

One row per tenant: `bytes_used`, `object_count`, `measured_at`, `updated_at`, cascading with the
tenant (like `tenant_state`, unlike the usage ledger — a byte count has no meaning without its tenant,
while spend has to outlive what it billed for).

**Why a counter and not a sum.** The check runs on the upload path. `SELECT SUM(size_bytes) FROM media`
misses every byte that is not a media row and still scans; listing a COS prefix is a billed, paginated
call per upload. This is exactly the call Phase 5 lane B made for `tenant_plan.spent_usd_micros`.

**The counter is a cache; the backend is the truth.** A tenant with **no row is seeded from a real
measure on first use** rather than from zero — otherwise an upgrade, or a restored data volume, would
declare an existing tree empty and hand that tenant a second whole allowance on top of what they
already hold. `measured_at` records the last reconciliation and `recomputeTenantStorage` (`:540-554`)
re-measures and overwrites.

The delta is applied **inside the SQL** (`max(0, bytes_used + ?)`), not read-modify-written in
JavaScript: two processes behind the proxy have no lock to hold between a read and a write, and the
clamp at zero stops a replayed delete from driving the counter negative and handing the tenant free
space.

**Numbering.** `when` is `1788820000012`, above 0018's `1788820000010` and 0017's `1788820000011`. The
runner is forward-only on `when`, so anything lower would be silently skipped on every database that
has already run those two, and the table would simply never exist on a live server.

### `GET /api/v1/storage/usage`

`{ usedBytes, objectBytes, jobBytes, objectCount, limitBytes, percent, remainingBytes, warning,
blocked, backend }`. Scoped by `getTenant(request)` like every other by-tenant route, and **readable by
a tenant that is already blocked** — the whole point of the number is to tell somebody who has just
been refused what to delete, so a route that refuses the blocked is a dead end in the one case it
exists for.

---

## 4. What the quota counts, and what it does not refuse

`usedBytes` is **objects plus the job trees that stay on local disk**: ffmpeg scratch under
`<tenantDataDir>/edit/` and dataset files under `<dataDir>/datasets/tenants/<id>/`. Those stay on disk
under either backend because the processes that write them — ffmpeg, and the in-memory SQLite dataset
runner — take file paths, not buffers. They are already disjoint per tenant from lane D; Phase 6
measures them (memoised for ten seconds, so an upload burst pays for the walk once) and counts them.

**What is enforced, honestly stated:** the ceiling is checked on every object write. A dataset upload
or an ffmpeg render is *not* pre-refused — the render's inputs were already admitted, and its output
size is not known before it runs. Both are still reported, and the next object write sees them. Closing
that gap means a pre-flight estimate on the render path, which is its own change.

---

## 5. What else changed, and why it had to

- **`packages/host/src/media.ts`** — `saveMedia` writes through `putTenantObject` instead of
  `mkdir`+`writeFile`; `readMediaDataUrl` reads through `readTenantObject`. The row it writes is
  unchanged, because the key *is* the `storage_path`.
- **`packages/host/src/handlers/media.ts`** — the byte-range route serves through the store, so a
  hosted deployment reads the bucket and a desk reads the file with the same check in front of both.
- **`packages/host/src/edit/jobs.ts:264`** — the bug in §1(3): the generated asset's `storagePath` now
  goes through `mediaRelativePath`, so a hosted tenant's asset is `tenants/<id>/edit/<projectId>/…`.
  **Desktop rows are unchanged**, because the local tenant's prefix is empty and the string is
  identical to what it was.
- **`assetAbsPath` is async now** (`edit/ffmpeg/recipes.ts`, five call sites in `edit/backend.ts` and
  `edit/jobs.ts`). It has to be: under COS the object may have to be fetched before ffmpeg can open it.
  Every call site was already inside an `async` function, so this is an `await` and nothing else.
- **`packages/db/src/migrate-0015.test.ts`** — `tenant_storage` added to the list of tables allowed to
  carry a `tenant_id`, with the reason, as each previous phase did.
- **`packages/db/src/migrate-0017.test.ts`** — "0017 sits last in the entries array" was true only
  while 0017 was the newest migration in the repository; 0019 made it red without anything being
  wrong. Rewritten to assert the **rule** it was a proxy for — ascending by `when`, and after 0018 —
  rather than deleted. (The same trap 0018's own test comment warns about.)

---

## 6. What did not change

- **The desktop.** `tenantStorageLimitBytes` is `null` off server mode, `AGENTFORGE_STORAGE` defaults
  to `file`, and the paths are lane D's paths. A desktop data directory is byte-identical before and
  after, `tenant_storage` stays empty, and no desk opens a database table to save an image.
- **`media.storage_path`, `datasets.storage_path`** and every row already written. Nothing is moved,
  nothing is rewritten.
- **Per-tenant process caps.** The plan's Phase 6 text also mentions per-tenant ffmpeg and SQL-worker
  concurrency on top of `child-processes.ts`. That is not in this change — it is a CPU-and-memory
  bound, not a bytes bound, and `AGENTFORGE_MAX_FFMPEG` / `AGENTFORGE_MAX_SQL_WORKERS` are still the
  global caps. See §9.
- **Nothing migrates the existing `media/` tree into a bucket.** Deliberate: the copy is an operator
  step with a rollback, and the runbook's §12(b) now spells it out. An automatic mover that runs at
  boot on somebody's only copy of their media is not something this phase should ship.

---

## 7. How this was verified

Everything below ran in this cloud container on the branch head. The container cannot reach Tencent,
so no COS call was made against a real bucket; §8 is that proof.

### Suites (all green)

| Suite | Result |
|---|---|
| `packages/host` | **209 files, 2221 tests, 0 failures** |
| `packages/core` | **186 files, 2283 passed, 1 skipped** |
| `packages/db` | **12 files, 154 tests, 0 failures** |
| `apps/web` | **96 files, 903 tests, 0 failures** |
| `tsc --noEmit` | clean for `packages/core`, `packages/host`, `packages/db`, `apps/web` |
| `pnpm lint` | 183 warnings, 30 infos, **0 errors** — unchanged from `main`; none in the new files |

The install used the documented cloud workaround for the blocked `cdn.sheetjs.com` tarball (xlsx
pinned to `0.18.5` for the run only). `packages/core/package.json`, `package.json` and
`pnpm-lock.yaml` were restored before committing and `git diff --name-only` confirms none of them
carries the downgrade.

### New tests — 75 cases

- `packages/core/src/storage/quota.test.ts` (16) — the desk is never limited; junk falls back to the
  default and not to unlimited; the admission test is on the resulting total; a write of zero bytes is
  never refused; the code is not `gateway_blocked`.
- `packages/host/src/tenant-storage.test.ts` (27) — every spelling that walks out of a prefix
  (`..`, `.`, `//`, leading `/`, backslash, drive letter, NUL, over-long, the neighbour's prefix, and
  `tenant-alpha-2` against `tenant-alpha`); the local tenant's inverted rule; a **symlink planted
  inside the tenant's own subtree** refused; two tenants disjoint; the local tenant not billed for
  `tenants/`; a refusal leaving no partial object; an overwrite charged the difference; a double
  delete not handing back bytes twice; **the counter seeded from a measure rather than zero**; the job
  trees counted; a drifted counter recomputed; the picker refusing rather than falling back.
- `packages/host/src/tenant-storage-cos.test.ts` (27) — the signature **recomputed independently** from
  Tencent's algorithm rather than pasted as a magic string; the header and parameter lists; RFC 3986
  encoding; each verb's exact request line and headers; 404 vs 502 mapping; 416 answered from the HEAD
  with no GET; the credential refresh once per burst; the listing walked by marker; the local tenant
  not billed for the bucket; and **a foreign key producing zero HTTP calls**.
- `packages/host/src/handlers/storage.test.ts` (8) — through `dispatch`: the report's numbers, each
  tenant seeing only its own, the route readable while blocked, 401 without a session, an upload
  refused with `storage_quota_exceeded`, one tenant not charged for another's upload, and one tenant's
  media id answering 404 for another.
- `packages/db/src/migrate-0019.test.ts` (13) — the columns, the defaults, one row per tenant, the
  cascade, the foreign key, the other phases' tables untouched, the journal ordering, the healer, and
  — the lesson from lane B — that the migration **actually ran**, asserted on the
  `__drizzle_migrations` row stamped with its own `when`, because `ensureSchema` runs the healers
  afterwards and "the table exists" proves nothing.

### The verify skill, driven

`node .cursor/skills/verify-agentforge/scripts/doctor.mjs --base http://127.0.0.1:3207` against an
isolated stub instance on its own data directory (`AGENTFORGE_DATA_DIR=/tmp/af-phase6`, port 3207, as
Phase 4 did): **`OK — stub runtime`**. Then, through the real routes:

| Step | Result |
|---|---|
| `GET /api/v1/storage/usage` on a fresh desk | `{"usedBytes":0,"limitBytes":null,"percent":null,"blocked":false,"backend":"file"}` |
| `POST /api/v1/media` with an 11-byte PNG | `201`, id `51bf9e94…` |
| the file on disk | `/tmp/af-phase6/media/6d00b911…/51bf9e94….png` — the pre-Phase-3 layout, unprefixed, exactly as a desk should be |
| `GET /api/v1/storage/usage` after | `{"usedBytes":11,"objectCount":1,"objectBytes":11,"jobBytes":0,"limitBytes":null}` |
| `GET /api/v1/media/<id>/file` | `200`, 11 bytes, `image/png`, **byte-identical** to what was uploaded |
| the same with `Range: bytes=2-5` | `206`, 4 bytes |
| `GET /api/v1/media/<unknown-id>/file` | `404 not_found` |

### Maps

`pnpm maps:check`: **77 docs, 2195 citations, 0 hard, 143 soft** — the new page contributes 24
citations and **zero** warnings of either kind (checked by running with and without it: 143 soft in
both). Every citation on the new page was re-anchored by hand after formatting, because
`map-drift --write` re-points citations onto import lines.

---

## 8. Live tests still owed on kyo's machine

Numbered, in the order they make sense to run. Nothing below can be done from the cloud container.

1. **A desk is unchanged.** Open an existing DPSBuddy data directory. Every image, video and Edit
   project still opens, and `<dataDir>/tenants/` is still absent. Nothing should have moved.
2. **The usage route on a desk.** `GET http://127.0.0.1:3000/api/v1/storage/usage` reports
   `limitBytes: null` and a `usedBytes` that matches the size of `media/` plus `edit/` plus
   `datasets/` (`du -sb`). A desk is never blocked.
3. **Two tenants, disjoint, on a server.** With `AGENTFORGE_SERVER=1`, sign in as two portal users.
   Each uploads an image. Confirm two subtrees under `media/tenants/`, and that pasting tenant A's
   media URL into tenant B's browser answers **404**, not 403.
4. **The ceiling refuses, and says the right thing.** Set `AGENTFORGE_TENANT_STORAGE_BYTES` to
   something small (say `1048576`), restart, and upload past it. The response is
   **`403 storage_quota_exceeded`**, the renderer shows a storage message, and it does **not** send
   the tenant to the paste-your-key onboarding screen. `GET /api/v1/storage/usage` still answers 200
   for that blocked tenant, with `blocked: true` and `remainingBytes: 0`.
5. **The warning.** Upload to between 80% and 100% of the ceiling; the report carries
   `warning: "storage_low"` and the write still goes through.
6. **The counter survives a restart and is not double-counted.** Note `usedBytes`, restart the app,
   read it again: the same number. Re-upload the same object (same key) and confirm the counter moves
   by the *difference*, not by the whole object.
7. **COS, the first time.** Follow [`tencent-cvm-setup.md`](tencent-cvm-setup.md) §12(a) and (b): widen
   the CAM policy (including **`GetBucket`**), `coscli sync` the tree, stop the app, sync again, set
   `AGENTFORGE_STORAGE=cos`, start. Then:
   - a **new** upload appears in the bucket under `tenants/<id>/…` (check the console), and not on disk;
   - an **old** image, uploaded before the switch, still renders — that is what proves the sync;
   - scrubbing a video works (the byte-range path against COS);
   - `GET /api/v1/storage/usage` reports `backend: "cos"` and a plausible `usedBytes`.
8. **The instance role, not a key pair.** Confirm `COS_SECRET_ID` and `COS_SECRET_KEY` are **empty** in
   `.env` on the CVM and that uploads still work through `COS_CAM_ROLE`. Then check the app log for a
   single credential fetch rather than one per upload.
9. **A misconfiguration fails closed.** Temporarily blank `COS_MEDIA_BUCKET` with
   `AGENTFORGE_STORAGE=cos` and confirm the app refuses (`storage_not_configured`) rather than writing
   to the disk. Put it back.
10. **Edit, end to end, as a hosted tenant.** Generate an image inside an Edit project as a tenant that
    is **not** `local-tenant`, and confirm the generated asset renders on the timeline. This is the
    §1(3) bug; before this change it answered 404 for every hosted tenant.
11. **Rollback.** Set `AGENTFORGE_STORAGE` back to `file` with the disk tree still present and confirm
    everything renders again. Do this once before deleting the tree.
12. **The backup is still honest.** Run `backup.sh` after the switch and confirm the tarball no longer
    carries media, then turn **versioning on** for the media bucket — §12(d). The bucket becomes the
    only copy of tenants' uploads, which is a decision to make deliberately rather than discover.

---

## 9. Open items this phase leaves

| Item | Owner |
|---|---|
| **Per-tenant ffmpeg and SQL-worker concurrency caps.** The plan's Phase 6 text names them; this change is bytes only. `AGENTFORGE_MAX_FFMPEG` and `AGENTFORGE_MAX_SQL_WORKERS` are still global, so one tenant can still queue everybody else's renders behind theirs. | none — needs a decision on whether a cap is per tenant or weighted |
| **A render is not pre-refused on quota.** Its output size is unknown before it runs (§4). A pre-flight estimate on the render path would close it. | none |
| **The quota is one deployment-wide number.** Moving it onto `tenant_plan` needs Phase 5's provider adapter, which waits on kyo's selling entity. It is one function when that lands. | Phase 5 follow-up |
| **No automatic migration of the `media/` tree.** Deliberate (§6); the operator step is §12(b). A one-shot `scripts/` mover with a dry run would be a reasonable follow-up. | none |
| **The COS cache is never evicted.** `<tenantDataDir>/cache/objects/` grows with every distinct asset ffmpeg touches. It is uncounted host cost, so it does not affect a tenant, but it does fill a disk eventually. A size-bounded LRU or a sweep on boot. | none |
| **`GET /api/v1/storage/usage` has no screen.** The route exists and is tested; nothing in `apps/web` renders it yet, so a tenant sees the refusal without seeing the number. | Phase 8, with the other hosted surfaces |
| **A delete path for media.** `removeTenantObject` exists and is tested, but no route calls it — there is no "delete this image" anywhere in the product, so a tenant that hits the ceiling today can only ask an operator. Worth pairing with the screen above. | none |
