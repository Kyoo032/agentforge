# Unreleased changes (after public v0.15.0)

**Purpose:** what is on `main` or on the cut branch but not inside an installer. **0.15.0 is cut, not published** — the installers in the wild are still **v0.14.27** (published 2026-09-18 01:47 UTC, Windows `05e97a5`, mac `6da52d7`). Everything this file used to list before the 0.15.0 cut is folded into [`0.15.0-changelog.md`](0.15.0-changelog.md); the pre-0.14.27 material is in [`0.14.27-changelog.md`](0.14.27-changelog.md) and the long findings lists are readable from git at `e2e477e`.

**0.15.0 is the personal Mac/Windows app, not the hosted web offer** (owner split, 2026-09-23: Personal is the app, Enterprise is the hosted web app). The version rule changes with it: the `0.14.2x` scheme was scoped to desktop *maintenance* cuts, and 0.15.0 is a product release, so it takes the next minor. The next desktop maintenance cut would be `0.15.1`.

Convention unchanged: at the next bump everything listed here folds into `<version>-changelog.md` and this file starts over. Nothing counts as shipped until it is staged, packed, installed, and driven on the packaged app.

Append-only. The 0.15.0 cut is now **published**, so its artifact table is filled below. When 0.15.1 is published, fold any later items into that changelog and start this file over.

## Where each published artifact came from

To be filled when 0.14.27 is packed and published — the pack lanes write their shas, sizes and sha256 into the `## Pack + publish` block of [`0.14.27-changelog.md`](0.14.27-changelog.md) first, and the published rows are copied here. 0.14.27 has since been **superseded**: the current published release is 0.15.0, below.

| Artifact | Source | Uploaded (UTC) |
|---|---|---|
| `DPSBuddy-Setup-0.14.27.exe` + `.blockmap` + `latest.yml` | `05e97a5`, worktree `agentforge-pack-0.14.27-05e97a5`, sha256 `D2FCD444…1A45D6`, 102 243 076 bytes, `latest.yml` sha512 `yHNJBKzW…nG9mw==` | 2026-09-18 01:47 |
| `DPSBuddy-0.14.27-mac-arm64.dmg` / `.zip`, `-x64.dmg` / `.zip` | `6da52d7` (Docker Linux, `--arch all`, third pack — the first two shipped Linux anydoc binaries), `mac-0.14.27.sha256`, arm64 dmg `c2434f49…6b83d` / zip `70e4eab7…68d51`, x64 dmg `edda5e18…29aa1` / zip `16dff901…88d4fa` | 2026-09-18 01:47 |

