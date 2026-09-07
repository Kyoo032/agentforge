# Edit fixtures

Tracked source: `captions.srt` (5 cues) and `script.txt` (6 lines).

Generated media (`*.mp4`, `*.png`) is gitignored. Regenerate from the repo root:

```
node scripts/edit-fixtures.mjs
```

Known truth:

- `talk-60s.mp4` — 60 s, 1280x720@30, 440 Hz sine muted at 10.0–12.0 s, 25.0–27.5 s, 45.0–46.5 s (3 silences).
- `scenes-45s.mp4` — red / green / blue, 15 s each; cuts at 15 s and 30 s.
- `portrait-9x16.mp4` — 720x1280, 10 s.
- `photo-1.png` … `photo-3.png` — single-frame `testsrc2` at distinct hues.

Video encode: `libx264 -preset veryfast -crf 28 -pix_fmt yuv420p` plus `-maxrate 180k -bufsize 360k` so the set stays under 3 MB (`testsrc2` at crf 28 alone was ~12 MB).
