# Map — The per-tenant state backend and the wrap-key rotation drill

Last verified: 2026-09-20 at a053245 + the Phase 4 branch `feat/web-phase4-tenant-secrets-rcbu9c`

## Overview

Two payloads belong to a tenant and to nobody else: the **sealed settings** (which contain that tenant's
gateway key) and the **gateway verdict** (a cached answer from the gateway about that key). Phase 3 lane D
gave each tenant its own copy of both, as files under `tenants/<tenantId>/`. Phase 4 puts the same two
payloads behind one interface with two implementations, and picks between them **by mode, never by tenant**:
off server mode they are exactly lane D's files, in server mode they are rows in `tenant_state`.

This page is about that seam and the operational procedure it makes possible — rotating the key that wraps
every tenant's settings without losing anybody's. It is not about paths; that is
[`tenant-storage.md`](tenant-storage.md). It is not about what the settings mean or what the verdict decides;
that is [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md).

Full lane record, including what still needs a live test: [`../web-phase4-tenant-secrets.md`](../web-phase4-tenant-secrets.md).

## How it works

### The rule

```ts
export function tenantStateBackend(): TenantStateBackend {
  return isServerMode() ? dbTenantStateBackend : fileTenantStateBackend;
}
```

`tenantStateBackend` (`packages/host/src/tenant-state-store.ts:319-321`) is resolved **per call**, not once
at import. The test suites and `apps/web` both flip `AGENTFORGE_SERVER` after the module graph is loaded, and
a backend frozen at import time would answer for the mode the process started in rather than the one it is
in.

Nothing above this function knows which store it is talking to. `settings-store.ts` and `gateway-gate.ts`
name a tenant and a key; the backend decides what that means.

### The two keys

`TENANT_STATE_KEYS = ["settings", "gateway_gate"]` (`packages/core/src/tenancy/state-keys.ts:14`). They are
payload names, deliberately not filenames: `settings.enc` is a desktop path that predates tenancy and has to
stay exactly where it is, while `settings` is what the payload *is*. A column carrying the filename would
make the row backend a description of the file layout rather than an alternative to it.

The map from key to desktop filename lives in one place,
`TENANT_STATE_FILENAMES` (`packages/host/src/tenant-state-store.ts:48-51`):

| Key | Desktop file | Hosted row |
|---|---|---|
| `settings` | `settings.enc` | `tenant_state(tenant_id, 'settings')` |
| `gateway_gate` | `gateway-gate.json` | `tenant_state(tenant_id, 'gateway_gate')` |

`packages/host/src/tenant-state.test.ts` greps the host source for those two string literals and fails if
anything outside this module spells them — `handlers/settings.ts` is the one exemption, because
`HOST_RESET_ENTRIES` is a list of names on disk rather than a payload lookup, and a second test pins that
list against `TENANT_STATE_FILENAMES` so a payload that gains a file cannot be left off "Start over".

### The interface

`TenantStateBackend` (`packages/host/src/tenant-state-store.ts:65-78`) is seven members:

| Member | Contract |
|---|---|
| `kind` | `"file"` or `"db"`, for log lines and for tests that assert which store was used |
| `read` | the payload and a change token, or `null` when this tenant has never stored one |
| `stamp` | the change token alone, without paying for the payload |
| `write` | replace |
| `remove` | idempotent; removing what is not there is not an error |
| `tenantsWith` | every tenant holding a payload of this kind — the rotation drill is the only caller |
| `describe` | where the payload lives, for a message. **Never the payload itself** |

The **stamp** is what lets `settings-store.ts` keep a decrypt cache without re-reading. It is
`statSync().mtimeMs` on a file and `updated_at` on a row; callers only ever compare it to a previous one
(`TenantStateEntry`, `:63`).

### The file backend — unchanged desktop behaviour

`fileTenantStateBackend` (`packages/host/src/tenant-state-store.ts:90-170`) resolves a key to
`tenantDataDir(tenantId)/TENANT_STATE_FILENAMES[key]` (`statePath`, `:86-88`), which for `local-tenant` is
the install root itself — lane D's one rule. An existing desktop data directory therefore opens with nothing
moved, by construction rather than by a migration.

Three details worth knowing:

- **`read` stats first, then reads** (`:93-106`). A stamp taken *after* the read could belong to a write that
  landed between the two calls, and the cache would then serve stale bytes under a fresh token.
