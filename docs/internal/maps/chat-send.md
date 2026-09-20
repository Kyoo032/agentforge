# Map — Chat send

Last verified: 2026-09-20 at a053245 + the Phase 4 branch `feat/web-phase4-tenant-secrets-rcbu9c`

Supersedes the `## how — Chat send (pstack) — 2026-09-06` block in [`../0.14-changelog.md`](../0.14-changelog.md), which described the 0.14 shape. Several details in it are no longer true; see Gotchas.

## Overview

One user turn in Chat: text in the composer, Enter, an assistant answer streaming into the transcript. The path crosses four layers — renderer, transport (HTTP or Electron IPC), host run orchestrator, core runtime — and everything the user sees between "Send" and the finished message is a server-sent-events stream of `RuntimeEvent`s.

The thing to hold onto: **the streamed text is not what ends up on screen.** The deltas paint a live bubble; when the run completes the renderer throws that state away and re-fetches the thread, so the persisted database copy is what the user actually keeps.

## How it works

### 1. Composer → request

`ChatComposer` (`apps/web/components/chat-composer.tsx`). Enter is handled by `submitOnEnter` (`apps/web/lib/composer-enter.ts:7-26`), which ignores Shift/Alt/Ctrl/Meta and IME composition (`keyCode === 229`); the Send button submits the same `<form>`. `send()` (`apps/web/components/chat-composer.tsx:180`) classifies attachments, ensures a thread exists (`POST /api/v1/threads`), optimistically appends the user's own message to local state (`apps/web/components/chat-session.tsx:490-492`), then POSTs:

```
POST /api/v1/threads/:threadId/runs/text
{ content, model, thinking, reasoningEffort }
```

(`apps/web/components/chat-composer.tsx:233-243`; `/runs/image` and `/runs/video` are the media variants at `:293`.)

### 2. Transport — one function, two worlds

`apiFetch` (`apps/web/lib/api-client.ts:167-238`) is the only place that knows whether this is webdev or the packaged app.

- **Web:** plain `fetch`, stamped by `withMutatingHeaders` (`apps/web/lib/api-client.ts:153-165`) on mutating methods only: `x-agentforge-transport: web`, and alongside it the double-submit CSRF token in `x-agentforge-csrf` when one is available. The CSRF half is a hosted-mode rule and is mapped in [`hosted-server-mode.md`](hosted-server-mode.md), not here.
- **Packaged:** `invokeDesktop` → `window.agentforge.invoke` → `ipcRenderer.invoke("host:request", …)` (`apps/desktop/preload.cjs:25`). A `{type:"stream"}` result is rebuilt into a real `ReadableStream` fed by `host:stream-chunk` / `host:stream-end` / `host:stream-error` (`apps/desktop/preload.cjs:27-56`), and abort goes back out over `host:stream-abort` (`apps/web/lib/ipc-abort.ts:18-28`).

Either way `apiFetch` hands back a `Response` with `Content-Type: text/event-stream`, so `readSse` never learns which transport ran.

### 3. Host — gate, then run

`packages/host/src/router.ts:241-243` maps the route to `handleRun` (`packages/host/src/handlers/runs.ts:27`). First thing it does, before touching the database or the gateway: `requireGatewayAllowedFor(tenant)` (`packages/host/src/handlers/runs.ts:31`). A closed gate throws `GatewayBlockedError` and the request answers a flat `403 { error: "gateway_blocked", status, message }` (`packages/host/src/errors.ts:20-25`) with no SSE stream at all. See [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md).

Otherwise `startModalityRun` (`packages/host/src/runs.ts:125`) runs the turn:

1. Parse and validate the body (`parseTextRunInput`, `packages/core/src/content/parse-run-input.ts:114`) — empty content or an `image_url` part on the text route is a 400.
2. Redact attachments unless `injectionGuardBypass`; load the thread (404 if missing); resolve the model; build the knowledge injection and the final system prompt.
3. Push `": connected\n\n"` onto an async queue immediately so headers flush.
4. **Arm the run-stall guard** (`packages/host/src/runs.ts:195`, `packages/host/src/run-stall.ts`).
5. Kick off the background `work` IIFE: persist the user message, set the thread title, `insertRun` (status `streaming`), load history, `createRuntime(settings)`, emit `run.started`, then `runtime.execute({...})` inside `withRunContext`.
6. The generator yields whatever `send()` pushed (`packages/host/src/runs.ts:450-456`). Each frame is `encodeSse(event)` — `event: <type>\ndata: <json>\n\n` (`packages/core/src/sse.ts:6`).

