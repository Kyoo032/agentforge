# Building the macOS dmg + zip on Windows

How the 0.14.22 macOS preview was produced on 2026-09-08 without a Mac, what each tool replaces, every failure hit on the way and its fix, and the proof the result carries. Read [`AGENTS.md`](AGENTS.md) first for the rules; this file is the how-to.

## TL;DR

```
# Docker Desktop running, tree committed (the container builds HEAD)
pnpm desktop:build:mac:docker              # first run also builds the image (~5 min)
pnpm desktop:release --attach-mac --dry-run
pnpm desktop:release --attach-mac          # existing release; or plain desktop:release for a new version
```

Output: `apps/desktop/dist/DPSBuddy-<version>-mac-{arm64,x64}.{dmg,zip}` plus `mac-<version>.sha256`. About 7 minutes per arch after the image and caches exist.

## Why this works at all

| Apple tool | What it does on a Mac | Replacement here |
|---|---|---|
| Xcode / clang | compiles native modules | not needed: better-sqlite3 13 ships N-API `prebuilds/darwin-<arch>.node` inside its npm tarball; keytar 7.9.0 publishes `napi-v3-darwin-<arch>` prebuilds on GitHub. N-API binaries work for any Electron version. |
| electron-builder on macOS | assembles `DPSBuddy.app` from the Electron zip | electron-builder on **Linux**: it only refuses the mac target when `process.platform === "win32"` (`app-builder-lib/out/packager.js`). Symlinks and execute bits survive because Linux has them. |
| `codesign` | signs the bundle | `rcodesign` (apple-codesign, Rust). Ad-hoc signs the whole bundle inside-out: helpers, framework, main binary, `CodeResources`. |
| `hdiutil` | creates the dmg | `mkfs.hfsplus` (hfsprogs) for an empty HFS+ volume, `hfsplus` (libdmg-hfsplus) to fill it, `dmg build` (libdmg-hfsplus) to wrap it as zlib-compressed UDIF. |
| `iconutil` | `.icns` from an iconset | electron-builder's own `app-builder icon` converts `build/icon.png` (1024², 8-bit) on any OS. |

Why signing matters even though the app is "unsigned": Electron's prebuilt binaries already carry an ad-hoc signature that hashes their Info.plist. electron-builder rewrites every Info.plist (name, bundle id, version), so the signature no longer matches. Apple silicon refuses to run a Mach-O with a mismatched or missing signature ("Killed: 9"). Re-signing ad-hoc restores consistency; it does not make the app trusted (Gatekeeper still needs the "Open Anyway" step in the public notes).

## The pipeline (files in [`docker/`](docker/))

1. **`scripts/mac-build-docker.mjs`** (Windows). Checks Docker is in Linux mode, refuses a dirty tree unless `--allow-dirty` (the container only sees HEAD), builds `agentforge-mac-builder:latest` from `docker/Dockerfile`, runs it with the checkout at `/src` (read-only), `apps/desktop/dist` at `/out`, and the named volume `agentforge-mac-cache` at `/cache` (electron zips, electron-builder cache, pnpm store, keytar tarballs).
2. **`docker/build-mac.sh`** (container). `cd /` then clone `/src` to `/work`; copy the gitignored starter media from `/src`; `pnpm install --frozen-lockfile` (Linux natives, replaced later); web build; `stage-renderer.mjs`; `pack-brand.mjs --restore-public`. Then per arch: keep only `prebuilds/darwin-<arch>.node` in better-sqlite3 and delete its `build/`; untar keytar's darwin prebuild into `build/Release/keytar.node`; `npx electron-builder --mac --dir --<arch> -c.npmRebuild=false -c.mac.identity=null --publish never`; `rcodesign sign DPSBuddy.app`; `verify-bundle.py`; `zip -r -y -X`; `make-dmg.py`; `verify-bundle.py --dmg --zip`; copy to `/out`; sha256 manifest.
3. **`docker/make-dmg.py`**. Sizes a sparse file from the bundle (+25%, 8 KB per entry, 16 MB, min 64 MB), `mkfs.hfsplus -v "<volume>"`, then walks the `.app` top-down issuing `hfsplus <img> mkdir|add|symlink|chmod`. Symlinks are recreated as symlinks (`addall` is not used because it follows them and aborts on directory links), executables get `chmod 755`, every directory is read back with `ls` right after it is filled, `/Applications` symlink at the root, then `dmg build <img> <out.dmg>`.
4. **`docker/verify-bundle.py`**. Static proof, see below.

## Failures hit and their fixes (keep for the next person)

