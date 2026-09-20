# Phase 3 lane D — per-tenant state and storage prefixes

Record of the lane D change. Spec: [`web-phase3-tenancy-spec.md`](web-phase3-tenancy-spec.md) §3(f), §4 and §7.
Plan: [`web-migration-plan.md`](web-migration-plan.md). Map: [`maps/tenant-storage.md`](maps/tenant-storage.md).
Siblings: [`web-phase3-lane-a.md`](web-phase3-lane-a.md) (the edit store), lane B (PR #63, the schema),
lane C (PR #69, `getTenant(request)`).

Branch `feat/web-phase3-lane-d-kzkyjo`, cut from `main`, then `main` merged in again before the PR so it
carries lanes A/B/C, Music (#65) and Telegram (#67).

Lane D owns the **filesystem** half of tenancy. Lane A scoped the database by desk, lane B put a tenant
above the desk, lane C made a request resolve to one. Nothing so far stopped two tenants writing to the
same file, and every host-side file path was still a function of the desk or of nothing at all.

## 1. The one rule

> **`local-tenant`'s storage root *is* the install root. Every other tenant gets a `tenants/<tenantId>/`
> subtree inside it.**

`local-tenant` is not a tenant anyone signed up for: it is the id migration `0015` stamps onto the single
organization every pre-Phase-3 database already has (`packages/core/src/local-owner.ts:7`). Its files are the
install's files.

This is a deliberate deviation from the literal snippet in spec §3(f), which prefixes *every* tenant
including the local one. Prefixing the local tenant would mean moving a desktop user's `media/`, legal
matters, edit scratch and `settings.enc` on upgrade, and rewriting every `storage_path` row that points at
them. The brief's requirement — *"desktop mode must keep opening the existing data directory unchanged"* —
is then satisfied only by a migration step. With this rule it is satisfied by doing nothing: a desktop data
directory is byte-identical before and after, existing `storage_path` rows resolve verbatim, and there is
no fallback branch anywhere in the code because there is nothing to fall back from.

What the rule costs is one real hazard: a second tenant's subtree sits *inside* the local tenant's root, so
"is this path mine?" is not a plain prefix test when the asker is the local tenant. That exception is
explicit and tested rather than assumed — see `tenantDeniedRoots` below.

| Root | `local-tenant` | tenant `acme` |
|---|---|---|
| media | `<data>/media/<orgId>/<id>.png` | `<data>/media/tenants/acme/<orgId>/<id>.png` |
| datasets | `<data>/media/<deskId>/<id>.csv` | `<data>/media/tenants/acme/<deskId>/<id>.csv` |
| settings | `<data>/settings.enc` | `<data>/tenants/acme/settings.enc` |
| gate verdict | `<data>/gateway-gate.json` | `<data>/tenants/acme/gateway-gate.json` |
| desk usage | `<data>/desk-usage.json` | `<data>/tenants/acme/desk-usage.json` |
| edit scratch | `<data>/edit/<projectId>` | `<data>/tenants/acme/edit/<projectId>` |
| legal matters | `<legalRoot>/<deskId>/<matterId>` | `<legalRoot>/tenants/acme/<deskId>/<matterId>` |
| knowledge uploads | `<data>/media/…` | `<data>/media/tenants/acme/…` |

## 2. `tenant-paths.ts` — the one place that knows

New module `packages/host/src/tenant-paths.ts`. Every other module asks it; none of them join `"tenants"`
onto a path themselves.

| Export | Line | Does |
|---|---|---|
| `TENANTS_DIR` | `:23` | `"tenants"`, and a **reserved id**: no tenant may be spelled this |
| `assertTenantId` | `:36` | `/^[A-Za-z0-9_-]{1,80}$/`, and refuses `tenants` |
| `assertPathSegment` | `:48` | the same check for a desk id, org id or project id on its way to disk |
| `isLocalTenant` | `:55` | `tenantId === LOCAL_TENANT_ID` |
| `tenantSegments` | `:60` | `[]` for the local tenant, `["tenants", id]` for anyone else |
| `tenantScopedRoot` | `:65` | a root directory, scoped |
| `tenantRelativePath` | `:74` | the POSIX-slash relative path that goes in a `storage_path` column |
| `tenantDataDir` | `:87` | the tenant's slice of `localDataDir()` |
| `tenantDeniedRoots` | `:95` | **the exception**: `[<root>/tenants]` for the local tenant, `[]` otherwise |
| `isInside` | `:105` | plain containment, `path.relative` based, no string prefixes |
| `isInsideTenantRoot` | `:117` | containment **minus** the denied roots — denials checked first |

The validator is deliberately a whitelist rather than a blacklist: `..`, `/`, `\`, a drive letter and a NUL
are all rejected by *not matching*, so there is no list of nasties to keep current.

## 3. What changed, per module

**`media-root.ts`** — `tenantMediaRoot(tenantId)`, `mediaRelativePath(tenantId, segments, filename)` and
`mediaFilePath(tenantId, storagePath)`. The last one is the read guard: a `storage_path` that resolves
outside the caller's tenant root throws `not_found` (404), not `forbidden`, so it leaks nothing about what
exists elsewhere — the same choice lane A made.

**`media.ts`** — `saveMedia` writes `mediaRelativePath(tenant.tenantId, [tenant.organizationId], …)`. The
tenant prefix comes first and the organization second, so a tenant's blobs are one subtree rather than
being interleaved with everyone else's. `readMediaDataUrl` reads through `mediaFilePath`.

**`settings-store.ts`** — the biggest change, and the only one with a behaviour switch in it:

```ts
export type SettingsScope = Pick<TenantContext, "tenantId" | "workspaceId"> | string | null | undefined; // :40
export function resolveSettingsScope(scope?: SettingsScope): ResolvedSettingsScope { … }                  // :44
```

The union is source-compatible on purpose, exactly as `getTenant`'s `TenantInput` is: a bare desk id still
compiles. But a bare desk id carries no tenant, so in **server mode** `resolveSettingsScope` throws
`tenant_required` (500) rather than quietly reading the local tenant's key. Desktop and webdev are
unaffected: there is one tenant and it is the local one. The file cache went from a single slot to a
`Map` keyed by tenant (`:162`), because two tenants now read two files. `adoptLegacySettings` is a no-op in
server mode: `getTenant` calls it on every local-owner resolve, and there is no legacy to adopt on a host.

**`gateway-gate.ts`** — `GatewayGateOptions.tenant?: SettingsScope` (`:104`), `statePath(tenantId)`
(`:123`), and the ten-minute refresh throttle is keyed `` `${tenantId}:${fingerprint}` `` instead of by
fingerprint alone. Without this, one file holds one verdict: in server mode "no verdict for this key"
closes the gate, so tenant A running a check would lock tenant B out. New
`requireGatewayAllowedFor(tenant, opts)` (`:463`) is the spelling every route now uses — one argument, and
the tenant reaches both the settings file and the verdict file.

**`desk-usage.ts` / `job-usage.ts` / `account-usage.ts`** — all four desk-usage exports take a `tenantId`
and the JSON file moves under `tenantDataDir`. It is still a file; see §5.

**`edit/ffmpeg/paths.ts`** — `EditScope = { tenantId, projectId }` replaces the bare `projectId`, and the
allowlist grew a denied list:

```ts
export function editAllowlist(scope: EditScope): PathAllowlist {           // :63
  const scratch = editScratchRoot(scope);
  return {
    roots: [tenantMediaRoot(scope.tenantId), scratch],
    denied: [...tenantDeniedRoots(mediaRoot(), scope.tenantId), ...tenantDeniedRoots(localDataDir(), scope.tenantId)],
  };
}
```

`assertInsidePath` (`:82`) checks **denied first, then roots**. That ordering is the whole defence for the
local tenant: its root contains `tenants/`, so without the denial an ffmpeg input path pointing at
`media/tenants/acme/…` would pass the containment test. `recipes.ts` threads the scope through every
recipe, `frameAt`, `render` and `assetAbsPath`.

**`legal/store-files.ts`** — `tenantLegalRoot(rootDir, tenantId, workspaceId)` (`:49`), and `matterDir`
(`:53`) and `listMatterIds` (`:74`) take the tenant. The workspace id now goes through `assertPathSegment`,
which also means a desk may not be named `tenants`.

**`datasets.ts`** — `storagePath` is `tenantRelativePath(tenant.tenantId, [tenant.workspaceId], …)`, and a
private `filePath(tenant, relative)` guards `get` and `remove` with `isInsideTenantRoot`.

**`knowledge.ts` / `knowledge-reindex.ts`** — `uploadDir` is `tenantMediaRoot(tenant.tenantId)`.

**Every gated route** — `requireGatewayAllowed(loadSettings(…))` became
`requireGatewayAllowedFor(tenant)` across the handlers and generators. The last holdout was
`handlers/enhance-prompt.ts:49`, which resolved the tenant, loaded its settings and then called the gate
with no tenant at all; it now passes the tenant it already has. There are no bare-scope `loadSettings`,
`saveSettings` or `requireGatewayAllowed` call sites left in `packages/host/src` outside the tests.

**`handlers/settings.ts`** — the tenant is threaded through every gate and settings call, and `"tenants"`
was added to `HOST_RESET_ENTRIES` so "Start over" on the desktop removes the directory if one was ever
created. The route already refuses to run in server mode.

## 4. Off-request work carries the tenant

Per lane C's note: anything that outlives its request has no session to resolve from, so it must carry the
tenant explicitly rather than calling `getTenant`. `workerTenantId(projectId)` in `edit/ops.ts` is the twin
of lane A's `workerWorkspaceId` — a named, deliberately unscoped read that turns a job's project back into
a tenant, with a comment saying who may call it. `edit/edit-scope.test.ts` already fails if
`handlers/edit.ts` imports either. Job runners, the edit agent, the finance live task and the regen path
all take the tenant as an argument now; none of them call `getTenant`.

`getTenant(request)` remains the contract for request paths, untouched — lane D changed no handler's
resolve call, only what it passes downstream.

## 5. Deliberately not done

- **No `tenant_usage` table, and no migration.** Spec §4 allows lane D to create it early with a subset of
  columns, and the brief repeated the offer; the Phase 5 metering lane has since taken migration `0016`
  and creates it with the **full** column set (PR #74). Creating a partial table here would only give that
  lane something to alter. `desk-usage.json` therefore stays a file, now a per-tenant one, and the comment
  in `desk-usage.ts` records why so the next reader does not think it was missed.
- **Locale stays machine-wide.** `loadOwnerLocale` / `saveOwnerLocale` (`settings-store.ts:460`, `:464`)
  read and write the local tenant's file whoever asks. The app locale is frozen at boot
  (`maps/locale-boot-and-run-harness.md`); making it per tenant means a per-request locale and a restart
  story, which is a change to the run harness, not to storage. Half-doing it would have been worse than
  leaving it visibly undone.
- **`settings.enc` is still a file per tenant, not a row.** Spec Phase 4 owns per-tenant secrets and the
  data directory. This lane gives each tenant its own file at its own path, which is what Phase 4 needs as
  a starting point; it does not change the envelope, the key derivation or the backend.
- **No Lane E harness.** Out of scope by the brief.

## 6. Proof

Two new suites, 24 tests, all passing:

`packages/host/src/tenant-paths.test.ts` (13) — id and segment validation including the reserved `tenants`
name; two tenants get disjoint paths and their `storage_path` values cannot collide; `mediaFilePath`
refuses another tenant's stored path; traversal (`../`, absolute, `..\\`) is rejected; **the local tenant
cannot reach `media/tenants/acme/…`** through either `isInsideTenantRoot` or the ffmpeg allowlist; and the
desktop-layout assertions that pin the rule:

```ts
expect(mediaRelativePath(LOCAL_TENANT_ID, [ORG], "x.png")).toBe(`${ORG}/x.png`);
expect(editScratchRoot({ tenantId: LOCAL_TENANT_ID, projectId })).toBe(join(dataDir, "edit", projectId));
expect(matterDir(legalRoot, LOCAL_TENANT_ID, DESK, "matter-1")).toBe(join(legalRoot, DESK, "matter-1"));
```

`packages/host/src/tenant-state.test.ts` (11) — two tenants' gateway keys land in two files and neither
reads the other's; the local tenant's `settings.enc` stays at `<data>/settings.enc` and **no
`tenants/local-tenant` directory is created**; `clearGatewayKeyEverywhere(A)` returns only A's desks and
leaves B's key standing; server mode refuses a bare desk id; two tenants hold `ok` and `invalid_key`
verdicts in separate files; `clearGateState(A)` leaves B's verdict; the local verdict path is unchanged;
the refresh throttle is keyed per tenant; desk usage is disjoint per tenant.

That covers the three cases the brief named — disjoint paths, no escape from the prefix, desktop unchanged —
and the spec's four "done when" clauses.

Suite state on the merged branch:

| Package | Result |
|---|---|
| `@agentforge/host` | 183 of 185 files, 1784 tests passed; **2 pre-existing failures** |
| `@agentforge/core` | 178/178 files, 2118 tests |
| `@agentforge/db` | 8/8 files, 94 tests |
| `apps/web` | 93/93 files, 881 tests |

The two host failures are the same two lane A recorded and are environmental, not caused by this change:
`edit/ffmpeg-binary.test.ts` asserts a Windows `System32\where.exe` path, and `edit/import-ipc.test.ts`
expects 201 and gets 400. Both fail identically on `main` in this container. One transient failure was seen
once in `@agentforge/core` (`src/pdf/index.test.ts`, a worker-thread release under load); the core suite was
re-run twice on this branch and passed both times.

Typecheck: `tsc -p packages/host` reports the **same 10 pre-existing errors** (in 4 places) on this branch as on `main`
(`request-constraints.ts` `ReadableStreamReadResult`, `agent-run.ts` `StubFillScenario.args`, `backend.ts`
`Ingredient`, `handlers/agents.ts`). No new ones.

Biome: no new findings. The repo-wide counts move from 411 errors / 17 warnings on `main` to 415 / 16 here,
and every error in both sets is the pre-existing CRLF-vs-LF format noise — `biome.json` sets
`lineEnding: crlf` while most files in the tree are stored LF. The new files carry no lint findings of their
own.

`pnpm install` needed the documented cloud workaround (`handover-2026-09-20.md`, environment notes): the
`xlsx` pin fetches from `cdn.sheetjs.com`, which the network policy blocks. The three manifests were
restored afterwards and verified byte-identical to `main`; **the lockfile change is not in this branch**.

### Maps

New page [`maps/tenant-storage.md`](maps/tenant-storage.md), registered in the maps `README.md`.
Fifteen existing pages were touched, and all sixteen carry `Last verified: 2026-09-20 at a504555`.

Be precise about what that stamp claims here. On the pages this change actually alters —
`tenant-storage`, `settings-and-gateway-gate`, `tenant-resolution`, `edit-timeline`,
`knowledge-ingest-loop`, `pii-and-key-security`, `renderer-media` and `generate-studios` — the cited
lines were re-read. On the rest (`chat-send`, `documents`, `data-analysis`, `presentations`,
`research-dossier`, `legal-matter-run`, `market-watch`, `finance-parse-and-generate`) the only edit is
the `requireGatewayAllowed(loadSettings(…))` → `requireGatewayAllowedFor(tenant)` spelling, and only the
gate lines were re-read, not every cite on the page.

Four cites were already drifted on `main` and are corrected here as a side effect
(`handlers/edit.ts:600-607` → `:598-605`, `handlers/media.ts:26-50` → `:25-49` on two pages,
`knowledge-loop.tsx:156-316` → `:127-247`, `tenant.test.ts:44-57` → `:44-56`). A sweep of the
1428 `file:line` cites across the touched pages found no others out of range. Three pages carried
stale `(working tree)` suffixes on their verified line from when the work they describe was
uncommitted; those are dropped.

### The verify skill

`.cursor/skills/verify-agentforge/scripts/doctor.mjs` → `FAIL — GET http://127.0.0.1:3000/chat did not
connect.` Expected: it needs a booted app, and there is none in the cloud container. The map-rot check
and the `file:line` re-reads are the parts that do run here, and both are above.

**Not driven.** No instance was started, so nothing here is proved by an action on a running app. kyo asked
for verify-and-map now and live testing on their own machine afterwards. The outstanding proof is §7.

## 7. What is left for kyo, and for the other lanes

To prove live, on kyo's machine:

1. Open the desktop app on an existing data directory. Media, legal matters and the saved gateway key must
   all still be there, and no `tenants/` directory should appear anywhere under it.
2. In hosted mode, sign two tenants in, save a different gateway key under each, and check that
   `<data>/tenants/<a>/settings.enc` and `<data>/tenants/<b>/settings.enc` both exist and that each tenant's
   Settings page reports its own key state.
3. Generate an image as each tenant and confirm the two blobs land in two subtrees.

Open items:

- **Lane E** sweeps the by-id routes. Nothing in lane D adds a route, but `mediaFilePath`'s 404 and
  `datasets.filePath`'s guard are the two read paths worth a harness row each.
- **Phase 5 / PR #74** should move desk usage out of `desk-usage.json` and into `tenant_usage` once that
  table lands. The per-tenant file path here is a holding pattern, not a destination.
- **Phase 4** takes `settings.enc` per tenant further: the envelope and key derivation are untouched.
- `quarantineUnreadableSettings` renames `settings.enc` on **any** decrypt failure. That is pre-existing
  behaviour, but it is now per tenant, so a hosted deployment missing `AGENTFORGE_SECRETS_KEY` will rename
  one file per tenant rather than one file in total. Worth a look in Phase 4.
- The CI **Playwright e2e check is red on every run in this repository's history** — a GitHub Actions
  billing lock kyo diagnosed on 2026-09-18, not a failure of this PR.
