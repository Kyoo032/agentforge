# DPSBuddy

A **local** Toko Token client at `https://api.tokotokenai.com/v1`. The person who installs it owns it. You paste a **gateway API key** (or, once the portal ships, sign in with a device code), keep **workspaces** on disk, and work in Chat plus job modes (Documents, Research, Market, Images, Videos, Presentation, Data, Finance, Legal, Edit). Custom-agent Build is parked — not the product identity. Hermes remains the tinkering surface for people who want to build agents.

**Status: closed beta** (not prototype). Public entry point: [`README.md`](README.md).

This file is the project source of truth for coding agents. Vault memory at `C:\Users\rizky\Documents\Obsidian` is for Kyo, not for this repo’s domain rules.

**Harness, not product.** Three agent guardrails live beside this file and never ship inside DPSBuddy: the verify skill [`.cursor/skills/verify-agentforge`](.cursor/skills/verify-agentforge/SKILL.md), the pack skill [`.cursor/skills/pack-dpsbuddy`](.cursor/skills/pack-dpsbuddy/SKILL.md), and the Cursor **pstack** plugin (`how` / `why` mapper, `create-verification-skill` / `maintain-verification-skill` verifier). Project skills call the original pstack skills; nobody vendors pstack into `apps/`, `packages/`, the installer, or the UI. Rules and model routing are in **Harness** below.

Product modes: see [`docs/product-modes.md`](docs/product-modes.md). The left rail follows **workspace** `productModes`. Default has every work tab. Packs are workspace presets, not a custom-agent builder.

## Next step: harness pass (verify skill, mapper, repack) before 0.14.26

**Landed 2026-09-15.** Deliverable 1 is done — the verify skill is maintained (`features/locale.md` and `features/gateway-gate.md` added, 15 dead one-off scripts removed, `doctor --base`, live pass driven on webdev) — and so is deliverable 2, eight map pages under [`docs/internal/maps/`](docs/internal/maps/README.md). Deliverable 3 was exercised for real rather than rehearsed: 0.14.26 was packed twice (Windows worktree + mac Docker, one supersession) and the traps are in [`.cursor/skills/pack-dpsbuddy/traps.md`](.cursor/skills/pack-dpsbuddy/traps.md). Still owed: a packaged-app drive from the verify skill (a `DPSBuddy.exe` was running during the pass, so the live pass stayed on webdev), the Legal recipe, which has still never been driven, and the mac hardware smoke.

Kyo’s order (2026-09-15): bring the harness up to the tree first, then build 0.14.26. Three deliverables, each its own PR, each proven by driving, none touching product code.

### 1. Verify skill — run pstack `/maintain-verification-skill` on `verify-agentforge`

The skill was last touched on 2026-09-14, before the locale PRs and the renderer gate landed, so the honest outcome is `changed`, not `clean`. Known rot to fix under that skill’s edit scope:

- `scripts/` holds 15 one-off `drive-*`, `loop-*`, `poll-*`, `probe-*`, `reverify-*` files next to `doctor.mjs`, while **Helpers** says doctor is the only helper. Promote the ones a recipe still needs (executable, invocation documented in the skill body) and delete the rest. `desktop-app-url.mjs` stays; doctor imports it.
- No recipe for the locale switch. Add `features/locale.md` (four-H2 contract): Settings language select `settings-locale`, the restart banner `settings-locale-restart` and its apply button, then an `id` walk of the rail, Chat, and one job mode, plus the parity tests as the source check.
- No recipe for the gateway gate. Add `features/gateway-gate.md` for the states that exist now: `onboarding.gate.*` reasons, the Settings status row `settings-gateway-status` + `settings-gateway-recheck`, 7-day grace, and the `settings-reset` card (already in `features/settings.md`). The host gate and the `403 gateway_blocked` answer both landed on 2026-09-15, so every step is drivable on webdev with a throwaway data dir.
- `features/README.md` still says Edit rail `mode-edit` “lands in Phase 1; Loop 0 only ships the map” — Edit shipped in 0.14.22. Reconcile. Keep “No product login” true, and add that login, when it lands, is the device-code door and never a password.
- SKILL.md **Delegation** names Cursor models only. Add the Claude Code routing line from **Harness** below.
- The live pass is required: doctor, drive every feature once, evidence under `evidence/<feature>/<run-id>/`, teardown after the last drive. Product bugs it finds go to `docs/internal/unreleased.md` as findings, never into the skill PR.

### 2. Mapper — pstack `how` / `why`, recorded in-repo

pstack `how` and `why` print to the chat and write nothing to disk. The map for agentforge is therefore two things kept in git:

- **Where to press:** `.cursor/skills/verify-agentforge/features/<feature>.md` — user POV, testids, gotchas. Owned by the verify skill.
- **How it works:** `docs/internal/maps/<subsystem>.md` — the dated `how` output (user action → code path → where to fix) and, when a decision needs a record, the `why` findings with their sources and confidence. First page to write: Chat send, moving the 2026-09-06 `## how — Chat send (pstack)` block out of [`docs/internal/0.14-changelog.md`](docs/internal/0.14-changelog.md). Then, in this order: settings + gateway gate, locale boot and the run harness (`localeForRun` → `withOutputLanguage`), knowledge ingest loop, desktop pack routes.
- A feature file’s opening paragraph links its map page once one exists; a map page names the feature file that verifies it. `how` runs read-only. A map page that disagrees with the code is fixed the same day or deleted; a stale map is worse than none.

