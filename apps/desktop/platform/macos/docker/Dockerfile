# Build environment for the macOS artifacts when no Mac is available.
#
# electron-builder refuses the mac target on a Windows host but allows it on Linux, so this
# image is where the .app is assembled. Apple's hdiutil and codesign are not available here;
# their jobs are done by:
#   - libdmg-hfsplus  (hfsplus: populate an HFS+ image; dmg: wrap it as a zlib-compressed UDIF)
#   - rcodesign       (ad-hoc code signing of the whole bundle; Apple silicon refuses unsigned
#                      or tampered binaries, and electron-builder rewrites Info.plist after
#                      Electron's own ad-hoc signature was made)
#   - hfsprogs        (mkfs.hfsplus creates the empty HFS+ volume)
#   - p7zip           (reads the finished dmg back for verification)
# Driven by apps/desktop/scripts/mac-build-docker.mjs; entry point is build-mac.sh next to
# this file, mounted read-only from the checkout at /src.

FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive
# hfsprogs is in Debian's non-free component (Apple Public Source License).
RUN sed -i 's/^Components: main$/Components: main non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      hfsprogs p7zip-full zip unzip cmake build-essential zlib1g-dev libbz2-dev \
      python3 file git ca-certificates curl xz-utils rsync \
 && rm -rf /var/lib/apt/lists/*

# libdmg-hfsplus, pinned to the last upstream commit (2022-05-19). Built without its FileVault
# (encrypted dmg) code: that part predates OpenSSL 3 and is not needed for a plain UDZO image.
# The CMake guard is flipped off because the project includes FindOpenSSL directly.
ARG LIBDMG_REF=7ac55ec64c96f7800d9818ce64c79670e7f02b67
RUN git clone https://github.com/planetbeing/libdmg-hfsplus.git /tmp/libdmg \
 && cd /tmp/libdmg && git checkout --quiet ${LIBDMG_REF} \
 && sed -i 's/^IF(OPENSSL_FOUND)/IF(FALSE)/' dmg/CMakeLists.txt \
 && mkdir build && cd build \
 && cmake .. -DCMAKE_BUILD_TYPE=Release >/dev/null \
 && make -j"$(nproc)" >/dev/null \
 && install -m 755 hfs/hfsplus dmg/dmg /usr/local/bin/ \
 && rm -rf /tmp/libdmg \
 && hfsplus 2>&1 | head -1 && dmg 2>&1 | head -1

# rcodesign from the apple-codesign project (pure Rust, runs on Linux).
ARG RCODESIGN_VERSION=0.29.0
RUN curl -fsSL "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F${RCODESIGN_VERSION}/apple-codesign-${RCODESIGN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      -o /tmp/rcodesign.tar.gz \
 && tar -xzf /tmp/rcodesign.tar.gz -C /tmp \
 && install -m 755 /tmp/apple-codesign-*/rcodesign /usr/local/bin/rcodesign \
 && rm -rf /tmp/rcodesign.tar.gz /tmp/apple-codesign-* \
 && rcodesign --version

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && pnpm --version

# Caches live in named volumes mounted by the wrapper so repeat builds skip downloads.
ENV ELECTRON_CACHE=/cache/electron \
    ELECTRON_BUILDER_CACHE=/cache/electron-builder \
    CSC_IDENTITY_AUTO_DISCOVERY=false \
    CI=1

WORKDIR /work
ENTRYPOINT ["bash", "/src/apps/desktop/platform/macos/docker/build-mac.sh"]
