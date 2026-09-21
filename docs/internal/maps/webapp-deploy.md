# Map — webapp-deploy: the hosted deployment stack

Last verified: 2026-09-21 at 2d44f0f + the Phase 7 branch `claude/web-phase7-component-installer-7f5d5l`

## Overview

`webapp-deploy/` is how the repo becomes a running server: a Dockerfile that builds `apps/web` and its
workspace dependencies into one image, a two-service compose stack, a Caddy reverse proxy that
terminates TLS, and five shell scripts for build / deploy / backup / restore / logs. The target host
is a Tencent Cloud CVM in Jakarta.

It is **additive**. Nothing in `apps/`, `packages/`, the root `package.json`, `pnpm-workspace.yaml` or
`turbo.json` is touched by it, which is what keeps the frozen Electron desktop (0.14.27) and the
mobile app building unchanged (`webapp-deploy/README.md:8-10`).

It is not a deployment *guide* and not the product's security model. The step-by-step runbook for a
fresh CVM is [`../tencent-cvm-setup.md`](../tencent-cvm-setup.md); the server-mode rules the app
itself enforces are [`hosted-server-mode.md`](hosted-server-mode.md). This page is the map of the
folder: what each file does, what depends on what, and the things about it that surprise people.

## How it works

### Build: one image, the whole workspace

`webapp-deploy/Dockerfile` is three stages over `node:22-bookworm-slim`, and the **build context is
the repo root**, not this folder (`Dockerfile:5-6`).

1. **`base`** (`Dockerfile:24-38`) enables corepack and pins pnpm `9.15.9`, matching the root
   `packageManager` field. It then `chmod a+x`es every `.py` under the corepack home — without that,
   `better-sqlite3`'s regenerated Makefile re-runs `gyp_main.py` directly and dies with `EACCES`
   (`Dockerfile:33-38`).
2. **`build`** (`Dockerfile:47-83`) installs `python3`, `make` and `g++` for `better-sqlite3`'s node-gyp
   fallback, then runs `pnpm install --frozen-lockfile --filter "@agentforge/web..."` (`:59`) — the web
   app and its workspace dependencies only, so `apps/desktop` and `apps/mobile` are never installed —
   and `pnpm --filter @agentforge/web build` (`:62`), which is `vite build` into `apps/web/dist`. It
   ends by proving the image carries its components (`:82-83`); see *Components are the image's* below.
3. **`runtime`** (`Dockerfile:88-141`) copies the built workspace wholesale (`:102`), creates and chowns
   `/data` and declares it a volume (`:104-105`), does the same for the components root
   (`:118-119`), drops to the non-root `node` user (`:121`), and starts `tsx server.ts` (`:141`).

Debian rather than Alpine is deliberate: `pnpm-lock.yaml` resolves `@firecrawl/anydoc` to the
`-linux-x64-gnu` / `-linux-arm64-gnu` packages, and musl would pick different ones and force a
`better-sqlite3` rebuild (`Dockerfile:15-17`).

The container's own `HEALTHCHECK` (`Dockerfile:138-139`) calls `GET /api/v1/components` on loopback with
`node -e fetch` — there is no curl in the image. Two rules have to be satisfied at once, and the probe
fails outright if either is missed:

- The route is ungated on purpose. It is one of the two `UNGATED_GETS`
  (`packages/host/src/auth/routes.ts:45`; the reason is at
  `packages/host/src/handlers/components.ts:4-8`), so it answers before any gateway key exists and
  without opening the database.
- **The probe sends `x-forwarded-proto: https`** (`Dockerfile:139`). In server mode `rejectPlaintext`
  (`packages/host/src/http-adapter.ts:315-318`) answers `403 https_required` to any request without
  that header, on every path, before routing reaches the ungated set
  (`transportRejection` is called at `:421`). A probe without it never goes healthy. The header is
  safe here only because the sender is inside the container, past the boundary the rule defends; see
  [hosted-server-mode.md](hosted-server-mode.md).

### Components are the image's, not a download

The app can install a native component at runtime — that is how a desk gets `@firecrawl/anydoc` on
first use. A server does not. The component directory and the binary in it are shared by every
tenant, so `handlers/components.ts` answers `403 install_disabled` to the install route whenever
`isServerMode()`, and the image is expected to carry what the server needs instead.