`work` is deliberately **not** awaited by the generator's `finally`: a wedged model call must not block `host:stream-end`.

### 4. Runtime — probe, stream, coerce

`AiSdkRuntime.execute` (`packages/core/src/runtime/ai-sdk-runtime.ts`) builds the wire body, resolves effort, and enters the contact loop: up to `MODEL_CONTACT_ATTEMPTS = 3` (`packages/core/src/runtime/retry.ts:4`), each retry emitting a fresh `run.probing` frame (`packages/core/src/runtime/ai-sdk-runtime.ts:439`). A non-OK upstream response is read through `readHttpErrorBody` under a 2 s cap (`GATEWAY_ERROR_BODY_MS`, `packages/core/src/models/request-constraints.ts:123`) and turned into a `gatewayFailure`; `isRetryableModelFailure` (`packages/core/src/runtime/retry.ts:59-81`) decides whether to try again — with one carve-out, the "no first token / no stream events" wording is a hard stop, never retried (`:76-79`).

Reasoning effort has **two unrelated mechanisms** that both land as `reasoning_effort` on the wire:

- **Chat's own Thinking picker.** `readOptionalReasoningEffort` (`packages/core/src/models/reasoning-effort.ts:67`) defaults to `medium`, coerces to `none` when `thinking: false`, and accepts the UI aliases. The runtime then calls `snapReasoningEffort` (`packages/core/src/runtime/effort-allowlist.ts:74-81`), which picks the per-model, per-wire allowlist and snaps through `closestReasoningEffort` (ties go cheaper; `none` is never upgraded when `none` is itself allowed). `GPT_6_EFFORTS` (`packages/core/src/runtime/effort-allowlist.ts:18`) simply omits `none`, which is how a GPT-6 request that asked for Off comes out as `low`. Finally `applyReasoningEffortToChatBody` writes `reasoning_effort` onto chat-completions bodies only (`packages/core/src/models/reasoning-effort.ts:156-162`); Anthropic Messages and Gemini `generateContent` get their own shapes from `packages/core/src/runtime/chat-wire.ts:189-252`.
- **The job knob, which Chat never uses.** `applyJobThinking` (`packages/core/src/models/job-thinking.ts:49-58`) forces `reasoning_effort: "low"` on always-thinking families, but only when `input.jobMode` is set (`packages/core/src/runtime/ai-sdk-runtime.ts:270-273`). `packages/host/src/runs.ts:286-296` builds the `runtime.execute` options with **no `jobMode` key at all** — grep `runs.ts` for `jobMode` and you get nothing. The contract says so out loud: "Chat leaves this unset and keeps its own Thinking control" (`packages/core/src/runtime/types.ts:54-58`).

### 5. The watchdogs — there are three

One rule, `streamWatchdogDeadline` (`packages/core/src/runtime/stream-watchdog.ts:88-97`), used by three separate instances:

| Instance | Scope | On fire |
|---|---|---|
| `AiSdkRuntime.consume` (`packages/core/src/runtime/ai-sdk-runtime.ts:599`) | one gateway call | aborts that call; the probe loop may retry it |
| `armRunStallGuard` (`packages/host/src/run-stall.ts`, armed at `packages/host/src/runs.ts:195`) | the whole SSE run | `run.failed` + `run.completed`, stream closed, run marked failed — never retried |
| `apps/web/components/chat-composer.tsx:222` | the browser tab | aborts the fetch, shows `abortErrorMessage` |

Budgets (`packages/core/src/runtime/stream-watchdog.ts`): `STREAM_TTFB_MS = 120_000` / `STREAM_IDLE_MS = 60_000` for ordinary models; `STREAM_REASONING_TTFB_MS = 240_000` / `STREAM_REASONING_IDLE_MS = 180_000` for reasoning models. `isWatchdogReasoningModel` (`:43-49`) covers the Claude 4/5 families plus `QUIET_REASONING_FAMILY` — `^(deepseek-v4|glm-5\.3|kimi-k3|qwen3\.8-max)` (`:40`).

