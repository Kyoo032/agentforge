# Phase 4 — per-tenant secrets, data directory and gate verdicts

Record of the Phase 4 change. Plan: [`web-migration-plan.md`](web-migration-plan.md), the
"Phase 4 — Secrets and data dir per tenant" section. Predecessor:
[`web-phase3-lane-d.md`](web-phase3-lane-d.md) (the filesystem half of tenancy), and
[`web-phase3-lane-c.md`](web-phase3-lane-c.md) (how a request resolves to a tenant at all).
Maps: [`maps/tenant-secrets-backend.md`](maps/tenant-secrets-backend.md), plus updates to
[`maps/settings-and-gateway-gate.md`](maps/settings-and-gateway-gate.md),
[`maps/tenancy-schema.md`](maps/tenancy-schema.md) and
[`maps/locale-boot-and-run-harness.md`](maps/locale-boot-and-run-harness.md).

Branch `feat/web-phase4-tenant-secrets-rcbu9c`, cut from `main` at `a053245` — the commit after
lane D (`1416002`) merged, so lanes A to E are all under it.

## 1. Which reading of the plan this followed

The plan's Phase 4 section and the coordinator's brief agree on the substance, and the plan doc
wins where they differ. Four things are named in the plan:

> `settings-store.ts:26-27` grows a storage interface with a file backend (desktop, unchanged) and
> a DB-row backend (web), keeping the envelope from `crypto/envelope.ts` and `getLocalVaultKey()`
> as the wrap key in both; `loadSettings` / `saveSettings` take the tenant; `gateway-gate.ts:101-103`
> moves its state to the same backend; the locale at `settings-store.ts:121` becomes per user.

All four are done. `loadSettings` / `saveSettings` taking the tenant was already true — lane D did
it — so what was left there was the backend swap underneath them.

The plan's **done when** is "two tenants each paste their own key and each gets their own gate
verdict on the hosted server", and its **tests** clause adds "a wrap-key rotation re-encrypts
without data loss". The brief added a fifth item, closing the shared-gateway-key residual from
[`security-owasp-2026-09.md`](security-owasp-2026-09.md) A01-3. That is not in the plan's Phase 4
section in those words, but the plan's own risk note says `clearGatewayKeyEverywhere` is "not a
Phase 4 risk — Phase 4 only has to keep that scoping when the backend changes", and A01-3 names
Phase 4 as the owner of the residual. So it is in, and §3 is what it turned out to be.

One thing the brief asked for that this does **not** do: it does not move the data directory. Lane
D already placed every per-tenant path and froze the local tenant's at the install root, and the
plan's Phase 4 wording is about *what backend the state lives in*, not about moving trees. Phase 6
owns media and job storage. What "per-tenant data dir" means after this change is in §2.

## 2. The rule

> **The backend is chosen by mode, never by tenant.** `isServerMode()` → rows in `tenant_state`.
> Anything else → the files lane D placed, at the exact paths lane D placed them.

That is the whole selection logic, in `tenantStateBackend()`
(`packages/host/src/tenant-state-store.ts:281`). Two consequences worth stating plainly:

- **A desktop data directory is byte-identical before and after this change.** Not "migrated
  carefully" — untouched. The file backend writes `<data>/settings.enc` and
  `<data>/gateway-gate.json` for the local tenant and `<data>/tenants/<id>/…` for anyone else,
  which is exactly lane D's table. The `tenant_state` table exists on a desk and stays empty.
- **On a hosted server no tenant's secrets touch the disk at all.** That is what the phase buys: a
  container rebuilt without its data volume no longer takes every tenant's key with it, and two app
  processes behind the proxy no longer write the same file with no lock between them.

There is deliberately **no fallback** from one backend to the other at read time. A hosted read that
finds no row does not go looking for a file (except once, for adoption — §4), because a silent fall
back to a store nobody backs up is the failure this whole module exists to prevent.

| | desk / webdev | hosted server |
|---|---|---|
| tenant settings | `<data>/settings.enc`, `<data>/tenants/<id>/settings.enc` | `tenant_state(tenant_id, 'settings')` |
| gate verdict | `<data>/gateway-gate.json`, `<data>/tenants/<id>/gateway-gate.json` | `tenant_state(tenant_id, 'gateway_gate')` |
| wrap key | `AGENTFORGE_SECRETS_KEY`, else `.master-key` | `AGENTFORGE_SECRETS_KEY`, mandatory |
| envelope | `crypto/envelope.ts` AES-256-GCM | the same bytes, in a column |

### What is in the new module

`packages/host/src/tenant-state-store.ts`:

| Export | Line | Does |
|---|---|---|
| `TENANT_STATE_FILENAMES` | `:38` | the two desktop filenames, and **the only place in the host that spells them** |
| `ADOPTED_SUFFIX` | `:47` | `.adopted`, the name an imported file keeps |
| `TenantStateBackend` | `:55` | `read` / `stamp` / `write` / `remove` / `tenantsWith` / `describe` |
| `fileTenantStateBackend` | `:80` | lane D's paths, with the write now temp-file-and-rename |
| `registerTenantStateSql` | `:190` | how a connection gets in (see below) |
| `dbTenantStateBackend` | `:213` | one row per (tenant, payload), upserted |
| `tenantStateBackend` | `:281` | the rule above |

