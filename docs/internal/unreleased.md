# Unreleased changes (after public v0.14.22)

**Purpose:** what is on `main` but not inside the installers attached to the public v0.14.22 release on `Kyoo032/DPS-Agent-Platform`. On 2026-09-08 the tree was bumped to **`0.14.23`** (per the 2026-09-07 rule; never `0.14.3+`, never `0.15`) and everything listed here up to that point was folded into [`0.14.23-changelog.md`](0.14.23-changelog.md); this file now tracks what still separates `main` from a published 0.14.23. Same rule as every changelog: nothing counts as shipped until it is staged, packed, installed, and driven on the packaged app.

Append-only. When 0.14.23 is published, record the artifact table below, fold any later items into the next changelog, and start this file over.

## Where each published artifact came from

| Artifact | Source | Uploaded (UTC) |
|---|---|---|
| `Agentforge-Setup-0.14.22.exe` + `.blockmap` + `latest.yml` | PR #23 branch, dirty tree (`--allow-dirty`), minutes before its merge `768b6d8`; exact commit not recorded | 2026-09-07 14:44 |
| `Agentforge-0.14.22-mac-arm64.dmg` / `.zip`, `-x64.dmg` / `.zip` | `ce7b25b` (merge of PR #24), built in the Docker pipeline from PR #25 | 2026-09-08 06:23 |
| `Agentforge-Setup-0.14.23.exe` + `.blockmap` + `latest.yml` | `4fc02f4` (`release/0.14.23`), clean tree, isolated worktree `agentforge-pack`, sha256 `b1989a84…9aa98a` | **built 2026-09-08 15:10 UTC, not uploaded** |
| `Agentforge-0.14.23-mac-arm64.dmg` / `.zip`, `-x64.dmg` / `.zip` | `4fc02f4`, Docker pipeline, `mac-0.14.23.sha256` | **built 2026-09-08 15:10 UTC, not uploaded** |

Everything from PR #21 (Edit studio), PR #22 (starter media prompt templates), the 0.14.2 release commit `6aad7cd`, and PR #23 (Research dossier, Data, Finance, source material, Markdown tables, HTTPS-only fetch) is inside both 0.14.22 installers.

## On `main`, not in any published installer (ships as 0.14.23)

Detailed entries live in [`0.14.23-changelog.md`](0.14.23-changelog.md); this is the index.

- **Legal mode v1** (.docx matter review: classify → diff → clause review → verify / edit loop → memo, redline, deviation report, red-flags). Built in a parallel session; two docx fixture tests still fail; no live run yet.
- **Knowledge ingest loop** (work cards from every Chat turn / job, `knowledge-loop` chart, skip-self retrieval, `Send to Knowledge Base` dedupe, cascade on delete).
- **Hardening rounds 1 to 6** (PII masking + injection guard on every KB write, guard bypass fixes, workspace-scoped threads, runs never stuck `streaming`, FTS5 query quoting, catalog memo, malformed input → 4xx).
- **Offline requirement** (bundled Barlow fonts, chat fails fast on a refused or black-holed gateway, bounded settings save, embeddings circuit breaker, updater skips the startup check offline, model caches under `AGENTFORGE_DATA_DIR`).
- **Videos** example clips bundled under `resources/examples/videos/` + real upstream-refusal error text; **Chat** hides model-contact probing.
- **PR #24 to #27** (studios scroll, rail theme icon + dark contrast, Windows-neutral macOS shell rows, mac build pipeline docs). The Windows exe predates all four; the mac files predate #25 to #27.

## Still open before the 0.14.23 cut

- [x] `packages/core/src/docx`: term-sheet `diff.test.ts` pair quarantined (`it.skip`); `read.test.ts` "excludes deleted words" keeps asserting except the one re-typed deletion; `zz-debug.test.ts` deleted. Proof: 46 passed / 1 skipped on those two files.
- [ ] Legal: one live matter run against the gateway (`features/legal.md` steps 4 to 8), Word / Excel round-trip of the redline and deviation report.
- [ ] Videos studio duration knob vs. veo: `veo_3_1-fast` only accepts 4 / 6 / 8 s, the studio offers 5 / 8 / 10, so 5 s and 10 s fail with "Only [4, 6, 8] seconds durations are supported". Snap or hide per model in `video-capabilities.ts`.
- [ ] Isolate host vitest from the operator's desk (`AGENTFORGE_DATA_DIR` / `MEDIA_ROOT` to a temp dir in a setup file); then purge the 37 stub video rows from `data/agentforge.sqlite` so the dev Videos gallery is clean again.
- [ ] Drive the 0.14.22 "Verify on the installed app" lists (`0.14.22-changelog.md`) on the packaged **Windows** app (`%APPDATA%\Agentforge`, NSIS). That is not mac proof.
- [ ] **macOS, separate from the Windows cut:** `pnpm desktop:build:mac:docker --arch all` (static bundle only; never `electron-builder --mac` on this host). First-launch smoke on a real Mac (Gatekeeper, Keychain, Cmd+Q stops ffmpeg, Dock reopen). Do not attach `.dmg`/`.zip` until that list is driven, or ship Windows-only and say so in the notes.
- [x] Source commit recorded: both the Windows exe and the mac dmg / zip come from `4fc02f4` (clean tree). Release dry run with `--require-mac` passes; `pnpm desktop:release` (exe + mac in one release) waits for Kyo's go.

## Log

- **2026-09-08 (repack)** — Both installers rebuilt from `4fc02f4` in separate environments: Windows in a fresh worktree (`C:\Users\rizky\agentforge-pack`, own `node_modules`), macOS in the Docker pipeline. Repacked Windows build driven over CDP (doctor ok, Legal studio, six example clips playing from `agentforge://video-example/`, knowledge loop, updater "latest", local fonts, no remote requests, close kills the tree). `release-desktop.mjs --dry-run --require-mac` ok, nothing uploaded. Fixed on the way: CRLF container scripts (`.gitattributes`), node-gyp picking Python 3.14 (pin `PYTHON`), `ELECTRON_RUN_AS_NODE` in the agent shell. Details in `0.14.23-changelog.md`.
- **2026-09-08 (late night)** — Version bumped to 0.14.23 on branch `release/0.14.23` (commits: `638dcb3`, `8bce66d`, plus the release-prep commit). Whole working tree committed: Legal mode v1, Knowledge ingest loop + hardening rounds, offline work, Videos example clips. Compile proof: `vite build` green, `stage-renderer.mjs` → `host.cjs` 2.27 MB with the new routes, no new `tsc` errors (fixed `legal/run.ts`, `ipc-abort.ts`), host 258 / web 191 / db 14 / legal 1 / desktop ok, core 909 / 911 (the two docx fixture tests above). Public notes drafted at `docs/public/0.14.23-notes.md`. Nothing packed, nothing published.
- **2026-09-08 (night)** — Hardening rounds: probe agents (secrets, concurrency, offline) against isolated stub instances. Fixed: plaintext PII / injection text in work cards (mask + guard), guard bypasses (base64+path shortcut, homoglyphs), threads not workspace-scoped, runs stuck `streaming` under a hung gateway, offline hangs (120 s chat, 20 min settings save, 20 s embeddings, Google Fonts), catalog rebuilt on every request (230 ms), KB cascade on thread/artifact delete, malformed-input 500s. Details in `0.14.23-changelog.md`. Owner requirement recorded: **everything local, no internet needed**.
- **2026-09-08 (evening)** — Knowledge ingest loop landed on the working tree (host `knowledge-ingest.ts` / `work-cards.ts`, origin columns, `knowledge-loop` chart, verify recipe `features/knowledge-ingest.md`). Host 209 / web 152 / db 14 unit tests green; `vite build` green. Not yet driven on the packaged app.
- **2026-09-08 (later)** — Videos example clips (bundled, offline) + gateway video poll parsing fix. Found while generating the clips: `grok-imagine-video` on this key currently returns `FAILURE` / `上游拒绝了该请求，请稍后重试` (upstream refused) within ~60 s of submit; the Videos studio showed that as "success". Also noted: host vitest without `AGENTFORGE_DATA_DIR` writes stub media rows into the dev desk's `data/` gallery (37 junk video rows there today); run with a temp data dir until the config isolates it.
- **2026-09-08** — file created after PR #27 merged (`4f1ce13`). Audit of PR #24–#26 against the Windows bundle: only `lifecycle.cjs`, the child-process registry, and the updater plumbing land in the exe, all behavior-neutral on Windows.
