# Component installer (first run)

Last verified: 2026-09-21 at 2d44f0f + the Phase 7 branch `claude/web-phase7-component-installer-7f5d5l`

## Overview

The only way DPSBuddy installs a native dependency. The owner never runs a command: a bundled copy is used when it loads, otherwise the host downloads a pinned, hash-checked package into the data dir during onboarding. Modelled on Hermes' bootstrap (manifest → stages → events → completion marker → idempotent). One component today, `anydoc` (the local document reader behind `packages/host/src/file-extract`). It is not an updater, not a plugin system, and ffmpeg is not in it yet.

**On a hosted server it is a different feature with the same parts** (Phase 7, [`../web-phase7-component-installer.md`](../web-phase7-component-installer.md)): the component is the OPERATOR's, installed once per box, and no tenant can start anything. The install route answers `install_disabled` 403, the image build proves it carries every required component, an operator CLI installs one between images, and the host refuses to load a native module out of the tenant data volume at all. **On a hosted server** below is that half; **How it works** is the desk's, unchanged.

## How it works

1. **Status.** `GET /api/v1/components` (`packages/host/src/router.ts:279` → `handleGetComponents`, `packages/host/src/handlers/components.ts:30`) answers `{ components: [{ id, version, auto, managed, state, source, bytes, error? }] }`. `componentStatus` (`packages/host/src/components/status.ts:71`) asks the probe: `resolveAnydoc` tries the bundled module, then the downloaded one, which only counts when the marker exists (`packages/host/src/file-extract/anydoc.ts`, `loadBundledAnydoc` / `loadDownloadedAnydoc`). A platform with no package in the manifest is `unsupported`, not an error (`manifest.ts:109`).
2. **Auto.** `auto` is false when `AGENTFORGE_RUNTIME=stub` is set, under test, or in server mode (`status.ts:57`), so Cloud, Playwright and every hosted tenant never download. `managed` is true in server mode and only there (`status.ts:75`). The renderer only starts on its own when `state === "missing" && auto && !managed` (`apps/web/lib/components-client.ts:155`), and shows nothing at all for a managed row (`:165`).
3. **Trigger.** Onboarding mounts `ComponentSetupPanel` inside `onboarding-setup-check` (`apps/web/components/onboarding-screen.tsx:3`, `:112-128`); an already-onboarded desk mounts `ComponentSetupSilent` from `apps/web/src/App.tsx:11`, rendered at `:148`. Both use `useComponentSetup` (`apps/web/lib/use-component-setup.ts:42`): fetch, auto-install once, abort on unmount, `retry()`.
4. **Install.** `POST /api/v1/components/install/stream` with `{ id }` (`router.ts:280`, `handlers/components.ts:50`; unknown id → 400, server mode → 403 before the body is read, `:66-67`) streams `job.*` through `streamJob`, so it works over webdev SSE and Electron IPC alike. `installComponent` (`packages/host/src/components/install.ts:199`) holds one run per component (`busy` otherwise) and walks the stages:
   - `check` — already loads → every stage `skipped`; else clear stale staging dirs (`unpack.ts:64`).
   - `download` — `downloadPackage` (`download.ts:89`) via `fetchPublicHttps`: HTTPS only, private hosts blocked on every hop, 16 MB cap, 60 s, 3 attempts. Progress is `job.step { phase: "download", detail, current, total }`.
   - `verify` — `verifyIntegrity` (`download.ts:33`), sha512 SRI from the manifest, before anything is written. Mismatch → `integrity_mismatch`.
   - `unpack` — `readTarGz` (`tar.ts:143`) is pure and refuses absolute paths, `..`, links, oversize and too many entries; `unpackPackage` writes into a staging dir and `promoteStaging` renames it into `<components root>/anydoc/<version>/` (`unpack.ts:29,89`, `paths.ts:93`, root at `paths.ts:51`).
   - `probe` — `componentLoadsFrom` (`status.ts:37`) loads the unpacked copy **without** asking for the marker.
   - `marker` — `writeComponentMarker` (`paths.ts:141`), tmp + rename.
   Each stage emits `job.phase { phase, state: running | succeeded | skipped | failed, durationMs? }`; the run ends in `job.done { result: status }` or `job.error { code, message }`. Every transition is appended to `<dataDir>/logs/components.log`.