`read` returns `{ value, stamp }`. The stamp is a file's `mtimeMs` or a row's `updated_at`, and it
is what the decrypted-payload cache in `settings-store.ts` keys on — so a row rewritten by a second
app process is picked up rather than served stale, which the old single-process mtime cache could
not have told you. The row write is `max(excluded.updated_at, tenant_state.updated_at + 1)` rather
than a plain `Date.now()`: two saves inside one millisecond would otherwise read as "unchanged".

### Why the connection is injected rather than imported

`@agentforge/db`'s entry point **opens the database as an import side effect**
(`packages/db/src/client.ts:39` resolves the file, `mkdirSync`s its directory and runs
`ensureSchema`). This module is reached from `settings-store.ts`, which is reached from
`edit/asr.ts`, which is reached from the ffmpeg doctor. A static import would mean a unit test about
where `ffmpeg` lives opening a SQLite file — and `edit/ffmpeg-binary.test.ts` mocks `node:fs`
wholesale, so it would die on the client's `mkdirSync` before its first assertion. That is not
hypothetical: it is how the first cut of this change failed.

So `packages/host/src/tenant-state-db.ts` is a three-line module that holds the import and installs
itself, and `router.ts:2` imports it — the one module every request already goes through. With
nothing installed, server mode throws `tenant_state_backend_missing` rather than using the files.
Fail closed, and covered by a test that clears the registration and asserts both a read and a write
refuse.

## 3. The operator's key is not a tenant's key

A01-3 left this residual: *"on a hosted box any tenant can still set the shared gateway key"*. It
turned out to be two problems, and only one of them was the one in that sentence.

**The saved key** was already per tenant — lane D put it in a per-tenant file, and this phase puts
it in a per-tenant row. A key write reaches the caller's tenant and stops there. Nothing more was
needed.

**The unsaved key** was the half nobody had looked at. `resolveProviderKeys`
(`packages/core/src/secrets.ts:329`) fell back to `env.OPENAI_API_KEY` unconditionally. On a hosted
box that environment variable is the **operator's** credential, so every signed-in tenant who had
not saved a key of their own was silently spending it: billed to the operator, attributable to
nobody, and reachable from any tenant session by making one call. The gate's own `keyFor`
(`gateway-gate.ts:398`) had the same fallback behind `AGENTFORGE_RUNTIME=ai`.

**And `resolveProviderKeys` was not the only door.** The first pass at this closed that one function
and said the residual was closed. It was not: the verifier found three more sites reading the same
variables straight off `process.env`, and one of them was live.

- `packages/core/src/runtime/ai-sdk-runtime.ts` fell back per provider inside `execute`, behind the
  keys the caller had already resolved.
