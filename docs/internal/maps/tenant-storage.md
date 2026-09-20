# Map — Per-tenant storage and state

Last verified: 2026-09-20 at a504555

## Overview

Where a tenant's bytes live, and the one rule that decides it. Phase 3 lane D turned three per-install
files and four storage roots into per-tenant ones. This page is about **paths**: which directory a
tenant's secrets, gateway verdict, usage log, media, datasets, matters and ffmpeg scratch land in, and
what stops one tenant reaching another's.

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
| `media.storage_path` | `<orgId>/<uuid>.<ext>` | `tenants/<id>/<orgId>/<uuid>.<ext>` |
| `datasets.storage_path` | `<deskId>/<uuid>.<ext>` | `tenants/<id>/<deskId>/<uuid>.<ext>` |
| Knowledge upload | `<mediaRoot>/knowledge/<orgId>/…` | `<mediaRoot>/tenants/<id>/knowledge/<orgId>/…` |

Nothing moves on upgrade, and every `storage_path` already in `media` or `datasets` resolves verbatim,
because the local tenant's relative paths are exactly the ones those rows already hold.

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
`requireGatewayAllowedFor(tenant)` (`packages/host/src/gateway-gate.ts:463-468`). A bare desk id still
works on the desktop and on webdev, and **throws `tenant_required` in server mode**
(`resolveSettingsScope`, `packages/host/src/settings-store.ts:44-56`) rather than silently reading the
local tenant's file.

Background work has no request. Lane C's note ([`../web-phase3-lane-c.md`](../web-phase3-lane-c.md)) is
that it must carry the tenant rather than resolve one; the edit job runner does that with
`workerTenantId(projectId)` (`packages/host/src/edit/ops.ts:110-130`), the twin of lane A's
`workerWorkspaceId`, and `edit/edit-scope.test.ts` fails if a handler imports either.

## Where things live

| File | Role |
|---|---|
| `packages/host/src/tenant-paths.ts` | The rule, the validation, the containment test |
| `packages/host/src/media-root.ts` | `mediaRoot`, `tenantMediaRoot`, `mediaRelativePath`, `mediaFilePath` |
| `packages/host/src/settings-store.ts` | `SettingsScope`, `resolveSettingsScope`, the per-tenant `settings.enc` |
| `packages/host/src/gateway-gate.ts` | `statePath(tenantId)`, the per-tenant verdict file, `requireGatewayAllowedFor` |
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
- **The locale is deliberately not per tenant.** The host freezes one boot locale
  (`packages/host/src/locale-boot.ts:11-16`) that every catalogue reads, so `loadOwnerLocale` /
  `saveOwnerLocale` stay on the local tenant's file (`settings-store.ts:452-466`). Making it per tenant
  means threading it through `run-context.ts`; that is open, not done.
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
