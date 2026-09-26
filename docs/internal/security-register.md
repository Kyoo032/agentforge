# Security register

Every security flag raised in the 2026-09-21 review round, plus what is still open from the
[OWASP pass](security-owasp-2026-09.md). One row per flag, kept alive: a flag that is fixed stays
here with its evidence, and a flag that turns out to be nothing stays here as "checked, not an
issue" so nobody spends the afternoon on it twice.

Compiled 2026-09-21 in the webdev worktree `C:\Users\rizky\agentforge-webdev-0f994f5`, detached at
`4938747` with in-flight edits from several lanes. Every `file:line` below was read in that tree at
that moment. Where a line belongs to an uncommitted edit the row says so, because the same line
number does not exist on `main`.

**The rule this file exists for:** a security flag raised in a session is recorded here in the same
change that raised it, with evidence and a gate. A flag in a chat transcript is not recorded.

Extended the same day by the tracking-docs lane with SR-22 … SR-38: the flags the build lanes raised
in their reports but had not written down, the two the security-fix lane found in its own work, and
the answer to the one test failure [SR-12](#sr-12) left for somebody to read. Every one of them was
re-checked against the working tree before it was written here; two earlier claims turned out to be
stale and are corrected in place ([SR-10](#sr-10), [SR-12](#sr-12)).

Extended again on 2026-09-21 by fix pass X with SR-39 … SR-44 — the portal findings from the Phase 9
review round that had no row yet — which also closed [SR-21](#sr-21) and [SR-33](#sr-33) to
`fixed-unverified`.

Extended the same day by fix pass Y with SR-45 … SR-48 — a destroyed recording, a deploy template
that contradicts the boot check, a tenant labelled as a paying subscriber, and an ffmpeg error that
returned the server's own paths — which also closed [SR-27](#sr-27) and [SR-31](#sr-31) to
`fixed-unverified`. Everything that pass touched is host, core, web, `webapp-deploy` and docs; the
portal rows are fix pass X's.

Extended on 2026-09-23 by the cleanup, security and bug-fix pass with SR-50 … SR-79, written from
the uncommitted working tree on `main` at `d4561b8`. Every `file:line` in those rows was read in
that tree on that day, and most of them are uncommitted lines. The same pass moved
[SR-08](#sr-08), [SR-11](#sr-11), [SR-19](#sr-19), [SR-26](#sr-26) and [SR-49](#sr-49), and added
SR-49 to the summary, which it was missing from. Each row names its product: **Enterprise** (the
hosted web app and its portal), **Personal** (the Mac/Windows app) or **both**. Its fixed rows use
the status `fixed, not driven`, defined below: nothing in that pass was driven on `:3000` (the host
and core changes need Rizky to restart it), nothing was packed, and nothing ran on a server.

Extended on 2026-09-24 with [SR-80](#sr-80): Rizky dropped GitHub Actions, the three workflows are
deleted, and the CI and audit gate moved to `pnpm ci:local` (`scripts/ci-local.mjs`). That moves
OWASP A06-1 and closes A08-1 by removal; both are updated in [SR-16](#sr-16).

Extended on 2026-09-26 with [SR-81](#sr-81): Research's keyless search calls four pinned public
APIs. Checked, not an issue.

## Summary

| ID | Severity | Title | Status | Gate |
|---|---|---|---|---|
| [SR-28](#sr-28) | High | Two public Cloudflare quick tunnels exposed the review instance to the internet | Open — close after the review | Blocks Tencent deploy |
| [SR-20](#sr-20) | High | Portal CSP `form-action 'self'` blocked the OAuth redirect in real browsers; curl-only drives cannot catch CSP | Fixed (driven in Chromium) | Blocks Tencent deploy |
| [SR-14](#sr-14) | High | `Permissions-Policy` denies `microphone` and `display-capture`, so Meeting recording cannot work on the deploy | Fixed-unverified, lane E | Blocks Tencent deploy |
| [SR-04](#sr-04) | High | Hosted env is not validated at boot: a deployment with no wrap key starts healthy | Fixed-unverified, lane E | Blocks Tencent deploy |
| [SR-06](#sr-06) | High | A signed-out hosted visitor lands on the paste-your-key onboarding screen | Open, lane C | Blocks Tencent deploy |
| [SR-12](#sr-12) | High | Twelve security tests do not run on this machine, and CI cannot start a runner | Fixed, 2026-09-24 — every one runs and passes in `pnpm ci:local` on this desk | — |
| [SR-02](#sr-02) | High | `.webdev-data/` held `.master-key` and was not git-ignored | Fixed | Blocks PR merge |
| [SR-05](#sr-05) | High | `POST /api/v1/auth/login` had no `state` binding | Fixed-unverified, lane F | Blocks PR merge |
| [SR-39](#sr-39) | High | The portal's SMTP transport suppressed STARTTLS, so a real provider got OTPs and SMTP AUTH in cleartext | Fixed-unverified, fix pass X | Blocks Tencent deploy |
| [SR-45](#sr-45) | High | A finished Meeting recording was destroyed before the upload that was meant to save it | Fixed-unverified, fix pass Y | Blocks Tencent deploy |
| [SR-46](#sr-46) | High | `.env.example` said the portal login variables could be left empty; the hosted server now refuses to start without them | Fixed-unverified, fix pass Y | Blocks Tencent deploy |
| [SR-47](#sr-47) | High | A tenant nobody had sold anything to was labelled a paying Personal subscriber | Fixed-unverified, fix pass Y | Blocks Tencent deploy |
| [SR-49](#sr-49) | High | The hosted image carries the source tree, and a build from a working checkout also took untracked secrets into it | Mitigated for the release path; open for the Dockerfile and a stale `webapp-deploy/.dockerignore` | Blocks building from a checkout; blocks a public image |
| [SR-50](#sr-50) | High | One request with a malformed `Host` header or request target stopped the portal | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-56](#sr-56) | High | The portal served every request as a Postgres superuser, so no row-level security applied | Fixed, not driven (2026-09-23); the deploy must provision two DSNs and a login role | Blocks Tencent deploy until provisioned |
| [SR-58](#sr-58) | High | A session the portal had ended kept working on the hosted app for up to 30 days | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-67](#sr-67) | High | An Edit generate job ran as whatever tenant its stored request named | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-21](#sr-21) | Medium | The portal's 30-day browser session cannot be ended: signing out of the app leaves it, and the next sign-in skips the OTP entirely | Fixed-unverified, fix pass X | Blocks Tencent deploy |
| [SR-48](#sr-48) | Medium | A failed ffmpeg run returned the full argv and raw stderr — absolute paths inside the data dir — to the client | Fixed-unverified, fix pass Y | Blocks Tencent deploy |
| [SR-42](#sr-42) | Medium | `GET /tenant/config` had no rate limiter and told an anonymous caller which tenant slugs exist | Fixed-unverified, fix pass X | Blocks Tencent deploy |
| [SR-25](#sr-25) | Medium | SQLite is opened, migrated and reset before either hosted boot guard runs | Open | Blocks Tencent deploy |
| [SR-26](#sr-26) | Medium | `AGENTFORGE_PORTAL_URL` may be a plain-http loopback URL in production and still pass the boot check | Fixed, not driven — owner decided https in production, 2026-09-23 | Blocks Tencent deploy |
| [SR-27](#sr-27) | Medium | An Edit import that fails *after* the probe charges the tenant and leaves an orphan object | Fixed-unverified, fix pass Y | Blocks Tencent deploy |
| [SR-22](#sr-22) | Medium | Personal advertised "One seat" while `seatCap: null` admits everybody | Fixed by copy, 2026-09-22 | — |
| [SR-23](#sr-23) | Medium | One `devices` row per `(user, oauth client)`, so two browsers cannot be revoked apart | Accepted, recorded | Blocks Tencent deploy |
| [SR-24](#sr-24) | Medium | `jwks_keys` is never read or written, so signing-key rotation is a hard cutover | Open | Blocks Tencent deploy |
| [SR-03](#sr-03) | Medium | The billing webhook authenticates on a shared-secret header, not a provider signature | Open | Blocks Tencent deploy |
| [SR-10](#sr-10) | Medium | Manual OTP issuance hands a live sign-in code to whoever runs the CLI | Fixed-unverified, lane A | Blocks Tencent deploy |
| [SR-16](#sr-16) | Medium | Four OWASP findings are still open, one of them the reason nothing is proved by CI | Open | Blocks Tencent deploy |
| [SR-17](#sr-17) | Medium | A PR cut from this worktree with `git add -A` commits five lanes and an untracked logo | Open | Blocks PR merge |
| [SR-19](#sr-19) | Medium | `data/` is an allowlist, so each new product file under it is tracked by default | Fixed, 2026-09-23 (`/data/` ignored whole) | — |
| [SR-51](#sr-51) | Medium | Behind a proxy the portal keyed every per-IP limit on the client-written end of `X-Forwarded-For` | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-52](#sr-52) | Medium | A portal rate limiter whose key map was full refused every new caller for a whole window | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-53](#sr-53) | Medium | No daily cap on sign-in code guesses per address | Fixed, not driven (2026-09-23); the lockout it enables is open for the owner | Blocks Tencent deploy |
| [SR-54](#sr-54) | Medium | The device-flow poll, `POST /auth/device/token`, had no per-IP limit | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-55](#sr-55) | Medium | A portal refresh without `device_id` skipped the refresh token's device binding | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-57](#sr-57) | Medium | Every hosted refresh shared one per-IP bucket, capping the app near 300 sessions and then blocking sign-in | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-59](#sr-59) | Medium | Signing out of the hosted app left the portal session and its refresh token alive | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-60](#sr-60) | Medium | `auth_sessions` stored each session cookie in the clear, as its primary key | Fixed, not driven (2026-09-23); forces one re-sign-in | Blocks Tencent deploy |
| [SR-61](#sr-61) | Medium | Any 4xx from the portal URL, and a rejection of the host's own client, read as the end of the session | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-62](#sr-62) | Medium | A session write racing a sign-out could undo the revocation | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-64](#sr-64) | Medium | The portal refresh token behind each hosted session is now stored at rest, sealed (owner decision) | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-66](#sr-66) | Medium | "One portal refresh at a time per session" holds only inside one host process | Open | Blocks running more than one host process |
| [SR-68](#sr-68) | Medium | `POST …/edit/projects/:projectId/jobs` queued any kind, and render and asr skipped their own routes' checks | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-69](#sr-69) | Medium | `GET /api/v1/edit/metrics` returned every tenant's Edit activity to every caller | Fixed, not driven (2026-09-23); the old machine-wide file is the operator's to delete | Blocks Tencent deploy |
| [SR-72](#sr-72) | Medium | The proxy's logs kept each sign-in's one-time code and state for 30 days | Fixed in part: access log fixed, not driven; error log open | Blocks Tencent deploy |
| [SR-73](#sr-73) | Medium | The proxy container was handed the app's whole `.env`, wrap key included | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-75](#sr-75) | Medium | A cancelled Market run kept paying for model calls, and a failure after the cancel could stop the host | Fixed, not driven (2026-09-23) | Blocks Tencent deploy and the next Personal cut |
| [SR-76](#sr-76) | Medium | Model-written finance figures reached the reader past the number guard three ways | Fixed, not driven (2026-09-23) | Blocks Tencent deploy and the next Personal cut |
| [SR-77](#sr-77) | Medium | A "Start over" wipe that failed part-way deleted its own marker, so the rest never ran | Fixed, not driven (2026-09-23) | Blocks the next Personal cut |
| [SR-79](#sr-79) | Medium | Per-IP limits key on the full IPv6 address, so one IPv6 client has a bucket per request | Open | Blocks Tencent deploy if it is reachable over IPv6 |
| [SR-80](#sr-80) | Medium | CI and the dependency-audit gate run only when someone runs `pnpm ci:local`; nothing checks a push on its own | Open — accepted by design (2026-09-24) | Blocks PR merge without a pasted `ci:local` summary |
| [SR-81](#sr-81) | Low | Keyless Research search sends the masked query to four pinned public APIs | Checked, not an issue (2026-09-26) | — |
| [SR-01](#sr-01) | Low | `apps/portal/compose.yml` hardcodes `POSTGRES_PASSWORD: portal` | Accepted for dev only | Dev only |
| [SR-07](#sr-07) | Low | The CSRF token is bound to the session id, so it stops verifying the moment a session changes | Open, lane C | Blocks PR merge |
| [SR-09](#sr-09) | Low | The two billing variables were missing from `webapp-deploy/.env.example` | Fixed-unverified | Blocks Tencent deploy |
| [SR-13](#sr-13) | Low | Meeting mode: a replaced recording leaves the old file on disk | Fixed-unverified, lane E | Dev only |
| [SR-11](#sr-11) | Low | The review harness writes secrets and a TLS key pair outside the repo | Accepted for dev only; the `--upstream` gap closed 2026-09-23 | Dev only |
| [SR-29](#sr-29) | Low | Portal rate limits are per-process and in memory, so a second instance doubles every ceiling | Open | Blocks Tencent deploy on a second instance |
| [SR-30](#sr-30) | Low | The OTP send's enumeration defence is a timing **floor**, not a constant time | Accepted, recorded | Blocks Tencent deploy |
| [SR-31](#sr-31) | Low | `AGENTFORGE_BILLING_TOPUP_URL` is handed to the browser unvalidated | Fixed-unverified, fix pass Y | Blocks Tencent deploy |
| [SR-32](#sr-32) | Low | The portal's CSP carries `style-src 'unsafe-inline'` | Accepted, recorded | Dev only |
| [SR-33](#sr-33) | Low | `PORTAL_TRUST_PROXY` and `PORTAL_PUBLIC_URL` are read outside `loadConfig`, so neither is validated at boot | Fixed-unverified, fix pass X | Blocks Tencent deploy |
| [SR-34](#sr-34) | Low | An existing dev Postgres volume keeps the old literal password `portal` | Accepted for dev only | Dev only |
| [SR-40](#sr-40) | Low | `pnpm portal:seed --redirect` accepted any absolute URI, including `javascript:` and `data:` | Fixed-unverified, fix pass X | Blocks Tencent deploy |
| [SR-41](#sr-41) | Low | A request body over the portal's 64 KB cap answered `500 internal_error` | Fixed-unverified, fix pass X | Dev only |
| [SR-43](#sr-43) | Low | `auth_codes.state_hash` was stored and never verified, while code and docs called it a binding | Fixed-unverified, fix pass X | Blocks Tencent deploy |
| [SR-44](#sr-44) | Low | `scripts/review-instance.ps1` seeded the literal Postgres password `portal` into `review.env` | Fixed-unverified, fix pass X | Dev only |
| [SR-63](#sr-63) | Low | A malformed `Host` or request target threw out of the host's HTTP adapter before any rule ran | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-65](#sr-65) | Low | Erase account keeps the tenant's sessions, and now their stored refresh tokens | Open — owner decision | Blocks Tencent deploy until decided |
| [SR-70](#sr-70) | Low | The hosted Edit doctor returned the absolute path of the server's ffmpeg | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-71](#sr-71) | Low | An Edit generate's still check told a caller whether a media id existed in any organization | Fixed, not driven (2026-09-23) | Blocks Tencent deploy |
| [SR-74](#sr-74) | Low | The Personal release published its notes without the banned-marks check | Fixed, not driven (2026-09-23) | Blocks the next Personal cut |
| [SR-78](#sr-78) | Low | A failed "Start over" removal logged the absolute path of the file, the key file included | Fixed, not driven (2026-09-23) | Blocks the next Personal cut |
| [SR-08](#sr-08) | Info | The portal token vault is process memory only | Superseded by [SR-64](#sr-64), 2026-09-23 | Dev only |
| [SR-15](#sr-15) | Info | Music relay: checked, not a key-exfiltration issue. It does send a spoofed browser `User-Agent` | Checked, not an issue | Dev only |
| [SR-18](#sr-18) | Info | `X-Forwarded-Proto` and `X-Forwarded-For` trust: checked, sound as deployed today | Checked, not an issue | Blocks Tencent deploy on any topology change |
| [SR-35](#sr-35) | Info | `?preview=<code>` renders a blocked screen on `/pricing` | Checked, not an issue | Dev only |
| [SR-36](#sr-36) | Info | `device_code.requested` is not audited on a build that sends no `tenant_hint` | Accepted, recorded | Dev only |
| [SR-37](#sr-37) | Info | `GET /api/v1/auth/session` is registered off server mode, unlike its four siblings | Checked, not an issue | Dev only |
| [SR-38](#sr-38) | Info | Host and portal reason vocabularies differ in two places: checked, both deliberate | Checked, not an issue | Dev only |

Status values: `open`, `fix in progress — lane X`, `fixed-unverified` (the code is in the tree and
its test passes, nothing has been driven), `fixed, not driven` (2026-09-23 rows: the code and its
tests are in the tree, the row does not claim a test run, and nothing has been driven), `fixed`,
`accepted for dev only`, `checked, not an issue`.

## High

### SR-28 {#sr-28}

**Two public Cloudflare quick tunnels exposed the review instance to the internet.** Raised and
accepted by the owner on 2026-09-21; **must be closed after the review**.

What was done, at the owner's request, so he could review the sign-in from a phone: `cloudflared` was
installed on this desk with **winget**, and two quick tunnels were started — one publishing the app
(the TLS proxy on `127.0.0.1:3443`) and one publishing the portal (`127.0.0.1:4000`) under
`*.trycloudflare.com` hostnames. `scripts/review-instance.ps1` was then re-run with `-AppPublicUrl`
and `-PortalPublicUrl`, which is the supported second topology: it derives
`AGENTFORGE_TRUSTED_ORIGINS`, `AGENTFORGE_PUBLIC_URL`, `AGENTFORGE_PORTAL_URL` and
`PORTAL_PUBLIC_URL` from those names (`scripts/review-instance.ps1:205-213`) and switches
`PORTAL_TRUST_PROXY` on, because only then is there a proxy whose `X-Forwarded-For` is worth believing
(`:211`, `:675`).

What is true in mitigation, and each part was checked rather than assumed:

- **Both URLs are behind the sign-in.** The app is in server mode, so every `/api` path but ping,
  components and `/api/v1/auth/*` answers `401 session_required` without a session, and the renderer
  shows the sign-in screen. The portal's own surface is the OTP flow.
- **Mailpit was never exposed.** Only the app and the portal got a tunnel; `compose.yml` publishes
  Postgres and Mailpit on `127.0.0.1` only (`apps/portal/compose.yml:16`, `:36-37`).
- **The data is seeded.** The review app has its own `AGENTFORGE_DATA_DIR` under
  `$HOME\.dpsbuddy-review` and has never held a real tenant's work.
- **The hostnames are ephemeral.** A quick tunnel does not survive a restart of `cloudflared`, and a
  new one gets a new hostname — which then has to be re-seeded as a `--redirect` and re-passed on the
  command line.

What goes wrong if ignored: a login-protected but internet-reachable deployment stays up with no
monitoring, no rate-limit tuning for public traffic, an OTP flow anybody can pour addresses into, and
a seeded OAuth client whose secret is in a file on this desk. It is also a standing invitation to
reach for the same trick for something that is not a review.

Required action: stop `cloudflared`, confirm both hostnames 404, and re-run
`scripts\review-instance.ps1 -Start` with no URL arguments so the instance goes back to loopback.
Decide separately whether `cloudflared` stays installed. Nothing in `webapp-deploy/` may learn about
tunnels: `webapp-deploy/Caddyfile` stays the only proxy the product ships behind ([SR-11](#sr-11)).

Gate: **blocks Tencent deploy**, in the sense that a tunnel must never be the thing in front of the
real deployment, and this one must be down before anybody forgets it is up.

### SR-20 {#sr-20}

**The portal's CSP `form-action 'self'` blocked the OAuth redirect in real browsers; curl-only
drives cannot catch CSP.** Fixed, and driven in a real browser.

Evidence, as the flag was raised: `apps/portal/src/security/headers.ts` sent one frozen policy on
every HTML answer, `form-action 'self'` included. A browser applies `form-action` to **every hop of
a submission's redirect chain**, and `POST /authorize/verify` ends its successful path on
`302 Location: <client redirect_uri>?code&state` — another origin. Chromium therefore refused the
post before it left the page, with

```
Sending form data to 'https://<portal>/authorize/verify' violates the following Content Security
Policy directive: "form-action 'self'". The request has been blocked.
```

The six-digit code page simply did nothing when the button was pressed. Nothing in the suite saw
it: every existing drive is `fetch`/curl, and **a non-browser client does not implement CSP at
all**, so `routes/browser.test.ts` walked the same three hops green while no human could sign in.

Evidence now: `security/headers.ts` builds the policy per response. `formActionSource` (`:56`)
reduces a URL to exactly `new URL(x).origin` and answers `null` for anything that is not an http(s)
origin — `javascript:`, `data:`, a bare scheme, a wildcard, the `null` keyword, junk — so only a
real origin can ever be appended and a refusal falls back to `'self'`. `contentSecurityPolicy`
(`:76`) joins `'self'` with the caller's origins, deduplicated. `htmlResponse` (`:114`) takes them
as `formActionOrigins`. `routes/authorize.ts:77` (`clientFormAction`) is the only caller, and each
of its three call sites runs **after** `checkClient` has exact-matched that `redirect_uri` against
the client's registered allowlist (`flows/authorize.ts:65`). Every other page — `/activate`, device
approve, every error page, and any authorize page rendered before the client validated — is
untouched at `'self'`.

Two of those refusals are not theoretical. `URL.origin` returns `https://a;b` and `https://a,b`
unchanged — neither character is a forbidden host code point — and in a CSP header a `;` starts a
directive of its own while a `,` splits the header into **two policies**, which would have dropped
`frame-ancestors` and `base-uri` from the first. So the origin is matched against a narrow host
charset (`SAFE_ORIGIN`, `security/headers.ts:55`) rather than trusted because `URL` parsed it.

Pinned by `security/security.test.ts`, "form-action on an authorize page" (5 cases, including
thirteen hostile `redirect_uri` values that must not produce a directive, a header split or a
wildcard, alongside the punycode and IPv6 origins that must still pass) and
`routes/browser.test.ts`, "names the client's origin in form-action on an authorize page, and only
there" / "keeps form-action at 'self' on a page rendered before the client was validated".

Driven 2026-09-21 on the review instance, Chromium, portal restarted alone so the app and the two
tunnels kept their configuration: sign-in form → e-mail → six-digit code → **submitted** →
`GET https://<app>/auth/callback?code=…&state=…` → `POST /api/v1/auth/login` 200 → `/chat` signed
in, address bar clean, **zero console messages on either origin**. On the live instance the valid
authorize page answers `form-action 'self' https://<app tunnel>` while the unknown-client page, the
off-allowlist `redirect_uri` page and `/activate` all answer `form-action 'self'`.

What goes wrong if ignored: nobody can sign in to the hosted deployment, and the failure is silent
— no error page, no log line, only a console message the operator never sees.

**Residual, accepted:** `form-action` on an authorize page now names the client's origin, so a
script injected into that page could post the form to the client's own callback. That is a smaller
set than `'self'` implies at first reading: the origin is one the portal already redirects to with a
live authorization code, it is exact-matched against the client's allowlist, and `script-src 'none'`
means there is no script on the page to do it. It is still one origin wider than before, and it is
the price of a login that works in a browser.

**The lesson, which is bigger than this bug:** a header that only a browser enforces cannot be
verified by a client that does not enforce it. CSP, `__Host-` cookie acceptance, `SameSite` and
mixed-content blocking are all in that class. Every one of them needs a real browser on the review
instance before the Tencent deploy, not a curl drive.

Required action: none in code. Keep the browser hop in the Phase 9 verification recipe.

Gate: **blocks Tencent deploy** — it was a total sign-in outage on the hosted topology.

### SR-14 {#sr-14}

**`Permissions-Policy` denies `microphone` and `display-capture`, so Meeting recording cannot work
on the deploy.**

Evidence: `packages/host/src/security-headers.ts:51-70` sets `PERMISSIONS_POLICY` with
`display-capture=()` at `:56` and `microphone=()` at `:62`, sent on every response in server mode
(`:76-85`). `webapp-deploy/Caddyfile:59` sets the same list at the proxy. Both are correct for the
app as it was when they were written. The new Meeting recorder is not that app:
`apps/web/lib/meeting-recorder-media.ts` and `apps/web/lib/use-meeting-recorder.ts` (both untracked,
landing now) need `getUserMedia` for the microphone leg and `getDisplayMedia` for the tab-audio leg.

The rest of the policy is fine for this feature. CSP `media-src 'self' blob:`
(`security-headers.ts:40`, `Caddyfile:46`) plays the recorded blob back, and `connect-src 'self'
https://api.tokotokenai.com` (`:42`) carries the upload to the host.

What goes wrong if ignored: the Meeting mode ships to the hosted app and the record button does
nothing. The browser refuses the permission before any product code runs, so there is no error
worth reading, on either leg, for every tenant.

Required action: change both files in the same change to `microphone=(self)` and
`display-capture=(self)`, and leave every other feature off. `camera=()` stays off: the recorder
asks for audio only. Changing one file and not the other is caught by
`packages/host/src/security-headers.test.ts`, which parses the Caddyfile and fails on drift.

**Fixed-unverified, 2026-09-21 (lane E).** Both files now send, byte for byte:

```
accelerometer=(), autoplay=(), browsing-topics=(), camera=(), display-capture=(self),
encrypted-media=(), geolocation=(), gyroscope=(), interest-cohort=(), magnetometer=(),
microphone=(self), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(),
serial=(), usb=(), xr-spatial-tracking=()
```

(one line on the wire; wrapped here to fit). `packages/host/src/security-headers.ts:74-93` and
`webapp-deploy/Caddyfile:67`. Sixteen features stay `()`, including `camera`.

Four tests were added to `security-headers.test.ts` and one of the existing ones was rewritten,
because it asserted `microphone=()`: the whole policy string is pinned (`:90-97`), the two
allowances are pinned as `(self)` with no `*`, no `https://` and no `src` anywhere in the header
(`:99-109`), every one of the other sixteen is checked to still be `()` one by one (`:111-142`),
and the proxy's own copy is checked for the same two allowances (`:197-203`). A fifth pins that the CSP already carries what the recorder leans on and needs nothing added (`:150-155`). The Caddyfile parity
test that SR-14 named already compares the whole string, so the two files cannot drift.

Nothing else was loosened. Checked and unchanged: the CSP needs no edit for the recorder —
`media-src 'self' blob:` and `worker-src 'self' blob:` were already there, `MediaRecorder` and
`AudioContext` are not fetches and have no CSP directive at all, and the upload is the same-origin
`POST /api/v1/meetings/:id/recording` that `connect-src 'self'` already covers. Blast radius is
one call site, `applySecurityHeaders` at `packages/host/src/http-adapter.ts:496`, which writes the
set on every response in server mode and nothing off it. No third-party origin gains anything:
`(self)` is this origin only, `apps/web` renders no `<iframe>` (so no `allow=` attribute exists to
delegate either feature), an artifact body is served under `Content-Security-Policy: sandbox`
(`handlers/artifacts.ts:72`) which puts it in an opaque origin that `self` never matches, and
`frame-ancestors 'none'` plus `X-Frame-Options: DENY` keep the app out of anyone else's frame.

Still unverified: nothing has sent either header to a browser. It becomes `fixed` when a hosted
drive records a meeting on the deploy.

Gate: **blocks Tencent deploy.** Also blocks the Meeting lane's own claim that recording works,
because nothing on webdev exercises either header.

### SR-04 {#sr-04}

**Hosted env is not validated at boot: a deployment with no wrap key starts healthy.**

Evidence: the only boot check is `assertHostedModeCoherent(process.env)`, the first statement of
`main()` at `apps/web/server.ts:41`, and it compares exactly two variables
(`apps/web/lib/hosted-mode-guard.ts:45-48`). Everything else is read at first use:

- `AGENTFORGE_SECRETS_KEY` at `packages/db/src/vault-key.ts:185`, which throws the "required in
  server mode" error at `:47` only when something opens a tenant's secrets.
- `AGENTFORGE_PORTAL_URL` at `packages/host/src/auth/portal-config.ts:127`, which throws on the
  first sign-in request.
- `AGENTFORGE_BILLING_WEBHOOK_SECRET` at `packages/host/src/billing/authenticate.ts:51`, which
  refuses the first delivery with `billing_not_configured`.

What goes wrong if ignored: the container reports healthy. `GET /healthz` answers before routing and
opens no database connection (`webapp-deploy/Caddyfile:140-147`), so a deploy missing the wrap key
passes its own health check, passes Caddy's active check, and fails for the first real user who
signs in or saves a key. That is the same failure shape as OWASP A05-1, which this repo already
decided to make loud rather than silent.

Required action: extend the boot check into an assertion over the whole hosted set. In server mode,
refuse to listen unless `AGENTFORGE_SECRETS_KEY` passes the `vault-key.ts` length and variety floors
and `AGENTFORGE_PORTAL_URL` parses as an allowed endpoint. Treat the billing secret as required only
once a provider is bound, and say which variable is missing by name.

**Fixed-unverified, 2026-09-21 (lane E).** `assertHostedEnvComplete` is a sibling of
`assertHostedModeCoherent` and runs at the same boot site: `apps/web/server.ts:45`, the second
statement of `main()`, immediately after the mode check and long before `server.listen`. The check
itself is `packages/host/src/hosted-env.ts` — in the host package rather than in `apps/web`,
because the rules it reuses live in three packages and `apps/web` can only see two of them.
`apps/web/lib/hosted-mode-guard.ts:14` re-exports it, so `server.ts` still reaches both guards
through one module.

**Every rule is borrowed, none is restated.** The wrap key is judged by `getLocalVaultKey`
(`packages/db/src/vault-key.ts:184-204`), which in server mode never touches the disk, so this is a
pure check of the variable and it carries `SERVER_VAULT_KEY_REQUIRED` / `_TOO_WEAK` / `_NOT_RANDOM`
verbatim. `AGENTFORGE_PORTAL_URL` goes through `portalBaseUrl` → `assertAllowedEndpointUrl`. The
two client credentials go through `portalClientCredentials`; because that function refuses the
first variable it finds wanting, each is probed with the other stubbed, so both are named in one
message instead of one per restart. `AGENTFORGE_TRUSTED_ORIGINS` is judged by `trustedOrigins`,
and the question asked is "does at least one entry survive", not "is it set" — in server mode
cleartext entries are dropped, and an empty allowlist 403s every mutating call from every browser.
`AGENTFORGE_BILLING_WEBHOOK_SECRET` uses the constant `verifyBillingRequest` reads. One variable
was added beyond the required list: `AGENTFORGE_PUBLIC_URL`, checked through `publicBaseUrl` **only
when it is set**, because an explicit value the browser cannot reach is a sign-in flow that 503s at
the first click.

A real boot proves it, not only the suite. `NODE_ENV=production AGENTFORGE_SERVER=1` with nothing
else set exits 1 without opening a listener:

```
Error: Hosted mode (AGENTFORGE_SERVER=1) refuses to start: 6 required environment variables are missing or unusable.
  - AGENTFORGE_SECRETS_KEY: AGENTFORGE_SECRETS_KEY is required in server mode (AGENTFORGE_SERVER=1). Set it to at least 32 random bytes, hex or base64 (`openssl rand -hex 32`). The .master-key file fallback is disabled on the server.
  - AGENTFORGE_TRUSTED_ORIGINS: is not set, and the hosted server has no default. No browser could make a mutating /api call.
  - AGENTFORGE_PORTAL_URL: AGENTFORGE_PORTAL_URL is not set; the hosted server cannot reach the portal.
  - AGENTFORGE_PORTAL_CLIENT_ID: Sign-in is not configured on this deployment: AGENTFORGE_PORTAL_CLIENT_ID is not set.
  - AGENTFORGE_PORTAL_CLIENT_SECRET: Sign-in is not configured on this deployment: AGENTFORGE_PORTAL_CLIENT_SECRET is not set.
  - AGENTFORGE_BILLING_WEBHOOK_SECRET: is not set, so POST /api/v1/billing/webhook would refuse every delivery with billing_not_configured and no tenant's plan could ever go active.
Fix every line above before starting again; webapp-deploy/.env.example documents all of them. Only names are printed here, never values.
```

With all six supplied the same command gets past both guards and fails at the next step (no built
`apps/web/dist` in this worktree), which is the proof that a complete environment is not refused.

The billing secret is required only on `NODE_ENV=production`. On a server that is not production —
the review instance, a staging box — a missing one is a startup `console.warn`
(`BILLING_SECRET_MISSING_WARNING`, `hosted-env.ts:52`) rather than a refusal, because a box with no
payment provider bound is a real deployment and a silent `billing_not_configured` later is not.

Tests: `packages/host/src/hosted-env.test.ts`, 32 cases, table-driven — one row per variable
(absent, blank, and the specific way each can be wrong), one that pins the aggregated message names
all six at once, one that pins no VALUE ever appears in the text, and five that pin local mode is
untouched: a bare env, `development`, `test`, the flag explicitly off, and a desk with a weak key
and no portal all pass without a warning. Four more in
`apps/web/lib/hosted-mode-guard.test.ts:60-98` pin the wiring: that `server.ts` calls it, after the
mode check and before `server.listen`.

`webapp-deploy/compose.yml` and `.env.example` still describe a bootable config — every variable
the check requires is in the template (`AGENTFORGE_TRUSTED_ORIGINS:228`, `AGENTFORGE_PORTAL_URL:263`,
`AGENTFORGE_PORTAL_CLIENT_ID:276`, `_SECRET:277`, `AGENTFORGE_BILLING_WEBHOOK_SECRET:303`, and
`AGENTFORGE_SECRETS_KEY` from Secrets Manager through `compose.yml:53`). No name is wrong, so the
template was not edited. One thing an operator should know: `compose.yml` pins only
`AGENTFORGE_SERVER` and `AGENTFORGE_SECRETS_KEY` in its `environment:` block and everything else
arrives through `env_file: .env`, which is `required: false` — so a deployment with no `.env` now
refuses to boot rather than starting half-configured. That is the intended change, and it is the
loud version of what SR-04 describes.

Still unverified: nothing has been deployed. It becomes `fixed` when a hosted drive shows the
container refusing on a missing variable and starting on a complete one.

Gate: **blocks Tencent deploy.**

### SR-06 {#sr-06}

**A signed-out hosted visitor lands on the paste-your-key onboarding screen.**

Evidence: `apps/web/src/App.tsx:100-123` fetches `/api/v1/settings` at boot and, on any failure,
runs `setGate("onboarding")` at `:121`. In server mode that call is 401 for a visitor with no
session, because the gate sits ahead of the route table
(`packages/host/src/router.ts`, described in [`maps/hosted-security-controls.md`](maps/hosted-security-controls.md) section 2 row 6).
`resolveGate` (`apps/web/lib/gateway-gate.ts:94-99`) reaches the same answer for a hosted build with
no parseable gate payload. `App.tsx:140-141` then renders `OnboardingScreen`. The route table at
`:151-174` has no `/sign-in` and no `/auth/callback`.

What goes wrong if ignored: the first screen of the public deployment asks a stranger to paste a
gateway API key into a box. A user who complies has handed a live credential to a deployment they
have no account on, and the app cannot tell them they are signed out, because it never looked.

Required action: lane C's work. Boot must ask `GET /api/v1/auth/session` before it decides, route a
signed-out hosted visitor to the sign-in screen, and keep the paste-your-key screen for the desk and
for a signed-in tenant with no key.

Gate: **blocks Tencent deploy.**

### SR-12 {#sr-12}

**Twelve security tests do not run on this machine, and CI cannot start a runner, so local green
means less than it looks.**

Run on 2026-09-21 in this worktree. Counts are from those runs, not from memory.

| Suite | Result | Why |
|---|---|---|
| `packages/core/src/tools/platform/web-fetch.test.ts` | 3 of 4 fail | `Test timed out in 5000ms`. The SSRF guard resolves the hostname for real (`assertResolvesPublic`, `packages/core/src/security/safe-fetch.ts:110-128`), and a lookup of `example.test` on this machine outlasts vitest's 5 s default. |
| `packages/host/src/media-download.test.ts` | 6 of 6 fail | Same timeout, same cause. |
| `packages/host/src/wrap-key-rotation-script.test.ts` | 3 of 3 fail | The test spawns `node_modules/.bin/tsx` (`:25`) with `execFileSync`. That path is the extensionless POSIX shim; Windows needs `tsx.CMD`. Output is empty and the status is not 0. |
| `scripts/components-cli.test.mjs` | fails | Same shim. The assertion reads `null !== 1` at `:78`: the child never started, so there is no exit code. |
| `packages/host/src/tenant-state.test.ts` and `tenant-storage-writers.test.ts` | 21 of 23 pass | **Corrected.** These do not fail on a missing `drizzle-orm/better-sqlite3`. `packages/db/node_modules/drizzle-orm` is linked in this worktree and in `C:\Users\rizky\agentforge`. What fails is one 5 s timeout at `tenant-state.test.ts:268` and one real assertion at `tenant-storage-writers.test.ts:237`, `expected 'invalid_op' to be 'unsupported_media'`. **That one has now been read: it is a stale test premise *and* a product bug — see [SR-27](#sr-27), fixed 2026-09-21. `tenant-storage-writers.test.ts` is green (9 of 9) since that fix; `tenant-state.test.ts` still times out once and its `afterAll` `rmSync` fails with EPERM, which is the Windows teardown red recorded in AGENTS.md.** |

Nowhere else runs them. `gh run list` on 2026-09-21 returns `ci` and `e2e` failing in two to four
seconds on `main` and on every pull request, which is the Actions billing lock recorded as OWASP
A06-1. **2026-09-24:** the workflows are deleted and CI is `pnpm ci:local` on this desk
([SR-80](#sr-80)), so these suites now have to pass *here* — there is no other machine to run them.

What goes wrong if ignored: the SSRF guard is the control that stops a caller-supplied URL reaching
the cloud metadata service, and on this desk nothing confirms it. Specifically unverified locally:
the refusal of a redirect back to loopback and to a private host (`media-download.test.ts`), the
page-fetch caps and content-type refusals (`web-fetch.test.ts`), the wrap-key rotation's refusal of
a wrong current key (`wrap-key-rotation-script.test.ts`), the component CLI's refusal of a
components root inside the data dir (`components-cli.test.mjs`), and one tenant-storage refusal
code. "All green locally" does not cover any of it.

Required action: three separate fixes, none large. Give the two DNS-bound suites an explicit
`testTimeout` or a stubbed `lookupImpl`. Spawn `process.execPath` with the tsx loader, or resolve
`tsx.CMD` on Windows, in the two suites that shell out. Read
`tenant-storage-writers.test.ts:237` — **done, 2026-09-21; the answer is both, and it is
[SR-27](#sr-27)**. Clearing the Actions billing lock is no longer the way out: since 2026-09-24 the
only CI is `pnpm ci:local` on Windows ([SR-80](#sr-80)), so the Windows reds themselves must be fixed.

Gate: **blocks Tencent deploy.** A deploy whose SSRF guard has never been exercised anywhere is a
deploy on trust.


**Update 2026-09-24 — fixed.** All twelve now run and pass on this Windows desk under `pnpm ci:local`: the SSRF cases mock `node:dns/promises` and still assert the loopback, private-host and metadata-address refusals (a new case each for 169.254.169.254), and the wrap-key and components-CLI cases spawn `process.execPath` with tsx's JS entry instead of the `.bin` shim, so the wrong-current-key and components-root-inside-the-data-dir refusals are proven here. No product code changed. The residual "only when someone runs it" risk is [SR-80](#sr-80).
### SR-02 {#sr-02}

**`.webdev-data/` held `.master-key` and was not git-ignored.** Fixed in this change.

Evidence, before: `git check-ignore -v .webdev-data/.master-key` exited 1. The directory holds
`.master-key`, `agentforge.sqlite` and `settings.enc`, and `.webdev-data.bak-20260921/` holds a
second copy of the key. Both showed as untracked in `git status`.

After: `.gitignore:69` `.webdev-data*/` covers both, confirmed with `git check-ignore -v` on
`.webdev-data/.master-key`, `.webdev-data/agentforge.sqlite` and
`.webdev-data.bak-20260921/.master-key`. Neither directory appears in `git status` any more.

What goes wrong if ignored: one `git add -A` in this worktree commits the wrap key that encrypts
every `settings.enc` beside it, to a repo that is private today and need not stay that way. Rotating
after the fact means re-sealing every tenant's stored settings.

Required action: done. The related process rule is [SR-17](#sr-17).

Gate: blocks PR merge, for any PR cut from this worktree.

### SR-05 {#sr-05}

**`POST /api/v1/auth/login` had no `state` binding.** Fixed in the tree, not driven.

Evidence, as the flag was raised: the handler read only `code`. Evidence now, all of it uncommitted
lane F work: `packages/host/src/auth/routes.ts:283-290` reads `state` from the body and compares it
with the `__Host-agentforge_login_state` cookie through `statesMatch`; `:325-345` mints the state in
`GET /api/v1/auth/start` and sets it HttpOnly for ten minutes; `:257-262` clears the cookie on every
answer the route gives, so a state is spent whether the sign-in worked, was refused, or was forged.
`packages/host/src/auth/login-state.ts` and `login-state.test.ts` are new and untracked.

What goes wrong if ignored: login CSRF. Anyone who can make a browser POST to that route plants
their own authorization code in the victim's session, and the victim then works inside the
attacker's tenant without knowing it.

Required action: none in code. Drive it once on the review instance before this leaves the desk.
The route's own answer to a missing, stale or forged state is `invalid_request` in all three cases,
which is correct and should stay that way.

Gate: blocks PR merge for lane F.

### SR-39 {#sr-39}

**The portal's SMTP transport suppressed STARTTLS, so a real mail provider received sign-in codes
and the SMTP AUTH credentials in cleartext.** Raised and fixed 2026-09-21, fix pass X (reviewer's
P9-1).

Evidence: `apps/portal/src/mail/smtp.ts:47` was `ignoreTLS: !smtp.secure`, under a comment claiming
"a provider gets STARTTLS through `secure` / port 587". `ignoreTLS` does not mean "the server might
not offer TLS"; it means **do not attempt STARTTLS at all**. So every configuration that was not
implicit TLS on 465 - which is what `PORTAL_SMTP_SECURE` selects, and the documented production
shape is 587 - sent `AUTH LOGIN` with `PORTAL_SMTP_USER`/`PORTAL_SMTP_PASS` and then the six-digit
code over a plain socket. `loadConfig` did not refuse it either: `PORTAL_SMTP_HOST` merely had to be
set in production, so `127.0.0.1:1025` passed.

What goes wrong if ignored: anything on the path between the deployment and the mail provider reads
a live sign-in code and the credentials to send mail as the portal. The portal is the one surface
whose entire security argument is "we e-mail you a code".

Fix: the decision is made once, in `loadConfig`, and the transport only reads it. `SmtpConfig` gains
`requireTls` and `ignoreTls` (`apps/portal/src/config.ts:26-45`), computed at `config.ts:180-183` as
`requireTls = !secure && !loopback` and `ignoreTls = !secure && loopback`, so a remote host always
gets STARTTLS *and refuses to send without it*, and `ignoreTLS` survives only for a loopback sandbox
that speaks no TLS (Mailpit). Production refuses a cleartext loopback mail host outright
(`config.ts:196`). `smtpTransportOptions` (`apps/portal/src/mail/smtp.ts:51`) copies those three
fields and adds nothing; the inverted comment is replaced by the explanation above it.
`isLoopbackHost` (`apps/portal/src/security/cookies.ts:38`) now covers all of `127.0.0.0/8`.

Tests: `apps/portal/src/config.test.ts`, describe "SMTP transport security" (4);
`apps/portal/src/mail/mail.test.ts`, describe "smtpTransportOptions" (3).

Gate: **blocks Tencent deploy.** The first real mail provider is bound on the deployment, and this
is the configuration it would have been bound under.

### SR-45 {#sr-45}

**A finished Meeting recording was destroyed before the upload that was meant to save it.**

Raised by fix pass Y while reading the recording work that landed the same day. Not a perimeter
flag — it is an integrity one, and it belongs here for the same reason SR-13 does: the asset is a
tenant's own content, and there is no second copy anywhere.

Evidence, in `apps/web/components/meeting-studio.tsx` as it stood at `4938747`: the effect that took
a finished clip called `clearClip()` **before** `uploadRef.current(...)` (`:112-118`), and the
upload it then called (`:158-180`) returned silently when `busy` was set or no meeting was selected,
had no `catch`, and read `await res.json()` before looking at `res.ok`. Four ways to lose an hour of
audio with the recorder's own copy already dropped: a 413 from the host cap, a 401 on a session that
ended mid-meeting, an offline laptop, and a clip that finished while a previous upload was still in
flight. The `res.json()`-before-`res.ok` ordering added a fifth — an html error page or an empty 502
threw a `SyntaxError` out of a function nothing above it caught.

What goes wrong if ignored: the one artefact in this product that cannot be produced again is
deleted by the code that exists to save it, silently, on the ordinary failures of a hosted
deployment.

**Fixed-unverified, fix pass Y (2026-09-21).** The clip is held by `MeetingUploadController`
(`apps/web/lib/meeting-upload.ts`) from the moment it is offered until the host answers 2xx:
`offer()` takes ownership and the studio clears the recorder only after that
(`apps/web/components/meeting-studio.tsx:113-122`); `pending` is set to `null` only on a successful
POST (`meeting-upload.ts:196-198`); a clip offered while the studio is busy waits as `queued` and
goes out when it is free; a failure keeps the bytes and the panel offers **Retry upload** and **Save
to device**, which writes the blob to the owner's downloads (`meeting-upload.ts:224-243`,
`apps/web/components/meeting-recorder.tsx`). `postMeetingRecording` checks `res.ok` before reading
the body and turns a dead network into a reported failure rather than a throw
(`meeting-upload.ts:86-110`). The file input is disabled while recording, and Record is disabled
while a clip is still in hand. The size-cap notice moved into the controller's state so it outlives
the clip it describes, dismissed by the owner or replaced by the next recording.

Tests: `apps/web/lib/meeting-upload.test.ts` (12) — success clears, failure keeps and retries, a
throw inside `send` is also kept, busy queues, the same clip is never sent twice, and the cap notice
survives the clip; plus the route, the `file` field and the `res.ok` ordering, driven with a stubbed
`apiFetch`. `apps/web/lib/meeting-recorder-render.test.tsx` gained the queued, failed and capped
notices in both locales. `apps/web/lib/meeting-recorder-wiring.test.ts` was **deleted**: it read the
studio as a string and asserted `clearClip()` came before the upload — it pinned the bug.

Gate: **blocks Tencent deploy.** Recording is a hosted-only feature (it needs the
`Permissions-Policy` of [SR-14](#sr-14)), and this is where it loses people's work.

### SR-46 {#sr-46}

**`webapp-deploy/.env.example` said the portal login variables could be left empty, and the hosted
server now refuses to start without them.**

Evidence: that file's Phase 9 block said of `AGENTFORGE_PORTAL_URL`,
`AGENTFORGE_PORTAL_CLIENT_ID` and `AGENTFORGE_PORTAL_CLIENT_SECRET` that they were "documented here
ahead of the code that reads them" and that "leaving them empty changes nothing today". It stopped
being true when [SR-04](#sr-04) landed: `hostedEnvProblems`
(`packages/host/src/hosted-env.ts:178-190`) reads all three and `assertHostedEnvComplete` **throws**
before `server.listen` (`apps/web/server.ts:53-57`).

What goes wrong if ignored: an operator follows the template, restarts the container, and it does
not come up — `GET /healthz` never answers, so Caddy's active check keeps the previous container and
the deployment looks fine while the new code is not running. The only place the reason exists is the
container log.

**Fixed-unverified, fix pass Y (2026-09-21).** The block is rewritten to say the three are REQUIRED
in hosted mode, that the server refuses to start and names each variable it cannot use, and why the
old sentence was wrong (`webapp-deploy/.env.example:262-283`). A dated deploy note in
[`unreleased.md`](unreleased.md) states the preconditions for the next restart of the hosted server:
those three, `AGENTFORGE_SECRETS_KEY`, at least one https `AGENTFORGE_TRUSTED_ORIGINS` entry, and —
on `NODE_ENV=production` — `AGENTFORGE_BILLING_WEBHOOK_SECRET`.

Gate: **blocks Tencent deploy.** This is the document the deployment is configured from.

### SR-47 {#sr-47}

**A tenant nobody had sold anything to was labelled a paying Personal subscriber.**

Evidence: `handleGetBillingPlan` and `handleGetBillingPlans` labelled the tier from
`currentPlanRecord`, which returns `defaultPlanRecord` — kind `personal`, `seatCap: null`, status
`active` — for a tenant with no `tenant_plan` row, because entitlement enforcement fails **open**
(`packages/host/src/entitlement-store.ts:162-165`). Those two columns are byte-for-byte the Personal
tier's, so `matchTier` named it (`packages/core/src/plans/catalog.ts`). The consequences were all
customer-facing: `GET /api/v1/billing/plan` answered `tierId: "personal"`, Settings rendered
"Personal / Active", and `/pricing` replaced the Personal call to action with **"This is your
plan"**.

What goes wrong if ignored: the product tells a stranger they are on a paid plan. That is a false
statement about a commercial relationship, made by the billing surface, on first sight of the app —
and the tenant has no reason to buy the thing they are being told they already have.

**Fixed-unverified, fix pass Y (2026-09-21).** The label reads the stored row and only the stored
row: `storedTierId` (`packages/host/src/handlers/billing.ts:146-162`) is `findPlanRecord` — `null`
when there is none — and `matchTier` on it only when there is one. Both `tierId` and `current` are
`null` for a tenant with no plan. **Enforcement is untouched** and still reads `currentPlanRecord`,
so the gate still fails open. `matchTier` stays pure; its doc comment and its test now say out loud
that it cannot tell a sale from the fail-open default, and that the caller must
(`packages/core/src/plans/catalog.ts:148-183`, `catalog.test.ts`). `AccountPlanView` renders
`account-plan-none` — "No plan on this account yet." plus the link to `/pricing` — for a `null`
tier, and shows neither a tier name nor a status pill
(`apps/web/components/account-plan-panel.tsx`); `plans.account.unknownTier` ("Custom plan") was
replaced by `plans.account.noPlan` in both locales.

Tests: `packages/host/src/handlers/billing.test.ts` — "says a tenant nobody has sold anything to is
on no tier", "answers the catalog, and no current tier for a tenant with no plan row", "names the
tier once one has actually been sold"; `apps/web/lib/account-plan-render.test.tsx` — the no-plan
card, and that a `null` tier renders no status pill.

Gate: **blocks Tencent deploy.** It is wrong about money, on the page that asks for it.

### SR-50 {#sr-50}

**One request with a malformed `Host` header or request target stopped the portal.** Enterprise.
Raised and fixed 2026-09-23 by the portal defect pass.

Evidence, as the flag was raised: `createPortalServer` built each request's URL as
`new URL(incoming.url, "http://" + <Host header>)`, inside a `void`ed async function and *before*
that function's `try`. `Host: a b`, or the target `//x:99999/healthz`, made the constructor throw;
the promise rejected with nothing listening; and nothing in `apps/portal` handled
`unhandledRejection`, so Node's default applied and the process exited. One packet, from anybody
who could reach the port.

What goes wrong if ignored: the portal is the one public, unauthenticated service every sign-in goes
through. A crash any client can repeat at will is an outage any client can cause.

**Fixed, not driven.** The target is parsed against a fixed base that never reads `Host`
(`REQUEST_BASE` / `parseTarget`, `apps/portal/src/server.ts:98-107`), inside the handler's `try`,
and a target the parser refuses is `400 invalid_request` in the standard error body (`BAD_TARGET`,
`:90`, sent at `:202`). Every request promise now ends in a `.catch` that cannot itself throw: it
answers `500` or destroys the socket (`abandon`, `:151`, wired at `:251`). As a last resort,
`installProcessGuards` (`apps/portal/src/process-guards.ts:42`), installed first thing in
`apps/portal/src/main.ts:15`, writes an unhandled rejection or uncaught exception through the
portal's redacting logger and then exits 1 for the supervisor to restart. It deliberately does not
keep a process running in a state nobody can describe.

Tests: `apps/portal/src/server.test.ts` "a request whose target or Host header is not a URL" (raw
socket against the whole portal, including `Host: a b` and three unparseable targets) and "contains a
failure inside its own error handling, so a request never becomes an unhandled rejection";
`apps/portal/src/process-guards.test.ts` (6). Map: [`maps/portal-service.md`](maps/portal-service.md) § 6.

Gate: **blocks Tencent deploy.**

### SR-56 {#sr-56}

**The portal served every request as a Postgres superuser, so none of its row-level security
applied.** Enterprise. Raised and fixed 2026-09-23 by the portal defect pass.

Evidence, as the flag was raised: the portal migrated and served on one DSN, `PORTAL_DATABASE_URL`,
and `apps/portal/compose.yml` handed it `portal`, the superuser `initdb` creates. A superuser skips
every policy in `0004_rls.sql`. The role those policies were written for, `portal_app_login` — "a
LOGIN member of portal_app" whose password comes from the secret manager — is described in
`docs/internal/portal/migrations/0001_extensions_and_roles.sql:53-55` and was never created. Tenant
isolation held in the test suite, which connects as `portal_app_test`, and in no deployment.

What goes wrong if ignored: one injected statement, or one query missing its tenant filter, reads and
writes every tenant's users, sessions, devices and audit log. Row-level security exists for exactly
that case, and the connection string switched it off.

**Fixed, not driven.** Two DSNs that never overlap:

- `PORTAL_MIGRATE_DATABASE_URL` is the schema owner's. It is opened, migrated and closed before
  anything listens (`migrateAsOwner`, `apps/portal/src/boot.ts:111`). Production requires it;
  outside production it falls back to `PORTAL_DATABASE_URL` (`readMigrateDatabaseUrl`,
  `apps/portal/src/config.ts:188`).
- `PORTAL_DATABASE_URL` is the server's, as `portal_app_login`, which
  `apps/portal/migrations/0010_app_login_role.sql:36-38` creates `LOGIN NOSUPERUSER NOBYPASSRLS
  NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT IN ROLE portal_app` and **with no password**.
- Before the server listens, `pg_roles` is asked who that connection really is (`readConnectionRole`,
  `apps/portal/src/store/postgres/roles.ts:43`). A production boot refuses a superuser, a `BYPASSRLS`
  role, a member of `portal_admin`, a role that can `SET ROLE` to a privileged one, or one outside
  `portal_app` (`serverRoleProblems` / `checkServerRole`, `boot.ts:34`, `:126`). Outside production
  the same finding is a `portal_db_role_bypasses_rls` warning, so the old one-DSN desk still boots.
- Outside production only, each migrate sets `portal_app_login`'s password from
  `PORTAL_DATABASE_URL`, for that role name only and only when the owner DSN names a different role
  (`appLoginToProvision`, `boot.ts:98`). The compose database and the review instance need nothing
  but the two DSNs; the review harness reuses the compose password for both
  (`scripts/review-instance.ps1`, `Get-PortalEnvironment`, harness only).

**Hosted deploy steps.** A production portal does not start until they are done:

1. Set `PORTAL_MIGRATE_DATABASE_URL` to the schema owner's DSN and `PORTAL_DATABASE_URL` to
   `postgres://portal_app_login:<password>@…`, the password from the secret manager.
2. Migrate once, in the portal's own environment: `pnpm --filter @agentforge/portal migrate`
   (`apps/portal/scripts/migrate.ts`). `0010` creates the role without a password, and a role with no
   password cannot log in over TCP.
3. Once, as the owner: `psql "$PORTAL_MIGRATE_DATABASE_URL" -c '\password portal_app_login'`.
   `\password` sends a SCRAM verifier, so the plaintext stays out of the server's statement log. In
   production the portal never sets this password itself.
4. If the owner account may not create roles (a managed instance), `0010` skips the `CREATE` with a
   NOTICE (`:39-41`). Whoever can then creates it out of band with the same attributes —
   `CREATE ROLE portal_app_login LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
   INHERIT IN ROLE portal_app;` — and does step 3. The `GRANT CONNECT` to `portal_app` falls back the
   same way (`:52-59`).
5. Start the portal. A refusal naming the role is the check working. Do not answer it by giving the
   server role more.

Tests: `apps/portal/src/boot.test.ts` (17); `apps/portal/src/config.test.ts`
"PORTAL_MIGRATE_DATABASE_URL" (4); `apps/portal/src/store/postgres/migrate.test.ts` "creates
portal_app_login as 0001 describes it: a LOGIN member of portal_app and nothing more", "puts no
password in a migration file, as 0001 requires of login roles". Map:
[`maps/portal-service.md`](maps/portal-service.md) § 7.

Gate: **blocks Tencent deploy until the two DSNs and the role's password are provisioned.**

### SR-58 {#sr-58}

**A session the portal had ended kept working on the hosted app for up to 30 days.** Enterprise.
Raised and fixed 2026-09-23 by the host auth pass.

Evidence, as the flag was raised: the session gate trusted the host's own `auth_sessions` row — 12
hours idle, 30 days absolute — and nothing asked the portal again after sign-in. The renderer never
called `POST /api/v1/auth/refresh` (at `HEAD`, the only references are the route itself and its
registration). A session the portal revoked, a user it disabled, a device an admin signed out, or an
organisation that fell past due all kept working until the host's row idled out.

What goes wrong if ignored: every control the portal owns — revocation, disabling a person, seats,
past due — is advisory on the hosted app for as long as a tab stays open.

**Fixed, not driven.** Once the portal's last word on a session is ten minutes old
(`PORTAL_CHECK_INTERVAL_MS` and `portalCheckDue`, `packages/host/src/auth/session.ts:23`, `:147`),
the gate rotates the refresh token before the request runs (`gate`,
`packages/host/src/auth/portal-check.ts:376`, wired at `packages/host/src/router.ts:469`) and reads
the answer one of three ways:

- **rotated**: the new pair is kept and the check is stamped;
- **a terminal reason** (`TERMINAL_PORTAL_REASONS`, `portal-check.ts:77-88`: tenant, organisation or
  user inactive, past due, seat cap, device or session revoked, refresh reused or expired,
  `invalid_grant`): the session is revoked on the host, its tokens are dropped, and the request is
  `401` with the portal's own reason and copy;
- **no answer** (unreachable, timed out, rate-limited, or the portal refusing this deployment's own
  client, [SR-61](#sr-61)): the session stands, the request goes ahead, and that session is not
  asked again for a minute, or for the portal's own `retry_after` up to fifteen minutes
  (`PORTAL_CHECK_RETRY_MS`, `:62`).

A request waits at most two seconds on a due check (`PORTAL_CHECK_WAIT_MS`, `:60`); an answer that
arrives later is still applied. One refresh runs at a time per session, shared by the gate,
`POST /auth/refresh` and sign-out (`refresh`, `:355`), because the portal treats a spent token
presented twice as theft and ends the whole chain. That guarantee is per process: [SR-66](#sr-66).

Tests: `packages/host/src/auth/portal-check.test.ts` (inside and past the interval, every terminal
reason, an unanswering portal and its back-off, one refresh at a time, the host's own storage
failing, a slow portal); `packages/host/src/auth/session-gate.test.ts` "the gate checks the session
with the portal once its last word is ten minutes old" (4). Map:
[`maps/portal-session-auth.md`](maps/portal-session-auth.md).

Gate: **blocks Tencent deploy.**

### SR-67 {#sr-67}

**An Edit generate job ran as whatever tenant its stored request named.** Enterprise. Raised and
fixed 2026-09-23.

Evidence, as the flag was raised: the job runner read the tenant of a `generate_image` /
`generate_video` job out of the job's own `requestJson`
(`(job.requestJson as { tenant?: TenantContext }).tenant`), and
`POST /api/v1/edit/projects/:projectId/jobs` stored `requestJson` straight from the request body.
The route checked that the *project* was on the caller's desk and nothing else. So a caller could
queue a generate job on their own project with another tenant's `TenantContext` in the body — the
ids are not secrets, only unguessed — and that tenant decided whose gateway key paid, whose usage
ledger was charged, which desk the output and its work card landed on, and which organization's
media a still was read from.

What goes wrong if ignored: one tenant spends another tenant's gateway key and writes into another
tenant's desk with a single POST.

**Fixed, not driven.** Identity never comes from a stored request:

- `enqueueEditJob` drops any `tenant` or `requestedBy` from the request it is handed and records
  `requestedBy` only from its caller's verified tenant (`withoutIdentity`,
  `packages/host/src/edit/jobs.ts:55-63`; `:503-516`).
- The runner resolves the tenant from the project row and that recorded user through
  `resolvePortalTenant`, the read-only resolver a hosted session uses — tenant active, organization
  the tenant's, user still a member, desk the organization's — and fails closed when nobody is
  recorded or the user has left (`workerTenant`, `packages/host/src/edit/ops.ts:174`, called at
  `jobs.ts:225`). The gateway gate is applied to that tenant in the runner as well as on the route
  (`jobs.ts:226`).
- The wired submit uses the tenant it is handed and never `body.tenant`, which a job row written
  before this change may still carry (`isCompleteTenant`, `packages/host/src/edit/wire-generate.ts:11`).
- `POST …/jobs` no longer queues a generate kind at all ([SR-68](#sr-68)).

Tests: `packages/host/src/edit/generate-tenant.test.ts` (9, including "is the project's, whatever
tenant the stored request names" and "refuses a requester who is not a member of the project's
organization"); `packages/host/src/edit/wire-generate.test.ts` (3);
`packages/host/src/edit/jobs-route.test.ts` "POST …/jobs and identity in the body". Map:
[`maps/edit-timeline.md`](maps/edit-timeline.md).

Gate: **blocks Tencent deploy.**

## Medium

### SR-21 {#sr-21}

**The portal's 30-day browser session cannot be ended, so signing out of the app does not sign you
out of the sign-in.** Raised 2026-09-21 while driving SR-20; not fixed.

Evidence: `security/web-session.ts:24` sets `WEB_SESSION_TTL_MS` to thirty days, and
`routes/authorize.ts` mints that cookie on every successful sign-in. `clearCookie`
(`security/cookies.ts:120`) exists and is re-exported by `security/index.ts:2`, and **nothing calls
it**: `grep -rn clearCookie apps/portal/src` outside the tests returns only those two lines. The
only `/auth/logout` (`routes/tokens.ts:34`, `postLogout` `:143`) is the Bearer endpoint the host
calls; it revokes the refresh chain and the `sessions` row, and never touches the browser cookie.
`readWebSession` verifies an HMAC and a timestamp and asks the store nothing, so a revoked session
row does not invalidate it either. There is no `GET /signout` and no portal route of any kind that
answers with a cleared cookie.

Observed, not inferred: with the app signed out (`/api/v1/auth/session` → `{"signedIn":false}`,
`/chat` showing the sign-in screen), pressing **Sign in** went `/api/v1/auth/start` →
`GET /authorize` → `302 …?code&state` → signed in, with no address, no code and no mail — the whole
OTP step skipped, because `getAuthorize` (`routes/authorize.ts:95-103`) goes straight to
`completeSignIn` when the cookie carries a live session for the client's tenant. That is the
intended 30-day convenience; what is missing is the way out of it.

What goes wrong if ignored: a shared or public browser. The person who signs out has visibly ended
their session, and the next person to press Sign in is signed in **as them**, with no credential and
no code. It also makes the sign-in flow untestable after the first pass on any machine — which is
why proving SR-20 needed a second loopback origin with its own cookie jar.

Required action: a portal route that clears the session cookie (`clearCookie` is already written for
it), reached from the product's sign-out so the two ends agree, and a test that a second
`GET /authorize` after it renders the form rather than redirecting. Consider also binding the web
session to a `sessions` row so a server-side revoke ends it.

**Fixed-unverified 2026-09-21 (fix pass X), all three halves:**

- **The route.** `apps/portal/src/routes/logout.ts` — `GET /logout` and a CSRF-protected
  `POST /logout` (`logoutRoutes`, `:41`). Every answer carries the cleared cookie, including the
  refusals (`endBrowserSession`, `:115`; the CSRF refusal at `:165`). It redirects **only** to a URI
  whose origin exactly matches the origin of one of that client's registered `redirect_uris`
  (`allowedPostLogoutRedirect`, `:57`); anything else renders a neutral "signed out" page
  (`signedOut.*` in `apps/portal/locales/{en,id}/portal.json`).
- **Server-side revocation.** `apps/portal/migrations/0009_web_session_revocation.sql` adds
  `web_session_versions`, a per-user counter in the plain tenant-scoped RLS shape. The cookie
  carries the version it was minted under (`ver`, `apps/portal/src/security/web-session.ts:35`) and
  every use compares it inside the tenant scope (`versionIsLive`,
  `apps/portal/src/flows/web-session.ts:55`, called from `routes/authorize.ts:298` and
  `routes/activate.ts:122,286`). `POST /auth/logout` with `all_devices: true` bumps it
  (`flows/session.ts:141`) and writes `web_session.revoked`. A cookie minted before `ver` existed is
  refused rather than read as version 1 (`security/web-session.ts:107`).
- **The app side.** `packages/host/src/auth/routes.ts:433` names the portal's `/logout` on the
  sign-out answer (`portalLogoutUrl`), and
  `apps/web/components/account-session-row.tsx:64` (`signedOutDestination`) validates it exactly as
  `safeAuthorizeUrl` does before `signOutAndLeave` navigates there.

Tests: `apps/portal/src/routes/logout.test.ts` (13, including "ends a live cookie when the user's
web sessions are revoked server-side" and "renders the neutral page rather than following a URI off
that origin"), `apps/portal/src/routes/api.test.ts` "POST /auth/logout with all_devices also ends
that user's portal browser sessions", `packages/host/src/auth/routes.test.ts` "names the portal's
logout, with this deployment's sign-in as the way back",
`apps/web/lib/account-session-row.test.tsx` "goes through the portal's logout when the host named
one".

Still owed: the browser drive of sign-in → sign-out → sign-in-again on the review instance, and the
app-side hop (the third bullet) needs the rebuilt `apps/web/dist` the review instance serves.

Gate: **blocks Tencent deploy.** A public URL where sign-out does not sign out is not shippable.

### SR-25 {#sr-25}

**SQLite is opened, migrated and reset before either hosted boot guard runs.**

Evidence: `apps/web/server.ts` calls `assertHostedModeCoherent` and `assertHostedEnvComplete` as the
first two statements of `main()` (`:52`, `:56`). ESM hoists every `import` above the module body, so
`import { handleNodeRequest } from "@agentforge/host/http"` at `:12` — and through it
`@agentforge/db` — is **fully evaluated before `main()` is called at all**. And
`packages/db/src/client.ts` does real work at module scope: `mkdirSync(dirname(file))` at `:17`,
`applyPendingDataReset(localDataDir())` at `:35`, `new SqliteDatabase(file)` at `:38`, three
`pragma` calls, and `ensureSchema(sql)` at `:50`. (Still true on 2026-09-23; the lines are now `:17`,
`:39`, `:48` and `:60`, because the reset hook gained its outcome log — [SR-77](#sr-77).)

So a hosted process with a missing wrap key creates its data directory, opens SQLite, applies any
queued "Start over" wipe and runs every migration, **and only then** prints the six-variable refusal
from [SR-04](#sr-04) and exits 1. `apps/web/server-env.ts` is deliberate about the ordering of its
own side effect and its comment explains exactly this hoisting, which is what makes the rest of it
provable rather than guessed.

What goes wrong if ignored: less than SR-04 describes, but not nothing. A deployment that is refused
still leaves a half-built data directory behind, so the next operator sees files and assumes the
container got further than it did. The queued-reset path is the sharper edge: a restart loop against
a misconfigured environment applies the wipe on the first pass and refuses on every pass, which reads
as "the refusal deleted my data" when the two are unrelated.

Required action: make the hosted guards run before the host import can reach `@agentforge/db` — a
side-effect module beside `server-env.ts` is the established idiom here and the one that fits the
hoisting — or move the SQLite open in `packages/db/src/client.ts` behind a lazy accessor. Either is
a real change with a blast radius; neither belongs in a docs lane.

Gate: **blocks Tencent deploy.** The container's first action on a bad environment should be to say
so, not to write.

### SR-26 {#sr-26}

**`AGENTFORGE_PORTAL_URL` may be a plain-http loopback URL in production and still pass the boot
check.**

Evidence: `assertHostedEnvComplete` judges the portal URL through `portalBaseUrl` →
`assertAllowedEndpointUrl` ([SR-04](#sr-04)), and that function permits `http:` for a loopback host:
`packages/core/src/security/tls.ts:39-45` refuses plain HTTP only when
`!isLoopbackHost(parsed.hostname)`, and `LOOPBACK_HOSTS` (`:3`) is `localhost`, `127.0.0.1`, `::1`,
`[::1]`. Nothing in the check consults `NODE_ENV`. So `AGENTFORGE_PORTAL_URL=http://127.0.0.1:4000`
boots a production deployment.

That rule is correct for the desk and for the review instance, which is precisely how the portal is
reached today. It is a question, not a bug, at the point where `NODE_ENV=production`.

What goes wrong if ignored: on a single-host deployment the traffic never leaves loopback and nothing
is lost. On anything else — the portal in its own container, on another host, behind a service mesh —
the access token, the refresh token and the client secret cross a network in cleartext, and the
variable that decides which of those two worlds you are in is a string in a `.env`.

Required action: **an owner decision.** Either require https for `AGENTFORGE_PORTAL_URL` when
`NODE_ENV=production` (a rule in `hosted-env.ts`, not in `tls.ts`, so the desk and the review
instance keep the loopback exemption), or record that same-host loopback is the intended production
topology and say so in `webapp-deploy/.env.example` beside the variable. Do not leave it unstated.

Gate: **blocks Tencent deploy** until the decision is recorded either way.

**Decided and fixed 2026-09-23 (fixed, not driven).** The owner chose https in production.
`portalUrlProblem` (`packages/host/src/hosted-env.ts:128-140`) keeps `portalBaseUrl` as the judge and
adds one rule of its own on top, only ever stricter: on `NODE_ENV=production` the URL must be
`https:`, loopback included, answered with a fixed sentence that never echoes the value
(`PORTAL_URL_HTTPS_REQUIRED_DETAIL`, `:117`). `tls.ts` keeps its loopback exemption for every other
caller — a desk's Ollama, and the review instance off production. One consequence for the harness: a
review instance started with `-Production` and the default loopback portal URL now refuses to boot
unless `-PortalPublicUrl` names an https origin (`scripts/review-instance.ps1:214`, `:791`). Tests:
`packages/host/src/hosted-env.test.ts` "the portal URL is https in production, loopback included
(SR-26)". It reads `fixed` when a hosted container has been seen to refuse a plain-http portal URL.

### SR-27 {#sr-27}

**An Edit import that fails *after* the probe charges the tenant and leaves an orphan object.**
Found by reading the one real failure [SR-12](#sr-12) said somebody should read.

The test: `packages/host/src/tenant-storage-writers.test.ts:237` expects `unsupported_media` and gets
`invalid_op`. Re-run alone in this worktree on 2026-09-21 — `1 failed, 7 skipped`, the same assertion.

**Half of it is a stale test premise.** The test's own comment at `:228-230` says "There is no ffmpeg
in this container, so every import fails its probe here". This desk has ffmpeg, so the premise does
not hold and the refusal comes from somewhere else.

**The other half is a product hole, and it is the reason this row exists.** Driven directly: ffprobe
on a 4096-byte file of `0x07` named `clip.png` prints `Invalid PNG signature` to stderr and then
**exits 0**, reporting one video stream with `"width": 0, "height": 0` and `"duration": "0.040000"`.
So `probe` (`packages/host/src/edit/ffmpeg/recipes.ts:56-83`) returns normally, passing `width: 0` and
`height: 0` straight through because its guards are `typeof … === "number"` (`:78-79`). The refund
block in `handlePostEditImport` only runs when `probe` **throws**
(`packages/host/src/handlers/edit.ts:283-295`); past it, the `add_asset` payload is rejected by
`z.number().int().positive().optional()` (`packages/core/src/edit/document.ts:167`), which
`parseOpPayload` turns into `invalid_op` (`packages/core/src/edit/ops.ts:256`). That lands in the
handler's outer `catch (error) { return jsonError(error); }` (`handlers/edit.ts:342-344`), which
**does not** call `removeTenantObject`.

The bytes were already written and charged by `saveEditFile` at `:278`. So the tenant pays quota for
an object that never became an asset, and the object stays under their prefix with nothing pointing
at it. The two assertions the test never reaches — the refund and "no orphan object was left behind"
— are exactly the two things that are false.

What goes wrong if ignored: every malformed or truncated media file a user uploads to Edit costs them
quota permanently. It needs no attacker; a half-downloaded mp4 does it. Repeated, it fills a tenant's
ceiling with bytes they cannot see or delete.

Required action: two, and they are separate. **Product:** widen the refund to the whole import, not
just the probe — wrap everything after `saveEditFile` so any failure removes the object through the
store, and have `probe` treat a non-positive `width`/`height` as absent rather than passing `0`
through. **Test:** once the product refuses these files at the probe, restate `:228-230` so it does
not depend on whether the machine has ffmpeg — the current text makes a green run on a CI image and a
red run on a developer's desk both look like environment noise.

Gate: **blocks Tencent deploy.** Quota is a paid resource and this leaks it on ordinary input.

**Fixed-unverified, fix pass Y (2026-09-21).** Both halves, at the root rather than at the symptom.

1. **An unmeasurable probe is unsupported media.** `unusableProbeReason`
   (`packages/host/src/edit/probe-usable.ts:48-56`) refuses a visual kind with no positive
   `width`/`height` and a timed kind with no positive duration, and
   `handlePostEditImport` (`packages/host/src/handlers/edit.ts:322-329`) throws
   `ApiError("unsupported_media", …)` on it — inside the refund boundary, where the probe's own
   `throw` already landed. `probe` itself is unchanged: passing the zeros on is honest, and the
   caller is the one that knows the asset kind.
2. **The charge and the refund are one structure.** Everything after `saveEditFile` is inside a
   `try` whose `catch` calls `discardImportedObject` and rethrows
   (`packages/host/src/handlers/edit.ts:302-305`, `:391-397`, helper at `:203-224`). Whatever throws
   — the probe, the schema, `appendOps`, a database write — the object goes back through
   `removeTenantObject`, so the counter moves, and the `media` row `saveEditFile` inserted goes with
   it. Each cleanup step swallows its own failure: this runs on an error path and must not replace
   the real refusal with a cleanup error.

Tests: `packages/host/src/tenant-storage-writers.test.ts` — the existing case at `:227` is green
again, and a new one, "refunds a file ffprobe accepted but could not measure" (`:246-283`), stubs
`execFile` with exit 0 and `width: 0, height: 0` so the exact SR-27 condition is pinned on a machine
with or without ffmpeg. It asserts the code is `unsupported_media` and **not** `invalid_op`, the
usage counter, the object store and that no `media` row survives. The stale premise at `:228-230`
was restated.

### SR-22 {#sr-22}

**Personal advertised "One seat" while `seatCap: null` admits everybody. Fixed by copy, 2026-09-22.**

History: the Personal tier sets `seatCap: null` (`packages/core/src/plans/catalog.ts`, the personal
row), and `seatAdmission` reads `null` as "no cap configured", which admits everybody. The pricing
page used to render that null as `plans.seats.uncapped`, and the English catalog defined that key as
**"One seat"**. The page told a buyer Personal was one seat, and the entitlement admitted as many
users as the org had.

What changed: the pricing page omits the seats line when `seatCap` is null
(`apps/web/components/pricing-page.tsx`, `seatsLine`), and `apps/web/locales/en/plans.json` no longer
contains "One seat". Personal is described as the Mac and Windows app. `seatCap` stays `null`.
Admission is unchanged. The written one-seat claim is gone, so the copy-vs-enforcement gap is closed
without inventing a seat cap.

Gate: no longer blocks PR merge.

### SR-23 {#sr-23}

**One `devices` row per `(user, oauth client)`, so two browsers cannot be revoked apart.** Recorded
as a bounded trade-off, chosen deliberately by lane B.

Evidence: `apps/portal/src/flows/login.ts:26-28` derives the install id as
`web-client-<clientId>` and `runBrowserLoginGate` (`:52-61`) upserts one `devices` row on it with
`platform: "web"`. The comment at `:2-21` states both sides: `sessions.device_id` is NOT NULL and
`login_precheck` refuses a user with no live device row, so a browser sign-in needs a device exactly
as a desktop one does; the browser has no `install_id` to send; and the row must be derivable at
`/auth/token` time from the authorization code alone, because the host exchanges the code
server-side and holds nothing of the browser.

What goes wrong if ignored: an admin who revokes a device to cut off one browser — a shared machine,
a lost laptop — cuts off every browser that user has. The blunt instrument still works; it is just
blunter than the word "device" suggests in an admin screen.

What does **not** go wrong: individual sessions stay individually revocable. `sessions` is per
sign-in and `POST /auth/logout` revokes one or all of them, so "sign out everywhere" is a real
control that does not depend on this row.

Required action: per-browser granularity needs a `device_id` column on `auth_codes` — a column lane B
could add but could not write, because the store contract belongs to another lane. Recorded as a
follow-up rather than half-built. Revisit before an admin UI offers "revoke this device".

Gate: **blocks Tencent deploy** only in the sense that the admin-facing word "device" must not promise
per-browser revocation until this is closed.

### SR-24 {#sr-24}

**`jwks_keys` is never read or written, so signing-key rotation is a hard cutover.**

Evidence: `grep -rn jwks_keys apps/portal/src` returns three lines and every one is a comment or a
test name — `src/jwt/keys.ts:24` and `:121`, and `src/jwt/keys.test.ts:16`. `publishedJwks`
(`src/jwt/keys.ts:125-140`) builds the JWKS document from `ring.all`, the **in-process** keyring, and
the comment at `:118-123` names the reason: `0004_rls.sql` grants `portal_app` SELECT only on that
table, so this process cannot publish its own key through it. The table itself is fully built in
`docs/internal/portal/migrations/0002_core_tables.sql:405-434`, with a `status IN ('active','next','retired')`
CHECK, a unique partial index on the active row and `publish_at` / `activate_at` ordering constraints
— a rotation design nothing drives.

What goes wrong if ignored: rotating `PORTAL_SIGNING_KEY` invalidates every access token minted under
the old one the instant the process restarts, because the old public key is no longer in the JWKS
document and there is no "retired but still published" window. That is a forced sign-out for every
user, and the design in 0002 exists precisely to avoid it. It also means a compromised signing key
cannot be retired gracefully — the only move is the same hard cutover.

Required action: before the first key rotation, not before the first deploy. Give the keyring a
Postgres-backed source: read `jwks_keys` for `publish_at <= now()` rows, publish all of them, sign
with the `active` one, and give `portal_admin` the INSERT/UPDATE the rotation needs. Until then,
treat `PORTAL_SIGNING_KEY` as a value that is set once and record that rotating it signs everyone
out.

Gate: **blocks Tencent deploy** as a documented operational limit — the runbook must say that
rotating this key is a forced sign-out, so nobody discovers it during an incident.

### SR-03 {#sr-03}

**The billing webhook authenticates on a shared-secret header, not a provider signature.**

Evidence: `packages/host/src/billing/authenticate.ts:25-63`. The header is `x-callback-token`
(`:25`), the secret is `AGENTFORGE_BILLING_WEBHOOK_SECRET` (`:28`), and the comparison is constant
time (`:35-39`). It fails closed when nothing is configured (`:51-58`). There is no signature over
the body and no timestamp, and the file says why at `:9-15`: the provider is undecided, Xendit
authenticates on exactly this, and Paddle and Stripe would need a raw-body path that lane B did not
build. Replay protection is idempotency on the provider's `eventId`
(`packages/host/src/handlers/billing.ts:76`, `packages/host/src/entitlement-store.ts:372-390`,
where `applied = 1` is terminal) plus an `occurredAt` ordering rule
(`packages/core/src/entitlement/webhook.ts:133`, which treats a missing timestamp as "now").

What goes wrong if ignored: the webhook is the only writer of `tenant_plan.status`. Anyone holding
the secret can set any tenant to `active`. A static header secret leaks the way static secrets leak:
a proxy log, a provider dashboard, a screenshot. Nothing about the request proves the payment
provider sent it, and a delivery captured once can be replayed under a new `eventId`.

Required action: `verifyBillingRequest` is the seam a signature adapter replaces, and the comment
says so. Until the provider is chosen, do not point anything at the route on a public deployment,
and treat the secret as a credential with an owner and a rotation date.

Gate: **blocks Tencent deploy**, in the narrow sense that the route must be either unreachable or
signature-checked before the URL is public.

### SR-10 {#sr-10}

**Manual OTP issuance hands a live sign-in code to whoever runs the CLI.**

Owner-approved as a stopgap (ruling 4 in [`web-phase9-portal-login.md`](web-phase9-portal-login.md))
until a mail provider is bound.

Evidence: `apps/portal/src/manual-otp.ts`. It mints a new code rather than reading one back, because
only the sha256 is stored (`:4-8`). Three guards, all present: `PORTAL_ALLOW_MANUAL_OTP=1` and a
production refusal at `:56`, and a known-address-only check at `:61-66` that answers the same way for
an unknown address and an ambiguous one. The audit row is written as `otp.issued_manually` at `:85`.
`apps/portal/src/config.ts:45` documents the variable as "Never in production", `:177-181` requires
a real `PORTAL_SMTP_HOST` in production, and `:136-138` requires the signing key there.

**Corrected once, then corrected back (2026-09-21, docs lane).** An earlier edit of this row said the
root `package.json` had no portal scripts. That is no longer true: it now carries `portal:dev`,
`portal:seed` and `portal:otp` (`package.json:16-18`), all three added in the same uncommitted work
this register describes. `pnpm portal:otp <email>` is real. The filter form
`pnpm --filter @agentforge/portal otp` is the same script and also works; `migrate` has no root alias
and is still filter-only.

What goes wrong if ignored: an operator terminal becomes a way to sign in as any seeded user. With
the guards, that is a deliberate dev affordance. Without the production refusal it would be a
backdoor that outlives the stopgap.

Required action: none for the scripts; they are wired. Keep the production refusal and the audit row
when the mail provider lands, and delete the CLI when nothing needs it.

Gate: **blocks Tencent deploy.** `PORTAL_ALLOW_MANUAL_OTP` must be unset there, and
`NODE_ENV=production` must be set so the second guard holds even if the first is wrong.

### SR-16 {#sr-16}

**Four OWASP findings are still open.** Of the 27 in [the pass](security-owasp-2026-09.md), 21 are
fixed, two were fixed on `main` afterwards, and four remain. All six re-read here.

| Finding | State today | Evidence |
|---|---|---|
| A01-1, cross-tenant discard of an Edit item | Fixed, confirmed | `packages/host/src/handlers/edit.ts:493` scopes on `projectId` as well as `id` |
| A01-2, by-id routes not systematically scoped | Fixed, confirmed | `packages/host/src/tenancy-harness.test.ts` exists and drives the by-id routes as a second tenant |
| A06-1, nothing runs the tests | **Moved to the local gate, 2026-09-24** | `.github/workflows/` is deleted. `scripts/ci-local.mjs` (`pnpm ci:local`) runs lint, tsc, every unit suite and `node scripts/audit-deployed.mjs --level high`. It runs only when someone runs it: [SR-80](#sr-80). See [SR-12](#sr-12) |
| A06-2, the image ships devDependencies | **Open** | `webapp-deploy/Dockerfile:102-103` copies the whole `/app` tree with no `pnpm prune --prod`, because `tsx` is the production entrypoint |
| A08-1, actions pinned to mutable tags | **Closed by removal, 2026-09-24** | The three workflows and their 15 `@v4` `uses:` lines are deleted; the repo has no `.github/workflows/`. [SR-80](#sr-80) |
| A10-6, DNS rebinding | **Open by nature** | `packages/core/src/security/safe-fetch.ts:102` states it: closing it needs a custom undici dispatcher with a pinned `lookup` |

Required action: A06-1 is the one that matters, because it is why every other row in this register
is proved by hand. Since 2026-09-24 its answer is the local gate, and what remains of it is
[SR-80](#sr-80). A08-1 went with the workflows. A06-2 is a migration item. A10-6 stays recorded.

Gate: **blocks Tencent deploy** for A06-1. The other three are recorded and accepted.

### SR-17 {#sr-17}

**A PR cut from this worktree with `git add -A` commits five lanes and an untracked logo.**

Evidence: on 2026-09-21 this tree carried 36 modified files and 20 untracked paths belonging to the
Meeting, Music, portal, plans and auth lanes, including `apps/portal/` in full,
`apps/web/public/brand/logo.png`, and the branding edits in `apps/web/lib/product-brand.tsx`. It is a
detached worktree at `4938747`, and it is the process serving `:3000`.

What goes wrong if ignored: a PR meant to carry one lane carries five, half of them mid-edit, plus a
binary nobody reviewed. Before this change it would also have carried a wrap key ([SR-02](#sr-02)).

Required action: stage files explicitly by path. Never `git add -A`, never `git add .`, in this
worktree.

Gate: blocks PR merge.

### SR-19 {#sr-19}

**`data/` is an allowlist, so each new product file under it is tracked by default.** Fixed in part
on 2026-09-21; fixed 2026-09-23.

Evidence: `.gitignore:7-30` names individual paths under `data/`, not the directory. Probed with
`git check-ignore`: `data/session.enc`, `data/meetings/m1/recording/source.webm` and
`data/components/x/y/f.node` were all unignored, while `data/agentforge.sqlite` and
`data/.master-key` were covered by name. Nothing is tracked under `data/` today (`git ls-files
data/` is empty).

What goes wrong if ignored: `data/session.enc` holds the portal refresh token, and AGENTS.md has
listed it as "never commit" since Phase 1 while nothing enforced that. Meeting recordings are a
tenant's audio, and the components directory is unpacked native code.

Required action: the three above are now ignored (`.gitignore:75-77`). The real fix is to invert the
list, ignoring `data/` and un-ignoring whatever must be tracked, which is nothing today. That is a
one-line change somebody should make deliberately rather than in a docs lane.

**Fixed 2026-09-23.** The list is inverted. `.gitignore:14` is `/data/`, the whole directory, and
both the per-name allowlist and the three lines added on 2026-09-21 are gone. The leading slash
anchors it to the repo root, so a source folder named `data` anywhere else stays tracked; the comment
above it (`:7-13`) says to switch to `/data/*` plus a `!/data/<name>` line if a file there ever has to
be tracked. Checked on 2026-09-23 with `git check-ignore -v`: `data/session.enc`,
`data/meetings/m1/recording/source.webm`, `data/components/x/y/f.node`, `data/agentforge.sqlite`,
`data/.master-key` and an invented `data/something-new.json` all match `.gitignore:14`.

Gate: none now. It blocked PR merge until this change.

### SR-42 {#sr-42}

**`GET /tenant/config` had no rate limiter, and told an anonymous caller which tenant slugs
exist.** Raised and fixed 2026-09-21, fix pass X (reviewer's P9-2).

Evidence: `getTenantConfig` (`apps/portal/src/routes/tokens.ts`) was the one route in the table with
no `limit(...)` call of its own, while the unauthenticated `?tenant=<slug>` branch cost three
database round trips - `resolve.bySlug`, then `tenants.findById` and `tenantConfig.get` inside a
transaction. The two refusals also differed: an unknown slug fell through to
`jsonError("invalid_request")` (400) and a slug belonging to a suspended tenant reached
`readTenantConfig` and came back `tenant_inactive` (403). Both halves of that are the shape the rest
of the service deliberately avoids - every resolver in `migrations/0007` returns "at most a tenant
id" precisely so a caller cannot learn whether a value was ever valid.

What goes wrong if ignored: anybody walks a wordlist against a public URL and learns the portal's
whitelabel partner list, unmetered. For a service whose tenants are named government bodies and
named companies, that list is the interesting thing about the database.

Fix: a dedicated per-IP limiter `tenantConfigIp` (300 / 10 min,
`apps/portal/src/security/rate-limit.ts:126,141`) counted **before either branch**
(`routes/tokens.ts:182`), its own bucket so branding lookups cannot spend the budget a sign-in
needs; and an unauthenticated failure is `invalid_request` whatever the reason
(`routes/tokens.ts:210`). A Bearer still gets the real reason - that caller already belongs to the
tenant and "your provider's account is suspended" is the one sentence they can act on.

Tests: `apps/portal/src/routes/api.test.ts` "GET /tenant/config cannot tell an unknown slug from a
suspended tenant" and "GET /tenant/config is rate limited on both branches".

Gate: **blocks Tencent deploy.** The route is unauthenticated and public by design.

### SR-48 {#sr-48}

**A failed ffmpeg run returned the full argv and raw stderr to the client.**

Evidence: `spawnFfmpeg`'s catch built `ffmpeg recipe failed: ${failureDetail(err)}` and threw it as
an `ApiError` (`packages/host/src/edit/ffmpeg/run.ts:159` at `4938747`, helper at `:80-88`).
`failureDetail` concatenated `execFile`'s own `message` — which **is** the command line: the
absolute path of the binary followed by every argument — with up to 300 characters of raw stderr,
which routinely repeats those paths. For this app the arguments are absolute paths to a tenant's
media inside the server's data directory, so the string carried the deployment's filesystem layout
and the storage prefix of whichever tenant's file was being read.

It reaches the browser by two routes, and neither is masked: `jsonError` serialises an `ApiError`
verbatim (`packages/host/src/errors.ts`), and `maskServerError` only touches **5xx** while this is a
`400`. Meeting streams the same message as an SSE `job.error` frame. Provoking it needs no
privilege: upload a deliberately malformed file to Edit or Meeting and read the error.

What goes wrong if ignored: an authenticated tenant learns the server's absolute paths and another
tenant's storage prefix from one bad upload — the reconnaissance half of a path-traversal attempt,
handed over by the error message.

**Fixed-unverified, fix pass Y (2026-09-21).** Two audiences, two messages. The detail goes to
`log.warn("ffmpeg_failed", { bin, reason, detail })` — structured, redacted by the host logger, and
server-side (`packages/host/src/edit/ffmpeg/run.ts:195-199`). The caller gets a fixed sentence,
`ffmpeg could not process that media (<reason>)`, where the reason is **chosen** from the failure
rather than copied out of it: `unreadable input`, `an unsupported codec`, `the tool could not be
started`, `an invalid run request`, `too much output`, or `exit code N`
(`failureReason`, `:110-138`). Nothing in the message derives from the process's own text, so there
is no path for a path to travel down. `job_cancelled` and `ffmpeg_timeout` keep their own codes, and
Meeting's SSE error stays a readable sentence rather than becoming a bare code.

Tests: `packages/host/src/edit/ffmpeg/run-failure-detail.test.ts` (5) — a real argv with a Windows
absolute path, a tenant prefix and a filename is fed in as `execFile`'s message and as stderr, and
the resulting message is asserted to contain no absolute path, no argv fragment and no filename; the
reason classes and the timeout/cancel codes are pinned. Two cases in
`packages/host/src/edit/ffmpeg/run-timeout.test.ts` that asserted the **old** behaviour (that
`ENOENT` and the stderr tail reached the caller) were rewritten to the new contract.

Gate: **blocks Tencent deploy.** It is a hosted information disclosure reachable by any tenant.

### SR-51 {#sr-51}

**Behind `PORTAL_TRUST_PROXY=1` the portal keyed every per-IP limit on the left-most
`X-Forwarded-For` entry, the one a client writes.** Enterprise. Raised and fixed 2026-09-23 by the
portal defect pass.

Evidence, as the flag was raised: `clientIp` took the first header line and then
`split(",")[0]`. When the proxy in front appends the peer it saw to whatever the client sent, the
front of that chain is the client's own text, so every per-IP bucket was keyed on a string the
caller chose: rotate a forged prefix for a fresh bucket per request, or name somebody else's address
and spend theirs. Whether a given deployment was exposed depended on whether its proxy replaced the
header or appended to it. The host has always read the last hop ([SR-18](#sr-18),
`packages/host/src/rate-limit.ts:136-144`); the portal did not.

What goes wrong if ignored: OTP send, authorize, token, device code and `/tenant/config`
([SR-42](#sr-42)) are all limited per IP. With the key in the caller's hands none of those limits
binds, and an honest address can be locked out by a stranger.

**Fixed, not driven.** Only the right-most entry is read, the one the proxy in front wrote; repeated
header lines are joined into one chain; and a last hop that is not an address falls back to the
socket peer, never to an entry further left (`apps/portal/src/security/client-ip.ts:55-68`, the rule
stated at `:13-22`). A second appending proxy in front of the first moves the client one hop left,
so this rule changes whenever the proxy chain does.

Tests: `apps/portal/src/security/security.test.ts` "client address" (four new cases, including
"cannot be steered by a forged prefix: rotating it leaves the same address");
`apps/portal/src/routes/api.test.ts` "keys on the address the proxy appended, so a rotated forged
prefix does not buy a fresh bucket".

Gate: **blocks Tencent deploy.** Re-read it with [SR-18](#sr-18) the day anything is put in front of
Caddy.

### SR-52 {#sr-52}

**A portal rate limiter whose key map was full refused every new caller for a whole window.**
Enterprise. Raised and fixed 2026-09-23 by the portal defect pass.

Evidence, as the flag was raised: `createRateLimiter` capped its map at `maxKeys` (20,000) and, when
sweeping expired windows freed nothing, answered `{ ok: false }` to any key it had not seen — "refuse
rather than grow". A flood of distinct keys fills the map quickly (one IPv6 /64 is far more than
20,000 addresses, [SR-79](#sr-79)), and from then until those windows expired every caller who was
not already counted was refused.

What goes wrong if ignored: the guard against memory exhaustion becomes the denial of service. It
needs no credentials and reaches every portal limiter, the sign-in ones included.

**Fixed, not driven.** A full map evicts its oldest live windows, 1% of the cap at a time, and never
refuses the caller (`makeRoom`, `apps/portal/src/security/rate-limit.ts:66-80`, called at `:101`;
`EVICTION_BATCH_SHARE`, `:45`). The map is kept in window-start order, so the first live entry is
the oldest. The trade is stated in the code: a flood can now reset somebody's window early, but it
can no longer lock anybody out. A cap below 1 is read as 1.

Tests: `apps/portal/src/security/security.test.ts` — "stops growing at maxKeys by evicting the oldest
window, not by refusing the next caller", "keeps a flood of new keys from locking a new caller out",
"evicts the window that started first, even when an older key restarted its window later", "sweeps
expired windows before it evicts a live one", "treats a cap below one as one, rather than looping on
an empty map".

Gate: **blocks Tencent deploy.**

### SR-53 {#sr-53}

**The portal had no daily limit on sign-in code guesses per address.** Enterprise. Raised and fixed
2026-09-23 by the portal defect pass; one half left open for the owner.

Evidence, as the flag was raised: a code allowed five guesses and an address three sends per fifteen
minutes (`apps/portal/src/store/postgres/otps.ts`, header). Nothing counted across codes, so one
address could take about 1,440 guesses a day — the constant's own comment puts that at roughly a
0.14% chance a day of hitting a six-digit code (`:20-25`), which compounds to about 40% over a year.

What goes wrong if ignored: an unattended script that guesses at one known address eventually signs
in as that person, with no access to their mail.

**Fixed, not driven.** `store.loginOtps.verify` sums `attempts` over every row for the address from
the last 24 hours, across both purposes, before it compares anything. At 20 it answers `locked`,
even for the right digits on a fresh code (`MAX_GUESSES_PER_DAY` / `GUESS_WINDOW_MS`, `otps.ts:26-27`;
the check at `:73-84`). The rows are read `FOR UPDATE` in a fixed order, so concurrent guesses cannot
all see nineteen. The flow audits a lock as `otp.locked` rather than `otp.failed`
(`apps/portal/src/otp/verify.ts:65`), and both code forms say to try again in 24 hours, in both
languages (`code.locked`, `apps/portal/locales/en/portal.json:20`, through
`apps/portal/src/routes/support.ts:98-100`). `prune_login_otps()` keeps 24 hours of rows, which is
what keeps the window countable.

**Open, for the owner: the cap is per address, so it is also a lockout.** Anyone who can type an
address can spend its twenty guesses — four codes' worth at three sends a quarter hour — and keep
that person out of sign-in for a day, as often as they like. That is the cost of a per-address cap,
which is the only one a guesser rotating addresses ([SR-79](#sr-79)) cannot step around. If it
bites: count per address and source, or lift the lock on a successful e-mail round trip. Recorded,
not decided.

Tests: `apps/portal/src/store/postgres/otps.test.ts` "the daily guess budget" (including an
uncommitted twentieth guess racing a code of the other purpose); `apps/portal/src/routes/browser.test.ts`
"refuses even the right code once twenty guesses were spent today, says why in both languages, and
audits otp.locked".

Gate: **blocks Tencent deploy**, for the fix and for the owner's answer on the lockout.

### SR-54 {#sr-54}

**`POST /auth/device/token`, the device-flow poll, had no per-IP limit.** Enterprise. Raised and fixed
2026-09-23 by the portal defect pass.

Evidence, as the flag was raised: the route checked its body and went straight to the store. The
only brakes were per code — `slow_down` on the third poll in one interval and a 200-poll ceiling
(`apps/portal/src/store/postgres/device-codes.ts`). The endpoint is unauthenticated, every call
costs two database round trips, and the design's own threat table asks for "Rate limits per IP and
per install_id" against polling abuse (`docs/internal/portal/device-code-login.md:496`).

What goes wrong if ignored: an unmetered, unauthenticated path from the internet to the portal's
database.

**Fixed, not driven.** `deviceTokenIp`, 600 per 10 minutes per IP
(`apps/portal/src/security/rate-limit.ts:178`, `:202`), counted before any lookup
(`apps/portal/src/routes/tokens.ts:185-189`). 600 is sized from the honest case: one device polls
every 5 seconds for a code's 10 minutes, 120 polls, so five devices signing in at once behind one
office address never meet it.

Tests: `apps/portal/src/routes/api.test.ts` "limits POST /auth/device/token per IP, at 600 per 10
minutes, and never trips one polling device".

Gate: **blocks Tencent deploy.**

### SR-55 {#sr-55}

**A portal refresh without `device_id` skipped the refresh token's device binding.** Enterprise.
Raised and fixed 2026-09-23 by the portal defect pass.

Evidence, as the flag was raised: `postToken` read `device_id` as optional and passed
`grant.deviceId ?? null` on, and `rotate_refresh_token` compares the presented device with the
session's only when one is passed — `p_device_id uuid DEFAULT NULL`, then
`IF p_device_id IS NOT NULL AND p_device_id <> r_sess.device_id`
(`docs/internal/portal/migrations/0005_functions.sql:221`, `:298`). A refresh that left the field
out was a refresh from any device, and a value that was not a uuid reached the `::uuid` cast and came
back `500`.

What goes wrong if ignored: the device binding is what refuses a stolen refresh token presented
from the wrong machine. Optional, it bound nothing.

**Fixed, not driven.** A refresh must carry `device_id`, and it must be a canonical uuid
(`DEVICE_ID`, `apps/portal/src/routes/tokens.ts:37`, checked at `:139`); anything else is
`400 invalid_request` before any lookup, so the token is not spent. `RefreshGrant.deviceId` is no
longer optional (`apps/portal/src/flows/token.ts:268`), so nothing further down can drop it. The
host has always sent the `device_id` its token body carried
(`packages/host/src/auth/portal-check.ts:303`).

Tests: `apps/portal/src/routes/api.test.ts` "refuses a refresh with no device_id, in the
invalid_request shape, without spending the token", "refuses a device_id that is not a devices.id,
rather than failing inside the database".

Gate: **blocks Tencent deploy.**

### SR-57 {#sr-57}

**Every hosted refresh counted against one per-IP bucket, which capped the hosted app near 300
active sessions and then blocked sign-in.** Enterprise. Raised and fixed 2026-09-23, portal and host.

Evidence, as the flag was raised: `POST /auth/token` counted every call in `tokenIp`, 300 per 10
minutes per IP. With the host's ten-minute re-check ([SR-58](#sr-58)) every hosted session refreshes
about every ten minutes, all from the host's one address. Past roughly 300 active sessions the
bucket is spent on refreshes alone, and the next browser sign-in — the authorization-code exchange,
same route, same bucket — is refused `rate_limited`.

What goes wrong if ignored: the hosted app stops accepting sign-ins at a few hundred users, and the
only trace is `rate_limited` in the portal's log.

**Fixed, not driven, at both ends.**

- **Portal.** A refresh that authenticates as a confidential client counts against the client —
  `tokenClient`, 20,000 per 10 minutes, keyed on `client_id` — and never against the address
  (`postConfidentialRefresh`, `apps/portal/src/routes/tokens.ts:105-125`; `authenticateClient`,
  `apps/portal/src/flows/token.ts:236`; the limits at `apps/portal/src/security/rate-limit.ts:200-201`).
  A wrong secret is `invalid_client`, audited as `token.client_auth_failed`, and counted in a
  per-address budget of 20 failures per 10 minutes that is checked before any lookup, so a secret
  sprayer is refused without a query. The code grant and any refresh without client credentials keep
  `tokenIp`.
- **Host.** Every refresh presents `AGENTFORGE_PORTAL_CLIENT_ID` and `AGENTFORGE_PORTAL_CLIENT_SECRET`
  when both are set (`configuredClientCredentials`, `packages/host/src/auth/portal-config.ts:130`;
  sent at `packages/host/src/auth/portal-check.ts:300-305`, and on the wire at
  `packages/host/src/auth/portal-client.ts:337-345`). The hosted boot check already refuses to start
  without both, so on a server they are always there.

The refresh token stays the credential for the refresh; the client credentials only choose the
bucket.

Tests: `apps/portal/src/routes/api.test.ts` "counts an authenticated client's refreshes against the
client, never the address, and keeps 300 for public ones", "keys the confidential bucket on client_id,
whichever address the refresh comes from", "answers 429 once a client has spent its 20,000 refreshes
in the window", "refuses a wrong client_secret as invalid_client, audits it, and stops looking after
20 from one address"; `packages/host/src/auth/portal-check.test.ts` "the check refreshes as the
confidential client"; `packages/host/src/auth/portal-client.test.ts` "refresh as the confidential
client"; `packages/host/src/auth/routes.test.ts` "the routes' refreshes authenticate as the
confidential client".

Gate: **blocks Tencent deploy.** Like every limit here, the new buckets are per process
([SR-29](#sr-29)).

### SR-59 {#sr-59}

**Signing out of the hosted app left the portal session and its refresh token alive.** Enterprise.
Raised and fixed 2026-09-23 by the host auth pass.

Evidence, as the flag was raised: `handleLogout` sent the vault's access token to the portal's
`/auth/logout` and swallowed any refusal, and `portalClient.logout` itself resolved on every answer,
`401` included. That access token is the one from the last rotation and lives an hour. A sign-out
after an idle hour presented an expired token, the portal refused it, and nothing noticed: the
host's session ended, the portal's session and its refresh chain did not.

What goes wrong if ignored: the person believes "Sign out" ended the account's session, and a live
refresh token outlives it with nothing left on the host to revoke it.

**Fixed, not driven.** Sign-out refreshes first, through the same one-at-a-time path as the gate,
and signs out at the portal with the live access token that comes back (`endPortalSession`,
`packages/host/src/auth/routes.ts:409-431`). A terminal answer or an empty vault means there is no
portal session left to end; no answer at all still tries the token the host holds. The local
sign-out runs in a `finally`, whatever the portal said (`:562-567`). `logout` now rejects on any
non-2xx with the portal's reason (`packages/host/src/auth/portal-client.ts:347-356`), which the
route logs as `portal_logout_failed`, without a token.

Tests: `packages/host/src/auth/routes.test.ts` "POST /api/v1/auth/logout ends the portal session with
a live token" (6); `packages/host/src/auth/portal-client.test.ts` "logout" (4).

Gate: **blocks Tencent deploy.**

### SR-60 {#sr-60}

**`auth_sessions` stored each browser's session cookie in the clear, as its primary key.**
Enterprise. Raised and fixed 2026-09-23 by the host auth pass.

Evidence, as the flag was raised: `auth_sessions.id` was the cookie value itself, so the table was a
list of live sessions. A backup, a copied data directory or one read-only SQL path replayed every
unexpired row as a cookie.

What goes wrong if ignored: any read of the hosted database is a session takeover for everyone
signed in.

**Fixed, not driven.** The table holds `sha256(id)` in lowercase hex, and the store only ever looks
up the digest of what the browser presented (`hashSessionId`, `packages/host/src/auth/session.ts:125`;
`atRest`, `packages/host/src/auth/session-store.ts:55`; the SQLite lookups at `:205`, `:235`,
`:242`). The cookie still carries the raw value. `packages/db/drizzle/0021_auth_session_hardening.sql`
rebuilds the table rather than altering it, so **every existing row is dropped and everybody signed
in to a hosted deployment signs in once more** when it lands. Those rows were dead anyway, since no
digest lookup can match a raw id; dropping them takes the last replayable ids off disk. The desktop
and webdev never write this table.

Tests: `packages/host/src/auth/session-store.test.ts` "finds a session only by the cookie's id, never
by the digest it stores", "writes the SHA-256 of the id, and never the id itself", "never finds a row
written before 0021, whose id is the raw cookie value"; `packages/db/src/migrate-0021.test.ts` (0021
on a fresh and on an upgraded database, its place in the journal, and the healer). Map:
[`maps/database-and-migrations.md`](maps/database-and-migrations.md).

Gate: **blocks Tencent deploy.** The forced re-sign-in belongs in the deploy note.

### SR-61 {#sr-61}

**The host read any 4xx from the portal URL as the end of the session, including a proxy's 404 and
the portal rejecting the host's own client.** Enterprise. Raised and fixed 2026-09-23 by the host auth
pass.

Evidence, as the flag was raised: `mapPortalError` turned any 4xx without a known `reason` into
`invalid_grant`, and the portal narrows `invalid_client` to `reason: invalid_grant` for the host.
Once the gate asks the portal on its own ([SR-58](#sr-58)), `invalid_grant` ends the session — so a
misrouted base path, a WAF page or a rotated client secret would sign out every hosted user whose
session came due.

What goes wrong if ignored: a configuration fault between the host and the portal becomes a mass
sign-out, logged as though the portal had ended every session.

**Fixed, not driven.** A 4xx carrying neither an RFC 6749 `error` nor a `reason` did not come from the
portal's error path and is `portal_unavailable` (`speaksPortalErrors`,
`packages/host/src/auth/portal-client.ts:209`, applied at `:240`), and `error: invalid_client` is
`portal_unavailable` before `reason` is read (`:234`). Neither is terminal, so the session stands. The
gate logs a rejected client as `portal_client_rejected`, naming the RFC error and never the secret
(`packages/host/src/auth/portal-check.ts:321-328`).

Tests: `packages/host/src/auth/portal-client.test.ts` "maps a 4xx that does not speak the portal's
error shape to portal_unavailable, not a refusal", "maps invalid_client to portal_unavailable, never
to a refusal that ends a session"; `packages/host/src/auth/portal-check.test.ts` "keeps every session
when the portal rejects the deployment's own client, and says so without the secret".

Gate: **blocks Tencent deploy.**

### SR-62 {#sr-62}

**A session write racing a sign-out could undo the revocation.** Enterprise. Raised and fixed
2026-09-23 by the host auth pass.

Evidence, as the flag was raised: two requests on one session each write what they read, and `save`
wrote the whole row, `revoked_at` included. A slide read before a sign-out and written after it set
`revoked_at` back to `NULL`, and the revoked session worked again.

What goes wrong if ignored: a sign-out, a forced sign-out after [SR-58](#sr-58) or an admin's revoke
loses a race with the person's own open tab.

**Fixed, not driven.** `save` never clears a revocation and keeps the first revocation time
(`coalesce(revoked_at, …)`, `packages/host/src/auth/session-store.ts:220`; the memory store's
`stickyRevocation`, `:60`), and a row that is revoked once the write lands keeps no sealed refresh
token (`:223`). The portal check has its own writer, `recordRotation` (`:227`), which only moves the
check stamp forward and never stores a token on a row revoked in the meantime.

Tests: `packages/host/src/auth/session-store.test.ts` "never un-revokes: a slide saved after a
revocation keeps the revocation", "keeps the first revocation time when revoked twice", "never stores
a rotated token on a row that was revoked while the rotation was in flight".

Gate: **blocks Tencent deploy.**

### SR-64 {#sr-64}

**The portal refresh token behind each hosted session is now stored at rest, sealed on its
`auth_sessions` row.** Enterprise. Owner decision, 2026-09-23; built by the host auth pass. Recorded
because it adds a stored secret and replaces [SR-08](#sr-08).

What changed, and why: until this pass the token lived in process memory only, so a restart, a
deploy or a crash emptied the vault and every hosted session ended at its next portal check. The
owner decided that a restart signs nobody out. The refresh token now also lives on the row it
belongs to, in `auth_sessions.refresh_sealed`, added by
`packages/db/drizzle/0021_auth_session_hardening.sql`. The access token is still never written
anywhere; after a restart the first check opens the sealed refresh token and rotates it
(`heldTokens`, `packages/host/src/auth/portal-check.ts:254`).

The controls, each read in code:

- **The key.** AES-256-GCM through the repo's one envelope format, under a key derived from the wrap
  key with HKDF-SHA256, empty salt, info `auth-session-refresh-v1` (`REFRESH_SEALING_INFO`,
  `packages/host/src/auth/session-secrets.ts:32`; `refreshSealingKey`, `:52`). Not the wrap key itself,
  and a label no other purpose uses.
- **The binding.** The sealed payload names the id digest of its own row, and `openRefresh` answers
  `null` for a blob sealed for any other row (`:82`, the check at `:98`), so a token moved between
  rows opens nowhere.
- **Its lifetime.** A revocation wipes it in the same write ([SR-62](#sr-62)); the purge wipes it once
  a session idles out and deletes the row at its absolute expiry; a rotation replaces it in the one
  write that stamps the check (`recordRotation`, `packages/host/src/auth/session-store.ts:227`). It is
  never part of a `SessionRecord`, and `find` names its columns so it cannot ride out on one.
- **Failure.** A blob that does not open under the current key — a wrap key changed without the
  rotation drill — ends that session cleanly as `refresh_expired`. A wrap key that cannot be read at
  all is a fault of the deployment, and ends nobody (`portal-check.ts:286-297`, and the `catch` at
  `:361-368`).
- **Rotation.** `rotateWrapKey` re-seals every live session's token along with the tenant settings,
  in the same two phases: every token is opened with the old key before anything is written, and one
  that will not open refuses the whole run; a token the running app replaced meanwhile is left alone
  rather than overwritten (`packages/host/src/wrap-key-rotation.ts:224-238`, `:262-273`;
  `scripts/rotate-wrap-key.ts` prints both counts).
- **The same change** has every refresh present the deployment's confidential client ([SR-57](#sr-57))
  and stops a rejected client from reading as a refusal ([SR-61](#sr-61)).

What this row asks the next reader to hold: the SQLite file is now a store of sealed, live
credentials. Anyone with the database **and** `AGENTFORGE_SECRETS_KEY` can refresh every hosted
session at the portal. The wrap key already opened every tenant's stored gateway key; it now also
opens their sign-ins. [SR-73](#sr-73) is one reason that matters.

**Fixed, not driven.** No host has been restarted with a signed-in session on it, and the rotation
drill has not run against a database holding sealed tokens. Two consequences are open rows of their
own: [SR-65](#sr-65) (Erase account keeps the tokens) and [SR-66](#sr-66) (one refresh at a time
holds per process only).

Tests: `packages/host/src/auth/session-secrets.test.ts` (14); `packages/host/src/auth/portal-check.test.ts`
"a restart signs nobody out" (9); `packages/host/src/auth/session-store.test.ts` (the sealed-token
cases, and "keeps only the sealed envelope in refresh_sealed, never the token itself");
`packages/host/src/auth/routes.test.ts` "the refresh token at rest";
`packages/host/src/wrap-key-rotation.test.ts` "rotating the session refresh tokens sealed on
auth_sessions" (7). Map: [`maps/portal-session-auth.md`](maps/portal-session-auth.md) § The refresh
token at rest.

Gate: **blocks Tencent deploy** until a restart with a signed-in session has been driven and the
rotation drill has carried sealed tokens across.

### SR-66 {#sr-66}

**The host's "one portal refresh at a time per session" holds only inside one process.**
Enterprise. Open.

Evidence: the one-at-a-time map is process memory (`inFlight`,
`packages/host/src/auth/portal-check.ts:209`), as the vault beside it is. The portal rotates the
refresh token on every use and answers a spent token presented again by revoking the whole chain and
the session (`docs/internal/portal/device-code-login.md:498`). Two host processes that check the same
session at the same moment present one token twice.

What goes wrong if ignored: on a deployment with more than one host process, sessions are signed out
at random, and each of those sign-outs is recorded at the portal as refresh-token reuse — the event a
theft investigation starts from.

Required action: run exactly one host process, or move the refresh behind a lock the processes share
(a row lock on `auth_sessions`, for one) before adding a second. The same shape as [SR-29](#sr-29)
for the portal's own limits.

Gate: **blocks running more than one host process.**

### SR-68 {#sr-68}

**`POST /api/v1/edit/projects/:projectId/jobs` queued any kind it was sent, and two kinds skipped
the checks of the route that normally starts them.** Enterprise. Raised and fixed 2026-09-23.

Evidence, as the flag was raised: the handler cast `body.kind` to `"ffmpeg_op"` and stored it, and
the column is plain text, so an unknown kind was queued as well. Of the known kinds, a generate job
skipped everything `/generate` does ([SR-67](#sr-67)); a `render` — the export — skipped `/export`'s
refusal of a timeline with unreviewed agent edits and its two allowed presets; and `asr`, the one
other kind that calls the gateway, skipped the gateway gate `/agent` applies when it queues the same
job.

What goes wrong if ignored: the review gate on agent edits and the gateway gate are only as strong as
the one route that forgets them.

**Fixed, not driven.** The kind is validated against `EDIT_JOB_KINDS`, which fails to compile if
core adds a kind the list does not name (`packages/host/src/edit/jobs.ts:21-31`; `parseEditJobKind`,
`:44`); anything else is `400`. Generate kinds and `render` are refused with a pointer to
`/generate` and `/export` (`packages/host/src/handlers/edit.ts:452-455`, checked at `:467` and
`:473`), and `asr` is gated (`:478-480`). The desk check still runs first, so another desk's project
id is a 404 whatever the body says.

Tests: `packages/host/src/edit/jobs-route.test.ts` (the kind, the generate kinds, render with and
without a review, identity in the body, and the gateway gate).

Gate: **blocks Tencent deploy.**

### SR-69 {#sr-69}

**`GET /api/v1/edit/metrics` returned every tenant's Edit activity to every caller.** Enterprise.
Raised and fixed 2026-09-23; one operator step open.

Evidence, as the flag was raised: `appendEditMetric` wrote every Edit event of the whole install to
one machine-wide file, `<dataDir>/edit/metrics.jsonl`, and `foldEditMetrics` read that file back to
whoever asked, with no scope. Every line carries project, run, card and job ids and the event's data.

What goes wrong if ignored: any signed-in person reads which projects other tenants' organizations
work on, when, and what their agents did.

**Fixed, not driven.** One file per tenant, in that tenant's own data directory, which the per-tenant
purge removes with the rest of the tenant (`metricsFile`, `packages/host/src/edit/metrics.ts:56`).
Every line is stamped with the tenant and organization read off the project row, never taken from
the caller (`appendEditMetric`, `:70`; `workerProjectScope`, `packages/host/src/edit/ops.ts:135`). A
read returns only lines of the caller's own tenant **and** organization, because a tenant's
organizations are separate customers (`belongsTo`, `metrics.ts:105`; `foldEditMetrics`, `:126`; the
handler at `packages/host/src/handlers/edit.ts:645-655`). A desk keeps its history: the local
tenant's file is the path every desk always had, and an unstamped old line in it is still the
owner's. On the hosted server an unstamped line is nobody's to read. A metric that cannot be
written is logged, and never fails the undo, keep or cancel it describes.

**Open, operator:** a hosted box that ran Edit before this change still holds the old
`<dataDir>/edit/metrics.jsonl`, with every tenant's lines in it. No hosted session resolves to the
local tenant, so nothing reads it any more; nothing deletes it either. Delete it on each such box.

Tests: `packages/host/src/edit/metrics-scope.test.ts` (writing, folding, and the hosted route: "shows
each session its own organization's activity and nobody else's", "serves none of the old
machine-wide lines to a hosted session").

Gate: **blocks Tencent deploy.**

### SR-72 {#sr-72}

**The proxy's logs kept each sign-in's one-time code and login state for 30 days.** Enterprise.
Raised 2026-09-23; the access log is fixed, the error log is open.

Evidence, as the flag was raised: the portal sends the browser to `/auth/callback?code=…&state=…`.
Caddy's access log is one JSON object per request with the full `uri`, shipped with 30-day retention
(the comment on the `log` block, `webapp-deploy/Caddyfile:77-87`), and the filter dropped only
`Cookie`, `Authorization` and `Set-Cookie`. `Referer` carried the same URL again: `/auth/callback`
serves the SPA shell, and every asset it loads before its script strips the query sends the whole
callback URL as `Referer`.

What goes wrong if ignored: the code is single-use and expires in 60 seconds, which limits what a
log reader can do with it — but a log is the wrong place for any credential, `state` is the value the
login-CSRF check compares, and the store's readers are not the people signing in.

**Access log: fixed, not driven.** Two query filters delete `code` and `state` from `request>uri` and
from `request>headers>Referer` (`webapp-deploy/Caddyfile:96-103`). The header filter needs Caddy 2.8
or later; on 2.7 it is a silent no-op and only `uri` is cleaned (`:86-87`). `compose.yml` pins
`caddy:2-alpine` (`webapp-deploy/compose.yml:116`), a moving tag, so the version is whatever was
pulled.

**Error log: open.** The filter lives in the site's `log` directive, which is that site's access
log. The global options block has no `log` of its own (`webapp-deploy/Caddyfile:10-14`), so Caddy's
default logger — where its error lines go — is unfiltered, and the pass reports that a failed
upstream request is logged there with the request's full URI. Not yet observed on a running Caddy.
Required: a global `log default { format filter { … } }` with the same rules, then a real Caddy run
that forces an upstream error on `/auth/callback?code=x&state=y` and a search of both streams for the
values.

Tests: `scripts/release-web.test.mjs` "the shipped Caddyfile keeps the sign-in code and state out of
the access log" (it reads the file; nothing runs Caddy).

Gate: **blocks Tencent deploy**, both halves.

### SR-73 {#sr-73}

**The proxy container was handed the app's whole `.env`, wrap key included.** Enterprise. Raised and
fixed 2026-09-23.

Evidence, as the flag was raised: the `proxy` service loaded `env_file: .env` in the source stack
(`webapp-deploy/compose.yml`) and in the compose file `scripts/release-web.mjs` writes into the
release bundle, there with `required: true`. That `.env` is the app's: the portal client secret, the
billing webhook secret and, in the release bundle whose `.env.example` lists it
(`REQUIRED_ENV`, `scripts/release-web.mjs:61-69`), `AGENTFORGE_SECRETS_KEY`. The Caddyfile reads
one variable, `{$DPSBUDDY_DOMAIN}`.

What goes wrong if ignored: the internet-facing container holds, for no reason, the key to every
tenant's stored secrets and sign-ins ([SR-64](#sr-64)). A compromise of the proxy, or anybody who can
`docker inspect` it, has the wrap key.

**Fixed, not driven.** Both compose files give the proxy exactly `DPSBUDDY_DOMAIN`
(`webapp-deploy/compose.yml:120-128`; `scripts/release-web.mjs:176-178`). The bundle uses `:?`, so
compose refuses an unset domain; the source stack uses `:-` because its `.env` is optional, and Caddy
then refuses to start. Compose still fills the value in from the `.env` beside the file.

Tests: `scripts/release-web.test.mjs` "the proxy gets exactly what the Caddyfile reads, never the
whole .env, in both compose files".

Gate: **blocks Tencent deploy.**

### SR-75 {#sr-75}

**A cancelled Market run kept paying for model calls, and a call that failed after the cancel could
stop the host.** Both products. Raised and fixed 2026-09-23.

Evidence, as the flag was raised:

- `withClientAbort` (`packages/host/src/market-generate.ts`) raced an already-started model call
  against the client's abort and answered 499, but could not stop the call: the runtime took no
  signal, so the gateway request ran to the end and was billed.
- In a team run each seat's `catch` read that 499 as one more "unavailable" analyst, and the pipeline
  went on through the other analysts, the debate, the risk read and the synthesis — every one a paid
  call — for a client that had gone.
- When the client had already left, `withClientAbort` threw before it ever observed the call it had
  been handed, so that call's later failure was a rejection nothing handled. The hosted server
  installs no `unhandledRejection` handler (none in `apps/web/server.ts` or `packages/host/src`), and
  Node's default for one is to exit the process.

What goes wrong if ignored: Cancel costs the tenant the full price of the run, and on the hosted
server one cancelled team briefing whose socket then drops can stop the process for every tenant.

**Fixed, not driven.**

- The runtime takes the caller's signal (`packages/core/src/runtime/types.ts:66`). The live runtime
  refuses to start a call once it has fired, forwards it into each call's own abort controller so the
  request in flight is cancelled, starts no fallback or retry after it, and rejects with the signal's
  reason instead of reporting `run.failed` (`linkCallerAbort`,
  `packages/core/src/runtime/ai-sdk-runtime.ts:137-148`, used at `:632`; the checks at `:182`, `:457`,
  `:465`). The stub runtime keeps the same contract (`packages/core/src/runtime/stub-runtime.ts:40`,
  `:49`). A call the gateway had already finished still completes, so its usage is recorded.
- The job runner passes the signal on and never starts the model fallback's stand-in after a cancel,
  nor marks the model down for it (`packages/host/src/job-regen.ts:158`, `:202`, `:219`).
- `withClientAbort` takes a function, so a run whose client has left never starts the paid call, and
  it races the call so a late answer is dropped and a late failure is observed
  (`market-generate.ts:219-237`). Market hands the run's signal to every call (`:388`, `:441`).
- A team seat rethrows a cancel instead of degrading it, and the pipeline stops at the stage it lands
  in (`isCancelled`, `packages/host/src/market-team.ts:123`; `:312-318`).

Tests: `packages/host/src/market-generate.test.ts` "withClientAbort" (5, two of them with an
`unhandledRejection` listener that must stay empty) and "hands the run's signal to the model call, so
a cancel aborts the request in flight"; `packages/host/src/market-team.test.ts` "stops the whole team
when the client leaves during %s" (three stages) and "leaves nothing to reject unhandled when the
abandoned call fails after the client left"; `packages/core/src/runtime/ai-sdk-runtime.test.ts`,
`packages/core/src/runtime/stub-runtime.test.ts`. Map: [`maps/market-watch.md`](maps/market-watch.md).

Gate: **blocks Tencent deploy and the next Personal cut.**

### SR-76 {#sr-76}

**Model-written finance figures reached the reader past the number guard three ways.** Both
products. Raised and fixed 2026-09-23.

The rule this guard exists for: figures are computed in core, and the model names categories and
writes the narrative but never produces an amount (AGENTS.md, Finance). Evidence, as the flag was
raised:

1. **Outside the section bodies.** `buildFinanceBrief` and the Finance tasks' `guardNarration` guarded
   each section's body only. The title, every heading and every assumption are model prose too, read
   first, and went out unguarded.
2. **The regenerate.** `regenerateFinanceSection` guarded the rewritten section but skipped the repair
   a generate runs, so the reader saw the literal `[unverified figure]` marker where the figure had
   been.
3. **The guard's own exemptions.** `isFreeNumber` passed any unit-less integer from 1900 to 2100 as a
   year and any up to 12 as a count, judged on the parsed value. "$2,000", "2k" and "Rp 1.950" all
   parse to integers in the year range, and "12.0" to a count, so an invented amount in any of those
   shapes passed.

What goes wrong if ignored: a finance deliverable states an amount no input or computation produced,
in the places a reader trusts most — or shows them a marker instead of a figure.

**Fixed, not driven.**

- Only a bare one- or two-digit count up to 12, or a bare four-digit year, is free. A currency mark,
  scale, sign, separator or decimal makes it an amount that must trace (`BARE_COUNT` / `BARE_YEAR`,
  `packages/core/src/finance/number-guard.ts:23-24`; `isFreeNumber`, `:143`).
- Titles, headings and assumptions are guarded in both paths. A title stating an untraced figure is
  replaced whole, by the default or, for a task, by the reader's own question; a heading loses the
  figure and keeps its words; an assumption resting on one is dropped and counted as a removed
  sentence. The marker is never left in any of them (`guardLabel`, `guardTitle`, `guardAssumptions`,
  `packages/host/src/finance-brief-build.ts:121`, `:140`, `:149`; `buildFinanceBrief`, `:191`;
  `guardNarration`, `packages/host/src/finance-tasks/narrate.ts:124`; the removed count carried
  through at `packages/host/src/finance-generate.ts:246` and `packages/host/src/finance-tasks/runner.ts:193`).
- A section regenerate runs the same repair a generate does — one rewrite of what the guard blanked,
  then the sentence goes — and keeps the section it was asked to replace when nothing traceable is
  left (`packages/host/src/finance-generate.ts:367-378`).

Tests: `packages/core/src/finance/number-guard.test.ts` "frees only a bare year or a bare small
count, never a written amount"; `packages/host/src/finance-brief-build.test.ts` and
`packages/host/src/finance-tasks/narrate.test.ts` "guards the title, every heading and every
assumption, and never leaves the marker in them"; `packages/host/src/finance-generate.test.ts`
"rewrites a blanked figure once, the same repair a generate runs, and ships no marker", "takes the
sentence out when the rewrite invents again, and counts it", "keeps the section it was asked to
replace when nothing traceable is left of the rewrite". Maps:
[`maps/finance-parse-and-generate.md`](maps/finance-parse-and-generate.md),
[`maps/finance-tasks.md`](maps/finance-tasks.md).

Gate: **blocks Tencent deploy and the next Personal cut.**

### SR-77 {#sr-77}

**A "Start over" wipe that failed part-way deleted its own marker, so the rest of it never ran.**
Personal (webdev runs the same boot step). Raised and fixed 2026-09-23.

Evidence, as the flag was raised: `applyPendingDataReset` (`packages/db/src/reset.ts`) removed each
entry, logged a removal that failed, and then always called `dropMarker` and reported
`applied: true`. On Windows a file another process still holds open fails with `EBUSY` or `EPERM`,
so a wipe the owner had confirmed could leave `.master-key`, `settings.enc` or the database behind,
with nothing left to retry it and nothing on screen to say so.

What goes wrong if ignored: "Start over" is the owner's erase. Leaving the key and the sealed
settings behind after reporting success is the one outcome that button may not have.

**Fixed, not driven.** A removal that fails keeps the marker, rewritten to name only what is still
owed, and the next launch retries it (`keepForRetry`, `packages/db/src/reset.ts:276`;
`applyPendingDataReset`, `:296`, the branch at `:332-337`). The database goes back on the list only
when part of it is what failed: once it is gone the app opens a fresh one on the same boot, and a
retry must not delete that (`database`, `:40`). `applied` is true only when everything went. The boot
line says whether Start over is finished (`resetOutcomeSummary`, `:345`, logged from
`packages/db/src/client.ts:38-46`).

Tests: `packages/db/src/reset-retry.test.ts` (7). Map:
[`maps/settings-and-gateway-gate.md`](maps/settings-and-gateway-gate.md).

Gate: **blocks the next Personal cut.** A packaged Windows drive of Start over is already owed
([`unreleased.md`](unreleased.md)).

### SR-79 {#sr-79}

**Every per-IP limit, on the portal and on the host, keys on the full IPv6 address, so one IPv6
client gets a fresh bucket per request.** Enterprise. Open, raised 2026-09-23.

Evidence: the portal's bucket key is the normalised address as it stands (`rateLimitKey`,
`apps/portal/src/security/client-ip.ts:71-73`; `normalise` keeps an IPv6 address whole, `:31-47`), and
the host's is the last `X-Forwarded-For` hop as it stands (`clientIp`,
`packages/host/src/rate-limit.ts:136-144`). A subscriber on IPv6 is commonly routed a whole /64, so a
caller there can change the low bits on every request.

What goes wrong if ignored: the per-IP limits bind IPv4 callers only. The per-address OTP limits
still hold, but the per-IP ones on OTP send, authorize, token, device code, the device poll
([SR-54](#sr-54)) and `/tenant/config` ([SR-42](#sr-42)) do not. Since [SR-52](#sr-52) such a flood
cannot lock anybody out, but it can push the oldest windows out of a full map, which resets them.

Required action: key an IPv6 address by its /64 in both `rateLimitKey` and the host's `clientIp`,
or keep the deployment IPv4-only and say so in the runbook.

Gate: **blocks Tencent deploy if the deployment is reachable over IPv6.**

### SR-80 {#sr-80}

**CI and the dependency-audit gate run only when someone runs `pnpm ci:local`.** Both products.
Raised and recorded 2026-09-24.

Evidence: Rizky decided on 2026-09-24 not to rely on GitHub Actions at all. Every Actions run on the
account had ended in `startup_failure` since the repo was created ([SR-12](#sr-12);
`docs/internal/0.14.22-changelog.md:118`), so `.github/workflows/ci.yml`,
`e2e.yml` and `desktop-mac.yml` never ran a job; all three are deleted. Their checks moved to
`scripts/ci-local.mjs`, run as `pnpm ci:local`: Biome lint, `tsc --noEmit` per workspace, `vitest run`
per package (sequential, fresh `AGENTFORGE_DATA_DIR` each), `node --test scripts/*.test.mjs`, the
`apps/desktop` node tests, the deployed-closure audit gate `node scripts/audit-deployed.mjs --level
high` (required; pnpm's `list` and `audit --json` are captured to the run's log dir and passed in with
`--closure` / `--audit`), and `pnpm audit --audit-level moderate` (advisory, as before). Playwright
runs only with `--e2e`. Logs: `.ci-local/<timestamp>/`, gitignored.

What goes wrong if ignored: the gate that closed OWASP A06-1 (a new high advisory in the hosted
image's closure, a failing unit suite) now fails only on a machine where someone ran it. A push
straight to `main`, a PR opened without a run, or a run on a stale `node_modules` all land
unchecked. `pnpm audit` also needs the registry; offline, the gate step fails rather than passes.

Required action: `pnpm ci:local` before every PR, merge and pack, and the `summary.md` table from
that run pasted into the PR (AGENTS.md, **Tests → Local CI**). A PR or a pack without it has not
been through CI. The Windows reds in [SR-12](#sr-12) and AGENTS.md's known-reds list now count
against this gate, because there is no second machine to run those suites.

Gate: **blocks PR merge** without a pasted `ci:local` summary.

### SR-81 {#sr-81}

**Keyless Research search sends the masked query to four pinned public APIs.** Both products.
Raised and checked 2026-09-26. Not an issue.

Evidence: `packages/core/src/tools/platform/keyless-search.ts` pins `https://en.wikipedia.org`,
`https://id.wikipedia.org`, `https://api.openalex.org`, `https://export.arxiv.org`, and
`https://api.crossref.org`. Each request is HTTPS, passes `assertAllowedEndpointUrl`, sends no
`Authorization` and no cookies (`credentials: "omit"`), and follows a redirect only when `Location`
stays on that origin (`redirect: "manual"`). `maskPii` runs on the query before it is sent. A saved
Tavily or Brave key still takes that path instead (`packages/core/src/tools/platform/web-search.ts`).
DuckDuckGo HTML, Mojeek's site, public SearXNG, the Marginalia `public` key, and Jina Reader were
considered and not called: the first three are scraping or an uninvited backend, Marginalia's public
key is CC BY-NC-SA, and Jina would receive the page URL and body.

What goes wrong if ignored: a later edit that follows an off-origin redirect, or that scrapes a
search page, would send a tenant's question somewhere this row does not allow.

Required action: keep the origin list and the manual redirect. A new search host is a new row.

Gate: none. Accepted. AGENTS.md already allows a keyless public search source a mode calls by design.

## Low

### SR-01 {#sr-01}

**`apps/portal/compose.yml` hardcodes `POSTGRES_PASSWORD: portal`.**

Evidence: `apps/portal/compose.yml:19`, with `POSTGRES_USER: portal` at `:18`. The port is published
as `127.0.0.1:5433:5432` at `:16`, and the comment at `:14` says the loopback prefix is load-bearing:
without it Docker publishes on `0.0.0.0`. Mailpit is bound the same way at `:36-37`.

What goes wrong if ignored: nothing today. It is a dev container on loopback holding seeded rows.
The risk is reuse: this file is the shape somebody copies when the portal gets a real deployment,
and a copied password on a reachable port is a database anyone can read.

Required action: parameterise before any non-loopback use, as `${PORTAL_POSTGRES_PASSWORD:?set this}`
so compose refuses rather than defaulting. Keep the `127.0.0.1:` prefix on both published ports.

Gate: dev only. It becomes a deploy gate the moment this file is used for anything but a desk.

### SR-07 {#sr-07}

**The CSRF token is bound to the session id, so it stops verifying the moment a session changes.**

Evidence: `packages/host/src/http-adapter.ts:552-561`. The cookie is re-minted, not only minted, and
only on a `GET`: `csrfNeedsMint` is true when the cookie does not match the presented session, and
`mintedCookies` is non-empty only when `method === "GET"`. The comment at `:555-557` states the
reason, which is that the old cookie would otherwise 403 every mutating call with nothing able to fix
it.

What goes wrong if ignored: after a sign-in, which is a POST, the browser holds a token bound to the
previous session. Every mutating call answers 403 until some GET re-mints. The failure looks like a
permissions bug rather than a stale token, so it costs a debugging session rather than a fix.

Required action: lane C ends the sign-in with a full page reload, which issues a GET and re-mints.
Keep it. If the flow ever becomes a client-side transition, mint the token on the login response
itself.

Gate: blocks PR merge for lane C, as a thing the flow must be seen to do.

### SR-09 {#sr-09}

**The two billing variables were missing from `webapp-deploy/.env.example`.** Fixed in the tree, not
deployed.

Evidence: `AGENTFORGE_BILLING_WEBHOOK_SECRET` at `.env.example:303` and `AGENTFORGE_BILLING_TOPUP_URL`
at `:311`, both inside the 48 uncommitted lines this file gained on 2026-09-21. The portal client
variables sit at `:263` and `:276-277`.

What goes wrong if ignored: the webhook fails closed with `billing_not_configured`
([SR-03](#sr-03)), which is the right refusal, but the operator has no way to know which variable to
set because the template never named it.

Required action: none beyond landing the change. This pairs with [SR-04](#sr-04): a template entry
and a boot check are the two halves of the same problem.

Gate: blocks Tencent deploy.

### SR-13 {#sr-13}

**Meeting mode: the earlier findings are mostly closed. One is not.**

Re-read against the PR #66 findings in [`handover-2026-09-20.md`](handover-2026-09-20.md).

| Flag | State today | Evidence |
|---|---|---|
| 25 MB recording cap | Still 25 MB, now handled | `packages/host/src/meeting/store-files.ts:26` and `apps/web/lib/meeting-recorder-media.ts:35`. The browser recorder stops at the cap less a margin (`apps/web/lib/meeting-recorder.ts:307`), so a long meeting is truncated rather than refused after the fact |
| No abort timeout on gateway transcription | Fixed | `packages/host/src/meeting/transcribe-request.ts:63` sets `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`; the signal reaches each chunk call at `transcribe.ts:135` and an abort is rethrown rather than retried at `:146-148` |
| ASR picker over-admitting `*-realtime` ids | Fixed | `packages/core/src/meeting/asr-model.ts:47` and `:87` refuse any id matching `/realtime/i`, alongside the TTS refusal |
| Orphaned recording files | **Open** | Deleting a meeting is clean: `packages/host/src/meeting/store.ts:167-175` removes the whole directory. Replacing a recording is not: `addRecording` at `:177-196` writes `recording/source.<ext>` and never removes a prior file under a different extension, so re-uploading a `.webm` over an `.mp3` leaves the old bytes on disk, outside the record and outside the tenant's quota accounting |

What goes wrong if ignored: a tenant's audio stays on the server after they replaced it, and nothing
knows it is there.

Required action: have `addRecording` remove the existing `record.recording.path` before it writes,
when the new path differs.

**Fixed-unverified, 2026-09-21 (lane E).** Done the other way round, deliberately: the new bytes
are written FIRST and the stale siblings are removed after
(`packages/host/src/meeting/store.ts:179-209`). Deleting first and then failing the write would
leave the tenant with neither recording; this way the worst case is the old one still being there.

`removeStaleRecordings(dir, keepAbsolute)` (`meeting/store-files.ts:149-192`) deletes every
`source.<ext>` in that meeting's `recording/` except the one just written. It is narrower than
"remove `record.recording.path`", which would miss anything an earlier crash left. What bounds it:
only that one directory, and every candidate is put back through `recordingFile()` — the same
containment check that guards a read — before `rmSync` sees it; only names matching
`/^source\.[a-z0-9]{1,5}$/`, so a file the store did not write is not its to delete; only
`entry.isFile()` from `readdirSync(..., { withFileTypes: true })`, which reports the directory
entry's own type, so a symlink answers `isSymbolicLink()` and is skipped and a directory can never
turn this into a recursive delete; and ENOENT is treated as the outcome asked for, not an error.

The derived audio goes too. `removeDerivedAudio` (`:194-212`) drops `audio/` on replace, guarded by
`lstatSync(...).isDirectory()` so a symlink named `audio` is left for a human. Those chunks are a
cache of the recording that was just replaced. In the ordinary course there is nothing to remove —
`meeting/run.ts:199` clears the directory in a `finally` after every transcription and
`extractMeetingAudio` (`meeting/audio.ts:75`) clears it again before the next one — so what this
catches is a run whose process died mid-way, whose chunks are the OLD recording's audio and carry
the same retention question as the source file.

Tests: `packages/host/src/meeting/store.test.ts`, 9 cases on their own temp roots — extension
change, a five-format chain that never accumulates, same-extension overwrite, the derived audio,
a neighbouring meeting plus a `notes.txt` and a `README.txt` that must survive, a symlink named
`source.lnk` whose target must survive, a recording directory deleted underneath the call, delete
still removing the whole meeting, and another tenant's meeting of the same id staying untouched.
The symlink case was confirmed to run rather than skip on this desk: `readdirSync` withFileTypes
reports `source.lnk isFile=false isSymlink=true`. Four of the nine failed before the change.

Still unverified: no recording has been replaced through the UI on a running instance.

Gate: dev only, until the deploy. It becomes a data-retention question the day a real tenant records
anything.

### SR-11 {#sr-11}

**The review harness writes secrets and a TLS key pair outside the repo.** Verified.

Evidence: `scripts/review-proxy.mjs:43` puts the key pair in `$HOME/.dpsbuddy-review/tls`, described
at `:42` as "never inside a checkout". The listener is loopback-enforced: `:158-162` refuses any
non-loopback `--listen` with the reason that off loopback the harness cannot honestly claim every
request arrived over TLS. `scripts/review-instance.ps1:60` writes `review.env` under
`$HOME\.dpsbuddy-review` at `:213`, mode 600 where the filesystem supports it (`:25`), generates its
own `AGENTFORGE_SECRETS_KEY` at `:176`, and validates both data directories through
`Assert-SafeDataDir` at `:421-422`. The ports are 4000, 3100 and 3443 (`:41-43`), all loopback.

One gap, small: `--upstream` is not loopback-checked the way `--listen` is (`:155-157`). Pointing the
harness at a remote upstream would stamp `X-Forwarded-Proto: https` onto a hop that was not.

What goes wrong if ignored: nothing, as the scripts stand. The file said "never ships" and the code
agrees with it.

Required action: add the same `isLoopbackHost` check to `--upstream`. Neither script may be copied
into `webapp-deploy/`; `webapp-deploy/Caddyfile` stays the only proxy the product ships behind.
`review.env` and `*.pem` are now ignored anyway (`.gitignore:82-83`), as a floor under a `--cert-dir`
pointed somewhere careless.

**The `--upstream` gap closed 2026-09-23 (fixed, not driven).** `parseArgs` refuses a non-loopback
`--upstream` the way it refuses `--listen`, naming the reason: the hop to the upstream is plain http
and the harness stamps `X-Forwarded-Proto: https` on it (`scripts/review-proxy.mjs:166-172`). No test
pins the new refusal; `scripts/review-proxy.test.mjs` exercises the `--listen` one only. Since the
same day's `.gitignore` rewrite ([SR-19](#sr-19)), `review.env` and `*.pem` are at `.gitignore:59-60`.

Gate: dev only.

### SR-29 {#sr-29}

**Portal rate limits are per-process and in memory, so a second instance doubles every ceiling.**

Evidence: `createRateLimiter` (`apps/portal/src/security/rate-limit.ts:45-46`) keeps its windows in a
plain `new Map<string, Window>()` with a key ceiling and a sweep. Nothing reads or writes a shared
store. Every limit the plan of record names rides on it: OTP three sends per fifteen minutes per
address, five verify attempts, device-code five per ten minutes per install and thirty per ten
minutes per IP, approve ten per ten minutes per user.

What goes wrong if ignored: nothing while one process serves the portal, which is true today and true
on the review instance. Behind a load balancer with two replicas every one of those numbers doubles,
and the enumeration and brute-force budgets the OTP design rests on are the numbers that double. The
failure is silent: the limiter still works, it is just twice as generous as the doc says.

Required action: none now. Before a second portal replica exists, move the windows behind a shared
store (the Postgres the portal already has is enough at this volume) or pin the portal to one
replica and say so in the runbook. The same sentence applies to the host's own limiters
(`packages/host/src/rate-limit.ts`), for the same reason.

Gate: **blocks Tencent deploy on a second instance.** One replica, no issue.

### SR-30 {#sr-30}

**The OTP send's enumeration defence is a timing floor, not a constant time.** Recorded because the
distinction matters and the code is honest about the shape it chose.

Evidence: `sendLoginOtp` (`apps/portal/src/otp/send.ts:78-92`) records `startedAt`, runs `attempt`,
and then sleeps only if the elapsed time is **below** `DEFAULT_MINIMUM_DURATION_MS`. A path that takes
longer than the floor is not padded down to it. The rest of the defence is real and was checked: the
code is minted **before** the lookup (`:96-98`, with the comment saying why), an unknown address and
an address in more than one tenant return the same `no_tenant` outcome (`:100-106`), and the page the
caller renders does not vary.

What goes wrong if ignored: an attacker who can measure many requests precisely can, in principle,
separate "this address exists and the mail transport was slow" from "this address does not exist and
we returned under the floor". It is a weak signal — the floor removes the fast path that would make
it easy, and SMTP jitter swamps what is left — but it is not zero, and a register exists so nobody
has to re-derive that at three in the morning.

Required action: none. If the floor is ever raised or removed, re-read this row first. Padding *down*
is not possible, so the only stronger shape is to move the send off the request path entirely, which
costs the "we sent it" answer the page depends on.

Gate: **blocks Tencent deploy** only as a thing the operator should know is a floor. No code change
asked for.

### SR-31 {#sr-31}

**`AGENTFORGE_BILLING_TOPUP_URL` is handed to the browser unvalidated.**

Evidence: `handlePostBillingTopUp` (`packages/host/src/handlers/billing.ts:242-253`) reads
`process.env.AGENTFORGE_BILLING_TOPUP_URL?.trim()` and, when it is non-empty, returns it as
`checkoutUrl` with no parse, no scheme check and no `assertAllowedEndpointUrl` — which is the
function every other outbound URL in this codebase goes through. The renderer then offers it as the
blocked screen's checkout control (`plan-blocked-checkout`, `pricing-cta-<id>`).

What goes wrong if ignored: less than it first looks, and the reason is worth writing down. The value
is an operator's own environment variable, not user input, so this is not an injection. What it is
is a missing floor: a typo lands a blocked tenant on a dead link with no error, and a `javascript:`
or `data:` value — set by accident, by a bad copy-paste out of a provider dashboard — would be
rendered as an anchor's `href` on a page the product controls. `.env.example` documents it as a
payment link, an invoice form or a support page, which is exactly the set `assertAllowedEndpointUrl`
already permits.

Required action: run it through `assertAllowedEndpointUrl` at the point of use and answer
`available: false` with the existing `billing_provider_not_configured` shape when it fails, so a
misconfigured deployment degrades the way an unconfigured one already does. Two lines, and it makes
the variable behave like every other URL the host is given.

Gate: **blocks Tencent deploy**, in the narrow sense that this variable is set for the first time on
the deployment that has a provider.

**Fixed-unverified, fix pass Y (2026-09-21).** Validated at the source, in one module both callers
share: `topUpUrl` (`packages/host/src/billing/topup-url.ts:31-42`) answers `null` for anything that
is not an absolute http(s) URL, and `handlePostBillingTopUp`
(`packages/host/src/handlers/billing.ts:288-297`) answers the existing
`available: false` / `billing_provider_not_configured` shape on it. `assertAllowedEndpointUrl` was
**not** used, deliberately: it is the guard for URLs the host itself will *call*, and it refuses
plain http, which a support page or an invoice form on an internal host may legitimately be. The
check here is the narrower one the sink needs — a scheme a browser will not execute.

The operator is told twice and never shown the value: `assertHostedEnvComplete` warns at boot
(`packages/host/src/hosted-env.ts:227-233`, warn-only, because a dead checkout link is not a reason
to refuse a deployment) and the route logs `billing_topup_url_invalid` with the variable name on
first use. The renderer's `safeCheckoutUrl` stays as the second end of the same string.

Tests: `packages/host/src/hosted-env.test.ts`, describe "the top-up link is checked at boot, by
name" (6) — including that a `javascript:` value does not appear in the warning; and
`packages/host/src/handlers/billing.test.ts`, "refuses %s rather than echoing it as a checkout link"
(5 values), which also asserts the bad value is nowhere in the response body.

### SR-32 {#sr-32}

**The portal's CSP carries `style-src 'unsafe-inline'`.** Recorded as a bounded trade-off.

Evidence: `apps/portal/src/security/headers.ts:34`, inside `BEFORE_FORM_ACTION`, with the reason at
`:32-33`: one inline `<style>` in the layout, no external stylesheet, so there is nothing to fetch and
nothing to point somewhere else. `script-src 'none'` sits directly above it at `:30`, `default-src
'none'` at `:29`, and `frame-ancestors 'none'` / `base-uri 'none'` follow in `AFTER_FORM_ACTION`
(`:37`).

What goes wrong if ignored: inline CSS is an injection sink in its own right — it can load images,
and it can be used to exfiltrate attribute values a selector can match. What removes almost all of it
here is the company that directive keeps: `script-src 'none'` means there is no script on any portal
page to inject in the first place, and every interpolation goes through the `html` tag with `raw()` as
the only greppable escape hatch. `views.test.ts` drives four injection payloads against every screen.

Required action: none now. Closing it means a nonce or a hash on the one inline block, which is worth
doing if the portal ever grows a second stylesheet or any script at all. Re-open this row the day
`script-src` stops being `'none'`.

Gate: dev only, while the pages carry no script.

### SR-33 {#sr-33}

**`PORTAL_TRUST_PROXY` and `PORTAL_PUBLIC_URL` are read outside `loadConfig`, so neither is validated
at boot.** Re-checked on 2026-09-21; still true.

Evidence: `PORTAL_TRUST_PROXY` is read by `readTrustProxy` in
`apps/portal/src/security/client-ip.ts` (the name is defined at `:14`), and `PORTAL_PUBLIC_URL` by
`apps/portal/src/flows/context.ts` (`PUBLIC_URL_ENV` at `:22`, resolved at `:53` and `:71`) and again
by the cookie rule in `apps/portal/src/security/cookies.ts:23`, `:66`. `loadConfig`
(`apps/portal/src/config.ts`) is the thing the README describes as reporting every problem at once
with the variable named, and neither of these goes through it.

What goes wrong if ignored: the README says these two decide real things — `PORTAL_TRUST_PROXY`
decides the address every rate-limit bucket keys on, and `PORTAL_PUBLIC_URL` is the access token's
`iss`, the device flow's `verification_uri` and an input to the cookie rule. A typo in the public URL
mints tokens with an issuer that verifies nowhere, and the process starts cleanly and says nothing.
A `PORTAL_TRUST_PROXY` left on with no proxy in front hands every rate-limit bucket to whoever sends
the header.

Required action: pull both into `loadConfig` — parse the public URL once, refuse a non-http(s) or
credentialed value there, and make the trust-proxy flag a boolean on the config object that
`client-ip.ts` is handed rather than reads. The aggregate message already exists; these two just are
not in it.

**Fixed-unverified 2026-09-21 (fix pass X).** Both are `PortalConfig` fields now:
`publicUrl` and `trustProxy` (`apps/portal/src/config.ts:74,84`), filled by `readPublicUrl`
(`:236`) and the same `readFlag` every other flag uses (`:283`), so `PORTAL_TRUST_PROXY=ture` is a
boot error rather than a silent "off". The public URL must be an **origin** — https anywhere, http
on loopback only, no credentials, no path, no query, no fragment — and is **required in
production**, because the access token's `iss` and the device flow's `verification_uri` are built
from it. `flows/context.ts:60` reads `config.publicUrl`; `security/client-ip.ts` reads no
environment at all and takes `trustProxy` as an argument.

Tests: `apps/portal/src/config.test.ts`, describe "PORTAL_PUBLIC_URL and PORTAL_TRUST_PROXY" (7
cases, including "requires PORTAL_PUBLIC_URL in production" and "accepts the running review
instance's configuration"); `apps/portal/src/security/security.test.ts` "takes the proxy decision as
an argument and reads no environment".

Gate: **blocks Tencent deploy.** Both variables are set for the first time on the deployment, which
is exactly where an unvalidated one costs the most.

### SR-34 {#sr-34}

**An existing dev Postgres volume keeps the old literal password `portal`.** The other half of
[SR-01](#sr-01).

Evidence: `apps/portal/README.md:37-43` states it. `POSTGRES_PASSWORD` is read by `initdb` on the
**first** start of an empty `portal-pgdata` volume and never again, so a desk whose volume predates
the change to `${PORTAL_POSTGRES_PASSWORD:?…}` still wants the password it was created with. The
README gives both ways out: `docker compose … exec postgres psql -U portal -c "\password portal"` to
change it in place, or `down -v` to drop the volume and every local portal row with it.

What goes wrong if ignored: on this desk, nothing — the port is published on `127.0.0.1:5433` only
(`apps/portal/compose.yml:16`). The risk is the same one SR-01 names: somebody copies the working
setup, including a volume whose password is a dictionary word, onto something reachable. The test
suite is unaffected either way; it runs its own PostgreSQL.

Required action: none required on a desk. Before any non-loopback use, recreate the volume so the
password comes from `PORTAL_POSTGRES_PASSWORD` rather than from history, and keep the `127.0.0.1:`
prefix on both published ports.

Gate: dev only.

### SR-40 {#sr-40}

**`pnpm portal:seed --redirect` accepted any absolute URI, including `javascript:` and `data:`.**
Raised and fixed 2026-09-21, fix pass X (reviewer's P9-4).

Evidence: `apps/portal/src/seed/args.ts` validated a redirect with a bare `new URL(uri)` inside a
`try`, which accepts `javascript:alert(1)`, `data:text/html,...`, `file:///...` and
`http://evil.example/cb` alike. Those values go into `oauth_clients.redirect_uris`, which
`checkClient` (`apps/portal/src/flows/authorize.ts:65`) exact-matches and then **redirects a browser
to, carrying the authorization code** - and `clientFormAction` names its origin in the page's CSP.

What goes wrong if ignored: the allowlist is the last thing between a stolen `client_id` and a code.
An operator pasting a callback from a ticket is the realistic path, not an attacker with shell
access; the point of a validator is that it holds when the input is careless rather than hostile.

Fix: `assertRedirectUri` (`apps/portal/src/seed/args.ts:58`) - https anywhere, http on loopback
only, the same rule the product applies to its own public origin. Stated in `SEED_USAGE` too.

Tests: `apps/portal/src/seed/seed.test.ts` "refuses a --redirect that is not https, or http off
loopback" (5 payloads) and "accepts https anywhere and http on loopback".

Gate: **blocks Tencent deploy.** The deployment's client is seeded with this script.

### SR-41 {#sr-41}

**A request body over the portal's 64 KB cap answered `500 internal_error`.** Raised and fixed
2026-09-21, fix pass X (reviewer's P9-6).

Evidence: `readBody` in `apps/portal/src/server.ts` threw a plain `Error("request body too large")`,
which the request handler's catch-all turned into the flat 500 it gives a broken handler.

What goes wrong if ignored: nothing is exposed - the body is discarded either way, and the 500 says
nothing. It is wrong in the direction that costs an operator an afternoon: a client that is sending
too much is told the server is broken, and the log line reads `request_failed`.

Fix: a distinguishable `BodyTooLargeError` (`apps/portal/src/server.ts:88`) answered as `413` with
the same `{ error, reason, message_en, message_id }` body every other refusal uses (`TOO_LARGE`,
`:81`).

Tests: `apps/portal/src/server.test.ts` "answers 413 with the standard error body for a body over
the server's cap".

Gate: dev only.

### SR-43 {#sr-43}

**`auth_codes.state_hash` was stored and never verified, while the code and three documents called
it a binding.** Raised and fixed 2026-09-21, fix pass X (reviewer's P9-3).

Evidence: `apps/portal/src/store/postgres/auth-codes.ts` compared `state` only when the caller
passed one (`if (input.state !== undefined)`), and the only caller - `exchangeAuthorizationCode`,
`apps/portal/src/flows/token.ts:98` - never did. The host does not send `state` to `/auth/token` and
never has: its login-CSRF control is its own `__Host-` cookie comparison
(`packages/host/src/auth/routes.ts`, `readState`), made **before** the portal is called. Meanwhile
the file header, `migrations/0006_browser_login.sql` and `docs/internal/maps/portal-service.md` all
said a code was "bound to sha256(state)".

What goes wrong if ignored: nothing breaks, and that is the problem. A control nobody runs, named in
three places as a control, is how a later change removes the real one (the host cookie) believing
the portal still checks. A dead branch also can never be wrong in a test.

Fix: the branch and the `state` field on `ConsumeAuthCodeInput` are gone, with `state_mismatch`
removed from `ConsumeAuthCodeResult` (`apps/portal/src/store/inputs.ts:250`); the hash is still
written, which costs 32 bytes and lets an audit tie a code to the nonce the browser carried. The
wording is corrected in the file header, in `store/inputs.ts`, and in the map page. `0006` is applied
and checksummed by the migration runner, so it is not edited: the correction is a
`COMMENT ON COLUMN auth_codes.state_hash` in
`apps/portal/migrations/0009_web_session_revocation.sql`, where a `\d+ auth_codes` shows it.

Tests: `apps/portal/src/store/postgres/auth-codes.test.ts` "consumes a code without being given a
state, because nothing sends one"; the client and redirect bindings keep their own cases.

Gate: **blocks Tencent deploy**, as documentation that overstates a control.

### SR-44 {#sr-44}

**`scripts/review-instance.ps1` seeded the literal Postgres password `portal` into `review.env`.**
Raised and fixed 2026-09-21, fix pass X (reviewer's P9-7). The script half of [SR-01](#sr-01) /
[SR-34](#sr-34).

Evidence: `Initialize-ReviewEnv` generated 32 random bytes for three secrets and then
`'PORTAL_POSTGRES_PASSWORD' = { 'portal' }`, under a comment saying compose "sets POSTGRES_PASSWORD
literally" - which stopped being true when `apps/portal/compose.yml` moved to
`${PORTAL_POSTGRES_PASSWORD:?...}`. So the one value with no default in the compose file got its
default from the script instead.

What goes wrong if ignored: on this desk, nothing; the port is `127.0.0.1:5433` only. It is the same
reuse risk SR-01 names, one layer further along - the harness is what somebody copies.

Fix: `Resolve-PostgresPassword` (`scripts/review-instance.ps1`) is called only when `review.env` has
no value, because `Initialize-ReviewEnv` fills in what is missing and never rewrites what is there -
so an existing review root keeps the password its volume was initialised with. For a fresh root it
generates 18 random bytes. The case that must not be guessed is a volume that already exists with no
recorded password: `Test-PortalVolume` probes `docker volume inspect agentforge-portal_portal-pgdata`
(a plain docker call, not a compose one, so it does not need the variable it is resolving) and the
script **stops with the three ways out** rather than generating a password that cannot connect. A
daemon that cannot answer is also a stop, not a guess.

Tests: `scripts/review-instance.test.mjs` - "no Postgres password literal is seeded into
review.env", "an existing compose volume with no recorded password stops the script", "the volume
probe is a plain docker call, outside Invoke-Compose", "Initialize-ReviewEnv fills in only what is
missing".

Gate: dev only.

### SR-63 {#sr-63}

**A malformed `Host` header or request target threw out of the host's HTTP adapter before any rule
ran.** Enterprise: the adapter serves webdev and the hosted server, and the packaged desktop has no
HTTP port. Raised and fixed 2026-09-23 by the host auth pass.

Evidence, as the flag was raised: the adapter parsed each request as
`new URL(req.url, "http://" + <Host>)`, so `Host: a b`, `[` or an empty value, or a target such as
`//[`, threw `ERR_INVALID_URL` out of `handleNodeRequest` before the TLS rule, the method allowlist
or the per-IP bucket. `apps/web/server.ts:67-71` passes a rejection to Express's `next`, so it
became Express's error answer rather than an unhandled rejection — but an unmetered one.

What goes wrong if ignored: a request shape that skips the rate limiter and every transport check,
and a server error in the log for what is a client's mistake.

**Fixed, not driven.** The target is parsed against a fixed base (`TARGET_PARSE_BASE`,
`packages/host/src/http-adapter.ts:150`; `requestTargetOf`, `:167`), so `Host` never reaches the URL
parser, and `isMalformedHostHeader` (`:203`) judges the header on its own. Both are `400`
(`invalid_path`, `:153`; `invalid_host`, `:160`), decided in both modes at `:556` and answered at
`:617` — in server mode after the TLS rule and the buckets, so a malformed request is still counted.
An absent `Host` is not malformed here; the mutating rules already refuse a write without one.

Tests: `packages/host/src/http-adapter.test.ts` "handleNodeRequest malformed Host header or request
target". Map: [`maps/hosted-security-controls.md`](maps/hosted-security-controls.md) § 2.

Gate: **blocks Tencent deploy.**

### SR-65 {#sr-65}

**Erase account keeps the tenant's sessions, and now their stored portal refresh tokens.**
Enterprise. Open — owner decision pending, raised 2026-09-23.

Evidence: a tenant reset deliberately keeps `auth_sessions` — "a reset empties an account, it does
not sign its people out" (`KEPT_TENANT_TABLES`, `packages/db/src/tenant-purge.ts:124`) — and its
step 6 re-provisions the organization under the same id, so those sessions keep resolving
(`packages/host/src/tenant-reset.ts:28-34`, the code at `:317`). Before [SR-64](#sr-64) that kept a
row and a cookie. Now it also keeps each session's sealed refresh token, which survives a restart.

What goes wrong if ignored: an owner who erases an account because they believe it was compromised
expects access to end with it. Every browser signed in to that tenant, an unwelcome one included,
stays signed in and keeps refreshing at the portal. The portal can still end those sessions, and the
host now honours that within ten minutes ([SR-58](#sr-58)); the erase itself does not.

Required action: an owner decision. Keep the sessions and say so on the Erase account screen, clear
`refresh_sealed` for the tenant, or revoke every session of the tenant as part of the reset.

Gate: **blocks Tencent deploy** until the decision is recorded.

### SR-70 {#sr-70}

**The hosted Edit doctor returned the absolute path of the server's ffmpeg.** Enterprise. Raised and
fixed 2026-09-23.

Evidence, as the flag was raised: `GET /api/v1/edit/doctor` sent `ffmpeg.path`, the binary's
absolute path, to every caller. On a desk that is the owner's own machine and helps them fix an
install; on the hosted server it is the operator's filesystem, and nothing a tenant can act on.

**Fixed, not driven.** In server mode the handler drops `path` and keeps the rest of the report
(`withoutBinaryPath`, `packages/host/src/edit/doctor.ts:36`; `packages/host/src/handlers/edit.ts:110-115`);
the banner reads `found`, `reason` and `setup`, never the path. A desk keeps it. Same class as
[SR-48](#sr-48).

Tests: `packages/host/src/edit/doctor-hosted.test.ts` (2).

Gate: **blocks Tencent deploy.**

### SR-71 {#sr-71}

**An Edit generate told the caller whether a media id existed in any organization.** Enterprise.
Raised and fixed 2026-09-23.

Evidence, as the flag was raised: `assertStillAvailable` looked a still's media id up by id alone.
Another organization's id passed and an unknown one was refused `STILL_NOT_FOUND`, so the answer was
an existence oracle across tenants. The bytes were not exposed — the worker read the still through
the caller's own tenant — but the refusal was.

**Fixed, not driven.** The lookup is scoped to the caller's organization, which is where the worker
reads the still from, so another organization's id is answered exactly like an unknown one
(`assertStillAvailable`, `packages/host/src/edit/start-generate.ts:88-101`, the `WHERE` at `:95`).

Tests: `packages/host/src/edit/still-scope.test.ts` (2).

Gate: **blocks Tencent deploy.**

### SR-74 {#sr-74}

**The Personal release published its notes without the banned-marks check, and its `docs/internal`
guard was case-sensitive.** Personal. Raised and fixed 2026-09-23.

Evidence, as the flag was raised: `apps/desktop/scripts/release-desktop.mjs` checked a `--notes` path
with `join(flags.notes).includes(join("docs", "internal"))`. That is case-sensitive, so
`Docs\Internal\x.md`, which opens the same file on Windows and on a default macOS volume, passed; and
the default `docs/public/<version>-notes.md` was never read for AI or agent marks at all.
`scripts/release-web.mjs` had that check for the Enterprise repo; the Personal repo had none.
AGENTS.md ("Three repos") requires both public repos to carry no AI or agent marks and no
`docs/internal` notes.

What goes wrong if ignored: an internal changelog, or a line naming the tooling, is published on
`Kyoo032/DPSBuddy`'s release page.

**Fixed, not driven.** Both release scripts share one refusal list and matcher, `scripts/release-marks.mjs`
(`FORBIDDEN_MARKS`, `:13`; `forbiddenMarksIn`, `:16`; `isInternalDocsPath`, `:28`, which resolves the
path and compares it in any letter case and with either separator). `release-desktop.mjs` checks every
notes file against it, `--notes` or the default, refuses one reached through a link that lands in
`docs/internal`, and hands `gh` the absolute path of the file it checked (`checkedNotesFile`,
`apps/desktop/scripts/release-desktop.mjs:200-209`). The check runs before anything is hashed or
staged (`:276`, `:309`). `release-web.mjs` re-exports the shared list, so its API is unchanged
(`scripts/release-web.mjs:47-51`).

Tests: `scripts/release-web.test.mjs` "both release scripts share one refusal list", "a docs/internal
path is caught in any letter case, with either separator, and through ..", "the desktop release
refuses notes that carry a mark, and names the marks", "the desktop release refuses notes under
docs/internal in any letter case", "the desktop release hands gh the checked notes file by its
absolute path".

Gate: **blocks the next Personal cut.** A `--dry-run` against the real notes file is the drive.

### SR-78 {#sr-78}

**A failed "Start over" removal logged the absolute path of the file, the key file included.**
Personal (webdev runs the same boot step). Raised and fixed 2026-09-23.

Evidence, as the flag was raised: `removeEntry` logged `error.message` for a removal that failed, and
Node puts the absolute path in that message (`EBUSY: resource busy or locked, unlink '…'`). The
entries include `.master-key` and `settings.enc`, and the path names the person's home folder.

What goes wrong if ignored: a support log pasted into a ticket carries a user name and the location
of the wrap key.

**Fixed, not driven.** A failed entry is logged by its relative name and its error code only
(`errorCode`, `packages/db/src/reset.ts:153`; the line at `:201`), and the boot summary is counts only
(`resetOutcomeSummary`, `:345`, logged from `packages/db/src/client.ts:40-45`). **Still true:** the
branch that removes a database kept outside the data dir logs `error.message`, so that database's
absolute path, when inspecting or removing it fails (`:245-246`, `:260-261`). That path is a
database file's, not a key file's.

Tests: `packages/db/src/reset-retry.test.ts` "says which entry it could not remove, and why, without
the path of the file"; "resetOutcomeSummary".

Gate: **blocks the next Personal cut.**

## Info and checked-not-an-issue

### SR-08 {#sr-08}

**The portal token vault is process memory only.** Recorded as a trade-off, not a flag.

Evidence: `packages/host/src/auth/index.ts:150-153` returns `createMemoryTokenVault()`, described at
`:3` and `:150` as process memory until the server gets an envelope.

The trade: no portal access or refresh token is ever at rest on the server, so a stolen disk image
and a leaked backup carry none. The cost is that a restart signs every user out, including a deploy,
a crash and a container reschedule. Session rows survive in `auth_sessions`
(`packages/host/src/auth/index.ts:108-134` sweeps the expired ones), so the user signs in again
rather than losing anything.

Required action: none. Revisit when the hosted app gets a second process, because two processes
cannot share a memory vault and the first fix somebody reaches for will be writing tokens to disk.

**Superseded 2026-09-23 by [SR-64](#sr-64).** The first half of the trade no longer holds: by owner
decision the refresh token is now also kept at rest, sealed on its `auth_sessions` row, so a restart
signs nobody out. The access token is still process memory only; `hostTokenVault`
(`packages/host/src/auth/index.ts:189`) is now this process's working copy, and the line numbers
above describe the file before that change. The second-process warning still stands, and is now
[SR-66](#sr-66).

### SR-15 {#sr-15}

**Music relay: checked, not a key-exfiltration issue. It does send a spoofed browser
`User-Agent`.**

Evidence: `packages/core/src/tools/platform/gateway-audio.ts:99-105` sends `Authorization: Bearer
<gateway key>` together with `User-Agent: Mozilla/5.0 … Chrome/120.0 Safari/537.36` (`:27-28`). The
destination is derived by `gatewayOriginFromBaseUrl` (`packages/core/src/gateway.ts:76-93`), which
calls `assertAllowedEndpointUrl` on the trimmed base URL at `:78` and then strips the `/v1` suffix
and any query or fragment. No part of the origin comes from a request, a model id, or a response
body, so there is no host a caller can steer the key to. `RELAY_ONLY_MUSIC_MODEL_IDS`
(`packages/core/src/models/media-kind.ts:34`) is a frozen one-element list, which is why
`suno_music` is offered whatever the gateway catalog says.

Recorded rather than dismissed for two reasons. The spoofed `User-Agent` is a deliberate
misrepresentation to a third party's relay, and whoever answers for that should know it is in the
code. And the wire has never been driven: `:11-15` says the relay path was written from the catalog
docs and the first live run belongs on the owner's desk.

Required action: none for security. Drive the relay once against the live gateway before Music
counts as working.

### SR-18 {#sr-18}

**`X-Forwarded-Proto` and `X-Forwarded-For` trust: checked, sound as deployed today.**

Evidence: `rejectPlaintext` (`packages/host/src/http-adapter.ts:388-390`) believes the header, and
`clientIp` (`packages/host/src/rate-limit.ts:136`) keys the per-IP bucket on the last hop of
`X-Forwarded-For`. Both are safe only if nothing but the proxy can reach the app. Three things make
that true, and all three were checked:

- `resolveBindHost` (`apps/web/lib/bind-host.ts:15-25`) returns `127.0.0.1` unless `BIND_HOST` is
  set, and `webapp-deploy/compose.yml` never sets it.
- Caddy runs in the app's own network namespace (`compose.yml:117`, `network_mode: "service:app"`),
  so `127.0.0.1:3000` is the app and nothing is published on a bridge.
- `webapp-deploy/Caddyfile:90-116` records why the last hop is the right one, and that a CDN or load
  balancer in front would need `trusted_proxies` declared here and the app's last-hop rule revisited
  at the same time.

One carve-out, deliberate and bounded: `GET /healthz` answers a plaintext loopback hit
(`http-adapter.ts:404-408`) so a container probe never has to stamp the proxy's header on itself.
Everything else in `transportRejection` still runs over it.

Required action: none now. Re-open this row the day anything is put in front of Caddy.

### SR-35 {#sr-35}

**`?preview=<code>` renders a blocked screen on `/pricing`: checked, not an issue.**

Evidence: `previewCode` (`apps/web/components/pricing-page.tsx:34-40`) returns `null` unless its
`local` argument is true, and the one call site passes
`!capabilities.plans && capabilities.singleOwner` (`:236`), with the comment at `:235` saying that an
unanswered ping therefore **refuses** the preview rather than opening it. So the door exists only on a
build that has told the renderer plans are not enforced and there is a single owner — a desk. On the
hosted deployment `capabilities.plans` is true and the parameter does nothing.

It also shows a screen, not a state: `PlanBlockedScreen` renders copy and a link. It grants nothing,
changes no entitlement and reaches no route.

Required action: none. If `capabilities` ever gains a path where `plans` is false on a hosted build,
re-read this row — that is the only thing holding the door shut.

### SR-36 {#sr-36}

**`device_code.requested` is not audited on a build that sends no `tenant_hint`.** Recorded, because
a gap in an audit log is worth knowing about even when it is structural.

Evidence: `apps/portal/src/flows/device.ts:107-120`. `audit_log.tenant_id` is NOT NULL (0003), so a
device code minted with no `tenant_hint` has no tenant to write the row under, and the `append` is
guarded by `if (tenantId)`. The comment says the rest: branded builds — every shipped installer —
always carry a hint and always audit. Every **later** event in the flow (approve, deny, poll failure,
token) happens after a user is known and is audited unconditionally.

What goes wrong if ignored: an unbranded or hand-built client can start device codes that leave no
trace of having been requested. The rate limits still apply (five per ten minutes per install,
thirty per ten minutes per IP), and nothing can be *approved* without a tenant, so this is a missing
line rather than an open door.

Required action: none while every shipped build sends a hint. If an unbranded build ever ships, the
fix is a nullable-tenant audit shape, which is a migration on the backend team's table and therefore
theirs.

### SR-37 {#sr-37}

**`GET /api/v1/auth/session` is registered off server mode, unlike its four siblings: checked, not an
issue.**

Evidence: all five auth routes are in the same unconditional block of the route table
(`packages/host/src/router.ts:244-248`). `handleStart` opens with
`if (!deps.serverMode) throw new ApiError("not_found", …, 404)` (`packages/host/src/auth/routes.ts:329-331`),
and the comment at `:324-328` gives the reason — a desk has no portal, no client credentials and no
public origin, and should not learn the route exists elsewhere. `handleSession` (`:428-435`) has no
such guard: on webdev and on the packaged desktop it answers `200 {"signedIn": false}`.

Why that is the right answer rather than an oversight: the renderer's boot order asks this route
first on **every** build, and on a desk the honest answer is "nobody is signed in", which is what
`bootView` needs to resolve to `"app"` and let the settings fetch proceed. A 404 there would make the
desk's boot branch on a failure. It leaks nothing: no session id, no reason, no tenant — the reason
field is only added when a cookie was actually presented (`:434`).

Required action: none. Recorded so the asymmetry reads as a decision next time somebody greps for
`serverMode` in this file.

### SR-38 {#sr-38}

**Host and portal reason vocabularies differ in two places: checked, both deliberate.**

Evidence: `PORTAL_REASONS` (`apps/portal/src/flows/reasons.ts:22-39`) has 17 entries;
`HOST_AUTH_REASONS` (`:49-61`) has 11, copied by hand because the portal imports nothing from the
product.

- **Two are the host's own and the portal never sends them.** `session_required` and
  `portal_unavailable` (`:45-47`). The first is the host's session gate refusing a request; the
  second is the host saying it could not reach the portal at all. Neither is a thing a portal
  response can carry, by definition.
- **Six are the portal's own and are flattened before the host sees them.** `device_code_expired`,
  `device_code_denied`, `authorization_pending`, `slow_down`, `invalid_client` and `rate_limited`
  belong to the device flow and the transport. `tokenErrorBody` (`:138-145`) converts anything
  outside `HOST_AUTH_REASONS` to `invalid_grant` **in one place**, rather than letting
  `mapPortalError` (`packages/host/src/auth/portal-client.ts`) rewrite it silently and lose the
  distinction the client branches on.

Both directions are stated in the file's own header (`:12-17`) and enforced rather than trusted:
`tokenErrorBody` is what `/auth/token` and `/auth/logout` — the only two endpoints the host calls —
must go through.

Required action: none. If a reason is ever added to `AUTH_REASONS` in
`packages/host/src/auth/session.ts`, add it to `HOST_AUTH_REASONS` in the same change; the copy is
deliberate and nothing enforces it across the two packages.

## Must be true before the Tencent Cloud deploy

Each line names the row that owns it. A line that cannot be ticked is a reason not to hand out the
URL, not a reason to write a follow-up.

- [x] `Permissions-Policy` allows `microphone=(self)` and `display-capture=(self)` in **both**
  `packages/host/src/security-headers.ts` and `webapp-deploy/Caddyfile`, and
  `security-headers.test.ts` is green. ([SR-14](#sr-14)) — 2026-09-21. This line is about the code
  and its test, both of which are now true. The browser has still never been sent either header;
  that is the drive SR-14 is waiting on before it reads `fixed`.
- [x] The server refuses to listen in hosted mode when `AGENTFORGE_SECRETS_KEY` or
  `AGENTFORGE_PORTAL_URL` is missing or unusable, and says which one by name. ([SR-04](#sr-04)) —
  2026-09-21, and it also names `AGENTFORGE_TRUSTED_ORIGINS`, both portal client credentials and,
  on production, the billing secret, in one aggregated message. Proven by running the real
  entrypoint, not only by the suite; not yet proven in the container.
- [x] A person signs in through a **real browser** — e-mail, six-digit code, submit, land on the app
  signed in with no code left in the address bar — and the console is empty on both origins.
  ([SR-20](#sr-20)) — 2026-09-21, Chromium, on the review instance behind the two tunnels. Re-tick
  this on the deploy itself: it is the only line that catches a header no curl drive enforces.
- [ ] A signed-out visitor to the deployed URL sees a sign-in screen, not the paste-your-key
  onboarding. ([SR-06](#sr-06))
- [ ] The SSRF suites, the wrap-key rotation suite and the component CLI suite run green somewhere:
  on a runner, or on a machine where the DNS timeout and the tsx shim are fixed. ([SR-12](#sr-12))
- [ ] `POST /api/v1/billing/webhook` is either unreachable from the internet or checks a provider
  signature. The shared secret has an owner and a rotation date. ([SR-03](#sr-03))
- [ ] `PORTAL_ALLOW_MANUAL_OTP` is unset on the deploy and `NODE_ENV=production` is set, so both
  manual-OTP guards hold. ([SR-10](#sr-10))
- [ ] `AGENTFORGE_BILLING_WEBHOOK_SECRET` and `AGENTFORGE_BILLING_TOPUP_URL` are in the operator's
  `.env` template. ([SR-09](#sr-09))
- [ ] No review-harness script, and no `apps/portal/compose.yml` password, is anywhere near the
  deploy. ([SR-11](#sr-11), [SR-01](#sr-01))
- [ ] Signing out of the app also ends the portal's browser session, so the next person on that
  browser gets the sign-in form and not the previous person's account. ([SR-21](#sr-21))
- [ ] Nothing has been put in front of Caddy without declaring `trusted_proxies` and re-reading the
  last-hop rule. ([SR-18](#sr-18))
- [ ] The two Cloudflare quick tunnels are down, both hostnames 404, and the review instance is back
  on loopback. ([SR-28](#sr-28))
- [ ] The hosted process refuses a bad environment **before** it opens SQLite, creates the data dir
  or applies a queued reset. ([SR-25](#sr-25))
- [x] `AGENTFORGE_PORTAL_URL` is https, or the owner has recorded that same-host loopback is the
  intended production topology. ([SR-26](#sr-26)) — 2026-09-23: the owner chose https, and a
  production boot now refuses plain http, loopback included. Not driven on a container.
- [x] An Edit import that fails after the probe refunds the bytes and leaves no orphan object.
  ([SR-27](#sr-27)) — fixed 2026-09-21, tested, **not driven on a deployment**.
- [ ] A recording that fails to upload is still on the owner's screen, with Retry and Save to
  device, rather than gone. ([SR-45](#sr-45)) — fixed and tested; never driven in a browser.
- [ ] The three portal login variables, the wrap key and one https trusted origin are set before the
  hosted server is restarted on this code, or it will not start. ([SR-46](#sr-46))
- [ ] A tenant with no plan row reads "no plan yet" on Settings and sees no "This is your plan"
  badge on `/pricing`. ([SR-47](#sr-47))
- [ ] A failed ffmpeg run returns no absolute path and no argv to the client, on the deployment.
  ([SR-48](#sr-48))
- [ ] Personal's seat copy and its `seatCap` agree, either way. ([SR-22](#sr-22))
- [ ] The runbook says that rotating `PORTAL_SIGNING_KEY` signs every user out, because `jwks_keys`
  is not wired. ([SR-24](#sr-24))
- [ ] `PORTAL_TRUST_PROXY` and `PORTAL_PUBLIC_URL` are validated at boot like every other portal
  variable. ([SR-33](#sr-33))
- [x] `AGENTFORGE_BILLING_TOPUP_URL` is scheme-checked before it reaches a browser
  ([SR-31](#sr-31)) — fixed 2026-09-21 with `topUpUrl` rather than `assertAllowedEndpointUrl`; the
  reasoning is in that row. Not driven on a deployment.
- [ ] The portal runs as exactly one process, or its rate-limit windows are shared.
  ([SR-29](#sr-29))

Added 2026-09-23:

- [ ] The portal migrates on `PORTAL_MIGRATE_DATABASE_URL`, serves as `portal_app_login` with a
  password provisioned out of band, and boots in production without refusing its own role.
  ([SR-56](#sr-56))
- [ ] A request with `Host: a b`, and one with the target `//x:99999/healthz`, leave the portal and
  the app both up. The app answers each `400`; the portal answers the target `400` and never reads
  `Host`. ([SR-50](#sr-50), [SR-63](#sr-63))
- [ ] A session the portal revokes is refused by the app within ten minutes, and a portal outage signs
  nobody out. ([SR-58](#sr-58))
- [ ] Signing out ends the portal session too, even after the access token has aged past its hour.
  ([SR-59](#sr-59))
- [ ] The deploy note says every hosted user signs in once more when migration 0021 lands.
  ([SR-60](#sr-60))
- [ ] A host restart with a signed-in session keeps that person signed in, and the wrap-key rotation
  drill carries the sealed refresh tokens across. ([SR-64](#sr-64))
- [ ] The owner has decided whether Erase account ends the tenant's sessions and stored refresh
  tokens. ([SR-65](#sr-65))
- [ ] The app runs as exactly one host process, or the portal refresh is one-at-a-time across
  processes. ([SR-66](#sr-66))
- [ ] Caddy's default logger carries no `code` or `state`: a global `log default` filter, checked on a
  real Caddy with a forced upstream error. ([SR-72](#sr-72))
- [ ] `docker compose exec proxy env` shows `DPSBUDDY_DOMAIN` and none of the app's secrets.
  ([SR-73](#sr-73))
- [ ] The old machine-wide `<dataDir>/edit/metrics.jsonl` is gone from every box that ran hosted Edit
  before 2026-09-23. ([SR-69](#sr-69))
- [ ] Per-IP limits group IPv6 by /64, or the deployment is IPv4-only and the runbook says so.
  ([SR-79](#sr-79))
- [ ] The owner has answered the per-address OTP lockout trade-off. ([SR-53](#sr-53))

### SR-49 {#sr-49}

**The hosted image carries the whole source tree, and a build from a working checkout also carries
whatever untracked state sits in it.** Raised 2026-09-23 while turning `Kyoo032/DPSBuddy-Ent` into
the Enterprise deploy-bundle repo.

Evidence, two halves:

1. **Source in the runtime image, by design.** The build stage runs `COPY . .`
   (`webapp-deploy/Dockerfile:53`) and the runtime stage copies that tree wholesale,
   `COPY --from=build --chown=node:node /app /app` (`:103`), because every `@agentforge/*` package
   exports TypeScript and the entrypoint is `tsx server.ts` (`:8-12`, `:100-102`, `:153`). So the
   final image holds every `.ts` file in `apps/` and `packages/`, `apps/portal`, the desktop shell
   sources, `scripts/`, `packages/host/eval/`, the root `AGENTS.md` and `README.md`, and dev
   dependencies. `docs/` is excluded (`webapp-deploy/Dockerfile.dockerignore:44`), so
   `docs/internal/` does not ship.
2. **Untracked local state in the build context.** The ignore file's `.env`, `.env.local` and `data`
   (`Dockerfile.dockerignore:23-25`) match at the context root only. On this desk on 2026-09-23 a
   `docker build -f webapp-deploy/Dockerfile .` from the main checkout would have copied
   `.webdev-data-design/` (holding `.master-key`, `settings.enc` and `agentforge.sqlite`),
   `apps/web/.env.local` (holding values for `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` and
   `BETTER_AUTH_SECRET`; checked by name only), and `packages/host/eval/finance/results/` into the
   image. All three are git-ignored (`.gitignore:69`, `.gitignore:6`), which is why nobody sees them
   in `git status`.

What goes wrong if ignored: half 2 puts a wrap key and live provider keys into an image layer that is
then pushed to a registry. Anyone who can pull the image can read them with `docker save`. Half 1
means that a public image publishes the source that `Kyoo032/DPSBuddy-Ent` is meant never to hold.

Status: **mitigated for the release path, open for the Dockerfile.**
- Half 2 closed on 2026-09-23 in `webapp-deploy/Dockerfile.dockerignore:22-33`: the secret
  patterns are now `**/.env`, `**/.env.*` (keeping `.env.example`), `**/data`, `.webdev-data*`,
  `**/*.enc`, `**/.master-key`, `**/*.sqlite*`. The "byte-for-byte twin" the header used to name
  never existed; there is no root `.dockerignore`. The archive-from-sha path below is still the
  primary guard.
- `scripts/release-web.mjs` never builds from the working tree. It runs `git archive <sha>` into a
  temp dir under `%TEMP%`, runs `docker build` there, and deletes the dir, so only tracked files at
  the released sha can enter the context. `scripts/release-web.test.mjs` pins that the archive is of
  `<sha>` and that docker runs in the extracted context and never in the repo root.
- `webapp-deploy/scripts/deploy.sh` still builds on the server from a `git pull` checkout
  (`deploy.sh:84-95`). That checkout has no webdev data, so the exposure there is lower, but the rule
  is the same.
- The image `ghcr.io/kyoo032/dpsbuddy-ent` must stay **private** on ghcr until half 1 is fixed. The
  server pulls it with a token that can only read packages.
- 2026-09-23, later the same day: eval output is excluded from the build context as well,
  `packages/host/eval/**/results` (`webapp-deploy/Dockerfile.dockerignore:34-37`).
- **Open, 2026-09-23: `webapp-deploy/.dockerignore` is stale.** Its header still calls
  `Dockerfile.dockerignore` "a byte-for-byte copy of this one" (`webapp-deploy/.dockerignore:6-7`),
  and it has none of this row's patterns: `.env`, `.env.local` and `data` still match at the context
  root only (`:22-25`), and there is no eval line. The documented build
  (`-f webapp-deploy/Dockerfile` from the repo root) reads `Dockerfile.dockerignore`, so today the
  stale file is dead; but `webapp-deploy/README.md:28-29` and `:46-49` still tell the next editor the
  two are identical and must be edited together, and so does the "Fix" list below. Delete it, or make
  it the copy it claims to be.

Fix, not done here (the Dockerfile was deliberately left alone in this pass):
- Anchor the ignore patterns everywhere: `**/.env`, `**/.env.*` with `!**/.env.example`,
  `.webdev-data*`, `**/data/`, `packages/host/eval/**/results`. Edit `.dockerignore` and
  `Dockerfile.dockerignore` together; they must stay byte-identical.
- Make the runtime stage copy only `apps/web/dist`, a built host bundle, `packages/db/drizzle`, and
  the production `node_modules` its native modules need (`better-sqlite3`, `@firecrawl/anydoc`),
  the way `apps/desktop/scripts/stage-renderer.mjs:23-31` already esbuilds `host.cjs` for the
  desktop. That drops the TypeScript source, `tsx` and the dev dependencies together, and closes the
  migration-plan item behind "Dev dependencies ship in the image" in `webapp-deploy/README.md`.

Gate: half 2 **blocks building any image from a developer checkout**. Half 1 **blocks making the
ghcr image public**. Neither blocks a private-image deploy through `release-web.mjs`.
