# Security specification: DPSBuddy hosted on Tencent Cloud

**Status:** spec, 2026-09-18. Every item is a requirement with a check. Rows marked **before traffic** must hold before the first user other than Kyo signs in; the rest are tied to a migration phase. Companion: [`web-data-placement-tencent.md`](web-data-placement-tencent.md), [`web-migration-plan.md`](web-migration-plan.md).

## 0. Threat model, in one paragraph

Many tenants share one host process and one database. The assets are tenant work (threads, documents, media), tenant gateway keys, and Kyo's operator gateway key. The attackers are: another tenant (cross-tenant read or write, resource exhaustion), an internet client (unauthenticated API use, CSRF, credential stuffing on the portal), and a compromised server (secrets on disk, backups). Prompt content is untrusted input that reaches tools; that stays the responsibility of the existing PII and tool sandboxes (`docs/internal/maps/pii-and-key-security.md`).

## 1. Network and edge

| # | Requirement | When | Check |
|---|---|---|---|
| N1 | One VPC; data services (Postgres, and nothing else) in a private subnet without public IP | Phase 3 | console |
| N2 | Security group on the CVM: inbound 443 and 80 (redirect only) from anywhere; 22 only from Kyo's IP allowlist or a bastion; nothing else. Outbound: 443 to any public host is required, because Research, Market, Knowledge and media download fetch arbitrary public HTTPS through `packages/core/src/security/safe-fetch.ts` (`fetchPublicHttps`, which already blocks private ranges and non-HTTPS); deny everything that is not 443 or DNS | **before traffic** | `webapp-deploy/README.md` lists the rules; verify with a port scan from outside |
| N3 | TLS 1.2+ only, HSTS with `max-age` 1 year, certificate auto-renewed (Caddy today, CLB later) | **before traffic** | `curl -I`, SSL Labs |
| N4 | Anti-DDoS Basic (included) on; WAF in front of `/api` once paying tenants exist | Phase 5 | console |
| N5 | The host binds loopback and only the proxy is reachable, until a `BIND_HOST` setting exists (migration plan Phase 1) | **before traffic** | `ss -ltnp` on the CVM |

## 2. Identity and access to the cloud account

| # | Requirement | When | Check |
|---|---|---|---|
| I1 | Root account: MFA on, no API keys, used only for billing | **before traffic** | CAM console |
| I2 | Kyo works from a CAM sub-account with MFA; deploy automation uses a CAM role bound to the CVM (instance role) for COS and SSM access, not static keys | **before traffic** | no `SecretId` in any file on the CVM |
| I3 | Least privilege policies: the CVM role may `PutObject`/`GetObject` on the two buckets and `GetSecretValue` on the one secret, nothing else | **before traffic** | policy JSON reviewed |
| I4 | SSH: key only, password auth off, root login off, `fail2ban` on | **before traffic** | `sshd -T` |

## 3. Host and container

| # | Requirement | When | Check |
|---|---|---|---|
| H1 | Ubuntu LTS with unattended security updates; reboot window weekly | **before traffic** | `unattended-upgrades` status |
| H2 | Container runs as the non-root `node` user, read-only root filesystem, `/data` the only writable mount, `no-new-privileges` | **before traffic** | `compose.yml` |
| H3 | `/data` mounted `nodev`, and `noexec`. Phase 7 removed the blocker in code: in server mode the host refuses to load a component from a root inside `AGENTFORGE_DATA_DIR` at all (`packages/host/src/components/paths.ts` `downloadedComponentsAllowed`), the image sets `AGENTFORGE_COMPONENTS_DIR=/opt/agentforge/components` on its own volume, and the build fails if the image does not carry `anydoc`. What remains is the operator action: add `noexec` to the `/data` mount and confirm a `.docx` still converts (`web-phase7-component-installer.md` §6 live test 13) | Phase 7, code done; mount owed | `mount` |
| H4 | Images are built from a pinned commit sha and tagged with it; the running sha is recorded in `webapp-deploy/DEPLOY-LOG.md` | **before traffic** | log row per deploy |
| H5 | Dependency audit in CI on the tree the image actually ships. The image keeps devDependencies because `tsx` is the production entrypoint, so audit without `--prod` until the server is bundled; rebuild on high or critical | Phase 1 | CI |

## 4. Application: requests