**Quiet reasoning is the whole point of that second pair.** Until the model produces real output the first-token budget governs and it is a **hard, non-rearming cap**: a frame carrying no output (the AI SDK's `step-start`, a keep-alive) must not push it out, or a gateway that heartbeats forever without answering would hold a run open forever (comment at `:82-86`). Only `touchOutput()` flips `streaming` true and hands over to the idle budget. The quiet families get the long budgets because their `reasoning_content` is dropped by AI SDK 4 before it reaches `onEvent`, so a thinking model looks dead on the wire. A per-run `streamWatchdog` override can only **raise** these floors (`raisedLimit`, `:59-66`); Chat passes none, job routes do.

### 6. SSE → screen

`readSse` (`apps/web/components/chat-composer.tsx:106-155`) reads the body, feeds `consumeSse` (`apps/web/lib/sse-client.ts:14-33`), and dispatches: `run.started` / `run.probing` → `onStarted`; `assistant.delta` → accumulate `streaming`; `assistant.thinking` → accumulate `thinking`; `tool.started` / `tool.completed` → the tool list; `run.failed` → `onFailed` + `composer-error`.

While anything is live, `ChatTurn` renders inside a `data-testid="assistant-live"` wrapper (`apps/web/components/chat-session.tsx:466-469`): the thinking `<details>` shows `thinking-placeholder` until the first thinking token, tools render as `message-tools`, and the answer renders through `FormattedText` as `message-output` (`apps/web/components/chat-turn.tsx:88`). On `onComplete` the live state is cleared and `refreshMessages` does a `GET /api/v1/threads/:id` (`apps/web/components/chat-session.tsx:325-327`), after which the same text re-renders from the persisted message — through a different component, with the same `message-output` testid (`apps/web/components/chat-turn.tsx:155`, `:206`).

### 7. Model picker portal

Fixed in `e93c617`. The composer toolbar's single-row `overflow-hidden` layout (from `4db009a`) clipped the absolutely-positioned dropdown off-screen and squeezed the trigger to roughly 18px. Now: the panel is `createPortal(..., document.body)` as a `fixed` element (`apps/web/components/model-picker.tsx:321-378`), positioned by the pure `placePickerPanel` (`apps/web/lib/picker-panel.ts:61-88`) which flips above the trigger when there is more room above or at least `PICKER_PANEL_MIN_HEIGHT` (160px), clamps to an 8px viewport gutter, and re-runs on open plus `resize`/`scroll` (capture) while open (`apps/web/components/model-picker.tsx:200-221`). The trigger carries `w-36 min-w-[7rem]` so it cannot be squeezed below ~112px (`:381`), and the toolbar is `flex-wrap` with `ml-auto` on Send (`apps/web/components/chat-composer.tsx:389-390`, `:441-443`) so overflow wraps to a second row instead of clipping.

### Failure modes

| Failure | Where | What the client gets |
|---|---|---|
| Gate closed | `requireGatewayAllowedFor`, `packages/host/src/handlers/runs.ts:30` | HTTP 403, flat `{error:"gateway_blocked", status, message}`, no stream |
| Empty / invalid content | `parseTextRunInput` | HTTP 400, nested `{error:{code,message}}`, pre-stream |
| Thread missing | `packages/host/src/runs.ts:139-141` | HTTP 404, pre-stream |
| Upstream non-OK | `readHttpErrorBody` → `gatewayFailure` | retried up to 3 attempts with `run.probing` frames, then `run.failed` + `run.completed` |
| Inner watchdog | `AiSdkRuntime.consume` | retried like any failure, **except** "no first token" wording, which is a hard stop |
| Run-stall guard | `packages/host/src/run-stall.ts` | `run.failed` + `run.completed`, run row failed, partial text discarded |
| Client abort / socket close | `res.on("close")` (`packages/host/src/http-adapter.ts:467-472`) or `host:stream-abort` | same as stall |
| Model returns nothing | `shouldFailEmptyAssistant`, `packages/core/src/runtime/retry.ts:146-152` | `run.failed` + `run.completed` |
| Tool ran, later fetch failed | `shouldKeepToolTurn`, `packages/core/src/runtime/retry.ts:155-157` | turn kept: `run.completed` with no `run.failed` |

## Where things live

| File | Role |
|---|---|
| `apps/web/components/chat-composer.tsx` | Send, attachments, SSE reader, client watchdog |
| `apps/web/components/chat-session.tsx` | Live `streaming` / `thinking` / `tools` state; `refreshMessages` after completion |
| `apps/web/components/chat-turn.tsx` | One turn: thinking `<details>`, tools, `message-output` |
| `apps/web/components/model-picker.tsx`, `apps/web/lib/picker-panel.ts` | Portaled picker and its pure placement math |
| `apps/web/lib/api-client.ts` | `apiFetch` — the one transport switch |
| `apps/web/lib/desktop-bridge.ts`, `apps/desktop/preload.cjs` | `window.agentforge` typed wrapper and its `contextBridge` definition |
| `apps/web/lib/sse-client.ts` | `consumeSse` — buffer → typed events |
| `packages/host/src/handlers/runs.ts` | Route handler; gate check; stream wrapper |
| `packages/host/src/runs.ts` | `startModalityRun` — the orchestrator |
| `packages/host/src/run-stall.ts` | Whole-run first-token / idle guard |
| `packages/host/src/http-adapter.ts` | SSE headers, per-request abort on socket close |
| `packages/core/src/runtime/ai-sdk-runtime.ts` | The runtime: probe loop, `streamText`, per-call watchdog |
| `packages/core/src/runtime/stream-watchdog.ts` | The one deadline rule and the four budgets |
| `packages/core/src/runtime/retry.ts` | Attempts, retryability, empty-output and keep-tool rules |
| `packages/core/src/models/reasoning-effort.ts` | Chat's Thinking ladder, parsing and per-model coercion |
| `packages/core/src/models/job-thinking.ts` | The job-only effort knob Chat does not use |
| `packages/core/src/sse.ts` | `encodeSse` |

## Gotchas

- **A completed run now writes twice.** `runs.usage` still carries the per-run detail on the run
  row; `recordChatRunUsage` (`packages/host/src/runs.ts:370`, and `:420` on the mid-stream error
  path) also writes a `tenant_usage` row, gated on `finishRun`'s return so one run is exactly one
  row. Anything summing both double-counts chat. See [`tenant-usage-ledger.md`](tenant-usage-ledger.md).

- **The 2026-09-06 changelog block is stale in three places.** It says "Watchdog 60s idle if no events after start" — the budgets are now a model-aware TTFB/idle pair and the TTFB half is a hard cap. It names `chat-send` / `chat-probe` / `chat-fail-closed` as if they were testids — they are **sub-feature names in the verify skill**; there is no `data-testid="chat-send"` anywhere in `apps/web`. And it names `coerceReasoningEffortForModel` as a live step in the wire path; it is not one any more.
- **`coerceReasoningEffortForModel` is dead on this path.** It is implemented, exported from `packages/core/src/index.ts:276` and unit-tested (`packages/core/src/models/reasoning-effort.test.ts:97-107`), but a repo-wide grep at this sha finds no call site outside those two. The "GPT-6 cannot go Off" behaviour it encodes is achieved independently by the allowlist in `packages/core/src/runtime/effort-allowlist.ts`. Treat it as a historical artifact from before the allowlist existed — verified by grep, not by blame.
- **A partial answer is never kept.** On abort or stall, `settleRun` (`packages/host/src/runs.ts:184-192`) sets `settled` and marks the run failed; every `persistAssistant()` call is behind an `if (settled) return`. Whatever the model streamed is discarded. Only an upstream error while `settled` is still false can persist partial text.
- **The renderer's own watchdog never leaves first-token mode.** `readSse` calls `dog.touch()` only (`apps/web/components/chat-composer.tsx:254`, `:314`); `touchOutput()` is never called on this path. Since `streaming` only flips in `touchOutput`, the client-side deadline stays `startedAt + ttfbMs` for the whole run, and repeated touches re-arm a timer that fires at the same instant. A genuinely long, actively-streaming answer can therefore be aborted client-side. The host-side guards do call `touchOutput` (`packages/host/src/runs.ts` via `isRunOutputEvent`), so this asymmetry is renderer-only. **Treat as a finding, not a design.**
- **`gateway_blocked` is swallowed in Chat.** The host emits it as a flat body with `error` as a *string*, precisely so `parseGatewayBlocked` (`apps/web/lib/gateway-gate.ts:145`) can read it — but that parser is only wired into `settings-page.tsx` and `onboarding-screen.tsx`. The composer does `payload.error?.message ?? t("chat.error.runFailed")` (`apps/web/components/chat-composer.tsx:244-246`), and `.message` on a string is `undefined`, so a blocked gate shows the generic "run failed" copy in Chat. **Also a finding.**
- **Probing has no UI.** `ChatComposer` declares an `onProbing` prop with an `attempt` / `attempts` / `message` payload (`apps/web/components/chat-composer.tsx:33`) and never calls it — `run.probing` is handled by calling `onStarted()` and dropping the payload (`apps/web/components/chat-composer.tsx:131-133`); `ChatSession` never passes `onProbing` either. The locale string `chat.error.couldNotReach` exists in both catalogs with zero references. This is why `features/chat.md` requires that probe copy must *not* appear on the frontend — it cannot.
- **`message-output` mounts twice per turn**, once live and once persisted, in different component subtrees. A test that waits on the testid can observe two mount cycles for one message.
- **Three watchdogs, different semantics.** The inner one is retried; the outer one is not. The outer guard is touched by *every* event including `run.probing`, so it mostly protects against total silence rather than against a retry loop.
- **`finishRun`'s `WHERE status='streaming'`** (`packages/host/src/threads.ts:327`) is the real race resolver between watchdog, abort and completion; the in-process `settled` flag is a fast-path mirror of it, needed because `finishRun` cannot be called before `insertRun` returns a `runId`.

## Verify

`.cursor/skills/verify-agentforge/features/chat.md` — sub-features `chat-send`, `chat-probe`, `chat-fail-closed`, `chat-model-switch`.

DOM testids that prove it: `composer` / `composer-text` / `composer-send` / `composer-error` (`apps/web/components/chat-composer.tsx:332`, `:352`, `:447`, `:385`), `message-list`, `assistant-live` (`apps/web/components/chat-session.tsx:408`, `:467`), `message-thinking` / `thinking-placeholder` / `message-tools` / `message-output` (`apps/web/components/chat-turn.tsx:54`, `:66`, `:73`, `:88`), `model-picker` / `model-picker-panel` (`apps/web/components/model-picker.tsx:386`, `:327`). Packaged proof needs `doctor.mjs --desktop` (`transport: "ipc"`), not `:3000`.

## Why

**Why the first-token budget is a hard cap rather than something a frame can extend.** `[Direct]` `docs/internal/0.14.26-changelog.md:121` records the bug: `AiSdkRuntime.consume` fed the watchdog from every `fullStream` part, and the AI SDK enqueues `step-start` on the provider's first chunk while `@ai-sdk/openai` emits `response-metadata` on the gateway's very first SSE frame — "so half a second in, before any token, the 120 s first-token budget was swapped for the 60 s idle one (the reported error is the *idle* wording, which proves a part had already landed)." `[Direct]` `docs/internal/0.14.26-changelog.md:139` records the review fix: "the first-token budget is a hard cap again (a liveness-only frame no longer pushes it out, so a gateway that heartbeats without answering cannot hold a run open — one rule now in `streamWatchdogDeadline`, used by both the checker and the armed timer)." The code comment at `packages/core/src/runtime/stream-watchdog.ts:82-86` says the same. **Confidence: high.**

**Why `QUIET_REASONING_FAMILY` exists.** `[Direct]` `docs/internal/0.14.26-changelog.md:123`: the resolved Finance/Documents/Market default is `deepseek-v4-flash`, DeepSeek V4 thinks on by default, "its thinking streams as `delta.reasoning_content`, which AI SDK 4 drops (the same gap `packages/core/src/runtime/minimax-compat.ts` was written for), so nothing at all reached the watchdog for the ~50 s the model spent drafting." The fix was to widen the family, not to change any model default (`:125`). **Confidence: high.**

**Why Chat is excluded from the job thinking knob.** `[Direct]` the type comment at `packages/core/src/runtime/types.ts:54-58` states it, and `packages/core/src/runtime/ai-sdk-runtime.ts:270` carries the matching inline note. `[Supported]` `docs/internal/blockers-2026-09-15.md:226` closes blocker P1 with "Jobs send `{"reasoning_effort":"low"}` and nothing else (`packages/core/src/models/job-thinking.ts`, applied in `ai-sdk-runtime.ts` only when `execute` carries `jobMode`; Chat's body unchanged)." The reason to keep them apart is that Chat's effort is a user choice with a visible picker, and overriding it to `low` would silently disobey the user. **Confidence: high for the mechanism; the "would disobey the user" reading is `[Inferred]` from the picker's existence.**

**Why the job knob is `reasoning_effort: "low"` and not thinking-off.** See [`finance-parse-and-generate.md`](finance-parse-and-generate.md#why) — the same decision, recorded there because that is where it was driven.
