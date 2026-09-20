# Phase 3 lane A — tenancy in the edit store

Record of the lane A change. Spec: [`web-phase3-tenancy-spec.md`](web-phase3-tenancy-spec.md) §5 and §7.
Plan: [`web-migration-plan.md`](web-migration-plan.md). Map: [`maps/edit-timeline.md`](maps/edit-timeline.md).

Branch `feat/web-phase3-lane-a-sn2f56`, cut from `main` at `b482611` (which already carries PR #57).
Lane A has no dependency on lane B: it adds no table, no column and no migration. The boundary it
enforces is the **desk** (`workspaces.id`), which exists today. When lane B lands the tenant column
above it, a foreign tenant is already a foreign desk as far as the edit store is concerned, so nothing
here needs revisiting.

## 1. The bug that was live

`POST /api/v1/edit/projects/:projectId/unplaced/:itemId/discard` — spec §5, "Confirmed, today, on the tree".

The handler resolved the tenant and threw the result away, then updated `edit_unplaced` by item id
alone and returned the updated row:

```ts
await getTenant(request.workspaceId);
const rows = await db.update(editUnplaced)
  .set({ discardedAt: new Date() })
  .where(eq(editUnplaced.id, request.params.itemId))
  .returning();
```

Neither the caller's desk nor the `:projectId` in the route's own path constrained the row, and
`edit_unplaced` carries only a `project_id`, so nothing downstream re-checked. Any caller could
soft-delete **and read back** any other desk's unplaced item — including its `prompt` text — by id.

It now scopes first, exactly as the sibling `…/place` handler does, and pins the row to the project in
the `WHERE`:

```ts
const tenant = await getTenant(request.workspaceId);
const projectId = request.params.projectId;
await foldProject(projectId, tenant.workspaceId);
const rows = await db.update(editUnplaced)
  .set({ discardedAt: new Date() })
  .where(and(eq(editUnplaced.id, request.params.itemId), eq(editUnplaced.projectId, projectId)))
  .returning();
```

## 2. The store hardening

Spec §5 lists five store functions that were "safe only because every caller happens to be correct".
The scope is now a **required argument** and lives in the `WHERE` clause, so a caller that forgets it
does not compile rather than silently reading across desks.

| Function | Was | Is |
|---|---|---|
| `loadProjectRow` (`edit/ops.ts:75`) | `workspaceId?` optional; check skipped entirely when omitted | `workspaceId` required, `and(id, workspaceId)` in the `WHERE` |
| `foldProject` (`edit/ops.ts:129`) | `workspaceId?` optional | required, passed through |
| `appendOps` (`edit/ops.ts:162`) | re-selected the project by id alone, mutated by `project_id` alone | `workspaceId` required on `AppendOpsOptions`; loads through `loadProjectRow`, and the `edit_projects` update is scoped |
| `getEditJob` (`edit/jobs.ts:121`) | `eq(editJobs.id, jobId)` | `and(id, projectId)`; the old `jobInProject` follow-up check in `handlers/edit.ts` is gone, replaced by the `WHERE` |
| `patchJob` (`edit/jobs.ts:96`) | `eq(editJobs.id, id)` | `and(id, projectId)` |
| `cancelEditJob` (`edit/jobs.ts:442`) | `cancelEditJob(jobId)` | `cancelEditJob(jobId, projectId)` |
| `undoCard` / `keepCard` (`edit/undo.ts:41`, `:83`) | ownership tested in application code after an id-only read | `and(cardId, projectId)` on the read **and** on the status update |

Carried along because they became reachable by the same argument:

- `renderParityFrame` (`edit/parity.ts:26`) — `workspaceId` was optional, now required.
- `hostEditBackend.reviewGateOpen` and `.cancelJob` (`edit/backend.ts`) — the `EditToolBackend`
  contract passes a bare id, so both now scope through the run's own `requireEditToolContext()`
  instead of reading unscoped. The core interface is unchanged.
- The `edit_cards` status writes in `jobs.ts`, `backend.ts` and `start-generate.ts` are pinned to
  their project.

A wrong desk and a missing row answer the same 404, so the error leaks nothing about what exists
elsewhere. That was already true of `loadProjectRow` and is now true everywhere.

## 3. The two deliberate unscoped reads

The job runner is the one caller with no request to scope by: it is driven by job ids this module
minted itself in `enqueueEditJob`, and the job row it acts on was created by a handler that already
proved the project belonged to the caller's desk. Rather than leave an optional argument that any
handler could quietly omit, there are two **named** unscoped reads:

- `workerWorkspaceId(projectId)` (`edit/ops.ts:97`) — turns a job's project back into a desk, which
  every downstream store call then enforces.
- `workerJob(jobId)` (`edit/jobs.ts:141`, module-private) — the runner's own read.

Both carry a comment saying who may call them. `edit-scope.test.ts` fails if `handlers/edit.ts` ever
imports either. This is the honest limit of the lane: the worker path still trusts the job → project
foreign key, which is what the database guarantees; what it no longer does is accept a scope from a
request and then ignore it.

## 4. Proof

`packages/host/src/edit/edit-scope.test.ts`, 12 tests, all passing:

- discard on a foreign desk → 404, `discardedAt` still null, and the 404 body contains neither the
  item id nor a marker planted in the record's `prompt`
- discard for the owning desk → 200 and the row is discarded (the fix does not break the happy path)
- discard with an item from another project **on the same desk** → 404
- place on a foreign desk → 404, `placedClipId` still null
- `loadProjectRow`, `foldProject`, `appendOps` under a foreign desk → 404; `appendOps` writes nothing
  (`seq` and `name` unchanged)
- `getEditJob` and `cancelEditJob` with a foreign project → 404, and the job stays `queued` with
  `cancelRequestedAt` null
- `undoCard` and `keepCard` with a card from another project → 404, card still `proposed`, `decidedAt`
  null
- the guard test that keeps the worker reads out of the request path

**The IDOR tests were confirmed red against the old handler.** Reverting only the discard body and
re-running gives `expected 200 to be 404` on both discard cases; the other ten stay green, because for
`loadProjectRow`, `foldProject`, `undoCard` and `keepCard` the *runtime* behaviour was already correct
by convention — what changed there is that the compiler now enforces it. `appendOps`, `patchJob` and
`getEditJob` are genuine runtime fixes as well as type-level ones.

Suite state on this branch: `pnpm test` → 7 of 8 packages green; `@agentforge/host` 1707 passed,
2 failed. Both failures are pre-existing on `main` and environmental, not caused by this change:
`edit/ffmpeg-binary.test.ts` asserts a Windows `System32\where.exe` path, and `edit/import-ipc.test.ts`
expects 201 and gets 400. Both fail identically on `main` at `b482611` in this container.

`pnpm lint` (biome) exits 0. The changed files carry the same 9 warnings before and after; the new
test file adds none.

Typecheck: `tsc -p packages/host` goes from **21 errors to 10** on this branch. All 10 remaining are
pre-existing and untouched (`request-constraints.ts` `ReadableStreamReadResult`, `agent-run.ts`
`StubFillScenario.args`, `backend.ts` `Ingredient`, `handlers/agents.ts`). The 11 that cleared were
`addReadyClip(project.id, "clip-x")` call sites: the test harness typed its optional `clipId` as
`crypto.randomUUID()`'s template-literal type, so every literal id was an error. Giving it `string`
fixed them as a side effect of adding the desk argument.

Not done here, deliberately: the app was not driven. Per `.cursor/skills/verify-agentforge`, proof is
an action on a running instance, and kyo asked for verify-and-map now with testing to follow. Nothing
in this lane has a UI surface of its own — the tray's Place and Discard buttons
(`edit-tray-place` / `edit-tray-discard`) are the user path, and a drive of those on two desks is the
outstanding proof.

## 5. Desk pollution

`unreleased.md` records 104 leftover `edit-idor-<hex>` desks from an older security probe. These tests
create desks too, but `packages/host/vitest.config.ts` points the whole suite at a throwaway
`tmpdir()` root reaped by `test/global-setup.ts`, so they never reach the operator's `data/`
directory.

## 6. Notes for the other lanes

- **Lane B** owns `tenants`, `organizations.tenant_id` and migration `0015`. Nothing here conflicts.
  When `TenantContext` gains `tenantId`, the edit store needs no change: it scopes by
  `tenant.workspaceId`, which lane C resolves from the session.
- **Lane C** makes `getTenant(request)` read the session. Every edit handler already calls
  `getTenant(request.workspaceId)` and passes `tenant.workspaceId` down, so lane C's change lands in
  one place per handler.
- **Lane E** sweeps the by-id routes into `tenancy-harness.test.ts`. The two unplaced routes and the
  job/card routes covered here should be folded into that table rather than kept as a second suite,
  once it exists.
