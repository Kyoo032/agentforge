# Phase 8 — hosted surfaces, the per-tenant reset, and health

The last phase of the web migration. Its "done when" in
[`web-migration-plan.md`](web-migration-plan.md) is four things: retire the Electron-only surfaces,
a per-tenant reset, a health route, and the desktop verify still passes. Folded in from Phase 6's
open items: a screen for storage usage, a route to delete media, and the quota check as a
conditional SQL update.

The subsystem map is [`maps/hosted-surfaces-and-reset.md`](maps/hosted-surfaces-and-reset.md).
Section 8 below is the list of live tests this phase owes, for kyo's machine and the CVM.

## 1. What was actually true before this change

**The renderer decided for itself, and it was asking the wrong question.** Nine files branched on
`isElectron()` (`apps/web/lib/api-client.ts`) to decide whether to offer a desktop-only control.
`isElectron()` is false on webdev *and* on the hosted server, so every rule hung on it was really
saying "not the packaged app" — which is not the same statement. Webdev is supposed to have "Start
over"; the hosted server must not. No amount of `isElectron()` can tell those two apart, so the
hosted server was going to ship with the desktop's buttons on its Settings page.

**Some of those buttons had a refusal behind them and some did not.** `scope: "all"` was refused
(`reset_disabled`, Phase 3). The component install was refused (`install_disabled`, Phase 7). The
Edit import's `sourcePath` was refused — but with `invalid_request`, the same answer a typo gets,
from a transport check that happened to also cover it. A hosted tenant who sent a path could not
tell policy from plumbing, and neither could the next person reading the code.

**A hosted tenant had no way to start over at all.** The desk's "Start over" wipes the data
directory, which on a hosted box is every tenant's data. It was correctly refused and nothing was
offered in its place, so a tenant who wanted to clear their account had to ask an operator.

**There was no health route, and the container was probing a route that is not one.** The desktop's
deploy probe is `host-status.json` (`apps/desktop/main.cjs`), a file written by the Electron shell
that a hosted container does not have — so when #68 built the image it reached for the nearest
thing that answered without a session and pointed the `HEALTHCHECK` at `GET /api/v1/components`
(`webapp-deploy/Dockerfile`, documented at `webapp-deploy/README.md:72` and as check 1 of the
runbook). That worked, and it was wrong in two ways worth naming, because this phase changes both:

- **It had to stamp `x-forwarded-proto: https` on itself.** In server mode `rejectPlaintext`
  answers `403 https_required` to everything without that header, on every path, so the probe
  forged the proxy's own marking to get past a rule about the proxy. A probe written that way keeps
  reporting healthy the day the proxy rule changes and no real request can get through — it proves
  the app accepts the header, not that the app is alive. That is the whole reason `/healthz` gets a
  carve-out from that one rule instead.
- **It answered with the component list.** `/api/v1/components` reports component ids, states and
  versions, and it is ungated by design so that a component can be installed before anyone has
  pasted a key. Using it as the liveness probe left that reachable to anything that could reach the
  port, for no reason beyond "it answers".

Caddy had no `health_uri` at all, so nothing took a wedged app process out of rotation.

**A tenant at the storage ceiling could neither see nor free space.** Phase 6 built the ceiling, the
counter and `GET /api/v1/storage/usage`, and deliberately left that route readable while blocked —
"a route that refuses the blocked is a dead end in exactly the case it exists for". Nothing rendered
it. There was also no delete: the studio galleries list images and videos with no size on them, so
nothing in the product could say which object was taking the room.

**The quota was enforced per process.** Phase 6 serialised a tenant's writes behind a promise chain
and said so in its own comment: "two hosts behind the proxy would still race, and the fix for that
is a conditional update in SQL, not a mutex". The CVM runbook's own scaling step is a second app
container behind the same Caddy, so that was a real gap with a date on it.

## 2. The rule

**`AGENTFORGE_SERVER` decides, the route refuses with its own code, and the desk is untouched.**
Same shape as Phases 3 through 7. Phase 8 adds one thing to it: the same switch also resolves a set
of **capability flags** that the renderer reads, so the control is hidden as well as refused.

