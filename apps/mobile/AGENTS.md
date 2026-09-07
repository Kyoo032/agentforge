# Mobile — rules

Status: **rules only** (2026-09-07). No app code yet. This folder is the home for the mobile client so it has its own rules separate from the desktop shell. Adding a `package.json` here puts it into the pnpm workspace and Turbo, so `pnpm lint` and `pnpm test` must stay green from the first commit. Plan of record: [`docs/internal/mobile-android-plan.md`](../../docs/internal/mobile-android-plan.md) (Android first, iOS after).

## Shape (locked)

- **Direct gateway client.** The phone talks straight to the Toko Token gateway with its own pasted key: install, paste key, work. No account, no login, no sync, no cloud tenant. Phone and desktop are independent devices.
- **No LAN bridge** to the desktop app. Packaged Electron has no HTTP server by design (`docs/mobile.md`). Do not add one on either side.
- **Same secrecy posture as desktop.** The key is stored in the OS keystore via `expo-secure-store`, never rendered back after save; the UI sees only `hasKey` plus a SHA-256 fingerprint. HTTPS only; port the guard from `packages/core/src/security/tls.ts`.
- **Kernel stays neutral.** No `student` / `course` / campus nouns, no new kernel tables, no changes to `packages/db`. Packs (Legal / Marketing / University) are optional presets if desks ever ship on mobile.

## Stack

Expo (React Native, TypeScript) + expo-router, `expo-secure-store`, `expo-sqlite` + Drizzle, `expo/fetch` streaming with a port of `consumeSse` from `apps/web/lib/sse-client.ts`. Lint is Biome (no ESLint / Prettier). Unit tests are Vitest for pure modules and `jest-expo` + RN Testing Library for screens.

## Code reuse rules

- **Port, do not import, `packages/host`.** Its routes are the spec for on-device logic, but the code is Node-only (fs, child_process, better-sqlite3).
- Pure modules from `packages/core` (`gateway.ts`, `gateway/account.ts`, `models/**`, `agents/product-modes.ts`) and `apps/web/lib/sse-client.ts` are copied into `apps/mobile/kernel-port/` with a provenance header (`ported from agentforge <path> @ <commit>`) and a sync script that fails when upstream drifts. Revisit a real `@agentforge/core` dependency if drift gets painful.
- Nothing in `apps/mobile` imports `electron`, `apps/desktop`, or `window.agentforge`.

## Scope

v1: onboarding/settings (paste key → probe `/v1/models` → SecureStore, offline demo until saved), Chat with streaming and a local session list, Usage. v1.1: Images + Videos. **Out:** Edit/CapCut, Documents, Presentation, Research, Knowledge Base, workspaces, login, sync.

## Android

- Key in Android Keystore-backed SecureStore, `FLAG_SECURE` on the key screen, `networkSecurityConfig` blocks cleartext, auto-backup excludes the DB and SecureStore.
- Sideloaded APK in closed beta, no Play Store. Own upload keystore, generated once, backed up offline, **never committed**. Versioning starts at `0.1.0`, independent of desktop.
- Distribution follows the public repo rules: artifact only, no source, no `docs/internal/`, no AI/agent marks. Update check is user-driven against the public releases feed, like `auto-update.cjs`.

## iOS

- Same SecureStore API backed by the Keychain; ATS default (HTTPS only) already matches the gateway rule.
- Needs a Mac with Xcode for Simulator, device builds, and any TestFlight / Ad Hoc distribution. This Windows checkout cannot run the Simulator. No App Store listing in closed beta unless Kyo asks.
- iOS starts after Android Phase 2 is proven on a device.

## Do not

- Create `android/` or `ios/` native folders by hand. `expo prebuild` owns them; keep them gitignored until a reason to eject appears.
- Reuse the desktop Electron shell, Capacitor, or a WebView around `apps/web`.
- Merge Toko Token and TokenKu in copy or catalogs.
- Commit `.env`, keys, keystores, or provisioning profiles.