5. **Use.** A successful install calls `resetAnydocCache()` so the memoised "missing" does not outlive the fix; the next upload goes through the native reader.
6. **Failure.** Codes: `offline`, `download_failed`, `integrity_mismatch`, `unpack_failed`, `probe_failed`, `unsupported_platform`, `busy`. None blocks onboarding — `extractFile` falls back to the older readers (`packages/host/src/file-extract/fallback.ts`).

## On a hosted server

Everything above still describes the code that runs; what changes is who may run it and where it may load from. Decided in Phase 7 ([`../web-phase7-component-installer.md`](../web-phase7-component-installer.md)); `AGENTFORGE_SERVER` is the only switch.

1. **No tenant installs anything.** `handlePostComponentInstallStream` (`packages/host/src/handlers/components.ts:50-77`) refuses with 403 before the body is parsed — the `isServerMode()` branch is at `:66-67` — and `install_disabled` is spelled once, at `:45-48` with its message. An install is machine-wide — the box's bandwidth, a shared directory, a native `.node` loaded out of it — so it is not a tenant's action and not a tenant's cost (OWASP A01-3, closed in #88).
2. **The renderer never offers one.** `componentStatus` reports `auto: false` and `managed: true` in server mode (`packages/host/src/components/status.ts:57`, `:75`); `pickComponentToSetUp` returns null for a managed row (`apps/web/lib/components-client.ts:165`), so the first-run panel does not mount. `GET /api/v1/components` stays ungated (`packages/host/src/auth/routes.ts:45`) and read-only for every tenant — it is also the container healthcheck.
3. **The components root is off the tenant volume.** `componentsRootDir` (`packages/host/src/components/paths.ts:51`) takes `AGENTFORGE_COMPONENTS_DIR`, which the image sets to `/opt/agentforge/components` on its own compose volume (`webapp-deploy/Dockerfile`, `webapp-deploy/compose.yml`). `managedComponentsRoot` (`:63`) is null when it is unset or lands back inside the data dir.
4. **A root inside the data volume is refused at load.** `downloadedComponentsAllowed` (`paths.ts:84`) is false in server mode without a managed root, and `loadDownloadedAnydoc` (`packages/host/src/file-extract/anydoc.ts:97`) throws before it looks for the marker. `resolveAnydoc` catches that exactly as it catches an absent module, so the state is `missing` and the reduced reader takes over. This is what makes `/data` mountable `noexec` (security spec H3).
5. **The image proves it carries its components.** `webapp-deploy/Dockerfile` runs `tsx scripts/components.ts check` in the build stage; the check walks `SERVER_COMPONENT_IDS` (`packages/host/src/components/server.ts:42`, every id in the manifest) through `serverComponentReport` (`:81`) and exits 1 if one does not load, failing the build.
6. **The operator installs between images.** `scripts/components.ts install` runs the same stage runner and the same manifest; `webapp-deploy/scripts/components.sh` `docker compose exec`s it into the running container. It refuses up front when the root is inside the data dir, because the unpack and probe would succeed there and only the loader applies the rule — a green install and a component that still reports `missing`.

## Where things live