A flag is never the control. The hidden button is a courtesy to the person; the refusal is the
control, and every flag in section 3 has one behind it with a test that proves it.

Nothing is deleted from the desktop build. Every rule is a branch on one flag, and with the flag off
the code takes the path it took before.

## 3. What was built

### `packages/core/src/capabilities.ts` — one switch, twelve flags

`hostCapabilities(env = process.env)` resolves every flag from `isServerMode(env)` and from nothing
else, so a deployment cannot land in a combination nobody has thought about. Every flag is true on
exactly one of the two targets, which `capabilities.test.ts` asserts as a *rule* rather than as
twelve assertions — a thirteenth flag added without a decision fails there.

`parseCapabilities(payload)` narrows an unknown payload with every unknown reading `false`, which
hides a surface rather than offering one that will be refused. An older host sends no `capabilities`
key at all. Only a literal `true` opens a surface; `"true"` and `1` do not.

Exported through a `"./capabilities"` subpath so the browser bundle need not pull the root barrel.

### The surface table

Every Electron-only surface, the flag that hides it, the route that refuses it, and the test that
proves the refusal.

| Surface | Flag | Route | Refusal | Test |
|---|---|---|---|---|
| Start over (data-dir wipe) | `startOver` | `POST /api/v1/settings/reset` `scope: "all"` | `reset_disabled` 403 | `packages/host/src/tenant-reset.test.ts` — "still refuses scope all on a server" |
| Erase this account | `tenantReset` | same route, `scope: "tenant"` | `tenant_reset_disabled` 403 off a server | `packages/host/src/tenant-reset.test.ts` — "refuses scope tenant off server mode" |
| | | | `tenant_reset_forbidden` 403 for a non-owner | same file — "refuses a member who is not the owner", which also asserts the code is not `gateway_blocked` |
| Import by file path | `localPaths` | `POST /api/v1/edit/projects/:projectId/import` with `sourcePath` | `local_path_disabled` 403 | `packages/host/src/edit/local-path-refusal.test.ts` — over http, web **and** ipc |
| Native file picker | `nativeFilePicker` | (renderer; the import route above is the control) | button not rendered | `apps/web/lib/host-capabilities.test.tsx` |
| Component install | `componentInstall` | `POST /api/v1/components/install` | `install_disabled` 403 (Phase 7) | `packages/host/src/components/server.test.ts` |
| Relaunch | `relaunch` | (IPC only; no hosted transport exists) | button not rendered | `apps/web/lib/host-capabilities.test.tsx` |
| Auto-updater | `updater` | (IPC only) | not offered | `apps/web/lib/host-capabilities.test.tsx` |
| Storage usage card | `storageQuota` | `GET /api/v1/storage/usage` reports `limitBytes: null` on a desk | card renders nothing, and reads nothing | `apps/web/lib/host-capabilities.test.tsx` — "reads nothing at all when the card is hidden" |

`sessions`, `singleOwner`, `objectStorage` and `plans` are the other four: statements of fact about
the deployment rather than surfaces, kept in the same set so one read answers every question.

`relaunch`, `updater` and `nativeFilePicker` are ANDed with the bridge by their consumers
(`hasDesktopShell`, `hasNativeFilePicker`). The host can only say a shell is *possible* on this
target; only the renderer sees whether a preload attached, which is exactly webdev's case.

### `packages/host/src/tenant-reset.ts` — the hosted account erase

A **third scope** (`"tenant"`) rather than a hosted branch inside `"all"`, so an existing desk
client's request never changes meaning and neither target's button can reach the other's behaviour.

Refusals, in order, all before anything is deleted:

1. off server mode → `tenant_reset_disabled` 403
2. `tenant.role !== "owner"` → `tenant_reset_forbidden` 403
3. wrong or missing `confirm` → `invalid_request` 400
4. `assertPurgeableTenant` → `storage_purge_refused` 400 for `local-tenant`, whose prefix is the
   whole store

