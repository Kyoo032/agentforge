# OWASP pass — hosted web app, September 2026

Audited 2026-09-20 at b482611 and re-anchored at b06e0a4 after merging `main`, on branch `feat/owasp-security-pass-ahr8y1`.

## Overview

A pass over the OWASP Top 10 against the hosted web app as it stands after Phase 1 and 2
(PR #56), covering `packages/host`, `packages/core`, `packages/db`, `apps/web` and
`webapp-deploy/`. **27 findings.** 21 are fixed on this branch with a test each. Of the rest: one
(A01-1) was found here and has since been fixed on `main` by Phase 3 lane A; one (A06-1) is written
but cannot take effect until an Actions billing lock is cleared; and four are recorded open with
the reason stated — one for Phase 3 lane E, three blocked on something outside this branch.

Two things shaped what is here:

**The spec was ahead of the code in some places and behind it in others.** `docs/internal/web-security-spec.md`
still lists T4, T8, T9, L1 and S1 as outstanding; all five have landed. So this audit was written
against the code, not against the requirement table, and the table should be refreshed separately.

**Phase 3 files were read but not touched.** `packages/host/src/handlers/edit.ts`, the db
migrations and `packages/host/src/tenant.ts` / `getTenant` belong to the tenancy lanes running in parallel. A real
cross-tenant bug in there is written up below as A01-1 and was left for lane A, because two
branches editing the same 500 lines is a worse outcome than a bug that is already known and
scheduled. Lane A has since landed (PR #60) and fixed it; this branch merged `main` and confirmed
the fix without touching the file.

**No finding here is a live exploit against a production deployment, because there is no
production deployment yet.** The Phase 0 deploy has not happened. That is the reason to fix them
now rather than a reason not to.

## The findings

| ID | Severity | Finding | Where | Status |
|---|---|---|---|---|
| A01-1 | **High** | Any tenant can discard any other tenant's unplaced Edit item by id | `packages/host/src/handlers/edit.ts:494-512` | **Fixed on main** by Phase 3 lane A (PR #60) |
| A01-2 | **High** | by-id routes across the app are not systematically tenant-scoped | app-wide | **Recorded** — Phase 3 lane E |
| A01-3 | Medium | Hosted Settings let any tenant rewrite shared tool credentials and the injection guard, and wiped the operator's gateway key on every save | `packages/host/src/handlers/settings.ts:164-197` | Fixed |
| A01-4 | Medium | The CANCEL half of "Start over" was reachable in server mode | `packages/host/src/handlers/settings.ts:462-464` | Fixed |
| A01-5 | Medium | Component installer route reachable in server mode | `packages/host/src/handlers/components.ts:45-67` | Fixed |
| A02-1 | **High** | A patterned env wrap key (`aaaa…`) passed the length check | `packages/db/src/vault-key.ts:82-86,192-199` | Fixed |
| A02-2 | Medium | An empty or corrupt `.master-key` silently derived a key from `""` | `packages/db/src/vault-key.ts:164-175` | Fixed |
| A02-3 | Medium | Workspace cookie had no `Secure` flag in server mode | `packages/host/src/workspace.ts:55` | Fixed |
| A03-1 | Medium | `Content-Disposition` quoting was dead code, and threw 500 on non-Latin-1 names | `packages/host/src/content-disposition.ts` | Fixed |
| A03-2 | Medium | Project name and font family could write their own ASS directives | `packages/core/src/edit/ass-subset.ts:80-111` | Fixed |
| A03-3 | Medium | `frameAt` wrote a scratch path without the allowlist check | `packages/host/src/edit/ffmpeg/recipes.ts:208` | Fixed |
| A03-4 | Low | `eval` on an unvalidated variable name in the deploy scripts | `webapp-deploy/scripts/_common.sh:36-52` | Fixed |
| A04-1 | **High** | `webapp-deploy/scripts/restore.sh` was broken: literal `\n` instead of line continuations | `webapp-deploy/scripts/restore.sh:73-75` | Fixed |
| A05-1 | **Critical** | A production build with `AGENTFORGE_SERVER` unset boots with every control off | `apps/web/lib/hosted-mode-guard.ts` | Fixed |
| A05-2 | **Critical** | `webapp-deploy/compose.yml` took `AGENTFORGE_SERVER` from an optional `.env` | `webapp-deploy/compose.yml:38` | Fixed |
| A05-3 | Medium | Security headers existed only in the Caddyfile, not in the app | `packages/host/src/security-headers.ts` | Fixed |
| A06-1 | Medium | No CI ran lint, unit tests or a dependency audit | `.github/workflows/ci.yml` | Written, **cannot run** — Actions billing lock |
| A06-2 | Low | The hosted image ships devDependencies | `webapp-deploy/Dockerfile:78-80` | **Recorded** — open |
| A08-1 | Low | Workflows pin actions to mutable tags (`@v4`) | `.github/workflows/*.yml` | **Recorded** — open |
| A09-1 | Medium | No request id: nothing correlated a user report to a log line | `packages/host/src/http-adapter.ts:94,435-437` | Fixed |
| A09-2 | Medium | Authentication failures were not logged at all | `packages/host/src/http-adapter.ts:577-588` | Fixed |
| A10-1 | **High** | The private-range check missed most of IPv4 and nearly all of IPv6 | `packages/core/src/security/ip-range.ts` | Fixed |
| A10-2 | **High** | IPv4-mapped, 6to4 and NAT64 IPv6 forms bypassed the check entirely | `packages/core/src/security/ip-range.ts:174-246` | Fixed |
| A10-3 | **High** | A public hostname resolving to a private address passed | `packages/core/src/security/safe-fetch.ts:110-128` | Fixed |
| A10-4 | **High** | Key-bearing outbound calls followed redirects, carrying the key | `packages/host/src/edit/asr.ts:31-39` and three others | Fixed |
| A10-5 | Medium | fal.ai poll URLs were taken from the response body unvalidated | `packages/core/src/tools/platform/fal-queue.ts:25-37` | Fixed |

Plus one open by nature rather than by choice, A10-6 (DNS rebinding), at the end.

## A01 — Broken access control

### A01-1 — Cross-tenant discard of an Edit unplaced item *(found here, fixed on main by lane A)*

When this branch was cut, `handlePostEditUnplacedDiscard` resolved the tenant and threw the result
away:

```ts
await getTenant(request.workspaceId);                  // result discarded
const rows = await db
  .update(editUnplaced)
  .set({ discardedAt: new Date() })
  .where(eq(editUnplaced.id, request.params.itemId))   // id only, no scope
```

Every sibling handler passed `tenant` into its store call, so the `where` here was an unqualified
primary-key match: any signed-in tenant who knew or guessed an item id discarded another tenant's
item.

It was recorded rather than fixed because `packages/host/src/handlers/edit.ts` belongs to Phase 3
lane A, and two branches editing the same lines is the worse outcome. **Lane A landed as PR #60
while this branch was open, and it is now fixed** —
`packages/host/src/handlers/edit.ts:494-512` scopes through
`foldProject(projectId, tenant.workspaceId)` and the predicate is now
`and(eq(editUnplaced.id, …), eq(editUnplaced.projectId, projectId))`. Verified after merging main
into this branch; nothing in this PR touches that file.

A sweep of the handlers that call `await getTenant(…)` without binding the result finds three
left, and none of them matters: `packages/host/src/handlers/misc.ts:58` and
`packages/host/src/handlers/models.ts:10` return static catalogue data, and
`packages/host/src/handlers/settings.ts:456` is the reset-cancel guard added by this branch — all
three are using `getTenant` purely as an auth gate, which is correct.

### A01-2 — by-id routes are not systematically scoped *(recorded, not fixed)*

A01-1 is the instance that happens to be visible. The general problem — that scoping is a property
of each handler remembering rather than of the query layer — is Phase 3 lane E's sweep of the 102
call sites. Nothing in this branch changes it. The two new routes this branch touches add no new
by-id surface.

### A01-3 — Hosted Settings wrote operator-owned fields, and wiped the gateway key

Two separate problems behind one route.

**The one that was live and losing data.** `mergeSecrets` deletes a stored key when it is given an
empty string, and `apps/web/components/settings-page.tsx` posts `openaiApiKey` from state on every
save. So on a hosted deployment, any tenant saving a spend cap wiped the operator's gateway key for
everybody. `keyFieldValue` (`packages/host/src/handlers/settings.ts:189-197`) drops a blank in
server mode and forwards it on a desk, where clearing the field really does mean "forget my key".

**The one that was a privilege hole.** `toolKeys` and `toolBackends` are the credentials and
endpoints every tenant's tools run through, and `injectionGuardBypass` switches off the
prompt-injection guard for the whole process. All three are machine-wide and any signed-in tenant
could rewrite them. Now 403 in server mode.

> **The first version of this fix also refused provider-key writes, and that was a mistake that
> would have bricked the hosted deploy.** Onboarding and Settings are the only ways to supply the
> gateway key and both post it to this route, and the environment fallback in
> `packages/host/src/gateway-gate.ts:376-386` only applies when `AGENTFORGE_RUNTIME=ai`, which
> `webapp-deploy/compose.yml` does not set and the runbook says to leave alone. A Phase 0 deploy
> following the runbook would have ended on an onboarding screen whose only button answered 403,
> with no other route to a working server. It also pre-empted Phase 4, where each tenant supplies
> their own key and this becomes a scoping question rather than a privilege one.
>
> Caught by the verifier thread on this PR, not by me, and not by any test — which is the actual
> lesson, and why `packages/host/src/handlers/settings.test.ts` now drives this route in server
> mode. Key writes behave exactly as they did before this branch.

**Residual, and deliberately left open:** on a hosted box any tenant can still *set* the shared
gateway key, because there is currently no notion of an operator account to distinguish them. That
is Phase 4's per-tenant-key work, not something to bolt on here — and the alternative, as above, is
a deployment nobody can set up.

### A01-4 — The cancel half of "Start over" in server mode

**Narrower than the first draft of this document said.** Arming a wipe was **already** refused in
server mode before this branch — `RESET_DISABLED_CODE` and both of its 403s are in the tree at
`b482611`, the branch point. The audit originally claimed the whole route; that was wrong, and the
row above is corrected.

What was open is the **cancel** path. `handleCancelReset` had no server-mode check, so where a
pending-reset marker arrived some other way — a restored data dir, a desk volume mounted on the
server — one tenant could quietly call off a wipe the operator had armed. Now 403 as well
(`packages/host/src/handlers/settings.ts:462-464`), which also makes the three reset entry points
agree instead of two of them agreeing and one not.

### A01-5 — Component installer in server mode

`handlePostComponentInstallStream` downloads and unpacks a native component into
`/data/components`. The hosted image bakes anydoc in, so the route has nothing to do there, and it
is also the one thing standing between `noexec` on the data mount and the spec's H3 sign-off.
403 in server mode (`packages/host/src/handlers/components.ts:67`).

## A02 — Cryptographic failures

### A02-1 — A patterned wrap key passed the check

`getLocalVaultKey` required 32 bytes and nothing else, so `AGENTFORGE_SECRETS_KEY="aaaa…"` (64
hex `a`s) was accepted and became the key wrapping `settings.enc`. An operator generating a key by
hand, or a placeholder copied out of a doc, produced a key an attacker guesses in one try.

Fixed with a variety floor: `hasKeyLikeVariety` (`packages/db/src/vault-key.ts:82-86`) counts distinct byte values
and requires 12 of them. 32 random bytes clear that with room to spare — the test draws 100 keys
and asserts none is refused — while every repeated or short-cycle pattern fails.

### A02-2 — A corrupt `.master-key` derived a key from the empty string

`readOrCreateMasterKeyFile` wrote a key when the file was missing but did not check what it read
when the file was present. An empty or truncated file (an interrupted write, a restore that
created the path but not the contents) produced `SHA-256("")` — a fixed, publicly known value —
as the wrapping key, silently. Now validated, with `MASTER_KEY_FILE_UNUSABLE` thrown instead
(`packages/db/src/vault-key.ts:171-175`). The test asserts specifically that the digest
`e3b0c442…` never comes out of this function.

### A02-3 — Workspace cookie without `Secure`

`workspaceCookie` set `path` but no `secure`, so it went over plain HTTP if anything ever reached
the app that way. The session and CSRF cookies already had it. Now `secure: isServerMode()`
(`packages/host/src/workspace.ts:55`), matching the other two.

## A03 — Injection

### SQL: audited, no finding

Worth stating plainly, since it is the item named in the goal.

The app's own queries go through Drizzle with bound parameters; there is no `sql.raw` and no
template-literal SQL anywhere outside tests. Model-written SQL — the `run_sql` tool — is the
interesting surface, and it is well built:

- `packages/host/src/sql-guard.ts:125` `assertReadOnlySql` tokenises the statement the way SQLite
  does (`endOfQuoted` at `:62` handles doubled-quote escapes) so that a keyword hidden inside a
  string literal is treated as data, while one inside a double-quoted *identifier* is not.
- The deny-list (`packages/host/src/sql-guard.ts:7-8`) covers `attach`, `pragma*`, every DML and DDL verb,
  `load_extension`, `readfile`/`writefile`, and the `sqlite_master` family.
- `statement.reader` is checked (`packages/host/src/sql-tool.ts:71-73`), so only row-returning statements run.
- It runs in a worker thread against an in-memory database holding one table
  (`packages/host/src/sql-worker-source.ts:24`), with a stripped environment, a 500-row cap, a 2-second time cap and
  a rolling time budget.

No change made.

### A03-2 — ASS directive injection

`buildAssDocument` interpolated `project.name` into `Title:` and `style.fontFamily` into a
`Style:` line with no escaping. ASS is line-oriented with no quoting: a newline ends the directive
and starts one of the caller's choosing, and a comma shifts every field after it on a `Style:`
line. The document then goes to ffmpeg's `ass` filter, which is a real parser reading a real file.

`escapeAssText` (`:76`) already existed but covers Dialogue *text* only, which is the last field on
its line and has `\N` available. Added `assLineValue` and `assFieldValue`
(`packages/core/src/edit/ass-subset.ts:100-111`) for the two values that have neither escape.

`fontFamily` is currently constrained to a two-value enum by `packages/core/src/edit/ops.ts`, so that half was not
reachable through the API — which is the point of fixing it: the sanitiser is what keeps it
unreachable if the enum ever becomes free text, and a project can also be read back off disk.

### A03-3 — Unchecked scratch path in `frameAt`

Five of the six paths `packages/host/src/edit/ffmpeg/recipes.ts` builds inside the scratch root go through `assertInsidePath`.
`frameAt`'s subtitle path did not, and went straight to `writeFile`. `frame` is typed `number` but
arrives off a JSON body, and a type is not a check. Its sibling on the very next line already did
the right thing, which is how the gap stayed invisible. Fixed at `packages/host/src/edit/ffmpeg/recipes.ts:208`, with a
source-level regression test (`packages/host/src/edit/ffmpeg/recipes-paths.test.ts`) that fails if any future
`path.join(scratch, …)` skips the check.

### A03-4 — `eval` on a variable name in the deploy scripts

`setting()` reads a variable by name, which POSIX `sh` has no syntax for, so `eval` is
unavoidable — and it runs whatever it is handed. Every caller passes a literal today, so nothing
was exploitable; the guard at `webapp-deploy/scripts/_common.sh:45-51` is what keeps a future caller from passing
something off `.env` or off `argv`.

## A04 — Insecure design

### A04-1 — The restore script did not work

```
dc run --rm --no-deps -T --user root \n	--cap-add CHOWN …
```

Those are literal backslash-`n` characters on one physical line, not line continuations. `\n`
unquoted in `sh` is the literal character `n`, so the command passed a bare `n` as an argument
and the restore failed.

Filed under insecure design rather than a typo because of when it would have been discovered:
a disaster-recovery path is only ever run during a disaster. The backup script worked, so
everything would have looked fine right up to the moment it mattered. Fixed to real continuations;
all six scripts now pass `sh -n`.

## A05 — Security misconfiguration

### A05-1 and A05-2 — Server mode could be off in production

`isServerMode()` is the single switch behind the session gate, CSRF, the Origin/Host allowlist, the
HTTPS-only refusal, the rate limiters and the mandatory wrap key. `webapp-deploy/compose.yml` took
`AGENTFORGE_SERVER` from `.env`, which is declared `required: false` so that
`docker compose config` parses on a fresh checkout.

So a deploy with a missing or mistyped `.env` started the container with **every one of those
controls off**, serving `GET /api/v1/*` to anyone with the URL — and the health check still
reported healthy, because the app was working exactly as a desktop app is supposed to.

Fixed twice over, deliberately:

1. `AGENTFORGE_SERVER: "1"` pinned in `webapp-deploy/compose.yml:38` under `environment:`, which beats
   `env_file:`.
2. `assertHostedModeCoherent` (`apps/web/lib/hosted-mode-guard.ts`) refuses to boot a
   `NODE_ENV=production` build that is not in server mode, called as the first statement of
   `main()` (`apps/web/server.ts:41`).

The first is the fix; the second is what makes the failure loud instead of silent on any *other*
way of deploying this image. The test asserts both, including that `apps/web/server.ts` calls the guard
before `server.listen(` and that `webapp-deploy/compose.yml` still carries the line.

### A05-3 — Headers only at the proxy

Every header the deployment needs was in `webapp-deploy/Caddyfile`, and that file is good. The
problem was that it was the only copy: the app itself sent `X-Content-Type-Options` and nothing
else, so any deployment not fronted by exactly that Caddyfile — a different proxy, a staging box,
an ingress, a future CDN — served the whole SPA with no CSP and no framing protection. A control
that depends on one file in one folder being copied correctly is not a control.

`packages/host/src/security-headers.ts` now sets the full set from the app, in server mode only
(webdev's inline module preloads and the desktop's custom protocol would both break under a CSP
written for the built bundle). Caddy's `header` directive replaces rather than appends, so the
proxy's value still wins on the real deployment and nothing is sent twice.

`packages/host/src/security-headers.test.ts` parses the Caddyfile and fails if the two policies stop agreeing, which
is the part that keeps this honest a year from now.

## A06 — Vulnerable and outdated components

### A06-1 — Nothing ran the tests

The only workflows were `.github/workflows/e2e.yml` (Playwright) and `.github/workflows/desktop-mac.yml` (a release build). Nothing
ran `pnpm lint`, nothing ran the unit suites, and nothing looked at advisories.

> **The workflow added here does not run either, and cannot until a billing lock is cleared.**
> Both of its jobs failed on this branch in two seconds with no runner assigned (`runner_id: 0`,
> empty `runner_name`), logs that 404, and `billable.UBUNTU.total_ms: 0` — the same shape every
> Actions run in this repository has had since it was created. The cause is recorded at
> `docs/internal/0.14.22-changelog.md:118`: the account is locked for Actions over billing.
> `docs/internal/0.14.27-changelog.md:187` records that kyo shipped 0.14.27 without the Playwright
> check rather than clear it, so this is a standing decision and not news.
>
> The file below is therefore correct and reviewable, but **the control it describes is not in
> force**, and A06-1 should be read as open until the lock is cleared. Nothing in this pass was
> verified by CI.

`.github/workflows/ci.yml` adds both. The audit job needed a decision, because the raw number is
misleading: **the workspace reports 1 critical and 19 high advisories, and every one of them is
reachable only from `apps/desktop`** (tar, electron, extract-zip, app-builder-lib,
builder-util-runtime), which `webapp-deploy/Dockerfile:59` excludes by installing with
`--filter "@agentforge/web..."`.

Gating on that number means a red board nobody can turn green, which within a week means a board
nobody reads. So `scripts/audit-deployed.mjs` computes the closure the image actually installs and
gates on **high or above within it**, while printing the rest. Today the deployed closure carries
6 advisories, all moderate or low:

| Package | Severity | Note |
|---|---|---|
| esbuild | moderate | dev-server request forgery; no dev server runs in the image |
| vitest, @vitest/mocker | moderate | test-runner path traversal; not reachable at runtime |
| uuid 8.3.2 | moderate | bounds check when `buf` is passed; no caller passes `buf` |
| ai, @ai-sdk/provider-utils | low | upstream, fixed in versions the SDK pin has not reached |

### xlsx is pinned to the SheetJS CDN on purpose — do not "fix" it

`packages/core/package.json:50` resolves `xlsx` from `https://cdn.sheetjs.com/xlsx-0.20.3/…`
rather than from npm. This looks like a supply-chain smell and is the opposite of one: npm's last
published `xlsx` is 0.18.5, which predates the prototype-pollution fix in 0.19.3 and the ReDoS fix
in 0.20.2. SheetJS moved distribution off npm, and the CDN is the vendor's own. **Downgrading this
to the npm version to make a tool happy would reintroduce two known CVEs.**

Worth noting for the upload path: the parser still runs on caller-supplied spreadsheets, so the
size and type limits in front of it are doing real work.

### A06-2 — The image ships devDependencies *(recorded, open)*

`webapp-deploy/Dockerfile:78-80` copies the whole `/app` tree and does not run
`pnpm prune --prod`, because `tsx` is a devDependency of `@agentforge/web` and is the production
entrypoint — pruning would delete the thing that boots the app. The result is 484 packages in the
image instead of 277, and it is why four of the six advisories above are in scope at all.

The fix is to build the server to a bundle and stop running `tsx` in production. That is a
migration-plan item, not a security patch, so it is recorded rather than attempted here. The audit
script measures the full closure deliberately, so the number does not lie in the meantime.

## A08 — Software and data integrity failures

### A08-1 — Actions pinned to mutable tags *(recorded, open)*

Every workflow uses `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4`. A tag
is mutable: whoever controls it controls what runs in CI with the repository checked out.
The fix is to pin each to a commit SHA.

**Not done here, and the reason is a limit of this session rather than a judgement call:** GitHub
access is scoped to `kyoo032/agentforge`, so the SHAs behind those tags cannot be read from here,
and writing down a SHA I could not verify would be worse than leaving the tag. `.github/workflows/ci.yml` uses the
same tags as the two existing workflows so that one pass can pin all three together.

### A08-2 — Updater and installer

The desktop updater is out of scope (frozen at 0.14.27). The component installer's hash check was
read and is sound; A01-5 turns the route off in server mode regardless.

## A09 — Logging and monitoring failures

### A09-1 — No request correlation

Nothing tied a user's report to a log line. `mintRequestId` (`packages/host/src/http-adapter.ts:94`) puts 8 random
bytes on every request, returns it as `X-Request-Id` in server mode (`:435-437`), and carries it
into `request_filtered`, `request_failed` and the new `auth_failed`.

### A09-2 — 401s were invisible

The adapter logged requests the *transport filter* refused — malformed paths, bad methods, rate
limits. A well-formed request with a wrong or stolen session cookie was answered 401 and logged
nothing, so a password-spray or a cookie replay across a thousand accounts left no trace at all.

`logAuthFailure` (`packages/host/src/http-adapter.ts:577-588`) writes one `warn` line per 401 carrying the reason
code, method, path *length*, client IP and request id — and nothing that identifies the caller
beyond the IP the rate limiter already keys on. The test asserts the path, the cookie and the
token never appear in the line.

## A10 — Server-side request forgery

`fetchPublicHttps` / `assertPublicHttpsUrl` guard every outbound fetch to a caller-supplied URL.
The guard existed and was the right shape; what it checked was too narrow, in four separate ways.

### A10-1 — The private-range check was a short regex list

It matched a handful of IPv4 prefixes by string and almost nothing in IPv6. Missing, all of them
reachable from a cloud host:

- `100.64.0.0/10` — carrier-grade NAT, which is what Tencent and most clouds use internally
- `192.0.0.0/24`, `198.18.0.0/15`, the three TEST-NETs, `192.88.99.0/24`
- `224.0.0.0/4` multicast and `240.0.0.0/4` reserved
- the whole of IPv6 beyond a couple of literals: `fc00::/7`, all of `fe80::/10`, `fec0::/10`, `ff00::/8`

Replaced with `packages/core/src/security/ip-range.ts`, which parses the address to bytes and
compares CIDR prefixes properly. It also stopped the check *over*-blocking: the old string matching
refused `fdic.gov` and `fc-barcelona.example` for beginning with `fd` and `fc`.

### A10-2 — Six ways to write a private address in IPv6

`::ffff:169.254.169.254` (IPv4-mapped), `2002:a9fe:a9fe::` (6to4), `64:ff9b::a9fe:a9fe` (NAT64)
and the `::`-compressed forms all reach the same host and none was recognised. Every one was
checked against Node's own WHATWG URL parser before the fix, so these are confirmed bypasses, not
theoretical ones. `packages/core/src/security/ip-range.ts` recurses onto the embedded IPv4 for each v4-bearing prefix.

### A10-3 — DNS was never consulted

The check ran on the literal hostname. `metadata.attacker.example` resolving to `169.254.169.254`
passed every test and then connected to the metadata service. `assertResolvesPublic`
(`packages/core/src/security/safe-fetch.ts:110-128`) resolves the name and refuses any private answer, and is called **per
redirect hop** (`:181`), not once at the start.

It fails *open* on a resolution error, deliberately: an offline test with a stubbed `fetchImpl`
must still pass, and a name that does not resolve cannot be connected to anyway.

### A10-4 — Key-bearing calls followed redirects

Four outbound calls carry a secret in an `Authorization` header and used `fetch`'s default
`redirect: "follow"`. A 302 from the upstream — or from anything impersonating it — would have
re-sent the header to the redirect target. Fixed with `redirect: "manual"` in
`packages/host/src/edit/asr.ts:31-39`, `packages/host/src/gateway-gate.ts`,
`packages/host/src/knowledge-embed.ts` and `packages/core/src/tools/platform/fal-queue.ts`. The
same change added timeouts (`AbortSignal.timeout`), which none of them had.

### A10-5 — fal.ai poll URLs came from the response body

`packages/core/src/tools/platform/fal-queue.ts` took `status_url` and `response_url` out of the queue response and polled them
without checking where they pointed. `assertQueueUrl` (`:25-37`) now requires them to be on
`QUEUE_ORIGIN` or `https://fal.run` before the first poll.

### A10-6 — DNS rebinding *(open by nature)*

`assertResolvesPublic` resolves the name, and then `fetch` resolves it again to connect. A record
with a one-second TTL can differ between the two. Closing this needs a custom undici dispatcher
that connects to the address already validated rather than re-resolving. Recorded here rather than
attempted, because a half-done version of that is worse than none.

## Two test fixes that this work depended on

Neither is an OWASP finding; both were blocking the CI job in A06-1, and both were real.

- `packages/host/src/edit/ffmpeg-binary.ts:82` used `path.join` to build a Windows path. Off
  Windows that joins with `/`, so the absolute `where.exe` path this hardening exists to pin came
  out as `C:\Windows/System32/where.exe` — the test for it only passed when run on Windows.
  Now `path.win32.join`, which is the same function on Windows.
- `packages/host/src/edit/ffmpeg/run.ts:90` refused up front when ffmpeg was not installed, even
  when a test had already replaced the function that would spawn it. Every suite built on
  `setExecFileForTests` therefore passed or failed on whether the developer happened to have
  ffmpeg — which no CI runner does. The stub is now reached whether or not a binary exists.
  A side effect worth having: `packages/host/src/edit/ffmpeg-args.test.ts` used to skip its env-stripping assertions
  (the whole of requirement G-13) on a machine without ffmpeg, and now runs them everywhere.

## Verification

All of this was run locally in a cloud container. **None of it was run by CI**, for the reason
under A06-1: Actions cannot start a runner on this account.

- `pnpm test` — 8/8 packages, **4797 tests passing, 0 failing** (host 1722, core 2112, web 886,
  db 72, plus legal, university, marketing). Both previously failing host suites are fixed above.
- `pnpm lint` — 182 warnings, 30 infos, **0 errors**, identical to the pre-branch baseline across
  11 more files.
- `node --test "scripts/*.test.mjs"` — 7 passing.
- `sh -n` on all six `webapp-deploy/scripts/*.sh`.
- Every SSRF bypass in A10-1 and A10-2 was confirmed against Node's WHATWG URL parser before the
  fix and re-confirmed as refused after.

**Not run here, and why:** `.cursor/skills/verify-agentforge` drives a live app on
`127.0.0.1:3000` via `.cursor/skills/verify-agentforge/scripts/doctor.mjs`, and the pstack verifier and mapper live in the Cursor plugin
rather than in the repo, so neither half can run in this container. The map-rot check applies to
the map added alongside this document; every `file:line` it cites was re-read at b482611.
