# Gateway gate

The host decides whether this desk may talk to the gateway and the renderer only displays that decision. `GET /api/v1/settings` carries `gateway: { status, allowed, grace, endpoint, endpointLocked, checkedAt, lastOkAt, message? }` with `status` in `stub | needs_key | ok | invalid_key | unreachable | error`; `allowed` is the only field the renderer branches on, and when it is false the desk drops to onboarding and every gateway-calling route answers a flat `403 gateway_blocked`. The gate is advisory and fails **open** — a missing or unreadable `gateway-gate.json` opens the desk on trust, so this is a UX signal, never an entitlement check.

## Sub-features

- `gate-onboarding` is the first-run / blocked screen: `onboarding-form`, `onboarding-endpoint` (read-only, "This endpoint is fixed and cannot be changed"), `onboarding-key`, `onboarding-continue`, and — only when the host reported a reason — `onboarding-gate-reason` plus `onboarding-recheck`. `onboarding-setup-check` appears when ffmpeg is missing.
- `gate-status-row` is `settings-gateway-status` on Settings: the status word, the last-checked timestamp, and `settings-gateway-recheck`.
- `gate-grace` is `settings-gateway-grace`, shown only while `grace` is true: "Working offline with a key verified on {date}."
- `gate-reason` is `settings-gateway-reason`, shown only for `invalid_key`, `unreachable` and `error` — the same three copy keys onboarding uses.
- `gate-recheck` is the button's effect: `POST /api/v1/settings/gateway/check` re-runs one 3s `GET <endpoint>/models` and returns a fresh `{ gateway }`. `stub` and `needs_key` short-circuit with no network call.
- `gate-blocked-route` is the enforcement: `requireGatewayAllowed()` in every gateway-calling handler (runs, jobs, finance, market, legal, knowledge, enhance, edit) answers `403 { error, status, message }` — flat, not the usual nested error envelope.
- `gate-open-routes` are the ones deliberately left open so a closed gate is recoverable: settings, workspaces, threads, artifacts, media, usage and the model refresh.
- `gate-reset` is the Start over card, `settings-reset` — see [settings.md](./settings.md). **Do not drive it on a shared desk.**

## How to get to it (user POV)

- A desk with no key, or a key the gateway rejected, opens straight on the onboarding screen instead of Chat. There is no rail and no way past it except a key that validates or a re-check that succeeds.
- A working desk reaches the gate through Rail → Settings (`settings-link`), where the status row sits under the gateway key block.
- "Re-check" is the only user control that forces a fresh verdict.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- Use your own isolated desk (`AGENTFORGE_DATA_DIR` pointed at a throwaway dir). A re-check can turn a stale `ok` into `invalid_key`, which **closes the desk** — never do that to the operator's instance.
- Never type into `onboarding-key` or `openai-key` on a desk you do not own, and never press anything in `settings-reset`.
- Order matters: drive every other feature first. A re-check that fails leaves the desk on onboarding and blocks the rest of the run.

- **Status row.** Open Settings. `settings-gateway-status` is visible and reads one of "Key verified" / "No key saved" / "Key rejected by gateway" / "Gateway unreachable" / "Gateway error" / "Offline demo", followed by "Last checked <date>" and the Re-check button.
- **Grace and reason.** `settings-gateway-grace` is present only when the payload says `grace: true`; `settings-gateway-reason` only for the three failure statuses. Absent is the correct state on a healthy desk — do not record it as a miss.
- **Re-check.** Click `settings-gateway-recheck`, wait ~5s, and read the row again. The timestamp must move. On a desk whose key has since been revoked the row flips from "Key verified" to "Key rejected by gateway" and `settings-gateway-reason` appears.
- **Gate closes.** With `allowed: false`, reload `/chat`: the page renders the onboarding screen instead (`onboarding-form`, `onboarding-endpoint`, `onboarding-gate-reason`, `onboarding-key`, `onboarding-continue`, `onboarding-recheck`) and the reason reads "The gateway rejected this API key. Check the key at Toko Token and try again."
- **Blocked route.** A gateway-calling route answers `403 {"error":"gateway_blocked","status":"invalid_key","message":"…"}`. Read the body shape: `error` is a flat string, not `{ code, message }`.
- **Open route.** `GET /api/v1/settings` still answers `200` with the gate closed. If it does not, the gate has stopped being recoverable and that is a product bug, not a recipe miss.
- **Stub.** With `AGENTFORGE_RUNTIME=stub` the payload is `status: "stub", allowed: true` and nothing is gated, which is why Cloud and Playwright are unaffected.
- **Evidence.** Screenshots of the status row before and after the re-check, the closed-gate onboarding screen, and the 403 body, under `evidence/gateway-gate/<run-id>/`.

## Gotchas

- **"Key verified" can be a lie.** The row shows the last stored verdict, and an `ok` verdict stands for 24h before it falls back to the 7-day grace. Driven on 2026-09-15: the row read "Key verified · Last checked 12:16 PM" while every live call returned 401, and only `settings-gateway-recheck` turned it into "Key rejected by gateway". A green status row is never proof that the key still works — a successful send is.
- **Re-check is destructive on a bad key.** It replaces a comfortable cached verdict with the truth, and `invalid_key` gets no grace, so the desk closes immediately. Drive it last.
- **The gate fails open, by design.** Delete or corrupt `gateway-gate.json` and `deriveGatewayGate` returns `ok / allowed: true / grace: true` with "Not checked yet." A desk that opens is not evidence the key is good.
- **Webdev and packaged disagree on a broken payload.** `resolveGate` forces onboarding only when `isElectron()` is true, so a missing or unparseable `gateway` field silently lets webdev through while the packaged app fails closed. To exercise a closed gate on webdev the host must actively report one.
- **`AGENTFORGE_RUNTIME=stub` opens the gate but does not force stub runtime.** On a desk with a key already saved, the payload reads `gateway.status: "stub", allowed: true` while `runtime` stays `"ai"` and sends still hit the live gateway. Observed on 2026-09-15. For a real stub drive use a data dir with no key saved.
- **The English `message` never reaches the screen.** The renderer picks localized copy from `status` alone; `gateway.message` ("HTTP 401", "The gateway rejected the saved key.") exists only in the payload and the log. Assert the localized sentence, not the host's technical string.
- **A 401 during a send is not the gate.** The gate is a cached verdict; a live 401 surfaces as ordinary gateway-failure copy in `chat-error` and `composer-error` (`packages/core/src/gateway-http-copy.ts`), in the desk language, with the status code in the headline. Both paths are real and they can disagree.
- **`allowed` is advisory and must stay that way.** It decides what the desk shows and which local handlers refuse. Seats, plan limits and spend are enforced server-side against the bearer. Anyone can delete one JSON file to get past this gate; a recipe that treats it as an entitlement proof is testing the wrong thing.
