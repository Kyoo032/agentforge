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

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

# Data dir lives on a volume. packages/db/src/vault-key.ts reads AGENTFORGE_DATA_DIR
# and puts agentforge.sqlite, settings.enc, media, logs and components under it.
ENV NODE_ENV=production \
    PORT=3000 \
    AGENTFORGE_DATA_DIR=/data

WORKDIR /app

# Copy the built workspace wholesale. node_modules is kept (dev deps included) because
# tsx is a devDependency of @agentforge/web and IS the production entrypoint;
# `pnpm prune --prod` would delete it. Trimming that is a migration-plan item.
COPY --from=build --chown=node:node /app /app

RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

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
