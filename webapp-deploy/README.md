# WebApp deploy

> Target host: **Tencent Cloud CVM, Jakarta**. Storage placement: [`docs/internal/web-data-placement-tencent.md`](../docs/internal/web-data-placement-tencent.md). Security requirements and the before-traffic acceptance list: [`docs/internal/web-security-spec.md`](../docs/internal/web-security-spec.md).

The full structure for running DPSBuddy as a hosted web app on Kyo's server: image,
compose stack, reverse proxy, env template, and the scripts for build / deploy / backup
/ restore / logs.

This folder is **additive**. Nothing in `apps/`, `packages/`, the root `package.json`,
`pnpm-workspace.yaml` or `turbo.json` is touched, so the Electron desktop app (frozen at
0.14.27) and the mobile app keep building exactly as they did.

The decision behind it is [`docs/internal/web-pivot-2026-09-18.md`](../docs/internal/web-pivot-2026-09-18.md).
The step-by-step path from here to a safe public deployment is
[`docs/internal/web-migration-plan.md`](../docs/internal/web-migration-plan.md).

> **Not production-ready yet.** Read [Before-traffic acceptance](#before-traffic-acceptance)
> and [What is not done](#what-is-not-done-yet) before pointing a domain at this. There is no auth, no tenancy, and mutating `/api` calls are
> rejected behind a proxy today. Treat this as the deployment skeleton the migration
> plan fills in.

## Layout

```
webapp-deploy/
├─ README.md                  this file
├─ Dockerfile                 multi-stage image (build context is the REPO ROOT)
├─ .dockerignore              context excludes
├─ Dockerfile.dockerignore    identical copy - the name BuildKit actually reads (see below)
├─ compose.yml                app + proxy, read-only root, caps dropped, limits
├─ Caddyfile                  TLS, CSP + security headers, JSON access log, reverse_proxy
├─ .env.example               every env var the host reads, with one line each
├─ DEPLOY-LOG.md              date | sha | env | who | notes
└─ scripts/
   ├─ _common.sh              shared helpers (sourced, not run)
   ├─ build.sh                build the image, print its size
   ├─ deploy.sh               secrets from SSM, build, up -d, health, log the sha
   ├─ backup.sh               SQLite snapshot + encrypted tar of /data -> COS
   ├─ restore.sh              decrypt and restore an archive into the volume
   └─ logs.sh                 health + follow logs
```

### Why two ignore files

BuildKit looks for `<dockerfile-path>.dockerignore` before it falls back to
`<context>/.dockerignore`. The Dockerfile lives here but the build context is the repo
root, so the file Docker actually reads is `webapp-deploy/Dockerfile.dockerignore`.
`.dockerignore` is kept under the name people expect. **They are byte-identical — edit
both together.** Without them the context is ~1.4 GB (`node_modules` plus `.git`).

## What the image contains

- `node:22-bookworm-slim`. The repo only says `"engines": { "node": ">=20" }` and has no
  `.nvmrc`; 22 is the current LTS and satisfies it. Debian, not Alpine, because
  `pnpm-lock.yaml` resolves `@firecrawl/anydoc` to the `-linux-x64-gnu` / `-linux-arm64-gnu`
  packages — musl would pick different ones and force a `better-sqlite3` rebuild.
- pnpm `9.15.9` via corepack, matching the root `packageManager` field.
- `pnpm install --frozen-lockfile --filter "@agentforge/web..."` — the web app and its
  workspace dependencies only. `apps/desktop` (Electron, electron-builder, keytar) and
  `apps/mobile` are never installed.
- `pnpm --filter @agentforge/web build` → `vite build` → `apps/web/dist`, which
  `server.ts` serves statically when `NODE_ENV=production`.
- **The whole workspace source ships.** Every `@agentforge/*` package exports TypeScript
  directly (`packages/host/package.json` → `./src/index.ts`), and `apps/web`'s `start`
  script is `NODE_ENV=production tsx server.ts`. Dev dependencies stay in the image
  because `tsx` is one of them and it is the production entrypoint — `pnpm prune --prod`
  would delete the thing that boots the app. Shrinking this (a compiled bundle, or
  moving `tsx` to a dependency) is a migration-plan item, not something this folder
  changes.
- Runs as the non-root `node` user. `/data` is owned by `node` and declared a volume.
- `HEALTHCHECK` hits `GET /api/v1/components` on `127.0.0.1:$PORT` with `node -e fetch`
  (no curl in the image), **sending `x-forwarded-proto: https`**. Both parts matter.
  The route is deliberately ungated — `packages/host/src/router.ts:219-221` has the
  comment explaining why — so it answers before any gateway key exists, and
  `GET /api/v1/workspaces` would also work but opens the database on every probe.
  The header is what gets the probe past `rejectPlaintext`
  (`packages/host/src/http-adapter.ts:314-317`), which in server mode answers
  `403 https_required` to every request that arrives without it, on every path,
  before routing. Drop the header and the container never reports healthy and
  `deploy.sh` times out after five minutes with nothing in the log but 403s. Sending
  it from inside the container is safe: that caller is already past the boundary the
  rule defends, and the port is loopback-only.

### Native modules

- **better-sqlite3** (`packages/db`): `python3`, `make` and `g++` are installed in the
  build stage. It normally lands a prebuilt binary; without the toolchain the node-gyp
  fallback fails and the whole install dies. Nothing extra is needed at runtime.
- **anydoc** (`@firecrawl/anydoc`, the component installer's one component): it is a real
  dependency of `packages/host`, so pnpm installs the Linux package at build time and the
  **bundled** loader wins. The component installer therefore has nothing to download —
  `GET /api/v1/components` reports it as present. No extra step and no extra volume.
  If a future component is ever downloaded instead, it is written to
  `<AGENTFORGE_DATA_DIR>/components/`, which is on the `dpsbuddy-data` volume already.
  See [`docs/internal/maps/component-installer.md`](../docs/internal/maps/component-installer.md);
  who runs the installer on a shared server is open decision 6 in the decision record.
- **ffmpeg / ffprobe are not in the image.** The Edit desk degrades without them. Adding
  them is a migration-plan decision, not a silent `apt-get`.

## The loopback bind, and why the proxy shares a network namespace

`apps/web/server.ts:114-115` binds whatever `resolveBindHost` returns:

```ts
const host = resolveBindHost(process.env);
server.listen(port, host, () => {
```

`resolveBindHost` (`apps/web/lib/bind-host.ts:17-27`) defaults to `127.0.0.1` and **throws**
on a non-loopback `BIND_HOST` unless `AGENTFORGE_SERVER` is on, so a webdev run can never
go LAN-wide by accident. A container that listens on `127.0.0.1` cannot be reached from
another container over a Docker bridge network.

**Historical note.** Until Phase 1 landed (PR #56) the bind address really was hardcoded
and there was no env for it, which is the reason this stack was built the way it is. The
namespace-sharing arrangement below is kept because it is what has been tested and because
loopback-only means nothing on the host but Caddy can reach the app port — not because
there is no alternative any more. The proxy joins the app container's network namespace:

```yaml
proxy:
  image: caddy:2-alpine
  network_mode: "service:app"
```

Both containers then share one loopback interface, so Caddy's
`reverse_proxy 127.0.0.1:3000` reaches the host process. A service that shares another
service's namespace cannot publish ports of its own, which is why `80`, `443` and
`443/udp` are published on the **app** service in `compose.yml`.

Binding `0.0.0.0` inside the container and putting the two services on an ordinary bridge
network is now possible — set `BIND_HOST=0.0.0.0` with `AGENTFORGE_SERVER=1` — but it is
not what this stack ships or what has been driven. Changing it is a deliberate deployment
change, not a tidy-up.

**The proxy must pass `Host` through unchanged.** With `AGENTFORGE_SERVER=1` the app no
longer wants a loopback `Host`: a mutating `/api` call is accepted only when its `Origin`
*and* its `Host` both match `AGENTFORGE_TRUSTED_ORIGINS`, so the public hostname the
browser sent has to arrive exactly as sent. That is Caddy's default, which is why the
`Caddyfile` carries no `header_up Host` line - the earlier `header_up Host 127.0.0.1`
would now turn every `POST` / `PATCH` / `DELETE` into `403 origin_forbidden`, because
loopback is not on the allowlist. So set `AGENTFORGE_TRUSTED_ORIGINS` to this site's
public origin with its scheme (`https://$DPSBUDDY_DOMAIN`, comma-separated for more than
one name); an empty list in server mode accepts no write at all. `Origin` must never be
rewritten by the proxy - that is the CSRF hole the check exists to close.

## Build

```sh
# from the repo root
docker build -f webapp-deploy/Dockerfile -t dpsbuddy-web:local .

# or
sh webapp-deploy/scripts/build.sh
```

## Run

```sh
cd webapp-deploy
cp .env.example .env
# edit .env: DPSBUDDY_DOMAIN, AGENTFORGE_SECRETS_KEY
openssl rand -hex 32          # -> AGENTFORGE_SECRETS_KEY, generate once, keep forever

docker compose -f compose.yml up -d
```

On the CVM, do not put `AGENTFORGE_SECRETS_KEY` in `.env` at all. Set `USE_SSM=1` and
let [`scripts/deploy.sh`](scripts/deploy.sh) fetch it from Secrets Manager with the
instance role (spec S2); it is exported for that one command and never written to
disk. The `.env` file keeps the non-secret settings.

Caddy obtains and renews TLS automatically for `$DPSBUDDY_DOMAIN`, provided ports 80 and
443 reach the server from the internet and the DNS A/AAAA record already points at it.

**Never start this on `:3000` on a development machine.** `:3000` is the isolated webdev
instance; the container publishes only 80/443 on the host, and `PORT` is the port
*inside* the container.

## Update

```sh
sh webapp-deploy/scripts/deploy.sh
```

Pulls (`git pull --ff-only`), rebuilds, `up -d`, waits for the healthcheck, then prints a
ready-made row for `DEPLOY-LOG.md`. Append it there **and** to the deploy log in the
decision record. Use `--no-pull` to redeploy the checkout as it stands.

### Back up first when the deploy carries a migration

`ensureSchema` runs pending migrations when the app opens the database, so `up -d` is what
applies them. The runner is **forward-only**: it has no `down`, and SQLite before 3.35
cannot drop a column at all. Recovering from a bad migration means restoring the volume.

So on a deploy that carries a new `packages/db/drizzle/*.sql`, take a backup first and
check it landed:

```sh
export BACKUP_KEY=...                       # from Secrets Manager
sh webapp-deploy/scripts/backup.sh          # see "Back up" below
sh webapp-deploy/scripts/deploy.sh
```

`deploy.sh` does **not** do this for you. It is a deliberate gap: `backup.sh` needs a
running app container and a non-empty `BACKUP_KEY`, so calling it unconditionally would
fail the very first deploy to a fresh server. Whether to automate it behind a flag is
still open.

`0015_tenants` (Phase 3 tenancy) is the first migration this applies to: it adds the
`tenants` table and `organizations.tenant_id`, and is additive but one-way.

## Back up

```sh
export BACKUP_KEY=...                               # from Secrets Manager, never .env
sh webapp-deploy/scripts/backup.sh [output-dir]     # default webapp-deploy/backups
```

No downtime. In order it takes a consistent SQLite snapshot into `/data/.backup-staging/`,
tars `/data` **minus `components/`, `logs/` and `.master-key`**, encrypts the stream, and
uploads the result to the COS backup bucket.

- **Snapshot.** The image has no `sqlite3` binary, so the snapshot is `VACUUM INTO`
  through `better-sqlite3` - one committed transaction, compacted, with no `-wal`/`-shm`
  of its own. `backup.sh` checks for `sqlite3` first and uses `.backup` if a future image
  ever adds it; both do the same job.
- **Encryption (spec S6).** `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_KEY`,
  on this host, before the bytes leave it. A leaked bucket is then not a leaked database.
  The script refuses to run with an empty `BACKUP_KEY` rather than writing plaintext.
- **Verification.** Every run decrypts and lists the archive it just wrote. Set
  `BACKUP_VERIFY=0` to skip it on a very large volume.
- **Upload.** `coscli cp` if `coscli` is installed, else `tccli cos put-object`, else the
  file stays in `webapp-deploy/backups/` and the script prints a warning. Local copies
  older than `BACKUP_RETAIN_DAYS` (7) are pruned.

**The key is not in the backup.** `AGENTFORGE_SECRETS_KEY` lives only in Secrets Manager.
Lose it and `settings.enc` is unreadable no matter how good the backup is. `BACKUP_KEY` is
a second, separate secret - losing that one makes the tarballs unreadable instead.

### Hourly cron

RPO is one hour (placement doc section 5). Install on the CVM as the deploy user, with
`crontab -e`:

```cron
# m h  dom mon dow  command
17 * * * * BACKUP_KEY="$(tccli ssm get-secret-value --region ap-jakarta --SecretName dpsbuddy/prod/backup-key --VersionStage SSMCurrent | python3 -c 'import json,sys;print(json.load(sys.stdin)["SecretString"],end="")')" /bin/sh /srv/dpsbuddy/webapp-deploy/scripts/backup.sh >> /var/log/dpsbuddy-backup.log 2>&1
```

The passphrase is fetched with the instance role at each run and never lands in the
crontab or on disk. Spec L3 wants an alert when this job misses; wire the log file, or a
Cloud Monitor custom metric, to that alarm.

## Restore / roll back

```sh
# data
sh webapp-deploy/scripts/restore.sh backups/dpsbuddy-data-20260918T120000Z.tar.gz

# code
git -C .. checkout <previous-sha>        # run on the server, by hand
sh webapp-deploy/scripts/deploy.sh --no-pull
```

`restore.sh` stops both services, empties the volume, unpacks the tarball, promotes the
consistent snapshot over `agentforge.sqlite` (dropping the stale `-wal`/`-shm` so they
can never be replayed on top of it), and starts back up. It asks for confirmation unless
you pass `--yes`.

Rolling back code is a rebuild at an older sha. There is no image registry yet, so there
is no `docker pull <old-tag>` path; adding one is a migration-plan item.

## Logs

```sh
sh webapp-deploy/scripts/logs.sh          # both services
sh webapp-deploy/scripts/logs.sh app      # the host
sh webapp-deploy/scripts/logs.sh proxy    # Caddy / TLS
```

## Security group rules

Spec N2, applied on the CVM's security group in the Jakarta console. The default
"allow everything outbound" rule is wrong; replace it.

**Inbound**

| Source | Protocol / port | Why |
|---|---|---|
| `0.0.0.0/0`, `::/0` | TCP 443, **UDP 443** | HTTPS, and HTTP/3 which `compose.yml` publishes |
| `0.0.0.0/0`, `::/0` | TCP 80 | ACME HTTP challenge and the redirect to 443. Nothing is served here |
| Kyo's IP allowlist, or the bastion's private IP | TCP 22 | SSH, key only (spec I4) |
| anything else | - | **deny** |

**Outbound**

| Destination | Protocol / port | Why |
|---|---|---|
| `0.0.0.0/0` | TCP 443 | `api.tokotokenai.com`, the portal, `registry.npmjs.org`, Tencent APIs (SSM, COS, CLS), Let's Encrypt |
| `0.0.0.0/0` | UDP 53 and TCP 53 | DNS |
| anything else | - | **deny**. No plain HTTP out, no SMTP, no outbound SSH |

> **One conflict to settle before you close port 80 outbound.** `deploy.sh` builds the
> image *on this server*, and the build stage runs `apt-get` against `deb.debian.org`
> over HTTP. Either open TCP 80 outbound only while a build runs, or point apt at the
> HTTPS mirror in the Dockerfile. Moving builds to CI (migration plan) removes the
> question.

Verify from outside the VPC, not from the console:

```sh
nmap -Pn -p 1-65535 <public-ip>      # expect 80 and 443 only; 22 only from an allowlisted source
curl -sI https://$DPSBUDDY_DOMAIN | grep -iE 'strict-transport|content-security|x-content-type'
```

## Transport filtering

Everything below is **server mode only** (`AGENTFORGE_SERVER=1`). Webdev (`:3000`) and the
desktop keep the loopback rule they have always had: no filter, no limiter, no masking of
error text. Every rejection is the same JSON envelope, `{"error":{"code":"...","message":"..."}}`,
with `X-Content-Type-Options: nosniff`, and is written to stdout as one
`{"event":"request_filtered", ...}` line carrying the code, the method, the *length* of the
path and the client IP - never the path itself and never the body.

The order is cheapest first, and all of it runs **before** the Origin, CSRF and session rules
and long before a handler: TLS hop, request shape, rate, then the existing Origin/CSRF pair.

**Which requests it covers.** The TLS hop, the method allowlist, the path filter, the
header-size cap and the rate buckets run for **every** request, `/api` or not: the page, the
built bundles, every 404 probe. `handleNodeRequest` is the first middleware in
`apps/web/server.ts`, above `express.static` and vite, so a page request meets them before
anything serves it; a clean one falls through untouched. Only the Origin, CSRF, session and
`Content-Type` rules are `/api`-only - those are about a call the renderer makes rather than
about the hop it arrived on. If that mount ever moves, these controls move with it.

### Masked identity

| Rule | Where |
|---|---|
| No `X-Powered-By` (Express sets it on every response) | `app.disable("x-powered-by")`, `apps/web/server.ts`; removed again in `http-adapter.ts` `IDENTITY_HEADERS` |
| No `Server` | `header -Server` and `-X-Powered-By` in the `Caddyfile`; `IDENTITY_HEADERS` in the adapter |
| No stack trace, file path, SQL or module name in a 5xx body | `maskServerError` in `packages/host/src/http-adapter.ts` - the reason code survives, the message becomes fixed text |
| An exception that escapes a handler answers the same masked 500, never Express's HTML error page | `dispatchMasked` in `http-adapter.ts` |
| No directory listing | there is no `file_server` in the `Caddyfile`; the app process serves every path |

### HTTPS everywhere

| Rule | Code |
|---|---|
| HTTP redirects to HTTPS, permanently | `http://{$DPSBUDDY_DOMAIN}` block in the `Caddyfile` (nothing else is served on :80) |
| TLS 1.2 minimum | `tls { protocols tls1.2 tls1.3 }` |
| `Strict-Transport-Security: max-age=31536000; includeSubDomains` (no `preload`: the preload list is a months-long one-way door, so it is a deliberate later step) | `Caddyfile` header block |
| Only `https://` origins can be trusted; a cleartext entry in the allowlist is dropped | `trustedOrigins` in `packages/core/src/server-mode.ts` |
| A request without `X-Forwarded-Proto: https` answers **403 `https_required`** - which is every direct hit on `127.0.0.1:3000` from inside the box | `rejectPlaintext` in `http-adapter.ts` |

### HTTP filter

All in `filterHttpRequest`, `packages/host/src/local-request.ts`.

| Rule | Answer |
|---|---|
| Method must be GET, HEAD, POST, PUT, PATCH, DELETE or OPTIONS (so TRACE, TRACK, CONNECT and the WebDAV verbs are out) | 405 `method_not_allowed` |
| Path may not carry a control character, a raw or encoded NUL, a `..` segment (`%2e` spellings included), a backslash, or an encoded separator `%2f` / `%5c` | 400 `invalid_path` |
| Path may not exceed 2048 characters (`MAX_REQUEST_PATH_LENGTH`) | 400 `invalid_path` |
| At most 32 query parameters (`MAX_QUERY_PARAMS`) | 400 `too_many_query_params` |
| No single header past 8 KB, name plus value (`MAX_HEADER_BYTES`); Node already caps the whole block at 16 KB | 431 `header_too_large` |
| `Content-Length` above `MAX_BODY_BYTES` (26 MB) is refused before a byte of the body is read | 413 `payload_too_large` |
| A body must declare `application/json`, `multipart/form-data` or `text/plain`; `application/x-www-form-urlencoded` - the cross-site form shape - is not one of them | 415 `unsupported_media_type` |
| `Host` must be one of the trusted origins' hosts, and mutating calls need the Origin and the double-submit CSRF token | 403 `origin_forbidden`, `csrf_missing`, `csrf_invalid` |
| `Expect: 100-continue` | handled by Node before any of this |

### Rate limits

Token buckets in memory, `packages/host/src/rate-limit.ts`, bounded at 50 000 keys per
limiter with least-recently-used eviction - so rotating the source IP or the cookie costs
the attacker everything and the server nothing. Over the limit is **429 `rate_limited`**
with `Retry-After` in whole seconds.

| Bucket | Key | Default | Env |
|---|---|---|---|
| Per client IP | **last** `X-Forwarded-For` hop, else the socket address | 600 rpm, burst 100 | `AGENTFORGE_RATE_IP_RPM` |
| Per session | SHA-256 of the session cookie value, truncated - the value itself never becomes a map key or a log field. The name is the one this mode mints: `__Host-agentforge_session` in server mode | 300 rpm, burst 50 | `AGENTFORGE_RATE_SESSION_RPM` |
| `/api/v1/auth/*` | client IP again, tighter, because each of those is a portal round trip | 30 rpm, burst 10 | `AGENTFORGE_RATE_AUTH_RPM` |

Set a value to `0` to switch that bucket off. Junk falls back to the default: a typo in
`.env` must not quietly remove a limit.

Two Caddy defaults the app depends on, neither of which may be removed from the
`Caddyfile`: `X-Forwarded-For` (the limiter's key) and `X-Forwarded-Proto` (the HTTPS
check). `Host` must keep passing through unchanged for the Origin rule, as before.

**Who may set `X-Forwarded-For`.** The limiter reads the **last** hop, because a client can
send a header of its own and an appending proxy leaves that forged value first - reading the
first hop would let one machine mint a fresh bucket per request. The last entry is the one
the proxy in front wrote, which holds only while Caddy is the only thing that can reach the
app port. Caddy 2.7 and later *replace* `X-Forwarded-For` for a client that is not a declared
trusted proxy (the default trusted set is empty); verify the build on the box with
`caddy version` rather than assuming it. Putting a CDN or a load balancer in front means
declaring its ranges in `trusted_proxies` **and** revisiting the last-hop rule, since an extra
appending hop moves the client address away from the end. See the comment block above
`reverse_proxy` in the `Caddyfile`.

## Before-traffic acceptance

Spec section 9: every row below has to hold before the first user other than Kyo signs
in. Kyo signs the list in [`DEPLOY-LOG.md`](DEPLOY-LOG.md) with the sha that passed.
Rows marked *(code)* are **not** satisfiable from this folder - see
[What the spec asks that this folder cannot do](#what-the-spec-asks-that-this-folder-cannot-do).

- [ ] **N2** Security group: inbound 443/80/22-allowlist, outbound 443 + DNS only. Port-scanned from outside
- [ ] **N3** TLS 1.2+, HSTS `max-age=31536000`, certificate auto-renewing. `curl -I` and SSL Labs
- [ ] **N5** Only the proxy is reachable; the host still binds loopback. `ss -ltnp` on the CVM
- [ ] **I1** Root account: MFA on, no API keys, billing only
- [ ] **I2** Kyo on a CAM sub-account with MFA; the CVM uses an instance role. No `SecretId` in any file on the box
- [ ] **I3** Role policy is `PutObject`/`GetObject` on the two buckets and `GetSecretValue` on the one secret, nothing more
- [ ] **I4** SSH key-only, password auth off, root login off, `fail2ban` running. `sshd -T`
- [ ] **H1** Ubuntu LTS with `unattended-upgrades` on and a weekly reboot window
- [ ] **H2** Container runs as `node`, `read_only: true`, `/data` the only writable mount, `no-new-privileges`, `cap_drop: ALL`. In `compose.yml`; confirm with `docker inspect`
- [ ] **H4** Image built from a pinned sha, and the sha is in `DEPLOY-LOG.md`. `deploy.sh` appends it
- [ ] **A1** *(code)* Mutating `/api` accepts a trusted-origin allowlist and **rejects a missing Origin**
- [ ] **A3** CSP, `X-Content-Type-Options`, `Referrer-Policy: same-origin`, `Permissions-Policy` served by Caddy. In `Caddyfile`
- [ ] **A6** Every 4xx/5xx is the `{code, message}` envelope - no stack traces, paths or SQL
- [ ] **T4** *(code)* The gateway gate fails **closed** on the hosted build
- [ ] **T8** *(code)* "Start over" is scoped to the caller's tenant, or disabled on the web build
- [ ] **S1** *(code)* `AGENTFORGE_SECRETS_KEY` is mandatory; the `.master-key` fallback throws in server mode
- [ ] **S2** The wrap key comes from Secrets Manager at deploy time and is not in `.env`, the image, or git. `deploy.sh` with `USE_SSM=1`
- [ ] **S5** CBS disk encryption on; COS SSE-KMS on both buckets
- [ ] **S6** Backups encrypted before upload. `backup.sh` with `BACKUP_KEY`
- [ ] **L1** *(code)* No prompts, bodies, keys or tokens in any log line; tenant id and request id as fields
- [ ] **L2** Proxy access log with IP, path, status, latency, shipped to CLS with 30-day retention. In `Caddyfile`
- [ ] **L3** Alerts wired: disk > 80 %, 5xx > 1 % over 5 min, health check failing 3 times, backup job missed, certificate < 14 days
- [ ] **L5** This README's incident-response section read and the read-only switch rehearsed

## Incident response

Spec L5. One page, in the order you will actually want it at 03:00.

**Who.** Kyo is on call and is the only escalation. There is no second responder yet; say
so out loud rather than pretending otherwise.

**1. Take the site read-only, first, before diagnosing.** It costs about a second and it
stops an active abuser from writing anything else. In [`Caddyfile`](Caddyfile), uncomment
the two lines under *Incident response*:

```caddyfile
@mutating not method GET HEAD OPTIONS
respond @mutating "DPSBuddy is temporarily read-only." 503
```

```sh
docker compose -f webapp-deploy/compose.yml restart proxy
curl -si -X POST https://$DPSBUDDY_DOMAIN/api/v1/workspaces | head -1   # expect 503
```

Reads keep working, so nobody loses access to their own work while you look. Comment the
lines back out and restart the proxy to restore writes.

**2. Preserve evidence before you restart anything else.** `sh scripts/logs.sh proxy 5000
> /tmp/incident-proxy.log` and the same for `app`, plus `sh scripts/backup.sh` for a
point-in-time copy. Docker's json-file logs rotate at 10 MB x 5; a busy hour can age out
the thing you need.

**3. Rotate the wrap key (spec S4)** if there is any chance `AGENTFORGE_SECRETS_KEY`
leaked - a copy of `.env`, a shell history, a leaked image layer, an SSM audit line you
cannot account for:

1. Generate the new key and put it in Secrets Manager as a **new version** of
   `dpsbuddy/prod/agentforge-secrets-key`. Do not overwrite the current one yet.
2. Take a backup (`scripts/backup.sh`). This is the rollback.
3. Re-wrap: with both keys available, decrypt every `settings.enc` envelope with the old
   key and re-encrypt with the new one. **There is no script for this yet** - writing and
   drilling it is the Phase 4 item S4 names, and it is the single biggest hole in this
   runbook.
4. Swap `SSMCurrent` to the new version and redeploy (`scripts/deploy.sh --no-pull`).
5. Verify a gateway call still works, then delete the old version.
6. Treat every tenant gateway key the old wrap key protected as exposed: rotate them with
   the provider too.

**4. Notify affected tenants within 72 hours.** UU PDP 27/2022 expects it, and the clock
starts when you become *aware*, not when you finish the investigation. Send: what
happened, what data was involved, when, what you have done, what they should do. Send it
even if the investigation is incomplete - a second message is fine, a late first one is
not. Contact addresses come from the portal tenant list.

**5. Write it down.** A row in [`DEPLOY-LOG.md`](DEPLOY-LOG.md) with the sha, and the
narrative in the decision record.

## Restore drill

Monthly, on the first working day. Placement doc section 5: RTO 2 hours, RPO 1 hour. An
untested backup is a hypothesis.

1. Start a scratch CVM in Jakarta from the same base image. Do **not** drill on the
   production box.
2. Pull the newest object from the COS backup bucket.
3. `export BACKUP_KEY="$(...tccli ssm get-secret-value...)"` - the same fetch the cron
   line uses.
4. `sh webapp-deploy/scripts/restore.sh <archive>.tar.gz.enc --yes`
5. Wait for the healthcheck, open the app, and check three things by hand: a thread's
   messages are there, Settings still decrypts the gateway key (so the wrap key in SSM
   matches the archive), and a media file opens.
6. Record the date, the archive, the wall-clock time to green, and anything that went
   wrong in [`DEPLOY-LOG.md`](DEPLOY-LOG.md).
7. Destroy the scratch CVM.

A drill that was not written down did not happen.

## What the spec asks that this folder cannot do

These are **before-traffic** rows that no amount of compose, Caddy or shell can satisfy.
Each is a source change in [`docs/internal/web-migration-plan.md`](../docs/internal/web-migration-plan.md),
and this folder is deliberately additive - it does not edit `apps/` or `packages/`.

| Row | What it needs | Where |
|---|---|---|
| **A1** | **Landed 2026-09-18.** With `AGENTFORGE_SERVER=1` mutating `/api` needs an Origin and a Host from `AGENTFORGE_TRUSTED_ORIGINS` (a missing Origin is rejected) plus the CSRF token (`__Host-agentforge_csrf` cookie, `x-agentforge-csrf` header). The proxy passes `Host` through unchanged. | `packages/host/src/local-request.ts`, `http-adapter.ts`, `csrf.ts` |
| **T4** | **Landed 2026-09-18.** The gate fails closed on the hosted build (meta marker injected by `server.ts`), and in server mode the host takes no key on trust and the stub runtime does not open it | `apps/web/lib/gateway-gate.ts`, `packages/host/src/gateway-gate.ts` |
| **T8** | **Landed 2026-09-18.** Both reset scopes answer `403 reset_disabled` in server mode; per-tenant reset is Phase 3 | `packages/host/src/handlers/settings.ts` |
| **S1** | **Landed 2026-09-18.** With `AGENTFORGE_SERVER=1`, `getLocalVaultKey` throws `SERVER_VAULT_KEY_REQUIRED` when `AGENTFORGE_SECRETS_KEY` is unset and `SERVER_VAULT_KEY_TOO_WEAK` when it carries under 32 bytes of entropy; the `.master-key` fallback is unreachable on the server. The gate is server mode, not `NODE_ENV` | `packages/db/src/vault-key.ts:123-134` |
| **L1** | No prompts, message bodies, keys or tokens in any log line, with tenant id and request id as fields. Caddy's access log is filtered here, but the application logger is the one that sees prompts | host logger |

**A4** rate limiting has no Caddy module in the pinned `caddy:2-alpine` image, so it is
done in the app instead - per IP, per session and tighter on `/api/v1/auth/*`; see
[Transport filtering](#transport-filtering). **L2**/**L3** produce the log lines but
nothing ships them to CLS or raises an alarm yet.

## Environment

Full list with a line of meaning each in [`.env.example`](.env.example). The ones that
matter:

| Var | Meaning |
|---|---|
| `DPSBUDDY_DOMAIN` | Public hostname Caddy serves and gets a certificate for |
| `AGENTFORGE_SECRETS_KEY` | 32-byte hex wrap key for `settings.enc` and sealed prompts (`openssl rand -hex 32`). Generate once. Changing it makes the vault unreadable |
| `AGENTFORGE_DATA_DIR` | `/data` — SQLite, settings, media, logs, components. On the volume |
| `NODE_ENV` | `production` — anything else starts Vite dev middleware |
| `PORT` | `3000` inside the container only |
| `AGENTFORGE_RUNTIME` | `ai` or `stub`. `stub` answers without a model **and** disables the component installer's auto-download. Leave unset for normal gateway-first behaviour |
| `DATABASE_URL` | Leave unset. SQLite under the data dir. A `postgres://` URL throws on boot — Postgres is an open decision, not a supported mode |
| `USE_SSM` | `1` on the CVM: `deploy.sh` fetches the wrap key and `BACKUP_KEY` from Secrets Manager with the instance role and exports them for that one command. `0` reads them from `.env` (local and staging only) |
| `SSM_SECRET_AGENTFORGE_SECRETS_KEY` / `SSM_SECRET_BACKUP_KEY` | Secret **names** in SSM, never values |
| `BACKUP_KEY` | Passphrase for `openssl enc` over the backup tarball (spec S6). Separate from the wrap key. Empty in `.env` on the server |
| `TENCENT_REGION` | `ap-jakarta`. SSM, COS and the CVM. Personal data stays in-country; `ap-singapore` is the backup replica only |
| `COS_BACKUP_BUCKET` / `COS_MEDIA_BUCKET` | `<name>-<appid>` as the console shows them. Both private, both SSE-KMS |
| `AGENTFORGE_SERVER`, `AGENTFORGE_TRUSTED_ORIGINS`, `BIND_HOST`, `AGENTFORGE_PORTAL_URL`, `AGENTFORGE_MAX_FFMPEG`, `AGENTFORGE_MAX_SQL_WORKERS`, `AGENTFORGE_JOB_QUEUE_TIMEOUT_MS`, `AGENTFORGE_LOG_LEVEL`, `AGENTFORGE_RATE_IP_RPM`, `AGENTFORGE_RATE_SESSION_RPM`, `AGENTFORGE_RATE_AUTH_RPM` | Hosted mode (Phase 1 and 2). See the comments in `.env.example`; the switch is `AGENTFORGE_SERVER=1` |
| `AGENTFORGE_APPLY_PENDING_RESET` | **Never set by hand.** `apps/web/server-env.ts` sets it to apply a queued "Start over" wipe |

## What is not done yet

Nothing in this folder makes the app safe to expose. These are the gaps, and they belong
to [`docs/internal/web-migration-plan.md`](../docs/internal/web-migration-plan.md) and the
open decisions in [`docs/internal/web-pivot-2026-09-18.md`](../docs/internal/web-pivot-2026-09-18.md).

1. **Writes behind the proxy: landed 2026-09-18.** With `AGENTFORGE_SERVER=1` the host checks
   Origin and Host against `AGENTFORGE_TRUSTED_ORIGINS` and requires the CSRF token, so the
   `Caddyfile` no longer rewrites `Host`. Set the public origin in `.env` or every write answers
   `403 origin_forbidden`.
2. **Sign-in: backend landed 2026-09-18, no screen yet.** In server mode every `/api` call
   except `/api/v1/auth/*`, `GET /api/v1/ping` and `GET /api/v1/components` answers
   `401 session_required` until a portal session exists (`packages/host/src/auth/`). The
   browser sign-in screen and the portal's browser-login endpoint are still open (decision 2).
3. **No tenancy.** Every row is the single owner's. `one server, many tenants` is the
   target, not the state; the schema has no tenant column. Open decision 1, and until it
   is answered a public deployment is a shared, single-tenant desk.
4. **No CSRF protection.** See (1).
5. **No seat / plan enforcement server-side.** The 20-seat paywall and the two-plan
   pricing model are decided in principle; the host does not check a plan row yet.
6. **Single SQLite file, single server.** Fine for the first deployment by the decision
   record. No replication, so the backup tarball is the only copy.
7. **No image registry, no CI build.** `deploy.sh` builds on the server.
8. **No log shipping, no metrics, no alerting.** `docker compose logs` is all there is.
9. **ffmpeg / ffprobe absent**, so Edit export degrades.
10. **Dev dependencies ship in the image** because `tsx` is the entrypoint.