- **`write` is temp-file-then-rename** (`:119-128`). `saveGateState` already did this; `settings.enc` was
  written in place before Phase 4 and is no worse off for the change.
- **`tenantsWith` walks the layout, not a table** (`:140-165`): the bare filename at the install root means
  the local tenant is present, and each directory under `tenants/` is checked for the same filename. The
  local tenant is never listed under `tenants/`.

### The row backend — the hosted server

`dbTenantStateBackend` (`packages/host/src/tenant-state-store.ts:263-312`) is four statements against
`tenant_state`. The write is an upsert whose stamp is forced to move:

```sql
ON CONFLICT(tenant_id, key) DO UPDATE SET
  value = excluded.value,
  updated_at = max(excluded.updated_at, tenant_state.updated_at + 1)
```

(`:283-296`.) `updated_at` is the cache stamp, so it has to advance on every write even when the bytes are
identical — two saves inside the same millisecond would otherwise read as "unchanged" and serve a stale
decrypt. `max(?, updated_at + 1)` makes the column strictly increasing per row without depending on the
clock's resolution.

### Why the connection is injected

`tenant-state-store.ts` does **not** import `@agentforge/db`. It declares the narrow slice of a
`better-sqlite3` connection it needs (`TenantStateSql`, `:231-237`) and waits to be handed one
(`registerTenantStateSql`, `:242-244`).

The reason is an import side effect: importing `@agentforge/db` *opens* the SQLite file
(`packages/db/src/client.ts`), and `tenant-state-store.ts` sits under `settings-store.ts`, which sits under
half the host — including `edit/asr.ts` and from there the ffmpeg doctor. A static import would make every
unit test about any of those open a database it has no use for, and `edit/ffmpeg-binary.test.ts`, which mocks
`node:fs` wholesale, fails on the client's `mkdirSync` before reaching its first assertion.

`packages/host/src/tenant-state-db.ts` holds the import and installs the connection; `packages/host/src/router.ts:2`
pulls it in, so every request that could reach a tenant's settings has installed the backend before it gets
there.

**With nothing installed, server mode throws** — `tenant_state_backend_missing`, a 500 (`requireSql`,
`packages/host/src/tenant-state-store.ts:251-261`). It never falls back to the files. A silent fall back to a
store nobody backs up is the failure this whole module exists to prevent.

### Adoption — a server upgrading into Phase 4

Phase 3 shipped hosted tenants writing `tenants/<id>/settings.enc`. A server that upgrades with those files
on its data volume must not read back an empty key and send the tenant to onboarding.

`adoptLegacyFile` (`packages/host/src/tenant-state-store.ts:192-219`) runs on the first read for a tenant
that has no row: it copies the file's bytes into the row **verbatim** — the envelope is unchanged, so there
is nothing to re-encrypt — and renames the file to `settings.enc.adopted` (`ADOPTED_SUFFIX`, `:57`).

- The rename is what makes it safe on every boot: once the row exists the file can no longer shadow it.
- It **never deletes**. Adoption is a one-way move of somebody's only copy of their key, so the bytes stay on
  disk under a name nothing reads.
- A rename that fails is logged and ignored (`:204-216`); the row is written, which is the part that matters,
  and the next boot adopts the same file onto the same row idempotently.
- It is attempted once per tenant and key per process (`adoptionChecked`, `:178`), not on every settings read
  of every request.

Log fields say `payload: key`, not `key: key` — the redacting logger drops any field whose **name** contains
a credential word, so a field called `key` would be written as `"[dropped]"` and the line would not say what
was moved (`:209-210`).

### The wrap-key rotation drill

`AGENTFORGE_SECRETS_KEY` wraps every tenant's settings envelope. Rotating it means opening each tenant's
payload with the old key and re-sealing it with the new one, and it must be all-or-nothing: a half-rotated
data directory is a set of tenants who cannot sign in.

`rotateWrapKey` (`packages/host/src/wrap-key-rotation.ts:95-179`) is two phases:

1. **Open everything, write nothing** (`:110-146`). Every tenant in `backend.tenantsWith("settings")` is
   read, parsed, checked to be a sealed envelope, and decrypted with the old key into memory. Any failure
   throws a `WrapKeyRotationError` naming the tenant, and **nothing has been written**. The GCM failure's
   detail is deliberately not carried (`:136-143`): it says nothing useful and would invite someone to paste
   key material into an issue.
