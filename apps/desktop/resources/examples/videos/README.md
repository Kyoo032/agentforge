# Bundled Videos example clips

The "Example clips" cards on the Videos studio. Each one is a real generation of a prompt template from `packages/core/src/edit/prompt-templates.json`, shipped inside the installer so the cards always play, offline, on every machine. Nothing is fetched at runtime.

- Manifest: `packages/core/src/edit/video-examples.json` (file name, template id, measured size / duration / model / date).
- Generate: `pnpm videos:examples` against a running host that has a gateway key (default `http://127.0.0.1:3000`, the webdev desk). Needs ffmpeg + ffprobe on PATH or `AGENTFORGE_FFMPEG_PATH` / `AGENTFORGE_FFPROBE_PATH`. Clips are re-encoded to H.264, at most 1280 px on the long edge, faststart, and the manifest entry is updated with what was measured.
- Verify: `pnpm videos:examples:check`. `pnpm desktop:build` runs this check first.
- Packaged app: copied by electron-builder `extraResources` to `resources/examples/videos/`, resolved by the host via `process.resourcesPath`.
- Webdev: the host walks up from `apps/web` to this folder. Override with `AGENTFORGE_VIDEO_EXAMPLES_DIR`.

To swap a clip, drop a file with the same name here (or run the script with `--force --only <file>`). The mp4 files are gitignored; only this README and the manifest are committed.
