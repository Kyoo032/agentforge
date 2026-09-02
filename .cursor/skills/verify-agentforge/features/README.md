# Agentforge verification map

Agent-facing map (where to press). Not product. Pair with pstack `how` for how a subsystem works; keep this directory honest with `/maintain-verification-skill`.

This directory is the maintained source for verifying user-facing Agentforge behavior. Read this index before driving, then use the matching feature file as the recipe.

Documents, Research, Images, Videos, and Presentation are product modes. Default desks only unlock Images/Videos/Presentation after a Default agent exists. Documents unlocks when an agent publishes that surface (`product-mode-documents`).

## Baseline preconditions

- **Webdev:** app answers at `http://127.0.0.1:3000` (never a LAN IP). Doctor with no args.
- **Packaged desktop:** Electron window; doctor `--desktop`; URL is **not** :3000.
- SQLite is `data/agentforge.sqlite` (webdev) or `%APPDATA%\Agentforge\agentforge.sqlite` (packaged).
- No product login. A gateway key is optional; stub Chat works without one.
- Windows: drive webdev with the IDE browser. Drive packaged in the Electron window. Do not run Playwright.
- Cloud / GHA: `AGENTFORGE_RUNTIME=stub` and Playwright `foundation.spec.ts` against **webdev** :3000.
- Never drive an instance this run did not doctor. Never start a second process on :3000. Never treat :3000 as the installed app.

## Driving conventions

- Start from the feature file's preconditions.
- Use `data-testid` handles. Treat testid strings as literal.
- Rail tabs are the union of custom-agent product surfaces. Chat + Agents only until a Default (or other) agent exists.
- Restore nothing on the operator's Windows SQLite. Cloud isolation is the VM.
- Keep proof artifacts under `evidence/<feature>/<run-id>/`.

## Proof and skip reporting

- Capture the user action and the resulting state.
- UI proof: snapshot + screenshot with Chat / Settings / studio identity visible.
- Mutation proof: a second user-facing view (thread list, studio URL, gallery).
- Record the feature ID and entry point on every artifact.
- An unreachable rail tab (`mode-images` missing) is a skip with the unmet precondition — not a pass via a hidden URL unless the feature file says that URL is a valid entry.
- Do not report Settings saved or a live generate unless the operator asked and doctor reported `runtime: "ai"`.

## Feature entry contract

Each file: H1 + one paragraph, then exactly four H2s — `Sub-features`, `How to get to it (user POV)`, `Driving it with the Agentforge harness`, `Gotchas`.

## Features

- [Chat](./chat.md) — composer send, new thread, switch sessions, stub reply.
- [Settings](./settings.md) — form, privacy note, stub/live runtime, Usage panel (this key vs desk estimate in USD, spend-by-model bars), extras keys hidden until opened.
- [Build](./build.md) — blank/default templates, studio UUID, share workspace, agent chat, generate default pickers when Images/Videos are on.
- [Models](./models.md) — curated Chat picker, doctor modeKeys/chatCount/curation, Advanced disclosure (Phase 1 ids optional until present).
- [Workspaces](./workspaces.md) — rail `workspaces-link` (both states), template chips, create/list/open desks, pack seeding.
- [Templates](./templates.md) — example galleries on all five mode studios; click pre-fills the prompt.
- [PII](./pii.md) — Chat warn-on-send banner (`pii-warning`) and send-anyway (`pii-send-anyway`).
- [Security](./security.md) — saved-key fingerprint on Simple Settings (`key-fingerprint`); TLS note on `privacy-note`; at-rest envelope is existing work.
- [Studio advanced](./studio-advanced.md) — post-create soul/tools/model edit; `save-soul` publishes a new version.
- [Documents](./documents.md) — starters, preview, section regen (503 without a key), DOCX download from a starter.
- [Images](./images.md) — studio shell after an agent unlocks the tab; needs-key without a gateway key.
- [Videos](./videos.md) — studio shell and `videos-studio-needs-key` without a key.
- [Presentation](./presentations.md) — starters, preview, slide regen (503 without a key), PPTX download from a starter.
- [Desktop](./desktop.md) — Electron one-window launch, splash → Chat, child teardown on quit.
