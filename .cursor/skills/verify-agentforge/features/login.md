# Login (hosted sign-in)

The **only** door into a hosted deployment, and it exists nowhere else: webdev and the packaged desktop have no portal, so on those builds every testid below has count 0 and that is the pass. There is no password field and there never will be — one button hands the browser to the portal, the portal emails a six-digit code, and the browser comes back to `/auth/callback` with an authorization code the **host** exchanges server-side. Full mechanism: [`maps/portal-session-auth.md`](../../../../docs/internal/maps/portal-session-auth.md) for the host's half, [`maps/portal-service.md`](../../../../docs/internal/maps/portal-service.md) for the portal's. Plan of record: [`web-phase9-portal-login.md`](../../../../docs/internal/web-phase9-portal-login.md).

## Sub-features

- **login-screen** — `/sign-in` renders `auth-signin`: a title, "No password — we email you a code.", and the one button `auth-signin-start`. A hosted visitor with no session sees this **in place** of whatever they asked for, without the address bar changing, so `/meeting` and `/settings` render it too.
- **login-reason** — `auth-reason` appears only when the URL carries `?reason=<code>`. The code selects a key from a fixed list (`apps/web/lib/auth-reason.ts`); anything unrecognised gets the generic sentence. A visitor's own string is **never** rendered.
- **login-start** — pressing `auth-signin-start` calls `GET /api/v1/auth/start`, which mints the login `state`, sets `__Host-agentforge_login_state` (HttpOnly, SameSite=Lax, 10 min) and returns `{ authorizeUrl }`. The renderer refuses to navigate to anything that is not an absolute `http(s)` URL, so a `javascript:` body cannot reach `location.assign`.
- **login-portal** — the portal's own three screens: the e-mail form, the six-digit code form, and the error page. Reached by top-level navigation, not by `fetch`.
- **login-callback** — `/auth/callback` renders `auth-callback` ("Finishing sign-in…") while it posts `{ code, state }` to `POST /api/v1/auth/login`. The code is stripped from the address bar **before** the exchange, the exchange runs exactly once per page load, and success is a **full page load** to `/chat`.
- **login-account** — `auth-account` on Settings: user, organisation, account and session expiry, with `auth-signout`.
- **login-signout** — `auth-signout` calls `POST /api/v1/auth/logout`, which revokes the refresh chain and the `sessions` row and clears the cookie.
- **login-seat-cap** — a `seat_cap_reached` refusal lands back on the sign-in screen with that reason, because the person is signed out by definition. The pricing page ([plans.md](./plans.md)) is where the reason's link sends them.

## How to get to it (user POV)

- On a hosted deployment, everywhere. A signed-out visitor who opens any route gets the sign-in screen; there is nothing else to press.
- `/sign-in` directly. On a **non**-hosted build that route redirects to `/chat`, and so does `/auth/callback` — both are mounted only where a sign-in can be completed.
- After signing in: Rail → Settings, below the gateway key block, is `auth-account`.

## Driving it with the DPSBuddy harness

**Preconditions, and none of them is optional.**

- This needs the **review instance**, not `:3000`. Webdev is not in server mode and has no portal. Start it from the repo root: `powershell -NoProfile -File scripts\review-instance.ps1 -Start -Production`. Default (no `-Start`) prints what it would launch and exits 0 — read that first.
- Doctor the instance you started, with `--base https://localhost:3443`. Never drive an instance this run did not doctor.
- The portal needs a seeded tenant and an OAuth client. `pnpm --filter @agentforge/portal migrate`, then `pnpm --filter @agentforge/portal seed -- --email <you> --tenant dpsbuddy --org Kyo --seat-cap 2 --redirect https://localhost:3443/auth/callback`. **The client secret prints once.** Paste it into `$HOME\.dpsbuddy-review\review.env` as `AGENTFORGE_PORTAL_CLIENT_SECRET`.
- Use a **real browser**, not `fetch` and not curl. See the first gotcha; this is the whole point of the recipe.
- Never point any of this at `:3000`, and never at `.webdev-data`. The script refuses a data dir inside the checkout, but the rule is yours to keep too.

**The walk.**