### 3. Repack skill — `pack-dpsbuddy` becomes the Windows + macOS repack route

Today’s skill packs once from HEAD. A repack (same version, after a fix) must be a documented route in that skill, not improvisation:

- **Same version, new artifact.** Remove the previous worktree first (`git worktree remove C:\Users\rizky\agentforge-pack-<v>`) or suffix the new one with the short sha; never rebuild inside the old tree. Move the superseded exe, blockmap and `latest.yml` to `apps/desktop/dist/superseded-<sha>/` before copying new ones in. `latest.yml` is regenerated by the build, never hand-edited.
- **Docker packs HEAD.** Commit the fix first. `--allow-dirty` never produces a shipped artifact.
- **Proof stays per OS.** Windows: launch `dist\win-unpacked\DPSBuddy.exe`, `doctor --desktop` from the main checkout, and the Windows smoke row after any shell change. macOS: `verify-bundle.py` on `.app` **and** dmg/zip per arch. Docker exit 0 is not mac proof; the hardware smoke (Gatekeeper, Keychain, Cmd+V, Cmd+Q, Dock reopen) is still owed, and mac stays labelled preview until it is driven.
- **Record every pack**, shipped or not: the artifact table in [`docs/internal/unreleased.md`](docs/internal/unreleased.md) (source sha, worktree, sha256, bytes, UTC) and a `## Pack + publish` block in the current changelog. `scripts/preflight.mjs` runs before either route; any trap that bites twice becomes a preflight check, not another paragraph in `traps.md`.
- **Release is separate.** `release-desktop.mjs --require-mac --dry-run`, then without `--dry-run`, only when Kyo says ship. A repack never implies a release.

## Harness (verify, map, pack)

- **Verify skill:** [`.cursor/skills/verify-agentforge/SKILL.md`](.cursor/skills/verify-agentforge/SKILL.md) — Launch / Doctor / Keys / Drive / Evidence / Cleanup / Helpers / Isolate. Read [`features/README.md`](.cursor/skills/verify-agentforge/features/README.md) before driving; each feature file is H1 + one paragraph + exactly four H2s (`Sub-features`, `How to get to it (user POV)`, `Driving it with the DPSBuddy harness`, `Gotchas`). `scripts/doctor.mjs` (no args = webdev on `:3000`; `--desktop` = packaged app via `host-status.json`) is the health check; never drive an instance this run did not doctor. Proof = action + named result + capture + doctor JSON (+ side effect for mutations) under `evidence/` (gitignored except its README). A green `tsc`, a worker summary, or a screenshot without an action record is not proof.
- **Pack skill:** [`.cursor/skills/pack-dpsbuddy/SKILL.md`](.cursor/skills/pack-dpsbuddy/SKILL.md), [`traps.md`](.cursor/skills/pack-dpsbuddy/traps.md), `scripts/preflight.mjs`. Two routes, never in the same cwd: Windows NSIS in an isolated worktree, macOS dmg/zip in Docker Linux from the main checkout. This PC only; Cloud aborts.
- **pstack** is the Cursor plugin (`~/.cursor/plugins/cache/cursor-public/pstack/…`, 0.15.2) plus the always-on rule `~/.cursor/rules/pstack-guardrails.mdc`. Project skills call `/how`, `/why`, `/create-verification-skill`, `/maintain-verification-skill`; they never copy them. `maintain-verification-skill` edits only `.cursor/skills/verify-agentforge/`; product bugs it finds are reported, not fixed in that PR. Its outcome is one of `clean` / `changed` / `blocked`, said plainly.
- **Model routing.** Cursor sessions: explore = Composer 2.5, worker = Grok 4.5, fan-out 2 (as the verify skill says). Claude Code sessions: explorers on Sonnet, implementation and review workers on Opus, and the orchestrator verifies every result itself before reporting. Neither adopts pstack’s own Fable/GPT Task slugs.
- **Changelog is the checklist.** Every product change appends to the current changelog; the pack step reads it back; the verify pass drives it. Harness-only changes (skills, `.vscode`, `biome.json`) are labelled “harness, never ship” and stay out of the installer.

## After the harness pass: 0.14.26 — host-side gateway gate, then portal login

Read this before any work on onboarding, Settings, `/api/v1/settings`, keys, or the desktop shell.

