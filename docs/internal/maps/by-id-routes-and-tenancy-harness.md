# Map — The by-id route surface and the tenancy harness

Last verified: 2026-09-20 at c1daa8b (the merge of PR #81, which adds this page)

## Overview

Every route with a `:param` in its path is a place where a caller names a row by id. This page is
about the guarantee that naming another tenant's row gets you nothing: what the surface is, how each
handler is scoped, and what proves it stays that way as the surface grows.

This is Phase 3 lane E. How a request's tenant is decided in the first place is
[`tenant-resolution.md`](tenant-resolution.md) (lane C); the data model underneath is
[`tenancy-schema.md`](tenancy-schema.md) (lane B); the edit store's own desk scoping is
[`edit-timeline.md`](edit-timeline.md) (lane A). This page is not about per-tenant *files* — storage
prefixes and per-tenant settings are lane D.

## How it works

### The surface, counted

`packages/host/src/router.ts:214` is one array of `compile(method, path, handler)` rows. At
`28230f6` it holds **151 registrations, 63 of them by-id** — a route is by-id when `compile`
(`router.ts:180`) extracted at least one `:param` name into `keys`.

The Phase 3 spec counted "129 registrations, 55 of them by-id"
([`../web-phase3-tenancy-spec.md`](../web-phase3-tenancy-spec.md) §5) against the Phase 2 tree. Both
halves have moved since, and the by-id figure is also counted differently: the spec counted a route
once per `:param`, so the paths carrying two inflated it. 63 is the count of by-id **registrations**,
which is the unit a harness can iterate and the unit the completeness assertion compares against.

### How a handler is scoped

Every handler resolves its tenant first and then scopes its own reads and writes with it. There are
four shapes in the tree, and knowing which one a handler uses is how you read its refusal:

| Shape | Example | Foreign id gets |
|---|---|---|
| The scope is in the `WHERE` and a miss throws | `requireArtifact` (`packages/host/src/artifacts.ts:191`) | 404 |
| The scope is in the `WHERE` and a miss returns null, the handler throws | `handleGetThread` → `getThread` (`packages/host/src/threads.ts:49`) | 404 |
| The handler lists what the tenant owns and looks in that list | `handleSelectWorkspace` (`packages/host/src/handlers/workspaces.ts:98`) | 404 |
| The scope is in the `WHERE` of a `DELETE` that reports nothing | `deleteMemory` (`packages/host/src/knowledge.ts:199`) | `{ ok: true }`, zero rows touched |

There is a fifth case that is not a scoping shape but decides what the caller sees: a route that
opens an SSE stream answers 200 before the work begins, so its refusal arrives as a frame. The check
is still the first thing the job does (`requireMeeting` at `packages/host/src/meeting/run.ts:152`, `:287` and `:362`,
`foldProject` at `packages/host/src/edit/agent-run.ts:24`).

Neither the fourth shape nor the fifth gives a 404, and both are correct rather than gaps: an answer
that is the same whether or not the row exists tells a prober less than a 404 does. What they need
instead is proof the row was not read or touched, which the harness gives.

### The call-site sweep

`getTenant` is source-compatible by lane C's design (spec §3c): it takes a bare desk id or the
request. Lane E swept every host call site from `getTenant(request.workspaceId)` to
`getTenant(request)` — **114 sites across 22 handler files**. The change is mechanical and changes
no desktop behaviour; what it changes is where the session comes from. Before the sweep a handler
depended on `dispatch` having put the session in async-local storage
(`packages/host/src/tenant-scope.ts:28`); after it, the session arrives on the request the handler
was already holding.

The store stays, as the backstop it was always described as: a handler added tomorrow that passes a
bare desk id still resolves the session's tenant rather than another tenant's desk, and
`getTenant()` with no argument (the shape `packages/host/src/edit/harness.ts:6` uses) still has
somewhere to read a session from.

### The harness

`packages/host/src/tenancy-harness.test.ts` is one table and one loop. Tenant A seeds a real row of
every kind the `:params` name (`seedTenantA`, `:448`), each carrying `LEAK_MARKER` (`:61`) in its
text fields. Tenant B then calls all 63 by-id routes with A's ids. Per route:

1. **No marker in the response.** The whole result is serialised — JSON body, stream frames, or file
   bytes and filename — and searched. This is what catches a 200 leaking A's data through a nested
   object, which a status assertion never would.
2. **No existence oracle.** The same route is called again with ids nothing has ever had (`fillPath`
   in `"ghost"` mode, `:657`) and the two answers must reduce to the same string (`shape`, `:715`,
   which blanks UUIDs because a refusal may quote back the id the caller itself sent). Tenant B must
   not be able to tell A's ids apart from ids that do not exist.
3. **404**, on 56 of the 63. The other seven carry `refusal: "indistinguishable"` and a written
   reason (the `Refusal` type, `:91`).

Then, after the whole table has run: tenant A reads its own rows back through the same `dispatch`,
which is both the control (a server that 404s everybody would pass 1–3) and a survivor check (a
delete that crossed the boundary shows up here and nowhere else).

### The completeness assertion

`routeRegistrations()` (`router.ts:205`) hands back the route table with no handlers attached;
`isByIdRoute` (`:210`) filters it. The harness re-derives the by-id list from that and fails if the
router has a by-id route the table does not (`:805`). A by-id route added without a tenancy test
fails this suite rather than shipping unnoticed, which is the part of lane E that outlives the lane.

It has already done its job once: merging `main` into this branch brought in eleven new by-id routes
from the Telegram and Meeting lanes, and the assertion failed naming all eleven.

### The tenant id on every log line

`dispatch` opens `withLogContext({ tenantId, route })` around the handler (`router.ts:469`) with the
**verified session's** tenant id. `log.ts` merges that ambient context under the logger's own bound
fields and the call site's (`log.ts:231`), so every line a handler or anything it awaits writes names
the tenant it was written for, and a call site can still override it. Off server mode nothing opens
the store, so the desktop's and webdev's lines are unchanged.

## Where things live

| File | Role |
|---|---|
| `packages/host/src/router.ts` | The route table; `routeRegistrations` / `isByIdRoute` read it back; `dispatch` opens the session and log scopes |
| `packages/host/src/tenancy-harness.test.ts` | The by-id table, the seeds, the three assertions, the completeness assertion |
| `packages/host/src/tenant.ts` | `getTenant` — what every swept call site now passes the request to |
| `packages/host/src/tenant-scope.ts` | The ambient session; a backstop after the sweep, not the contract |
| `packages/host/src/log.ts` | `withLogContext` / `currentLogContext`, and the merge order in `write` |
| `packages/host/src/log-context.test.ts` | The ambient log context in isolation |
| `packages/host/src/tenant-log-scope.test.ts` | That `dispatch` actually opens it, with the session's id |
| `packages/host/src/handlers/*.ts` | The 114 swept call sites |
| `packages/db/src/ensure-local-owner.ts` | `createLocalWorkspace`, and its `ownerUserId` argument |

## Gotchas

- **A 404 is not the only correct refusal.** Seven routes answer something else on purpose and each
  says why in the table. Changing one of them to a 404 to make the suite tidier would add an
  existence oracle where there is none today.
- **The ghost control is the load-bearing assertion, not the 404.** A route that 404s A's id and
  403s a ghost id would pass a bare status check and still leak which ids exist.
- **A multipart route must be sent a file.** `POST /api/v1/legal/matters/:matterId/files` and
  `POST /api/v1/meetings/:meetingId/recording` both refuse a fileless request with a 400 *before*
  they look the resource up, so a table entry without `files` would assert nothing. Both carry one.
- **`GET /api/v1/videos/examples/:name/file` is not tenant data.** `listVideoExamples`
  (`packages/host/src/video-examples.ts:115`) takes no tenant and reads a directory beside the
  binary. It is in the table, called and asserted, because leaving a by-id route out is exactly what
  the completeness assertion exists to prevent — but there is no owner for it to be foreign to.
- **`media` is org-scoped, not desk-scoped** (`packages/host/src/media.ts:37`), deliberately. Two
  desks in one org share an image pool; the tenant boundary still holds because an organisation
  belongs to exactly one tenant. Spec §8 q4 asks Kyo whether that is intended.
- **The three edit sub-resources are seeded by direct insert**, not through a store function: a
  card, a job and an unplaced item are written by a job that has already produced output, and
  `enqueueEditJob` (`packages/host/src/edit/jobs.ts:137`) starts a worker. The rows are the shape
  those paths write.
- **`createLocalWorkspace`'s desk-member default was a hosted 500.** It wrote the membership row for
  `LOCAL_OWNER_ID`, which does not exist in a portal-provisioned database, so the insert violated
  its foreign key. It now takes `ownerUserId` (`packages/db/src/ensure-local-owner.ts:142`) and
  `handlePostWorkspaces` passes `tenant.userId` (`packages/host/src/handlers/workspaces.ts:78`). The
  default is unchanged, so the desktop's callers are untouched.

## Verify

The harness is a unit suite, not a drive: `pnpm --filter @agentforge/host test tenancy-harness`.
It is worth knowing it can fail — three mutation probes were run against it and all three were
caught (unscoping the artifact read, unscoping the memory delete, adding an untested by-id route);
they are recorded in [`../web-phase3-lane-e.md`](../web-phase3-lane-e.md) §5.

The user-path half belongs to `.cursor/skills/verify-agentforge`, and the part that matters here —
two tenants signed in on a running hosted server seeing disjoint data — **cannot be driven from a
cloud session**: it needs a real portal sign-in. `scripts/doctor.mjs --base` against an isolated
webdev instance is what a cloud session can do, and it says the app boots and answers; it says
nothing about two tenants.
