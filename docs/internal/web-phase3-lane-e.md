# Phase 3 lane E — the tenancy harness and the call-site sweep

Record of the lane E change, in the shape of [`web-phase3-lane-a.md`](web-phase3-lane-a.md) and
[`web-phase3-lane-c.md`](web-phase3-lane-c.md).
Spec: [`web-phase3-tenancy-spec.md`](web-phase3-tenancy-spec.md) §6 (test plan, row T3) and §7
(lane E). Plan: [`web-migration-plan.md`](web-migration-plan.md). Map:
[`maps/by-id-routes-and-tenancy-harness.md`](maps/by-id-routes-and-tenancy-harness.md).

Branch `feat/web-phase3-lane-e-j6rp29`, cut from `main` at `d14cd8f` — lanes A (PR #60, #62), B
(PR #63) and C (PR #69) are all merged there, plus the Music mode (PR #65). Lane D and the Phase 5
metering lane were still open on parallel branches when this was written.

## 1. What changed, in one paragraph

Before, whether a hosted handler saw the right tenant's data was a property of `dispatch` having put
the session in async-local storage: all 104 host call sites passed a bare desk id, and lane C's
backstop turned that into the session's tenant on the way through. Nothing tested the result
end to end, and nothing stopped the next by-id route from shipping without a tenancy test. After,
every host call site passes the request itself, so the session arrives on the object the handler was
already holding; a new test drives **all 52 by-id routes** as a second tenant against a first
tenant's real rows on a real database and asserts three things per route; an assertion inside that
test re-derives the by-id list from the router table, so a route added without a tenancy test fails
the suite; and every log line written under a hosted handler carries the session's tenant id.

## 2. The numbers

| | Spec (§5, Phase 2 tree) | `main` at `d14cd8f` |
|---|---|---|
| Route registrations | 129 | **132** |
| By-id registrations | 55 | **52** |
| `getTenant` call sites | 102 | **104** |

Both counts moved, in opposite directions, and neither is a correction of a mistake:

- **132, up from 129.** The Music mode (PR #65) added `GET /api/v1/music`, `POST /api/v1/music` and
  `POST /api/v1/music/lyrics`. None of them is by-id.
- **52, down from 55.** The spec counted a route once per `:param`, so the eight paths carrying two
  (`…/cards/:cardId/keep`, `…/jobs/:jobId`, `…/export/:jobId/file`, `…/unplaced/:itemId/*`,
  `…/files/:docId`, `…/runs/:runId`) inflated the figure. 52 is the count of by-id
  **registrations**, which is the unit a harness can iterate and the unit the completeness
  assertion compares against.
- **104, up from 102.** Music added two.

The route counts are re-derived, not hand-counted: `routeRegistrations()` (`packages/host/src/router.ts:182`)
hands the table back and `isByIdRoute` (`:187`) filters it, and the harness asserts on that list.

## 3. The sweep

`getTenant(request.workspaceId)` → `getTenant(request)` at 104 sites across 20 files under
`packages/host/src/handlers/`. Every one of those handlers takes `request: HostRequest`, which
carries both `workspaceId` and `session`, so the change is a pure widening: the desk id still
arrives, and the session now arrives with it.

What it is **not** is a behaviour change on the desktop or webdev. `getTenant` resolves a request
with no session exactly as it resolves a bare desk id (`packages/host/src/tenant.ts:88-103`), so
every non-hosted path is byte-identical. `tsc --noEmit` on `packages/host` produces output
identical to `main`'s, which is the compiler agreeing that all 104 sites were passing something
`getTenant` already accepted.

One call site was deliberately **not** swept: `seedEditProject` in
`packages/host/src/edit/harness.ts:6` calls `getTenant()` with no argument at all. It is a test
helper with no request to pass, and on the desktop path it resolves the local owner, which is what
its callers want. It is named here so the next reader does not think it was missed.

`packages/host/src/tenant-scope.ts` keeps the ambient store. It is no longer load-bearing for any
handler in the tree, and the file now says so — it stays as the backstop it was always described as,
for a handler added later that passes a bare desk id, and for `getTenant()` with no argument.

## 4. The harness

`packages/host/src/tenancy-harness.test.ts`. Two tenants are provisioned with `ensurePortalOwner`,
tenant A seeds a real row of every kind the `:params` name, and tenant B calls all 52 routes with
A's ids through the real `dispatch`, with a real session and a real SQLite database.

### Three assertions per route, not one

The spec asks for a 404. That is the right assertion for most routes and the wrong one for a few, so
the harness asserts the property a 404 is usually the shape of:

1. **No marker in the response.** Every seeded row carries `TENANT-A-SECRET-MARKER-9f2c` in its text
   fields, and the whole result is serialised and searched — JSON body, stream frames, or file bytes
   and filename. This is what would catch a 200 leaking A's record through a nested object.
2. **No existence oracle.** The same route is called again with ids nothing has ever had, and the
   two answers must reduce to the same string. UUIDs are blanked before comparing, because a refusal
   may quote back the id the caller itself sent, which reveals nothing. **This is the load-bearing
   assertion**: a route that 404s a foreign id and 403s a non-existent one passes a bare status
   check and still tells a prober which ids exist.
3. **404**, on 47 of the 52. The other five say why, in the table, next to the route.

Then, after the whole table has run, tenant A reads its own rows back through the same `dispatch`.
That is the control — a server that 404s everybody would pass 1 to 3 — and it is also a survivor
check: a delete that crossed the boundary shows up there and nowhere else.

### The five routes that do not 404

Each is a handler that was read, not a route that was waved through.

| Route | What it answers | Why that is right |
|---|---|---|
| `POST /api/v1/edit/projects/:projectId/agent` | 200, then an error frame | The handler opens an SSE stream and returns before the work starts; the desk check is the first statement of the worker (`packages/host/src/edit/agent-run.ts:154`). Nothing of the project is read before it. |
| `DELETE /api/v1/knowledge/memories/:memoryId` | `{ ok: true }`, zero rows | `deleteMemory` is `WHERE workspace_id = ? AND id = ?` and returns nothing. A silent no-op discloses **less** than a 404: the 404 would confirm which ids exist. |
| `DELETE /api/v1/knowledge/sources/:sourceId` | `{ ok: true }`, zero rows | Same shape; the handler ignores `deleteSource`'s boolean. |
| `GET /api/v1/agents/:agentId/threads` | 200, empty list | `listThreads` filters on organisation, agent and user, so a foreign agent id selects nothing — the same answer an agent id nobody owns gets. |
| `POST /api/v1/legal/matters/:matterId/files` | 400 | Multipart; it refuses a request with no file before looking the matter up. Identical for every `:matterId`. See §6. |

The two knowledge deletes are exactly why assertion 3 alone would have been the weaker test: both
pass a "did it 404" check by being excused from it, and what actually proves them is the survivor
check, which reads A's rows back and finds them there.

### The completeness assertion

`routeRegistrations()` is read back and every by-id route in it must appear in the table. A by-id
route added without a tenancy test fails this suite instead of shipping unnoticed. This is the part
of lane E that outlives the lane, and it is why `router.ts` gained a reader for its own table
(which hands out no handlers — a caller can read what is registered, never invoke it out of band).

## 5. Proof that the harness can fail

A green suite that cannot go red proves nothing, so three mutations were run against it and the
results are what make the green run worth reading. All three were reverted; none is in the diff.

| Mutation | Caught by | What it said |
|---|---|---|
| `artifactStore().get` loses its `workspace_id` from the `WHERE` | assertion 1, on two routes | `GET /api/v1/artifacts/:artifactId` and `…/file` both returned A's marker — including through the **bytes** route, so the serialiser covers more than JSON |
| `deleteMemory` loses its `workspace_id` from the `WHERE` | the survivor check | A's memory was gone after B's call, while every status assertion still passed |
| A new by-id route added to the router, absent from the table | the completeness assertion | Named the route in the failure message |

## 6. One bug found and fixed, one thing owed

**Found and fixed: `POST /api/v1/workspaces` was a 500 on the hosted server.**
`createLocalWorkspace` (`packages/db/src/ensure-local-owner.ts:142`) wrote the desk-membership row
for `LOCAL_OWNER_ID`, hard-coded. A portal-provisioned database has no `local-owner` user row, so
the insert violated its foreign key and the route failed for every signed-in tenant. It surfaced
because the harness could not seed a second desk for a portal tenant — the seed threw
`FOREIGN KEY constraint failed` before any route ran.

The fix is an optional sixth argument, `ownerUserId`, defaulting to `LOCAL_OWNER_ID` so the
desktop's four callers are untouched, and `handlePostWorkspaces` passing `tenant.userId`
(`packages/host/src/handlers/workspaces.ts:77`). The desk has to belong to the signed-in user in any
case, so the correctness fix and the crash fix are the same change.

This is outside the letter of lane E's file list (`packages/db` is lane B's). It is here rather than
handed on because the alternative was a harness with a hole in it: without a second desk owned by a
real portal tenant, the five `/workspaces/:workspaceId/*` routes would have been tested against an
id nothing matched rather than against a desk that exists and belongs to somebody else.

**Owed: `:docId` has no seed.** `POST /api/v1/legal/matters/:matterId/files` and
`DELETE /api/v1/legal/matters/:matterId/files/:docId` need a real `.docx` to produce a document id;
`legalStore().addFile` parses one and rejects anything else. Both routes are in the table and both
are asserted, and the `:matterId` in each is tenant A's real matter, so the refusal under test still
has a real owner to be foreign to — but the `:docId` half is a ghost id, not A's. A fixture exists
at `packages/core/src/docx/fixtures/`; wiring it in is a small follow-up, not a gap in the boundary.

**Nothing is owed to lane D.** Every by-id route could be scoped with what is on `main` today. Lane
D's work — per-tenant settings, storage prefixes, per-tenant usage rows — is about files and
counters, not about which row a by-id route may read, so no route in the table is waiting on it.

## 7. The tenant id on every log line

Spec §7 puts "the log carries a tenant id" in lane E's done-when (security spec row L1).

`dispatch` opens `withLogContext({ tenantId, route })` around the handler
(`packages/host/src/router.ts:424`) with the **verified session's** tenant id — never the
client-supplied workspace cookie, so a line can be trusted to say who the work was actually done
for. `log.ts` merges that ambient context **under** a child logger's bound fields and **under** the
call site's own (`log.ts:231`), so nothing that worked before changes precedence, and the existing
redaction rules still apply to an ambient field like any other.

Off server mode nothing opens the store, so the desktop's and webdev's lines are byte-identical.
The request-id half of L1 is PR #71's A09-1 (`mintRequestId` in `http-adapter.ts`), on a branch that
had not merged when this was written; the two compose — one is a `dispatch` scope, the other an
adapter field.

## 8. Tests

| File | Covers |
|---|---|
| `packages/host/src/tenancy-harness.test.ts` (61) | The 52 by-id routes under a foreign tenant, the seed check, six of tenant A's own rows read back, the knowledge survivor check, the completeness assertion |
| `packages/host/src/log-context.test.ts` (8) | The ambient context in isolation: stamping, crossing an await, nesting, precedence under a child and under the call site, not leaking out of scope, still redacted |
| `packages/host/src/tenant-log-scope.test.ts` (5) | That `dispatch` opens it: the session's tenant id and the route, two sessions, the workspace cookie ignored, nothing off server mode, the scope closed again |

Results in this container, with the `xlsx` workaround from
[`handover-2026-09-20.md`](handover-2026-09-20.md) applied and reverted before committing:

- `turbo run test`: **7 of 8 packages green.** `@agentforge/host` 1832 passed, 2 failed;
  `@agentforge/db` 94 passed.
- Both host failures are the pre-existing pair the handover file already records, in files this
  branch does not touch (`edit/ffmpeg-binary.test.ts` asserts a Windows `System32\where.exe` path;
  `edit/import-ipc.test.ts` expects 201 and gets 400). Re-run on a clean `main` in this same
  container: the same two, the same way.
- `tsc --noEmit` on `packages/host`: output **byte-identical** to `main`'s (18 pre-existing errors,
  none in a file this branch touches). `packages/db`: 1, in `packages/core`, also pre-existing.
- `biome check --formatter-enabled=false --assist-enabled=false .`: 182 warnings, 30 infos, **0
  errors** — identical to `main`'s totals in this container.

## 9. verify-agentforge

Nothing was listening on `127.0.0.1:3000`, so an isolated instance was started on `:3211` against a
throwaway data directory, doctored, driven briefly and stopped again. That is the pattern the
handover file records for cloud sessions.

- `node .cursor/skills/verify-agentforge/scripts/doctor.mjs --base http://127.0.0.1:3211` → **exit
  0**, `"ok": true`, `surface: "webdev"`, `chatStatus: 200`, `runtime: "stub"`, `hasOpenai: false`.
  (`edit.ffmpeg.found: false` — no ffmpeg in the container, which the doctor treats as a note.)
- `POST /api/v1/workspaces` → **201**, a second desk created and listed. That is the
  `createLocalWorkspace` change exercised on a running app through its own HTTP route, on the path
  that uses the unchanged default.
- Five by-id routes probed over real HTTP with an id nothing owns → **404** on all five.
- The instance was stopped and its data directory deleted. `:3000` was never touched.

What the doctor proves is that the app boots and answers after the sweep. It proves nothing about
two tenants, for the reason in §10.

## 10. What is NOT proven

- **Two tenants have never seen disjoint data on a running server.** That is the phase's own "done
  when" and this lane does not close it. The harness proves the refusal through `dispatch` with two
  provisioned tenants on a real database; it is not HTTP, not a browser, and not a real sign-in. The
  missing piece is the same one lane C recorded: the portal's browser-login grant is assumed
  (`packages/host/src/auth/portal-client.ts:14-24`, spec §8 q1), so no session can be created from
  outside the process, and a cloud session cannot mint one. **This needs the Phase 0 deploy and two
  real browsers.**
- **The desktop was not opened.** The desktop path is unchanged by construction — `getTenant`
  resolves a session-less request exactly as before, and `tsc` output is identical — and the desktop
  suites are green, but nobody launched `DPSBuddy.exe` against an existing database. The spec's
  second done-when ("the desktop app opens its existing DB without re-seeding") is therefore covered
  by lane B's `migrate-0015.test.ts` and by construction here, not by observation.
- **The Playwright e2e check is red**, as it is on every run in this repository's history, in about
  two seconds with no runner assigned. It is the account's Actions billing lock
  (`0.14.22-changelog.md:118`), not a signal about this branch. It is noted once here and not
  re-diagnosed.
- **`xlsx` code is untested by this run.** The cloud workaround installs 0.18.5 rather than the
  pinned 0.20.3. Nothing in this branch touches the spreadsheet parser, so this is stated for
  completeness rather than as a caveat on any result here.

## 11. Open, for Kyo or for a later lane

1. **The `:docId` fixture**, §6. Small, and the boundary it would tighten is already held by the
   `:matterId` in the same path.
2. **A route added by a branch that has not merged** will fail the completeness assertion the moment
   it lands, which is the intended behaviour and will read as a merge conflict in spirit if not in
   fact. PR #66 (Meeting), PR #67 (Telegram) and PR #71 (OWASP) each list their new by-id routes in
   their descriptions; whichever merges after this one adds its rows to `BY_ID_ROUTES` in the same
   PR. That is a one-line-per-route change and the failure message names the route.
3. **`GET /api/v1/organizations` still returns the caller's own org only** (spec §5 says it "must
   return only the session tenant's orgs"). It does — `handleGetOrganizations` selects on
   `tenant.organizationId` — so nothing is owed unless spec §8 q10 is answered the other way, that a
   tenant admin should see **every** org in their tenant. That is a product question, not a scoping
   bug, and it is Kyo's to answer.
4. **`market_cache` is still shared across tenants** by design (spec §8 q5). It has no by-id route,
   so the harness has nothing to say about it; the question stands.
5. **The three edit sub-resources are seeded by direct insert.** If `enqueueEditJob` ever grows a
   test-mode entry point that does not start a worker, the seeds should move to it.
6. **`AGENTS.md`'s map count was one short** (it said 25; there were 26 pages and 26 index rows).
   Corrected to 27 with this page added. Worth a glance from whoever owns the map sweep (PR #68).
