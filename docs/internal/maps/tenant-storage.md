# Map — Per-tenant storage and state

Last verified: 2026-09-23 at d4561b8 + uncommitted tree for "Requests, and work that outlives them" (the
`ops.ts` citations, `workerTenant` and the per-tenant Edit metrics file) and the metrics row of the layout table.
Everything else was last verified 2026-09-20 at a053245 + the Phase 4 branch
`feat/web-phase4-tenant-secrets-rcbu9c`.

## Overview

Where a tenant's bytes live, and the one rule that decides it. Phase 3 lane D turned three per-install
files and four storage roots into per-tenant ones. This page is about **paths**: which directory a
tenant's secrets, gateway verdict, usage log, media, datasets, matters and ffmpeg scratch land in, and
what stops one tenant reaching another's.

Phase 6 put the media half of this behind an object-storage interface with a COS backend and a
per-tenant quota: that is [`tenant-object-storage.md`](tenant-object-storage.md), which depends on
the rule below rather than replacing it. The paths on this page are still the paths, and a COS
object key is the same string with slashes.

It is **not** about who a request belongs to — that is [`tenant-resolution.md`](tenant-resolution.md),
lane C — and not about row scoping in SQL, which is per table and lives in each subsystem's own map.

## How it works

### The rule

> **`local-tenant`'s storage root is the install root itself; every other tenant gets a
> `tenants/<tenantId>/` subtree inside it.**

`local-tenant` (`packages/core/src/local-owner.ts:7`) is not a tenant anybody signed up for: it is the id
migration `0015` stamps onto the single organization every pre-Phase-3 database already had. Its files
*are* the install's files. Giving it a prefix would mean moving a desktop owner's media, matters and
`settings.enc` on upgrade, so it keeps the layout it has:

| | `local-tenant` (desktop, webdev, an upgraded server) | any other tenant |
|---|---|---|
| Data dir | `<dataDir>` | `<dataDir>/tenants/<tenantId>` |
| Media root | `<mediaRoot>` | `<mediaRoot>/tenants/<tenantId>` |
| Secrets | `<dataDir>/settings.enc` | `<dataDir>/tenants/<id>/settings.enc` |
| Gateway verdict | `<dataDir>/gateway-gate.json` | `<dataDir>/tenants/<id>/gateway-gate.json` |
| Usage log (legacy, read-only) | `<dataDir>/desk-usage.json` | `<dataDir>/tenants/<id>/desk-usage.json` |
| Legal matter | `<dataDir>/legal/<deskId>/<matterId>/` | `<dataDir>/tenants/<id>/legal/<deskId>/<matterId>/` |
| Meeting | `<dataDir>/meetings/<deskId>/<meetingId>/` | `<dataDir>/meetings/tenants/<id>/<deskId>/<meetingId>/` |
| ffmpeg scratch | `<dataDir>/edit/<projectId>/` | `<dataDir>/tenants/<id>/edit/<projectId>/` |
| Edit metrics (since 2026-09-23; `metricsFile`, `packages/host/src/edit/metrics.ts:56`) | `<dataDir>/edit/metrics.jsonl` | `<dataDir>/tenants/<id>/edit/metrics.jsonl` |
| `media.storage_path` | `<orgId>/<uuid>.<ext>` | `tenants/<id>/<orgId>/<uuid>.<ext>` |
| `datasets.storage_path` | `<deskId>/<uuid>.<ext>` | `tenants/<id>/<deskId>/<uuid>.<ext>` |
| Knowledge upload | `<mediaRoot>/knowledge/<orgId>/…` | `<mediaRoot>/tenants/<id>/knowledge/<orgId>/…` |

Nothing moves on upgrade, and every `storage_path` already in `media` or `datasets` resolves verbatim,
because the local tenant's relative paths are exactly the ones those rows already hold.

**Phase 4: two of those rows are files only on a desk.** The secrets payload and the gateway verdict now go
through a backend chosen by mode — the files above off server mode, `tenant_state` rows on the hosted server
(`tenantStateBackend`, `packages/host/src/tenant-state-store.ts:319-321`). The desktop column is unchanged
by construction: the file backend maps each payload back to exactly the filename in the table
(`TENANT_STATE_FILENAMES`, `packages/host/src/tenant-state-store.ts:48-51`), so an existing data directory
opens with nothing moved. Every other row on this table is still a path in both modes; moving media and job
storage off the disk is Phase 6. See [`tenant-secrets-backend.md`](tenant-secrets-backend.md).

### The one place that knows

`packages/host/src/tenant-paths.ts` is the only module that turns a tenant into a directory.