Two lines in this folder make that true rather than hoped for:

- The build stage runs `scripts/components.ts check` (`Dockerfile:82-83`), which loads every id in
  `packages/host/src/components/server.ts` `SERVER_COMPONENT_IDS` the way a request would and exits
  non-zero if one does not. A filter change or an unpublished platform package fails the build
  instead of shipping a container that boots healthy and silently reads every document with the
  reduced fallback extractor. It runs with `AGENTFORGE_SERVER=1` and the runtime stage's
  `AGENTFORGE_COMPONENTS_DIR` so its printout is the container's.
- The runtime stage puts that directory at `/opt/agentforge/components` (`Dockerfile:92-95`,
  `:116-119`) — **outside** `/data`, on its own volume (`compose.yml:64-68`). See the `noexec`
  gotcha below for why that separation is the point.

`components.sh install` is a **repair**, not an upgrade path: a newer version arrives in a newer
image. It exists for the box whose bundled copy stopped loading, and an install there needs an app
restart before the running process uses it — the loader memoises its answer, failure included
(`packages/host/src/file-extract/anydoc.ts:136-150`). Full picture:
[`component-installer.md`](component-installer.md).

### Run: two containers, one network namespace

`webapp-deploy/compose.yml` defines `app` and `proxy`.

`app` builds from the repo root, runs with `read_only: true` and a `/tmp` tmpfs (`compose.yml:60-62`),
`no-new-privileges` and `cap_drop: ALL` (`:88-91`), `init: true` to reap ffmpeg and SQL worker children
(`:94-95`), and `pids_limit` / `mem_limit` caps (`:96-98`). Two mounts are writable and no others:
`/data` for tenant work and `/opt/agentforge/components` for the operator's components
(`:64-68`). Logs are json-file, 10 MB × 5.

`proxy` is `caddy:2-alpine` with `network_mode: "service:app"` (`compose.yml:115-117`). It joins the app
container's network namespace rather than talking to it over a bridge, because the app binds
`127.0.0.1` inside the container. A service sharing another's namespace cannot publish ports of its
own, which is why `80`, `443` and `443/udp` are published on **`app`** (`compose.yml:109-112`). `proxy`
gets `NET_BIND_SERVICE` back — the only capability it needs — to bind those ports.

The app binds whatever `resolveBindHost` returns (`apps/web/server.ts:114-115`,
`apps/web/lib/bind-host.ts:17-27`), which defaults to loopback and throws on a non-loopback value
unless `AGENTFORGE_SERVER` is on. The stack does not set `BIND_HOST`, so the default holds.

### Front: Caddy

`webapp-deploy/Caddyfile` has two sites. `http://{$DPSBUDDY_DOMAIN}` does nothing but a permanent
redirect to HTTPS (`Caddyfile:21-23`). The HTTPS site sets TLS 1.2 as the floor (`:28-30`), compresses
(`:32`), and sends the security header block — CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, the COOP/CORP pair and a fully-off `Permissions-Policy` (`:46-59`) — while stripping
`Server` and `X-Powered-By` (`:65-66`). The access log is JSON on stdout with `Cookie`,
`Authorization` and `Set-Cookie` deleted before the line is written (`:72-83`).

`reverse_proxy 127.0.0.1:3000` (`Caddyfile:114`) carries one directive, `flush_interval -1` (`:135`),
which stops Caddy buffering the SSE job stream.

Two commented lines under *Incident response* (`Caddyfile:87-88`) take the site read-only on a proxy
restart.

### Operate: the six scripts

All of them source `scripts/_common.sh`, which resolves the folder and repo root, defines `dc()` as
`docker compose -f compose.yml` with a legacy fallback, and reads `.env` values with `sed` rather than
by sourcing the file — a stray backtick in a value would otherwise execute.