**Phase 0 (landed 2026-09-15 on this branch): the host owns the key gate.** Contract: [`packages/core/src/gateway/gate-types.ts`](packages/core/src/gateway/gate-types.ts) — `{ status, allowed, grace, endpoint, endpointLocked: true, checkedAt, lastOkAt, message? }`, `status` in `stub | needs_key | ok | invalid_key | unreachable | error`. Host: [`packages/host/src/gateway-gate.ts`](packages/host/src/gateway-gate.ts) derives the payload from `<dataDir>/gateway-gate.json` (verdict per key fingerprint, never the key), `settingsPayload()` carries it as `gateway`, saving a key runs one 3 s live `GET <endpoint>/models`, and `POST /api/v1/settings/gateway/check` re-validates. Renderer: [`apps/web/lib/gateway-gate.ts`](apps/web/lib/gateway-gate.ts) parses it, [`apps/web/src/App.tsx`](apps/web/src/App.tsx) calls `resolveGate(payload.gateway, isElectron())` and listens for `GATE_EVENT`. **Start over** (Settings card `settings-reset`): `POST /api/v1/settings/reset` with `scope: "key"` forgets the gateway key on every desk and drops to onboarding; `scope: "all"` + `confirm: "RESET"` queues `reset-pending.json`, which [`packages/db/src/reset.ts`](packages/db/src/reset.ts) applies on the next boot before SQLite opens (named entries only — the data dir is also Electron userData), then the shell relaunches over IPC `app:relaunch` and clears Chromium storage. Proven on webdev with a throwaway data dir on 2026-09-15 (live check, sign-out, wipe on reboot); packaged Windows drive still owed. Every gateway-calling handler (runs, jobs, finance, market, legal, knowledge, enhance, edit agent) calls `requireGatewayAllowed()` and answers a flat `403 { error: "gateway_blocked", status, message }` when `allowed` is false; settings, workspaces, threads, artifacts, media, usage and the model refresh stay open so a closed gate is always recoverable. A saved key with no verdict on disk opens under grace and the host re-checks in the background (throttled, 10 min); an `ok` verdict older than 24 h falls back to the 7-day grace. Owed: the packaged Windows drive of all of it. Rules that still hold:

- The host decides, the renderer displays. `allowed` is the only thing the renderer branches on; it never re-derives a decision from `hasOpenai` or key shape. Grace = the same key validated within 7 days (`lastOkAt`), so the app opens offline.
- Every route that calls the gateway checks the same gate and answers `403 gateway_blocked` when `allowed` is false. Stub runtime reports `status: "stub", allowed: true` so Cloud / Playwright keep working.
- `endpoint` is the pinned gateway URL (owner override from 0.14.21 still applies); `endpointLocked` is always `true` in the payload.
- The key validation call reuses the 3 s budget in [`packages/core/src/gateway/account.ts`](packages/core/src/gateway/account.ts) and never blocks first paint.

**The gate is advisory, and that is on purpose.** `allowed` is a UX signal — it decides what the desk shows and which local handlers answer `403 gateway_blocked`. It is not an entitlement check and must never be read as one. Every rule in it fails **open**: `deriveGatewayGate` opens the gate when `gateway-gate.json` is missing or unreadable (the upgrade case, and any desk whose data dir was rolled back), the background re-check swallows its own failures, a verdict that cannot be written costs a cached decision and nothing else, and the whole file is plain JSON in a directory the owner can edit, delete or replace. Anyone who wants past it can delete one file. That is the right trade for a local-first desk that has to keep working offline — and it is exactly why **the 20-seat entitlement, plan limits and any spend cap have to be enforced server-side, by the gateway and the licence service, against the bearer on the request.** The client is a thin display of a decision made elsewhere (see Phase 1 below); `gateway-gate.json` is a cache of the last answer, never the authority. If a limit can be defeated by editing a local file, it was never enforced.

**Phase 1 (next): device-code login against the Toko Token portal.** Design is locked in [`docs/internal/portal/device-code-login.md`](docs/internal/portal/device-code-login.md) (flow, endpoints, tokens, reason codes, client integration plan), [`docs/internal/portal/schema.md`](docs/internal/portal/schema.md) (control-plane Postgres, RLS, seat count, wallet) and [`docs/internal/portal/migrations/`](docs/internal/portal/migrations/README.md) (SQL 0001–0005). The portal side is the backend team’s; this repo builds the client side. Names in code match those docs. Client invariants:

- **Thin client.** The app holds no licence state and makes no entitlement decision. Seats, plan, spend, model allowlist are rows in the portal DB; the client only shows the reason code it was given.
- **BYO key stays the floor.** Pasting a raw gateway key keeps working exactly as today. Login is a second, additive door. Bearer choice happens in one place, `resolveProviderKeys` in [`packages/core/src/secrets.ts`](packages/core/src/secrets.ts): explicit workspace key (unless `allow_byo_key` is `false`) → live session access token → stub.
- **New machine-scoped `StoredSession`** in `packages/core/src/session.ts`, persisted to `<localDataDir()>/session.enc` by `packages/host/src/session-store.ts` using `encryptJson` / `decryptJson` from [`packages/core/src/crypto/envelope.ts`](packages/core/src/crypto/envelope.ts). Not new fields on `StoredSecrets` (that struct is per workspace and has a renderer-facing masked projection). No new keychain slot: `apps/desktop/main.cjs` does not change for login.
- **Tokens never reach the renderer and never cross IPC.** Access token lives in host memory only; a cold start refreshes. `GET /api/v1/auth/session` returns ids, email, org, seats, device label, expiry — never tokens. `MaskedSecrets` gains no token field.
- **Two device identifiers, never interchangeable.** `install_id` is client-minted (UUIDv4 in `<localDataDir()>/device.json`, mirrored in `session.enc`, never hardware-derived, survives sign-out). `device_id` is the server’s `devices.id`, returned by the token response, sent on every refresh, carried as the `did` claim.
- **Boot never waits on the network.** `hasSession` is read from disk; refresh, tenant-config revalidation and the poll all run after first paint with 3 s / 5 s timeouts and backoff. A `401` with a terminal reason clears the session; a timeout does not.
- **Tenant comes from brand config.** Add `tenantSlug` to `apps/desktop/branding/<brand>/brand.json` (today: `agentforge`, `kemenkeu`, `metranet`; no `tenantSlug` yet) and send it as `tenant_hint`. Never resolve a tenant from an e-mail domain.
- **Renderer gate becomes `allowed || hasSession`.** Reason codes (`seat_cap_reached`, `device_revoked`, `org_past_due`, …) map to the copy table in the login doc, in both locales, through the `onboarding` catalog — not to a generic “API error”.
- New host routes go through [`packages/host/src/router.ts`](packages/host/src/router.ts) with handlers in `packages/host/src/handlers/auth.ts`; the renderer reaches them through `@/lib/api-client` like everything else. Portal calls reuse `assertAllowedEndpointUrl` and `redactSecrets`; `user_code`, `device_code`, refresh tokens and JWTs are never logged.

**Decisions Kyo has not made — do not assume an answer in code or copy:** free-tier seat cap (20 is the draft), offline grace length (7 days is the draft), whether a pasted key beats a live session, seat reclamation after 30 idle days, OTP over e-mail only, where BYO-key spend is billed (schema open question 7 / login doc open question 9 — there is no per-user wallet), and a per-device keypair (v1.1, needs a shell change). Payment provider (Xendit / Paddle / Stripe) is Phase 2 and parked.

Product rules for the client stay as before: no password, no e-mail/session package in the product, no Better Auth, no “join Harbor State”. Everything local still works without the portal.

## Product (locked 2026-09-02 GTM; closed beta)

- **Gateway-first.** DPSBuddy exists because buying a key at `api.tokotokenai.com` leaves the question “where do I use this?” Install, paste the key, work. Native Anthropic / Google / Ark stay in the settings store, unexposed. Since 0.14.21 the owner may change the **Endpoint URL** in Settings (own gateway or loopback model server, HTTPS otherwise); onboarding still shows the branded endpoint read-only.
- **Two doors, no password.** BYO gateway key today; portal device-code login next (section above). No e-mail/password, no Better Auth, no product session package. The portal is the only account concept, and it lives server-side.
- **Single owner on the machine.** Data lives on disk. Everyone who installs it has their own copy.
- **First-run needs:** a gateway API key or a portal sign-in (and later optional local models such as Ollama). Store keys in the OS keychain / a local secrets file, never in the renderer, never in git, never in `NEXT_PUBLIC_*`.
- **Workspaces** are the user’s own desks (which tabs they need) — not an org membership table they must join. Default already has every work mode. Creating another desk (Legal, Marketing, Students, or custom checkboxes) is optional.
- Chat is ready immediately. Model picker + composer. Building custom agents is parked, not a gate.
- Pack templates are optional workspace presets. Default Chat never uses a pack template.
- University/Harbor State is an **optional pack of templates**, not the identity of the app. Kernel stays industry-neutral (`student` / `course` do not belong in core schema).
- Do not merge **Toko Token** with **TokenKu** in copy or catalogs.
- Custom agents / Studio stay in the tree and redirect to Chat. Do not add a GTM “hidden Build” door.

### Desktop target

Installer (**Electron**) + **SQLite** in the user data dir. No Docker Postgres. Optional later: on-prem campus server.

### What to keep from this repo

Chat composer, job-mode studios, workspace templates, modality-fail-closed run APIs, OpenAI-compatible wire (`/v1/chat/completions` + `/v1/responses`) against the gateway. Agent tables and Studio files stay for a later “show Build again” pass — they are not GTM surfaces.

### What to remove from the product (later)

Harbor State seed as identity leftovers (`packages/university/src/labels.ts` still names the org). Better Auth is already gone from code; keep it gone. Public rename / UI redesign / customer-only ship is parked until closed beta feedback lands.

## Non-negotiables

- Kernel schema, APIs, and packages must not use `student`, `course`, or campus nouns. Those live in `packages/university` (optional pack).
- Modalities are fail-closed: wrong content type on `/runs/text|image|video` is **400**, never silently dropped. `text` is always on; image/video are optional per agent and per model.
- Never commit `.env`, API keys, or passwords.
- Do not commit or push unless Kyo asks.
- Login is only the portal device-code flow described in `docs/internal/portal/`. No password login, no Better Auth, no product e-mail/session package, no “multiplayer” login. The client makes no entitlement decision: the host enforces, the renderer displays.
- Local process only. Local webdev binds `127.0.0.1:3000`. Packaged Electron has **no HTTP server** — the renderer talks to the host over IPC (`window.agentforge`). Mutating `/api` on webdev accepts localhost Origin only. Outbound HTTPS from the host to the gateway and the portal is the only network traffic.
- Every user-facing string exists in both `en` and `id` catalogs, and every job harness applies the output-language rule (see **Locale**).