| Export | Line | What it answers |
|---|---|---|
| `assertTenantId` | `:36-41` | Is this id safe to put in a path? `[A-Za-z0-9_-]{1,80}`, and never the literal `tenants` |
| `assertPathSegment` | `:48-53` | Same, for a caller-supplied segment (an org id, a desk id, a project id) |
| `tenantSegments` | `:60-62` | `[]` for the local tenant, `["tenants", id]` otherwise |
| `tenantScopedRoot` | `:65-67` | A shared root, narrowed to one tenant |
| `tenantRelativePath` | `:74-85` | The `/`-joined value that goes in a `storage_path` column |
| `tenantDataDir` | `:87-89` | `tenantScopedRoot(localDataDir(), id)` |
| `tenantDeniedRoots` | `:95-97` | The exception below |
| `isInsideTenantRoot` | `:117-124` | "Is this path this tenant's?" — the check every guard should use |

`tenantMediaRoot`, `mediaRelativePath` and `mediaFilePath` sit in `packages/host/src/media-root.ts:17-40`
because they are media-root-specific; they all delegate to the helpers above.

### The exception, and why it is explicit

The rule costs one thing: a second tenant's subtree sits **inside** the local tenant's root, so "is this
path mine?" is not a plain prefix test for `local-tenant`. `tenantDeniedRoots(root, tenantId)`
(`tenant-paths.ts:95-97`) returns `[<root>/tenants]` for the local tenant and `[]` for everyone else, and
`isInsideTenantRoot` checks it. `assertInsidePath` (`packages/host/src/edit/ffmpeg/paths.ts:82-126`)
checks denials **first**, so a denial always beats a root.

That matters most for ffmpeg, whose input paths come out of a project document an agent can write:
`editAllowlist({ tenantId, projectId })` (`paths.ts:63-74`) is that tenant's media root plus that
project's scratch dir, with the denial list attached.

### Requests, and work that outlives them

A handler has a `TenantContext` and passes it: `loadSettings(tenant)`,
`requireGatewayAllowedFor(tenant)` (`packages/host/src/gateway-gate.ts:484-489`). A bare desk id still
works on the desktop and on webdev, and **throws `tenant_required` in server mode**
(`resolveSettingsScope`, `packages/host/src/settings-store.ts:45-57`) rather than silently reading the
local tenant's file.

Background work has no request. Lane C's note ([`../web-phase3-lane-c.md`](../web-phase3-lane-c.md)) is
that it must carry the tenant rather than resolve one; the edit job runner does that with
`workerTenantId(projectId)` (`packages/host/src/edit/ops.ts:119-121`), the twin of lane A's
`workerWorkspaceId`, now backed by `workerProjectScope` (`:135-151`), which reads the project's tenant,
organization and desk off its row. `edit/edit-scope.test.ts` fails if a handler imports any of them.

