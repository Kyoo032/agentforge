#!/usr/bin/env bash
# Container entry point: build the unsigned-but-ad-hoc-signed macOS artifacts from the
# committed tree mounted at /src, writing dmg + zip per arch to /out.
#
#   MAC_ARCHES="arm64 x64"   which arches to build (default both)
#   /src   read-only bind mount of the agentforge checkout (only committed content is built;
#          apps/desktop/resources/starters is copied because it is generated and gitignored)
#   /out   bind mount of apps/desktop/dist on the host
#   /cache named volume: electron + electron-builder downloads, pnpm store, keytar prebuilds
#
# Every step that would silently produce a broken app is followed by a check. See
# apps/desktop/platform/macos/AGENTS.md for why each tool is here.
set -euo pipefail

SRC=/src
WORK=/work
OUT=/out
DOCKER_DIR="$SRC/apps/desktop/platform/macos/docker"
ARCHES="${MAC_ARCHES:-arm64 x64}"
export npm_config_store_dir=/cache/pnpm-store

log() { echo "mac-build: $*"; }
die() { echo "mac-build: ERROR: $*" >&2; exit 1; }

[ -d "$SRC/.git" ] || die "/src is not a git checkout"
[ -d "$OUT" ] || die "/out is not mounted"
mkdir -p /cache/keytar /cache/anydoc /cache/electron /cache/electron-builder

# ---------- 1. fresh clone of the committed tree ----------
log "cloning committed tree"
git config --global --add safe.directory '*'
cd /
rm -rf "$WORK"
git clone --quiet --no-hardlinks "$SRC" "$WORK"
cd "$WORK"
HEAD_SHA="$(git rev-parse --short HEAD)"
VERSION="$(node -p "require('./apps/desktop/package.json').version")"
KEYTAR_VERSION="$(node -p "require('./apps/desktop/package.json').dependencies.keytar.replace(/^[^0-9]*/, '')")"
log "version $VERSION at $HEAD_SHA, arches: $ARCHES"