## Layout

```
apps/web                 Vite + React Router renderer; Express on :3000 for webdev (local owner, no product login)
apps/web/locales         en/ and id/ catalogs, one JSON per namespace (see Locale)
apps/desktop             Electron shell + Windows installer (packaged: IPC host, no loopback HTTP)
apps/desktop/branding    Per-brand brand.json (agentforge, kemenkeu, metranet); tenantSlug lands here for login
apps/desktop/platform    Per-OS shell rules: README.md matrix + windows/ + macos/ (read before touching menus, quit, keychain, paths, installer, updater)
apps/mobile              Mobile client home (Expo, Android first, iOS after). Rules only until Phase 0 scaffold; see apps/mobile/AGENTS.md
packages/host            Local API dispatch (webdev HTTP adapter + Electron IPC); job harnesses; locale boot
packages/core            Content parsers, tools, AgentRuntime, AgentService, secrets, gateway gate types, locale primitives
packages/db              Drizzle schema (SQLite in the user data dir); localDataDir()
packages/university      Optional Students templates and mock campus tools
packages/marketing       Optional Marketing templates
packages/legal           Optional Legal templates
docs/                    Product docs + docs/internal engineering notes (index: docs/internal/README.md)
```

**Shell vs app (locked).** UI lives in `apps/web`. Do not edit `apps/desktop` for features. Do not import `electron` from the renderer. The only file that may read `window.agentforge` is `apps/web/lib/desktop-bridge.ts`; everything else goes through `@/lib/api-client`. Lint/format is **Biome** (`pnpm lint`) — do not add ESLint or Prettier. Agents use `pnpm dev` for features. Packaged Windows: `pnpm desktop:build` + WinApp F5. Packaged Mac: on a Mac, `pnpm desktop:build:mac` / `desktop:build:mac:dir` then F5 the `.app` or `pnpm desktop:mac`. This Windows checkout cannot run Apple’s Simulator or a `.app`. **Platform rules (2026-09-07):** every OS-specific shell behavior is owned by a folder with its own `AGENTS.md`: [`apps/desktop/platform/windows`](apps/desktop/platform/windows/AGENTS.md), [`apps/desktop/platform/macos`](apps/desktop/platform/macos/AGENTS.md), and [`apps/mobile`](apps/mobile/AGENTS.md). A change to `main.cjs`, menus, quit, keychain, paths, installer, or updater is checked against each affected folder before it ships. Mobile lives in-repo under `apps/mobile` (supersedes the earlier sibling-repo note); Expo / iOS Simulator work starts there, not in `apps/desktop`.

pnpm 9.15.9 + Turborepo. If corepack hits EPERM on Windows, use `npx pnpm@9.15.9`.

## Locale (en / id)

Bahasa Indonesia landed across every mode in PRs #37–#49 (2026-09-14/15). The rules that keep it whole:

- **Primitives:** [`packages/core/src/locale.ts`](packages/core/src/locale.ts) — `APP_LOCALES = ["en", "id"]`, `DEFAULT_APP_LOCALE = "en"`, `parseAppLocale()`. An unknown or missing value becomes English; a typo is never treated as Indonesian.
- **Storage and boot:** the owner settings file carries one machine-wide `locale` (not per desk). [`packages/host/src/locale-boot.ts`](packages/host/src/locale-boot.ts) freezes it on the first read of the host process; Settings’ language select saves via `POST /api/v1/settings`, and the “Restart” banner applies it via `POST /api/v1/settings/apply-locale`. There is no product env override; `AGENTFORGE_LOCALE` is not read on the boot path.
- **Renderer:** [`apps/web/lib/i18n.ts`](apps/web/lib/i18n.ts) — `t("namespace.path.key", vars)`, `freezeLocale`, `applyLocale`, `getLocale`. Catalogs are `apps/web/locales/{en,id}/<namespace>.json`, one namespace per surface (common, rail, settings, onboarding, chat, documents, research, images, videos, presentation, knowledge, workspaces, usage, market, data, finance, legal, edit). A missing `id` key falls back to `en`; a missing key returns the raw key.
- **Rule for new UI copy:** add the key to **both** `en` and `id` JSON in the same change. Each namespace has a parity test in `apps/web/lib/*locale*.test.ts` that asserts identical sorted leaf keys — keep it green, and add one for a new namespace. No English literals in product JSX.
- **Rule for job harnesses:** read `localeForRun()` from [`packages/host/src/run-context.ts`](packages/host/src/run-context.ts) and apply `withOutputLanguage(prompt, surface, locale)` from [`packages/core/src/output-language.ts`](packages/core/src/output-language.ts) (surfaces: documents, research, finance, data, videos, edit, knowledge) or the mode-specific helper (`agents/chat-locale.ts`, `legal/locale.ts`, host `presentation-locale.ts`, host `image-output-locale.ts`, market `briefing-prompt.ts`). A new mode adds its surface there before it ships. A harness that writes English when the owner chose `id` is a bug, not a default.
- **Host copy stays host-side.** Model instructions and stub replies live in TS beside the mode (comments point at the JSON they mirror); the host never imports the renderer catalogs.
- **Portal copy:** the portal returns `message_en` / `message_id`; the client prefers its own catalog copy for known reason codes and shows the portal text verbatim only for unknown ones.

