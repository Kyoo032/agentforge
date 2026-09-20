# Map — Desktop pack routes

> **Desktop is frozen at 0.14.27 — maintenance only.** The product continues as a hosted, multi-user web app.
> Everything below stays true and keeps working; it just gets no new features, and no new cut unless Kyo asks.
> Decision record: [`web-pivot-2026-09-18.md`](../web-pivot-2026-09-18.md).

Last verified: 2026-09-20 at 69afca9

## Overview

Two separate routes producing one GitHub release. **Windows** builds an NSIS installer with electron-builder inside an isolated git worktree. **macOS** builds `.app` / `.dmg` / `.zip` inside a Linux Docker container, from the main checkout. They never share a working directory and never share proof.

Everything here is harness, not product: the pack skill lives in `.cursor/skills/pack-dpsbuddy/` and nothing in it ships inside DPSBuddy.

## How it works

### Shared prep

`.cursor/skills/pack-dpsbuddy/SKILL.md:140`, `:145-152`: run preflight, `git fetch origin` and rebase the bump onto `origin/main`, bump **only** `apps/desktop/package.json` version, write `docs/public/<version>-notes.md`, point the AGENTS.md ship list at that patch, commit. The commit matters because **Docker packs HEAD**.

`.cursor/skills/pack-dpsbuddy/scripts/preflight.mjs` aborts on: not `win32` (`:34-36`), `CI` or `CURSOR_CLOUD` set (`:37-39`), `ELECTRON_RUN_AS_NODE` set (`:40-42`), missing or non-3.12 Python (`:44-52`), Docker not reporting `linux` (`:54-58`), a non-semver version, and fewer than 7 starter files / 6 example clips (`:67-75`). A **dirty tree is reported, not fatal** (`:64-65`) — with the note that mac Docker builds HEAD only.

### Windows — NSIS in an isolated worktree

```
$pack = "C:\Users\rizky\agentforge-pack-$v"
git worktree add --detach $pack (git rev-parse HEAD)
# copy the gitignored starter/example media into $pack
cd $pack; pin Python 3.12; unset ELECTRON_RUN_AS_NODE
npx pnpm@9.15.9 install --frozen-lockfile
npx pnpm@9.15.9 desktop:build
```

(`.cursor/skills/pack-dpsbuddy/SKILL.md:154-165`.) `desktop:build` chains (`apps/desktop/package.json:9`): `scripts/edit-starters.mjs --check` → `scripts/video-examples.mjs --check` → `pnpm --filter @agentforge/web build` → `apps/desktop/scripts/stage-renderer.mjs` → `apps/desktop/scripts/pack-brand.mjs`.

`stage-renderer.mjs` (`apps/desktop/scripts/stage-renderer.mjs:24-61`): esbuild-bundles `src/host-entry.ts` → `host.cjs` (cjs, minified, externals `better-sqlite3` / `electron` / `keytar`), copies `apps/web/dist` → `resources/renderer` minus source maps, **injects the CSP**, copies `packages/db/drizzle` → `resources/drizzle`, re-checks starter media, and fails if `resources/drizzle/meta/_journal.json` is missing.

`pack-brand.mjs` copies brand assets into place, resolves `electron-builder/cli.js` and spawns it with `--win nsis --publish never` plus `-c.artifactName` / `-c.productName` / `-c.appId` / `-c.win.icon` overrides, then **unconditionally restores the public `agentforge` brand** (`apps/desktop/scripts/pack-brand.mjs:226-230`) — even when the build failed — so splash and icon leftovers cannot leak into the next public build or a commit.

electron-builder config (`apps/desktop/package.json:34-170`): `appId com.tokotoken.agentforge`, `productName DPSBuddy`, `artifactName "DPSBuddy Setup ${version}.${ext}"`, `compression maximum`, `win.target [{nsis, x64}]`, `nsis { oneClick:false, perMachine:false, allowToChangeInstallationDirectory:true, deleteAppDataOnUninstall:true }`. The asar carries `main.cjs`, `preload.cjs`, `brand-read.cjs`, `auto-update.cjs`, `edit-menu.cjs`, `lifecycle.cjs`, `navigation.cjs`, `renderer-csp.cjs`, `host.cjs` and `splash/**`. `asarUnpack` keeps `better-sqlite3` and `keytar` outside, because they are `.node` binaries.

### The CSP injection

