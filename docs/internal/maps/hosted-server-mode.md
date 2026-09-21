# Map — Hosted server mode and the transport security pass

Last verified: 2026-09-20 at c204e5e; citations re-anchored at e37b3a1

## Overview

The hosted, multi-user web deployment and the rules that only exist there. One environment variable — `AGENTFORGE_SERVER=1` — turns on a different transport contract: HTTPS proof from the proxy, a configured Origin/Host allowlist instead of the loopback rule, a double-submit CSRF token, request filtering and rate limiting on every path, masked 5xx bodies, global job caps, a mandatory wrap key, a gate that fails closed and a "Start over" that refuses. Everything on this page landed in one commit, `6ae177a` (PR #56).

What this page is **not**: the desktop or webdev path. Every rule below is a branch on one flag, and with the flag off the code takes the path it took before the commit. It is also not the tenancy story — the hosted server is single-tenant today and per-tenant scoping, per-tenant caps and a scoped "Start over" are Phase 3 and Phase 5 (`packages/host/src/concurrency.ts:16`, `packages/host/src/handlers/settings.ts:338-343`).

## How it works

### 1. The one switch

`isServerMode(env = process.env)` (`packages/core/src/server-mode.ts:12-15`) is the whole of it: `AGENTFORGE_SERVER` trimmed and lower-cased, true for `1` or `true`, false for anything else including unset. `WEBDEV_DEFAULT_PORT = "3000"` (`:10`) is the only other constant in the file.

`trustedOrigins(env)` (`packages/core/src/server-mode.ts:52-63`) answers the allowlist:

| Input | Result | Line |
|---|---|---|
| `AGENTFORGE_TRUSTED_ORIGINS` set and non-blank | that comma list, parsed | `:25-27` |
| unset, **not** server mode | `http://127.0.0.1:${PORT ?? 3000}` and the `localhost` spelling of it | `:61-62` |
| unset, **server mode** | `[]` — an unconfigured server trusts no browser at all | `:28-30` |

`parseOriginList(raw, httpsOnly)` (`:46-55`) normalises each entry and, in server mode only, **drops any `http:` entry** (`:80`, `HTTPS_SCHEME` at `:66`). So a cleartext origin cannot be put on the hosted allowlist by configuration mistake. Off server mode nothing is filtered, because webdev and the desktop *are* http loopback.

`normaliseOrigin(value)` (`:58-73`) is the comparison unit everywhere below: `new URL(value).origin` lower-cased, `null` for anything that is not an `http:`/`https:` URL.

### 2. The two mutating rules — loopback, and the web allowlist

`mutatingRejection` (`packages/host/src/http-adapter.ts:539-568`) is the one place the two are chosen between, on `csrfMode.secure` — which *is* `serverMode` (`:526`, set at `:387`).

**Off server mode (the rule that was always there).** `isAllowedMutatingApiRequest(origin)` (`packages/host/src/local-request.ts:80-89`): a **missing Origin is allowed**, because curl, native tooling and same-origin GETs honestly have none; a present Origin must resolve to `localhost`, `127.0.0.1` or `::1` (`isLocalRequestUrl`, `:32-37` → `isLocalRequestHost`, `:20-29`). The `referer` argument is accepted and ignored (`:82`) — a remote Origin is never rescued by a local Referer. `isLoopbackHostHeader(host)` (`:66-73`) is the second half, and a **missing Host is rejected** (reasoning in the comment at `:56-65`). Failure is `403 { code: "forbidden", message: "Local requests only" }` (`http-adapter.ts:536-538`, `:26`).

**In server mode (the hosted rule).** Both halves are checked against `trustedOrigins()` (`http-adapter.ts:527-531`):

- `isAllowedWebOrigin(origin, allowlist)` (`local-request.ts:99-105`) — a **missing Origin is now rejected** (`:101-103`), and the match is on the whole normalised `scheme://host[:port]`, so a different scheme or port is a different origin. An empty allowlist matches nothing.
- `isAllowedWebHostHeader(host, allowlist)` (`:113-119`) — the public host the proxy forwards. `allowedHostHeaders` (`:123-137`) builds the accepted set from the allowlist's origins and additionally accepts the explicit default port (`app.example.com:443` for an https origin, `DEFAULT_PORTS` at `:121`).

Either failing is `403 { code: "origin_forbidden", message: "Origin is not allowed to call this server" }` (`http-adapter.ts:529-531`, `:28`).

Both rules then share the transport-header requirement on the destructive routes: `TRANSPORT_REQUIRED_PATHS = { "/api/v1/settings/reset" }` (`:24`) must carry a non-blank `x-agentforge-transport` (`:22`, checked at `:540-542`), because a cross-site HTML form can POST but cannot set a custom header.

### 3. The double-submit CSRF token

`packages/host/src/csrf.ts`. Two cookie names, one token: `__Host-agentforge_csrf` on the hosted HTTPS server (`:21`) and plain `agentforge_csrf` on http webdev and the desktop (`:24`), because a browser silently drops a `__Host-` cookie sent over plain http. The name and the `Secure` attribute are picked together by the same `CsrfMode.secure` flag (`csrfCookieName`, `:57-59`; `csrfSetCookie`, `:74-77`), which is why they cannot be separated. The echoed header is `x-agentforge-csrf` (`:27`).

- Minted: `randomBytes(32).toString("base64url")` (`mintCsrfToken`, `:52-54`, `TOKEN_BYTES` at `:30`).
- Set: `Path=/; SameSite=Lax`, plus `Secure` in server mode; **no `HttpOnly`** — the renderer has to read it — and no `Domain` (`:74-77`).
- Checked: `checkCsrfToken(cookies, headerToken, mode)` (`:84-101`) reads this mode's cookie only, refuses `csrf_missing` when either side is blank (`:94-96`), and otherwise compares with `timingSafeEqual` behind a length check (`equalsInConstantTime`, `:104-108`) so a mismatch is `csrf_invalid` (`:97-99`). Neither answer says which side was wrong.

Where the cookie is minted: the adapter, on any `/api` **GET** that arrived without one, in **every** mode (`http-adapter.ts:431-432`). Only server mode enforces it (`mutatingRejection`, `:532-535`), so the renderer's echo path is exercised on webdev while webdev behaviour is unchanged.

Where the renderer sends it: `apps/web/lib/api-client.ts`. `withMutatingHeaders` (`:153-165`) leaves GET/HEAD/OPTIONS alone (`:155-157`, `SAFE_METHODS` at `:77`), stamps `x-agentforge-transport: web` (`:159`, `:83`), then asks `csrfTokenForMutation` (`:137-151`). That reads the jar — prefixed name first, plain name second (`readCsrfCookie`, `:119-125`) — and, when it is empty, first fires `GET /api/v1/ping` with the caller's own credentials to fill it (`:145-150`, `CSRF_PRIME_PATH` at `:100`; the route is `router.ts:159`). If that prime fails the call is sent without the header anyway and the host answers `csrf_missing`, rather than the client inventing an error (`:133-135`). `apiFetch` uses this only on the browser branch; the Electron branch goes through IPC and never sees a cookie (`:167-183`).

### 4. The adapter, in the order it actually runs

`handleNodeRequest(req, res)` (`packages/host/src/http-adapter.ts:376-495`), mounted as the **first** Express middleware (`apps/web/server.ts:45-51`) — above `express.static` and the vite middlewares, which is what puts the transport controls in front of pages and assets as well as `/api`.

1. `pathnameOf` → raw path and query (`:368`, `:103-111`).
2. `isApiPath` is tested on the **raw** path (`:372`); normalising only removes slashes, so it can never turn a non-`/api` path into an `/api` one (comment `:370-371`).
3. `serverMode = isServerMode()` (`:374`), read per request, not at module load.
4. **Off server mode, a non-`/api` request returns `false` immediately** (`:377-379`) — no parsing, no bucket, no log line, exactly the early return the desktop and webdev always saw.
5. `IDENTITY_HEADERS = ["X-Powered-By", "Server"]` are removed from the response (`:40`, `:380-382`). This is the floor under `app.disable("x-powered-by")` in `apps/web/server.ts:42`, which is the real fix — Express stamps the header from its own init middleware before this adapter is reached — and under Caddy's `-Server` / `-X-Powered-By` (`webapp-deploy/Caddyfile:60-66`).
6. `normaliseApiPath` (`:383`, defined `:120-122`): duplicate slashes collapsed, trailing slashes stripped, so a guard cannot be walked past with `/api/v1/settings/reset/`.
7. `clientIp` (`:388-392`) — see rate limiting.
8. **Server mode only:** `transportRejection` (`:407-413` → `:316-339`), for **every** request the adapter is handed, not just `/api`:
   - `rejectPlaintext(req)` (`:306-309`): `X-Forwarded-Proto` must have `https` as its first hop, else `403 https_required` with the fixed text "This server accepts HTTPS requests only." (`HTTPS_REQUIRED`, `:58-62`). The proxy stamps that header on everything it forwards, so the only caller that can lack it is something already inside the box talking to the loopback port.
   - `filterHttpRequest({ method, url, headers, maxBodyBytes: MAX_BODY_BYTES })` (`:325`) — section 5.
   - `checkRequestRate({ serverMode: true, path, ip, sessionKey })` (`:329`), with the session key hashed off the mode's session cookie (`:408`; `sessionCookieName` at `packages/host/src/auth/session.ts:36-38`).
   Any rejection goes through `respondRejection` (`:281-299`): the `{error:{code,message}}` envelope, `X-Content-Type-Options: nosniff`, `Retry-After` when there is one, and — **in server mode only** — one `log.warn("request_filtered", …)` line.
9. Non-`/api` requests that survived fall through to the web server (`:415-417`).
10. `SAFE_METHODS` (GET/HEAD/OPTIONS, `:18`) skip `mutatingRejection`; everything else runs it, and any rejection is answered `403` whatever the code (`:423-428`).
11. CSRF cookie minted if needed (`:431-432`).
12. Body read (`:434-445`): `MAX_BODY_BYTES = 26 * 1024 * 1024` enforced on the bytes actually read (`:30`, `:134-137`) → `413 payload_too_large`; a JSON parse failure → `400 invalid_json` (`:440-443`). Multipart is parsed by hand (`:161-194`).
13. An abort controller wired to `res.on("close")` so a client that walks away cancels the run (`:449-454`).
14. The `HostRequest` is built (`:455-472`). Its `workspaceId` is `cookies[WORKSPACE_COOKIE] || readSelectedWorkspaceId() || null` (`:470`) — `WORKSPACE_COOKIE = "agentforge_workspace"` (`packages/core/src/local-owner.ts:14`, re-exported `packages/host/src/workspace.ts:6`). That cookie is a per-request desk selection and is never promoted to `workspace-id.txt`; the handler-set copy is `SameSite=Strict; HttpOnly` by the serialiser's defaults (`http-adapter.ts:201-210`, `packages/host/src/workspace.ts:43-45`).
15. `dispatchMasked(request, context)` (`:473` → `:484-504`) calls `dispatch` and runs the result through `maskServerError`. Its `catch` is the belt to the router's brace: an exception on the way in or out would otherwise reach Express and be answered with its default HTML error page and stack. In server mode it becomes a `500 internal_error` plus one `log.error("request_failed", …)` line (`:491-502`); off server mode it is rethrown (`:488-490`).

`maskServerError(result, serverMode)` (`:347-357`): only a **json** result with `status >= 500` is touched (`:348`). The reason code survives if it looks like one — `/^[a-z0-9_]+$/` (`:46`, `reasonCodeOf` at `:359-363`) — and everything else is replaced by `INTERNAL_ERROR_MESSAGE = "The server could not complete this request."` (`:43`). 4xx bodies are untouched: those are this repo's own honest messages, not a driver's.

The hosted session gate sits behind all of this, inside `dispatch` (`packages/host/src/router.ts:429-442`, `gate` at `:317-345`): in server mode **every** `/api` call needs a verified session whatever the method, except `/api/v1/auth/*` and `GET /api/v1/ping` / `GET /api/v1/components` (`packages/host/src/auth/routes.ts:39`, `:44`, `:94-99`). It is answered before the route table is consulted, so an unauthenticated caller learns nothing about which paths exist (`router.ts:341-344`).

### 5. HTTP request filtering

`packages/host/src/local-request.ts:139-320`. Pure predicates over the request line and headers — no body is read and nothing is logged there; the caller turns a rejection into the envelope.

`filterHttpRequest` (`:229-234`) runs cheapest first: method → request target → header sizes → body declaration.

| Check | Rule | Refusal | Line |
|---|---|---|---|
| Method | `ALLOWED_METHODS` = GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS | `405 method_not_allowed` | `:149-157`, `:190-194` |
| Control chars | any byte `< 0x20` or `0x7f` anywhere in the target | `400 invalid_path` | `:237-245`, `:253-255` |
| Path length | `MAX_REQUEST_PATH_LENGTH = 2048` | `400 invalid_path` | `:160`, `:258` |
| Separators | a literal `\`, or `%00` / `%2f` / `%5c` | `400 invalid_path` | `:248`, `:258` |
| Traversal | any segment that is `..` after `%2e` is decoded | `400 invalid_path` | `:250`, `:261-263`, `:271-273` |
| Query count | `MAX_QUERY_PARAMS = 32`, counted by splitting on `&` | `400 too_many_query_params` | `:163`, `:264-267` |
| Header size | `MAX_HEADER_BYTES = 8 * 1024`, name **plus** value, per header value | `431 header_too_large` | `:166`, `:275-287` |
| Declared length | `Content-Length` above the cap, refused before a byte is read | `413 payload_too_large` | `:297-300` |
| Media type | `ALLOWED_BODY_CONTENT_TYPES` = `application/json`, `multipart/form-data`, `text/plain` | `415 unsupported_media_type` | `:169`, `:304-311` |

`MAX_BODY_BYTES` is **not** in this file — the cap is passed in as `maxBodyBytes` (`:187`, `:298`) and the value lives at `packages/host/src/http-adapter.ts:43`.

The media-type check deliberately excludes `application/x-www-form-urlencoded`: that is the cross-site form shape, and it is refused on a mutating request even when the sender declared no length (`:289-295`, `:304-311`). GET/HEAD/OPTIONS are exempt from the media-type check entirely (`BODYLESS_METHODS`, `:172`, `:301-303`).

Every rejection message is fixed text that never echoes any part of the request (`HttpFilterRejection.message`, `:177-178`), so a refusal cannot be turned into a reflector.

### 6. Rate limiting

`packages/host/src/rate-limit.ts`. Token buckets in memory, three of them, **server mode only** (`checkRequestRate`, `:231-234`).

| Bucket | Keyed on | Default rpm / burst | Env override |
|---|---|---|---|
| `ip` | client IP | 600 / 100 | `AGENTFORGE_RATE_IP_RPM` (`:30`) |
| `auth` | client IP, only for paths under `/api/v1/auth/` | 30 / 10 | `AGENTFORGE_RATE_AUTH_RPM` (`:32`) |
| `session` | SHA-256 of the session cookie, first 32 hex chars | 300 / 50 | `AGENTFORGE_RATE_SESSION_RPM` (`:31`) |

Defaults at `:23-28`; `AUTH_PATH_PREFIX` at `:38`; `sessionRateKey` at `:147-153` (`SESSION_KEY_HEX_LENGTH = 32`, `:41`) — a session cookie never becomes a map key in the clear. `isAuthPath` at `:155-157`.

They are checked in the order ip → auth → session (`:237-241`), and the comment there says why: the tight auth bucket is checked **after** the general IP one so an auth flood is reported as scope `auth`. A bucket whose key is `null` is skipped (`:242-245`), so an unauthenticated request spends no session token.

`createRateLimiter` (`:74-100`) refills continuously at `rpm / 60000` tokens per ms and caps at `burst` (`:75-76`, `:86`). **Insertion order is the LRU order** — a hit deletes and re-sets the key, so the first entry the iterator yields is the least recently used (`:77-79`, `:88-94`), and `evictOldest` (`:107-115`) trims to `MAX_RATE_KEYS = 50_000` (`:35`). That is the bound that stops an attacker who rotates the key (a fresh IP or cookie per request) from turning the limiter itself into the leak. Note the eviction runs only on the allowed branch (`:95`); a refused request re-sets its own bucket and returns before it (`:90-93`).

A refusal is `429 { code: "rate_limited", message: "Too many requests. Please slow down and try again." }` (`:20-21`) with `Retry-After` in whole seconds, rounded up and never below 1 (`retryAfter`, `:102-105`; header written at `http-adapter.ts:294-296`).

`clientIp` (`:136-144`) reads **the last `X-Forwarded-For` hop**, and only in server mode; off server mode the header is ignored entirely and the socket address is the only answer (`:141`). Last, not first, because the header is a client-to-proxy chain a caller may seed: an appending proxy leaves the forged value first and the address it saw last, so keying on the first hop would let one machine mint a fresh bucket per request. This holds exactly as long as the proxy in front is the only thing that can reach the app port and is the one setting the header — written out at `:126-134` and mirrored in `webapp-deploy/Caddyfile:90-113`, which also says an extra appending hop in front must be declared there **and** revisited here.

`rateLimitConfig` (`:165-171`) reads the three env vars through `bucketConfig` (`:178-182`): junk falls back to the default rather than switching the limiter off, an explicit non-positive number *does* switch it off (`perMs <= 0` → always allowed, `:82-84`), and burst is clamped to `max(1, min(defaultBurst, rpm || defaultBurst))`. The limiters are built lazily and cached in a module-level `limiters` (`:191-205`), rebuilt only when the resolved config changes (`sameConfig`, `:207-211`); `resetRateLimiters()` (`:214-216`) exists for tests and nothing in the server calls it.

### 7. The bind host

`resolveBindHost(env)` (`apps/web/lib/bind-host.ts:15-26`), called once at boot (`apps/web/server.ts:114`). No `BIND_HOST` → `127.0.0.1` (`LOOPBACK_BIND_HOST`, `:11`). A loopback name (`127.0.0.1`, `localhost`, `::1`, `:13`) → that name. Anything else → allowed **only** in server mode, and otherwise a thrown `Error` naming the fix (`:20-25`). So a local run cannot go LAN-wide by an accidental env var; it dies loudly at boot instead.

`apps/web/server.ts:42` disables `x-powered-by` at the app, above the first `app.use`. `apps/web/server.ts:25` computes `hosted = isServerMode(process.env)` once and uses it to stamp the hosted marker meta tag into the served `index.html` (`:58`, `:62-68`, `:92-106`), which is how the renderer learns it is on the hosted build (`apps/web/lib/hosted-build.ts:55-57`, `injectHostedMarker` at `:65-76`).

### 8. Concurrency caps

`packages/host/src/concurrency.ts`. A limiter is a counting semaphore with a bounded, timed waiting room: up to `max` jobs run, up to `max * QUEUE_FACTOR` wait, anything past that is refused now rather than queued into a timeout (`createLimiter`, `:122-209`; `QUEUE_FACTOR = 4`, `:25`).

| Pool | Cap env | Default | Wired at |
|---|---|---|---|
| ffmpeg / ffprobe children | `AGENTFORGE_MAX_FFMPEG` (`:27`) | 2 (`:29`) | `:288`, used by `packages/host/src/edit/ffmpeg/run.ts:73` |
| dataset SQL workers | `AGENTFORGE_MAX_SQL_WORKERS` (`:28`) | 4 (`:30`) | `:290`, used by `packages/host/src/sql-runner.ts:186`, `:278` |

`AGENTFORGE_JOB_QUEUE_TIMEOUT_MS` (`:33`, default 60 000, `:34`) is how long a job may sit in the waiting room before it is refused instead (`:162-167`); the timer is `unref`'d so a waiting room never keeps the process alive (`:169`). Both the full-waiting-room case (`:203-205`) and the timeout case answer the same `ApiError("too_many_jobs", …, 429)` (`:21-22`, `:92-98`) — it is the same answer, reached a minute later.

**Where the caps apply: server mode only.** `createJobLimiter` (`:241-246`) hands back `createUnboundedLimiter` (`:215-235`) off server mode — infinite `max`, zero queue limit, a counter and nothing else — so a desk exporting eight clips is not turned into a queue with a 429 on the ninth (`:10-14`). `withLimit` (`:279-285`) takes a free slot synchronously and calls `fn` before returning, so a caller that does synchronous work up front (`runFfmpeg` spawns and registers its child that way) behaves exactly as it did without a limiter; `signal` is consulted only by a job that has to wait. Caps are **global, not per tenant** — per-tenant caps are Phase 5 (`:16`).

Separately, the SQL runner keeps a rolling per-runner time budget, `AGENTFORGE_SQL_BUDGET_MS`, default 10 s per 60 s window (`packages/host/src/sql-runner.ts:39-42`).

### 9. The logger

`packages/host/src/log.ts`. One JSON object per line on one stream — `{ts, level, event, ...fields}` (`lineFor`, `:206-215`) — so a newline inside a value can never forge a second entry, and a hosted deployment can ship stdout/stderr straight into a log store. Level from `AGENTFORGE_LOG_LEVEL` (`:31`), default `info` (`:33`), ranked at `:35`. The sink goes through `console` rather than `process.stdout` so the desktop main process keeps capturing it (`:108-127`).

Two redaction rules, both enforced in the logger and not at the call site:

- Every string that goes out passes through `redactSecrets`, recursively, depth-capped at 4 (`MAX_DEPTH`, `:83`) and width-capped at 32 array entries (`MAX_ARRAY`, `:86`), with `[depth]`, `[cycle]` and `[+N more]` markers (`sanitiseValue`, `:143-177`).
- A field name that is an exact tenant-content name — `prompt`, `messages`, `body`, `content`, `input`, `output`, `text`, `match`, `snippet`, `sql` (`:63-74`) — or that merely **contains** `token`, `secret`, `key`, `password`, `passwd`, `cookie`, `authorization`, `csrf` or `session` anywhere, in any case (`:45-55`) is replaced by `DROPPED_MARKER = "[dropped]"` (`:23`, `isForbiddenField` at `:77-80`, applied at `:194-196`). The name stays so the shape of the line still shows the field was there.

The `request_filtered` line is the one the transport rules write (`FILTERED_EVENT`, `http-adapter.ts:54`, emitted at `:283-289`). Its fields are chosen to survive those rules: `code`, `status`, `method`, **`pathLength`** — the length, never the path — and `ip`. `request_failed` (`:56`, `:491-497`) carries the same fields plus the `Error`, which `sanitiseValue` flattens to a redacted `"Name: message"` string (`log.ts:138-140`, `:156-158`), never a stack. Only server mode writes either line (`:282`).

### 10. What else server mode changes

**The wrap key becomes mandatory.** `getLocalVaultKey(env)` (`packages/db/src/vault-key.ts:123-135`): off server mode, `AGENTFORGE_SECRETS_KEY` if set, else the self-creating `.master-key` file (`:107-114`, `MASTER_KEY_FILE` at `:37`) — unchanged. In server mode the env key is required (`SERVER_VAULT_KEY_REQUIRED`, `:46-49`) and must measure at least `MIN_VAULT_KEY_BYTES = 32` (`:40`) through `vaultKeyEntropyBytes` (`:90-105`), else `SERVER_VAULT_KEY_TOO_WEAK` (`:51-54`). The file fallback is not reached at all. `vaultKeyEntropyBytes` counts only hex (even digit count) and *canonical* base64/base64url — it re-encodes the decoded bytes and demands the same string back (`isCanonical`, `:80-82`), which refuses a passphrase that merely happened to be long enough. The file names its own limit at `:75-78`: a 43-character alphanumeric string is a valid base64 encoding of 32 bytes and passes.

**The gateway gate fails closed.** `deriveGatewayGate` (`packages/host/src/gateway-gate.ts:269-297`) reads `isServerMode(input.env ?? process.env)` at `:275` and changes two rules:
- `envRuntime === "stub"` opens the gate on a desk but falls through to `needs_key` on the server (`:278-283`) — a stub runtime is a hosted misconfiguration, never an open gate.
- "no verdict, or a verdict for a different key fingerprint" is `{status:"ok", allowed:true, grace:true}` on a desk and `{status:"error", allowed:false, grace:false}` with `GATEWAY_UNVERIFIED_MESSAGE` (`:57`) on the server (`:288-290`, `:296-298`). A hosted tenant has no first run to take on trust. Everything below that line is a verdict the gateway actually gave and reads the same in both modes.
The renderer half matches: `resolveGate(payload, isElectron, hosted)` (`apps/web/lib/gateway-gate.ts:94-100`) falls closed on a missing or malformed gate when `hosted || isElectron`, and stays open otherwise.

**"Start over" answers 403; "Sign out" does not.** `handleResetApp` (`packages/host/src/handlers/settings.ts:445-461`, route `packages/host/src/router.ts:264`) resolves `serverMode` through an injectable dep (`ResetDeps`, `:443`, resolved `:450`). Phase 4 split the two scopes rather than refusing both:
- `scope: "all"` → `ApiError(RESET_DISABLED_CODE, RESET_DISABLED_MESSAGE, 403)` (`resetEverything`, `:423-440`, refusal at `:424-426`, constants `:383-386`). The refusal comes **first**, before the confirmation word is checked and before anything is queued, so one workspace's owner cannot arm a wipe of everyone else's data.
- `DELETE /api/v1/settings/reset` (cancel) refuses the same way (`:477`).
- `scope: "key"` **no longer refuses** (`resetGatewayKey`, `:400-415`). It used to, on the reasoning that `clearGatewayKeyEverywhere()` was machine-wide — which stopped being true in Phase 3 lane D, when both it and `clearGateState` were narrowed to the caller's tenant. Phase 4 dropped the 403 and the dead `RESET_KEY_DISABLED_MESSAGE` with it, because refusing it left a hosted tenant with no way to remove a saved key: a blank `openaiApiKey` in a settings POST is dropped rather than applied (`keyFieldValue`, `:194-202`). Pinned by `packages/host/src/handlers/settings.test.ts`.
Off server mode nothing about either scope changed.

## Where things live

| File | Role |
|---|---|
| `packages/core/src/server-mode.ts` | `isServerMode`, `trustedOrigins`, `normaliseOrigin` — the switch and the allowlist |
| `packages/host/src/local-request.ts` | Both mutating rules, and the whole HTTP request filter with its caps |
| `packages/host/src/csrf.ts` | Mint, set-cookie, constant-time check; the two cookie names |
| `packages/host/src/http-adapter.ts` | `handleNodeRequest` — the order everything runs in; `MAX_BODY_BYTES`, `maskServerError`, `dispatchMasked` |
| `packages/host/src/rate-limit.ts` | The three token buckets, `clientIp`, `sessionRateKey`, the LRU bound |
| `packages/host/src/concurrency.ts` | ffmpeg and SQL semaphores, waiting room, `too_many_jobs` |
| `packages/host/src/log.ts` | The one JSON logger and its redaction rules |
| `packages/host/src/router.ts` | `dispatch`, and the hosted session gate in front of the route table |
| `packages/host/src/auth/routes.ts`, `auth/session.ts` | `isSessionExemptPath`, `UNGATED_GETS`, the `__Host-` session cookie name |
| `packages/host/src/handlers/settings.ts` | `reset_disabled` on both reset scopes |
| `packages/host/src/gateway-gate.ts` | `deriveGatewayGate` — the two server-mode branches |
| `packages/db/src/vault-key.ts` | Mandatory wrap key and its encoding check |
| `apps/web/lib/api-client.ts` | Where the renderer reads the cookie and echoes the header |
| `apps/web/lib/bind-host.ts`, `apps/web/server.ts` | The listen interface, `x-powered-by`, the adapter's mount position |
| `apps/web/lib/hosted-build.ts`, `apps/web/lib/gateway-gate.ts` | How the renderer learns it is hosted, and the gate it derives |
| `webapp-deploy/Caddyfile` | TLS, HSTS, CSP, header stripping, `X-Forwarded-For`, and the `Host` pass-through the allowlist depends on |

## Gotchas

**`MAX_BODY_BYTES` is not where the other caps are.** `MAX_REQUEST_PATH_LENGTH`, `MAX_QUERY_PARAMS` and `MAX_HEADER_BYTES` are in `local-request.ts:160-166`; the body cap is `http-adapter.ts:30` and is *passed in* as `maxBodyBytes` (`local-request.ts:187`). It is also enforced twice, for different reasons: the declared `Content-Length` is refused before a byte is read (`local-request.ts:297-300`), and the bytes actually read are counted again as they stream in (`http-adapter.ts:134-137`), because a chunked body declares no length.

**The security spec is a decision record, not a citation source.** Its rows A1, T4, T8, T9 and S1 (`docs/internal/web-security-spec.md`) were still describing the pre-PR-56 tree until 2026-09-20, when they were rewritten against this commit — including S1, which said the `.master-key` fallback throws "when `NODE_ENV=production`" where the code actually keys on `isServerMode` (`packages/db/src/vault-key.ts:125`). Read those rows for *what was decided and why*; read this page or the code for where it lives.

**Transport filtering runs on every path, not just `/api`.** In server mode the TLS rule, the method allowlist, the path filter, the header cap and the per-IP bucket apply to page loads, bundles and 404 probes too (`http-adapter.ts:407-413`, reasoning at `:394-406`). Only the Origin / CSRF / session rules stay `/api`-only. **This depends on `handleNodeRequest` being the first middleware in `apps/web/server.ts:45-51`.** Move that mount and the controls move with it.

**A plaintext flood is not rate-limited.** `rejectPlaintext` runs before `checkRequestRate` inside `transportRejection` (`http-adapter.ts:323-329`), so a request without `X-Forwarded-Proto: https` gets its 403 without spending a token. That is cheap to answer, but it means the per-IP bucket is not the control for that traffic — the proxy and the loopback bind are.

**The CSRF cookie is minted everywhere; only the server enforces it.** `http-adapter.ts:431-432` mints on any `/api` GET in every mode, deliberately, so the renderer's echo path is exercised on webdev (`csrf.ts:11-12`). Seeing `agentforge_csrf` on a desk does not mean the check is on.

**The CSRF token is not yet bound to a session.** It is bare randomness compared against itself; binding it as `HMAC(server key, session id)` is a recorded follow-up (`csrf.ts:14-17`, `:89-91`). Today a token minted for one session is not rejected in another.

**An unconfigured hosted server accepts no writes.** `trustedOrigins()` defaults to `[]` in server mode (`packages/core/src/server-mode.ts:58-60`), and both `isAllowedWebOrigin` and `isAllowedWebHostHeader` match nothing against an empty list. Every POST/PATCH/DELETE answers `403 origin_forbidden` until `AGENTFORGE_TRUSTED_ORIGINS` is set. The matching proxy trap: Caddy must **not** rewrite `Host` to `127.0.0.1`, which the old loopback rule needed and which now fails the Host half of the check (`webapp-deploy/Caddyfile:114-131`).

**Lowering an rpm lowers its burst too.** `bucketConfig` clamps burst to `max(1, min(defaultBurst, rpm || defaultBurst))` (`rate-limit.ts:178-182`), so `AGENTFORGE_RATE_IP_RPM=10` gives burst 10, not 100. A non-numeric value silently falls back to the default; an explicit `0` switches that limiter off entirely (`:82-84`). Buckets are also thrown away whenever the resolved config changes (`:193-205`).

**The logger will eat an innocent field name.** Anything containing `key` or `session` is dropped, so `keyCount` and `monkeys` are `[dropped]`; the deliberate trade is that the call site gets renamed, not that the rule gets looser (`log.ts:37-44`). This is why `request_filtered` logs `pathLength` rather than `path` — and note the path would not have been dropped by name, it is simply not logged.

**Masking is json-and-5xx only.** `maskServerError` returns SSE and bytes results untouched, and leaves every 4xx alone (`http-adapter.ts:348`). A streaming handler that fails mid-stream is not masked by this function.

**`isApiPath` is computed on the raw path, the guards on the normalised one.** `http-adapter.ts:372` vs `:383`. That asymmetry is deliberate (comment `:370-371`) — normalising cannot create an `/api` path, but a guard on the raw path would miss `/api/v1/settings/reset/`.

**The workspace cookie is still client-supplied in server mode.** `http-adapter.ts:470` reads `agentforge_workspace` straight off the request. Deriving the tenant from the session instead is Phase 3 (`docs/internal/web-security-spec.md:61`, row T2); see [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md) for how the desk slice is resolved today.

**Job caps are global.** Two ffmpeg children and four SQL workers for the whole box, not per tenant (`packages/host/src/concurrency.ts:16`, `:288-290`). One busy tenant can make another wait, and — past the waiting room or the 60 s queue timeout — collect a `429 too_many_jobs`.

## Verify

The closest existing feature file is [`.cursor/skills/verify-agentforge/features/security.md`](../../../.cursor/skills/verify-agentforge/features/security.md), and it is **not** the verification for this page. It covers the key fingerprint on Settings (`key-fingerprint`), the `privacy-note` copy, the at-rest AES-256-GCM envelope inventory and the doctor's `keyFingerprint` field. It says nothing about `AGENTFORGE_SERVER`, the Origin allowlist, CSRF, rate limits or masked errors.

**No feature file drives the hosted transport path end to end today.** Nothing in `.cursor/skills/verify-agentforge/features/` brings up an instance with `AGENTFORGE_SERVER=1` behind a proxy and proves the answers from the outside. That is the gap, and it is the honest state at this commit: everything on this page is proved by unit suites against the pure functions, not by a driven run.

What does prove it, and what a feature file would have to keep in step with:

| Suite | Covers |
|---|---|
| `packages/core/src/server-mode.test.ts` (10 cases) | the switch and the allowlist defaults, including the https-only filter |
| `packages/host/src/local-request.test.ts` (46 cases) | both mutating rules and every filter branch above |
| `packages/host/src/csrf.test.ts` (16 cases) | cookie name by mode, the `Set-Cookie` attributes, the constant-time compare |
| `packages/host/src/http-adapter.test.ts` (90 cases) | the ordering, `https_required`, identity headers, `maskServerError`, `dispatchMasked` |
| `packages/host/src/rate-limit.test.ts` (25 cases) | the three buckets, `Retry-After`, the LRU bound, the last-hop rule |
| `packages/host/src/concurrency.test.ts` (47 cases) | the semaphore, the waiting room, the queue timeout, the unbounded desk limiter |
| `packages/host/src/log.test.ts` (30 cases) | redaction, dropped field names, depth and cycle markers |
| `apps/web/lib/bind-host.test.ts` (8 cases) | the loopback default and the throw |
| `apps/web/lib/api-client.test.ts` (19 cases) | the renderer's transport and CSRF headers on mutating calls |

Outside the repo, the two checks a hosted deploy should answer are `curl -I` on the public URL (no `Server`, no `X-Powered-By`, HSTS present) and `ss -ltnp` on the box (the app on loopback only) — the spec rows that ask for them are `docs/internal/web-security-spec.md:15` (N3), `:17` (N5) and `:52` (A11). Neither is automated here.

There are no DOM testids for any of this. It is all transport; nothing on this page renders.

## Why

**Why one flag rather than per-feature configuration.** `[Direct]` The commit message of `6ae177a` opens with it: "One switch, AGENTFORGE_SERVER=1 (packages/core/src/server-mode.ts), turns on every hosted-only rule; webdev and the desktop never set it and behave as before." `[Supported]` Every consumer reads the same function rather than its own variable — `http-adapter.ts:374`, `concurrency.ts:242`, `vault-key.ts:125`, `gateway-gate.ts:275`, `router.ts:352`, `bind-host.ts:20`, `handlers/settings.ts:361`, `server.ts:25` — so there is one thing to set and one thing to get wrong. **Confidence: high.**

**Why a missing Origin is accepted on loopback and rejected on the web.** `[Direct]` `docs/internal/web-security-spec.md:42` (row A1) states the requirement: "Mutating `/api` accepts only a configured trusted-origin allowlist; a **missing Origin is rejected** on the web adapter (today it is allowed…)." The reason for the asymmetry is recorded in the same row and in the commit message ("missing Origin rejected"): on loopback the absent Origin is genuinely how curl and native tooling call, and on a public server there is no "same machine" to infer. **Confidence: high.**

**Why the Host header is checked as well as the Origin, and why the proxy must not rewrite it.** `[Direct]` `docs/internal/web-security-spec.md:42` says the second check "must accept the configured public host too; until then the proxy rewrites `Host` to `127.0.0.1` (`webapp-deploy/Caddyfile`)". `[Direct]` `webapp-deploy/Caddyfile:114-121` records the consequence of the change landing: with `AGENTFORGE_SERVER=1` the app checks Host against the configured origins, "so rewriting Host to 127.0.0.1 — which the old loopback rule needed — now makes every POST / PATCH / DELETE answer 403 origin_forbidden." The deploy config and the code moved together. **Confidence: high.**

**Why the per-IP bucket keys on the last `X-Forwarded-For` hop.** `[Direct]` `docs/internal/web-security-spec.md:54` (row A13) specifies "client IP from the proxy's own `X-Forwarded-For` hop only in server mode". `[Direct]` `webapp-deploy/Caddyfile:90-113` gives the operational half: since Caddy 2.7 `reverse_proxy` replaces the header for an untrusted client and only appends for a trusted one, the default trusted set is empty, and "on an older build the incoming header is appended to instead, which is exactly the shape the last-hop rule is written to survive." `[Supported]` The same file records the condition under which the rule stops holding — a CDN or load balancer in front adds an appending hop and moves the client address away from the end. **Confidence: high.**

**Why a global concurrency cap landed now and per-tenant caps did not.** `[Direct]` `docs/internal/web-security-spec.md:68` (row T9) schedules per-tenant caps for Phase 5 but marks "a global cap **before traffic**", and notes that before this there was no concurrency cap at all. `[Direct]` The commit message lists "Jobs: ffmpeg and SQL limiters with queue timeout, rolling SQL time budget." **Confidence: high.**

**Why the caps are off on a desk.** `[Supported]` `packages/host/src/concurrency.ts:10-14` records the regression that forced it: capping a single-owner desk "turned a batch of eight exports into a queue, and the ninth into a 429 the desktop had never produced before." That is a first-person account in the source rather than an external record, so it is the *reason given*, not an independent one. **Confidence: medium-high.**

**Why "Start over" is refused rather than scoped.** `[Direct]` `docs/internal/web-security-spec.md:67` (row T8): "'Start over' is scoped to the caller's tenant, or disabled on the web build; today it wipes the whole data dir". The second option was taken, and the refusal is placed before the confirmation word so a wipe cannot even be armed. `[Supported]` The "forget my key" scope was refused for a different reason — the key clear is machine-wide and the gate verdict is shared, so one tenant would sign out every other (`packages/host/src/handlers/settings.ts:310-317`). **Confidence: high.**

**Why the gate fails closed on the hosted build.** `[Direct]` `docs/internal/web-security-spec.md:63` (row T4) asks for exactly both halves: the renderer must treat a missing or malformed gate as blocked, and "the host stops taking an unverified key on trust". Both landed (`apps/web/lib/gateway-gate.ts:94-100`, `packages/host/src/gateway-gate.ts:287-289`). **Confidence: high.**

**Why the wrap key is mandatory on the server.** `[Direct]` `docs/internal/web-security-spec.md:74` (row S1). `[Supported]` `packages/db/src/vault-key.ts:42-45` gives the mechanism the row implies: an invented `.master-key` on a container layer "is a key that disappears with the container and takes every sealed envelope with it." **Confidence: high.**

**Why 5xx bodies are masked but 4xx are not.** `[Direct]` `docs/internal/web-security-spec.md:47` (row A6) asks for "no stack traces, no file paths, no SQL" on every 4xx/5xx, and `:52` (row A11) names `maskServerError` as the landed answer. `[Inferred]` The split — 5xx replaced, 4xx left alone — is not stated in the spec; the reason given in `packages/host/src/http-adapter.ts:352-354` is that a 4xx message is written by this repo and is the honest reason the caller asked for, while the detail on a 500 is where a driver's paths and SQL leak. Since that is the change's own account of itself, treat it as the intent recorded rather than an independently sourced decision. **Confidence: medium.**