## How to run

```
npx pnpm@9.15.9 install
npx pnpm@9.15.9 db:seed          # optional; first visit also creates the local owner
npx pnpm@9.15.9 dev               # http://127.0.0.1:3000 → /chat, no login
```

Optional: `npx pnpm@9.15.9 db:push` (`drizzle-kit push` escape hatch). Canonical path is `drizzle-kit generate` in `packages/db` + app-side migrate (`ensureSchema`) on SQLite open.

SQLite file: `data/agentforge.sqlite` (or `AGENTFORGE_DATA_DIR`). Do **not** set `DATABASE_URL` to Postgres. The portal’s Postgres in `docs/internal/portal/migrations/` is the backend team’s server database, never a product dependency.

Desktop:

- **Webdev window:** `pnpm desktop:dev` — Electron around local Vite/Express on `:3000` (no preload / no IPC). Not the installed product.
- **Packaged app:** `pnpm desktop:build` → NSIS x64 (Windows product path). Stages the Vite renderer + esbuild `host.cjs` (no bundled `node.exe`, no loopback port). Native modules (`better-sqlite3`, `keytar`) need `@electron/rebuild` **on Windows** — do not run that on Cloud. On launch the main process loads the renderer from `extraResources` and dispatches APIs over IPC. Writes `host-status.json` under Electron userData. Window close exits the whole process tree. Running setup.exe again replaces the existing install and keeps `%APPDATA%\DPSBuddy`. Uninstall (not upgrade) kills `DPSBuddy.exe`, deletes `%APPDATA%\DPSBuddy`, and removes Credential Manager `DPSBuddy` / `wrap-key`. mac/linux: `pnpm desktop:build:mac` / `pnpm desktop:build:linux` on that OS (unsigned; notarization is not done); `pnpm desktop:build:mac:docker --arch all` builds the static mac bundle from this Windows desk. Cloud cannot prove packaged Windows and must not run `pnpm desktop:build`. Move log: [`docs/internal/moves.md`](docs/internal/moves.md).
- **Ship list for 0.14.26 (published 2026-09-15):** see [`docs/internal/0.14.26-changelog.md`](docs/internal/0.14.26-changelog.md) and [`docs/public/0.14.26-notes.md`](docs/public/0.14.26-notes.md) — host gateway gate + Start over, the Bahasa Indonesia sweep across every mode, the Finance fixes, the Images/Videos cost estimate, and the security passes; Kyo overrode the harness-first order above for this cut, so 0.14.26 was cut before the harness pass landed.
- **Ship list for 0.14.25 (published 2026-09-12):** Market Watch, workspace desk management, and builtin Knowledge Phases 0–4, listed in [`docs/internal/0.14.25-changelog.md`](docs/internal/0.14.25-changelog.md); public notes in [`docs/public/0.14.25-notes.md`](docs/public/0.14.25-notes.md). Windows + mac preview (7 assets) on `Kyoo032/DPSBuddy`. Previous: [`docs/public/0.14.24-notes.md`](docs/public/0.14.24-notes.md) (published 2026-09-09, Windows-only); what is on `main` but not in the public installers is tracked in [`docs/internal/unreleased.md`](docs/internal/unreleased.md). Shipped: [`docs/internal/0.14.22-changelog.md`](docs/internal/0.14.22-changelog.md) (Research dossier / Data / Finance, macOS preview; plan in [`docs/internal/research-dossier-analyst-modes-plan.md`](docs/internal/research-dossier-analyst-modes-plan.md)), [`docs/internal/0.14.21-changelog.md`](docs/internal/0.14.21-changelog.md). Earlier: [`docs/internal/0.14.1-changelog.md`](docs/internal/0.14.1-changelog.md) is the reference of everything that must be inside the 0.14.1 `setup.exe`. Development and quick testing happen on **webdev** (`pnpm dev`, `:3000`), so a feature that works there is *not shipped* until it is staged into `host.cjs` + the renderer, packed, and driven on the installed app (`doctor --desktop`). Every agent that changes product code after 0.14.0 appends to the current changelog (`docs/internal/0.14.26-changelog.md` once created; `unreleased.md` until then); the pack step reads it back as the checklist.

### Two repos: verify in agentforge, release in DPSBuddy