**A generate job needs a whole tenant, not a directory (2026-09-23).** It spends a gateway key, writes a
ledger row, lands media and a work card on a desk and may read a still, and each of those is decided by the
`TenantContext` it runs under. That context used to come out of the job's own stored request, which
`POST …/edit/projects/:projectId/jobs` wrote from a request body, so a caller could name another tenant's
([`SR-67`](../security-register.md#sr-67)). `workerTenant(projectId, requestedBy)`
(`packages/host/src/edit/ops.ts:174-188`) now assembles it: tenant, organization and desk from the project,
the user from `requestedBy` — which only server code writes, from a tenant it had already verified — and the
whole thing through `resolvePortalTenant`, the same read-only resolver a hosted session uses, so a requester
who has left the organization does not run. With no recorded requester the job fails closed. The Edit metrics
writer uses `workerProjectScope` the same way, filing each line under the project's own tenant and
organization in that tenant's data directory (`<dataDir>/tenants/<id>/edit/metrics.jsonl`; the local tenant
keeps `<dataDir>/edit/metrics.jsonl`) — see [`edit-timeline.md`](edit-timeline.md) § 4.

## Where things live

| File | Role |
|---|---|
| `packages/host/src/tenant-paths.ts` | The rule, the validation, the containment test |
| `packages/host/src/media-root.ts` | `mediaRoot`, `tenantMediaRoot`, `mediaRelativePath`, `mediaFilePath` |
| `packages/host/src/settings-store.ts` | `SettingsScope`, `resolveSettingsScope`, the per-tenant secrets payload |
| `packages/host/src/gateway-gate.ts` | The per-tenant verdict, `requireGatewayAllowedFor` |
| `packages/host/src/tenant-state-store.ts` | Phase 4 — which of the two the secrets and the verdict actually use, and the desktop filenames |
| `packages/host/src/desk-usage.ts` | The legacy usage file, now read per tenant |
| `packages/host/src/edit/ffmpeg/paths.ts` | `EditScope`, `PathAllowlist`, `editScratchRoot`, `editAllowlist` |
| `packages/host/src/legal/store-files.ts` | `tenantLegalRoot`, `matterDir`, `listMatterIds` |
| `packages/host/src/meeting/store-files.ts` | `tenantMeetingRoot`, `meetingDir`, `listMeetingIds` |
| `packages/host/src/datasets.ts` | `storagePath` and the `filePath` containment check |
| `packages/host/src/knowledge.ts` | `uploadDir` — knowledge uploads under the tenant media root |

## Gotchas

- **The local tenant has no prefix.** Code that assumes every tenant's path starts `tenants/` is wrong,
  and a test asserting `tenants/local-tenant/…` is asserting the opposite of the desktop guarantee.
- **`tenants` is a reserved name.** `assertTenantId` and `assertPathSegment` both refuse it, because with
  an empty prefix a segment spelled `tenants` would be indistinguishable from another tenant's subtree.
- **Old rows keep their old path.** `media.storage_path` and `datasets.storage_path` are read verbatim;
  only new writes take a prefix. `mediaFilePath` still refuses a row whose path is not this tenant's.
- **The locale is per user, not per tenant.** Phase 4 closed the lane-D gap, but not by making the locale
  a tenant thing: a person's language is stored against their portal user id inside their own tenant's
  payload (`loadUserLocale` / `saveUserLocale`, `packages/host/src/settings-store.ts:582-613`), because two
  people on one hosted tenant read different languages. The host still freezes one boot locale
  (`getBootLocale`, `packages/host/src/locale-boot.ts:15-20`) and `loadOwnerLocale` / `saveOwnerLocale`
  (`packages/host/src/settings-store.ts:564-572`) still name the install's, which is what a desk renders
  in; in server mode nothing is frozen per user and `localePayload` answers from the caller
  (`packages/host/src/locale-boot.ts:55-61`). Threading it through `run-context.ts` for background work is
  still open — a chat run takes it from the caller's tenant (`packages/host/src/runs.ts:159`), but a job
  the edit runner picks up off-request has no user to read.
- **`desk-usage.json` is legacy and read-only.** The spec wants a `tenant_usage` row; Phase 5 built that
  table on migration `0016` (PR #74, [`tenant-usage-ledger.md`](tenant-usage-ledger.md)) and nothing writes
  the file any more. Lane D scoped what still *reads* it, so a hosted tenant does not inherit the install's
  pre-migration rows. `appendDeskUsage` survives for the reader tests; no production call site may use it.
- **"Start over" is still refused in server mode** (`handlers/settings.ts`), so `tenants` in
  `HOST_RESET_ENTRIES` is belt and braces for a webdev instance that resolved a second tenant.

## Verify

No dedicated feature file: these are paths, not a screen. The proof is
`packages/host/src/tenant-paths.test.ts` (disjoint paths, traversal, the local-tenant exception, the
desktop layout) and `packages/host/src/tenant-state.test.ts` (two tenants, two keys, two verdicts;
`clearGatewayKeyEverywhere` clears one tenant; server mode refuses a bare desk id). The screens that sit
on top are verified by `features/settings.md`, `features/gateway-gate.md` and `features/edit.md`.

**Not driven.** Nothing here has been exercised against a running instance with two real tenants; that is
the outstanding proof, and it belongs on kyo's machine.

## Why

**Why the local tenant keeps the bare root.** `[Direct]` the lane brief requires "desktop mode must keep
opening the existing data directory unchanged", and the spec's own §3(f) says "no file moves, so the
desktop's media keeps resolving" ([`../web-phase3-tenancy-spec.md`](../web-phase3-tenancy-spec.md)).
`[Direct]` migration `0015` backfills `organizations.tenant_id` with `local-tenant`
(`packages/core/src/local-owner.ts:2-7`), so the pre-Phase-3 install *is* that tenant. **Confidence:
high.** The spec's §3(f) snippet spells the media path `${tenantId}/${organizationId}/…` for every
tenant, including the local one; this page's rule differs there on purpose, and
[`../web-phase3-lane-d.md`](../web-phase3-lane-d.md) §3 records the trade.

**Why denials are checked before roots.** `[Inferred]` with an empty prefix the local tenant's root
contains every other tenant's, so a root-only test would accept `<mediaRoot>/tenants/<other>/x.mp4` for
the local tenant. Making the exception a first-class `denied` list rather than a deeper root keeps one
containment function correct for both cases. **Confidence: high for the mechanism; the alternative
(a per-org legacy root) was rejected because it needs the org id everywhere a tenant id would do.**
