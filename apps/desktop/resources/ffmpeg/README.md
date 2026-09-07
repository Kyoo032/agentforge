# Bundled ffmpeg (Windows)

Drop official LGPL builds here before packaging:

- `ffmpeg.exe`
- `ffprobe.exe`

Packaged Agentforge resolves these from `resources/ffmpeg/` via Electron `extraResources` (`process.resourcesPath/ffmpeg/`). Webdev and dev builds still fall back to PATH or `AGENTFORGE_FFMPEG_PATH`.

See [`docs/internal/ffmpeg-attribution.md`](../../../docs/internal/ffmpeg-attribution.md) for license notes.
