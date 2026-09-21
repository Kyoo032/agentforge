# syntax=docker/dockerfile:1.7
#
# DPSBuddy hosted web app.
#
# Build context is the REPO ROOT, not this folder:
#   docker build -f webapp-deploy/Dockerfile -t dpsbuddy-web:local .
#
# Why the whole workspace ships in the image: every @agentforge/* package exports
# TypeScript source (packages/host/package.json "exports" -> ./src/index.ts), and
# apps/web/package.json "start" is `NODE_ENV=production tsx server.ts`. So the runtime
# needs the source tree, node_modules, and tsx. Only the renderer is compiled
# (`pnpm --filter @agentforge/web build` -> apps/web/dist).
#
# Debian (glibc) on purpose: @firecrawl/anydoc resolves to
# @firecrawl/anydoc-linux-x64-gnu / -linux-arm64-gnu in pnpm-lock.yaml. Alpine/musl
# would pick a different package and better-sqlite3 would need a full musl rebuild.

ARG NODE_VERSION=22-bookworm-slim
ARG PNPM_VERSION=9.15.9

# ---------------------------------------------------------------------------
# base: node + pnpm, shared by build and runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_HOME=/opt/corepack \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate \
 && chmod -R a+rX /opt/corepack \
 # pnpm bundles node-gyp, and corepack unpacks its cache with .py files at 0644.
 # better-sqlite3's generated Makefile re-runs `gyp_main.py` DIRECTLY (the "Regenerating
 # Makefile" action fires because COPY leaves mtimes slightly in the future), and a
 # non-executable script is EACCES even for root:
 #   /bin/sh: 1: .../node-gyp/gyp/gyp_main.py: Permission denied  ->  make Error 126
 && find /opt/corepack -name '*.py' -exec chmod a+x {} +

# ---------------------------------------------------------------------------
# deps + build
#
# python3/make/g++ are here for better-sqlite3: it tries a prebuilt binary first
# (prebuild-install) and falls back to node-gyp. Without them the fallback fails
# hard and the whole install dies.
# ---------------------------------------------------------------------------
FROM base AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# Filtered install: @agentforge/web plus its workspace dependencies only.
# The trailing "..." is pnpm's "and its dependencies" selector. This deliberately
# skips apps/desktop (Electron, electron-builder, keytar) and apps/mobile, which
# the hosted deployment never runs.
RUN pnpm install --frozen-lockfile --filter "@agentforge/web..."

# Renderer -> apps/web/dist, which server.ts serves statically when NODE_ENV=production.
RUN pnpm --filter @agentforge/web build

# PHASE 7 - the image must CARRY every component this server needs, not download one on first
# request. `anydoc` arrives through the install above (it is a dependency of @agentforge/host and
# pnpm-lock.yaml resolves the -linux-*-gnu prebuilt), which is easy to break without noticing: a
# filter change, a hoisting change, or a platform package that stops publishing would all leave a
# container that boots, answers healthy, and silently reads every document with the reduced
# fallback extractor instead.
#
# So prove it here. The check loads each component in
# packages/host/src/components/server.ts SERVER_COMPONENT_IDS the same way a request would -
# createRequire on the real native binding - and exits non-zero if one does not load, which fails
# the build. This runs in the build stage, on the same linux/glibc base the runtime stage uses, so
# a binding that loads here loads there.
#
# The two variables are the runtime stage's, set here so the check runs under the rules the
# container will run under and PRINTS what the container will print - `mode: server`, and
# /opt/agentforge/components as the components root - instead of reporting itself as a desk. They
# change nothing about what loads: the bundled copy inside node_modules is what resolves either
# way, and `check` never downloads.
RUN AGENTFORGE_SERVER=1 AGENTFORGE_COMPONENTS_DIR=/opt/agentforge/components \
    apps/web/node_modules/.bin/tsx scripts/components.ts check

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

# Data dir lives on a volume. packages/db/src/vault-key.ts reads AGENTFORGE_DATA_DIR
# and puts agentforge.sqlite, settings.enc, media and logs under it. Components do NOT go there on
# a server - see AGENTFORGE_COMPONENTS_DIR below and the VOLUME further down.
ENV NODE_ENV=production \
    PORT=3000 \
    AGENTFORGE_DATA_DIR=/data \
    AGENTFORGE_COMPONENTS_DIR=/opt/agentforge/components

WORKDIR /app

# Copy the built workspace wholesale. node_modules is kept (dev deps included) because
# tsx is a devDependency of @agentforge/web and IS the production entrypoint;
# `pnpm prune --prod` would delete it. Trimming that is a migration-plan item.
COPY --from=build --chown=node:node /app /app

RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

# PHASE 7 - components live OUTSIDE the tenant data volume.
#
# /data is what every tenant writes into, and the host refuses to createRequire a native module out
# of it in server mode (packages/host/src/components/paths.ts, downloadedComponentsAllowed). That
# refusal is what makes /data mountable `noexec` (docs/internal/web-security-spec.md H3). The
# directory below is the operator's instead, and it stays EMPTY on a healthy box: the image's own
# copy of anydoc is what loads, and a newer version arrives in a newer image, never through a
# download into a running container. It is written only when
# `webapp-deploy/scripts/components.sh install` repairs a box whose bundled copy stopped loading.
# compose.yml gives it its own volume so such a repair survives a restart.
RUN mkdir -p /opt/agentforge/components && chown -R node:node /opt/agentforge
VOLUME ["/opt/agentforge/components"]

USER node
WORKDIR /app/apps/web
EXPOSE 3000

# Same command as apps/web/package.json "start", minus the pnpm wrapper:
#   NODE_ENV=production tsx server.ts
# NOTE: server.ts:114-115 binds resolveBindHost(process.env) (apps/web/lib/bind-host.ts),
# which defaults to 127.0.0.1. BIND_HOST is not set here, so the container only answers on
# its own loopback. See webapp-deploy/README.md - the proxy joins this container's network
# namespace instead of talking to it over a bridge.
# The `x-forwarded-proto: https` header is REQUIRED, not decoration. In server mode
# `rejectPlaintext` (packages/host/src/http-adapter.ts:314-317, called at :421) answers 403 https_required to every
# request that does not carry it, for every path, and it runs before routing. A probe without it
# fails 100% of the time and the container never reports healthy. Sending it here is safe: this
# process is inside the container, so it is past the boundary that control exists to defend.
# `/api/v1/components` is one of the two ungated GETs (packages/host/src/auth/routes.ts:45), so it
# answers before anyone has signed in.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD node -e "const p=process.env.PORT||3000;fetch('http://127.0.0.1:'+p+'/api/v1/components',{headers:{'x-forwarded-proto':'https'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/tsx", "server.ts"]