STARTERS_SRC="$SRC/apps/desktop/resources/starters"
[ -d "$STARTERS_SRC" ] || die "starter media missing at $STARTERS_SRC (run scripts/edit-starters.mjs on the host first)"
mkdir -p apps/desktop/resources/starters
cp "$STARTERS_SRC"/* apps/desktop/resources/starters/

# ---------- 2. dependencies (Linux host copies; darwin natives are swapped in below) ----------
log "pnpm install"
pnpm install --frozen-lockfile --reporter=append-only >/tmp/pnpm-install.log 2>&1 || { tail -40 /tmp/pnpm-install.log; die "pnpm install failed"; }

# ---------- 3. renderer, host bundle, migrations, brand ----------
log "renderer build + stage"
pnpm --filter @agentforge/web build >/tmp/web-build.log 2>&1 || { tail -40 /tmp/web-build.log; die "web build failed"; }
node apps/desktop/scripts/stage-renderer.mjs
node apps/desktop/scripts/pack-brand.mjs --restore-public

# ---------- 4. darwin native modules ----------
SQLITE_DIR="$(realpath apps/desktop/node_modules/better-sqlite3)"
KEYTAR_DIR="$(realpath apps/desktop/node_modules/keytar)"
# better-sqlite3 13 ships N-API prebuilds for every platform in the tarball; its loader prefers
# prebuilds/<platform>-<arch>.node and only falls back to build/. Remove build/ so a Linux compile can
# never be picked up, and keep a pristine copy of prebuilds/ so each arch build ships only its own.
rm -rf "$SQLITE_DIR/build"
PREBUILDS_KEEP=/tmp/better-sqlite3-prebuilds
rm -rf "$PREBUILDS_KEEP" && cp -r "$SQLITE_DIR/prebuilds" "$PREBUILDS_KEEP"
# @firecrawl/anydoc (the local document reader) is a napi-rs module: the Linux install fetched the
# linux-* platform packages next to it, and asarUnpack would ship those ELF files into a Mac app (the
# 0.14.27 first-pack failure: "2 non-Mach-O native binaries"). Fetch the darwin package per arch from
# the npm registry, check its sha512 against packages/host/src/components/manifest.ts (same strings),
# and swap it in where pnpm keeps anydoc's siblings so electron-builder collects it as an optional dep.
ANYDOC_DIR="$(realpath apps/desktop/node_modules/@firecrawl/anydoc)"
ANYDOC_SIBLINGS="$(dirname "$ANYDOC_DIR")"
ANYDOC_VERSION="$(node -p "require('$ANYDOC_DIR/package.json').version")"
grep -q "ANYDOC_VERSION = \"$ANYDOC_VERSION\"" "$SRC/packages/host/src/components/manifest.ts"   || die "anydoc $ANYDOC_VERSION in node_modules is not the version pinned in components/manifest.ts"
anydoc_integrity() {
  case "$1" in
    arm64) echo "1Eg0rPGVMN052E7Y2+zswANS0KLaWhXvYb9CPgO8HEtclzu3hKAIJ00lIu5PF+DXafZ10ZS4fmrcP+9Ifct9qw==" ;;
    x64) echo "fTM8y6COu+jBqWRJ0Je0OqaDDt7YxJ8LU4ISoypO5eOBNXI3+l6tK1ZRwUclYWXGBr/6JaUWEgdyJVFfd/fpJg==" ;;
    *) die "no anydoc darwin integrity pinned for $1" ;;
  esac
}
for arch in $ARCHES; do
  tgz="/cache/anydoc/anydoc-darwin-$arch-$ANYDOC_VERSION.tgz"
  if [ ! -f "$tgz" ]; then
    log "downloading anydoc darwin-$arch $ANYDOC_VERSION"
    curl -fsSL -o "$tgz" "https://registry.npmjs.org/@firecrawl/anydoc-darwin-$arch/-/anydoc-darwin-$arch-$ANYDOC_VERSION.tgz"
  fi
  actual="$(openssl dgst -sha512 -binary "$tgz" | base64 -w0)"
  [ "$actual" = "$(anydoc_integrity "$arch")" ] || { rm -f "$tgz"; die "anydoc darwin-$arch tarball sha512 mismatch"; }
done
for arch in $ARCHES; do
  [ -f "$PREBUILDS_KEEP/darwin-$arch.node" ] || die "better-sqlite3 has no prebuilds/darwin-$arch.node"
  tgz="/cache/keytar/keytar-v${KEYTAR_VERSION}-napi-v3-darwin-$arch.tar.gz"
  if [ ! -f "$tgz" ]; then
    log "downloading keytar darwin-$arch prebuild"
    curl -fsSL -o "$tgz" "https://github.com/atom/node-keytar/releases/download/v${KEYTAR_VERSION}/keytar-v${KEYTAR_VERSION}-napi-v3-darwin-$arch.tar.gz"
  fi
done

# ---------- 5. per-arch: pack, sign, zip, dmg, verify ----------
cd apps/desktop
rm -rf dist/mac dist/mac-arm64 dist/mac-x64
rm -f dist/DPSBuddy-"$VERSION"-mac-*.dmg dist/DPSBuddy-"$VERSION"-mac-*.zip

for arch in $ARCHES; do
  log "==== $arch ===="
  rm -rf "$KEYTAR_DIR/build"
  tar -xzf "/cache/keytar/keytar-v${KEYTAR_VERSION}-napi-v3-darwin-$arch.tar.gz" -C "$KEYTAR_DIR"
  [ -f "$KEYTAR_DIR/build/Release/keytar.node" ] || die "keytar darwin-$arch prebuild did not unpack"
  file "$KEYTAR_DIR/build/Release/keytar.node" | grep -q "Mach-O" || die "keytar.node for $arch is not Mach-O"
  rm -rf "$SQLITE_DIR/prebuilds" && mkdir -p "$SQLITE_DIR/prebuilds"
  cp "$PREBUILDS_KEEP/darwin-$arch.node" "$SQLITE_DIR/prebuilds/"
  # Only this arch's darwin anydoc package may sit beside anydoc; every other platform package goes.
  find "$ANYDOC_SIBLINGS" -maxdepth 1 -name 'anydoc-*' -exec rm -rf {} +
  mkdir -p "$ANYDOC_SIBLINGS/anydoc-darwin-$arch"
  tar -xzf "/cache/anydoc/anydoc-darwin-$arch-$ANYDOC_VERSION.tgz" --strip-components=1 -C "$ANYDOC_SIBLINGS/anydoc-darwin-$arch"
  anydoc_node="$(find "$ANYDOC_SIBLINGS/anydoc-darwin-$arch" -maxdepth 1 -name '*.node' | head -n1)"
  [ -n "$anydoc_node" ] || die "anydoc darwin-$arch tarball has no .node"
  file "$anydoc_node" | grep -q "Mach-O" || die "anydoc .node for $arch is not Mach-O"

  log "electron-builder --mac --dir --$arch"
  npx electron-builder --mac --dir "--$arch" -c.npmRebuild=false -c.mac.identity=null --publish never \
    >"/tmp/electron-builder-$arch.log" 2>&1 || { tail -60 "/tmp/electron-builder-$arch.log"; die "electron-builder failed for $arch"; }
  grep -iE "warn|error" "/tmp/electron-builder-$arch.log" | grep -v "skipped macOS" | head -20 || true

  APP="$(find dist -maxdepth 2 -name DPSBuddy.app -type d | head -1)"
  [ -n "$APP" ] || die "no DPSBuddy.app produced for $arch"
  log "app at $APP"

  log "ad-hoc signing with rcodesign"
  rcodesign sign "$APP" >"/tmp/rcodesign-$arch.log" 2>&1 || { tail -40 "/tmp/rcodesign-$arch.log"; die "rcodesign failed for $arch"; }

  log "verifying bundle"
  python3 "$DOCKER_DIR/verify-bundle.py" --app "$APP" --arch "$arch" --version "$VERSION"

  ZIP="dist/DPSBuddy-$VERSION-mac-$arch.zip"
  DMG="dist/DPSBuddy-$VERSION-mac-$arch.dmg"
  log "zip -> $ZIP"
  (cd "$(dirname "$APP")" && zip -q -r -y -X "../$(basename "$ZIP")" DPSBuddy.app)

  log "dmg -> $DMG"
  python3 "$DOCKER_DIR/make-dmg.py" --app "$APP" --out "$DMG" --volume "DPSBuddy $VERSION"

  log "verifying dmg + zip round trip"
  python3 "$DOCKER_DIR/verify-bundle.py" --app "$APP" --arch "$arch" --version "$VERSION" --dmg "$DMG" --zip "$ZIP"

  # The unpacked app dir is arch-specific and electron-builder would reuse it; clear before the next arch.
  rm -rf "$(dirname "$APP")"
done

# ---------- 6. hand over ----------
log "copying artifacts to /out"
for f in dist/DPSBuddy-"$VERSION"-mac-*.dmg dist/DPSBuddy-"$VERSION"-mac-*.zip; do
  cp "$f" "$OUT/"
done
(cd "$OUT" && sha256sum DPSBuddy-"$VERSION"-mac-*.dmg DPSBuddy-"$VERSION"-mac-*.zip | tee "mac-$VERSION.sha256")
log "done: $(ls "$OUT" | grep -c "DPSBuddy-$VERSION-mac-") artifacts for $HEAD_SHA"