Exact policy (`apps/desktop/renderer-csp.cjs:32-43`):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: agentforge:; media-src 'self' blob: agentforge:;
connect-src 'self' agentforge:; object-src 'none'; frame-src 'none';
base-uri 'none'; form-action 'none'
```

`injectCspMeta()` (`apps/desktop/renderer-csp.cjs:60-69`) puts it as the first child of `<head>` in `resources/renderer/index.html`, called at `apps/desktop/scripts/stage-renderer.mjs:46-47`. A `CSP_META` regex (`apps/desktop/renderer-csp.cjs:45-46`) strips any existing tag first, so a repack replaces rather than stacks.

**Why at stage time and not in `apps/web/index.html`** — `apps/desktop/scripts/stage-renderer.mjs:41-45`: the renderer ships as a `file://` document, where a response header never reaches it (Electron's `webRequest` does not observe Chromium's file loader), so the policy has to live in the page. It is injected at stage time because that same `index.html` is what `pnpm dev` serves through Vite, "whose Fast Refresh preamble, eval'd HMR client and dev-server websocket all fall foul of `script-src 'self'` / `connect-src 'self'`".

The policy is enforced **twice**: the meta tag governs the packaged `file://` window, and `installContentSecurityPolicy()` (`apps/desktop/main.cjs:366`, called at `:789`) adds a response header for anything else the packaged session serves, such as `agentforge://` responses.

### macOS — Docker Linux from the main checkout

```
cd C:\Users\rizky\agentforge     # NOT the worktree
Remove-Item Env:ELECTRON_RUN_AS_NODE
npx pnpm@9.15.9 desktop:build:mac:docker --arch all
```

`apps/desktop/scripts/mac-build-docker.mjs` checks Docker is in Linux mode (`:63-68`), **refuses a dirty tree** unless `--allow-dirty` and requires the starter media (`:70-88`), builds `agentforge-mac-builder:latest` (`:100-105`), then runs the container with the repo mounted read-only at `/src`, `dist` at `/out` and a named cache volume (`:108-115`).

Inside, `apps/desktop/platform/macos/docker/build-mac.sh`:

1. `git clone --no-hardlinks /src /work` — **HEAD only** (`:29-44`), then copies the gitignored starter media from `/src`.
2. Linux `pnpm install --frozen-lockfile`, renderer build, `stage-renderer.mjs`, `pack-brand.mjs --restore-public` (`:47-54`).
3. Darwin native swap: strip `better-sqlite3/build`, keep only `prebuilds/darwin-<arch>.node`; download and cache keytar's official `napi-v3-darwin-<arch>` prebuild; fetch the darwin `@firecrawl/anydoc` package per arch against the sha512 pinned in `packages/host/src/components/manifest.ts` and purge every non-darwin anydoc package from the pnpm store (`:56-107`).
4. Per arch (`:114-160`): verify the keytar binary is Mach-O; `npx electron-builder --mac --dir --$arch -c.npmRebuild=false -c.mac.identity=null --publish never`; `rcodesign sign` the whole bundle ad-hoc; `verify-bundle.py` on the raw `.app`; `zip -r -y -X`; `make-dmg.py` building an HFS+ volume with libdmg-hfsplus; `verify-bundle.py` again over the packaged dmg **and** zip.
5. Copy `DPSBuddy-<version>-mac-*.dmg|zip` to `/out` and write `mac-<version>.sha256` (`:162-168`).

Note the Docker route does **not** use electron-builder's own dmg/zip targets — it takes `--dir` (bundle only) and hand-rolls both archives.

### Release

Combine first: copy `DPSBuddy Setup <v>.exe`, `.blockmap` and `latest.yml` from the **worktree** dist into the main checkout's `apps/desktop/dist/` (mac artifacts are already there). Then `release-desktop.mjs --require-mac --dry-run`, then without `--dry-run`.

Gates in `apps/desktop/scripts/release-desktop.mjs`, in order:

| # | Gate | Line |
|---|---|---|
| 1 | Version is semver; `build.extraMetadata.version` agrees; `brand.json` `updates` is `{github, owner, repo}`; `package.json build.publish` agrees with it | `:75-93` |
| 2 | Working tree clean unless `--allow-dirty` | `:120-125` |
| 3 | `dist` exists; at most one `Setup*.exe` unless `--allow-stale`; exact exe name, `.blockmap` and `latest.yml` all present | `:127-141` |
| 4 | Stale mac artifacts fail unless `--allow-stale`; `latest-mac.yml` logged but never uploaded; `--require-mac` fails if either arch's dmg is missing | `:144-157` |
| 5 | `latest.yml` version matches; exe size matches; exe sha512 matches in both the file entry and top level; `url` and `path` equal the hyphenated exe name | `:159-175` |
| 6 | Refuses to publish `docs/internal/` notes to the public repo | `:177-188` |
| 7 | Stages hyphenated copies (electron-updater's GitHub provider expects hyphens, not spaces) | `:190-210` |
| 8 | `gh release create v<version> --repo Kyoo032/DPSBuddy` must succeed | `:280-288` |
| 9 | Post-upload, re-reads the release and fails unless the asset-name set matches exactly | `:220-241`, `:287` |

`--attach-mac` adds mac artifacts to an already-published Windows release without touching the exe, blockmap or `latest.yml` (`:243-268`), refusing to silently replace an asset that already exists.

### Updater posture

`publish` is GitHub, owner `Kyoo032`, repo `DPSBuddy`, `releaseType: "release"` (`apps/desktop/package.json:157-162`). There is **no channel concept**.

**Windows: on.** `updatesEnabled(productName, isPackaged, platform)` (`apps/desktop/auto-update.cjs:53-55`) requires packaged, the public product name, and a platform not in `UNSIGNED_PLATFORMS`. `autoDownload` and `autoInstallOnAppQuit` are both **false** (`:266-269`) — "This app exits via `app.exit()` … so Electron's 'quit' event never fires and install-on-quit would be dead code; installs go through `updates:install` -> `quitAndInstall` only." A startup check runs unless offline (`:337-345`), and `updates:check` never offers a downgrade (`:294-308`).

**macOS: off by construction.** `UNSIGNED_PLATFORMS = new Set(["darwin"])` (`apps/desktop/auto-update.cjs:39`), because "electron-updater refuses to install on macOS unless the app is code-signed, and the mac build ships with `identity: null`. Offering a download there would end in an install that cannot run" (`:35-38`). The user sees `MAC_MANUAL_MESSAGE` (`:40`). `latest-mac.yml` is therefore **never uploaded** — stated in three independent places (`apps/desktop/scripts/release-artifacts.mjs:7-8`, `release-desktop.mjs:10-11`, `apps/desktop/platform/macos/AGENTS.md:52`): "a feed it cannot consume must not exist on the release".

### Traps

| Trap | Symptom | Guard |
|---|---|---|
| `ELECTRON_RUN_AS_NODE` set by an agent shell | Electron runs as Node; the pack and any launch are nonsense | Unset in every pack shell; preflight aborts (`traps.md:16-18`, `preflight.mjs:40-42`) |
| Wrong Python | `@electron/rebuild` picks Windows Store Python 3.14, which has no `distutils` | Pin `PYTHON` / `npm_config_python` to 3.12; preflight checks the version (`traps.md:5-14`, `preflight.mjs:44-52`). **Windows-native rebuild only** — the Linux container does not use that interpreter (`traps.md:59`) |
| Dirty tree | Uncommitted product code is silently absent from the `.app`, because Docker clones HEAD | Commit the bump first; `mac-build-docker.mjs:76-82` refuses without `--allow-dirty` (`traps.md:22-24`) |
| Stale or shared worktree | Building against old leftovers, or polluting main `node_modules` / `dist` | Fresh `agentforge-pack-<version>` every time; never reuse the un-suffixed `agentforge-pack` (`traps.md:26-35`) |
| Wrong cwd | Docker would mount the worktree as `/src` and drop mac files next to `win-unpacked`; NSIS in main pollutes main | The cwd→command table (`traps.md:52-57`); `SKILL.md:196` |
| NSIS `/S` hangs | Silent install waits forever | `oneClick:false` + `allowToChangeInstallationDirectory:true` show a directory picker `/S` cannot drive. Prove by launching `dist\win-unpacked\DPSBuddy.exe` (`traps.md:37-39`) |
| `hfsplus ls` parser | `ERROR: /DPSBuddy.app: … ['Contents']` | `make-dmg.py`'s `parse_hfs_ls_name` must keep spaced helper names (`DPSBuddy Helper (GPU).app`) and accept both numeric and `Jan 01 1980` date columns. Fix the parser, do not double the volume (`traps.md:41-50`; history in `BUILD-DMG-ON-WINDOWS.md:47`, fixed in `051382e` / `9c0bd27`) |
| `hfsplus` silent exit | Prints nothing and exits 0 when the catalog cannot grow | Per-directory `ls` read-back in `make-dmg.py`, plus `verify-bundle.py --dmg` as the second net (`BUILD-DMG-ON-WINDOWS.md:46`) |
| 7-Zip symlink reading | Shows dmg symlinks as small files whose bytes are the target path | Prove from the HFS+ catalog's own mode bits via `dmg extract` + `hfsplus ls` (`verify-bundle.py:323-352`) |
| Two repos | Source pushed to the wrong repo | Source stays on `Kyoo032/agentforge`; binaries go to `Kyoo032/DPSBuddy`; never `git push` source there (`traps.md:77-79`) |

### Proof, and what is not proof

**Windows proof:** launch `apps/desktop/dist/win-unpacked/DPSBuddy.exe` directly; `node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop` from the **main** checkout, exiting 0 with `surface: "desktop"`, `transport: "ipc"`, `url: "ipc"`; the `latest.yml` sha512 check; a `host.cjs` grep; and, after any shell or menu change, the manual smoke (Ctrl+V **and** right-click Paste on the key field, composer Ctrl+A/C/V, and no `DPSBuddy.exe` / `ffmpeg.exe` left in Task Manager after closing).

`doctor --desktop` finds the app through `host-status.json`, picking the newest existing candidate among `%APPDATA%\DPSBuddy`, `%APPDATA%\Kemenkeu AI`, `%APPDATA%\AIHub Metranet` and the legacy `%APPDATA%\@agentforge\desktop` (`.cursor/skills/verify-agentforge/scripts/desktop-app-url.mjs:47-56`), then validates `transport === "ipc"`, `ready === true`, a positive integer pid and a non-empty `dataDir` (`.cursor/skills/verify-agentforge/scripts/doctor.mjs:90-105`).

**macOS proof:** per-arch `verify: all checks passed` from `verify-bundle.py` on the `.app` **and** on the dmg and zip, plus `mac-<v>.sha256`. That is **static proof only**.

**Not proof:** Docker `verify-bundle.py` as Windows proof, or `doctor --desktop` on this PC as mac proof (`traps.md:61-67`); doctoring `:3000` as the installer (`traps.md:65`); `pnpm desktop:dev`, which is an Electron wrapper around webdev with no preload attached (`apps/desktop/platform/windows/AGENTS.md:27`); and above all "Docker exited 0" (`SKILL.md:200`).

## Where things live

| File | Role |
|---|---|
| `.cursor/skills/pack-dpsbuddy/SKILL.md` | The two-route playbook, checklist, do-not list |
| `.cursor/skills/pack-dpsbuddy/traps.md` | Every recorded failure and its guard |
| `.cursor/skills/pack-dpsbuddy/scripts/preflight.mjs` | Fail-closed environment gate |
| `apps/desktop/package.json` | electron-builder config for both platforms; the `desktop-*` scripts |
| `apps/desktop/scripts/stage-renderer.mjs` | `host.cjs` bundle, renderer copy, CSP injection, drizzle copy |
| `apps/desktop/renderer-csp.cjs` | The one CSP string and `injectCspMeta` |
| `apps/desktop/scripts/pack-brand.mjs` | Brand swap, electron-builder invocation, unconditional restore |
| `apps/desktop/scripts/mac-build-docker.mjs` | Host-side Docker wrapper and its dirty-tree refusal |
| `apps/desktop/platform/macos/docker/{Dockerfile,build-mac.sh,make-dmg.py,verify-bundle.py}` | The container pipeline |
| `apps/desktop/scripts/release-desktop.mjs` | Every publish gate |
| `apps/desktop/scripts/release-artifacts.mjs` | Which dist files belong to a release |
| `apps/desktop/auto-update.cjs` | Updater posture, `updates:*` IPC |
| `apps/desktop/platform/macos/BUILD-DMG-ON-WINDOWS.md` | How-to, failure table, and "what it does not prove" |
| `.cursor/skills/verify-agentforge/scripts/doctor.mjs`, `desktop-app-url.mjs` | `--desktop` health check |

## Gotchas

- **The Python 3.12 pin is Windows-only.** It means nothing inside the Linux container, and applying it there is cargo cult (`traps.md:59`).
- **Docker packs HEAD, but the dmg *scripts* come from the live mount.** `make-dmg.py` and `verify-bundle.py` are read from `/src`, so a script fix can be tested with `--allow-dirty` while the app inside the dmg is still HEAD. Easy to misread as "my product fix got in".
- **`pack-brand.mjs` is Windows/NSIS-only.** The Docker route calls it just to restore the public brand; the mac artifacts come from a bare `electron-builder --mac --dir`.
- **A failed Windows build still leaves a clean tree**, brand-wise, because the restore runs before the exit code is checked.
- **This route still proves nothing about launching, but a Mac launch has now happened.** `verify-bundle.py` passing for 0.14.23, 0.14.25 and 0.14.26 is static proof only (`apps/desktop/platform/macos/AGENTS.md:35`). Blocker V2 was closed on 2026-09-15 by the owner installing and launching the dmg on his own Mac (`docs/internal/blockers-2026-09-15.md:220`) — the pack route did not prove that, an install on hardware did. `apps/desktop/platform/macos/AGENTS.md:35` and `BUILD-DMG-ON-WINDOWS.md:59-61` still read as if nobody ever had; they are stale on that point, not this page.
- **Preflight's dirty-tree check does not abort** even though most of its siblings do. The hard refusal lives in `mac-build-docker.mjs`, not preflight.
- **`latest-mac.yml` existing locally is normal**; uploading it is the error.
- No repo line says in so many words that "a green `tsc` is not proof" — that follows from `SKILL.md:25` ("Never reuse the other route's proof") and the verify skill's proof definition, and is inference rather than quotation.

## Verify

`.cursor/skills/verify-agentforge/features/desktop.md` (and `features/desktop-brands.md` for the branded variants). The proof contract is action + named result + capture + doctor JSON; the Windows smoke list is at `apps/desktop/platform/windows/AGENTS.md:29-40`, the 11-step mac list at `apps/desktop/platform/macos/AGENTS.md:54-66`.

## Why

**Why the two routes are kept separate.**

- `[Direct]` **Technical necessity.** `apps/desktop/scripts/mac-build-docker.mjs:4-7` and `BUILD-DMG-ON-WINDOWS.md:21`: electron-builder allows the mac target on Linux but not on Windows — "it only refuses the mac target when `process.platform === 'win32'`". So mac cannot be built on this host directly; a Linux container is the only route.
- `[Direct]` **Contamination.** `.cursor/skills/pack-dpsbuddy/traps.md:56-57`: running `desktop:build` in the main checkout "pollutes main `node_modules` / `dist` (**the 0.14.23 reason for the worktree**)", and running Docker in the worktree "would mount the worktree as `/src` and write mac files next to `win-unpacked`".
- `[Direct]` **The incident that started the isolation rule.** `docs/internal/0.14.1-changelog.md:39`: a temp worktree with symlinked `node_modules` was deleted with PowerShell `Remove-Item -Recurse`; it followed the links and wiped tracked files in `packages/core`, `packages/db`, `packages/university`. "Rule recorded: never symlink into a worktree, never recursive-delete on Windows without checking for links."
- `[Direct]` **Proof hygiene.** `SKILL.md:25`: "Never run one command in the other cwd. Never reuse the other route's proof." The two routes produce different artifacts on different OS surfaces, and this PC cannot launch a `.app`.

**Confidence: high.** Four independent sources, one of them a recorded incident.

**Why "Docker exit 0 is not mac proof".** `[Direct]` `AGENTS.md:48`: "macOS: `verify-bundle.py` on `.app` **and** dmg/zip per arch. Docker exit 0 is not mac proof; the hardware smoke (Gatekeeper, Keychain, Cmd+V, Cmd+Q, Dock reopen) is still owed, and mac stays labelled preview until it is driven." `[Direct]` `BUILD-DMG-ON-WINDOWS.md:59-61` on what the verifier does not prove: "That the app launches. Nobody has opened these files on a Mac. … Testers' reports are that proof." **Confidence: high.**

**Why the CSP is injected at stage time.** `[Direct]` `apps/desktop/scripts/stage-renderer.mjs:41-45` and `apps/desktop/renderer-csp.cjs:27-30`: the packaged renderer is a `file://` document that a response header cannot reach, so the policy must be in the page; but baking it into `apps/web/index.html` would break `pnpm dev`, because Vite's Fast Refresh preamble, its eval'd HMR client and its dev-server websocket all violate `script-src 'self'` / `connect-src 'self'`. **Confidence: high.**

**Why the macOS updater is off rather than configured.** `[Direct]` `apps/desktop/auto-update.cjs:35-38`: electron-updater refuses to install on macOS without code signing, the mac build ships `identity: null`, and "offering a download there would end in an install that cannot run". It is a consequence of shipping unsigned, not a product choice — signing would flip it. **Confidence: high.**