- `packages/core/src/tools/credentials.ts` built the tool secret scope a run executes with from the
  environment — the inference keys, and the `TOOL_CAPABILITIES` sweep that picks up
  `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `FAL_KEY`.
- `packages/host/src/edit/asr.ts` was the one that was actually exploitable. Edit's auto-captions
  run on the timeline worker, **after** the request that enqueued them has gone, and nothing
  re-checks the gate there — it cannot, there is no request to answer `403` to. So a hosted tenant
  could enqueue a transcription while keyed, sign out, and have it charged to the operator.

So the rule is now one function rather than a habit: `providerEnv`
(`packages/core/src/server-mode.ts`), which returns a frozen empty environment in server mode and
`env` unchanged off it. A frozen object rather than a branch per field, so a provider added later
cannot reintroduce the fallback by omission. Every site above goes through it, and:

- `resolveProviderKeys` takes its fallback from it, so the keys *and the base URLs* come from the
  tenant's own settings or from nowhere.
- `keyFor` (`gateway-gate.ts`) refuses in server mode too, so the gate's verdict and the call path
  agree about whether this tenant has a key. Without that, the gate would report `ok` on the
  operator's key while the call it gated used the same one.
- `edit/asr.ts` asks `resolveProviderKeys` which bearer pays, the way `meeting/transcribe.ts`
  already did, rather than reaching past it.
- `packages/core/src/tools/secret-scope.ts` — the fifth, found by the verifier after the four above
  were closed, and the one that proves the point. `getSecret(name)` fell back to
  `process.env[name]`: a **dynamic** index, so the sweep written for the other four could not see
  it, and a grep for `OPENAI_API_KEY` never would have either. The scope it falls back from is the
  tenant's; the environment underneath is the operator's, so on a hosted box a tenant's run picked
  up the operator's `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY` or `FAL_KEY` by asking for it by name.
  The gateway half of that was unreachable in practice — route checks and the stub runtime — but the
  search half was **live for any hosted tenant with web search bound**.
- `packages/core/src/provider-env-sweep.test.ts` greps both packages and fails on any shipped source
  outside `server-mode.ts` that reads one of these variables off `process.env`. Reviewing the sites
  found is never the fix; the fix is that the next one cannot appear unnoticed. It now covers three
  shapes, because the mistake had three: a named read, a **dynamic** `process.env[…]` index, and
  destructuring a credential out of `process.env`. The dynamic rule has an allowlist of two entries
  (`gateway.ts`'s `envTrim`, `edit/ffmpeg-binary.ts`'s `resolveNamed`), and an exception does not
  merely get named — a case reads each one's call sites and asserts every name it can be called
  with is an `AGENTFORGE_*` configuration variable, never a credential. The sweep carries its own
  bait case, so an empty result means it looked.
- A hosted tenant with no key of its own gets `needs_key` and sees onboarding. **That is the
  intended state**, not a misconfiguration, and it is what the plan's "two tenants each paste their
  own key" requires.
- Desks and webdev are untouched: the env fallback is still the documented headless path there.

`webapp-deploy/.env.example` and the "Optional, usually unset" table in
[`tencent-cvm-setup.md`](tencent-cvm-setup.md) both say so now. Neither ever had the keys set — they
are commented out in the example and `compose.yml` passes none — so no deployment changes behaviour;
what changes is that following the runbook can no longer produce a server where one tenant spends
the operator's credit.

**A consequence to schedule, not a defect here.** Closing the tool-key fallback closes the only
route a hosted tenant had to web search or FAL. Tool-key *writes* are refused in server mode
(`requestsOperatorOnlySettings` treats `toolKeys` and `toolBackends` as operator-owned — A01-3's
other half), and the deploy runbook never lists `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY` or
`FAL_KEY`, so after this change **a hosted tenant cannot obtain one at all**: not by saving it, and
no longer by borrowing the operator's. That is the right end state for a credential nobody could
attribute or meter, and the wrong end state for the feature. What is needed is an
operator-provided tool-key path — a key the operator supplies *per tenant*, or a server-side
brokered search the host calls on the tenant's behalf and meters like any other gateway call. It is
a phase's worth of design (plan, billing, quota), so it is in §10 as an open item rather than
improvised here. Until it lands, hosted web search and FAL are off, and they should be described
that way rather than appearing broken. Desks and webdev are unaffected: BYOK in Settings Extras and
the environment fallback both still work there.

**One thing loosened rather than tightened.** `DELETE /api/v1/settings/reset` with `scope: "key"`
was a 403 in server mode, and the reason was true when it was written: `clearGatewayKeyEverywhere`
and `clearGateState` were machine-wide, so one tenant pressing "forget my key" signed every other
tenant out of the gateway. Lane D scoped both to the caller's tenant and this phase moved both
payloads into that tenant's own rows, so it clears the caller's key and nobody else's. It also
*has* to be allowed: `keyFieldValue` still drops a blank key in server mode by design (the SPA posts
`openaiApiKey` from state on every save, and `mergeSecrets` deletes on an empty string), so without
this route a hosted tenant who pasted a wrong key had no way at all to take it back. `scope: "all"`
stays refused — that one really does still wipe a shared data directory, and Phase 8 owns it.

## 4. Adoption, and the two failure modes that are not the same

**Adoption.** A server that upgrades into this phase with lane D's per-tenant files on its data
volume must not read back an empty key and send its tenants to onboarding. So the first hosted read
for a tenant that has no row imports the file's bytes **verbatim** — the envelope is unchanged, so
there is nothing to re-encrypt — writes the row, and renames the file to `settings.enc.adopted`.

The rename is what makes this safe to run on every boot: once the row exists the file cannot shadow
it. It is a rename and never a delete, because this is somebody's only copy of their key until the
row is trusted. If the rename fails the row is still written, the next boot adopts the same bytes
onto the same row, and that is idempotent. Attempted once per tenant and payload per process, not
per request.

**A payload that will not open.** Lane D flagged this for Phase 4 and it needed splitting in two,
because the two halves have opposite right answers and shared one code path:

- *Not a sealed envelope at all* — truncated, hand-edited, half-written. There is nothing in it to
  lose, so it is moved aside and the tenant starts empty, exactly as before. File backend only: a
  row is written in one statement and cannot be half a value, and there is nowhere to move a row to.
- *A sealed envelope that will not decrypt* — the wrap key is wrong, not the payload. The bytes are
  every key that tenant ever saved and they come back the moment the right `AGENTFORGE_SECRETS_KEY`
  is supplied. **In server mode this now refuses** (`settings_unreadable`, 500) and leaves the
  payload where it is. Quarantining would mean one bad environment variable sweeping every tenant's
  vault aside on the next boot, with nobody watching — which is also precisely what a mis-keyed run
  of the rotation drill would look like.

On a desk it still quarantines, and that is a decision rather than an oversight: the behaviour is
unchanged from before this phase, there is one owner who can restore a backup, and the app has to be
able to start for "Start over" to be reachable at all. `vault-key.ts` already refuses to re-mint a
bad `.master-key` for the same reason the server refuses here; the difference is only how many
vaults one mistake reaches. The existing test in `settings-store.test.ts:70` that asserts the
desktop quarantine is untouched and still green.

## 5. The wrap-key rotation drill

`AGENTFORGE_SECRETS_KEY` seals every tenant's settings and, until now, could not be changed: there
was no procedure, and `vault-key.ts` deliberately refuses to re-mint a key it cannot verify, because
doing that silently seals new secrets under a key the existing payloads were not sealed with.

`packages/host/src/wrap-key-rotation.ts` is the procedure and `scripts/rotate-wrap-key.ts` runs it.

**Decrypt everything before writing anything.** The rotation is a two-phase commit over tenants:
every payload is opened with the old key and re-sealed in memory first, and only if all of them
opened does anything get written. A key that is wrong for tenant 7 therefore costs nothing, rather
than leaving tenants 1 to 6 under the new key and 7 to 40 under the old one — a state no single key
can read and no second run can repair. **Verify after writing:** every payload is read back and
opened with the new key before the run reports success.

The gate verdict is not rotated and does not need to be: it is plain JSON carrying a key
fingerprint, never a key.

### The drill, as an operator runs it

```bash
# 0. Back the data volume up. This rewrites every tenant's sealed settings.
#    On the hosted deploy: the documented backup in tencent-cvm-setup.md.