| Script | What it does |
|---|---|
| `build.sh` | `dc build app`, then prints the image size |
| `deploy.sh` | With `USE_SSM=1`, reads the wrap key and `BACKUP_KEY` from Secrets Manager with the instance role and exports them for that process only; `git pull --ff-only`; build; `up -d`; polls the container health for up to five minutes; appends a row to `DEPLOY-LOG.md` |
| `backup.sh` | Consistent SQLite snapshot via `VACUUM INTO`; tar of `/data` minus `components/`, `logs/` and `.master-key`; `openssl enc -aes-256-cbc -pbkdf2 -iter 200000` before the bytes leave the host; decrypt-and-list verification; upload with `coscli`, else `tccli cos`, else a loud warning; local retention prune |
| `restore.sh` | Checks the archive decrypts **before** deleting anything; stops both services; empties `/data`; unpacks; promotes the consistent snapshot over `agentforge.sqlite` and drops the stale `-wal`/`-shm`; starts back up |
| `logs.sh` | Prints container health, then follows logs for one or both services |
| `components.sh` | Phase 7. `status` / `check` / `install` against the running container, through `dc exec -T app ./node_modules/.bin/tsx ../../scripts/components.ts` (`webapp-deploy/scripts/components.sh:54-55`). Nothing here reaches the install HTTP route, which answers `403 install_disabled` on a server for every caller |

Failure modes worth knowing: `deploy.sh` exits non-zero and dumps 80 log lines if health does not go
green in five minutes; `backup.sh` refuses to run at all with an empty `BACKUP_KEY` rather than writing
a plaintext archive; `restore.sh` is destructive and prompts unless given `--yes`.

## Where things live

| File | Role |
|---|---|
| `webapp-deploy/README.md` | The folder's own reference: image contents, the proxy arrangement, transport filtering, the security group, the before-traffic acceptance list, the incident runbook, the restore drill, and *What is not done yet* |
| `webapp-deploy/Dockerfile` | The three-stage image. Build context is the repo root |
| `webapp-deploy/.dockerignore` | Context excludes |
| `webapp-deploy/Dockerfile.dockerignore` | A byte-identical copy — the name BuildKit actually reads, because the Dockerfile is not at the context root. **Edit both together** |
| `webapp-deploy/compose.yml` | `app` + `proxy`, hardening, limits, published ports, named volumes |
| `webapp-deploy/Caddyfile` | TLS, the security header block, the JSON access log, `reverse_proxy` |
| `webapp-deploy/.env.example` | Every env var the host reads, one line of meaning each |
| `webapp-deploy/DEPLOY-LOG.md` | date / sha / env / who / notes. Mirrors the log in `../web-pivot-2026-09-18.md`, which is the one of record |
| `webapp-deploy/scripts/_common.sh` | Shared helpers. Sourced, not run |
| `webapp-deploy/scripts/{build,deploy,backup,restore,logs,components}.sh` | As above |
| `../tencent-cvm-setup.md` | The step-by-step runbook for a fresh CVM |
| `../web-data-placement-tencent.md` | Which Tencent service holds which data; sizing; the price tables |
| `../web-security-spec.md` | The numbered rows (`N2`, `S2`, `H2`…) this folder keeps citing |

## Gotchas

- **Two ignore files, byte-identical.** BuildKit looks for `<dockerfile-path>.dockerignore` before
  `<context>/.dockerignore`. The Dockerfile lives in `webapp-deploy/` and the context is the repo root,
  so the file Docker actually reads is `webapp-deploy/Dockerfile.dockerignore`. Editing only
  `.dockerignore` silently does nothing, and the context goes from small to about 1.4 GB
  (`webapp-deploy/README.md:46-52`).
- **Dev dependencies ship on purpose.** `tsx` is a devDependency of `@agentforge/web` and **is** the
  production entrypoint, and every `@agentforge/*` package exports TypeScript source rather than a
  build. `pnpm prune --prod` would delete the thing that boots the app (`Dockerfile:99-102`).
- **The proxy must not rewrite `Host` or `Origin`.** With `AGENTFORGE_SERVER=1` a mutating `/api` call
  needs both to match `AGENTFORGE_TRUSTED_ORIGINS`. Caddy passes them through by default, which is why
  the `Caddyfile` deliberately has no `header_up Host` line — the loopback-rewriting config an older
  deployment would have used now turns every write into `403 origin_forbidden`
  (`Caddyfile:115-131`).