2. **Write, then prove** (`:154-175`). Each re-sealed payload is written, then read back and decrypted with
   the **new** key. A payload that will not open after the write throws rather than reporting success.

`--dry-run` returns after phase one (`:149-152`), so a rehearsal proves every payload opens with the current
key and writes nothing.

Refusals, all before any write (`assertUsableSecret`, `:71-85`):

| Case | Why |
|---|---|
| `--to` is weak or has no key-like variety | the new key is the one that has to be strong; `hasKeyLikeVariety` is the same check server mode makes at boot |
| `--from` is weak | **allowed** — the whole point may be to get off a weak key |
| `--from` equals `--to` | nothing to rotate (`:98-100`) |
| a payload will not open with `--from` | phase one, so nothing has been written |

The CLI is `scripts/rotate-wrap-key.ts`. Keys come from `--from-env NAME` / `--to-env NAME` in preference to
`--from` / `--to`, because a key passed as an argument is in the shell history and in `ps` output. Nothing
prints a key. Exit codes are the result: `0` rotated (or would), `1` refused before writing, `2` called
wrongly. `AGENTFORGE_SERVER` picks which store is rotated, exactly as it picks which one the app uses;
rotating the wrong store reports 0 tenants rather than losing anything.

**Gate verdicts are not rotated.** They are not sealed — a verdict is a fingerprint and a status, never the
key — so there is nothing to re-wrap, and losing one costs a re-check.

The operator runbook is [`../web-phase4-tenant-secrets.md`](../web-phase4-tenant-secrets.md) §5.

**The CLI is the only entry point that is not a request, and it shipped broken.** Run against the hosted
store, as its own header documents, it died with `tenant_state_backend_missing` before reading a tenant: only
`router.ts` installs a connection, and every rotation test injected a backend, so nothing covered it. Two
rules came out of the fix, both load-bearing:

- **Every host import in `scripts/rotate-wrap-key.ts` is dynamic and has to stay that way**
  (`scripts/rotate-wrap-key.ts:27-41`, `:84-98`). `tsx` compiles the file to CJS, so a static `import` is a
  `require` while an `await import()` goes through the ESM loader; mix the two over the same host module and
  the process holds two copies of `tenant-state-store.ts` — the connection installs into one, the rotation
  reads the other, and it fails exactly as if nothing had been installed. Keeping the whole graph behind the
  server-mode branch is also what stops a desk rotation opening a database it is not rotating.
- **`migrationsFolder` now also resolves from the repository root** (`packages/db/src/ensure-schema.ts:63-84`).
  It only looked at `../../packages/db/drizzle`, i.e. from a package directory such as `apps/web`, so opening
  the database from the repo root — where operator scripts are documented to run — threw before the rotation
  began.

`packages/host/src/wrap-key-rotation-script.test.ts` spawns the real file in a real process against a real
database, because neither bug was visible from a unit test.

### The schema

Migration `packages/db/drizzle/0018_tenant_state.sql`:

```sql
CREATE TABLE IF NOT EXISTS `tenant_state` (
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE cascade,
  `key` text NOT NULL,
  `value` text NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`tenant_id`, `key`)
);
CREATE INDEX IF NOT EXISTS `tenant_state_key_idx` ON `tenant_state` (`key`);
```

Drizzle table: `tenantState`, `packages/db/src/schema.ts`. Healer for a baseline-stamped database:
`ensureTenantStateTable` (`packages/db/src/ensure-schema.ts:494`), called from `:237`.

It is keyed on the **tenant**, not on an organization: a tenant's sealed settings are the tenant's, not any
one org's, and the tenant is all a rotation has to walk. `packages/db/src/migrate-0015.test.ts` asserts the
full set of tables carrying a `tenant_id` and now names this one.

**Numbering, and a hazard for Phase 5 lane B.** `0017` is reserved for lane B, which is already in flight, so
this migration is `0018` and the journal has a gap at `idx: 17`. The runner is forward-only on `when`
(`lastAppliedCreatedAt < entry.when`, `packages/db/src/ensure-schema.ts`), so a `0017` added *later* with a
`when` below this file's would be **skipped** on any database that already ran this one. Lane B must give its
migration a `when` above `1788820000010`. The migration file's own header says so, and
`packages/db/src/migrate-0018.test.ts:142-170` asserts that ordering: that `0018`'s `when` is above `0016`'s,
and that **any** `0017` entry's `when` is above `0018`'s. It deliberately does not assert that `0017` is
absent, which is what it did first — lane B's perfectly correct migration would have turned that red, and the
obvious way to clear a red like that is to delete the line, taking the real rule with it.