Published 2026-09-23 11:25 UTC from `88bb803`, 7 assets on [`Kyoo032/DPSBuddy`](https://github.com/Kyoo032/DPSBuddy/releases/tag/v0.15.0). Full route table with every sha256: [`0.15.0-changelog.md`](0.15.0-changelog.md) § Pack + publish.

| Artifact | Source | Uploaded (UTC) |
|---|---|---|
| `DPSBuddy-Setup-0.15.0.exe` + `.blockmap` + `latest.yml` | `88bb803`, worktree `agentforge-pack-0.15.0`, exe sha256 `d4bd79bc…dc872a`, 102 554 305 bytes | 2026-09-23 11:25 |
| `DPSBuddy-0.15.0-mac-arm64.dmg` / `.zip`, `-x64.dmg` / `.zip` | `88bb803` (Docker Linux, `--arch all`), arm64 dmg `78db45bc…d96d9` / zip `ae802931…d3d81`, x64 dmg `53ddf4e8…b28c` / zip `89f22c91…bead` | 2026-09-23 11:25 |

mac is **preview**: the dmg has never been opened on Mac hardware.

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

- **2026-09-23** — 0.15.0 cut on `design/warm-desk-0.15` — the personal Mac/Windows app's look-and-feel release. Light is the default desk (white pages, `#0a0a0a` text), the rail follows the theme, a blue `--shadow-float` lifts a `.desk-canvas` panel, corners are 4px, and the type is DM Sans + Source Serif 4 bundled locally (both variable fonts, 4 files, no runtime font host). All 12 modes now lead with **title + one outcome line**; optional controls moved behind `Advanced` / `How this works` disclosures. Chat's empty state became four intent cards that fill the composer, tool calls folded into the Thinking disclosure, and `gist()` replaced raw JSON in the tool rows. Bugs fixed on the way: the rail footer was dark-on-dark because unlayered `.btn` beats `@layer utilities`; Market and Finance were losing their names to the submenu toggle's label; three modes had an invisible borderless prompt box; "Offline demo" was a lie in three places; the sign-out path was investigated and found **correct** (stub runtime on webdev was masking it). The `picker-panel.test.ts` red was reconciled. **Split from the enterprise lane**: the Phase 9 plans/pricing/portal files sitting in the same working tree are deliberately not in this cut. Verified with that work stashed — `tsc` exit 0, web suite 1218/1218, 118 files. Nothing packed, nothing published. [`0.15.0-changelog.md`](0.15.0-changelog.md), [`../public/0.15.0-notes.md`](../public/0.15.0-notes.md).
- **2026-09-22** — Desk visual + UX overhaul on `apps/web` (design `grok-design-doc-04c7f940`). Dark `#0B0D12` is the default (`:root`); light is the `.light` class. Glow, shimmer, and pulse are gone. Empty Chat is a task launcher (heading, key status, checklist, three mode cards, labeled composer drop zone). One New chat, in the rail, including when collapsed. Usage pill is plan and seats only when plans are enforced, otherwise this-key USD. No token allowance. Outfit and Sora stay bundled. **Superseded on 2026-09-23 by the 0.15.0 pass above** — light became the default, the checklist and mode cards were cut, and Outfit/Sora were replaced by DM Sans/Source Serif 4.
- **2026-09-22** — UI type is bundled Source Sans 3. Page paper is tinted green, secondary text is dark ink instead of gray-on-gray, and labels use a rust mark beside the teal actions. Superseded the same day by the dark desk above.
- **2026-09-22** — **The product split.** Personal is the Mac and Windows DPSBuddy app, a complement from DPS when the customer is buying a lot of tokens. Enterprise is the web-based DPSBuddy: contact DPS, per user because of unified knowledge-base storage, agent traffic, and DPS implementation and maintenance, with seats and tokens charged separately. No token allowance, no new price, desktop untouched. **Re-scoped 2026-09-23**: the desktop is under active development again and cut `0.15.0`, so "desktop untouched" no longer holds; the split itself does, and `AGENTS.md` and `README.md` now lead with it.
- **2026-09-18** — 0.14.27 cut. PR #52 merged (`e8a7118`), version bumped to `0.14.27` (`e2e477e`) on `release/0.14.27`; everything from after the 0.14.26 cut folded into [`0.14.27-changelog.md`](0.14.27-changelog.md) and this file started over. Nothing packed, nothing published.
- **2026-09-20** — Phase 3 lane A (tenancy in the edit store). Closed the confirmed IDOR on `POST /api/v1/edit/projects/:projectId/unplaced/:itemId/discard`, which updated `edit_unplaced` by item id alone and returned the row: any desk could soft-delete and read back any other desk's unplaced item. Hardened the edit store so the scope is a required argument and lives in the `WHERE` clause rather than a follow-up comparison — `loadProjectRow`, `foldProject`, `appendOps`, `getEditJob`, `patchJob`, `cancelEditJob`, `undoCard`, `keepCard`. New `packages/host/src/edit/edit-scope.test.ts` (12 tests); the two discard cases were confirmed red against the old handler before the fix. Schema untouched — lane B owns migration `0015`. Map page [`maps/edit-timeline.md`](maps/edit-timeline.md) refreshed in place.

## 2026-09-18 — direction change: hosted web app

- **What changed.** Kyo decided the product continues as a hosted, multi-user web app (SaaS) served from `apps/web/server.ts` behind a reverse proxy, with per-tenant data on the server, portal browser login, and the seat paywall and entitlement gate server-side. The gateway stays the model backend.
- **Desktop is frozen at 0.14.27.** Maintenance-only: no new features, no new cuts unless Kyo asks. The `Kyoo032/DPSBuddy` releases repo and `desktop:release` are desktop-maintenance-only. The published 0.14.27 artifacts and every open item above stand as recorded. **Superseded 2026-09-23:** the desktop is the **Personal** product, cut `0.15.0`, under active development again — recorded here as the history of the 2026-09-18 pivot.
- **Record:** [`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md) — rule changes, the seven open decisions, verified architecture facts, and the deploy log.

This file’s “nothing counts as shipped until packed and installed” convention now applies to **desktop maintenance only**. Hosted deploys are not tracked here: every one appends a row to the deploy log in the decision record.

## 2026-09-18 — hosted mode, Phase 1 and the Phase 2 backend

- One switch, `AGENTFORGE_SERVER=1` (`packages/core/src/server-mode.ts`), turns on every hosted-only rule; webdev and the desktop never set it and behave exactly as before (every package suite green: core 2077, db 55, host 1448+, web 817).
- Server mode: mutating `/api` needs a trusted Origin and Host (`AGENTFORGE_TRUSTED_ORIGINS`), a CSRF double-submit token (`__Host-agentforge_csrf` cookie on the server, `agentforge_csrf` on webdev, plus the `x-agentforge-csrf` header), and a portal session (`agentforge_session`, `session_required` 401). New codes: `origin_forbidden`, `csrf_missing`, `csrf_invalid`, `session_required`, `reset_disabled`, `too_many_jobs`, `portal_unavailable`.
- Server mode: `AGENTFORGE_SECRETS_KEY` is mandatory (no `.master-key` file), the gateway gate fails closed (no trust-on-first-run, stub runtime closed), "Start over" scope `all` is refused, ffmpeg and SQL workers are capped (`AGENTFORGE_MAX_FFMPEG`, `AGENTFORGE_MAX_SQL_WORKERS`).
- Host logging is one JSON logger (`packages/host/src/log.ts`) with secret redaction and dropped prompt/key fields; 68 console calls replaced.
- New table `auth_sessions` (migration `0014`), new locales `auth.json` (en, id). Not shipped anywhere: the hosted environment does not exist yet; the desktop is frozen and untouched by these rules.


## 2026-09-20 — the DPS Cloud mark on the web rail (name settled 2026-09-21)

- The web rail and the hosted bundle carry the **DPS Cloud mark** — `logoSrc: /brand/logo.png`, the chevron from the DPS Cloud lockup — beside the product name. The **name is DPSBuddy** wherever a person can read one (owner's ruling, 2026-09-21): this note first recorded a `productName: "DPS Cloud"` preload, and that is no longer what ships. Web, portal and mail all say DPSBuddy; only the logo comes from the DPS Cloud lockup. The frozen desktop reads flavor from Electron and was already DPSBuddy, so nothing there changed.

## 2026-09-20 — Music mode

- **New product mode `music`** (`/music`), the third generate studio, built to the Images / Videos pattern: rail entry, one fetch-on-mount, a form, a gallery. Two modes — Describe (a sentence) and Custom (lyrics + style tags + title + instrumental) — plus a **Draft lyrics** button that writes lyrics without spending a music charge.
- **Three new routes, no new by-id routes:** `GET /api/v1/music`, `POST /api/v1/music`, `POST /api/v1/music/lyrics`. Generated tracks are served by the existing `GET /api/v1/media/:mediaId/file` and stored under the existing `<dataDir>/media/<organizationId>/` layout. Nothing in `packages/db` changed: `media.kind` is free text, so `"audio"` needed no migration.
- **The wire is an async Suno relay on the gateway origin**, not a `/v1` route: `POST /suno/submit/{music,lyrics}` then `GET /suno/fetch/<taskId>`. New file `packages/core/src/tools/platform/gateway-audio.ts`. One job returns **two takes for one charge**, and both are saved — one media row, one sidecar entry and one Knowledge card each.
- **Text-to-speech is built but unreachable on this gateway.** `speech_generate` / `POST /v1/audio/speech` work, but the catalog's only TTS id is `qwen3-tts-instruct-flash-realtime`, which speaks WebSocket behind an `openai` endpoint label and cannot be driven from a job route. Rather than shipping a dead control or guessing an id, `GET /api/v1/music` answers `speechUnavailable: "realtime_only" | "no_audio_models" | null` and the studio renders the reason. It turns itself on with no code change the day a plain TTS id appears.
- **Fixed on the way through:** widening the media store to accept audio had silently opened `POST /api/v1/media` — the chat upload route — to `audio/mpeg`. `saveMedia` now takes an explicit `allow` list defaulting to `["image", "video"]`; only `saveGeneratedAudio` passes `["audio"]`. Caught by `packages/host/src/edit/import.test.ts` (harness gotcha G-27) and now also guarded in `packages/host/src/handlers/music.test.ts`.
- **[ ] The Suno relay has never been driven against the live gateway.** It was written from [`gateway-model-selection.md`](gateway-model-selection.md) §5.3 and the NewAPI relay action map it cites; Cloud agents have no egress to `api.tokotokenai.com`, so every automated test stubs `fetch`. Proof owed, one command on a keyed desk: `OPENAI_API_KEY=… pnpm exec tsx scripts/probe-gateway-music.ts` (exit 0 = catalog listed a music id, relay accepted a submit, a finished job returned a playable URL). Until it exits 0, the request and response shapes are documented, not verified.
- **[ ] No UI drive.** `features/music.md` has never been walked in a browser; the recipe is written, not run.
- Map: [`maps/music-mode.md`](maps/music-mode.md). Where to press: `.cursor/skills/verify-agentforge/features/music.md`.

## 2026-09-20 — Channels: Telegram integration, Phase 1

- **What it is.** A desk can connect a Telegram bot, add the groups or channels that bot is in, post to one, and pull replies. Account-rail page at `/channels` (not a product mode, no change to the mode catalog). Design and the phases after this one: [`telegram-channels-plan.md`](telegram-channels-plan.md); how it works: [`maps/channels.md`](maps/channels.md); where to press: `.cursor/skills/verify-agentforge/features/channels.md`.
- **The bot token is handled like the gateway key.** `telegramBotToken` on the desk's slice of `settings.enc`, cleared by an empty patch, reported back only as `hasTelegramBot` + a `sha256:` fingerprint. It is outside `hasLiveProvider`, so saving one does not flip `runtime` to `ai` and does not open the gateway gate.
- **One new egress destination:** `https://api.telegram.org`, pinned in code (`packages/core/src/channels/pinned.ts`) with the same dev-only override rule the model gateway has. No redirects, 15 s timeout, 1 MB cap, JSON only. Inbound is pull-only (`getUpdates`) — no webhook and no new listening port.
- **No new table and no migration**, because Phase 3 tenancy owns `packages/db`. State is files under `localDataDir()/channels/<workspaceId>/`, every record carrying `organizationId` and `workspaceId`; `channels` is in `HOST_RESET_ENTRIES` and is dropped when the desk is deleted.
- **New routes.** `GET|POST|DELETE /api/v1/channels/telegram/bot`, `POST /api/v1/channels/telegram/poll`, `GET|POST /api/v1/channels`, and four by-id routes for the tenancy harness to cover: `GET /api/v1/channels/:channelId`, `DELETE /api/v1/channels/:channelId`, `GET /api/v1/channels/:channelId/messages`, `POST /api/v1/channels/:channelId/send`.
- **Proven on webdev, not on Telegram.** The loop was driven end to end through the real UI against `scripts/telegram-sandbox.ts`, a local stand-in for the Bot API: connect → add channel → send → a message arrives → poll → both messages in the conversation, and a second poll does not duplicate. A live BotFather bot has never been used; that check is owed and is Kyo's to run (the PR spells out the steps).
- Suites at the time of the change: core 2092, host 1736 (the two failures, `edit/ffmpeg-binary` "on Windows" and `edit/import-ipc`, fail identically on `main` from Linux), web 884, db 65. `pnpm lint` adds no new warnings.

## 2026-09-21 — Meeting: record in the browser

- **The studio can record a meeting, not only accept a file.** A Record control sits beside the existing file input on `/meeting`, with a source toggle (microphone, or microphone + tab audio), a live timer and running size, pause/resume, and stop. Nothing downstream changed: the finished blob becomes a `File` named `recording-<iso>.webm` and goes through the **same** `POST /api/v1/meetings/:id/recording` the file input uses, so the caps, the tenancy scoping, the transcribe/minutes run and the Knowledge card are all untouched.
- **Audio only, by construction.** `getDisplayMedia` must be asked for video to offer a tab picker at all, so the video track is stopped the instant the stream arrives and is never recorded; the shared tab's audio is summed with the microphone through an `AudioContext` `MediaStreamDestination`, which is what puts an online meeting's *remote* voices in the recording.
- **It cannot produce a 413.** Recording is opus at 24 kbps (`RECORDING_AUDIO_BITS_PER_SECOND`) — about 10.8 MB an hour — and the running byte count auto-stops the recording 512 KB short of the host's 25 MB cap, keeping everything captured up to that point and saying so. `RECORDING_MAX_BYTES` in `apps/web/lib/meeting-recorder.ts` is a **deliberate duplicate** of `MEETING_RECORDING_MAX_BYTES` in `packages/host/src/meeting/store-files.ts`: the renderer must not import `@agentforge/host`, and `@agentforge/core` exports no meeting file limit. A test pins the number so the two cannot drift silently.
- **No host change was needed.** Verified on webdev against the real route: a `File` of type `audio/webm;codecs=opus` is accepted **201** (`isMeetingMedia` splits the `;codecs=` parameter off before checking `MEETING_AUDIO_TYPES`, which already carries `audio/webm`). Cosmetic only: `EXT_BY_MIME` maps `audio/webm` to `weba`, so a `.webm` upload is stored as `recording/source.weba`. ffmpeg reads by content, so nothing downstream cares.
- **Found by driving, not by the tests.** The first build disposed the recorder controller on unmount with a terminal flag. Under `<StrictMode>` (`apps/web/src/main.tsx`) React mounts, runs the unmount cleanup and mounts again against the *same* controller, so Record was silently inert — pressed, and nothing happened at all, no error, no state change. All 36 unit tests passed. The controller now uses a generation token: `dispose()` is an ordinary boundary that orphans in-flight steps and releases hardware, never a death. Three regression tests cover it.
- **New files:** `apps/web/lib/meeting-recorder.ts` (framework-free controller), `apps/web/lib/use-meeting-recorder.ts` (the React skin), `apps/web/components/meeting-recorder.tsx` (the panel), and `meeting.record.*` in both locale catalogs. `meeting-studio.tsx` gained the mount and a clip → upload effect and stayed well under the file-size rule.
- **[ ] Microphone capture has never run.** The Browser pane blocks `getUserMedia` outright (`NotAllowedError` in 19 ms), so what is proven in a browser is: the panel renders and the source toggle works, a denied microphone produces the mapped copy and a working Dismiss, and the host accepts the recording mime. What is **not** proven anywhere: a granted microphone, the `getDisplayMedia` tab picker and its "share tab audio" tick, the AudioContext mix, that the produced webm is decodable by ffmpeg, and the full record → upload → transcribe → minutes loop. That needs a human at a real Chrome window, or a browser-automation pass with a fake device (`--use-fake-device-for-media-stream`).
- Map: [`maps/meeting-minutes.md`](maps/meeting-minutes.md) § Recording.

## 2026-09-21 — Music: the gateway's relay model reaches the picker

- **The bug the owner saw.** `/music` showed a greyed-out model dropdown with nothing in it, which reads as "the app does not see my gateway's music model". `GET /api/v1/music` answered `{"items":[],"models":[],"defaultModel":"suno_music","ready":true}` and `GET /api/v1/models` answered `modes.music: []` on a desk whose key works and whose catalog has 148 ids.
- **Root cause: the Music list was built by filtering the live catalog, and a relay model is never in it.** `GET /v1/models` on a new-api / one-api gateway lists the OpenAI-shaped models only. `suno_music` is a *task* model driven through its own mount on the gateway origin (`POST /suno/submit/music`, `GET /suno/fetch/<id>`) and billed per call, so it does not appear there even for a key that can use it. `listMusicModels` and `modeCatalogPayload` filtered the catalog with `isMusicModelId`, so the list could never contain the one id the whole mode runs on — while `defaultModel` resolved to `suno_music` anyway through `pickPreferredMusicModel`'s fallback. A list that cannot contain its own default is the dead picker.
- **Generation itself was never blocked.** `musicGenerateBodySchema` takes any non-empty `model` string, `generateStudioMusic` falls back to `defaultStudioMusicModel()`, and nothing between the route and the relay checks the id against the live catalog. The fix is the list and the picker, not the job path — and no new rejection was introduced.
- **Fix.** New named constant `RELAY_ONLY_MUSIC_MODEL_IDS` in `packages/core/src/models/media-kind.ts` (today just `suno_music`), merged into the catalog music ids by `withRelayMusicModels` in `packages/host/src/selectable-models.ts`: immutable, deduped case-insensitively, and the catalog's own row always wins a collision so its price and curation survive. `handleGetMusic` now resolves the default first and merges it in too, so an agent or Settings pin naming a relay id this build does not know is still shown rather than leaving the select on a value it has no option for. The constant is fixed in the repo — never read from a request, a response or settings.
- **No network probe was added.** A cheap relay-existence check (a `GET {origin}/suno/fetch/<bogus>` that answers structured-not-found rather than a route 404) is possible, but it would be a call on the request path for a decision a constant already answers; `RELAY_MISSING` in `gateway-audio.ts` already names the exact path tried when a submit 404s.
- **UI.** An empty model list now renders `music-studio-no-models` — a titled explanation in both locales (`music.noModels.*`) with Submit and Draft-lyrics disabled — instead of a silently disabled select. Gateway errors from generation now reach the banner whichever shape they arrive in: `readApiErrorMessage` (`apps/web/lib/music-models.ts`) reads both the enveloped `{error:{code,message}}` of an `ApiError` and the flat `{error:"gateway_blocked",status,message}` of a gated route. Before this, a 403 from the gate — and anything else using the flat shape — came out as the generic "Music generation failed".
- **[ ] Still not driven live.** The relay has still never been called against `api.tokotokenai.com`; every test stubs `fetch`. The `:3000` host has no watcher, so this needs a host restart before the picker change is visible, and then one real generation to confirm the gateway accepts the submit.
- Map: [`maps/music-mode.md`](maps/music-mode.md).

## 2026-09-21 — Meeting: the pipeline actually runs, driven against the live gateway

- **The bug the owner saw.** Meeting produced no minutes and no translation. Both legs were real code; neither was ever reached, because the run died at the first phase. The fault was arithmetic, not the gateway: `timeoutForMedia` turns a probed duration into milliseconds (`2 * 65.556063 * 1000 + 30_000` = `161112.126`), and `child_process.execFile` refuses a non-integer `timeout` with `ERR_OUT_OF_RANGE` **before spawning anything**. The catch-all in `packages/host/src/edit/ffmpeg/run.ts` reported that as `ffmpeg_failed` / "ffmpeg recipe failed", so every recording whose audio was not a whole number of seconds long — i.e. every real recording — failed at `extracting` with an error blaming ffmpeg for a request ffmpeg never received. `runFfmpeg` now rounds the budget up once, for every caller, and the failure message carries the exit code and the tail of stderr. **`packages/host/src/edit/ffmpeg/recipes.ts` had the same arithmetic**, so Edit's probe, extract and render recipes were broken the same way for any clip of fractional length.
- **Second root cause: the model the picker chose cannot transcribe on this gateway.** `mimo-v2.5-asr` is not in the live catalog (139 ids, 2026-09-21), so `pickTranscriptionModel` fell through to `qwen3-livetranslate-flash`, which answers `503 get_channel_failed` — "Supply pool unavailable" — as do `qwen3.5-omni-flash` and `qwen3.5-omni-plus`. `gpt-audio` answers `200` with a refusal sentence. So even with ffmpeg fixed, transcription could not have succeeded.
- **What works, proven with one short chunk each:** `gemini-3.5-flash` (verbatim, and the only id that labels speakers), `gpt-audio-mini` (verbatim, fastest), `gpt-audio-1.5` (verbatim when streaming; non-streaming wraps the text in a JSON object), `qwen3-omni-flash-2025-12-01` (verbatim, and only with a data URI). `TRANSCRIPTION_PREF` is now that order, pinned by `packages/core/src/meeting/asr-model.test.ts` against a catalog snapshot.
- **The request shape is per model family, which cost a live 400 each to learn.** The OpenAI audio family takes bare base64 in `input_audio.data` and answers `400 invalid_value` to a data URI; the DashScope-backed qwen/omni family takes a `data:` URI and answers `400 InvalidParameter` ("The provided URL does not appear to be valid") to bare base64, and is asked to stream. `transcriptionShapeFor` (core) returns wire + encoding + stream; the new `packages/host/src/meeting/transcribe-request.ts` builds the call and accumulates SSE deltas.
- **One dead model no longer kills a run.** Transcription walks a chain: a model that refuses, times out or answers with nothing is dropped and the next is asked, and the first that answers is preferred for every remaining chunk. A pinned `AGENTFORGE_MEETING_ASR_MODEL` still means exactly one model. A `200` with no text counts as a refusal, which is how `gpt-audio`-style soft refusals are caught.
- **Three review findings from PR #66 closed.** `isTranscriptionModelId` now refuses every `*-realtime` id (WebSocket only), TTS ids, and anything whose `mediaKind` is image, video or other — the `usable[0]` fallback that could hand a meeting to a video model is gone (finding 2); the omni family sends `stream: true` (finding 3); a caller's abort signal is now *composed* with the 300 s per-request budget instead of replacing it, so a hung gateway call no longer waits for the browser to disconnect (finding 7). Gateway refusals now reach the SSE `job.error` frame naming the model and repeating the gateway's own message.
- **Driven end to end on webdev, twice.** `en` meeting (65 s, three named speakers): transcript from `gemini-3.5-flash` with speaker labels, minutes from `gpt-5.6-sol` with 3 attendees / 2 decisions / 3 action items with owners and dates / 1 risk / 1 open question and no guarded names, then the Indonesian translation. `id` meeting (73 s): Indonesian transcript, Indonesian minutes, English translation. Translation target is `otherLocale(meeting.locale)` and fired on its own both times.
- **[ ] Indonesian audio is still unverified.** This machine has no Indonesian SAPI voice, so the `id` sample is Indonesian text read by an `en-US` voice; the transcript was good Indonesian but mangled one name ("Dewi Lestari" → "Dwiistri"), which is the synthetic pronunciation, not the recogniser. **[ ] A multi-chunk recording has not been driven** — both runs were a single chunk, so segmentation and the chain's "prefer the model that just worked" path are covered by unit tests only. **[ ] Edit's captions still send the wrong wire** (PR #66 finding 1) — untouched here.
- Map: [`maps/meeting-minutes.md`](maps/meeting-minutes.md) § What was driven.

## 2026-09-21 — Security register lane E: three fixes for the hosted deploy (SR-14, SR-04, SR-13)

Three rows of [`security-register.md`](security-register.md) moved to `fixed-unverified`. None has been
driven on a deployment; each becomes `fixed` after a hosted drive. Map pages refreshed in the same
change: [`maps/hosted-security-controls.md`](maps/hosted-security-controls.md) (§1 the switch, §6
what goes back out, both tables) and [`maps/meeting-minutes.md`](maps/meeting-minutes.md) (§3 upload).

- **SR-14 (High) — hosted responses now allow the two features Meeting recording needs.** The
  `Permissions-Policy` sent by the app (`packages/host/src/security-headers.ts:74-93`) and by the
  proxy (`webapp-deploy/Caddyfile:67`) turned every powerful feature off, including `microphone`
  and `display-capture`. The browser refuses those before any product code runs, so the new
  in-browser recorder would have shipped with a Record button that does nothing and no error worth
  reading. Both files now send `microphone=(self)` and `display-capture=(self)`; the other sixteen
  features stay `()`, `camera` included, because the recorder asks for audio only. `(self)` is this
  origin alone — `apps/web` renders no `<iframe>`, so there is no `allow=` attribute to delegate
  either feature; an artifact body is served under `Content-Security-Policy: sandbox`, an opaque
  origin `self` never matches; and `frame-ancestors 'none'` keeps the app out of anyone else's
  frame. **The CSP needed no change**: `media-src 'self' blob:` and `worker-src 'self' blob:` were
  already there, `MediaRecorder` and `AudioContext` have no CSP directive, and the upload is the
  same-origin `POST /api/v1/meetings/:id/recording` that `connect-src 'self'` covers. Four tests
  added and one rewritten (it asserted `microphone=()`): the whole policy string is pinned, the two
  allowances are pinned as `(self)` with no `*`, no `https://` and no `src`, every other feature is
  checked to still be `()` one by one, and the proxy's copy is checked separately — on top of the
  existing parity test that reads the Caddyfile, so the two files cannot drift.
- **SR-04 (High) — a hosted process with an unusable environment refuses to listen.** Only two
  variables were checked at boot; everything else was read at first use, so a container with no wrap
  key answered `/healthz`, passed Caddy's active check and failed for the first person who signed
  in. New `assertHostedEnvComplete` (`packages/host/src/hosted-env.ts`, called at
  `apps/web/server.ts:45` beside the existing guard, re-exported through
  `apps/web/lib/hosted-mode-guard.ts:14`) refuses in server mode unless `AGENTFORGE_SECRETS_KEY`
  passes `getLocalVaultKey`, at least one https origin survives `trustedOrigins`,
  `AGENTFORGE_PORTAL_URL` passes `assertAllowedEndpointUrl`, both portal client credentials pass
  `portalClientCredentials`, an explicitly set `AGENTFORGE_PUBLIC_URL` passes `publicBaseUrl`, and —
  on `NODE_ENV=production` only — `AGENTFORGE_BILLING_WEBHOOK_SECRET` is set. **Every rule is
  borrowed from the code that will later enforce it and none is restated**, so the two cannot give
  different answers. One aggregated message names every broken variable at once, and never prints a
  value. Off production a missing billing secret is a loud startup warning instead of a refusal,
  because a box with no payment provider bound is a real deployment. Proven by running the real
  entrypoint, not only the suite: `NODE_ENV=production AGENTFORGE_SERVER=1` with nothing else set
  exits 1 naming six variables and never opens a listener; with all six supplied it gets past both
  guards. 32 table-driven cases in `packages/host/src/hosted-env.test.ts`, 4 more pinning the wiring
  in `apps/web/lib/hosted-mode-guard.test.ts`. **Local mode is untouched** — a bare env,
  `development`, `test`, the flag off and a desk with a weak key all pass without a warning.
  `webapp-deploy/compose.yml` and `.env.example` already carry every name, so neither was edited;
  the operator-visible consequence is that a deployment whose optional `.env` is missing now refuses
  to boot rather than starting half-configured.
- **SR-13 (Low) — replacing a meeting recording no longer leaves the old bytes on disk.** A meeting
  holds one recording, but the file is named after the mime type, so re-uploading a `.webm` over an
  `.mp3` wrote `source.weba` beside a `source.mp3` that only "delete the meeting" ever removed —
  a tenant's audio outside the record and outside quota accounting. `addRecording`
  (`packages/host/src/meeting/store.ts:179-209`) now writes the new bytes **first**, then removes
  every other `source.<ext>` in that meeting's `recording/` (`removeStaleRecordings`,
  `store-files.ts:149-192`) and drops the derived `audio/` chunks (`removeDerivedAudio`, `:194-212`),
  which are a cache of the recording just replaced. Write-then-clean on purpose: a failed write must
  leave the tenant with the recording they had, not with neither. Bounded to that one directory
  (every candidate re-checked by `recordingFile()`), to names matching `/^source\.[a-z0-9]{1,5}$/`,
  and to `entry.isFile()`, so a symlink is skipped and a directory can never make it recursive;
  ENOENT is the outcome asked for. 9 cases in the new `packages/host/src/meeting/store.test.ts`,
  four of which failed before the change.
- **[ ] None of the three is driven.** Nothing has sent either header to a browser, no container has
  refused on a missing variable, and no recording has been replaced through the UI. The `:3000`
  webdev is unaffected either way — both new checks are no-ops off server mode — so no restart is
  owed for them.

## 2026-09-21 — Phase 9: portal login, and plans on screen

- **The hosted app has a sign-in.** One button (`auth-signin-start`) → `GET /api/v1/auth/start`, which mints a login `state` into `__Host-agentforge_login_state` and hands back the portal's authorize URL → the portal's e-mail and six-digit-code forms → `302` to `/auth/callback?code&state` → `POST /api/v1/auth/login`, which compares the state with the cookie and exchanges the code **server-side** with a confidential client. Success is a full page reload, because the CSRF token is bound to the session id. No password, ever.
- **This closes the worst screen in the product.** A signed-out hosted visitor used to land on the paste-your-key onboarding form — the first thing a stranger saw on the public deployment was a box asking for a gateway API key. The boot order is now ping → session → settings, and `/api/v1/settings` is not called at all until the session says there is one. Security register SR-06; webdev and the frozen desktop reach settings exactly as before.
- **One hosted-only shell fix was load-bearing.** `vite.config.ts` sets `base: "./"` for the packaged desktop, so at `/auth/callback` the shell's own `./assets/…` resolved to `/auth/assets/…`, which the SPA fallback answered with the shell again as `text/html`. Without `rootRelativeAssets` the hosted deployment cannot be signed in to at all.
- **New workspace app `apps/portal`** — a wire-compatible stand-in for the Toko Token control plane, on real Postgres from day one, running `docs/internal/portal/migrations/0001-0005` unchanged plus its own `0006-0008`. It never imports the product and the product never imports it. Browser flow, device-code flow, OTP over real SMTP to Mailpit, Ed25519 access tokens, JWKS, RLS on every table. 20 test files, 274 tests, all green on 2026-09-21 against real PostgreSQL as a non-superuser.
- **Two placeholder plans.** `packages/core/src/plans/catalog.ts` — Personal and Enterprise, every number `placeholder: true`, and **no token allowance** (owner ruling): both tiers leave `allowance_usd_micros` null and there is no allowance bar anywhere. New screens: `/pricing`, the plan panel on Settings, and blocked screens for `plan_past_due` / `plan_cancelled` / `plan_allowance_exhausted` / `plan_unavailable` — never the onboarding screen. `GET /api/v1/billing/plans` is session-gated and deliberately not behind the gateway gate.
- **A past-due tenant's job used to answer "Request failed".** Plan refusals are flat (`{ error: "<code>", message }`) while nearly every other route is enveloped, and the job-stream parser only read the envelope. It now reads the flat shape for plan codes and reports the block before narrowing.
- **[ ] Nothing is deployed.** Driven end to end in Chromium on a local review instance (`scripts/review-instance.ps1`, the app in server mode on 3100 behind a TLS proxy on 3443, the portal on 4000), which is also what caught the CSP `form-action` bug that made sign-in silently impossible in a real browser (SR-20). The real portal at `api.tokotokenai.com` has never answered any of this.
- **[ ] Ten new security findings**, SR-22 … SR-31 in [`security-register.md`](security-register.md), plus the answer to the one test failure SR-12 left open: an Edit import that fails *after* the probe charges the tenant and leaves an orphan object (SR-27).
- Maps: [`maps/portal-service.md`](maps/portal-service.md) (new), [`maps/portal-session-auth.md`](maps/portal-session-auth.md) § the renderer's half, [`maps/tenant-entitlement.md`](maps/tenant-entitlement.md) § lane G. Recipes: `features/login.md`, `features/plans.md`. The whole round is tracked in [`worklog-2026-09-21.md`](worklog-2026-09-21.md).

## 2026-09-21 — Portal fix pass X: sign-out that signs you out, and mail that is not in the clear

Eight findings from the Phase 9 review round, each a failing test first. Register rows
[SR-21](security-register.md#sr-21), [SR-33](security-register.md#sr-33) and the new
[SR-39](security-register.md#sr-39) … [SR-44](security-register.md#sr-44); the detail is
[`worklog-2026-09-21.md`](worklog-2026-09-21.md) § 8.

- **Signing out now signs you out.** The portal kept a 30-day browser session of its own that nothing
  could end, so after signing out of the app, pressing **Sign in** signed the same person straight
  back in with no address and no code — and on a shared browser, signed in the *next* person as the
  last one. Three halves: a portal `GET`/`POST /logout` that clears the cookie on every answer and
  redirects only to a URI on the client's registered origin; a per-user version counter
  (`web_session_versions`, migration 0009) carried in the cookie, so `POST /auth/logout` with
  `all_devices: true` ends every browser that user holds on the next request; and the app's sign-out
  sending the browser through that portal logout and back to `/sign-in`. Both paths audit
  `web_session.revoked`. **Everyone signed in at deploy time signs in once more:** a cookie minted
  before the version field existed is refused rather than trusted.
- **Mail is never sent in the clear.** The SMTP transport passed `ignoreTLS` whenever
  `PORTAL_SMTP_SECURE` was off, which means "never attempt STARTTLS" rather than "TLS if offered" —
  so a real provider on 587 would have received the sign-in code and the SMTP AUTH user and password
  on a plain socket. STARTTLS is now **required** for any host off loopback, `ignoreTLS` survives
  only for the Mailpit sandbox, and production refuses to start on a cleartext mail host.
- **`GET /tenant/config` stopped being a tenant-name oracle.** It had no rate limiter and answered
  400 for an unknown slug and 403 for a suspended tenant, so a wordlist enumerated the portal's
  whitelabel partners. One refusal for both now, and a per-IP limiter on both branches.
- **`PORTAL_PUBLIC_URL` and `PORTAL_TRUST_PROXY` are validated at boot**, in `loadConfig` with every
  other variable. The public URL must be a bare origin — https anywhere, http on loopback only — and
  is **required in production**, because the access token's `iss` is built from it. A typo in the
  trust-proxy flag is a boot error instead of a silent "off".
- **Smaller ones.** `pnpm portal:seed --redirect` refuses anything but https, or http on loopback
  (it used to accept `javascript:` and `data:` into the allowlist `/authorize` redirects to with a
  code). A request body over the 64 KB ceiling answers `413` with the standard error body rather than
  `500`. The dead `state_mismatch` branch on authorization codes is gone — the host's `__Host-`
  cookie is the real `state` control and always was — with the `state_hash` still stored for audit.
  `scripts/review-instance.ps1` no longer seeds the literal Postgres password `portal`; it keeps what
  `review.env` holds, generates one for a fresh review root, and stops with an instruction when the
  volume already exists (harness, never ships).
- **[ ] Nothing is deployed, and the app-side hop is unproven.** Portal suite 23 files / 320 tests
  green against real PostgreSQL as a non-superuser; `tsc` and `biome` clean. The browser drive of
  sign-in → sign-out → sign-in-again on the review instance is recorded in the worklog.
  Map: [`maps/portal-service.md`](maps/portal-service.md).

## 2026-09-21 — deploy note: the hosted server cannot be restarted on this code until six variables are set

**Read this before the next restart of the hosted deployment.** `assertHostedEnvComplete`
(`packages/host/src/hosted-env.ts`) runs at boot, before `server.listen`, and **throws** when the
hosted environment is incomplete. A container started with `AGENTFORGE_SERVER=1` and any of the
following missing does not serve a degraded app — it does not start, `GET /healthz` never answers,
and Caddy's active check keeps the previous container in place while the log carries the only
explanation.

Required in hosted mode:

- `AGENTFORGE_PORTAL_URL` — https, judged by `assertAllowedEndpointUrl`.
- `AGENTFORGE_PORTAL_CLIENT_ID` and `AGENTFORGE_PORTAL_CLIENT_SECRET` — the app's confidential
  OAuth client at that portal. The portal prints the secret once.
- `AGENTFORGE_SECRETS_KEY` — the wrap key, 32 bytes of entropy; there is no `.master-key` fallback
  in server mode.
- At least one **https** entry in `AGENTFORGE_TRUSTED_ORIGINS` that survives the allowlist. Server
  mode drops cleartext and anything that is not an origin, and an empty list means every mutating
  `/api` call 403s.
- On `NODE_ENV=production` only: `AGENTFORGE_BILLING_WEBHOOK_SECRET`. Off production its absence is
  a startup warning rather than a refusal.

`webapp-deploy/.env.example` said until today that the three portal variables could be left empty
because that "changes nothing today". It has been rewritten: that sentence predated the boot check
and was false from the moment it landed. Security register [SR-46](security-register.md#sr-46).

## 2026-09-21 — fix pass: a recording that survives a failed upload, and four smaller fixes

- **A finished Meeting recording is no longer destroyed by the upload meant to save it.** The studio
  used to clear the recorder *before* the POST, so a 413, a 401 on an expired session, an offline
  laptop or a second clip arriving mid-upload each deleted the only copy of the audio.
  `MeetingUploadController` (`apps/web/lib/meeting-upload.ts`) holds the clip until the host answers
  2xx; a busy studio queues rather than drops; a failure keeps the bytes and offers **Retry upload**
  and **Save to device**. `res.ok` is checked before the body is read. The "stopped at 25 MB" notice
  now outlives the clip it describes. [SR-45](security-register.md#sr-45).
- **A tenant with no plan row is no longer called a paying Personal subscriber.** `tierId` and
  `current` are read off the stored `tenant_plan` row and are `null` when there is none; enforcement
  still reads the fail-open default, unchanged. Settings renders "No plan on this account yet" and
  `/pricing` marks no card as theirs. [SR-47](security-register.md#sr-47).
- **A failed ffmpeg run no longer returns the server's own paths.** The argv and the stderr tail go
  to the redacted host log; the client gets a fixed sentence and a path-free reason class.
  [SR-48](security-register.md#sr-48).
- **An Edit import that fails after the charge refunds it.** A probe with no usable dimensions or
  duration is `unsupported_media`, and every failure after `saveEditFile` removes the stored object
  and its `media` row. [SR-27](security-register.md#sr-27).
- **The plan paywall can be raised from any call**, not only from a job stream: `notePlanResponse`
  reads a clone of every 403/503 in `apiFetch`. `/pricing` no longer asks for the current tier while
  signed out, which was a 401 on every anonymous visit. `AGENTFORGE_BILLING_TOPUP_URL` is
  scheme-checked at the source ([SR-31](security-register.md#sr-31)), and the hosted boot guards
  moved out of the renderer's `apps/web/lib` into `apps/web/server`, with a test that keeps the host
  out of anything a browser bundles.
- **[ ] None of it is driven on the hosted deployment**, which does not exist yet. The review
  instance was rebuilt and restarted on this code; what was checked there is in the worklog.
