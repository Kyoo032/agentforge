# Map — Tenant resolution, the session seam and the workspace cookie

Last verified: 2026-09-20 at a504555

## Overview

Every handler in the host starts by asking "whose data is this?" and gets its answer from
`getTenant()`. This page is how that question is answered: from the single local owner on the
desktop and webdev, and from the **verified browser session** on the hosted server. It also covers
the two client-supplied things that used to decide it and no longer do — the `agentforge_workspace`
cookie and the machine-wide `workspace-id.txt`.

This is Phase 3 lane C. The data model underneath it is
[`tenancy-schema.md`](tenancy-schema.md) (lane B); the edit store's own desk scoping is
[`edit-timeline.md`](edit-timeline.md) (lane A). Per-tenant files and storage prefixes (lane D) and
the by-id route harness (lane E) do not exist yet.

## How it works

### The two doors into `getTenant`

`getTenant(input?)` (`packages/host/src/tenant.ts:88`) takes either a bare desk id — which is what
all 102 existing call sites pass, as `getTenant(request.workspaceId)` — or the request itself,
`getTenant(request)`, which carries `session`. Both shapes are one function on purpose
(spec §3c): a second resolver would mean classifying 102 sites by hand with no compiler help.
`TenantInput` (`:40`) is the union; `isRequestLike` (`:66`) tells the two apart.

The resolution order inside it (`:88-103`):

1. a `session` on the request, if the caller passed one;
2. otherwise the **ambient** session for this request (`currentRequestSession()`,
   `packages/host/src/tenant-scope.ts:26`);
3. otherwise, off server mode, the local owner (`resolveLocalOwner`, `tenant.ts:117`);
4. otherwise — server mode, no session anywhere — `ApiError("session_required", 401)` (`:100`).

Step 4 is the fail-closed rule. Nothing in server mode falls back to `local-tenant`. That matters
because the portal's browser-login grant is assumed rather than documented
(`packages/host/src/auth/portal-client.ts:14-24`, spec §8 q1): if the assumption is wrong, sessions
cannot be created and the app refuses everyone, rather than serving everyone one shared desk.

### The ambient session

`dispatch` (`packages/host/src/router.ts:387`) runs the matched handler inside
`withRequestSession(session, …)` (`tenant-scope.ts:22`), an `AsyncLocalStorage` — the same idiom as
`run-context.ts`, `edit/context.ts` and `sql-tool.ts`. So a handler that has not yet been swept to
pass the request still resolves **the session's** tenant, and the desk id it passes is demoted to a
preference that is then checked.

Without this, lane C would close the seam and leave every hosted handler resolving `local-tenant`
until lane E's sweep landed. `getTenant(request)` is still the contract and still what lane E sweeps
to; the store is the backstop. A job that outlives its request has no store, and in server mode that
is a refusal, not a fallback.

### Resolving a session

`resolveFromSession` (`tenant.ts:105`) hands the session's three ids to `resolvePortalTenant`
(`packages/db/src/portal-owner.ts:186`), which **only reads**:

| Check | Refusal |
|---|---|
| `tenants` row exists and `status = "active"` | `tenant_inactive`, 403 |
| `organizations` row matching `id = orgId AND tenant_id = tenantId` | `org_inactive`, 403 |
| `organization_members` row for that org and user | `user_inactive`, 403 |
| the preferred desk is one of that org's `workspaces` | `workspace_not_found`, 404 |

The org lookup pins both ids in one `WHERE` (`portal-owner.ts:197-202`), so an org id from another
tenant cannot resolve even when both ids are individually real. The role comes from the membership
row, not from a constant. Status and message per code: `tenant.ts:48-60`.

### Where the rows come from: first sign-in

`resolvePortalTenant` creates nothing, so something else must. That something is the sign-in, and
only the sign-in: `handleLogin` calls `deps.provision(...)` (`packages/host/src/auth/routes.ts:248`)
immediately after the portal returns tokens and **before** the session row exists, so a refused
provisioning leaves no session behind. The real implementation is `ensurePortalOwner`
(`portal-owner.ts:89`), wired in at `packages/host/src/auth/index.ts:136` through a dynamic
`import("@agentforge/db")` — a static one would open SQLite when the desktop merely imports the
router, which is why `createHostSessionStore` (`auth/session-store.ts:141`) already does the same.

`ensurePortalOwner` writes, idempotently: the `tenants` row, the `organizations` row **with the
portal's own org id as the primary key**, the `user` row keyed on the portal user id, the org
membership as `owner`, a home desk and its workspace membership. Two details that are decisions, not
accidents:

- **The user is keyed on the portal `user_id`**, with a placeholder `<id>@portal.invalid` address
  (`portal-owner.ts:81`), because `user.email` is `NOT NULL UNIQUE` (`packages/db/src/schema.ts:18`)
  and two tenants may hold the same person's address. Spec §3a: the host never authenticates on an
  address; only the portal does.
- **Slugs are derived from ids** (`portal-owner.ts:66`). The portal's token body carries no name or
  slug, and `slug` is `NOT NULL` and unique per tenant.

An org id the host already holds under a *different* tenant throws `PortalProvisionError`
(`portal-owner.ts:113`), which the sign-in turns into `org_inactive` 403 (`auth/routes.ts:94`). The
rows are never re-homed.

