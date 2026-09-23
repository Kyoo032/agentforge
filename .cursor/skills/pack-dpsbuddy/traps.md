# Pack traps (this Windows desk)

Lived through 0.14.23, 0.14.25 and 0.14.26 (packed twice). Read when a step fails; do not invent a third environment. Windows pack and mac pack are different routes (different cwd, command, natives, artifacts, proof). A failure on one is not diagnosed with the other.

## Python / natives

electron-builder's `@electron/rebuild` (node-gyp) picks `python3` = Windows Store **3.14**, which has no `distutils`. Pin both:

```
PYTHON=C:\Users\rizky\AppData\Local\Programs\Python\Python312\python.exe
npm_config_python=<same>
```

Do not use the Hermes venv path; it may be gone.

## `ELECTRON_RUN_AS_NODE`

Agent shells inject this. Electron then runs as Node and the pack/launch is nonsense. `Remove-Item Env:ELECTRON_RUN_AS_NODE` in every pack shell. Preflight fails if it is set.

**The launch shell counts too (0.14.26).** Unsetting it for the build and then starting `DPSBuddy.exe` from a shell that still has it set gives a **silent** failure: the exe runs as plain Node, never boots a window, exits without an error line, and `doctor --desktop` finds nothing to talk to. It looks like a broken pack. `Remove-Item Env:ELECTRON_RUN_AS_NODE` before every launch as well as every build, and check `$env:ELECTRON_RUN_AS_NODE` in the shell you are actually launching from.

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
| Docker mac pack | container `verify-bundle.py` (app + dmg + zip), `mac-<v>.sha256` | `doctor --desktop` on this PC, claiming the app launched, Cua Fleet, Lume, Docker Desktop GUI |
| Mac hardware (someone else's Mac) | Gatekeeper, Keychain, Cmd+V, Dock, Cmd+Q, `doctor --desktop` on that machine | a green Docker log from this PC |
| WSL + `webapp-deploy` compose | hosted Linux image health | desktop pack, Jakarta CVM |
| webdev `:3000` | product UI while developing | packaged / shipped |

Never run `electron-builder --mac` on this host. Cloud Linux runs neither path.

## Combining dist

Windows artifacts land in the **worktree** `dist/`. Mac artifacts land in the **main checkout** `dist/`. Copy exe + blockmap + `latest.yml` into the main `dist/` before `desktop-release`. Archive other-version Setup exes / mac files or pass `--allow-stale`.

`--require-mac` needs both arches' `.dmg`. `latest-mac.yml` and mac blockmaps are never uploaded.

## Two repos

Source commits stay on `Kyoo032/agentforge`. `pnpm desktop:release` creates a GitHub **release** on `Kyoo032/DPSBuddy` (binaries + `docs/public/<v>-notes.md`). Do not `git push` source to DPSBuddy.

## Repacking the same version

0.14.26 was packed twice (a fix landed after the first pack). A repack of the **same version** from a new sha:

- gets its own fresh worktree, `C:\Users\rizky\agentforge-pack-<version>-<shortsha>` — never reuse the first pack's worktree, and never reuse the bare `agentforge-pack-<version>` name once a second sha exists;
- moves the earlier pack's artifacts out of the way into the main checkout's `apps/desktop/dist/superseded-<oldsha>/` — **both** routes, Windows and mac, so `desktop-release` cannot pick up a stale exe or dmg of the same version number;
- records **both** packs in the changelog's "Pack + publish" line, with each sha and which one shipped. A superseded pack that leaves no trace is indistinguishable from a pack that was never made.

## Git writes during a pack

`git worktree add` is the **only** git write a pack agent may make. No `stash`, `checkout`, `switch`, `restore`, `reset`, `rebase`, no commit, no branch move — the pack reads a sha, it does not move the tree.

A stash or checkout by any agent wipes every other worker's uncommitted edits in the shared checkout. This happened **twice on 2026-09-15** during a multi-worker pass, both times costing hours of unrelated work. If the tree is dirty and the pack needs a clean one, that is what the worktree is for.

## Branch moving mid-pack (0.14.27)

`mac-build-docker.mjs` clones HEAD **when the container starts**, not when the lane checked the sha. A docs-only commit landed on `release/0.14.27` between the mac lane's check (`05e97a5`) and the clone (`22f1f78`); harmless that time, but the recorded sha and the checked sha differed. While a Docker pack is running, nobody commits to the branch being packed. The orchestrator waits for the lane, then writes.

## pnpm hoists platform packages — purge the store, not the links (0.14.27, mac)

`@firecrawl/anydoc` has one optional dependency per platform. On the Linux install inside Docker pnpm fetches the `linux-*` ones, and `asarUnpack` `**/node_modules/@firecrawl/anydoc-*/**` then ships their ELF `.node` files into the Mac app; `verify-bundle` refuses it with `2 non-Mach-O native binaries`. Deleting the sibling symlinks under `.pnpm/@firecrawl+anydoc@<v>/node_modules/@firecrawl/` is **not** enough: pnpm also hoists every package into `node_modules/.pnpm/node_modules/` and keeps the real directory in `node_modules/.pnpm/@firecrawl+anydoc-linux-x64-gnu@<v>/`, and app-builder's `node-dep-tree` walks up into both. `build-mac.sh` now removes the non-darwin store entries and their links once after install, dies if a linux/win32 anydoc `.node` is still reachable, and swaps the pinned darwin package (sha512 from `packages/host/src/components/manifest.ts`) in beside anydoc per arch. Bump the manifest and the script together. It took three packs to learn this; the first two are in `superseded-e2e477e/` and the changelog.
