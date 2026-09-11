# Bundled WeKnora-lite sidecar

Packaged DPSBuddy resolves the knowledge sidecar from `resources/weknora/<platform>/` via Electron
`extraResources` (`process.resourcesPath/weknora/<platform>/`). Webdev and dev builds fall back to
`AGENTFORGE_WEKNORA_PATH`. The folder is gitignored apart from this file: run
`node scripts/stage-weknora.mjs` before packaging to pull the pinned build in.

Layout (one folder per platform, matching `process.platform-process.arch`):

```
resources/weknora/
  win32-x64/    WeKnora-lite.exe  migrations/sqlite/  config/  LICENSE  THIRD_PARTY_NOTICES.md  licenses/  BUILD.json
  darwin-arm64/ WeKnora-lite      migrations/sqlite/  config/  LICENSE  THIRD_PARTY_NOTICES.md  licenses/  BUILD.json
  darwin-x64/   WeKnora-lite      migrations/sqlite/  config/  LICENSE  THIRD_PARTY_NOTICES.md  licenses/  BUILD.json
```

- The binaries are built by `.github/workflows/weknora-lite.yml` from the Tencent/WeKnora ref pinned
  in `apps/desktop/weknora.lock.json` and attached to a `weknora-lite-<ref>` release on this repo.
  No developer machine needs Go, MinGW, or Rust.
- `migrations/sqlite/` must sit next to the binary: WeKnora loads it from disk relative to its
  working directory, and the host spawns the sidecar with `cwd` set to this folder.
- `LICENSE`, `THIRD_PARTY_NOTICES.md`, and `licenses/` must ship with the binary (WeKnora is MIT;
  two dependencies are MPL-2.0 and require their notices to travel with redistributed binaries).
- macOS: unsigned helpers launch fine while the app itself is unsigned (same as ffmpeg). Once the
  app is signed, the sidecar must be signed and notarized on the same path.
- The sidecar is never required: without this folder the app uses the built-in knowledge backend.

See `docs/internal/weknora-kb-plan.md` (Phase 3, Packaging).