## Where things live

| File | Role |
|---|---|
| `packages/core/src/tenancy/state-keys.ts` | `TENANT_STATE_KEYS`, `isTenantStateKey` — the two payload names |
| `packages/host/src/tenant-state-store.ts` | The interface, both backends, `TENANT_STATE_FILENAMES`, adoption, the connection seam |
| `packages/host/src/tenant-state-db.ts` | Three lines: the only place the row backend is handed a connection |
| `packages/host/src/router.ts` | Imports the above, which is what installs it |
| `packages/host/src/settings-store.ts` | The `settings` payload: seal, open, cache, per-user locale |
| `packages/host/src/gateway-gate.ts` | The `gateway_gate` payload: `loadGateState`, `saveGateState`, `clearGateState` |
| `packages/host/src/wrap-key-rotation.ts` | `rotateWrapKey`, `WrapKeyRotationError` |
| `scripts/rotate-wrap-key.ts` | The CLI an operator runs |
| `packages/db/drizzle/0018_tenant_state.sql` | The table |
| `packages/db/src/schema.ts` | `tenantState` |
| `packages/db/src/ensure-schema.ts` | `ensureTenantStateTable`, the healer for baseline-stamped databases |

## Gotchas

- **The backend is chosen by mode, never by tenant.** A hosted server keeps *every* tenant's state in rows,
  the local tenant included; a desk keeps every tenant's state in files. Mixing the two in one process is not
  a supported state, and nothing in the code tries to reconcile them.
- **`tenantsWith` is the rotation drill's only caller.** It is a directory walk on a desk and a full-table
  scan on the server. Do not reach for it on a request path.
- **The stamp is opaque.** It is a number on both backends today, but it is typed and documented as a token
  to compare, not a time. Reading it as a timestamp will be wrong the first time the row backend needs a
  monotonic bump (`max(excluded.updated_at, tenant_state.updated_at + 1)`).
- **A payload that will not decrypt is not the same as a payload that is not an envelope.** The first is a
  wrong wrap key: server mode refuses the request (`settings_unreadable`, 500) and leaves the bytes alone,
  because quarantining one tenant's key on a shared box is a data loss the tenant cannot undo. The second is
  a corrupt file: the desktop's quarantine-and-start-fresh behaviour is unchanged
  (`onUndecryptableSettings`, `packages/host/src/settings-store.ts:373-385`).
- **Adoption leaves `.adopted` files behind on purpose.** They are somebody's only copy of their key if the
  row is ever lost. An operator may remove them once a backup of the database exists; nothing does it
  automatically.
- **`0018`, not `0017`.** See the numbering hazard above before adding the next migration.

## Verify

No feature file: two tenants on a running server needs a portal sign-in, and the rotation drill needs a real
data directory. What proves this page today:

| Check | Where |
|---|---|
| Two tenants' keys land as rows, and the data directory stays empty | `packages/host/src/tenant-secrets.test.ts` |
| A row holds neither the key nor `openaiApiKey`, and parses as a `v:1` AES-256-GCM envelope | same |
| A desk writes lane D's exact paths and zero rows | same |
| Server mode with nothing registered throws rather than using files | same |
| Adoption imports once and leaves `.adopted` behind | same |
| Rotation across both backends, and every refusal leaving the other tenant's bytes byte-identical | `packages/host/src/wrap-key-rotation.test.ts` |
| The error names the tenant and contains neither key | same |
| Table shape, the cascade, the FK, the index, `tenant_usage` untouched, journal ordering, the healer | `packages/db/src/migrate-0018.test.ts` |
| Nothing outside the state store spells `settings.enc` or `gateway-gate.json` | `packages/host/src/tenant-state.test.ts` |

Still owed on kyo's machine, because the cloud cannot run them:
two tenants signing in on a server and each getting its own gateway key; a rotation drill against a real data
directory; the desktop opened on an existing data directory with nothing moved. The full list is
[`../web-phase4-tenant-secrets.md`](../web-phase4-tenant-secrets.md) §9.
