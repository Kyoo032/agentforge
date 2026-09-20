# Unreleased changes (after public v0.14.27)

**Purpose:** what is on `main` or on the cut branch but not inside the installers attached to the public **v0.14.27** release on `Kyoo032/DPSBuddy` — published 2026-09-18 01:47 UTC (Windows `05e97a5`, mac `6da52d7`). The `0.14.27` cut is `e2e477e` on `release/0.14.27` (PR #52, `e8a7118`, plus the version bump), with `apps/desktop/package.json` at `0.14.27`; everything this file used to list has been folded into [`0.14.27-changelog.md`](0.14.27-changelog.md). **0.14.27 is not published yet** — until it is, this file records only what lands *after* that cut. The next cut after it is **`0.14.28`** (per the 2026-09-07 rule; never `0.14.3+`, never `0.15` until Kyo says so). Convention unchanged: at the bump everything listed here is folded into `<version>-changelog.md` and this file starts over. Same rule as every changelog: nothing counts as shipped until it is staged, packed, installed, and driven on the packaged app.

Append-only. When 0.14.28 is published, record the artifact table below, fold any later items into the next changelog, and start this file over.

## Where each published artifact came from

To be filled when 0.14.27 is packed and published — the pack lanes write their shas, sizes and sha256 into the `## Pack + publish` block of [`0.14.27-changelog.md`](0.14.27-changelog.md) first, and the published rows are copied here.

| Artifact | Source | Uploaded (UTC) |
|---|---|---|
| `DPSBuddy-Setup-0.14.27.exe` + `.blockmap` + `latest.yml` | `05e97a5`, worktree `agentforge-pack-0.14.27-05e97a5`, sha256 `D2FCD444…1A45D6`, 102 243 076 bytes, `latest.yml` sha512 `yHNJBKzW…nG9mw==` | 2026-09-18 01:47 |
| `DPSBuddy-0.14.27-mac-arm64.dmg` / `.zip`, `-x64.dmg` / `.zip` | `6da52d7` (Docker Linux, `--arch all`, third pack — the first two shipped Linux anydoc binaries), `mac-0.14.27.sha256`, arm64 dmg `c2434f49…6b83d` / zip `70e4eab7…68d51`, x64 dmg `edda5e18…29aa1` / zip `16dff901…88d4fa` | 2026-09-18 01:47 |

Earlier releases: 0.14.26 (`e93c617`, published 2026-09-15 09:18 UTC, 7 assets) and everything before it are recorded in their own changelogs and in this file's history at `e2e477e`.

## Still open after the 0.14.27 cut

Nothing below is closed by 0.14.27. Carried forward as-is.

- [ ] **Packaged bundled-anydoc load.** The 0.14.27 packs carry `anydoc.win32-x64-msvc.node` and `anydoc.darwin-<arch>.node` in `app.asar.unpacked`, but no packed app has been shown to *load* them. Proof owed: `doctor --desktop` plus `GET /api/v1/components` reporting `anydoc` `ready` with `source: "bundled"`.
- [ ] **Any macOS run of the component installer's download route.** Never done. An ad-hoc-signed, non-notarized app should be allowed to `dlopen` a downloaded `.node`; nobody has watched it happen.
- [ ] **The onboarding component panel** (`component-setup`) has never been seen in a browser or on the packaged app — on this desk anydoc is bundled, so it correctly renders nothing.
- [ ] **Webdev drives of the 0.14.27 product work:** Finance tasks, Finance import/export, the Market analyst team, the rail submenus and recent sessions, and `GET /api/v1/components`. The `:3000` host must be restarted after the host/core edits in PR #52 before any of it is drivable (`tsx server.ts` has no watcher).
- [ ] **Playwright `foundation.spec.ts`** against PR #52's tree — owed from GitHub Actions / Cloud. Blocked on 2026-09-18: every Actions run since 2026-09-17 (main, PR #52, PR #53) ends in `startup_failure` / "account is locked due to a billing issue"; no job has started. Clear the billing lock on `Kyoo032`, then `gh run rerun` the e2e workflow on `release/0.14.27`.
- [ ] **Legal:** one live matter run against the gateway (`features/legal.md` steps 4 to 8), and the Word / Excel round-trip of the redline and deviation report. The Legal recipe has still never been driven.
- [ ] **Packaged Windows drive of Start over + the gateway gate** (`doctor --desktop`, `host-status.json` `hasOpenai: false` after sign-out). Pack checklist item 4 of 0.14.26 was never met.
- [x] **Owner install smoke (Windows), 2026-09-18** — Kyo installed `DPSBuddy Setup 0.14.27.exe` (`05e97a5`) and reports it working. Still unticked below because no one has driven the itemised list.
- [ ] **The manual Windows smoke list** from `apps/desktop/platform/windows/AGENTS.md` that no script can do: Ctrl+V and right-click Paste on the onboarding key field, composer clipboard round-trip, the rail-footer update panel, Start over → reset → "Keep my data", model-output links opening the default browser, the model picker on a narrow pane.
- [ ] **Packaged CSP console check** on a packed build (the static half is proven; the DevTools/runtime half is not).
- [ ] **A packaged-app drive from the verify skill** — the 0.14.26 live pass stayed on webdev because a `DPSBuddy.exe` was running.
- [ ] **mac launch smoke on hardware for this build.** The owner closed it for 0.14.26 on 2026-09-15; it is owed again for 0.14.27.
- [ ] **ffmpeg is still a manual install** on both platforms and still shows `ffmpeg-setup-notice`. It is the next component-manifest entry.
- [ ] **The unfixed findings.** 51 unique bugs from the 2026-09-17 mapping pass, 21 from the knowledge-flow pass and 9 from the 2026-09-15 harness pass were logged in this file; the knowledge-path ones were fixed in PR #52 and marked in place, the rest are still live. Read the full lists from this file at `e2e477e`; the harness pass is also tracked as P7–P15 in [`blockers-2026-09-15.md`](blockers-2026-09-15.md), and the five that were fixed are summarised in [`0.14.27-changelog.md`](0.14.27-changelog.md).
- [ ] **Chat card titles.** A Chat thread's title is never regenerated after turn 1 (`threads.ts` `setThreadTitleFromParts`), so a Chat knowledge card keeps its first-turn name.
- [ ] **Housekeeping on the owner's desk:** purge the 37 stub video rows from `data/agentforge.sqlite` so the dev Videos gallery is clean; 104 leftover `edit-idor-<hex>` desks from an older security probe still render in the switcher (each DELETE needs `confirmName` — ask before sweeping).

## Log

- **2026-09-18** — 0.14.27 cut. PR #52 merged (`e8a7118`), version bumped to `0.14.27` (`e2e477e`) on `release/0.14.27`; everything from after the 0.14.26 cut folded into [`0.14.27-changelog.md`](0.14.27-changelog.md) and this file started over. Nothing packed, nothing published.

## 2026-09-18 — direction change: hosted web app

- **What changed.** Kyo decided the product continues as a hosted, multi-user web app (SaaS) served from `apps/web/server.ts` behind a reverse proxy, with per-tenant data on the server, portal browser login, and the seat paywall and entitlement gate server-side. The gateway stays the model backend.
- **Desktop is frozen at 0.14.27.** Maintenance-only: no new features, no new cuts unless Kyo asks. The `Kyoo032/DPSBuddy` releases repo and `desktop:release` are desktop-maintenance-only. The published 0.14.27 artifacts and every open item above stand as recorded.
- **Record:** [`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md) — rule changes, the seven open decisions, verified architecture facts, and the deploy log.

This file’s “nothing counts as shipped until packed and installed” convention now applies to **desktop maintenance only**. Hosted deploys are not tracked here: every one appends a row to the deploy log in the decision record.

## 2026-09-18 — hosted mode, Phase 1 and the Phase 2 backend

- One switch, `AGENTFORGE_SERVER=1` (`packages/core/src/server-mode.ts`), turns on every hosted-only rule; webdev and the desktop never set it and behave exactly as before (every package suite green: core 2077, db 55, host 1448+, web 817).
- Server mode: mutating `/api` needs a trusted Origin and Host (`AGENTFORGE_TRUSTED_ORIGINS`), a CSRF double-submit token (`__Host-agentforge_csrf` cookie on the server, `agentforge_csrf` on webdev, plus the `x-agentforge-csrf` header), and a portal session (`agentforge_session`, `session_required` 401). New codes: `origin_forbidden`, `csrf_missing`, `csrf_invalid`, `session_required`, `reset_disabled`, `too_many_jobs`, `portal_unavailable`.
- Server mode: `AGENTFORGE_SECRETS_KEY` is mandatory (no `.master-key` file), the gateway gate fails closed (no trust-on-first-run, stub runtime closed), "Start over" scope `all` is refused, ffmpeg and SQL workers are capped (`AGENTFORGE_MAX_FFMPEG`, `AGENTFORGE_MAX_SQL_WORKERS`).
- Host logging is one JSON logger (`packages/host/src/log.ts`) with secret redaction and dropped prompt/key fields; 68 console calls replaced.
- New table `auth_sessions` (migration `0014`), new locales `auth.json` (en, id). Not shipped anywhere: the hosted environment does not exist yet; the desktop is frozen and untouched by these rules.


## 2026-09-20 — Music mode

- **New product mode `music`** (`/music`), the third generate studio, built to the Images / Videos pattern: rail entry, one fetch-on-mount, a form, a gallery. Two modes — Describe (a sentence) and Custom (lyrics + style tags + title + instrumental) — plus a **Draft lyrics** button that writes lyrics without spending a music charge.
- **Three new routes, no new by-id routes:** `GET /api/v1/music`, `POST /api/v1/music`, `POST /api/v1/music/lyrics`. Generated tracks are served by the existing `GET /api/v1/media/:mediaId/file` and stored under the existing `<dataDir>/media/<organizationId>/` layout. Nothing in `packages/db` changed: `media.kind` is free text, so `"audio"` needed no migration.
- **The wire is an async Suno relay on the gateway origin**, not a `/v1` route: `POST /suno/submit/{music,lyrics}` then `GET /suno/fetch/<taskId>`. New file `packages/core/src/tools/platform/gateway-audio.ts`. One job returns **two takes for one charge**, and both are saved — one media row, one sidecar entry and one Knowledge card each.
- **Text-to-speech is built but unreachable on this gateway.** `speech_generate` / `POST /v1/audio/speech` work, but the catalog's only TTS id is `qwen3-tts-instruct-flash-realtime`, which speaks WebSocket behind an `openai` endpoint label and cannot be driven from a job route. Rather than shipping a dead control or guessing an id, `GET /api/v1/music` answers `speechUnavailable: "realtime_only" | "no_audio_models" | null` and the studio renders the reason. It turns itself on with no code change the day a plain TTS id appears.
- **Fixed on the way through:** widening the media store to accept audio had silently opened `POST /api/v1/media` — the chat upload route — to `audio/mpeg`. `saveMedia` now takes an explicit `allow` list defaulting to `["image", "video"]`; only `saveGeneratedAudio` passes `["audio"]`. Caught by `packages/host/src/edit/import.test.ts` (harness gotcha G-27) and now also guarded in `packages/host/src/handlers/music.test.ts`.
- **[ ] The Suno relay has never been driven against the live gateway.** It was written from [`gateway-model-selection.md`](gateway-model-selection.md) §5.3 and the NewAPI relay action map it cites; Cloud agents have no egress to `api.tokotokenai.com`, so every automated test stubs `fetch`. Proof owed, one command on a keyed desk: `OPENAI_API_KEY=… pnpm exec tsx scripts/probe-gateway-music.ts` (exit 0 = catalog listed a music id, relay accepted a submit, a finished job returned a playable URL). Until it exits 0, the request and response shapes are documented, not verified.
- **[ ] No UI drive.** `features/music.md` has never been walked in a browser; the recipe is written, not run.
- Map: [`maps/music-mode.md`](maps/music-mode.md). Where to press: `.cursor/skills/verify-agentforge/features/music.md`.