Then: open the audit row `started` → purge the rows in one transaction → `removePrefix` through the
configured store → remove the local job trees → forget the memoised job bytes → clear the gateway
key, the gate verdict and the circuit breakers → **re-provision the account** → close the audit
`completed`. A throw closes it `failed` with a category-only detail and rethrows.

**The re-provision step is the one that is easy to miss.** `resolvePortalTenant` only reads, so a
reset that deleted `organizations` and stopped there would leave the tenant's own live session
answering `org_inactive` on its very next request, with no way back in from the UI. The test
"leaves the tenant usable: the very next request resolves a clean home desk" is that assertion.

### `packages/db/src/tenant-purge.ts` — what a reset takes, decided by the schema

Five buckets: `CASCADED_TABLES`, `WORKSPACE_SCOPED_TABLES`, `TENANT_SCOPED_TABLES`,
`KEPT_TENANT_TABLES` and `SHARED_TABLES`. `tenant-purge.test.ts` fails when a real table is in none
of them or in two, so a table added later cannot silently survive a reset — which a hand-written
DELETE sequence would have allowed.

Kept on purpose: `tenants`, `tenant_plan`, `tenant_seat`, `tenant_usage`, `billing_events`,
`tenant_reset_audit`, and `auth_sessions` — a reset empties an account, it does not sign its people
out, and it does not erase the invoice.

**Keeping `auth_sessions` is not enough to keep anyone signed in, and that took a second pass to
get right.** `organization_members` is in `CASCADED_TABLES`: SQLite deletes it with the org, and the
re-provision in step 6 writes back only the caller's membership. So on the first cut of this phase
every *other* member of the org answered `403 user_inactive` on their next request, and when they
signed in again the pre-Phase-3 rule that "the first signed-in user owns their own org"
(`packages/db/src/portal-owner.ts`) handed each of them `owner` — a privilege escalation handed out
by somebody else pressing a button in their own settings. The fix is two lines of bookkeeping either
side of the purge: read `organization_members` for the org before the transaction, and re-insert
them with the roles they had after `ensurePortalOwner` returns. `INSERT OR IGNORE` against the
`(organization_id, user_id)` unique index, so a retry is a no-op like every other step. Erasing an
account empties it; it does not re-staff it. `tenant-reset.test.ts` → "the reset and the other
members".

### Migration `0020_tenant_reset_audit`

`when` 1788820000013, above 0019's. It exists because the reset destroys its own evidence. It hangs
off `tenants` — which a reset keeps — rather than `organizations`, which a reset deletes, so a
cascade from the org cannot take the audit trail with the thing it is auditing. `outcome` is a
string, so a killed process leaves a `started` row: a prompt to run the reset again, never a lock.
The skip-hazard test asserts the migration's **own journal row**, not the table's existence, because
the healer in `ensure-schema.ts` creates the table too.

### `packages/host/src/handlers/health.ts` — two routes, two callers

`GET /healthz` — liveness. Unauthenticated. Its whole body is a frozen `{"status":"ok"}`: no
version, no path, no tenant, no backend and no component list, because this is the one route on the
box that answers a stranger and everything on that list is reconnaissance handed over for free.
`Cache-Control: no-store`. HEAD gets the headers and no body.

It is answered in `http-adapter.ts` rather than the router's table, because that table is `/api`-only
and `dispatch` never sees another path — which is also what keeps it out of the hosted session gate
by construction rather than by an entry in an exemption set.

It runs **after** the transport filter, so the request-line filter, the method allowlist, the header
cap and the per-IP bucket all apply. The one rule it is exempt from is the TLS hop, and that was
found by running it: a direct hit on the app's loopback port with no `X-Forwarded-Proto` was
answered `https_required` 403, which is exactly the shape `docker healthcheck` and Caddy's own
upstream probe make. A liveness route that only answered through the proxy could not tell an
orchestrator the app is dead while the proxy is up — the one failure it exists to catch. The
carve-out is one path wide; anything else on a plaintext hop is still refused, and
`http-adapter.test.ts` asserts both halves plus that the probe is still inside the per-IP bucket.

