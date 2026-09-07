# Bundled Edit starter media

Sample clips the Edit starters ("Product promo", "Talking head + subtitles", "Reels 9:16", "Square social") lay on the timeline when a project is created. Everything is read from disk. Nothing is fetched at runtime.

- Manifest: `packages/core/src/edit/starter-media.json` (file name, kind, duration, size, generator recipe).
- Generate: `pnpm edit:starters` (needs ffmpeg on PATH or `AGENTFORGE_FFMPEG_PATH`). Deterministic lavfi renders, no downloads.
- Verify: `pnpm edit:starters:check`. `pnpm desktop:build` runs this check first.
- Packaged app: copied by electron-builder `extraResources` to `resources/starters/`, resolved by the host via `process.resourcesPath`.
- Webdev: the host walks up from `apps/web` to this folder. Override with `AGENTFORGE_STARTER_MEDIA_DIR`.

To ship real footage instead of the generated placeholders, drop a file with the same name, aspect, and duration here and keep the manifest entry (update `durationSeconds` if it differs). The media files are gitignored; only this README and the manifest are committed.
