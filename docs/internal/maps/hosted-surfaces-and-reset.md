# Map — Hosted surfaces, per-tenant reset and health

Last verified: 2026-09-21 at 1b73999 plus this branch (Phase 8); re-stamp with the merge sha. Re-checked
2026-09-23 at d4561b8 + uncommitted tree: the Storage card row's citation, and the note on the refresh
tokens a reset now keeps (§ 2).

## Overview

Phase 8 of the web migration: the last phase. Three things live here. **Capability flags** are one
resolved answer to "what can this deployment do", put on `GET /api/v1/ping` by the host and read by
the renderer, so a control that is Electron-only is hidden where it cannot work and refused by its
own route if somebody calls it anyway. **The per-tenant reset** is the hosted account erase — the
answer to "Start over" for somebody who does not own the machine. **Health** is two routes: an
unauthenticated liveness probe for the proxy and the container, and a session-gated readiness
report for an operator.

Folded in from Phase 6 and listed here because they share the same screens: the storage-usage card,
`DELETE /api/v1/media/:mediaId`, and the quota check rewritten as a conditional SQL update.

What this page is **not**: the transport contract (that is
[hosted-server-mode.md](hosted-server-mode.md)), the object store itself
([tenant-object-storage.md](tenant-object-storage.md)), or the desktop's own "Start over"
([settings-and-gateway-gate.md](settings-and-gateway-gate.md)), which is unchanged.

## How it works

### 1. One switch, twelve flags

`hostCapabilities(env = process.env)` (`packages/core/src/capabilities.ts:89-108`) resolves every
flag from `isServerMode(env)` (`packages/core/src/server-mode.ts:12`) and from nothing else. Each
flag is true on exactly one of the two targets, which
`packages/core/src/capabilities.test.ts:35-45` asserts as a rule rather than as twelve assertions —
a thirteenth flag added without a decision fails there.

| Flag | True on | What it governs |
|---|---|---|
| `sessions` | server | a browser session exists at all |
| `singleOwner` | desk | one local owner, no sign-in |
| `storageQuota` | server | the ceiling and the usage card |
| `objectStorage` | server | bytes live behind the store, not on this disk |
| `plans` | server | the Phase 5 allowance and seats |
| `relaunch` | desk | the shell can restart itself |
| `updater` | desk | the auto-updater |
| `nativeFilePicker` | desk | the OS file dialog |
| `localPaths` | desk | a caller-named path may be read |
| `startOver` | desk | `scope: "all"`, the data-dir wipe |
| `tenantReset` | server | `scope: "tenant"`, the account erase |
| `componentInstall` | desk | a runtime component install |

They ride on ping: `handlePing` (`packages/host/src/handlers/misc.ts:101`) puts `capabilities` in the
body. Ping is the right home because it is ungated, it is the renderer's first fetch on boot, it is
identical over both transports, and it carries nothing per-tenant — none of which is true of
`GET /api/v1/settings`.

The renderer reads it once. `pingOnce()` (`apps/web/lib/host-ping.ts:20-25`) memoises the promise,
so the brand provider and the capabilities provider share one request — two would race to mint the
CSRF cookie on the first `/api` GET and one would lose its token.
`HostCapabilitiesProvider` (`apps/web/lib/host-capabilities.tsx:61`) puts the parsed answer in
context; `EVERYTHING_OFF` (`:29`) is what a consumer reads before ping answers and what it keeps if
ping fails. `parseCapabilities` (`packages/core/src/capabilities.ts:117`) reads every unknown as
`false`, so a surface stays hidden until the host has said it exists.

`relaunch`, `updater` and `nativeFilePicker` are ANDed with the bridge by their consumers —
`hasDesktopShell` and `hasNativeFilePicker` (`apps/web/lib/host-capabilities.tsx:44`, `:50`) — because
the host can only say a shell is *possible* here; only the renderer sees whether a preload attached.
That is the distinction `isElectron()` alone could never draw: it is false on webdev and on the
hosted server alike, and webdev has "Start over" while the hosted server must not.

**A hidden button is a courtesy; the refusal is the control.** Every flag has a route behind it:

| Surface | Flag that hides it | Route that refuses it | Code | Test |
|---|---|---|---|---|
| Start over | `startOver` | `POST /api/v1/settings/reset` `scope: "all"` | `RESET_DISABLED_CODE` 403 (`packages/host/src/handlers/settings.ts:385`, refused in `resetEverything` at `:426`) | `packages/host/src/tenant-reset.test.ts` |
| Erase account | `tenantReset` | same route, `scope: "tenant"` | `TENANT_RESET_DISABLED_CODE` 403 (`packages/host/src/tenant-reset.ts:79`, refused in `resetTenant` at `:266`) | `packages/host/src/tenant-reset.test.ts` |
| Native file picker | `nativeFilePicker` | — (renderer only; the import route is the control) | `apps/web/components/edit-studio.tsx` | `apps/web/lib/host-capabilities.test.tsx` |
| Import by path | `localPaths` | `POST /api/v1/edit/projects/:projectId/import` with `sourcePath` | `LOCAL_PATH_DISABLED_CODE` 403 (`packages/host/src/handlers/edit.ts:197`, refused in `handlePostEditImport` at `:227`) | `packages/host/src/edit/local-path-refusal.test.ts` |
| Component install | `componentInstall` | `POST /api/v1/components/install` | `install_disabled` 403 (Phase 7) | `packages/host/src/components/server.test.ts` |
| Relaunch / updater | `relaunch`, `updater` | — (IPC only; there is no hosted transport for them) | `apps/web/components/settings-reset-card.tsx` | `apps/web/lib/host-capabilities.test.tsx` |
| Storage card | `storageQuota` | `GET /api/v1/storage/usage` answers a desk with `limitBytes: null` | the `storageQuota` guard, `apps/web/components/settings-storage-card.tsx:146` | `apps/web/lib/host-capabilities.test.tsx` |

Nothing is deleted from the desktop build; every rule above is a branch on one flag, and with the
flag off the code takes the path it took before.

### 2. The per-tenant reset

`POST /api/v1/settings/reset` with `{ scope: "tenant", confirm: "RESET" }`. A **third scope** rather
than a hosted branch inside `"all"`, so an existing desk client's request never changes meaning and
neither target's button can reach the other's behaviour (`packages/host/src/handlers/settings.ts:491-494`;
`RESET_SCOPES` in `apps/web/lib/reset-app.ts`).

`resetTenant(tenant, confirm)` (`packages/host/src/tenant-reset.ts:265`) refuses in this order, and
every refusal happens before anything is deleted:

1. off server mode → `TENANT_RESET_DISABLED_CODE` 403 (`:266-268`)
2. `tenant.role !== "owner"` → `TENANT_RESET_FORBIDDEN_CODE` 403 (`resetTenant`, `:272-274`) — never `gateway_blocked`
3. wrong or missing confirmation → `invalid_request` 400 (`:275-279`)
4. `assertPurgeableTenant(tenant.tenantId)` (`packages/host/src/tenant-object-keys.ts:96`) → the
   local tenant's prefix is the whole store, so a mis-resolved id hits a wall before the `rm -rf`

Then, in order (`:286-347`): open an audit row as `started` → `purgeTenantRows` in one transaction →
`removePrefix` through the configured store → the local job trees → forget the memoised job bytes →
clear the gateway key, the gate verdict and the circuit breakers → **`ensurePortalOwner` to put the
account back, then `restoreOrgMembers` to put everybody else back with their roles** → close the
audit as `completed`. A throw closes it `failed` with a category-only
`detail` and rethrows.

Step 6 is not optional. `resolvePortalTenant` only reads, so a reset that deleted `organizations`
and stopped there would leave the tenant's own live session answering `org_inactive` on its very
next request, with no way back in from the UI. Re-provisioning restores the org under the same id,
the memberships and a fresh home desk.

**What the purge takes is decided by the schema, not by a hand-written list.**
`packages/db/src/tenant-purge.ts` classifies every table into one of five buckets —
`CASCADED_TABLES` (`:55`), `WORKSPACE_SCOPED_TABLES` (`:83`), `TENANT_SCOPED_TABLES` (`:102`),
`KEPT_TENANT_TABLES` and `SHARED_TABLES` — and `packages/db/src/tenant-purge.test.ts` fails when a
real table is in none of them or in two. A table added later cannot silently survive a reset.
`purgeTenantRows` (`:175`) resolves the workspace ids, deletes the workspace-scoped tables per id,
deletes `organizations WHERE tenant_id = ?` (`CASCADE_ROOT_TABLE`, `:139`) and lets SQLite's cascade
take the rest, then the tenant-scoped tables — all inside one `sql.transaction`.