**The alternative was what the image already did, and the carve-out exists so it can stop.** Since
#68 the `HEALTHCHECK` stamped `x-forwarded-proto: https` on its own request — a probe forging the
proxy's marking to get past a rule about the proxy. It works until the proxy rule changes, and then
it reports healthy against a process no real request can reach. So this phase moves three places
onto `/healthz` with no header at all:

| File | Before | After |
|---|---|---|
| `webapp-deploy/Dockerfile` | `HEALTHCHECK` → `GET /api/v1/components`, `x-forwarded-proto: https` | `HEALTHCHECK` → `GET /healthz`, no headers |
| `webapp-deploy/Caddyfile` | no active health checking | `health_uri /healthz`, `health_interval 10s` |
| `docs/internal/tencent-cvm-setup.md` check 1 | "the header is what gets the probe past the transport filter" | the carve-out, and why a probe must not forge the header |

`webapp-deploy/README.md` carries the same correction and a line for anyone redeploying an image
built before this phase: the old probe still works, but rebuild, because it leaves the component
list answering to anything that can reach the port.

`GET /api/v1/health` — readiness. Session-gated, because it says what liveness refuses to: which
backend, which components, ready or not. Three checks: `SELECT 1`; building the configured object
store (which validates the COS config without a billed bucket call); and `reportComponentStatus` per
component, where `unsupported` is a fact about the platform and not a failure of this box.

Always HTTP 200, with the verdict in the body. A 503 is the other reasonable choice and it is the
wrong one here: this route is read by a person and by a support script, and every HTTP client in
between treats a 503 as a reason to retry, hide the body or serve a cached page — which loses the
diagnosis. `detail` is always a fixed phrase and never a thrown message, because a SQLite error
names the file's absolute path; the message goes to the log instead.

Neither route calls `requireGatewayAllowed`: a tenant whose plan has blocked them must still be able
to see whether the box is healthy, or a support conversation starts with two unknowns instead of one.

### Storage: the screen, the delete, the ceiling

`GET /api/v1/storage/usage` gained `largest`, the biggest 20 media rows scoped by `organizationId`
exactly as the delete is, so every id on the list is an id the caller may then delete. One read
feeds the whole card, so the number and the things it is made of cannot disagree. It was put here
rather than on a route of its own because this route already knows the tenant and already answers
while blocked.

`SettingsStorageCard` renders only where `storageQuota` is true — a percentage of no limit is not
zero, it is nothing, and a desk owner does not need this product to tell them their hard drive is
filling up.

`DELETE /api/v1/media/:mediaId` removes the object through the store **first**, then the row, so the
counter refund and the bytes move together. A row that is not this tenant's and a row that is
already gone get the same `{ ok: true, deleted: false }`: a 404 would confirm the id exists, and a
delete that is safe to retry has to say `ok` for the object that is already gone. The tenancy
harness carries it as `indistinguishable` with that reasoning, plus a survivor check that reads
tenant A's row **and its bytes** after tenant B has been through the whole table with A's id.

`reserveTenantStorageBytes` is a single UPDATE whose WHERE clause carries the test
(`bytes_used + ? <= ?`), so SQLite evaluates it against the row under the row's own lock and
`changes()` is the verdict. The per-tenant promise chain is gone. A delta of zero or less is always
applied, because freeing space must never be refused and an operator who lowers the ceiling puts a
tenant over it by definition.

## 4. What did not change

- The desk. Every rule is a branch on one flag; `pnpm --filter @agentforge/web test` and the host
  suite both pass with the flag off, and `import-transport.test.ts` — the desktop's own `sourcePath`
  rule — passes unchanged.
- `scope: "key"` and `scope: "all"`. Both behave exactly as before on both targets.
- The Phase 6 object store's interface, apart from one added method (`removePrefix`).
- The Phase 7 component routes and the `managed` field.
- Metering, plans, seats and the billing webhook.

## 5. How this was verified

### Suites

| Package | Result |
|---|---|
| `@agentforge/core` | 187 files, **2292 passed**, 1 skipped |
| `@agentforge/db` | 14 files, **174 passed** |
| `@agentforge/host` | 214 files, **2314 passed** |
| `@agentforge/web` | 97 files, **924 passed** |

