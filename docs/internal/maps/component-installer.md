# Component installer (first run)

Last verified: 2026-09-20 at b482611

## Overview

The only way DPSBuddy installs a native dependency. The owner never runs a command: a bundled copy is used when it loads, otherwise the host downloads a pinned, hash-checked package into the data dir during onboarding. Modelled on Hermes' bootstrap (manifest → stages → events → completion marker → idempotent). One component today, `anydoc` (the local document reader behind `packages/host/src/file-extract`). It is not an updater, not a plugin system, and ffmpeg is not in it yet. On a hosted server the installer runs **once per server**, not once per user — the data dir and the native module are shared by every tenant, so who triggers the install and when is open decision 6 in [`web-pivot-2026-09-18.md`](../web-pivot-2026-09-18.md).

## How it works

1. **Status.** `GET /api/v1/components` (`packages/host/src/router.ts:194` → `handleGetComponents`, `packages/host/src/handlers/components.ts:30`) answers `{ components: [{ id, version, auto, state, source, bytes, error? }] }`. `componentStatus` (`packages/host/src/components/status.ts:65`) asks the probe: `resolveAnydoc` tries the bundled module, then the downloaded one, which only counts when the marker exists (`packages/host/src/file-extract/anydoc.ts`, `loadBundledAnydoc` / `loadDownloadedAnydoc`). A platform with no package in the manifest is `unsupported`, not an error (`manifest.ts:109`).
2. **Auto.** `auto` is false when `AGENTFORGE_RUNTIME=stub` is set or under test (`status.ts:51`), so Cloud and Playwright never download. The renderer only starts on its own when `state === "missing" && auto` (`apps/web/lib/components-client.ts:144`).
3. **Trigger.** Onboarding mounts `ComponentSetupPanel` inside `onboarding-setup-check` (`apps/web/components/onboarding-screen.tsx:3`, `:113-127`); an already-onboarded desk mounts `ComponentSetupSilent` from `apps/web/src/App.tsx:11`, rendered at `:147`. Both use `useComponentSetup` (`apps/web/lib/use-component-setup.ts:42`): fetch, auto-install once, abort on unmount, `retry()`.
4. **Install.** `POST /api/v1/components/install/stream` with `{ id }` (`router.ts:195`, `handlers/components.ts:44`; unknown id → 400) streams `job.*` through `streamJob`, so it works over webdev SSE and Electron IPC alike. `installComponent` (`packages/host/src/components/install.ts:199`) holds one run per component (`busy` otherwise) and walks the stages:
   - `check` — already loads → every stage `skipped`; else clear stale staging dirs (`unpack.ts:64`).
   - `download` — `downloadPackage` (`download.ts:89`) via `fetchPublicHttps`: HTTPS only, private hosts blocked on every hop, 16 MB cap, 60 s, 3 attempts. Progress is `job.step { phase: "download", detail, current, total }`.
   - `verify` — `verifyIntegrity` (`download.ts:33`), sha512 SRI from the manifest, before anything is written. Mismatch → `integrity_mismatch`.
   - `unpack` — `readTarGz` (`tar.ts:143`) is pure and refuses absolute paths, `..`, links, oversize and too many entries; `unpackPackage` writes into a staging dir and `promoteStaging` renames it into `<dataDir>/components/anydoc/<version>/` (`unpack.ts:29,89`, `paths.ts:39`).
   - `probe` — `componentLoadsFrom` (`status.ts:36`) loads the unpacked copy **without** asking for the marker.
   - `marker` — `writeComponentMarker` (`paths.ts:87`), tmp + rename.
   Each stage emits `job.phase { phase, state: running | succeeded | skipped | failed, durationMs? }`; the run ends in `job.done { result: status }` or `job.error { code, message }`. Every transition is appended to `<dataDir>/logs/components.log`.
5. **Use.** A successful install calls `resetAnydocCache()` so the memoised "missing" does not outlive the fix; the next upload goes through the native reader.
6. **Failure.** Codes: `offline`, `download_failed`, `integrity_mismatch`, `unpack_failed`, `probe_failed`, `unsupported_platform`, `busy`. None blocks onboarding — `extractFile` falls back to the older readers (`packages/host/src/file-extract/fallback.ts`).

## Where things live

| File | Role |
|---|---|
| `packages/host/src/components/manifest.ts` | Frozen manifest: version, tarball URLs, sha512, bytes per platform. The only source of URLs. |
| `packages/host/src/components/install.ts` | Stage runner, in-flight guard, last failure |
| `packages/host/src/components/download.ts` | Capped HTTPS fetch + integrity |
| `packages/host/src/components/tar.ts`, `unpack.ts` | Guarded tar reader, staging, atomic promote |
| `packages/host/src/components/paths.ts`, `status.ts`, `log.ts` | Data-dir layout, marker, probes, log |
| `packages/host/src/handlers/components.ts` | The two routes (ungated on purpose) |
| `packages/host/src/file-extract/anydoc.ts` | Bundled → downloaded loader |
| `apps/web/lib/components-client.ts`, `use-component-setup.ts` | Client, reducer, auto-start decision, hook |
| `apps/web/components/component-setup.tsx` | Panel + silent mount |
| `apps/desktop/package.json` | `@firecrawl/anydoc` dependency + `asarUnpack` (the bundled route) |

## Gotchas

- **The probe stage must not need the marker.** The first live run failed `probe_failed` on every real download for exactly that reason; unit tests with an injected probe did not see it. Prove changes with one real install into a temp `AGENTFORGE_DATA_DIR`.
- **`import.meta` is `{}` inside `host.cjs`.** `createRequire(import.meta.url)` throws in the packaged bundle; the loader uses `typeof require === "function" ? require : createRequire(import.meta.url)`.
- **No URL ever comes from a request.** The body carries an id; everything else is the manifest. Bumping a version means new integrity strings from `npm view <pkg>@<v> dist.integrity`.
- **Start over removes it.** `components` and `logs` are in `HOST_RESET_ENTRIES` (`packages/host/src/handlers/settings.ts:274`, the two entries at `:290-292`); the wipe runs on the next boot before the module is loaded, so Windows never holds the `.node` open.
- **webdev has no watcher.** A `:3000` started before these routes existed answers 404 until it is restarted.
- **Mac packs bundle it too.** `apps/desktop/platform/macos/docker/build-mac.sh` fetches `anydoc-darwin-<arch>` per arch, checks the sha512 pinned in `manifest.ts`, and removes every other platform package before electron-builder runs; a Linux install alone would ship ELF `.node` files into the `.app` (first 0.14.27 mac pack, `verify: FAIL - 2 non-Mach-O native binaries`). Bump the manifest and that script together.
- Bundled wins. On this desk `node_modules` has the module, so the panel never appears on webdev; that is correct, not a bug.

## Verify

`.cursor/skills/verify-agentforge/features/components.md` — testids `component-setup`, `component-setup-progress`, `component-setup-stage-<id>`, `component-setup-retry`, `component-setup-done`, `component-setup-error`; `GET /api/v1/components`; `<dataDir>/logs/components.log`.

## Why

- The owner must never install a dependency by hand; onboarding does it, the way Hermes' first install does. **[Direct]** — owner instruction, 2026-09-17.
- Hash before unpack, manifest-only URLs. **[Supported]** — Hermes' pipeline has no integrity check beyond TLS; `AGENTS.md` (“never trust external data”) asks for more.