# 1. Generate the new key. Keep it where the current one is kept.
openssl rand -hex 32

# 2. Rehearse. Opens and re-seals everything in memory, writes nothing, and
#    fails if any tenant's payload does not open with the current key.
export CURRENT_KEY=...      # what the app runs with today
export NEXT_KEY=...         # from step 1
AGENTFORGE_DATA_DIR=/srv/agentforge/data AGENTFORGE_SERVER=1 \
  pnpm exec tsx scripts/rotate-wrap-key.ts \
    --from-env CURRENT_KEY --to-env NEXT_KEY --dry-run

# 3. Stop the app. A rotation while requests are saving settings is a race
#    nothing here protects against.

# 4. Rotate. Same command without --dry-run.
AGENTFORGE_DATA_DIR=/srv/agentforge/data AGENTFORGE_SERVER=1 \
  pnpm exec tsx scripts/rotate-wrap-key.ts --from-env CURRENT_KEY --to-env NEXT_KEY

# 5. Put NEXT_KEY into AGENTFORGE_SECRETS_KEY and start the app.
#    Sign in as a tenant and check Settings still reports its saved key.
```

`--from-env NAME` / `--to-env NAME` read an environment variable rather than taking the key as an
argument, which is what an operator should use: a key passed as an argument is in the shell history
and in `ps` output for as long as the process runs. Nothing in the script prints a key, and no error
message carries one. Exit codes: `0` rotated (or would have), `1` refused before writing anything,
`2` called wrongly.

`AGENTFORGE_SERVER` decides which store is rotated, exactly as it decides which one the app uses.
Rotating the wrong store reports 0 tenants; it is a no-op, not a loss.

**The hosted half of that shipped broken, and this is how it was found.** Run exactly as written
above, the script died with `tenant_state_backend_missing` before reading a tenant: the hosted store
fails closed when no database connection has been installed, and only `router.ts` installs one — a
CLI is not a request. Every case in `wrap-key-rotation.test.ts` handed the rotation a backend, so
none of them went near it. The file store, which needs no connection, worked throughout.

Two things were wrong behind that one symptom, and both are fixed:

- The script installs the connection itself in server mode. Every host import in it is dynamic and
  has to stay that way: `tsx` compiles the file to CJS, so a static `import` is a `require` while an
  `await import()` goes through the ESM loader, and mixing the two gives the process two copies of
  `tenant-state-store.ts` — the connection installs into one and the rotation reads the other, which
  fails in exactly the same way as installing nothing.
- `migrationsFolder` (`packages/db/src/ensure-schema.ts`) resolved the migrations only from a
  package directory (`../../packages/db/drizzle`), so opening the database from the repository
  root — where this script is documented to run — threw before the rotation began. It now tries the
  repository root too.

`packages/host/src/wrap-key-rotation-script.test.ts` runs the real script in a real process against
a real database, because neither of those was visible from a unit test. It is the slowest test in
the package and worth it once. `wrap-key-rotation.test.ts` also has one case that injects no backend
at all, which is the call the script makes.

The current key only has to be long enough to be a key; the new one must also look generated. That
asymmetry is deliberate: rotating *away* from a weak key is a thing someone would want this for,
rotating *onto* one is not.

## 6. The UI locale belongs to the person

Lane D left this visibly undone, with the reason: the host freezes one boot locale
(`locale-boot.ts`) that every copy catalogue reads, so a per-tenant value would be stored and never
applied. That is still true of the *install's* locale. What Phase 4 adds is the *user's*.

- The sealed payload grows an optional `users: Record<userId, { locale }>` map. Still `version: 2`,
  deliberately: bumping the version would make an older build read the payload as a v1 machine-wide
  blob and lose the desks. An older build reading this simply drops the `users` field on its next
  write, losing a per-user locale and nothing else.
- `loadUserLocale(scope)` / `saveUserLocale(scope, locale)` take a `UserScope` — tenant, desk **and
  user**. A caller that cannot name a user is a compile error, not a silent fall back onto the
  install's locale.
- `loadUserLocale` falls through to the tenant's own stored locale, so a desktop owner who chose
  Indonesian before this phase still sees Indonesian without re-choosing.
- `saveUserLocale` writes the install's locale **too**, but only off server mode. On a desk the
  single owner changing language must still change the app they are looking at, and `getBootLocale()`
  reads that value. In server mode it does not: one tenant's user must not set the language every
  other tenant's process boots in.
- `localePayload(user)` reports that person's locale. On a desk `locale` stays the frozen boot value,
  so a change still offers Restart exactly as before; in server mode nothing is frozen per user, the
  two agree, and the Restart prompt never appears. `handlePing` has no tenant and still gets the
  install's pair, which is what it always had.
- `applySavedLocaleAsBoot` (the Restart control) is a no-op in server mode.
- `runs.ts:159` takes the locale from `loadUserLocale(options.tenant)` instead of `getBootLocale()`,
  and `withRunContext` carries it through every `localeForRun()` in the run. That is the whole
  change to the run harness: one line, because lane C's `RunContext` already carried a locale.

## 7. Schema

Migration `0018_tenant_state.sql`, one table, additive, no `down` (the runner in `ensure-schema.ts`
is forward-only).

```sql
CREATE TABLE IF NOT EXISTS `tenant_state` (
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE cascade,
  `key` text NOT NULL,            -- settings | gateway_gate
  `value` text NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`tenant_id`, `key`)
);
CREATE INDEX IF NOT EXISTS `tenant_state_key_idx` ON `tenant_state` (`key`);
```

Three choices worth their sentence:

- **It cascades off the tenant.** `tenant_usage` deliberately does not cascade off an organization,
  because spend has to outlive what it billed for. A sealed key is the opposite: it must not outlive
  the tenant it belongs to.
- **The foreign key is enforced**, which means `tenant_state` cannot hold secrets for a tenant this
  host has never heard of. Lane C's `ensurePortalOwner` writes the tenant row on first sign-in,
  before any settings save, so the ordering already holds — and if it ever does not, the write fails
  rather than storing orphaned key material. Tested.
- **The index is for the rotation drill**, which is the only query in the codebase that does not
  start from a tenant id.

**Numbering, and a hazard for Phase 5 lane B.** `0017` is reserved for lane B, which had not merged
when this landed, so this takes `0018` and the journal has a gap at idx 17. The runner applies a
migration only when `lastAppliedCreatedAt < entry.when`, so **a `0017` added later with a `when`
below this file's would be skipped** on any database that already ran 0018. Lane B must give its
migration a `when` above `1788820000010`, whatever tag it carries. The healer
`ensureTenantStateTable` in `ensure-schema.ts` is the net under all of this, as it is for every
table since 0010; a test asserts the journal gap and the ordering so the hazard cannot be forgotten
quietly.

## 8. Proof

Three new suites, 42 tests. Everything below was run in this container.

`packages/host/src/tenant-secrets.test.ts` (21) — the phase's own "done when", against the backend
that actually serves a hosted tenant. Two tenants save different keys and each reads its own, as
**rows**, with `readdirSync(dataDir)` asserted empty — not "the right files", *no* files. The stored
row is asserted not to contain the key or the string `openaiApiKey`, and to parse as the
`aes-256-gcm` envelope. Two tenants get their own gate verdict (`ok` and `invalid_key`) and clearing
one tenant's key and verdict leaves the other's standing. A row rewritten underneath the process
with a newer `updated_at` is picked up without anyone clearing a cache. With the backend
unregistered, both a read and a write throw. Adoption imports a lane D file once and leaves
`settings.enc.adopted`; another tenant's file is not adopted and no row is invented. The desktop
cases assert the exact lane D paths and **zero rows**. The operator-key cases drive
`resolveProviderKeys` in both modes, including the base URLs, and the gate reporting `needs_key`
under `AGENTFORGE_RUNTIME=ai` with `OPENAI_API_KEY` set. One of them drives the Edit ASR hole
directly — hosted tenant with no key of its own, operator key in the environment, and the gateway
asserted **never called**; then its own key saved and the call made with that bearer; then the same
job on a desk still using the documented env fallback. Another drives the tool-scope hole the same
way, through the scope a run actually executes in rather than by calling the helper: with the
operator's `TAVILY_API_KEY` in the environment and a keyed hosted tenant, the built scope carries
the tenant's own gateway key and none of the operator's, `getSecret` returns nothing for Tavily,
Brave or FAL inside `runWithToolSecrets`, and `listToolRoutes` reports web search **not ready**
rather than ready on somebody else's key — then the same settings on a desk autodetect Tavily and
report ready, which is the BYOK path this must not have taken away. Five locale cases, including two users on
one tenant and one desk reading different languages. And the decrypt-failure case: the read throws,
the row is still there, and the right key gets the key back.

`packages/host/src/wrap-key-rotation.test.ts` (12) — both backends. The cases that matter most are
the refusals: one tenant sealed under a different key makes the whole run throw and the *other*
tenant's bytes are asserted byte-identical afterwards, which is the two-phase commit actually
holding. The error names the tenant and contains neither key. `--dry-run` leaves the bytes alone.
The file walk finds the local tenant at the install root as well as everyone under `tenants/` — lane
D's one rule seen from the rotation's side, and a walk that only looked under `tenants/` would
silently skip the desktop owner's own key. Weak and malformed keys are refused on both sides, with
`from` allowed to be weak on purpose. The gate verdict is left alone.

`packages/host/src/wrap-key-rotation-script.test.ts` (4) — the drill as an operator runs it, added
after the version above passed while the script itself was broken (§5). It spawns the real file with
`tsx`, in server mode, against a real seeded database: the dry run writes nothing and says so, the
real run re-seals the row so the new key opens it and the old one does not, a wrong current key
exits 1 with the row byte-identical, and no output on any path contains either key.

`packages/core/src/provider-env-sweep.test.ts` (8) — the guard from §3 and the behaviour under it.
The sweep walks both `packages/core/src` and `packages/host/src`, strips comments, and fails on any
shipped source outside `server-mode.ts` that reads one of thirteen credential variables off
`process.env`, that indexes `process.env` dynamically without an allowlisted exception, or that
destructures a credential out of it. A further case holds each of the two exceptions to the names
it can actually be called with — every one an `AGENTFORGE_*` configuration variable — so an
exception cannot quietly widen into a credential read. A bait case proves the regex and the file
walk both work, so an empty offender list means it looked. Then three cases on `providerEnv`
itself: unchanged off server mode, empty in it, and frozen so a caller cannot write a key back into
it. Verified by reintroducing first the `edit/asr.ts` read and then the `secret-scope.ts` one, and
watching each go red naming its file.

`packages/db/src/migrate-0018.test.ts` (12) — the table on a fresh database and via the healer after
`DROP TABLE`; the composite key refusing a duplicate and accepting an upsert; the cascade; the
foreign key refusing an unknown tenant; the journal ordering and the reserved 0017 gap; and that the
migration text does not touch `tenant_usage`.

Extended: `packages/host/src/tenant-state.test.ts` (11 → 15). Lane D's sweep guard now covers
`loadUserLocale` / `saveUserLocale` as well, a new guard fails if any host source outside the state
store spells `settings.enc` or `gateway-gate.json` (which is why `GATEWAY_GATE_FILE` is now
re-exported from `TENANT_STATE_FILENAMES` rather than re-spelled), and one case pins
`HOST_RESET_ENTRIES` to the backend's filenames so "Start over" cannot drift from them. Every lane D
case still runs unchanged and is green — that is the desktop-unchanged claim, tested rather than
asserted.

Changed: two cases in `packages/host/src/handlers/settings.test.ts` that asserted the hosted 403 on
`scope: "key"` now assert the 200, with the reason written out, plus a new case proving a blank
Settings save still does **not** wipe a hosted tenant's key. One case in
`packages/db/src/migrate-0015.test.ts`, the guard listing every table carrying a `tenant_id`, gains
`tenant_state` with its reason.

Suite state on this branch:

| Package | Result |
|---|---|
| `@agentforge/host` | 204 files, **2109 tests, no failures** |
| `@agentforge/core` | 183 files, **2214 passed, 1 skipped** |
| `@agentforge/db` | 10 files, **122 tests** |
| `apps/web` | 96 files, **903 tests** |

Typecheck: `tsc --noEmit` reports **zero errors** on `packages/core`, `packages/db` and
`packages/host`.

Biome: no new findings. Every file this branch touches or adds was checked; the only `format`
findings are the repo-wide CRLF-vs-LF noise lane D documented (`biome.json` sets `lineEnding: crlf`
while most files are stored LF), confirmed by running the same check on two files this branch does
not touch and getting the same finding. The one `lint/style/noNonNullAssertion` in
`settings-store.ts` is pre-existing and carried verbatim from `main`. Two genuine findings in the
new tests were fixed rather than suppressed.

### Maps

`pnpm maps:check` (`scripts/map-rot.mjs`): **75 docs, 2,142 citations, 0 hard, 129 soft** — against
`main`'s 141 soft, so this branch leaves the maps in better shape than it found them, not worse.

The verifier round moved lines again (the `providerEnv` helper, the extra `migrationsFolder`
candidate), so the citations were re-anchored a second time, the same way: `map-drift.mjs` was run
once as a **report**, never with `--write`, and each proposed move was applied only where the new
line holds byte-for-byte what the old one held. 44 moved that way; 5 were deliberately left, in the
plan, the Phase 3 spec, the portal design doc, the runbook and the OWASP record, because those are
dated documents whose citations describe the code as it was when they were written.

One thing that pass exposed: **`map-drift.mjs` only sees full `path.ts:line` tokens, not the bare
`:line` follow-ups the map pages use for a run of citations into the same file.** Those had been
left behind, silently, by every drift run so far. 35 of them were re-anchored here by the same
byte-for-byte rule, walking each page and inheriting the file from the last full citation. Then
every changed citation on every map page — full and bare, 2,142 of them — was checked independently
against both trees: **0 mis-anchored**. Teaching `map-drift.mjs` itself about bare citations is in
§10; it is a tooling fix, not a Phase 4 one.

`map-drift.mjs` was read but **never run with `--write`**, per the brief: it re-points a citation
onto whatever the diff maps its line to, which for a rewritten line is often an import. Instead its
output was applied through a script that, for every proposed move, checked that the *new* line holds
byte-for-byte the same text as the old one, and rewrote whole citation tokens rather than
substrings. 123 citations were re-anchored that way. Everything it could not verify was read and
rewritten by hand — those are the claims this diff did not merely move but invalidated:

| Page | What was no longer true |
|---|---|
| `hosted-server-mode.md`, `hosted-security-controls.md` | "Start over refuses both scopes" — `scope: "key"` is now served on the server |
| `pii-and-key-security.md` | `encryptedSettingsPath` is gone; `SettingsFileV2` gained `users`; an undecryptable payload refuses in server mode instead of quarantining |
| `settings-and-gateway-gate.md` | `statePath` is gone, `keyFor` refuses the operator's environment, `resolveProviderKeys` takes an empty env in server mode |
| `tenant-storage.md` | two rows of the layout table are files only on a desk; the locale is per user |
| `locale-boot-and-run-harness.md` | the locale is no longer one machine-wide setting |
| `tenancy-schema.md`, `database-and-migrations.md` | `tenant_state`, migration `0018`, and the reserved `0017` gap |

Two citations in `legal-matter-run.md` and `documents.md` were already wrong on `main` — they named
route ranges that had drifted onto other modes' routes — and were corrected while re-anchoring them.

New page: [`maps/tenant-secrets-backend.md`](maps/tenant-secrets-backend.md), registered in
`maps/README.md`.

**Honest residue.** `map-drift.mjs` still reports moves and three unmapped citations against `main`.
That is the tool reading this branch's *own* citations as if they were `main` line numbers — the two
in `hosted-server-mode.md` and `settings-and-gateway-gate.md` are lines this branch wrote and are
correct as they stand. The third is in `web-migration-plan.md`, whose gap table is a survey of what
the code looked like when the plan was written; re-anchoring it would falsify the record, so it and
the other dated documents (the handover, the lane docs, the blockers file) were deliberately left
alone. 25 proposed moves fall in those files.

Line endings: every file this branch changes matches `main`'s, checked file by file, including the
three the brief named (`packages/core/src/index.ts`, `handlers/jobs.ts`, `handlers/settings.ts` —
all CRLF, still CRLF).

`pnpm install` needed the documented cloud workaround
([`handover-2026-09-20.md`](handover-2026-09-20.md), environment notes): `xlsx` is pinned to
`cdn.sheetjs.com`, which the network policy blocks. The three manifests were restored afterwards and
`git diff --name-only` confirms **neither `pnpm-lock.yaml` nor `packages/core/package.json` is in
this branch**.

### The verify skill

`.cursor/skills/verify-agentforge/scripts/doctor.mjs` was run, and it passed. Nothing was listening
on `127.0.0.1:3000`, so — per the skill's own rule for that case — an isolated webdev instance was
started with `AGENTFORGE_RUNTIME=stub` and its own `AGENTFORGE_DATA_DIR` outside the repo, doctored,
driven, and stopped again. It never touched the repo's `data/`.

```
verify-agentforge doctor: OK — stub runtime. Safe for Chat send without a live gateway.
{ "ok": true, "surface": "webdev", "chatStatus": 200, "runtime": "stub",
  "hasOpenai": false, "keyFingerprint": false, "knowledge": true, "curation": true,
  "modeKeys": [chat, image, video, audio, other, documents, research, presentations,
               finance, data, market, legal, meeting, music, embedding] }