New test files: `packages/core/src/capabilities.test.ts` (9),
`packages/db/src/tenant-purge.test.ts` (9), `packages/db/src/migrate-0020.test.ts` (11),
`packages/host/src/tenant-reset.test.ts` (14), `packages/host/src/handlers/health.test.ts` (13),
`packages/host/src/edit/local-path-refusal.test.ts` (6),
`apps/web/lib/host-capabilities.test.tsx` (18). Extended: `http-adapter.test.ts` (+15),
`handlers/storage.test.ts` (+9), `tenant-storage.test.ts` (+8), `tenancy-harness.test.ts` (+1 route,
+1 survivor check).

Two pre-existing db tests were updated, both because a correct addition turned them red:
`migrate-0019.test.ts` asserted its `when` was above *every other* entry, which is only true while
0019 is last — it now slices the entries before it, the way `migrate-0020.test.ts` was written; and
`migrate-0015.test.ts`'s list of `tenant_id` carriers gained `tenant_reset_audit`.

`tsc --noEmit` is clean in all four packages. `pnpm lint` reports 182 warnings against a `main`
baseline of 183 — no new diagnostics, and one pre-existing unused import removed.

Suites were run with the xlsx cloud workaround from
[`handover-2026-09-20.md`](handover-2026-09-20.md) ("Environment notes for cloud sessions"). The
three manifests were restored afterwards and `git diff --name-only` carries neither `pnpm-lock.yaml`
nor `packages/core/package.json`.

### Driven for real

`.cursor/skills/verify-agentforge/scripts/doctor.mjs` against an isolated stub instance on its own
data directory, in both modes.

**Desk** (`--base http://127.0.0.1:3200`, own data dir, `AGENTFORGE_RUNTIME=stub`): exit 0.

```
verify-agentforge doctor: OK — stub runtime. Safe for Chat send without a live gateway.
{ "ok": true, "url": "http://127.0.0.1:3200", "surface": "webdev", "chatStatus": 200,
  "runtime": "stub", "hasOpenai": false, "keyFingerprint": false, "chatCount": 47,
  "curation": true, "knowledge": true, ... }
```

and, on the same instance:

```
GET /healthz            200  {"status":"ok"}   (Cache-Control: no-store, Content-Length: 15)
HEAD /healthz           200  no body, Content-Length: 15
GET /api/v1/ping        200  capabilities: sessions false, startOver true, tenantReset false,
                             nativeFilePicker true, localPaths true, componentInstall true
GET /api/v1/health      200  ready true, mode "desk",
                             checks: database answers, file backend configured, all load (anydoc ready)
POST /api/v1/settings/reset {"scope":"tenant","confirm":"RESET"}
                        403  tenant_reset_disabled
```

**Server mode** (port 3201, `AGENTFORGE_SERVER=1`, own data dir and own ceiling):

```
GET /healthz            200  {"status":"ok"}    ← direct hit, NO X-Forwarded-Proto
GET /api/v1/settings    403  https_required     ← same hop, still refused
GET /api/v1/ping        200  capabilities: sessions true, startOver false, tenantReset true,
                             nativeFilePicker false, localPaths false, componentInstall false
GET /api/v1/health      401  session_required
POST /api/v1/settings/reset  403  origin_forbidden
```

Every flag is the exact mirror of the desk's, live, from two processes that share nothing.

**The doctor itself cannot run against server mode**, and that is pre-existing rather than new: it
GETs `/chat` without a proxy header, which server mode has refused with `https_required` since the
Phase 3 security pass. The probes above are the same requests with the header Caddy stamps. Noted
here so the next lane does not read the FAIL line as a regression.

Both instances were stopped afterwards. No Playwright: the cloud has no runner (see section 6).

### Maps

New page [`maps/hosted-surfaces-and-reset.md`](maps/hosted-surfaces-and-reset.md), stamped at
`1b73999` and indexed in `maps/README.md`.

Two existing claims were rewritten because this change made them false:

- `maps/tenant-object-storage.md` said "one tenant's writes are serialised … per process — two hosts
  would still race". They are not serialised any more; the conditional UPDATE is described in its
  place, including what it does **not** fix.
- `maps/database-and-migrations.md` said "Start over is still refused on the server" with nothing
  after it. Still true, and the hosted tenant now has its own answer, which the paragraph names.

Thirty-eight citations on eleven other pages drifted because this branch edited files they cite.
Each was re-anchored from the diff's own line map and the residue fixed by hand;
`map-drift --write` was not used, because it mis-points onto import lines
(`handover-2026-09-20.md`, "Maps").

`pnpm maps:check`: **0 hard, 122 soft** across 78 docs and 2232 citations, against a `main` baseline
of 0 hard and 128 soft. `map-drift` compares two refs rather than the working tree, so it reports
nothing until this branch is committed.

## 6. GitHub Actions

Every workflow run in this repository currently fails with no runner assigned — the account's
Actions billing is locked. It is not a failure of this PR and only kyo can clear it. Noted once, as
agreed.

## 7. The verify skill

`.cursor/skills/verify-agentforge/features/settings.md` gained the new testids; no other feature
file changed. New handles:

`settings-storage`, `settings-storage-used`, `settings-storage-full`, `settings-storage-low`,
`settings-storage-error`, `settings-storage-items`, `settings-storage-delete-<mediaId>`,
`settings-reset-tenant`, `settings-reset-tenant-confirm`, `settings-reset-tenant-confirm-name`,
`settings-reset-tenant-submit`.

Unchanged and still the desk's: `settings-reset-key`, `settings-reset-all`, `settings-reset-app`.

## 8. Live tests still owed

Nothing below has been run. Numbers 1–7 are kyo's machine; 8–14 need the CVM.

1. **The desktop verify still passes.** Install or run the packaged 0.14.27 shell against this
   build's renderer and walk Settings: "Sign out of the gateway" and "Reset to a fresh install" are
   both there, the relaunch prompt appears after a reset, and the Edit import still opens the native
   file dialog. This is the phase's own done-when and the one thing the cloud cannot check.
2. **Webdev is unchanged.** `pnpm dev` with no `AGENTFORGE_SERVER`: Settings shows "Start over" and
   no storage card, and the Edit import by path still works over IPC in `pnpm desktop:dev`.
3. **The Edit import picker on a desk.** Press it, choose a file, confirm the clip lands. The
   button is now behind `nativeFilePicker && isElectron()`; a wrong flag here is a dead button on the
   desktop, which no unit test can see.
4. **`GET /healthz` on webdev.** `curl http://127.0.0.1:3000/healthz` → `{"status":"ok"}`. The same
   healthcheck config then works against webdev and against the container.
5. **Readiness with a broken component.** Move or rename the anydoc package, restart, and read
   `GET /api/v1/health`: `ready` false, the components row says "1 not loading", and no path appears
   anywhere in the body.
6. **A gateway-blocked tenant reads health.** Close the gate, then read `/api/v1/health` — it must
   answer 200 rather than `gateway_blocked`.
7. **The storage card on a desk.** Confirm it renders nothing at all and that the network tab shows
   no `GET /api/v1/storage/usage`.

CVM, after the runbook's Phase 0 deploy:

8. **The container healthcheck, on the rebuilt image.** The image already carries a `HEALTHCHECK`
   and this PR changes it — `GET /healthz` with no headers, in place of `GET /api/v1/components`
   with `x-forwarded-proto: https`. There is no curl in the image and none is wanted: it stays
   `node -e fetch`. So: rebuild (`webapp-deploy/deploy.sh`), then `docker inspect --format
   '{{.State.Health.Status}} {{len .State.Health.Log}}'` on the app container and confirm `healthy`
   with the log growing; then `kill -STOP` the app process inside the container and confirm it goes
   `unhealthy` within `interval × retries` (30s × 5); then `kill -CONT` and confirm it recovers.
   Read `docker inspect --format '{{json .State.Health.Log}}'` and confirm no probe came back
   `403 https_required`. **This is the most valuable test in this list** — it is the one the TLS
   carve-out exists for, and the cloud can only simulate the request shape.