| File | Role |
|---|---|
| `packages/host/src/components/manifest.ts` | Frozen manifest: version, tarball URLs, sha512, bytes per platform. The only source of URLs. |
| `packages/host/src/components/install.ts` | Stage runner, in-flight guard, last failure |
| `packages/host/src/components/download.ts` | Capped HTTPS fetch + integrity |
| `packages/host/src/components/tar.ts`, `unpack.ts` | Guarded tar reader, staging, atomic promote |
| `packages/host/src/components/paths.ts`, `status.ts`, `log.ts` | Components root, marker, probes, log; and which roots a server may load from |
| `packages/host/src/components/server.ts` | What a server must carry, and the report the CLI and the image build print |
| `scripts/components.ts` | The per-server CLI: `status` / `check` / `install` |
| `webapp-deploy/Dockerfile`, `compose.yml`, `scripts/components.sh` | The build-time check, the components volume, the operator script |
| `packages/host/src/handlers/components.ts` | The two routes (ungated on purpose) |
| `packages/host/src/file-extract/anydoc.ts` | Bundled → downloaded loader |
| `apps/web/lib/components-client.ts`, `use-component-setup.ts` | Client, reducer, auto-start decision, hook |
| `apps/web/components/component-setup.tsx` | Panel + silent mount |
| `apps/desktop/package.json` | `@firecrawl/anydoc` dependency + `asarUnpack` (the bundled route) |

## Gotchas

- **The probe stage must not need the marker.** The first live run failed `probe_failed` on every real download for exactly that reason; unit tests with an injected probe did not see it. Prove changes with one real install into a temp `AGENTFORGE_DATA_DIR`.
- **`import.meta` is `{}` inside `host.cjs`.** `createRequire(import.meta.url)` throws in the packaged bundle; the loader uses `typeof require === "function" ? require : createRequire(import.meta.url)`.
- **No URL ever comes from a request.** The body carries an id; everything else is the manifest. Bumping a version means new integrity strings from `npm view <pkg>@<v> dist.integrity`.
- **Start over removes it.** `components` and `logs` are in `HOST_RESET_ENTRIES` (`packages/host/src/handlers/settings.ts:356`, the two entries at `:377-379`); the wipe runs on the next boot before the module is loaded, so Windows never holds the `.node` open.
- **webdev has no watcher.** A `:3000` started before these routes existed answers 404 until it is restarted.
- **Mac packs bundle it too.** `apps/desktop/platform/macos/docker/build-mac.sh` fetches `anydoc-darwin-<arch>` per arch, checks the sha512 pinned in `manifest.ts`, and removes every other platform package before electron-builder runs; a Linux install alone would ship ELF `.node` files into the `.app` (first 0.14.27 mac pack, `verify: FAIL - 2 non-Mach-O native binaries`). Bump the manifest and that script together.
- Bundled wins. On this desk `node_modules` has the module, so the panel never appears on webdev; that is correct, not a bug.
- **A server install can succeed and still be unusable.** The unpack and the probe work on the directory; only `loadDownloadedAnydoc` applies the server rule. That is why the CLI refuses an unmanaged root instead of letting the install finish, and why the refusal names `AGENTFORGE_COMPONENTS_DIR`.
- **`biome check --write` flips line endings.** `biome.json` sets `"lineEnding": "crlf"` while the tree is LF; the repository's `lint` script passes `--formatter-enabled=false`, so CI never sees it. Convert touched files back to LF after formatting.
- **"Start over" does not remove a server's components.** `HOST_RESET_ENTRIES` names `components` relative to the data dir, and a managed root is not under it. Correct — they are the operator's — but it means the desk and the server answer that question differently.

## Verify

`.cursor/skills/verify-agentforge/features/components.md` — testids `component-setup`, `component-setup-progress`, `component-setup-stage-<id>`, `component-setup-retry`, `component-setup-done`, `component-setup-error`; `GET /api/v1/components`; `<dataDir>/logs/components.log`.

## Why

- The owner must never install a dependency by hand; onboarding does it, the way Hermes' first install does. **[Direct]** — owner instruction, 2026-09-17.
- Hash before unpack, manifest-only URLs. **[Supported]** — Hermes' pipeline has no integrity check beyond TLS; `AGENTS.md` (“never trust external data”) asks for more.
