# Setting DPSBuddy up on a Tencent Cloud CVM

**Status:** runbook, written 2026-09-20, verified against `main` at `b482611`. Every `file:line` below was read in that tree.

This is the step-by-step for standing the hosted DPSBuddy web app up on a **fresh** Tencent Cloud CVM
in Jakarta, by hand, from nothing. It is written to be followed top to bottom in one sitting by the
person at the keyboard. Where a step is a decision rather than a command, it says so and gives the
default.

Companions, and what each is for:

| Doc | What it decides |
|---|---|
| [`../../webapp-deploy/README.md`](../../webapp-deploy/README.md) | The reference for the stack itself: image, compose, Caddy, the scripts, the incident runbook |
| [`web-data-placement-tencent.md`](web-data-placement-tencent.md) | Which Tencent service holds which data, sizing, and the price tables this page's cost section is drawn from |
| [`web-security-spec.md`](web-security-spec.md) | The numbered security rows (`N2`, `S2`, `H2`…) this page keeps referring to, and the before-traffic acceptance list |
| [`web-migration-plan.md`](web-migration-plan.md) | The phases. This page is **Phase 0**: the tree as it stands, on the server, over HTTPS |
| [`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md) | The decision record, and the deploy log of record |

> **Who this deployment is for today.** Phase 1 and Phase 2 are merged (PR #56): mutating `/api`
> needs a trusted Origin, a matching `Host` and a CSRF token, and in server mode every `/api` call
> outside a short exempt list needs a portal session. Phase 3 has since landed lanes A, B and C, so
> the schema now carries a `tenants` table and `organizations.tenant_id`, and `getTenant()` resolves
> the tenant from the verified session rather than from the single local owner
> (`packages/host/src/tenant.ts:88-103`). **What is still missing is the part a second person would
> need: there is no browser sign-in screen**, per-tenant files and storage prefixes are lane D, and
> the sweep that proves every by-id route 404s across tenants is lane E. So a server stood up from
> this page is still a private deployment for Kyo, and the URL should not go to a second person
> until lanes D and E land. The rest of the
> gaps are in [`../../webapp-deploy/README.md`](../../webapp-deploy/README.md) under *What is not
> done yet*.

---

## 0. What you need before you start

Collect these first; three of them take longer to get than the whole install.

- A **Tencent Cloud account** with a CAM sub-account for yourself, MFA on both, and the root account
  holding no API keys (security spec `I1`, `I2`).
- A **domain name** you control, and the ability to add an `A` record. If the domain is served from
  mainland China you also need an ICP filing; a `.com` served from Jakarta to Indonesian users does
  not.
- An **SSH key pair**. Password login is switched off in step 2.
- The **Toko Token gateway key** for the deployment. It is pasted into the app's Settings screen
  after first boot, not into any file on the server.
- The **portal URL** for browser sign-in (`AGENTFORGE_PORTAL_URL`). Phase 2's client calls it; see
  [`portal/device-code-login.md`](portal/device-code-login.md).
- About **90 minutes**, most of which is the first image build.

Two secrets get generated during this runbook and must never be lost:

| Secret | Generated with | Lost means |
|---|---|---|
| `AGENTFORGE_SECRETS_KEY` | `openssl rand -hex 32` | `settings.enc` is unreadable forever — every saved gateway key is gone |
| `BACKUP_KEY` | `openssl rand -hex 32` | Every encrypted backup tarball is unreadable |

They are different secrets on purpose, and both live in Tencent Secrets Manager, not on the box.

---

## 1. Order the CVM

### Sizing, and why

Start at **8 vCPU / 16 GB**, AMD family (`SA5.2XLARGE16` at the time of writing), Ubuntu 22.04 LTS,
in **Jakarta (`ap-jakarta`)**, one availability zone.

The reasoning is in [`web-data-placement-tencent.md`](web-data-placement-tencent.md) §4b and is worth
reading once, because it is not "what a web app needs". Almost nothing in DPSBuddy is model-shaped
work done locally — that goes to the gateway. What burns local CPU and RAM is a short list of jobs
with known costs:

- an ffmpeg render is 2–4 vCPU and 0.3–0.6 GB while it runs, capped at `AGENTFORGE_MAX_FFMPEG` (2 by
  default), with a queue four times that (`packages/host/src/concurrency.ts`);
- a SQL worker is a 1 vCPU burst with a 128 MB heap ceiling, capped at `AGENTFORGE_MAX_SQL_WORKERS`
  (4);
- PDF and anydoc extraction are each about 1 vCPU and are **uncapped** today;
- DOCX extraction runs on the request thread and blocks every other request for up to 20 seconds
  (`packages/host/src/knowledge-extract.ts`).

So the worst case is set by those caps, not by how many people are signed in. 8 vCPU / 16 GB covers
one org of about 20 active users with room for two renders and two extractions at once. The AMD
families are meaningfully cheaper than the Intel ones for the same shape and nothing in the host is
CPU-family specific.

Do **not** go past about 64 vCPU. Past roughly 150–200 concurrent users a bigger box stops helping,
because the host is one Node process on one event loop with one SQLite writer. The next step there is
Postgres (the Phase 3 decision point) and a second app instance, not a larger machine.

### Disks

| Disk | Size | Type | Mount |
|---|---|---|---|
| System | 50 GB | Premium SSD | `/` |
| **Data** | 200 GB | Premium SSD | `/srv/dpsbuddy-data` |

Order the data disk as a **separate** CBS volume, not as a bigger system disk. It carries
`agentforge.sqlite`, `settings.enc` and all media, it is what gets snapshotted, and keeping it
separate is what lets you rebuild the box without touching the data.

Turn **CBS disk encryption on at order time** (security spec `S5`). It cannot be switched on later
without recreating the disk.

Nothing is cleaned up automatically today — there is no retention job anywhere in
`packages/host/src` — and a 1080p render is roughly 60–90 MB per minute of video. 200 GB is a
starting point, not a ceiling; watch it, and see [§12](#12-phase-6-moving-media-to-cos) for where
this stops being a disk problem.

### Networking

- One VPC, the CVM in it. Assign a public IP (the app is the only public thing on this box).
- **Anti-DDoS Basic** is included; leave it on (spec `N4`).
- Do not order a CLB yet. Caddy on the box terminates TLS, and a CLB only earns its keep when there
  is a second CVM.

---

## 2. First login, OS and hardening

SSH in as the user your key was installed for, then:

```sh
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y ca-certificates curl git openssl ufw fail2ban unattended-upgrades python3
```

`openssl` is not optional: `backup.sh` and `restore.sh` both refuse to run without it
(`webapp-deploy/scripts/backup.sh`, `restore.sh`). `python3` is needed by `deploy.sh` to read the
JSON that `tccli` prints (`webapp-deploy/scripts/deploy.sh`). `git` is needed because `deploy.sh`
builds from a checkout on this box.

Turn on unattended security upgrades and pick a weekly reboot window (spec `H1`):

```sh
sudo dpkg-reconfigure -plow unattended-upgrades
```

Lock SSH down (spec `I4`). In `/etc/ssh/sshd_config`:

```
PasswordAuthentication no
PermitRootLogin no
```

then `sudo systemctl restart ssh`, and confirm it took with `sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin'`.
Leave `fail2ban` enabled.

**Keep your current session open** while you test a second SSH login. Locking yourself out of a fresh
CVM is the most common way this step goes wrong.

---

## 3. Install Docker and Compose

Tencent's Ubuntu image does not ship Docker. Use Docker's own repository, not `apt install docker.io`,
because the stack needs Compose v2 and a recent BuildKit:

```sh
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and back in for the group to take effect, then check both halves:

```sh
docker version
docker compose version     # must be v2; the scripts fall back to docker-compose but v2 is the tested path
```

Install the Tencent CLI too — `deploy.sh` uses it to read secrets, and `backup.sh` uses `coscli` to
upload:

```sh
sudo apt-get install -y python3-pip && pip3 install --user tccli   # lands in ~/.local/bin; step 10 needs that on cron's PATH
# coscli: download the release binary from Tencent's COS tools page and put it on PATH
```

`backup.sh` degrades loudly rather than failing if neither `coscli` nor `tccli` is present — it leaves
the archive on the box and prints a warning — but a backup that never leaves the server is one disk
failure away from not existing.

---

## 4. Mount the data disk

Find the new device (it is usually `/dev/vdb`), format it once, and mount it permanently:

```sh
lsblk                                    # confirm which device is the 200 GB one, and that it is empty
sudo mkfs.ext4 /dev/vdb
sudo mkdir -p /srv/dpsbuddy-data
echo '/dev/vdb  /srv/dpsbuddy-data  ext4  defaults,nodev,noatime  0  2' | sudo tee -a /etc/fstab
sudo mount -a
sudo chown 1000:1000 /srv/dpsbuddy-data   # the `node` uid:gid inside the image
df -h /srv/dpsbuddy-data
```

**The `chown` is not optional.** A fresh ext4 mount is `root:root 0755`, the container runs as `node`
(`webapp-deploy/Dockerfile:85`) with `read_only: true`, and the image's own
`chown -R node:node /data` (`Dockerfile:82`) is hidden the moment a bind mount covers `/data`. Without
it the first boot dies with `EACCES` creating `agentforge.sqlite`, and all you see is a container that
never goes healthy. `1000:1000` is the `node` user in `node:22-bookworm-slim`; `restore.sh:75-83` does
the same `chown` after unpacking, for the same reason. Confirm it before you bring the stack up:

```sh
stat -c '%u:%g %a %n' /srv/dpsbuddy-data    # expect 1000:1000 755
```

`nodev` is in the flags on purpose. `noexec` is **not**, and must not be added yet: the component
installer can load native modules out of `/data/components`, so `noexec` becomes safe only once
security spec `H3` is signed off. The comment block in `webapp-deploy/compose.yml` says the same
thing next to the volume definition.

Then point the stack at this disk. In `webapp-deploy/compose.yml`, replace the named volume on the
`app` service:

```yaml
    volumes:
      - type: bind
        source: /srv/dpsbuddy-data
        target: /data
```

The shipped default is a Docker named volume, which works, but a bind mount to a dedicated disk is
what the placement doc asks for and what makes a snapshot mean something. This is the one local edit
to a tracked file this runbook makes; keep it out of any commit back to the repo.

---

## 5. Secrets, CAM and Secrets Manager

Security spec `S2` is the rule here: **the wrap key is never written to the box.** `deploy.sh` fetches
it from Secrets Manager with the CVM's instance role and exports it for the lifetime of that one
command.

1. Generate both secrets **on your laptop**, not on the CVM:

   ```sh
   openssl rand -hex 32      # -> AGENTFORGE_SECRETS_KEY
   openssl rand -hex 32      # -> BACKUP_KEY
   ```

   Keep an offline copy of each somewhere that is not this server. `packages/db/src/vault-key.ts`
   requires at least 32 bytes of entropy and refuses anything shorter.

2. In **Secrets Manager**, create two secrets, holding the plaintext string each:

   | Secret name | Holds |
   |---|---|
   | `dpsbuddy/prod/agentforge-secrets-key` | the wrap key |
   | `dpsbuddy/prod/backup-key` | the backup passphrase |

   Those names are the defaults in `webapp-deploy/.env.example`; if you change them, change
   `SSM_SECRET_AGENTFORGE_SECRETS_KEY` and `SSM_SECRET_BACKUP_KEY` to match.

3. Create a **CAM role for the CVM** and attach it to the instance. Its policy is exactly three
   things and nothing more (spec `I3`):

   - `GetSecretValue` on those two secrets;
   - `PutObject` and `GetObject` on the backup bucket;
   - `PutObject` and `GetObject` on the media bucket.

   No `SecretId` / `SecretKey` pair goes into any file on this box. If `tccli` needs configuring, give
   it the region only and let it use the instance role.

4. Create the two **COS buckets**, in Jakarta, both **private**, both **SSE-KMS** (spec `S5`):

   | Bucket | Settings |
   |---|---|
   | `dpsbuddy-backup-<appid>` | versioning on; lifecycle: ARCHIVE after 30 days, delete after 365 |
   | `dpsbuddy-media-<appid>` | nothing yet — it is not used until Phase 6 ([§12](#12-phase-6-moving-media-to-cos)) |

   Bucket names are `<name>-<appid>` exactly as the console shows them.

---

## 6. Clone the repo and write `.env`

```sh
sudo mkdir -p /srv/dpsbuddy && sudo chown "$USER" /srv/dpsbuddy
git clone https://github.com/Kyoo032/agentforge.git /srv/dpsbuddy
cd /srv/dpsbuddy/webapp-deploy
cp .env.example .env
chmod 600 .env
```

`/srv/dpsbuddy` is the path the cron line and the scripts in this page assume. If you put it
elsewhere, adjust them.

### Every environment variable, and which ones are secret

The template at [`../../webapp-deploy/.env.example`](../../webapp-deploy/.env.example) carries a line
of meaning for each, and it is the authority. What follows covers every key you have to **decide**,
grouped by the decision, with the ones that are **secret** marked. It is deliberately not exhaustive:
`COS_BACKUP_PREFIX`, `SSM_VERSION_STAGE`, `AGENTFORGE_EDIT_ASR_MODEL` and the four `*_BASE_URL` keys
have working defaults you do not touch on a first deploy — read them in the template if you need
them. A secret here means: never in git, never in the image, never in a log line,
and on this server never in `.env` at all.

**Must be set before first boot**

| Var | Set it to | Notes |
|---|---|---|
| `DPSBUDDY_DOMAIN` | your public hostname, e.g. `app.dpsbuddy.com` | Caddy serves it and gets the certificate for it. No scheme |
| `NODE_ENV` | `production` | Anything else starts the Vite dev middleware instead of serving `apps/web/dist` (`apps/web/server.ts:17`) |
| `AGENTFORGE_SERVER` | `1` | The one switch for every hosted rule (`isServerMode`, `packages/core/src/server-mode.ts:12-15`). Off, this is a desktop-shaped install with no CSRF, no session gate and no mandatory wrap key |
| `AGENTFORGE_TRUSTED_ORIGINS` | `https://app.dpsbuddy.com` | Scheme included, comma-separated for more than one. **In server mode an empty list accepts no write from any browser** (`trustedOrigins`, `packages/core/src/server-mode.ts:22-33`), and a cleartext `http://` entry is dropped rather than trusted (`parseOriginList`, `:46-55`) |
| `AGENTFORGE_DATA_DIR` | `/data` | The container path; the bind mount from step 4 is what makes it durable |
| `BIND_HOST` | `127.0.0.1` | See [§7](#7-why-the-proxy-shares-the-apps-network-namespace) |
| `AGENTFORGE_PORTAL_URL` | your portal's API base | Phase 2's browser session exchange |
| `USE_SSM` | `1` | Fetch the two secrets from Secrets Manager with the instance role |
| `TENCENT_REGION` | `ap-jakarta` | SSM, COS and the CVM |
| `SSM_SECRET_AGENTFORGE_SECRETS_KEY` | `dpsbuddy/prod/agentforge-secrets-key` | The secret's **name**, never its value |
| `SSM_SECRET_BACKUP_KEY` | `dpsbuddy/prod/backup-key` | Likewise |
| `COS_BACKUP_BUCKET` | `dpsbuddy-backup-<appid>` | From step 5 |

**Must be left EMPTY on this server** (they are secrets, and `deploy.sh` supplies them per run)

| Var | Why empty |
|---|---|
| 🔒 `AGENTFORGE_SECRETS_KEY` | Spec `S2`. `deploy.sh` warns if you leave a value here with `USE_SSM=1` |
| 🔒 `BACKUP_KEY` | Spec `S6`. Fetched per backup run by the cron line in [§10](#10-backups) |

**Tuning — defaults are fine to start**

| Var | Default | Raise it when |
|---|---|---|
| `PORT` | `3000` | Never, on this box. It is the port *inside* the container |
| `AGENTFORGE_MAX_FFMPEG` | `2` | Renders queue up and you have bought the vCPUs for it |
| `AGENTFORGE_MAX_SQL_WORKERS` | `4` | Data-desk queries queue |
| `AGENTFORGE_JOB_QUEUE_TIMEOUT_MS` | `60000` | Legitimate jobs are getting `429 too_many_jobs` |
| `AGENTFORGE_RATE_IP_RPM` | `600` (burst 100) | A real client is being limited. `0` switches the bucket off; junk falls back to the default rather than silently removing the limit |
| `AGENTFORGE_RATE_SESSION_RPM` | `300` (burst 50) | Likewise |
| `AGENTFORGE_RATE_AUTH_RPM` | `30` (burst 10) | Keep this far below the others: each call there is a portal round trip |
| `AGENTFORGE_LOG_LEVEL` | `info` | Debugging. `debug` is noisier, not less redacted |
| `BACKUP_RETAIN_DAYS` | `7` | Local copies pile up |
| `BACKUP_VERIFY` | `1` | Only on a very large volume, and reluctantly |

**Optional, usually unset**

`AGENTFORGE_RUNTIME` (`ai` or `stub` — `stub` answers without a model *and* disables the component
installer's download; leave unset for normal gateway-first behaviour), `MEDIA_ROOT`,
`AGENTFORGE_GATEWAY_URL`, `AGENTFORGE_GATEWAY_NAME`, `AGENTFORGE_PRODUCT_NAME`, `AGENTFORGE_LOCALE`,
`AGENTFORGE_SETTINGS_PATH`, `AGENTFORGE_MIGRATIONS_DIR`, `AGENTFORGE_FFMPEG_PATH` /
`AGENTFORGE_FFPROBE_PATH` (neither binary is in the image, so Edit export stays degraded until one
is), and the model-cache overrides.

**The direct provider keys are no longer a fallback on this server.** `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` and `ARK_API_KEY` are ignored whenever
`AGENTFORGE_SERVER=1` (Phase 4, `resolveProviderKeys` in `packages/core/src/secrets.ts`). They are
the OPERATOR's credentials, and on a box with tenants on it, handing them to whichever tenant has
not saved a key of their own means the operator pays for calls nobody can attribute — and any
signed-in tenant can spend them. Each tenant supplies its own gateway key through onboarding or
Settings, sealed under `AGENTFORGE_SECRETS_KEY` in that tenant's own row. A tenant with no key sees
onboarding, which is the intended state and not a misconfiguration. On a desk, and on webdev, the
env fallback behaves exactly as it always has.

`AGENTFORGE_SECRETS_KEY` can be changed without losing anybody's settings — see the rotation drill
in [`web-phase4-tenant-secrets.md`](web-phase4-tenant-secrets.md) §5. Do not simply edit it in the
compose file: every tenant's sealed settings would stop opening.

**Do not set, ever**

| Var | Why |
|---|---|
| `DATABASE_URL` | Leave unset for SQLite under the data dir. A `postgres://` URL **throws on boot** (`sqliteFilePath`, `packages/db/src/vault-key.ts:25`) — Postgres is a Phase 3 decision, not a supported mode |
| `AGENTFORGE_APPLY_PENDING_RESET` | `apps/web/server-env.ts` sets it at boot to apply a queued "Start over". Setting it by hand can delete the data dir |
| `AGENTFORGE_PACKAGED` | An Electron packaging marker. Desktop only |

---

## 7. Why the proxy shares the app's network namespace

Worth understanding before the first build, because it explains the shape of `compose.yml` and the
one rule you must not break in `Caddyfile`.

`apps/web/server.ts:114-115` binds the interface that `resolveBindHost` returns
(`apps/web/lib/bind-host.ts:17-27`). The default is `127.0.0.1`, and a non-loopback `BIND_HOST` is
**refused with a thrown error unless `AGENTFORGE_SERVER` is on** — so a webdev run can never go
LAN-wide by accident.

The shipped stack keeps `BIND_HOST=127.0.0.1` and has the proxy join the app container's network
namespace instead of talking to it over a bridge:

```yaml
proxy:
  image: caddy:2-alpine
  network_mode: "service:app"
```

Both containers then share one loopback, so Caddy's `reverse_proxy 127.0.0.1:3000` reaches the host
process. A service that shares another service's namespace cannot publish ports of its own, which is
why `80`, `443` and `443/udp` are published on the **app** service.

Since `BIND_HOST` landed you could instead bind `0.0.0.0` inside the container and put the two
services on a normal bridge network. Don't, without a reason: the namespace-sharing arrangement is
what has been tested, and loopback-only means nothing on the host can reach the app port but Caddy.

**The rule that must not be broken:** the proxy passes `Host` and `Origin` through **unchanged**. With
`AGENTFORGE_SERVER=1` a mutating `/api` call is accepted only when its `Origin` *and* its `Host` both
match `AGENTFORGE_TRUSTED_ORIGINS`. That is Caddy's default, which is why the `Caddyfile` deliberately
carries no `header_up Host` line — an older loopback-rewriting proxy config would now turn every
`POST` / `PATCH` / `DELETE` into `403 origin_forbidden`. Rewriting `Origin` would reopen the exact
CSRF hole the check exists to close.

Two headers the app depends on Caddy sending, both defaults, neither removable:
`X-Forwarded-Proto` (a request without `https` gets `403 https_required`, which is what makes a direct
hit on `127.0.0.1:3000` from inside the box useless) and `X-Forwarded-For` (its **last** hop is the
per-IP rate-limit key).

---

## 8. DNS, the security group, and the first build

### DNS first

Point an `A` record for `$DPSBUDDY_DOMAIN` at the CVM's public IP, and an `AAAA` if you have IPv6.
**Do this before the first `up`**: Caddy asks Let's Encrypt for a certificate on startup, and that
fails until the name resolves to this machine. Confirm with `dig +short app.dpsbuddy.com` from your
laptop.

### Security group

Spec `N2`. The default "allow everything outbound" rule is wrong; replace it.

**Inbound**

| Source | Protocol / port | Why |
|---|---|---|
| `0.0.0.0/0`, `::/0` | TCP 443 **and UDP 443** | HTTPS, and HTTP/3, which `compose.yml` publishes |
| `0.0.0.0/0`, `::/0` | TCP 80 | The ACME challenge and the redirect to 443. Nothing is served here |
| Your IP allowlist, or a bastion's private IP | TCP 22 | SSH, key only |
| everything else | — | **deny** |

**Outbound**

| Destination | Protocol / port | Why |
|---|---|---|
| `0.0.0.0/0` | TCP 443 | `api.tokotokenai.com`, the portal, `registry.npmjs.org`, Tencent APIs (SSM, COS, CLS), Let's Encrypt |
| `0.0.0.0/0` | UDP 53, TCP 53 | DNS |
| everything else | — | **deny**. No plain HTTP out, no SMTP, no outbound SSH |

> **One conflict to settle.** `deploy.sh` builds the image *on this server*, and the build stage runs
> `apt-get` against `deb.debian.org` over **HTTP**. Either open TCP 80 outbound only while a build is
> running, or point apt at an HTTPS mirror in the Dockerfile. Moving builds to CI removes the question
> and is a migration-plan item.

### Build

```sh
cd /srv/dpsbuddy
sh webapp-deploy/scripts/build.sh
```

Expect 10–20 minutes on the first run. What it is doing, from `webapp-deploy/Dockerfile`:

- `node:22-bookworm-slim` with pnpm 9.15.9 via corepack. Debian rather than Alpine on purpose:
  `pnpm-lock.yaml` resolves `@firecrawl/anydoc` to the `-linux-*-gnu` packages, and musl would pick
  different ones and force a `better-sqlite3` rebuild.
- `pnpm install --frozen-lockfile --filter "@agentforge/web..."` — the web app and its workspace
  dependencies only. `apps/desktop` (Electron, electron-builder, keytar) and `apps/mobile` are never
  installed.
- `pnpm --filter @agentforge/web build` → `apps/web/dist`, which `server.ts` serves statically.
- The whole workspace source ships, dev dependencies included, because every `@agentforge/*` package
  exports TypeScript directly and `tsx` — a dev dependency — **is** the production entrypoint.
  `pnpm prune --prod` would delete the thing that boots the app. Trimming this is a migration-plan
  item, not something to improvise here.
- Runs as the non-root `node` user, with `/data` owned by it.

If the build dies in `better-sqlite3`, it is the native toolchain: `python3`, `make` and `g++` are
installed in the build stage for exactly that, and the node-gyp fallback fails hard without them.

---

## 9. First run, and the checks that prove it

```sh
cd /srv/dpsbuddy
sh webapp-deploy/scripts/deploy.sh --no-pull
```

`--no-pull` because you just cloned; later runs drop it. The script fetches both secrets from Secrets
Manager into its own process (never to disk), builds, brings the stack up, waits up to five minutes
for the container healthcheck, and prints a ready-made row for the deploy log.

Then run these five checks **in order**. Each one is written so a failure tells you which layer broke.

**1. The container is healthy.** The image's own `HEALTHCHECK` hits `GET /api/v1/components` on
loopback, **with an `x-forwarded-proto: https` header**. Two things have to be true for that to pass,
and it is worth knowing both, because this is where a first deploy usually stops:

- The route is ungated on purpose. It is one of the two `UNGATED_GETS`
  (`packages/host/src/auth/routes.ts:45`) and `packages/host/src/handlers/components.ts:4-8` explains
  why: a component is installed before anyone has pasted a gateway key. So it answers before any key
  exists and without touching the database.
- The header is what gets the probe past the transport filter. In server mode `rejectPlaintext`
  (`packages/host/src/http-adapter.ts:315-318`, called at `:421`) answers `403 https_required` to
  every request that does not carry it, on **every** path, before routing. A probe without the header
  fails every time, `deploy.sh` waits its five minutes and exits non-zero, and the logs show nothing
  but 403s. Sending the header from inside the container is safe: that process is already past the
  boundary the control exists to defend, and the port is loopback-only anyway.

This is the one place where an inside-the-box caller is allowed to look like the proxy, and check 3
below proves nobody else can.

```sh
docker ps                                   # both containers up, app healthy
sh webapp-deploy/scripts/logs.sh app 50     # no stack traces at boot
```

**2. TLS is real and the headers are there.**

```sh
curl -sI https://$DPSBUDDY_DOMAIN | grep -iE 'strict-transport|content-security|x-content-type|referrer-policy'
curl -sI http://$DPSBUDDY_DOMAIN | head -1   # expect a 301 to https
```

Expect `Strict-Transport-Security: max-age=31536000; includeSubDomains`, a `Content-Security-Policy`,
`X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`. Expect **no** `Server` and no
`X-Powered-By` header: identity masking is done at both ends, by the `Caddyfile` and by
`app.disable("x-powered-by")` (`apps/web/server.ts:42`).

**3. Only the proxy is reachable, and the app is not.**

```sh
sudo ss -ltnp | grep -E ':(80|443|3000)'     # 3000 must be loopback only
curl -si http://127.0.0.1:3000/api/v1/ping | head -1
```

That last one should answer **403 `https_required`**, not `200` — a bare `curl` sends no
`X-Forwarded-Proto`, and in server mode the app refuses every request that does not arrive marked
`X-Forwarded-Proto: https`. That is the same rule the healthcheck in check 1 satisfies by sending the
header deliberately; this check proves that anything which does *not* send it gets nothing. If this
returns `200`, the transport filter is off and `AGENTFORGE_SERVER` is not set — stop here. From outside the VPC, port-scan and expect only 80 and 443:

```sh
nmap -Pn -p 1-65535 <public-ip>
```

**4. The app loads, and writes are gated correctly.** Open `https://$DPSBUDDY_DOMAIN` in a browser.
The shell should render. Then prove the CSRF and Origin rules are live from the shell on the server:

```sh
curl -si -X POST https://$DPSBUDDY_DOMAIN/api/v1/workspaces | head -1
```

Expect a **403**, not a 200 and not a 500 — a curl with no `Origin` and no CSRF token is exactly what
the check exists to reject. If you get `200`, `AGENTFORGE_SERVER` is not on and you should stop and
fix that before going further. If the browser itself cannot write (every action fails with
`403 origin_forbidden`), the usual cause is `AGENTFORGE_TRUSTED_ORIGINS` not matching the hostname you
typed, scheme and all.

**5. Sign-in and the gateway gate.** In server mode every `/api` call needs a portal session except
`/api/v1/auth/*`, `GET /api/v1/ping` (`packages/host/src/router.ts:196`) and `GET /api/v1/components`
(`:199`); the gate is applied at `packages/host/src/router.ts:397`. **There is no browser sign-in
screen yet**, so the browser path ends here for now and the API path is exercised against
`/api/v1/auth/*` directly.

Then paste the Toko Token gateway key into Settings and confirm the gateway gate goes green. On the
hosted build the gate **fails closed**: a deployment with no verified key shows the onboarding state
rather than silently letting requests through, which is the opposite of the desktop's
trust-on-first-run behaviour. A gate that stays red after a good key usually means outbound 443 to
`api.tokotokenai.com` is blocked by the security group.

**Finally, write the row.** `deploy.sh` prints it. Append it to
[`../../webapp-deploy/DEPLOY-LOG.md`](../../webapp-deploy/DEPLOY-LOG.md) **and** to the deploy log in
[`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md); the decision record is the one of record. A
deploy that is not in that table did not happen.

---

## 10. Backups

RPO is one hour. Two things first, or the cron will look installed and never actually run.

**Give cron a PATH that contains `tccli`.** `pip3 install --user tccli` in step 3 puts it in
`~/.local/bin`. Cron's default `PATH` is `/usr/bin:/bin`, so without this the fetch prints
`tccli: not found`, `BACKUP_KEY` comes out empty, and `backup.sh:29-33` refuses to run rather than
writing a plaintext archive — correct behaviour, silent failure. Confirm the path first:

```sh
command -v tccli                       # e.g. /home/ubuntu/.local/bin/tccli
```

**Create the log file and give it to the deploy user.** `/var/log` is `root`-owned, so a non-root
crontab cannot create `dpsbuddy-backup.log` and the error only lands in cron's local mail, which
nobody reads:

```sh
sudo touch /var/log/dpsbuddy-backup.log
sudo chown "$USER":"$USER" /var/log/dpsbuddy-backup.log
```

Then install the cron as the deploy user, `crontab -e`. The `PATH=` line must come before the job:

```cron
PATH=/home/ubuntu/.local/bin:/usr/local/bin:/usr/bin:/bin
# m h  dom mon dow  command
17 * * * * BACKUP_KEY="$(tccli ssm get-secret-value --region ap-jakarta --SecretName dpsbuddy/prod/backup-key --VersionStage SSMCurrent | python3 -c 'import json,sys;print(json.load(sys.stdin)["SecretString"],end="")')" /bin/sh /srv/dpsbuddy/webapp-deploy/scripts/backup.sh >> /var/log/dpsbuddy-backup.log 2>&1
```

Replace `/home/ubuntu` with whatever `command -v tccli` printed. Prove the cron environment works
before you trust it, rather than waiting until :17 past the hour:

```sh
env -i PATH=/home/ubuntu/.local/bin:/usr/bin:/bin sh -c 'tccli --version'
```

The passphrase is fetched with the instance role at each run and never lands in the crontab or on
disk. What `backup.sh` does, in order: a consistent SQLite snapshot via `VACUUM INTO` (WAL-safe, no
downtime), a tar of `/data` minus `components/`, `logs/` and `.master-key`, `openssl enc -aes-256-cbc
-pbkdf2 -iter 200000` **on this host before the bytes leave it**, a decrypt-and-list verification of
what it just wrote, and an upload to the COS backup bucket. It refuses to run with an empty
`BACKUP_KEY` rather than writing plaintext.

Run it once by hand first, with `BACKUP_KEY` exported, and watch it succeed end to end.

Also turn on **daily CBS snapshots of the data disk**, 7 kept. They are a second, coarser copy with a
24-hour RPO and they survive mistakes that corrupt `/data` itself.

Wire an alert for the backup job missing a run (spec `L3`), along with: disk over 80%, 5xx over 1% in
5 minutes, healthcheck failing three times, and certificate under 14 days.

**Drill it monthly.** An untested backup is a hypothesis. The procedure — a scratch CVM, never the
production box — is in [`../../webapp-deploy/README.md`](../../webapp-deploy/README.md) under
*Restore drill*, and the result goes in `DEPLOY-LOG.md`.

---

## 11. Updating and rolling back

**Update:**

```sh
cd /srv/dpsbuddy
sh webapp-deploy/scripts/deploy.sh
```

`git pull --ff-only`, rebuild, `up -d`, wait for health, print the log row. If the healthcheck does not
go green in five minutes the script exits non-zero and dumps the last 80 log lines.

**Roll back code** — a rebuild at an older sha. There is no image registry yet, so there is no
`docker pull <old-tag>` path:

```sh
git -C /srv/dpsbuddy checkout <previous-sha>
sh webapp-deploy/scripts/deploy.sh --no-pull
```

**Roll back data** — destructive, and it replaces everything in `/data`:

The `tccli` here is the same one the cron needs on its `PATH` (step 10); in an interactive shell it
is already there.

```sh
export BACKUP_KEY="$(tccli ssm get-secret-value --region ap-jakarta --SecretName dpsbuddy/prod/backup-key --VersionStage SSMCurrent | python3 -c 'import json,sys;print(json.load(sys.stdin)["SecretString"],end="")')"
sh webapp-deploy/scripts/restore.sh backups/dpsbuddy-data-<stamp>.tar.gz.enc
```

`restore.sh` checks the archive decrypts *before* deleting anything, stops both services, empties the
volume, unpacks, promotes the consistent snapshot over `agentforge.sqlite` (dropping the stale
`-wal`/`-shm` so they can never be replayed on top of it), and starts back up. It asks for
confirmation unless you pass `--yes`.

**A migration you cannot roll back.** Schema migrations run on boot from the committed
`packages/db/drizzle/` folder. Rolling the code back to a sha from before a migration does not undo
the migration. Take a backup before any deploy that carries one — which, from Phase 3 on, is most of
them.

`0015_tenants.sql` is the first one where that matters in practice. It adds the `tenants` table and
`organizations.tenant_id`, backfills every existing organization to the `local-tenant` row, and moves
organization-slug uniqueness from `organizations_slug_unique` to `(tenant_id, slug)`. It says so in
its own header: the runner is forward-only and has no `down`, and the SQLite build in the image
cannot drop a column at all (`packages/db/drizzle/0015_tenants.sql:12-13`). Recovering from a bad
0015 means restoring the data volume, so run `backup.sh` immediately before the deploy that first
carries it and keep that archive until the site has been up for a day:

```sh
cd /srv/dpsbuddy
sh webapp-deploy/scripts/backup.sh          # note the archive name it prints
sh webapp-deploy/scripts/deploy.sh
```

The change is additive and touches no content table, so an existing database opens with no re-seed.
On a first deploy to an empty volume there is nothing to back up and nothing to undo.

**If something is actively wrong**, take the site read-only first and diagnose second. Two commented
lines in the `Caddyfile` plus a proxy restart do it in about a second, and reads keep working. That
and the rest of the incident runbook — evidence preservation, wrap-key rotation, the 72-hour UU PDP
notification clock — are in [`../../webapp-deploy/README.md`](../../webapp-deploy/README.md) under
*Incident response*. Read it once now rather than at 03:00.

---

## 12. Phase 6: moving media to COS

> **Not yet. This section is a placeholder to fill in when Phase 6 lands.** Everything below describes
> intent, not something you can configure today. Nothing in `packages/host/src` talks to COS.

Today media, uploads and job outputs are files under the data dir: `media/<orgId>/…`, plus `edit/`,
`datasets/` and `legal/` scratch. They are on the CBS disk from step 4, they are in the hourly
backup tarball, and they are the reason that tarball stops being workable as the disk grows.

Phase 6 moves them behind a storage interface with a COS backend, keyed `tenants/<tenantId>/…`,
delivered through short-lived pre-signed URLs, with a per-tenant quota reported back to the app. When
it lands, this section gets:

- the bucket and lifecycle settings for `COS_MEDIA_BUCKET` (already reserved in `.env.example`);
- how to migrate the existing `media/` tree into the bucket without downtime;
- what changes in `backup.sh`, which currently tars everything;
- the per-tenant quota configuration.

The bucket from step 5 exists so that the CAM policy and the encryption settings are already right
when that day comes. Until then it stays empty.

---

## 13. Rough monthly cost

**These are estimates, not quotes.** Every figure is drawn from
[`web-data-placement-tencent.md`](web-data-placement-tencent.md) §4c, which took Jakarta list prices
off Tencent's public pricing pages (the CVM price table, the CBS and snapshot price page, the public
network fee page, the COS and CLS price tables) on **2026-09-18**. Tencent moves prices and renames
instance families; **re-check in the console's price calculator before ordering**, and treat anything
below as a planning figure only.

The shape this runbook builds is the first column.

| Item | This runbook (≈20 users) | 100 users | 200 users (ceiling) |
|---|---|---|---|
| CVM, monthly list price | `SA5.2XLARGE16` 8 vCPU / 16 GB — **$128** ($99 prepaid 1 month) | `SA5.8XLARGE64` — $512 ($394) | `SA4.16XLARGE128` — $1,152 ($887) |
| System disk 50 GB + data disk, Premium SSD | 250 GB — $13 | 550 GB — $28 | 1 TB + 50 GB — $53 |
| CBS snapshots, 7 daily kept | $8 | $20 | $40 |
| COS — backups now, media after Phase 6 | $2 | 700 GB — $17 | 2 TB — $50 |
| Outbound traffic at $0.12/GB | 50 GB — $6 | 500 GB — $60 | 2 TB — $240 |
| CLS logs | $5 | $15 | $30 |
| Secrets Manager + KMS — the one line with no list price | $5 | $5 | $5 |
| TencentDB for PostgreSQL | none — SQLite | $250–300 (Phase 3) | $500–600 |
| CLB | none — Caddy on the box | none | $17 |
| WAF Advanced, once paying tenants exist | none | optional $550 | $550 |
| **Total (list)** | **≈ $165/month** | **≈ $910–960** ($1,500 with WAF) | **≈ $2,100–2,200** ($2,750 with WAF) |

Every line above is sourced to `web-data-placement-tencent.md` §4c except Secrets Manager + KMS: the
placement doc says only "a few dollars, verify in the console" (`web-data-placement-tencent.md:86`),
so that $5 is a guess, not a read price. Check it in the console on the first bill.

Four things that move the bill more than the instance choice:

- **Bill by traffic, not by bandwidth.** 50 Mbps of fixed bandwidth is about $549/month in Jakarta;
  the same 500 GB of downloads billed by traffic is about $60. Switch to bandwidth billing only when
  sustained outbound passes roughly 4 TB/month.
- **The AMD families are cheaper for the same shape**, and nothing in the host is CPU-family
  specific.
- **Do not prepay yearly before Phase 3 proves the shape.** A year is roughly eight months of list
  price, which is only a saving if the machine is still the right machine.
- **The gateway bill is not in this table.** Model, image and video usage is billed by Toko Token and
  will dwarf the hosting bill at any real usage. That is the cost the subscription and the seats have
  to cover.

Not included: the domain, a Tencent SSL certificate (Caddy uses Let's Encrypt, which is free),
Anti-DDoS Basic (included), and the Singapore backup replica if you turn cross-region replication on.

---

## 14. Before anyone other than Kyo signs in

This runbook gets a server running. It does **not** make it safe to hand out. The before-traffic
acceptance list is security spec section 9, reproduced with its status in
[`../../webapp-deploy/README.md`](../../webapp-deploy/README.md) under *Before-traffic acceptance*.
Walk it row by row and sign it in `DEPLOY-LOG.md` with the sha that passed.

The rows this runbook covers directly: `N2` (security group, step 8), `N3` (TLS and HSTS, step 9),
`N5` (loopback bind, step 9), `I1`–`I4` (accounts and SSH, steps 2 and 5), `H1` (unattended upgrades,
step 2), `H2` (container hardening, already in `compose.yml`), `H4` (sha in the deploy log, step 9),
`S2` (wrap key from Secrets Manager, step 5), `S5` (disk and bucket encryption, steps 1 and 5),
`S6` (encrypted backups, step 10), `L5` (incident runbook read, step 11).

The rows it does not, and which are still open: `L2` and `L3` produce log lines but nothing ships them
to CLS or raises an alarm yet, and `L1` — no prompts, bodies, keys or tokens in any log line — is the
application logger's to prove, not the proxy's.

And the standing gaps that are nobody's configuration mistake: no browser sign-in screen, tenancy
landed only as far as lane C (no per-tenant files yet, no cross-tenant route sweep), no seat or plan enforcement, one SQLite file on one server, no image registry and no CI build, no
ffmpeg in the image, and dev dependencies shipping because `tsx` is the entrypoint. They are listed
with their owning phase in [`../../webapp-deploy/README.md`](../../webapp-deploy/README.md) under
*What is not done yet*.
