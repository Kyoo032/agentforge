# ffmpeg attribution (Edit)

Agentforge Edit uses **ffmpeg** and **ffprobe** for probe, cut, silence/scene detect, audio extract, render, and lightweight color-match jobs. Packaged Windows builds may ship binaries under `apps/desktop/resources/ffmpeg/` (LGPL).

## License

ffmpeg is licensed under the **GNU Lesser General Public License (LGPL) v2.1 or later**. ffprobe is part of the same distribution.

When you bundle ffmpeg with the desktop installer:

1. Ship corresponding **source code** or a **written offer** to obtain source, per LGPL.
2. Keep license and copyright notices with the binaries.
3. Document that users may replace the bundled ffmpeg with their own build (PATH / `AGENTFORGE_FFMPEG_PATH`).

Agentforge does not modify ffmpeg for copyleft purposes beyond normal linking/invocation. Product code lives in `packages/host/src/edit/ffmpeg*`.

## Operator notes

- Dev / webdev: install ffmpeg 6+ on PATH, or set `AGENTFORGE_FFMPEG_PATH` / `AGENTFORGE_FFPROBE_PATH`.
- Packaged: drop `ffmpeg.exe` and `ffprobe.exe` in `apps/desktop/resources/ffmpeg/` before `pnpm desktop:build` on Windows.
- Doctor: webdev `GET /api/v1/edit/doctor`; packaged `host-status.json` may include `editFfmpeg`.

Official project: [https://ffmpeg.org](https://ffmpeg.org)
