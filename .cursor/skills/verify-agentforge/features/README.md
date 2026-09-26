# DPSBuddy verification map

Agent-facing map (where to press). Not product. Pair with pstack `how` for how a subsystem works; keep this directory honest with `/maintain-verification-skill`.

This directory is the maintained source for verifying user-facing DPSBuddy behavior. Read this index before driving, then use the matching feature file as the recipe.

Documents, Research, Finance, Data, Market, Legal, Images, Videos, Music, Meeting, Presentation, and Edit are product modes. **Default already unlocks all of them.** A Legal (or other) workspace can hide some tabs. Knowledge is Account-rail, not a mode checkbox. Custom agents do not unlock the rail. Edit shipped in 0.14.22 and `mode-edit` is a real rail tab on Default; the parts of the Edit studio still owed are named in [edit.md](./edit.md), not here.

## Baseline preconditions

- **Webdev:** the operator's instance answers at `http://127.0.0.1:3000` (never a LAN IP). Doctor with no args. An isolated instance you started yourself on another port is doctored with `--base http://127.0.0.1:<port>`.
- **Packaged desktop:** Electron window; doctor `--desktop` reads `host-status.json` (`transport: "ipc"`). No HTTP port.
- SQLite is `data/agentforge.sqlite` (webdev) or Electron userData (packaged: `%APPDATA%\DPSBuddy`, `$XDG_CONFIG_HOME/DPSBuddy` or `~/.config/DPSBuddy`, `~/Library/Application Support/DPSBuddy`).
- **No product login on webdev or the desktop.** A gateway key is optional; stub Chat works without one. The hosted deployment is different: since Phase 9 it has a sign-in, and it is the portal door — an e-mail and a six-digit code, never a password field, and never an e-mail domain used to pick a tenant. Drive it with [login.md](./login.md) on the review instance, never on `:3000`.
- The **gateway gate** decides whether a desk opens at all: `allowed: false` puts the whole app on onboarding and answers `403 gateway_blocked` on every gateway-calling route. See [gateway-gate.md](./gateway-gate.md).
- Windows: drive webdev with the IDE browser where you have one. A Claude Code session has no IDE browser — it drives `:3000` (the isolated webdev) with a short scratch Playwright script (see SKILL.md **Drive**) and never runs `pnpm test:e2e`. `:3000` may hold a real, billed key: read doctor's `runtime` first and keep model calls to what the owner asked for.
- Cloud (and `pnpm ci:local --e2e`): `AGENTFORGE_RUNTIME=stub` and Playwright `foundation.spec.ts` against **webdev** :3000.
- Never drive an instance this run did not doctor. Never start a second process on :3000. Never treat :3000 as the installed app.

## Driving conventions

- Start from the feature file's preconditions.
- Use `data-testid` handles. Treat testid strings as literal.
- Rail tabs are the current workspace `productModes`. Default has every work mode. `mode-agents` count is 0.
- Restore nothing on the operator's Windows SQLite. Cloud isolation is the VM.
- Keep proof artifacts under `evidence/<feature>/<run-id>/`.
- Testids are locale-invariant. Every recipe here holds on an `id` desk; only the visible strings change. See [locale.md](./locale.md).

## Proof and skip reporting

- Capture the user action and the resulting state.
- UI proof: snapshot + screenshot with Chat / Settings / workspace identity visible.
- Mutation proof: a second user-facing view (thread list, workspace list, gallery).
- Record the feature ID and entry point on every artifact.
- An unreachable rail tab (`mode-images` missing on a Legal desk) is expected — not a skip. On Default, missing Images is a fail.
- `/studio` and `/agents` redirect to Chat. That is parked GTM, not a harness bug.
- Do not report Settings saved or a live generate unless the operator asked and doctor reported `runtime: "ai"`.

## Feature entry contract

Each file: H1 + one paragraph, then exactly four H2s — `Sub-features`, `How to get to it (user POV)`, `Driving it with the DPSBuddy harness`, `Gotchas`.

## Features