- **`Kyoo032/agentforge` (private, this repo)** is where all work happens: source, branches, webdev, packing, and the full verify pass. Nothing leaves it until proven — staged into `host.cjs` + renderer, packed, installed, and driven on the packaged app (`doctor --desktop`).
- **`Kyoo032/DPSBuddy` (public, "DPSBuddy")** is releases only: README + `DPSBuddy-Setup-<v>.exe` + `.blockmap` + `latest.yml`, published with `pnpm desktop:release` (never by hand, never `git push`). The packaged app's updater reads this repo unauthenticated. Never put source, flavor exes, `docs/internal/` notes, or any AI/agent marks there — release notes come from `docs/public/<version>-notes.md`, commits and releases are authored as Kyo, plain messages.
- Order is fixed: work → verify inside agentforge → only when everything on the ship list is proven, cut the release into DPSBuddy.
- **Pack/ship on this Windows desk:** [`.cursor/skills/pack-dpsbuddy`](.cursor/skills/pack-dpsbuddy/SKILL.md) (isolated NSIS worktree + Docker mac dmg). Cloud must not run it.
- **Versioning (Kyo, 2026-09-07):** after 0.14.2 the next releases are `0.14.21`, `0.14.22`, … — do not use `0.14.3+` and do not bump to `0.15` until Kyo says so. Semver orders these correctly for the updater (21 > 2). Current tree: `apps/desktop/package.json` is `0.14.26`; the next cut is `0.14.27`.

**Packaged Windows installer exists.** Cloud Linux must not run `pnpm desktop:build`.

- Artifacts: `apps/desktop/dist/DPSBuddy Setup 0.14.25.exe` + mac dmg/zip (gitignored). Anything older in `dist/` (`published-*`, `superseded-*`) is history, not current.
- Packaged proof is an Electron window + `doctor.mjs --desktop` (in `.cursor/skills/verify-agentforge/scripts/`) reading `host-status.json` (`transport: "ipc"`). There is no `app-url.txt` and no child `node.exe`.

No account today. Workspaces are local. Paste the gateway key in Settings. `AGENTFORGE_RUNTIME=stub` until a key is saved (then live models from the gateway). Env `AGENTFORGE_RUNTIME=ai` still uses `.env` keys.

## Runtime and tools

- `createRuntime()` selects stub vs Vercel AI SDK. Live chat uses the gateway base URL unless the owner pasted a different one. Provider keys come from `resolveProviderKeys` and nowhere else; the session access token joins that function in Phase 1.
- Tools: `defineTool` + registry + bindings. Platform: `calculator`, `datetime`, `web_search`, `image_generate`, `video_generate`. Packs add more.
- Gateway key runs chat **and** image/video generation (`POST /v1/images/generations`, `POST /v1/video/generations` + poll). Search still needs Tavily/Brave. FAL is optional BYOK.
- New industry = new pack package, not kernel tables.

## Secrets and prompt security

The user pastes their gateway key into settings. The host process holds it. Runs use it. The UI never gets the raw key back after save (`hasOpenai` only). Optional extras: native Google / Anthropic / Ark, plus dedicated tool keys (Tavily/Brave/FAL) in Settings Extras.

Do not use Hermes tools or Hermes dashboard tokens to process DPSBuddy keys.

- **Gateway key** → `settings.enc` (AES-256-GCM), per workspace.
- **Portal session (Phase 1)** → `session.enc` next to it, machine-scoped, encrypted under a key derived from the same wrap key (`HKDF(wrapKey, "session-v1")`). Refresh token on disk only there; access token in host memory only.
- **Wrap key** → Electron keytar `DPSBuddy` / `wrap-key` (injected as `AGENTFORGE_SECRETS_KEY`), or webdev `data/.master-key` / env. Never in the renderer, never in git, never in `NEXT_PUBLIC_*`. Login adds no keychain slot.
- Remote inference and portal URLs must be HTTPS. `http://` is only for loopback (Ollama).
- DPSBuddy does not log prompts. Message bodies, system prompts, and tool I/O are encrypted at rest. Gateway retention is Toko Token’s policy, not ours.
- OpenRouter’s `provider.zdr: true` is sent only when the saved URL is OpenRouter. Do not send that field to Toko Token.
- Wallet / usage / key-admin on the gateway stay parked until this privacy pass is solid; the portal’s wallet is server-side and the client only displays balances it is told.
- Never commit `.env`, `data/settings.enc`, `data/session.enc`, `data/.master-key`, or API keys.

## Tests

- Unit: Vitest in `packages/core`, `packages/host`, `packages/db`, `packages/legal`, `packages/marketing`, `packages/university`, `apps/web` (`pnpm test` runs all through Turbo). `apps/desktop` has plain Node tests (`pnpm --filter @agentforge/desktop test`). Local coding agents run these. Run host tests with `AGENTFORGE_DATA_DIR` pointed at a temp dir so stub media rows do not land in the dev desk.
- Locale parity tests live in `apps/web/lib/*locale*.test.ts`; the gate contract test is `apps/web/lib/gateway-gate.test.ts`. Both must stay green on every UI change.
- Do **not** run Playwright locally — `foundation.spec.ts` is a long serial pass (Vite dev server + stub chat + workspaces).
- E2E: Playwright `apps/web/tests/e2e/foundation.spec.ts` (Chat → Settings → job modes → Legal workspace smoke). Owned by **Cursor Cloud Agents**, not the local Windows session. See **Cursor Cloud specific instructions** below.
- Verify UI in the IDE browser when changing layout. Do not block on `pnpm test:e2e` on this machine.
- Feature verification recipes: [`.cursor/skills/verify-agentforge/features/`](.cursor/skills/verify-agentforge/features/README.md). `locale.md` and `gateway-gate.md` land in the harness pass; `login.md` lands with Phase 1. A feature without a recipe is not verified.

