# Pack traps (this Windows desk)

Lived through 0.14.23 and 0.14.25. Read when a step fails; do not invent a third environment. Windows pack and mac pack are different routes (different cwd, command, natives, artifacts, proof). A failure on one is not diagnosed with the other.

## Python / natives

electron-builder's `@electron/rebuild` (node-gyp) picks `python3` = Windows Store **3.14**, which has no `distutils`. Pin both:

```
PYTHON=C:\Users\rizky\AppData\Local\Programs\Python\Python312\python.exe
npm_config_python=<same>
```

Do not use the Hermes venv path; it may be gone.

## `ELECTRON_RUN_AS_NODE`

Agent shells inject this. Electron then runs as Node and the pack/launch is nonsense. `Remove-Item Env:ELECTRON_RUN_AS_NODE` in every pack shell. Preflight fails if it is set.

## Dirty tree vs Docker

`mac-build-docker.mjs` clones **HEAD** of the mounted checkout. Uncommitted product code is not in the `.app`. `make-dmg.py` / `verify-bundle.py` are read from the `/src` mount (working tree), so a dmg-script fix can be tested with `--allow-dirty`, but the app inside the dmg is still HEAD. Commit the version bump before packing.

## Isolated Windows worktree

Pack Windows in `C:\Users\rizky\agentforge-pack-<version>`, not the main checkout (keeps `node_modules` / dist isolated). Do **not** reuse `C:\Users\rizky\agentforge-pack` — that tree is the 0.14.23 `4fc02f4` leftover.

Copy gitignored media from the main checkout after `git worktree add`:

- `apps/desktop/resources/starters` (7 files: 6 mp4 + 1 m4a)
- `apps/desktop/resources/examples/videos` (6 mp4)

`desktop-build` runs `edit-starters.mjs --check` and `video-examples.mjs --check` first.

## NSIS `/S`

`oneClick: false` + `allowToChangeInstallationDirectory: true`. `/S` hangs on a directory UI. Do not wait on it. Packaged proof: launch `apps/desktop/dist/win-unpacked/DPSBuddy.exe`, then `doctor.mjs --desktop`. Human runs `DPSBuddy Setup <v>.exe` for the real install.

## macOS dmg `hfsplus ls`

`make-dmg.py` `parse_hfs_ls_name` must keep **spaced** helper names (`DPSBuddy Helper (GPU).app`) and accept numeric dates (`8/12/2026 12:17`, 7 columns) as well as `Jan 01 1980` (8 columns). Symptom if the parser regresses:

```
ERROR: /DPSBuddy.app: … ['Contents']
ERROR: /DPSBuddy.app/Contents/Frameworks: … ['DPSBuddy Helper (GPU).app', …]
```

Doubling the HFS+ volume does **not** fix a parser bug. How-to: `apps/desktop/platform/macos/BUILD-DMG-ON-WINDOWS.md`.

## Wrong cwd

| You are in | Allowed | If you run the other command |
|---|---|---|
| `C:\Users\rizky\agentforge-pack-<v>` | `desktop:build` (NSIS) | Docker would mount the worktree as `/src` and write mac files next to `win-unpacked` |
| `C:\Users\rizky\agentforge` | `desktop:build:mac:docker` | `desktop:build` pollutes main `node_modules` / `dist` (the 0.14.23 reason for the worktree) |

Python 3.12 is **Windows native rebuild** only. The Linux container does not use that interpreter.

## Mixing proof

| Env | Allowed proof | Not proof |
|---|---|---|
| Windows worktree pack | `latest.yml` sha512, `host.cjs` grep, `doctor --desktop` on unpacked/installed exe | Docker verify-bundle, `:3000` |
| Docker mac pack | container `verify-bundle.py` (app + dmg + zip), `mac-<v>.sha256` | `doctor --desktop` on this PC, claiming the app launched |
| webdev `:3000` | product UI while developing | packaged / shipped |

Never run `electron-builder --mac` on this host. Cloud Linux runs neither path.

## Combining dist

Windows artifacts land in the **worktree** `dist/`. Mac artifacts land in the **main checkout** `dist/`. Copy exe + blockmap + `latest.yml` into the main `dist/` before `desktop-release`. Archive other-version Setup exes / mac files or pass `--allow-stale`.

`--require-mac` needs both arches' `.dmg`. `latest-mac.yml` and mac blockmaps are never uploaded.

## Two repos

Source commits stay on `Kyoo032/agentforge`. `pnpm desktop:release` creates a GitHub **release** on `Kyoo032/DPSBuddy` (binaries + `docs/public/<v>-notes.md`). Do not `git push` source to DPSBuddy.