```

That the app boots at all is the first real proof of this branch: the new `router.ts` import of
`tenant-state-db.ts` runs on every boot, and migration `0018` runs against a fresh database before
the first request.

**What the live instance showed, on a fresh data directory:**

| Checked | Result |
|---|---|
| `tenant_state` exists after boot | yes, with its comments intact and `PRIMARY KEY (tenant_id, key)` |
| Its indexes | `sqlite_autoindex_tenant_state_1`, `tenant_state_key_idx` |
| Journal `created_at` tail | `1788820000010, 1788820000008, 1788820000007, 1788820000006` — `0018` applied, in order, with the reserved `0017` gap |
| `tenant_usage` after `0018` | still present and untouched |
| `tenants` | one row, `local-tenant` |
| `GET /api/v1/settings` | `locale: "en"`, `savedLocale: "en"`, `runtime: "stub"`, `hasOpenai: false` |
| `POST /api/v1/settings {"locale":"id"}` | `savedLocale: "id"`, `locale: "en"` — the boot locale stays frozen and the Restart banner appears, exactly the pre-Phase-4 desktop behaviour |
| Where that save landed | `settings.enc` at the **install root**, 324 bytes, parsing as `{v:1, alg:"aes-256-gcm", n, ct, tag}` |
| `tenants/` subdirectory | does not exist |
| `tenant_state` rows after the save | **0** — off server mode the desk writes a file and never a row |

That last pair is the desktop guarantee this phase had to keep, driven rather than argued.

**Still not driven:** anything that needs two tenants or server mode. The container cannot reach a
portal to sign anyone in, so hosted behaviour is proved by the suites in §8 and re-reading, not by an
action on a running app. §9 lists what that leaves owing.

## 9. What still needs kyo's machine

1. **Two tenants on a running server.** Sign two tenants in, save a different gateway key under
   each, and confirm each Settings page reports its own key state and its own gate verdict. Then
   `sqlite3 <data>/agentforge.sqlite "SELECT tenant_id, key, length(value) FROM tenant_state;"` —
   two `settings` rows, and no `settings.enc` anywhere under the data directory. This is the phase's
   "done when" and it is the one thing the cloud cannot do.
2. **The rotation drill against a real data directory.** §5, all five steps, on a directory with at
   least two tenants' keys in it. Run the `--dry-run` first and confirm it reports the tenant count
   you expect; run the real thing; restart with the new key; sign in and check the saved key is
   still there. This is a procedure, and a procedure nobody has walked is a document — and this one
   walked into two bugs (§5) that a test spawning the real script found only after the fact. Worth
   doing on the file store too: that half was driven here (three tenants rotated, a corrupt fourth
   aborting with every byte identical) but never on a real desk.
3. **The desktop opened on an existing data directory.** Media, legal matters, the saved gateway key
   and the chosen language must all still be there, no `tenants/` directory should appear, and
   `tenant_state` should be empty.
4. **A hosted tenant with no key sees onboarding**, and pasting a key there works — the A01-3 fix
   changes what happens when a tenant has no key, and a Phase 0 deploy walking onto an onboarding
   screen is the exact failure the first A01-3 attempt caused. Worth driving before Phase 5.
5. **"Forget my key" on the hosted server** (§3): tenant A clears its key and tenant B's key and
   verdict are untouched.
6. **A Phase 3 file adopted onto a row**, if kyo ever runs a server that wrote one: start with
   `tenants/<id>/settings.enc` present, boot, and confirm the row exists and the file is now
   `settings.enc.adopted`.

## 10. Open items, for Phase 5 onward

- **Phase 5 lane B must take a `when` above `1788820000010`** for its migration, whatever tag it
  uses. §7.
- **A rotation while the app is running is a race.** The drill says to stop the app, and nothing in
  the code enforces it. A tenant saving settings mid-rotation would have its write re-sealed under
  the old key and then overwritten, or vice versa. Enforcing it means a maintenance flag the host
  checks, which is Phase 8 shape rather than Phase 4 shape.
- **Four files are still machine-wide**, unchanged from lane D's list and still worth Phase 8:
  `edit/metrics.ts` (which carries project, run and job ids), `model-cache.ts`,
  `models-dev-cache.ts`, `workspace.ts`. The two caches are catalog data that is the same for
  everyone on one gateway; the metrics file is the one with tenant content in it.
- **`desk-usage.json` is still a per-tenant file.** Phase 5 lane A made it legacy and read-only and
  owns moving the reads to `tenant_usage`; this phase deliberately did not touch it.
- **`scope: "all"` is still refused in server mode.** Per-tenant reset is Phase 8's "done when".
- **Hosted tenants have no way to get a tool key.** §3. Web search and FAL are unreachable on a
  hosted server now that the operator's environment is not borrowed and tool-key writes are refused.
  Needs an operator-provided per-tenant key path, or a brokered search the host meters — design
  work, and it touches Phase 5's metering, so it belongs to a phase rather than to a patch.
- **`map-drift.mjs` does not see bare `:line` citations** (§8). It re-anchors `path.ts:line` tokens
  only, so the `:line` follow-ups the map pages use for a run of citations into one file are left
  behind by every run. They were fixed by hand here. The tool should inherit the file from the last
  full citation the way a reader does — a small change, and it belongs with the known `--write`
  defect (it re-points a rewritten line onto whatever the diff maps it to, often an import).
- **`docs/internal/portal/device-code-login.md` cites `packages/core/src/secrets.ts:5-51` for
  `StoredSecrets`**, which that range did not name before this branch either. A Phase 1 design doc
  citing an older shape; left alone rather than re-anchored, like the other dated records.
- **The GitHub Actions billing lock** makes every workflow run in this repository fail with no
  runner (`billable.UBUNTU.total_ms: 0`, `runner_id: 0`). Not a signal about this branch; only kyo
  can clear it.