### The workspace cookie

`agentforge_workspace` is entirely client-supplied: the HTTP adapter copies it onto the request at
`packages/host/src/http-adapter.ts:488`. On the desktop, `pickWorkspaceId`
(`packages/core/src/local-owner.ts:16-31`) silently substitutes home for an id it does not
recognise. On the hosted server that substitution is gone: a desk the session's org does not own is
`workspace_not_found`, 404, and `dispatch` attaches a cleared cookie on the way out —
`clearStaleWorkspaceCookie` (`router.ts:399`), matching **only** that code, so a handler's own "not
found" for a thread or an artifact never clears a desk selection.

`workspace-id.txt` is desktop and webdev only from here on. Rather than guarding its five callers,
both accessors return early in server mode (`packages/host/src/workspace.ts:23`, `:35`), which also
covers the three direct writes in `handlers/workspaces.ts` and the settings read at
`settings-store.ts:190`. One file naming one desk for a whole machine is right for an installed app
and wrong for a shared server.

### CSRF bound to the session

The double-submit pair (cookie + `x-agentforge-csrf` header) proves the call came from same-origin
script. It does not prove it came from *this* signed-in person, which is the gap a shared machine or
a lifted cookie walks through. So the token is now `<salt>.<HMAC(key, sessionId.salt)>`
(`packages/host/src/csrf.ts:87`), and `checkCsrfToken` verifies the binding after the equality check
(`:143`). `csrfTokenMatchesSession` (`:103`) is the predicate.

The adapter reads the presented session id straight off the cookie jar
(`http-adapter.ts:404`) — unverified, which is fine: the router's gate verifies it a frame later,
and a bogus id simply gets a token nobody else holds. Minting became **re-**minting
(`http-adapter.ts:448`): a cookie that does not verify against the current session id is replaced on
the next GET, so signing in, signing out and a process restart all recover by themselves instead of
403ing forever.

Off server mode there is no session, so the binding is to the empty id. One code path; webdev and
the desktop behave exactly as before.

## Where things live

| File | Role |
|---|---|
| `packages/host/src/tenant.ts` | `getTenant`, the two doors, the fail-closed refusal, the failure→status table |
| `packages/host/src/tenant-scope.ts` | the request's verified session in `AsyncLocalStorage` |
| `packages/db/src/portal-owner.ts` | `ensurePortalOwner` (writes, sign-in only) and `resolvePortalTenant` (reads) |
| `packages/db/src/ensure-local-owner.ts` | the desktop's half: one local owner, one org, one home desk |
| `packages/host/src/router.ts` | the session gate, `withRequestSession` around the handler, the stale-cookie clear |
| `packages/host/src/http-adapter.ts` | reads both cookies off the wire; mints and re-mints the CSRF token |
| `packages/host/src/csrf.ts` | the salted HMAC token and its verification |
| `packages/host/src/workspace.ts` | `workspace-id.txt`, desktop-only since lane C; the cleared cookie |
| `packages/host/src/auth/routes.ts` | `handleLogin` provisions before it creates the session |

Tests: `packages/host/src/tenant-session.test.ts` (resolution),
`packages/host/src/tenant-dispatch.test.ts` (the `dispatch` seam and the cookie clear),
`packages/db/src/portal-owner.test.ts` (provisioning and refusals),
`packages/host/src/csrf.test.ts` (the binding), `packages/host/src/http-adapter.test.ts`
(re-minting). Verify recipe: `.cursor/skills/verify-agentforge/features/gateway-gate.md` covers the
gate; a `login.md` recipe lands with the sign-in screen and is not written yet.

## Gotchas

- **The ambient session is a backstop, not the contract.** Read `getTenant(request)` as the real
  seam. A background worker, a timer or anything started outside a request has no store, so in
  server mode it cannot resolve a tenant at all. Lane D and anything that runs jobs off-request will
  have to pass the tenant explicitly.
- **`getTenant(someString)` still compiles everywhere and now means something different in server
  mode**: the string is a *preference* checked against the session's desks, not the thing that
  decides. That is why a foreign desk 404s instead of silently working.
- **Nothing here is an entitlement check.** Same rule as the gateway gate (`AGENTS.md`): seats,
  plans and spend are enforced server-side by the portal against the bearer. This decides which rows
  a request may read.
- **The CSRF signing key is process-lifetime randomness** (`csrf.ts:37-44`). Two app processes behind
  the proxy would each refuse the other's tokens. One Express host is the deployment today; more
  than one needs a shared key from the environment, which is a deploy decision and is recorded as
  open in [`../web-phase3-lane-c.md`](../web-phase3-lane-c.md).
- **`adoptLegacySettings` runs only on the local path** (`tenant.ts:124`). It migrates a
  pre-desk settings slice into the home desk, which is a desktop-upgrade concern; running it per
  tenant on a server would reach across another tenant's `settings.enc`. Lane D made the file per
  tenant and made `adoptLegacySettings` a no-op in server mode for exactly this reason
  (`settings-store.ts:395-404`); see [`tenant-storage.md`](tenant-storage.md).
- **None of this has been driven.** Nothing on a server, no sign-in against a real portal, no two
  browsers. Tests and a typecheck are not proof under `.cursor/skills/verify-agentforge`.