1. `goto https://localhost:3443/chat`, accept the self-signed warning once. Settle. `auth-signin` is visible and `auth-signin-start` has count 1. Neither `chat-composer` nor `onboarding-form` is on screen — if `onboarding-form` is, that is [SR-06](../../../../docs/internal/security-register.md#sr-06) and a fail.
2. **Open the browser console and leave it open.** Zero messages on either origin is part of the pass.
3. Click `auth-signin-start`. The address bar leaves your origin for the portal's. The e-mail form renders.
4. Type the seeded address, submit. The six-digit code form renders. **Submitting this form is the step that catches CSP** — if the button does nothing and the console says `form-action`, read [SR-20](../../../../docs/internal/security-register.md#sr-20).
5. Read the code from **Mailpit** at `http://127.0.0.1:8025`. Or mint one: `PORTAL_ALLOW_MANUAL_OTP=1 pnpm --filter @agentforge/portal otp -- <email>` — that **issues** a fresh code (only the sha256 is stored, so nothing can read one back), prints it once, and writes `otp.issued_manually` to the audit log.
6. Enter the code, submit. The browser goes `302` → `https://localhost:3443/auth/callback?code=…&state=…` → `auth-callback` flashes → `/chat`, signed in. **Check the address bar: no `code`, no `state`.** Check the console: still empty.
7. Rail → Settings. `auth-account` is visible and carries the user, the organisation, the account and the expiry. No token appears anywhere in the payload or the DOM — `GET /api/v1/auth/session` returns ids and labels only.
8. **Mutation after sign-in.** Save anything on Settings, or create a workspace. A 403 here means the session-bound CSRF token was not re-minted, which is [SR-07](../../../../docs/internal/security-register.md#sr-07) and means the full page reload was skipped.
9. Click `auth-signout`. `GET /api/v1/auth/session` answers `{"signedIn":false}` and `/chat` renders `auth-signin` again.
10. **The negatives**, each on its own: `goto /auth/callback?error=seat_cap_reached&state=x` lands on `/sign-in?reason=seat_cap_reached` with `auth-reason` reading "No seats left in your organisation."; `goto /sign-in?reason=<a string of your own>` renders the **generic** sentence, never your string; `POST /api/v1/auth/login` with a `state` that does not match the cookie answers `invalid_request`.
11. Evidence under `evidence/login/<run-id>/`: screenshots of the sign-in screen, the portal's two forms, the signed-in `/chat`, and `auth-account`; the doctor JSON; and a note that the console was empty on both origins.

**Automated proof already in the repo.** `apps/web/lib/auth-boot.test.tsx` (17, the boot order), `session.test.tsx` (22), `auth-callback.test.tsx` (15), `sign-in-screen.test.tsx` (15), `auth-reason.test.ts` (10), `auth-locales.test.ts` (5), `session-signal.test.ts` (7), `account-session-row.test.tsx` (9); host `src/auth/` including `login-state.test.ts` and `portal-config.test.ts`; portal `src/routes/browser.test.ts` (22) and `src/routes/api.test.ts` (23). All green on 2026-09-21. **None of them is a substitute for step 4.**

## Gotchas

- **CSP is only enforced by a real browser, so a curl drive proves nothing about it.** This is not a style preference. `form-action 'self'` blocked the OAuth redirect for every human while `routes/browser.test.ts` walked the same three hops green, because a non-browser client does not implement CSP at all. `__Host-` cookie acceptance, `SameSite` and mixed-content blocking are in the same class. If you did not press the button in Chromium, you did not test the login.
- **The portal's browser session is 30 days and there is no way out of it.** After one successful sign-in, pressing **Sign in** again goes straight through — no address, no code, no mail — because `getAuthorize` completes the sign-in when the cookie carries a live session for that tenant. Signing out of the *app* does not touch it. So **the second run of this recipe on the same browser profile does not test the OTP step.** Use a fresh profile, a private window, or a second origin with its own cookie jar. That is [SR-21](../../../../docs/internal/security-register.md#sr-21), and it is open.
- **A hosted desk still needs a gateway key.** Signing in gets you past the door; it does not give the tenant a working gateway. After sign-in, a desk with no key lands on the paste-your-key onboarding screen — and *that* is correct, because the person is now signed in. Do not record it as a login failure. See [gateway-gate.md](./gateway-gate.md).
- **A deep link does not survive sign-in.** The `redirect_uri` is fixed at `/auth/callback` and carries no return path, so the round trip always lands on `/chat` however you arrived. Known, recorded as an owner decision in [`worklog-2026-09-21.md`](../../../../docs/internal/worklog-2026-09-21.md) §6 — not a harness miss.
- **`/auth/callback` runs its exchange once per page load, guarded at module scope** rather than in a ref, because StrictMode remounts a component and a module is not re-created. A reload of that URL after a successful sign-in is therefore a *failed* exchange (the code is spent), which lands on `/sign-in?reason=invalid_grant`. Expected.
- **Everything here is 404 or a redirect off server mode.** `GET /api/v1/auth/start` answers 404 on webdev, and `/sign-in` and `/auth/callback` redirect to `/chat`. `GET /api/v1/auth/session` is the one exception — it answers `200 {"signedIn":false}` on every build, deliberately, because the renderer's boot asks it everywhere ([SR-37](../../../../docs/internal/security-register.md#sr-37)).
- **The tunnels are ephemeral.** If you are driving through a `trycloudflare.com` hostname, it dies with `cloudflared` and the next one is a different name — which has to be re-seeded as a `--redirect` and re-passed as `-AppPublicUrl` / `-PortalPublicUrl`. Close them when the review is done ([SR-28](../../../../docs/internal/security-register.md#sr-28)).
- **G1 applies twice over.** The portal's two forms are real `<form>` submits and so is the sign-in button's navigation. Settle after every `goto` before pressing, or the browser does a native submit and you lose the state cookie.
