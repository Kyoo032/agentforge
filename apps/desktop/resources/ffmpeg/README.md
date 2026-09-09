# Bundled ffmpeg

Packaged DPSBuddy resolves `ffmpeg` / `ffprobe` from `resources/ffmpeg/` via Electron `extraResources` (`process.resourcesPath/ffmpeg/`). Webdev and dev builds still fall back to PATH or `AGENTFORGE_FFMPEG_PATH`. Drop official LGPL builds here before packaging; the folder is gitignored apart from this file.

## Windows

- `ffmpeg.exe`
- `ffprobe.exe`

## macOS

- `ffmpeg` and `ffprobe` (no extension), `chmod +x` both.
- The binaries must match the arch being built (`x64` or `arm64`), or be universal (`lipo -create`). electron-builder copies the folder as-is for every arch, so for two single-arch artifacts swap the binaries between `--mac --x64` and `--mac --arm64` runs.
- Unsigned helpers inside an unsigned app launch fine after the Gatekeeper step in the release notes; once the app is signed, the helpers need signing too.

See [`docs/internal/ffmpeg-attribution.md`](../../../../docs/internal/ffmpeg-attribution.md) for license notes.