- **`X-Forwarded-For` is read last-hop-first.** The per-IP rate bucket keys on the **last** entry,
  because a client can send its own header and an appending proxy leaves the forged value first. That
  holds only while this Caddy is the only thing in front of the app. Putting a CDN or load balancer
  ahead of it means declaring its ranges in `trusted_proxies` **and** revisiting the last-hop rule
  (`Caddyfile:91-113`).
- **Rate limiting is not in this folder.** The official `caddy:2-alpine` image ships no rate-limit
  module, so the buckets live in the app (`packages/host/src/rate-limit.ts`). See
  [`hosted-server-mode.md`](hosted-server-mode.md).
- **`noexec` on `/data` is correct since Phase 7, and was not before it.** The app used to install
  native modules into `/data/components` and load them from there. It now refuses to load one out of
  `AGENTFORGE_DATA_DIR` in server mode at all (`packages/host/src/components/paths.ts:101-103`,
  `downloadedComponentsAllowed`), and what it does load lives on the separate
  `/opt/agentforge/components` volume, which must stay executable. The code side of spec `H3` is
  therefore closed; the mount flag itself is still an operator action on the CVM
  (`compose.yml:77-86`, `../tencent-cvm-setup.md` §4).
- **The build runs on the production server.** There is no image registry and no CI build, so
  `deploy.sh` builds in place — and the build stage's `apt-get` goes to `deb.debian.org` over plain
  HTTP, which collides with the outbound-443-only security group rule
  (`webapp-deploy/README.md`, *Security group rules*).
- **Rolling code back is a rebuild at an older sha**, for the same reason. There is no
  `docker pull <old-tag>` path.
- **`caddy-data` is not the app's `/data`.** The proxy's `/data` volume holds the ACME account and the
  issued certificates; they are different volumes in different containers (`compose.yml:123-126`).
- **`restore.sh` hands three capabilities back.** `cap_drop: ALL` takes `CHOWN` away even from root,
  and both `tar -x` and the chown need it, so the one-shot restore container re-adds `CHOWN`,
  `FOWNER` and `DAC_OVERRIDE`.
- **ffmpeg and ffprobe are not in the image.** The Edit desk degrades without them. Adding them is a
  migration-plan decision, not a silent `apt-get`.

## Verify

Nothing under `.cursor/skills/verify-agentforge/features/` drives this folder: the verify skill's
surfaces are webdev `:3000` and the packaged desktop, and there is no hosted-environment surface in it
yet (`.cursor/skills/verify-agentforge/SKILL.md`, *Surfaces*). This folder is proved by deploying it
and walking the first-run checks in [`../tencent-cvm-setup.md`](../tencent-cvm-setup.md) §9, and then
by the before-traffic acceptance list in `webapp-deploy/README.md`, signed in `DEPLOY-LOG.md` with the
sha that passed.

The closest feature file for the app's own side of the hosted rules is
`.cursor/skills/verify-agentforge/features/security.md`.

## Why

- **The proxy shares the app's network namespace rather than using a bridge.** *Claim:* it was the
  only way to front the app without editing `server.ts`, and it is kept now for tested-ness rather
  than necessity. *Source:* the folder is documented as additive and as not editing `apps/`
  (`webapp-deploy/README.md:8-10`); `BIND_HOST` landed later, in Phase 1
  (`../web-migration-plan.md`, Phase 1), and `apps/web/lib/bind-host.ts:17-27` now allows a
  non-loopback bind in server mode. *Confidence:* `[Supported]` — the original constraint is documented
  and the current capability is in the code; that the arrangement is *kept* for test coverage rather
  than changed is the reading this page takes, not a recorded decision.
- **SQLite on one server, backed up hourly, rather than a managed database.** *Claim:* it is what the
  code runs today and it meets a 1-hour RPO with no new code; Postgres waits for tenancy.
  *Source:* [`../web-data-placement-tencent.md`](../web-data-placement-tencent.md) §3, *Why SQLite
  first*, plus the explicit throw on a `postgres://` URL at `packages/db/src/vault-key.ts:25`.
  *Confidence:* `[Direct]`.
- **Backups are encrypted on the host before upload.** *Claim:* a leaked COS bucket must not be a
  leaked database. *Source:* security spec row `S6`, cited in `webapp-deploy/scripts/backup.sh`'s own
  header and in `webapp-deploy/README.md`, *Back up*. *Confidence:* `[Direct]`.