## Cursor Cloud specific instructions

Cloud clones GitHub. Push the branch first; uncommitted local files are not on the VM. Launch from the Cursor **Cloud** agent dropdown, or `/in-cloud` from a local chat.

Boot uses [`.cursor/environment.json`](.cursor/environment.json): `install` → `scripts/cloud-install.sh` (pnpm 9.15.9, Playwright Chromium). `start` → `scripts/cloud-start.sh` (prepares the data dir only; the host creates the schema on first open). Stub runtime only — no gateway key.

This image has **no Docker**. `docker`, `dockerd`, and `sudo service docker start` fail (`docker: unrecognized service`). Do not run `docker compose`. Product DB is SQLite. Default file: `data/agentforge.sqlite`.

The Windows closed-beta checkout also uses SQLite (`ensureSchema` migrates on open; `pnpm db:push` is optional). Desktop Electron injects the wrap key from the OS keychain. Packaged uses IPC in-process — no loopback HTTP server.

### What a Cloud Agent on this VM can do

- Node 22 + pnpm 9.15.9 (corepack). Workspace `node_modules` after `install`.
- SQLite via `ensureSchema` on open (not Docker Compose, not required Postgres). `pnpm db:push` is optional.
- Run the stub Playwright suite against `http://127.0.0.1:3000` (`pnpm test:e2e` from repo root also works). That is **webdev**, not the packaged app. Playwright `webServer` starts `pnpm dev` if needed. Do not use a LAN IP.

```
cd apps/web
AGENTFORGE_RUNTIME=stub npx playwright test
```

- Run Vitest unit tests (`pnpm test` / package `vitest run`).
- **Knowledge Base (builtin only).** Prove Phases 0–4 with [`.cursor/skills/verify-agentforge/features/knowledge-phases.md`](.cursor/skills/verify-agentforge/features/knowledge-phases.md). No WeKnora sidecar, no `AGENTFORGE_WEKNORA_BIN`, no `:3100`. Stub Chat injects chunks but cannot write `cites`; skip live cites on this VM.
- **Gate and login in stub mode.** The host gate reports `status: "stub", allowed: true`; the portal is unreachable, so login tests use a mocked portal (`msw` or an in-process fake) and never a real `api.tokotokenai.com` call.
- Browser / computer-use against the local **webdev** app when those tools are available. Bind is `127.0.0.1:3000`. Packaged desktop is not on this VM.
- Read GitHub with `gh` (PRs, Actions logs). Do not use `gh` to create PRs — use the Cursor PR tool.

### What a Cloud Agent on this VM cannot do

- Docker Postgres / `docker compose` (not installed).
- Live Toko Token / gateway inference or a live portal login. There is no gateway key. Keep `AGENTFORGE_RUNTIME=stub`. Do not paste keys into the VM or commit `.env`.
- Product password login, e-mail, or session. There is none.
- See the operator’s unpushed Windows working tree.
- Merge PRs or enable auto-merge unless Kyo asks.

GitHub Actions (`.github/workflows/e2e.yml`) runs the same stub Playwright suite on push/PR to `main`. No gateway key. Cloud Agents also own that suite on this VM. Do not park the GHA job.

## Known traps

- Cursor’s browser can inject `data-cursor-ref` and block clicks. Use Chrome or Playwright.
- Playwright `/studio/**` redirects to Chat (Build is parked).
- Dev server binds `127.0.0.1:3000` (webdev only: Vite + Express + `@agentforge/host`). Playwright and the IDE browser must use `http://127.0.0.1:3000` (not a LAN IP). Packaged DPSBuddy has no HTTP port; `doctor.mjs --desktop` reads Electron userData `host-status.json` (Windows `%APPDATA%\DPSBuddy`, Linux `$XDG_CONFIG_HOME/DPSBuddy` or `~/.config/DPSBuddy`, macOS `~/Library/Application Support/DPSBuddy`). A phone on a LAN `:3000` is not a product surface — see [`docs/mobile.md`](docs/mobile.md).
- **Start over is destructive.** `settings-reset-all-submit` erases the desk it runs on and relaunches; `settings-reset-key-submit` forgets the key on every desk. Never press either on the operator’s shared Windows instance unless asked. Drive them on a throwaway `AGENTFORGE_DATA_DIR`.
- Host tests read the operator’s `data/` unless the test file sets its own `AGENTFORGE_DATA_DIR` (`enhance-prompt.test.ts` fails when the desk locale is `id`). Do not fix that with one shared temp dir for the whole run: parallel workers then race `ensureSchema` (`table agent_tool_bindings already exists`). Isolation is a per-file `mkdtempSync`.
- `pnpm -r test` stops at the first failing package and the db `drizzle-kit check` drift test is timing-sensitive under a full parallel run; re-run a package alone before calling it red.
- `docs/internal/unreleased.md` still says “after public v0.14.22” in its title; the log inside is current through 0.14.25. Start it over for 0.14.26 rather than appending to the stale header.
