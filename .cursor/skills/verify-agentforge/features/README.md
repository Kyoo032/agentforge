# Agentforge verification map

Agent-facing map (where to press). Not product. Pair with pstack `how` for how a subsystem works; keep this directory honest with `/maintain-verification-skill`.

This directory is the maintained source for verifying user-facing Agentforge behavior. Read this index before driving, then use the matching feature file as the recipe.

Documents, Research, Finance, Data, Images, Videos, Presentation, and Edit are product modes. **Home already unlocks all of them.** A Legal (or other) workspace can hide some tabs. Knowledge is Account-rail, not a mode checkbox. Custom agents do not unlock the rail. Edit rail `mode-edit` lands in Phase 1; Loop 0 only ships the map + doctor + fixtures.

## Baseline preconditions

- **Webdev:** app answers at `http://127.0.0.1:3000` (never a LAN IP). Doctor with no args.
- **Packaged desktop:** Electron window; doctor `--desktop` reads `host-status.json` (`transport: "ipc"`). No HTTP port.
- SQLite is `data/agentforge.sqlite` (webdev) or Electron userData (packaged: `%APPDATA%\Agentforge`, `$XDG_CONFIG_HOME/Agentforge` or `~/.config/Agentforge`, `~/Library/Application Support/Agentforge`).
- No product login. A gateway key is optional; stub Chat works without one.
- Windows: drive webdev with the IDE browser. Drive packaged in the Electron window. Do not run Playwright.
- Cloud / GHA: `AGENTFORGE_RUNTIME=stub` and Playwright `foundation.spec.ts` against **webdev** :3000.
- Never drive an instance this run did not doctor. Never start a second process on :3000. Never treat :3000 as the installed app.

## Driving conventions

- Start from the feature file's preconditions.
- Use `data-testid` handles. Treat testid strings as literal.
- Rail tabs are the current workspace `productModes`. Home has every work mode. `mode-agents` count is 0.
- Restore nothing on the operator's Windows SQLite. Cloud isolation is the VM.
- Keep proof artifacts under `evidence/<feature>/<run-id>/`.

## Proof and skip reporting

- Capture the user action and the resulting state.
- UI proof: snapshot + screenshot with Chat / Settings / workspace identity visible.
- Mutation proof: a second user-facing view (thread list, workspace list, gallery).
- Record the feature ID and entry point on every artifact.
- An unreachable rail tab (`mode-images` missing on a Legal desk) is expected — not a skip. On Home, missing Images is a fail.
- `/studio` and `/agents` redirect to Chat. That is parked GTM, not a harness bug.
- Do not report Settings saved or a live generate unless the operator asked and doctor reported `runtime: "ai"`.

## Feature entry contract

Each file: H1 + one paragraph, then exactly four H2s — `Sub-features`, `How to get to it (user POV)`, `Driving it with the Agentforge harness`, `Gotchas`.

## Features

- [Chat](./chat.md) — composer send, new thread, switch sessions, stub reply. Home rail shows every work mode.
- [Settings](./settings.md) — gateway key, privacy note, stub/live runtime, compact this-key + Open Usage. No Advanced tab.
- [Usage](./usage.md) — bottom-rail `/usage` Day/Week/Month stacked spend, this-key strip, desk by-model. Not a product mode.
- [Workspaces](./workspaces.md) — rail switcher + `/workspaces` create/edit, presets and mode checkboxes, open → Chat.
- [Models](./models.md) — curated Chat picker (Recommended + brand groups), doctor modeKeys/chatCount/curation on webdev. No `model-picker-all`.
- [Templates](./templates.md) — example galleries on all five mode studios; click pre-fills the prompt.
- [PII](./pii.md) — host masks outbound prompts (`[email]` / `[phone]` / …); the transcript keeps the typed text.
- [Security](./security.md) — saved-key fingerprint on Settings (`key-fingerprint`); TLS note on `privacy-note`; at-rest envelope is existing work.
- [Research](./research.md) — studio shell on Home; live generate needs a key (and search backends).
- [Documents](./documents.md) — starters, preview, section regen (503 without a key), DOCX download from a starter. Home has the tab.
- [Finance](./finance.md) — figures-only brief, starter + DOCX without a key, generate 503 without a key. Home has the tab.
- [Data](./data.md) — pasted CSV + table notes, no web search, generate 503 without a key. Home has the tab.
- [Legal](./legal.md) — .docx matter review with a verify/edit loop; uploads and roles without a key, run 503 without one. Home and the Legal preset have the tab.
- [Knowledge](./knowledge.md) — Account-rail Soul / Memory / Sources / Map + choosable embedding/brain/verifier; Chat injects RAG retrieve. Not a product mode.
- [Knowledge ingest loop](./knowledge-ingest.md) — every finished Chat turn / job writes a text work card (pointer, not bytes); `knowledge-loop` chart on Sources; Chat skips its own card; example clips never ingest.
- [Images](./images.md) — studio shell on Home; needs-key without a gateway key.
- [Videos](./videos.md) — studio shell and `videos-studio-needs-key` without a key.
- [Edit](./edit.md) — CapCut-style timeline + agent panel (`mode-edit`). Loop 0 harness (fixtures, doctor, stub S1–S10); studio ships in Phase 1.
- [Presentation](./presentations.md) — starters, preview, slide regen (503 without a key), PPTX download from a starter.
- [Desktop](./desktop.md) — Electron one-window launch, splash → Chat, IPC host (no loopback HTTP). Windows NSIS exists; mac/linux are builder targets.
- [Desktop brands](./desktop-brands.md) — packaged Kemenkeu AI / AIHub Metranet vs public Agentforge. Rail `product-brand` + `product-logo` must match the installed flavor, not leftover Agentforge copy.
- [Mobile](./mobile.md) — docs only. No iOS/Android build, no stores, no Capacitor. A phone on LAN `:3000` is not a product surface.
- [Build](./build.md) — **parked / verified-unreachable.** `/studio` redirects to Chat.
- [Studio advanced](./studio-advanced.md) — **parked / verified-unreachable.** Same redirect.