| # | Requirement | When | Where in code |
|---|---|---|---|
| A1 | Mutating `/api` accepts only a configured trusted-origin allowlist, and a **missing Origin is rejected** on the web rule (`isAllowedWebOrigin`, `packages/host/src/local-request.ts:99-105`, returns false for an absent Origin at `:101-103`). The Host half is `isAllowedWebHostHeader` (`:113-119`), which accepts the configured public host, so the proxy no longer has to rewrite `Host` to `127.0.0.1`. Both run only under `isServerMode()`; the loopback rule (`isAllowedMutatingApiRequest`, `:80-89`) is unchanged for desktop and webdev | **before traffic** (landed, [PR #56](https://github.com/Kyoo032/agentforge/pull/56) `6ae177a`) | `local-request.ts`, wired at `http-adapter.ts:529` (web) and `:536` (loopback) |
| A2 | CSRF: session cookie `SameSite=Lax`, `Secure`, `HttpOnly` (`__Host-agentforge_session`, `auth/session.ts:30`, attributes at `auth/routes.ts:145`), plus a double-submit token on every non-GET (`packages/host/src/csrf.ts`; its own cookie is deliberately **not** `HttpOnly` so the renderer can echo it in `x-agentforge-csrf`). The token is bare randomness, not bound to the session — `csrf.ts:14-17` records that binding as a follow-up, carried in the Phase 3 spec § 5 (`auth` row) | Phase 1 (landed, [PR #56](https://github.com/Kyoo032/agentforge/pull/56) `6ae177a`) | `http-adapter.ts`, `csrf.ts` |
| A3 | Security headers from the proxy: `Content-Security-Policy` (self, gateway host for fetch, no inline scripts beyond Vite's hashed ones), `X-Content-Type-Options`, `Referrer-Policy: same-origin`, `Permissions-Policy` | **before traffic** | `webapp-deploy/Caddyfile` |
| A4 | Rate limits per session and per IP on `/api` (writes tighter than reads) and on the portal login endpoints; 429 with `Retry-After` | Phase 2 | new middleware in the HTTP adapter |
| A5 | Request body limits: JSON 1 MB, uploads per plan (Personal 25 MB, Enterprise 250 MB), multipart streamed to storage, never buffered whole | Phase 6 | `http-adapter.ts`, media handlers |
| A6 | Every 4xx/5xx returns the existing `{code, message}` envelope; no stack traces, no file paths, no SQL | **before traffic** | error middleware |
| A7 | Uploads: MIME is sniffed from magic bytes, not taken from the client's `file.type` — `saveMedia` still reads `file.type` today (`packages/host/src/media.ts:67-75`), which is what this row asks to change; `/api/v1/media/:id/file` sends `Content-Type` from the stored sniffed type, `X-Content-Type-Options: nosniff`, and `Content-Disposition: attachment` for anything that is not an image or video | Phase 6 | `media.ts`, media handler |
| A8 | Outbound fetches from modes and knowledge stay behind `fetchPublicHttps` (`packages/core/src/security/safe-fetch.ts`): HTTPS only, public ranges only, redirects re-checked, response size and time capped; no handler may call `fetch` on a user-supplied URL directly | ongoing | `safe-fetch.ts`, a test that greps for raw `fetch(` in handlers |
| A9 | **SQL injection.** No request value is ever concatenated into SQL: drizzle placeholders everywhere; FTS5 `MATCH` built only from quoted phrase tokens (`packages/host/src/knowledge-text.ts`, `ftsSourceFilter`); `LIKE` inputs escaped with an explicit `ESCAPE`; no sort column or identifier from a request. The dataset SQL runner is the one place user SQL executes by design: in-memory worker, `query_only=1` before any statement, deny-list guard (`sql-guard.ts`: writes, `ATTACH`, `PRAGMA`, `load_extension`, `dbstat`, `sqlite_dbpage`, multi-statement, also inside double-quoted identifiers; unterminated quotes and control characters rejected), a rolling per-runner time budget (`AGENTFORGE_SQL_BUDGET_MS`, default 10 s per 60 s, then 429) against CTE bombs, row/cell/time caps, and a worker env with no data dir and no secret (`sql-runner.ts` `workerEnv`). Audited 2026-09-18, 23 sites, all safe or fixed | **before traffic** (landed) | tests: `knowledge-text.test.ts`, `sql-guard.test.ts`, `sql-worker-source.test.ts` |
| A10 | **XSS and cookie theft.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `srcdoc` or unsandboxed iframe in `apps/web` (guard test `apps/web/lib/html-sinks.test.ts` fails the build if one appears); markdown is a hand-written AST with no raw-HTML node; model links pass `safeLinkHref` (http(s) + hostname only) and carry `rel="noopener noreferrer"`; model images are host media or `data:image/(png|jpeg|webp|gif)` only; artifact files are served with a mime allowlist, `Content-Disposition: attachment`, `nosniff` and `Content-Security-Policy: sandbox` (`handlers/artifacts.ts`); the session cookie is `__Host-agentforge_session` (HttpOnly, Secure, SameSite=Lax) on the server; nothing secret in Web Storage. Audited 2026-09-18, 23 sinks | **before traffic** (landed) | tests: `xss-render.test.tsx`, `html-sinks.test.ts`, `artifacts.test.ts` |
| A11 | **HTTPS only, server masked.** In server mode every request must carry `X-Forwarded-Proto: https` from the proxy (else 403 `https_required`); trusted origins are https-only; the proxy redirects http to https, strips `Server` and `X-Powered-By`, sends HSTS `max-age=31536000; includeSubDomains`; Express `x-powered-by` is off; 5xx bodies are the fixed `internal_error` envelope with no path, SQL or module name (`http-adapter.ts` `maskServerError`) | **before traffic** (landed) | tests: `http-adapter.test.ts`, `bind-host.test.ts`; `curl -I` on the hosted URL |
| A12 | **HTTP filtering** before Origin, CSRF and session, on every request in server mode: method allowlist (GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS; else 405), path filter (control chars, `..`, backslash, encoded slash, > 2048 chars, > 32 query params: 400 `invalid_path`), per-header size cap, `Content-Length` above the body cap refused before reading (413), `Content-Type` allowlist for bodies (json, multipart, text/plain; else 415), every refusal logged as `request_filtered` without the body (`local-request.ts` `filterHttpRequest`) | **before traffic** (landed) | tests: `local-request.test.ts`, `http-adapter.test.ts` |
| A13 | **Rate limits** (`rate-limit.ts`): token buckets per client IP (600 rpm, burst 100), per session cookie hash (300 rpm, burst 50), and per IP on `/api/v1/auth/*` (30 rpm, burst 10); 429 `rate_limited` with `Retry-After`; LRU-bounded maps; client IP from the proxy's own `X-Forwarded-For` hop only in server mode. Per-tenant caps stay Phase 5 | **before traffic** (landed) | tests: `rate-limit.test.ts` |

## 5. Application: identity, tenancy, plans

| # | Requirement | When | Where in code |
|---|---|---|---|
| T1 | Login is the portal browser session only (`docs/internal/portal/`); session token stored server-side, cookie carries an opaque id; idle timeout 12 h, absolute 30 days; sign-out revokes server-side | Phase 2 | new `session` handler |
| T2 | `getTenant()` derives the tenant from the session, never from a client-supplied id; every by-id handler filters by tenant (102 call sites, `packages/host/src/tenant.ts:38`) | Phase 3 | `tenant.ts` and all handlers |
| T3 | A tenancy test suite: for every route, a request from tenant A with tenant B's ids returns 404, never data | Phase 3 | `packages/host/src/**/tenancy.test.ts` |
| T4 | **Landed ([PR #56](https://github.com/Kyoo032/agentforge/pull/56) `6ae177a`).** The gate fails closed on the hosted build: a missing or malformed gate answers `onboarding` when the page carries the hosted marker or is Electron (`apps/web/lib/gateway-gate.ts:97`), and in server mode the host no longer trusts an unverified key on first run (`packages/host/src/gateway-gate.ts:276`, decided at `:296`; the reasoning is in the comment at `:267`) | **before traffic** | both files |
| T5 | Plan check runs inside `requireGatewayAllowed` (`packages/host/src/gateway-gate.ts:436`, the one choke point): Personal `active` with allowance left, or Enterprise `active` with a seat for this user; otherwise 403 with the reason code from the portal list | Phase 5 | `gateway-gate.ts` |
| T6 | Billing webhooks are verified by signature and replay-protected (event id stored); they only flip the tenant plan row, never grant usage directly | Phase 5 | new `billing` handler |
| T7 | Card data never touches the server: hosted checkout pages of the provider only | Phase 5 | design |
| T8 | **Landed ([PR #56](https://github.com/Kyoo032/agentforge/pull/56) `6ae177a`).** Both reset scopes answer `403 reset_disabled` in server mode (`packages/host/src/handlers/settings.ts:300`, gated at `:361`); off the server it still wipes the whole data dir from `HOST_RESET_ENTRIES` (`:274`, queued at `:342`). Per-tenant reset is Phase 3 | **before traffic** | `settings.ts` |
| T9 | Per-tenant caps on concurrent ffmpeg children, SQL workers and runs. The **global** cap landed ([PR #56](https://github.com/Kyoo032/agentforge/pull/56) `6ae177a`) in `packages/host/src/concurrency.ts` (`AGENTFORGE_MAX_FFMPEG`, `AGENTFORGE_MAX_SQL_WORKERS`, `AGENTFORGE_JOB_QUEUE_TIMEOUT_MS`, overflow answers `429 too_many_jobs`); `packages/host/src/child-processes.ts` still only tracks children to kill them on quit, and `sql-runner.ts` caps rows, time and cell size per query, not how many run at once. Per-tenant is Phase 5 | Phase 5 (global cap landed) | those files |

## 6. Secrets and encryption

| # | Requirement | When | Where |
|---|---|---|---|
| S1 | **Landed 2026-09-18 (PR #56).** `AGENTFORGE_SECRETS_KEY` is mandatory on the server and must carry at least 32 bytes of entropy; the `.master-key` file fallback throws instead of self-creating. The gate is `isServerMode` (`AGENTFORGE_SERVER=1`), **not** `NODE_ENV` — `getLocalVaultKey` at `packages/db/src/vault-key.ts:123-134`, messages at `:46-56` | **before traffic** (Phase 1) | `vault-key.ts` |
| S2 | The wrap key lives in Secrets Manager; the deploy script fetches it with the instance role and passes it as env to the container; it is never in `.env` on disk, in the image, or in git | **before traffic** | `webapp-deploy/scripts/deploy.sh` |
| S3 | Tenant gateway keys and the operator key stay AES-256-GCM envelopes (`packages/core/src/crypto/envelope.ts`); the raw key is never returned to the renderer (already true, keep the test) | ongoing | `settings-store.ts` tests |
| S4 | Key rotation procedure: new wrap key in SSM, re-wrap every envelope, swap, delete old; documented and drilled before Phase 5 | Phase 4 | runbook in `webapp-deploy/README.md` |
| S5 | Encryption at rest: CBS disk encryption on; COS SSE-KMS on both buckets; TencentDB storage encryption on | **before traffic** for CBS; with each service | console |
| S6 | Backups are encrypted before upload (`age` or `openssl enc` with a key from SSM) so a bucket leak is not a data leak | **before traffic** | `backup.sh` |

## 7. Logging, monitoring, response

| # | Requirement | When | Where |
|---|---|---|---|
| L1 | Logs never contain prompts, message bodies, keys, tokens, or full request bodies; There is no central host logger today: 70 raw `console.*` calls in `packages/host/src`. Before traffic, route them through one logger that applies `redactSecrets` (`packages/core/src/security/redact.ts:13`) and adds tenant id and request id as fields | **before traffic** | new `packages/host/src/log.ts` |
| L2 | Access logs from the proxy with IP, path, status, latency; 30-day retention in CLS | **before traffic** | Caddy, CLS |
| L3 | Alerts: disk > 80 %, 5xx rate > 1 % over 5 min, health check failing 3 times, backup job missed, certificate < 14 days | **before traffic** | Cloud Monitor |
| L4 | Audit trail for admin actions (seat changes, plan changes, tenant deletion) as append-only rows | Phase 5 | new `audit` table |
| L5 | Incident response: one page in `webapp-deploy/README.md` with who to call, how to rotate keys (S4), how to take the site read-only (proxy returns 503 for non-GET), and how to notify affected tenants within 72 h as UU PDP expects | **before traffic** | README |

## 8. Compliance notes for Indonesia

- Personal data stays in Jakarta; the Singapore copy is an encrypted backup only. Say so in the privacy notice.
- Data subject rights: export and deletion per tenant within 30 days (placement doc §5).
- A data processing agreement with Tencent Cloud (their standard DPA) on file.
- Payments through a licensed provider (Xendit for Indonesia); DPSBuddy never stores card numbers.

## 9. Acceptance before the first external user

All rows marked **before traffic**: N2, N3, N5, I1-I4, H1, H2, H4, A1, A3, A6, A9-A13, T4, T8, T9 (global cap), S1, S2, S5, S6, L1-L3, L5. Kyo signs the list in `webapp-deploy/DEPLOY-LOG.md` with the sha that passed.
