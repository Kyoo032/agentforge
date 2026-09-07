# Android app — implementation plan

Status: **paused** (2026-09-07). Plan written; build deferred until the Research dossier and the Finance / Data expansion land. Plan below stands as written. **Location update (2026-09-07):** the app lives in-repo at [`apps/mobile`](../../apps/mobile/AGENTS.md) with its own rules file, superseding the sibling-repo idea below; read `apps/mobile/AGENTS.md` before Phase 0. Nothing here changes the kernel or the desktop installer.

## Shape of the app (decision)

**Direct gateway client.** The phone talks straight to the Toko Token gateway (`https://api.tokotokenai.com/v1`) with its own pasted key, exactly like the desktop philosophy: install, paste key, work. No account, no login, no cloud tenant, data stays on the device.

Rejected alternatives:

- **Remote server / sync backend** — does not exist, contradicts "no login, single owner, local data". Not for closed beta.
- **LAN bridge to the desktop app** — explicitly forbidden (`docs/mobile.md`); packaged Electron has no HTTP server by design.

Consequence: phone and desktop are **independent devices**. Threads/media do not sync in v1. Same key can be pasted on both; usage is per-key so `/usage` stays coherent.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Expo (React Native) + TypeScript** | Repo guidance: "prefer Expo if the UI is still React". expo-router for navigation. |
| Key storage | `expo-secure-store` (Android Keystore) | Mirror desktop posture: key never rendered back after save, only `hasKey` + SHA-256 fingerprint. `FLAG_SECURE` on the key entry screen. |
| Local DB | `expo-sqlite` + Drizzle | Same ORM family as `packages/db`. Mobile schema is a small subset: threads, messages, media refs, settings. |
| Streaming | `expo/fetch` (streaming `ReadableStream`) + a port of `consumeSse` from `apps/web/lib/sse-client.ts` | Gateway streaming is plain SSE; `consumeSse` is pure and dependency-free. |
| Gateway client | Direct `fetch` to `/v1/chat/completions`, `/v1/models`, `/v1/images/generations`, `/v1/video/generations`, NewAPI `/api/usage/token` + `/api/pricing` | The `/api/v1/**` host routes in `packages/host/src/router.ts` are the **spec** for on-device logic; do not port host code (Node-only: fs, child_process, better-sqlite3). |
| Lint/test | Biome + Vitest for the kernel port; `jest-expo` + RN Testing Library for UI | Keep kernel modules pure so most coverage lives in fast Vitest. |
| Network policy | HTTPS-only (port `packages/core/src/security/tls.ts` guard); Android `networkSecurityConfig` blocks cleartext | No loopback exception needed on phone (no Ollama in v1). |

## Code reuse from agentforge

`packages/core` has zero `node:` imports except two bare-`crypto` files (`crypto/envelope.ts`, `security/fingerprint.ts`). Reusable nearly unchanged:

- `src/gateway.ts` — base URL constants + origin derivation
- `src/gateway/account.ts` — quota/USD math (`QUOTA_PER_USD = 500_000`)
- `src/models/**` — catalog, probe, curation buckets (chat picker defaults)
- `src/agents/product-modes.ts` — mode catalog/ordering if workspaces ever arrive on mobile
- `apps/web/lib/sse-client.ts` → `consumeSse`
- Pack packages (`legal`/`marketing`/`university`) — pure string constants, only if desks ship on mobile later

**Mechanism:** copy these into the sibling repo as `packages/kernel-port/`, each file with a provenance header (`ported from agentforge <path> @ <commit>`), plus a `scripts/sync-kernel.mjs` that diffs against a local agentforge checkout and fails CI when upstream drifted. No private npm registry, no git submodule — matches local-first, zero-infra closed beta. Revisit publishing `@agentforge/core` properly if drift becomes painful. For the two `crypto` importers, use `expo-crypto`/QuickCrypto shims only if actually needed (v1 likely doesn't need envelope crypto — SecureStore covers at-rest key protection).

## v1 scope (Android, sideloaded APK)

1. **Onboarding / Settings** — paste gateway key → probe `GET /v1/models` → SecureStore. Offline demo mode until a key is saved (mirrors desktop). Toko Token branding; never merge with TokenKu.
2. **Chat** — model picker (curated chat bucket from live `/v1/models`), composer, SSE streaming, session list stored in local SQLite. Feature parity target: desktop Chat minus tool-bound media generation.
3. **Usage** — this-key spend by day/week/month via NewAPI `/api/usage/token` + `/api/pricing`.

**v1.1:** Images + Videos (prompt → generate → poll → gallery; save to device media library). Thin gateway wrappers, same pattern as desktop.

**Explicitly out:** Edit/CapCut (ffmpeg subprocesses + bundled binaries — desktop-only), Documents/Presentation (server-side `docx`/`pptxgenjs` byte generation; revisit on-device later), Research (needs search-provider key + orchestration), Knowledge Base, workspaces/desks, any login or sync.

## Phases

**Phase 0 — Repo + kernel port.** Create sibling repo (suggest `agentforge-mobile`, private). Expo scaffold, expo-router, Biome, CI (lint + vitest + jest-expo). Port kernel modules with tests + sync script. Definition of done: `pnpm test` green, app boots to an empty shell on an Android device/emulator.

**Phase 1 — Key + Chat MVP.** Settings screen (SecureStore, probe, fingerprint display, demo mode), gateway client with TLS guard, streaming chat against `/v1/chat/completions`, model picker from curated buckets. DoD: real streamed conversation on-device with a real key; airplane-mode and bad-key paths handled with friendly errors.

**Phase 2 — Persistence + Usage.** Drizzle/expo-sqlite schema (threads, messages, settings), session list inside Chat (sessions are never global nav), usage screen. DoD: kill/relaunch retains sessions; usage matches desktop for the same key.

**Phase 3 — Images + Videos.** Generate + poll + gallery, save-to-device. DoD: image and video round-trip on a mid-range phone.

**Phase 4 — Release pipeline.** Signed APK (own upload keystore — generate once, back up offline; never commit), versioning independent of desktop (start `0.1.0`), build via EAS or local Gradle. Distribution: attach APK to **Kyoo032/DPS-Agent-Platform** releases alongside desktop artifacts (public repo rules apply: no source, no internal docs, no AI/agent marks). In-app "check for update" hitting the public releases feed unauthenticated, fully user-driven like `auto-update.cjs`. No Play Store in closed beta; document the sideload/unknown-sources step in the public README.

## Security checklist (mirror desktop posture)

- Key only in Android Keystore-backed SecureStore; never in JS-accessible plain storage, logs, or crash reports.
- API returns to UI only `hasKey` + fingerprint, never the raw key.
- HTTPS enforced in the gateway client *and* via `networkSecurityConfig`.
- Validate/clamp all gateway responses at the boundary (model list, usage numbers, media URLs).
- `FLAG_SECURE` on the key screen; disable Android auto-backup for the app or exclude the DB + SecureStore.

## Open items for Kyo

- Sibling repo name + private GitHub location (assumed `Kyoo032/agentforge-mobile`).
- Whether the mobile APK shares the public DPS-Agent-Platform releases page or gets its own.
- White-label (Kemenkeu/Metranet) on mobile: out of scope until asked; keep `gatewayBaseUrl` injectable like `brand.json` so it stays cheap later.