| Symptom | Cause | Fix |
|---|---|---|
| `apt: Package 'hfsprogs' has no installation candidate` | hfsprogs is in Debian **non-free** (Apple Public Source License) | `sed` `Components: main non-free non-free-firmware` into `/etc/apt/sources.list.d/debian.sources` |
| libdmg-hfsplus: `field 'hmacCTX' has incomplete type` | its FileVault code predates OpenSSL 3, and `INCLUDE(FindOpenSSL)` ignores `CMAKE_DISABLE_FIND_PACKAGE_OpenSSL` | `sed -i 's/^IF(OPENSSL_FOUND)/IF(FALSE)/' dmg/CMakeLists.txt` before cmake; FileVault is not needed |
| `git clone` "checkout failed", `getcwd() failed` | the script `rm -rf`'d `/work` while it was the cwd | `cd /` before removing and cloning |
| verifier: 6 non-Mach-O binaries, darwin-x64 in the arm64 app | better-sqlite3's tarball ships prebuilds for every platform | keep only `prebuilds/darwin-<arch>.node` per build (pristine copy restored between arches), delete `build/` |
| `rcodesign verify` exits 1: "no cryptographic signature present" | `verify` wants a certificate chain; ad-hoc has none | read `rcodesign print-signature-info` and require `code_directory` with `flags: CodeSignatureFlags(ADHOC)` |
| asar listing failed at `asar.js:252` | relative path resolved against `/work`, not `apps/desktop`; `listPackage` also needs `{ isPack: false }` | absolute path + options |
| 7-Zip shows dmg symlinks as regular files, "14 files not in the source bundle" | 7-Zip's HFS+ reader presents a symlink as a file whose bytes are the target path | prove symlinks from the catalog instead: `dmg extract <dmg> vol.hfs` then `hfsplus vol.hfs ls <dir>` shows mode `120644` (S_IFLNK); treat 7-Zip entries at symlink paths as links when size == len(target) |
| `hfsplus` prints nothing and exits 0 when the catalog cannot grow | tool design | per-directory `ls` read-back in `make-dmg.py`; the final `verify-bundle.py --dmg` diff is the second net |
| `make-dmg: ERROR: /DPSBuddy.app: … ['Contents']` on 0.14.25 at 362 MB, 1 GB, 2 GB and 4 GB | `names()` required 8 `ls` columns (`Jan 01 1980`). This image prints `8/12/2026 12:17` (7 columns), so every directory looked empty | parse the last field when the mode is octal digits; keep a double-and-retry only for a true catalog-full |
| `rcodesign sign` on a 7-Zip-extracted stock `Electron.app` fails ("size is smaller than a magical number") | 7-Zip turned the framework symlinks into tiny files | only a lab artifact; electron-builder unpacks Electron with symlinks intact and signing the real bundle works |

## What the verifier proves (both arches, commit `ce7b25b`)

- No ELF or PE file anywhere in the bundle; all 17 Mach-O files are the requested arch; `better-sqlite3/prebuilds/darwin-<arch>.node` and `keytar.node` are that arch; `better-sqlite3/build` absent.
- Main binary executable; four helper apps present and executable; `Electron Framework.framework/Versions/Current -> A` and the top-level framework link are symlinks.
- `Info.plist`: `CFBundleExecutable` DPSBuddy, `CFBundleIdentifier` com.tokotoken.agentforge, `CFBundleShortVersionString` = package version, `LSMinimumSystemVersion` 11.0.
- `app.asar` holds `main.cjs`, `preload.cjs`, `brand-read.cjs`, `auto-update.cjs`, `edit-menu.cjs`, `lifecycle.cjs`, `host.cjs`, `package.json`, `splash/index.html` (642 entries); `renderer/index.html`, `drizzle/meta/_journal.json`, `brand/brand.json`, `starters/` staged.
- ADHOC CodeDirectory with the right identifier on the main binary (`com.tokotoken.agentforge`), the Electron Framework (`com.github.Electron.framework`) and all four helpers (`com.tokotoken.agentforge.helper[.GPU|.Plugin|.Renderer]`).
- dmg read back through libdmg-hfsplus: all 192 files at matching sizes, all 14 symlinks with S_IFLNK mode, execute bit on all 25 executables, `/Applications` link at the volume root. zip: same files, `Versions/Current` stored as a symlink, execute bit kept.

## What it does not prove

That the app launches. Nobody has opened these files on a Mac. Owed on hardware: the 7-step smoke list in `AGENTS.md`, especially Keychain "Always Allow", Dock reopen, Cmd+Q killing ffmpeg, and that Apple silicon accepts the re-signed binaries. Testers' reports are that proof. Known deviations from a Mac-made build: HFS+ instead of APFS inside the dmg (mounts on every macOS since 10.12), symlink mode 0644 in the catalog (ignored by macOS), no bundled ffmpeg (Homebrew, see the public notes), no `latest-mac.yml` (updater is off on darwin by design).

## Re-verifying a finished artifact without rebuilding

```
docker run --rm -v "C:\Users\<you>\agentforge:/src:ro" -v "C:\Users\<you>\agentforge\apps\desktop\dist:/out:ro" \
  --entrypoint bash agentforge-mac-builder:latest -c '
  cd /tmp && unzip -q /out/DPSBuddy-<v>-mac-arm64.zip &&
  python3 /src/apps/desktop/platform/macos/docker/verify-bundle.py --app /tmp/DPSBuddy.app --arch arm64 --version <v> &&
  python3 /src/apps/desktop/platform/macos/docker/verify-bundle.py --app /tmp/DPSBuddy.app --arch arm64 --version <v> --dmg /out/DPSBuddy-<v>-mac-arm64.dmg'
```

The asar check needs a Linux `node_modules`; outside a build it reports a failure for that one item on a Windows checkout mounted at `/src`. Everything else runs.

## Release

`pnpm desktop:release` (Windows) picks `DPSBuddy-<version>-mac-<arch>.dmg|zip` from `dist/` and uploads them next to the exe. `--require-mac` insists on both arches, `--attach-mac` adds them to an already-published release and refreshes its notes from `docs/public/<version>-notes.md`. `latest-mac.yml` and mac blockmaps are never uploaded. First done for v0.14.22 on 2026-09-08: 7 assets on the public release.