9. **Caddy's upstream probe.** `health_uri /healthz` is now in the `Caddyfile`. Reload Caddy and
   confirm `curl -s localhost:2019/reverse_proxy/upstreams` shows the upstream healthy, that the app
   log has no `https_required` from it, and that the access log is not growing one line per probe
   (the app answers `/healthz` before routing, so it writes none).
10. **A reset on a tenant with real bytes under COS.** Sign in as a tenant with uploads, Knowledge
    sources and an Edit project; note the usage number; erase the account with the typed
    confirmation. Then: the storage number is zero, the COS prefix is empty, the tenant's plan, seat
    and usage rows are still there, `tenant_reset_audit` has one `completed` row, and **the same
    browser tab keeps working** and lands on a clean home desk.
11. **The reset is safe to retry.** Run it twice. The second answers ok, deletes nothing and writes
    a second audit row.
12. **A non-owner cannot erase.** Sign in as a member of the same tenant: the button is not rendered,
    and a hand-made request answers `tenant_reset_forbidden` and not `gateway_blocked`.
13. **The conditional quota across two containers.** Scale to two app containers behind the same
    Caddy, set a small ceiling, and upload from both at once. The total must not cross the ceiling,
    and exactly one of a pair that would cross it must be refused with `storage_quota_exceeded`.
14. **Delete media frees COS bytes.** Delete from the storage card, then confirm both the counter
    and the bucket moved — `recomputeTenantStorage` afterwards must report the same number the card
    shows.

## 9. Open items this phase leaves

**Closed by this PR.** `packages/host/src/knowledge-embed.ts` passed a bare workspace id as the
settings scope at what was line 170, which server mode refuses without an ambient session (on `main`
since 2026-09-15, recorded in the #92 handover entry). It now passes the `TenantContext`, at both
call sites — the embed path and the query path.

**Recorded, not fixed.** The Edit import route leaves its media row behind when the probe rejects
a file: `handlePostEditImport` inserts the row and refunds the bytes but does not delete the row
(`packages/host/src/handlers/edit.ts`, the probe rejection inside `handlePostEditImport`). It is
pre-existing, it is outside every surface this phase touched, and the row is this tenant's own, so
it is a tidiness bug rather than a leak. It wants its own PR.

**New, and honest about it.**

- The conditional UPDATE enforces the ceiling; it does not make the counter exact when two writes of
  the *same key* race. The drift over-charges the tenant rather than letting them past the ceiling,
  and `recomputeTenantStorage` reconciles it. A fix would need the key's `head()` inside the same
  transaction as the reservation, which the object store's interface does not offer.
- The reset's storage half is not atomic with its row half. A process killed between them leaves a
  `started` audit row and a partly-emptied prefix; the documented answer is to run it again, and the
  retry test is what says that is safe.
- `tenant_reset_audit` is never pruned. One row per reset is not a volume problem, but nothing
  deletes them either.
- **The reset does not stop the tenant's in-flight jobs**, and the desk's `scope: "all"` does
  (`killTrackedChildren`, `handlers/settings.ts`). It is left alone deliberately: the child-process
  tracker is process-wide (`packages/host/src/child-processes.ts` keeps one set, with no tenant on
  it), so calling it here would kill every *other* tenant's ffmpeg to tidy up after one — a worse
  bug than the one it fixes. The consequence today is that an edit or meeting job still running
  when its tenant resets writes into a purged tree and then throws on a job row the cascade took;
  nothing asserts either way. The real fix is a tenant id on the tracked child, and it belongs with
  whoever next touches `child-processes.ts`. **Owner: unassigned; raise with kyo at the Phase 8
  handover.**
- The storage card lists media rows only. Knowledge uploads, Edit job trees and meeting recordings
  count toward the ceiling and are not on the list, so a tenant whose bytes are mostly job trees
  sees a number they cannot act on. The usage line is still correct; the list is incomplete, and
  saying which kinds of bytes are missing is the smallest honest fix.