Kept on purpose: `tenants`, `tenant_plan`, `tenant_seat`, `tenant_usage`, `billing_events`,
`tenant_reset_audit`, and `auth_sessions` — a reset empties an account, it does not sign its people
out (`KEPT_TENANT_TABLES`, `packages/db/src/tenant-purge.ts:124`). Since 2026-09-23 each of those rows
also holds the session's portal refresh token, sealed (`refresh_sealed`, migration 0021), so the sessions an
erase keeps now survive a restart as well. Whether Erase account should end them is an open owner
decision, [SR-65](../security-register.md#sr-65).

Keeping `auth_sessions` is not on its own enough to keep them signed in: `organization_members` is
cascaded, and a session whose membership row is gone resolves to `user_inactive`. So `resetTenant`
reads the org's memberships before the purge (`readOrgMembers`) and re-inserts them with their roles
after `ensurePortalOwner` (`restoreOrgMembers`), `INSERT OR IGNORE` so a retry is a no-op. Without
that, every other member is locked out until they sign in again — and comes back as an **owner**,
because the `organizationMembers` insert in `ensurePortalOwner`
(`packages/db/src/portal-owner.ts:131-138`) gives a member with no membership row the `owner` role.

`rowsDeleted` counts only the rows the purge's own statements deleted, not the cascade, so it is a
floor (`packages/db/src/tenant-purge.ts:189-193`).

**The audit row.** Migration `0020_tenant_reset_audit` (`packages/db/drizzle/0020_tenant_reset_audit.sql`,
journal `when` 1788820000013) exists because the reset destroys its own evidence. It hangs off
`tenants` — which a reset keeps — rather than `organizations`, which a reset deletes, so a cascade
from the org cannot take the audit trail with the thing it is auditing. `outcome` is a string, so a
killed process leaves a `started` row: a prompt to run the reset again, never a lock.

### 3. Health

**`GET /healthz` — liveness.** Answered in `packages/host/src/http-adapter.ts` (`respondLiveness`,
`:338`; the path test at `:480`), not in the router's table, because that table is `/api`-only and
`dispatch` never sees another path. That is also what keeps it out of the hosted session gate by
construction rather than by an entry in an exemption set.

The body is `LIVENESS_BODY` (`packages/host/src/handlers/health.ts:51`), a frozen literal with one
word in it. No version, no path, no tenant, no backend and no component list: this is the one route
on the box that answers a stranger, and every item on that list is reconnaissance handed over for
free. `Cache-Control: no-store`, because a proxy that cached "ok" would keep saying a dead process
is alive. HEAD gets the headers with the correct `Content-Length` and no body. Nothing is logged.

It runs **after** the transport filter in server mode (`http-adapter.ts:534`), so the request-line
filter, the method allowlist, the header cap and the per-IP bucket all apply to it. The one rule it
is exempt from is the TLS hop (`rejectPlaintext`, `:388`; `allowPlaintext` in `transportRejection`,
`:405`), because the caller it exists for is inside the box: `docker healthcheck` and Caddy's own
upstream probe hit the app's loopback port with no proxy in front of them, and a probe that refused
them could not tell an orchestrator the app is dead while the proxy is up. The carve-out is one path
wide — anything else on a plaintext hop is still `https_required`.

That carve-out is what lets the deploy tree stop forging the header. Since #68 the image's
`HEALTHCHECK` stamped `x-forwarded-proto: https` on its own request and probed `/api/v1/components`;
Phase 8 points it, Caddy's new `health_uri` and runbook check 1 at `/healthz` with no headers
(`webapp-deploy/Dockerfile`, `webapp-deploy/Caddyfile`, `docs/internal/tencent-cvm-setup.md`).

**`GET /api/v1/health` — readiness.** `handleGetHealth` (`packages/host/src/handlers/health.ts:187`),
session-gated, reporting `ready`, `mode`, `capabilities` and three checks:

| Check | What it does | Code |
|---|---|---|
| `database` | `SELECT 1`, nothing heavier | `:82` |
| `storage` | builds the configured store; does **not** reach the bucket, because a listing is a billed request | `:107` |
| `components` | `reportComponentStatus` per `COMPONENT_IDS`; `unsupported` is a fact about the platform, not a failure | `:132` |

Always HTTP 200, with the verdict in the body. A 503 is the other reasonable choice and it is the
wrong one here: this route is read by a person and by a support script, and every HTTP client in
between treats a 503 as a reason to retry, hide the body or serve a cached page — which loses the
diagnosis. The probe an orchestrator reads is `/healthz`, and that one is up or it is nothing.

`detail` is always a fixed phrase from this file and never a thrown message: a SQLite error names the
file's absolute path. The thrown message goes to the log instead. Neither route calls
`requireGatewayAllowed` — a tenant whose plan has blocked them must still be able to see whether the
box is healthy, or a support conversation starts with two unknowns instead of one.

### 4. Storage: the screen, the delete and the ceiling

`GET /api/v1/storage/usage` (`packages/host/src/handlers/storage.ts:32`) now also answers `largest`:
the biggest `LARGEST_OBJECT_LIMIT = 20` (`:30`) media rows, scoped by `organizationId` exactly as the
delete is, so every id on the list is an id the caller may then delete. One read feeds the whole
card, so the number and the things it is made of cannot disagree.

`SettingsStorageCard` (`apps/web/components/settings-storage-card.tsx`) renders only where
`storageQuota` is true. It is the screen Phase 6's deliberately-readable-while-blocked route was
for: the bar says how much is used, the list underneath is what to delete.

`DELETE /api/v1/media/:mediaId` (`packages/host/src/handlers/media.ts:82`) removes the object through
the store **first**, then the row, so the counter refund and the bytes move together. A row that is
not this tenant's, and a row that is already gone, get the same `{ ok: true, deleted: false }`: a 404
would confirm the id exists, and a delete that is safe to retry has to say `ok` for the object that
is already gone. The tenancy harness carries it as `indistinguishable` with that reasoning
(`packages/host/src/tenancy-harness.test.ts`), plus a survivor check that reads tenant A's row and
its bytes after tenant B has been through the whole table with A's id.

**The ceiling is now held by the row.** `reserveTenantStorageBytes`
(`packages/host/src/tenant-storage-store.ts:177`) is a single UPDATE whose WHERE clause carries the
test (`bytes_used + ? <= ?`), so SQLite evaluates it against the row under the row's own lock and
`changes()` is the verdict. It replaces Phase 6's per-tenant promise chain, which held for one
process and said so in its own comment; the CVM runbook's scaling step is a second app container
behind the same Caddy. `putTenantObject` (`packages/host/src/tenant-storage.ts:540`) seeds the
counter row from a real measure first, subtracts the measured job trees to get the budget, reserves,
and refunds with a negated delta if the put then fails.

## Where things live

| File | Role |
|---|---|
| `packages/core/src/capabilities.ts` | The twelve flags, resolved from `AGENTFORGE_SERVER`; `parseCapabilities` |
| `packages/host/src/handlers/misc.ts` | `handlePing` — where the flags reach the renderer |
| `apps/web/lib/host-ping.ts` | One memoised `GET /api/v1/ping` for every provider that reads it |
| `apps/web/lib/host-capabilities.tsx` | The context, the closed default, the two bridge-ANDed tests |
| `packages/host/src/tenant-reset.ts` | The host half of the account erase: the refusals, the order, the audit |
| `packages/host/src/tenant-paths.ts` | `resolveTenantPurgeRoot` — the containment test in front of every recursive delete |
| `packages/host/src/tenant-object-keys.ts` | `assertPurgeableTenant`, and the partial totals a failed purge carries out |
| `packages/db/src/tenant-purge.ts` | Which tables a reset takes, as a classification with a completeness test |
| `packages/db/drizzle/0020_tenant_reset_audit.sql` | The audit table; healer mirror in `ensure-schema.ts` |
| `packages/host/src/handlers/health.ts` | The liveness constants and the readiness route |
| `packages/host/src/health-db.ts` | Installs the database seam, imported by `router.ts` |
| `packages/host/src/http-adapter.ts` | Where `/healthz` is answered, and its one carve-out |
| `packages/host/src/handlers/storage.ts` | Usage plus `largest` |
| `packages/host/src/handlers/media.ts` | `handleDeleteMedia` |
| `packages/host/src/tenant-storage-store.ts` | `reserveTenantStorageBytes`, the conditional update |
| `apps/web/components/settings-storage-card.tsx` | The usage screen and the per-object delete |
| `apps/web/components/settings-reset-card.tsx` | Both resets, each behind its own flag |
| `webapp-deploy/Dockerfile`, `webapp-deploy/Caddyfile` | Where the deploy tree probes `/healthz` from |

## Gotchas

- **A flag is never the control.** Every one of them has a route behind it with its own error code.
  The table in §1 is the list of both halves, and the lane record repeats it with the test that
  proves each refusal.
- **`isElectron()` is not "the desktop".** It is false on webdev too. Every rule that hung on it
  before Phase 8 was really saying "not the packaged app", which is why webdev had "Start over" and
  the hosted server would have had it too. Read the flags; AND the bridge only for the three
  surfaces that genuinely need a preload.
- **The reset keeps the money.** `tenant_plan`, `tenant_seat`, `tenant_usage` and `billing_events`
  survive. A tenant who erases their account is not erasing their invoice, and the allowance they
  have already spent does not come back.
- **The reset does not sign anyone out — but it takes two steps, not one.** `auth_sessions` is
  kept and step 6 re-provisions the org under the same id, so the tab that pressed the button keeps
  working. Everybody *else* needs `restoreOrgMembers` as well, because their membership row goes
  with the cascade; drop that call and the whole org is locked out and returns as owners.
- **The purge guard compares two canonical paths, not one.** `resolveTenantPurgeRoot`
  (`packages/host/src/tenant-paths.ts`) canonicalises the shared root as well as the candidate and
  requires the result to land inside `realpath(<root>)/tenants/<id>`. A guard that canonicalises
  only the candidate and asks "is it still under the root?" refuses nothing that matters: a symlink
  at `tenants/<alpha>` pointing at `tenants/<beta>`, at `tenants/` or at the media root is *inside*
  the root in every case. Both callers (`removePrefix` and `removeTenantRoot`) then delete the path
  they checked, never the one they looked up.
- **The reset does not stop in-flight jobs**, unlike the desk's `scope: "all"`, which calls
  `killTrackedChildren`. The tracker is process-wide with no tenant on it, so calling it here would
  kill every other tenant's ffmpeg. Open item in the lane record §9.
- **`/healthz` answers on a plaintext hop and nothing else does.** If a future change moves the
  liveness test above `transportRejection`, the rate limiter stops covering it.
- **Readiness does not reach the bucket.** A bucket that exists but refuses this key is what the
  first upload finds, not what this route reports. `recomputeTenantStorage` is the operator's tool
  for that.
- **The conditional update needs a row.** `reserveTenantStorageBytes` returns `false` when no
  counter row matches, deliberately: an INSERT at that point would start a tenant's accounting at
  zero on the word of the caller. `putTenantObject` seeds the row from a measure first.
- **Two writes of the same key can still over-count.** The conditional update enforces the ceiling;
  it does not make the counter exact under a same-key race. The drift over-charges the tenant rather
  than letting them past the ceiling, and `recomputeTenantStorage` reconciles it.

## Verify

`.cursor/skills/verify-agentforge/features/settings.md` — the Settings page carries both cards.
Testids: `settings-storage`, `settings-storage-used`, `settings-storage-full`,
`settings-storage-items`, `settings-storage-delete-<id>`, `settings-reset-tenant`,
`settings-reset-tenant-confirm`, `settings-reset-tenant-submit`, and the desk's unchanged
`settings-reset-key` / `settings-reset-all`.

Suites: `packages/core/src/capabilities.test.ts`, `packages/db/src/tenant-purge.test.ts`,
`packages/db/src/migrate-0020.test.ts`, `packages/host/src/tenant-reset.test.ts`,
`packages/host/src/handlers/health.test.ts`, `packages/host/src/handlers/storage.test.ts`,
`packages/host/src/edit/local-path-refusal.test.ts`, `packages/host/src/http-adapter.test.ts`,
`apps/web/lib/host-capabilities.test.tsx`.

The live tests this page cannot do — a real COS bucket, a reset on a tenant with real bytes, a
`docker healthcheck` against the container — are numbered in
[web-phase8-hosted-surfaces.md](../web-phase8-hosted-surfaces.md) §8.