- [Chat](./chat.md) — empty state with four intent cards that fill the composer, composer send, Thinking disclosure holding the tool rows, new thread, switch sessions in the rail. Default rail shows every work mode.
- [Settings](./settings.md) — gateway key, privacy note, stub/live runtime, gateway status row, language row, compact this-key + Open Usage. No Advanced tab.
- [Gateway gate](./gateway-gate.md) — the host's open/closed decision: onboarding reasons, `settings-gateway-status` + re-check, 7-day grace, `403 gateway_blocked`, Start over. Advisory, fails open, never an entitlement check.
- [Login](./login.md) — **Enterprise lane (hosted only).** The one door: `auth-signin` → the portal's e-mail and six-digit-code forms → `/auth/callback` → signed in. Needs the review instance, a seeded tenant and a **real browser**; on webdev and the desktop every testid has count 0. No password, ever.
- [Plans](./plans.md) — **Enterprise lane (hosted only)**; owned by the Phase 9 pull request, not the 0.15.0 Personal cut. `/pricing` and its `pricing-*` cards, `account-plan` on Settings, and the blocked screens. Every number is a placeholder. `?preview=` reaches the blocked screens on a local build only.
- [Locale](./locale.md) — the Settings language select, the restart banner, and an `id` walk of the rail, Chat and one job mode. Testids do not move.
- [Rail](./rail.md) — the left column: four groups, thirteen modes on Default, Finance / Market submenu chevrons with a short visible word, closed until pressed, no `New` badge, collapse/expand, resize and width prefs, light-by-default theme toggle, and the `productModes` → visible-tabs → hidden-mode-redirect chain.
- [Channels](./channels.md) — account-rail `/channels`: connect a Telegram bot to the desk, add a group or channel, send, and poll for replies. Not a product mode; drive it against `scripts/telegram-sandbox.ts` rather than a real bot.
- [Usage](./usage.md) — bottom-rail `/usage` Day/Week/Month stacked spend, this-key strip, desk by-model. Not a product mode.
- [Workspaces](./workspaces.md) — rail switcher + `/workspaces` create/edit, presets and mode checkboxes, open → Chat.
- [Models](./models.md) — curated Chat picker (Recommended + brand groups), doctor modeKeys/chatCount/curation on webdev. No `model-picker-all`.
- [Templates](./templates.md) — example galleries on all five mode studios; click pre-fills the prompt.
- [PII](./pii.md) — host masks outbound prompts (`[email]` / `[phone]` / …); the transcript keeps the typed text.
- [Security](./security.md) — saved-key fingerprint on Settings (`key-fingerprint`); TLS note on `privacy-note`; at-rest envelope is existing work.
- [Components](./components.md) — first-run installer for native dependencies (anydoc): status route, staged install stream, onboarding panel that starts itself. No key needed; renders nothing when the reader shipped inside the app.
- [Research](./research.md) — studio shell on Default; live generate needs a key (and search backends).
- [Documents](./documents.md) — starters, preview, section regen (503 without a key), DOCX download from a starter. Default has the tab.
- [Finance](./finance.md) — five tasks under the rail entry (brief, ratios, budget, cash flow, appraisal), file import (`.xlsx` / `.csv` / documents, read locally), deterministic figures with a model-written narrative, export menu (xlsx / pptx / docx). No starter path; generate needs a working key. Default has the tab.
- [Data](./data.md) — pasted CSV + table notes, no web search, generate 503 without a key. Default has the tab.
- [Market](./market.md) — watchlist ≤15 tickers → briefing → guarded brief + DOCX, disclaimer always, generate 503 without a key. Default has the tab.
- [Legal](./legal.md) — .docx matter review with a verify/edit loop; uploads and roles without a key, run 503 without one. Default and the Legal preset have the tab.
- [Knowledge](./knowledge.md) — Account-rail Soul / Memory / Sources / Map + choosable embedding/brain/verifier; Chat injects RAG retrieve. Not a product mode.
- [Knowledge phases](./knowledge-phases.md) — **Cloud testing path** for builtin Phases 0–4 (Vitest + stub webdev). No WeKnora sidecar. Live `[n]` cites are Windows-only.
- [Knowledge ingest loop](./knowledge-ingest.md) — every finished Chat turn / job writes a text work card (pointer, not bytes); `knowledge-loop` chart on Sources; Chat skips its own card; example clips never ingest.
- [Knowledge graph](./knowledge-graph.md) — Phase 4 builtin: completed Chat replies with `[n]` markers add `cites` edges; one-hop `covers` expansion is behind `knowledge.graphExpand` (off in Chat); panel is the existing Phase 2 base. Drive on webdev :3000.
- [Images](./images.md) — studio shell on Default; needs-key without a gateway key.
- [Videos](./videos.md) — studio shell and `videos-studio-needs-key` without a key.
- [Meeting](./meeting.md) — recording → transcript → minutes → EN/ID translation (`mode-meeting`). Create, upload, paste and the in-browser recorder's controls work without a key; only the run reaches the gateway. A **granted microphone** needs a real Chrome window and is still unverified.
- [Music](./music.md) — studio shell and `music-studio-needs-key` without a key; describe-or-lyrics brief, two takes per charge, voice-over reported unavailable rather than offered.
- [Edit](./edit.md) — CapCut-style timeline + agent panel (`mode-edit`), shipped in 0.14.22. Storyboard generate is still a Phase 3 placeholder and `animate_storyboard` is backend-only.
- [Presentation](./presentations.md) — starters, preview, slide regen (503 without a key), PPTX download from a starter.
- [Desktop](./desktop.md) — Electron one-window launch, splash → Chat, IPC host (no loopback HTTP). Windows NSIS exists; mac/linux are builder targets.
- [Desktop brands](./desktop-brands.md) — packaged Kemenkeu AI / AIHub Metranet vs public DPSBuddy. Rail `product-brand` + `product-logo` must match the installed flavor, not leftover DPSBuddy copy.
- [Mobile](./mobile.md) — docs only. No iOS/Android build, no stores, no Capacitor. A phone on LAN `:3000` is not a product surface.
- [Build](./build.md) — **parked / verified-unreachable.** `/studio` redirects to Chat.
- [Studio advanced](./studio-advanced.md) — **parked / verified-unreachable.** Same redirect.
