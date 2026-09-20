# Phase 3 lane C — the tenant comes from the session

Record of the lane C change, in the shape of [`web-phase3-lane-a.md`](web-phase3-lane-a.md).
Spec: [`web-phase3-tenancy-spec.md`](web-phase3-tenancy-spec.md) §3c, §3d and §7 (lane C).
Plan: [`web-migration-plan.md`](web-migration-plan.md). Map:
[`maps/tenant-resolution.md`](maps/tenant-resolution.md).

Branch `feat/web-phase3-lane-c-wivrgf`, cut from `main` at `df11317` — lanes A (PR #60, #62) and B
(PR #63) are both merged there, so `TenantContext.tenantId`, the `tenants` table,
`organizations.tenant_id`, migration `0015` and `ensureTenant()` all exist. `ensureTenant()` had no
caller; it has one now.

## 1. What changed, in one paragraph

Before, the hosted server was single-tenant by construction: `getTenant()` called
`ensureLocalOwner`, which resolves the org by `slug = "personal"` — one org per database — so every
signed-in browser shared one desk, and the only thing standing between a client-supplied
`agentforge_workspace` cookie and a foreign desk was `pickWorkspaceId`, which *silently substitutes*
home rather than refusing. After, `getTenant()` resolves from the verified browser session, a desk
the session's tenant does not own is a 404 with the cookie cleared, a request with no session in
server mode is a 401 rather than a fall back to `local-tenant`, the machine-wide `workspace-id.txt`
is desktop-only, and the CSRF token is bound to the session id. The desktop and webdev resolve
exactly as they did.

## 2. The seam

`getTenant(input?)` (`packages/host/src/tenant.ts:88`) is **source-compatible**, per spec §3c: it
takes the bare desk id all 102 existing call sites already pass, or the request itself. Nothing was
swept — that is lane E — and nothing had to be, because `dispatch` also puts the verified session in
async-local storage around the handler (`packages/host/src/tenant-scope.ts`, wired at
`router.ts:387`), so a call site still passing `request.workspaceId` resolves the session's tenant
and has its desk id demoted to a *preference* that is then checked against the session's desks.

That backstop is the one place this lane departs from the letter of the spec, and it is worth
stating why. The spec has lane C build the seam and lane E sweep the call sites to `getTenant(request)`.
Between those two PRs, a server-mode handler that passes a bare string has no session to resolve
from — so lane C on its own would have to answer every hosted request with a refusal until lane E
merged. The async-local store closes that window without touching a handler. `getTenant(request)` is
still the contract and still what lane E sweeps to; the store is a backstop, the same idiom the host
already uses five times (`run-context.ts`, `edit/context.ts`, `sql-tool.ts`, and two in core).

The spec's other line here — `requireTenant` at the top of `dispatch` — is **not** implemented, and
deliberately. It presumes `dispatch` resolves a tenant eagerly, which would add a database
round-trip to every request including the ones that never ask. The guarantee it was there to give
(a handler that forgets cannot leak) is given instead by the two refusals below, which fire inside
`getTenant` itself.

## 3. Fail closed

The portal's browser-login grant is *assumed*, not documented: `portal-client.ts:14-24` says so in
as many words, and spec §8 q1 asks Kyo to confirm it. The lane C brief's instruction was to treat it
as unverified and check at runtime. So:

| Situation | Answer |
|---|---|
| Server mode, no session on the request and none ambient | `session_required`, 401 |
| Session names a tenant with no row, or `status != "active"` | `tenant_inactive`, 403 |
| Session's org id is not under the session's tenant id | `org_inactive`, 403 |
| Session's user is not a member of that org | `user_inactive`, 403 |
| Workspace cookie names a desk that org does not own | `workspace_not_found`, 404, cookie cleared |

None of them falls back to `local-tenant`. If the grant turns out to be wrong and no session can be
created, the hosted app refuses everyone rather than serving everyone one shared desk.

`resolvePortalTenant` (`packages/db/src/portal-owner.ts:186`) **only reads** — it is the other half
of that rule. Creating rows is the sign-in's job and the sign-in's alone.

## 4. First sign-in provisions the tenant

Per the decision already made: a `tenants` row is created on first sign-in.
`handleLogin` calls `deps.provision(...)` (`auth/routes.ts:248`) right after the portal returns
tokens and **before** `store.create(session)`, so a refused provisioning leaves no session behind.
The implementation is `ensurePortalOwner` (`portal-owner.ts:89`): tenant, org, user, org
membership, home desk, desk membership — idempotent, so a second sign-in reads and returns.

Two decisions inside it:

- **The user row is keyed on the portal `user_id`**, per spec §3a, with a placeholder
  `<id>@portal.invalid` address because `user.email` is `NOT NULL UNIQUE` (`schema.ts:18`) and two
  tenants may hold the same person's address. `.invalid` is reserved by RFC 2606, so it can never
  collide with a real one. **No schema change**: dropping the unique index is a migration and
  migrations are lane B's, so this works within the column as it stands.
- **The `organizations` row takes the portal's own `org_id` as its primary key**, so the session's
  `org_id` is a direct lookup with no mapping table. An org id the host already holds under a
  different tenant throws rather than being re-homed.

## 5. The workspace cookie and `workspace-id.txt`

`pickWorkspaceId`'s silent substitution stays on the desktop and is gone on the server: a foreign
desk is `workspace_not_found` (404), and `dispatch` attaches a cleared cookie on the way out so the
next request resolves home instead of 404ing forever (`router.ts:399`). The match is on that code
alone, so a handler's own "thread not found" never clears a desk selection.

`workspace-id.txt` names one desk for a whole machine. Rather than guard its five call sites, both
accessors return early in server mode (`workspace.ts:23`, `:35`), which covers the three writes in
`handlers/workspaces.ts` and the read at `settings-store.ts:190` at once.

## 6. CSRF bound to the session

`csrf.ts:14-17` recorded this as a Phase 2 follow-up and the spec lists it for this lane. The token
is now `<salt>.<HMAC(key, sessionId.salt)>`; `checkCsrfToken` verifies the binding after the
constant-time equality check. The pair matching proves same-origin script; the binding proves it is
*this* session's token, which is what a shared machine or a lifted cookie defeats.

Minting became re-minting (`http-adapter.ts:448`): a cookie that does not verify against the
presented session id is replaced on the next GET, so signing in, signing out and a process restart
recover by themselves. Off server mode the binding is to the empty id, so webdev and the desktop
are unchanged — the 90 existing adapter tests pass untouched.

## 7. Tests

40 new assertions, all runnable now:

| File | Covers |
|---|---|
| `packages/host/src/tenant-session.test.ts` (13) | two sessions → two orgs; foreign desk 404; unprovisioned tenant refused; mixed tenant/org ids refused; no session → 401; the ambient session; no `workspace-id.txt` write in server mode; desktop unchanged (local owner, home substitution) |
| `packages/host/src/tenant-dispatch.test.ts` (6) | the `dispatch` seam end to end: a pre-lane-E handler resolving the session's tenant, two sessions on one route, the 404 **with** the cleared cookie, an ordinary 404 left alone, 401 before the handler, desktop unchanged |
| `packages/db/src/portal-owner.test.ts` (14) | provisioning: idempotent, keyed on the portal user id, local tenant untouched, org never re-homed, two tenants disjoint; resolution: creates nothing, every refusal code, blank desk preference |
| `packages/host/src/csrf.test.ts` (+11) | token shape, binding verified / refused across sessions, anonymous ↔ signed-in, malformed and tampered tokens |
| `packages/host/src/http-adapter.test.ts` (+3) | re-mint before sign-in, re-mint for another session, no re-mint when already bound |
| `packages/host/src/auth/routes.test.ts` (+3) | sign-in provisions the three ids, provisions *before* the session row, refuses on a tenant mismatch |

Results in this container: `@agentforge/host` 1743 passed / 2 failed, `@agentforge/db` 94 passed.
Both host failures are the two the handover file already records as pre-existing and environmental
(`edit/ffmpeg-binary.test.ts` asserts a Windows `System32\where.exe` path;
`edit/import-ipc.test.ts` expects 201 and gets 400). `tsc --noEmit` on `packages/host` produces
byte-identical output to `main`'s (18 pre-existing errors, none in a file this branch touches).

## 8. What is NOT proven

- **Nothing was driven.** No server, no sign-in against a real portal, no second browser. Under
  `.cursor/skills/verify-agentforge` a green suite is not proof; `scripts/doctor.mjs` needs a booted
  app and this container has none.
- **No real portal login has ever happened**, so the grant in `portal-client.ts` is still assumed.
  The code fails closed if it is wrong, which is the point, but that is a design property and not an
  observation.
- **Two tenants have never seen disjoint data on a running server** — the spec's "done when" for
  the phase. That needs lanes D and E and a deploy.
- **The desktop was not opened.** The desktop path is unchanged by construction and covered by
  tests, but nobody launched `DPSBuddy.exe` against an existing database.

## 9. Open, for Kyo or for a later lane

1. **Role.** The portal's token body carries no role claim, so `ensurePortalOwner` makes every
   signed-in user an `owner` of their own org. If the portal is to be the authority on roles (it is
   the seat authority), the claim has to arrive in the token and `resolvePortalTenant` should read
   it rather than the local membership row.
2. **Display names.** The token body carries no tenant or org *name* either, so both rows are named
   after their id and slugged from it. Harmless today (`GET /api/v1/organizations` is the only
   surface) and worth a portal field later.
3. **The CSRF signing key is process-lifetime randomness.** Two app processes behind the proxy
   would each refuse the other's tokens. One Express host is the deployment today; more than one
   needs a shared key from the environment. A deploy decision, not one to invent here — it belongs
   with open decision 4 in [`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md).
4. **Off-request work has no tenant in server mode.** The ambient session is per request, so a job
   that outlives its request, a timer or a boot hook cannot resolve a tenant at all. Nothing does
   this on a *hosted* path today, and the edit job runner has its own named unscoped reads from lane
   A. Lane D should pass the tenant explicitly wherever it moves work off-request.
5. **`adoptLegacySettings` is not run for a session-resolved tenant.** It migrates a pre-desk
   settings slice into home, which is a desktop-upgrade concern; on a server it would reach across
   the one shared `settings.enc`. Lane D owns per-tenant settings and should confirm nothing is
   owed here.
6. **Lane E still has to sweep.** `getTenant(request)` is the contract; 102 sites still pass a bare
   desk id and work only because of the ambient store. The sweep is mechanical and changes no
   desktop behaviour, and lane E's harness is what proves every by-id route 404s under a foreign
   tenant.

## 10. Environment notes

`pnpm install` needed the `xlsx` workaround from
[`handover-2026-09-20.md`](handover-2026-09-20.md) ("Environment notes for cloud sessions"); the
three manifests were restored before committing and `git diff --name-only` confirms neither
`pnpm-lock.yaml` nor `packages/core/package.json` is in this branch.

`biome check` flags **every** file in a Linux checkout, including ones this branch never touched,
because `biome.json` sets `lineEnding: "crlf"` while git stores and checks out LF
(`git ls-files --eol` reports `i/lf w/lf`). It is an artifact of working outside Kyo's Windows
checkout, not a signal. The files this branch changed were formatted with
`biome check --write --line-ending=lf` and are clean under that flag.

The `playwright` check on GitHub Actions is red on every run in this repository's history,
including on `main`, because of the Actions billing lock on the account. It is not a signal about
this branch.
