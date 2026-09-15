# Chat

Chat is the default assistant: model picker, composer, thinking toggle, usage chip, and its own sessions at `/chat`. Stub replies without a gateway key; a saved key uses the live Toko Token gateway.

A turn is three layers: **Thinking** (collapsible), **tools** (one row per call), **output** (the answer only — never a copy of the prompt, never a `Stub reply` prefix).

## Sub-features

- `chat-open` shows the empty Chat home with composer, model picker, and the single-row composer toolbar (`composer-toolbar`). Header chips sit in `chat-header`.
- `chat-model-switch` — clicking `model-picker` opens `model-picker-panel`, a **portalled** (`document.body`, `fixed`) list placed above the composer. Every option must be clickable with the mouse, not only reachable by Ctrl/Cmd+K and arrows. Clicking one changes the trigger label, survives a reload (`agentforge-chat-model`), and the next send posts that id in the run body. The trigger must stay readable on a narrow pane — `model-picker` `clientWidth` ≥ ~110px down to a 640px window; below that the composer toolbar wraps (Attach/Enhance move to another row) and `composer-send` stays visible and clickable inside `composer`.
- `chat-usage` shows the Chat header chip (`chat-usage`): loading (`…`), then `No key saved` (stub / needs_key), `Unlimited`, `<used> used · <left> left`, or `Usage unavailable`.
- `chat-context` shows the Chat header context chip (`chat-context`): a ring plus a short label (`<N> left` or `<N> used`). Click opens `chat-context-breakdown` with Conversation, Attachments, Knowledge (Soul / Memories / Sources, including RAG `N chunks · rag` or `fts` when retrieve ran), and Free. The `used / window` (empty: `0 / window`) line lives **inside the breakdown**, not on the closed chip. Sources excludes the thread's own work card (`threadId` on the context call).
- `chat-ingest` — every completed assistant turn rewrites one `Chat` work card per thread in the Knowledge Base (latest user + assistant, capped). `/knowledge` shows a `Chat` row named after the thread. Retrieval for that thread skips it. See [knowledge-ingest.md](./knowledge-ingest.md).
- `chat-enhance` rewrites the composer draft via `composer-enhance` (`POST /api/v1/prompts/enhance`). Stub rewrites locally. `composer-enhance-revert` / `aria-pressed` restores the pre-enhance text. A second sparkle after an edit treats the box as a new seed. Cancel aborts and does not replace the box.
- `chat-thinking` shows `reasoning-effort` next to the model picker, labeled **Thinking** (`Off` / `Light` / `Normal` / `Deep` / `Extra` / `Max` / `Ultra`). Values stay `none` / `low` / `medium` / `high` / `xhigh` / `max` / `ultra`. Default `medium` (Normal). Switching models does **not** yank the picker — the host snaps silently per model+wire. `Off` skips thinking events unless the model forbids `none` (GPT-6 → Light on the wire). Reasoning models also carry a `model-thinking-badge` in the picker. There is **no** `chat-wire` control.
- `chat-send` puts the user prompt in the transcript and returns the send button to `Send`. **Enter** sends (`submitOnEnter`); Shift+Enter stays newline. Packaged window must do this, not only `:3000`.
- `chat-keep-alive` — switching Chat ↔ Documents (or any rail job mode) must not unmount the visited mode. Drafts and in-flight runs survive. `WorkModeKeepAlive` keeps visited modes mounted.
- `chat-fail-closed` — a gateway 400/403 (illegal `temperature`, no access, quota) surfaces on `chat-error` / `composer-error`. Running/Thinking must clear (`onFailed` sets `running` false). Do not hang.
- `chat-probe` — host still retries contacting the model up to 3 times internally. The UI stays `Thinking…` (`thinking-placeholder` inside `message-thinking`) and `Sending…` on `composer-send`. Probe copy (`Probing`, `1st try`) must not appear on the frontend. After 3 failed tries, `chat-error` / `composer-error` reads `Could not reach {model} after 3 tries`. Packaged window must do this, not only `:3000`.
- `chat-new` starts a blank session from `new-chat` without losing the previous thread in the list. The model picker keeps its current value (does not snap to the catalog default).
- `chat-switch` reopens the first thread from `thread-list`. The picker restores that thread's last model from localStorage. If the destination thread has no stored model (or the stored id left the catalog), the picker keeps its current value — never the catalog default. First Chat load uses last-used (`agentforge-chat-model`), then catalog default.
- `chat-rail` keeps `mode-chat` visible. On Default, Documents/Research/Images/Videos/Presentation are also visible. `mode-agents` count is 0.

## How to get to it (user POV)

- Open `http://127.0.0.1:3000/chat`.
- Choose `Chat` on the left rail (`mode-chat`).
- `/` redirects to the first visible mode (Chat on Default).
- `/agents/<uuid>` redirects to Chat (Build is parked).

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0 against `http://127.0.0.1:3000`.
- You are proving Chat at `/chat`.
- Unique prompt text, e.g. `VERIFY chat <run-id>: What is 2 + 3?`.
- `runtime: "stub"` for a stub-proof send. If doctor says `ai`, say so and treat the reply as live.

- **Open Chat.** Go to `/chat`. `model-picker`, `composer`, `composer-toolbar`, `reasoning-effort`, and `chat-empty` are visible. `reasoning-effort` value is `medium` and shows **Normal**. Options are Off / Light / Normal / Deep / Extra / Max / Ultra. `chat-wire` count is 0. `chat-empty` headline is `You're in. Ask anything.` `mode-chat` plus the other work modes are visible. `mode-agents` count is 0.
- **Usage chip.** `chat-usage` is visible in the Chat header (next to `new-chat`). On stub / no key, it settles on `No key saved`.
- **Context chip.** `chat-context` is visible in the Chat header. Closed chip text includes `left` or `used` (not `0 / window`). Click it: `chat-context-breakdown` shows Conversation / Attachments / Knowledge / Free, and the `used / window` line (empty thread: `0 / <window>`). After messages exist, used tokens are greater than 0.
- **Enhance.** Fill `composer-text`. Click `composer-enhance`. The box is rewritten (stub: same language, no “Enhanced prompt:” preface). Click again (`composer-enhance-revert` or `aria-pressed`) to restore. Send stays disabled while enhance is busy.
- **Send (short).** Fill `composer-text` with the unique prompt. Press Enter (or click `composer-send`). Before tokens, `composer-send` reads `Sending…` and `message-thinking` shows `thinking-placeholder` `Thinking…` (not `Probing` / `1st try`). `message-list` contains that prompt (20s). Shift+Enter must not send. On stub with thinking on, `message-thinking` is present. Arithmetic like `What is 2 + 3?` shows `message-tools` (Calculator) and `message-output` text `2 + 3 = 5` — not the question, not `Stub reply`. Assistant `message-output` renders markdown (bold/lists/links/images); user bubbles stay plain. `composer-send` reads `Send` again (30s). After refresh, thinking + tool + output stay on the turn (they do not vanish).
- **Longer task.** Same transcript layout if several tools fire (search, then calculator, then prose): stacked `message-tool` rows, then `message-output`.
- **New session.** Click `new-chat`. `chat-empty` shows `You're in. Ask anything.` again (10s).
- **Second send.** Fill and send a second unique prompt. `message-list` and `thread-list` contain it.
- **Knowledge card.** Open `/knowledge`. One `knowledge-source-row` with type `Chat` exists for this thread (not one per turn), `Indexed`, and `knowledge-loop-count-Chat` shows `data-count` ≥ 1.
- **Switch.** Click the `thread-item` whose text is the first prompt. `message-list` contains the first prompt and its answer.
- **IDE proof.** Screenshot under `evidence/chat/<run-id>/` showing thinking, a tool row, and output.
- **Cloud.** Same steps via `page.getByTestId` in `foundation.spec.ts` (do not run that spec on Windows).

## Gotchas

- The composer toolbar **wraps** (`flex flex-wrap items-end`); its left group must never go back to `overflow-hidden`. It used to clip, which hid the model palette (a thin sliver in the 32px toolbar row, clicks falling through to `message-list`) and squeezed the trigger to 18px on narrow panes. Any popover anchored in that group (model picker, and anything added next to it) **must** be portalled to the body and positioned with `placePickerPanel` (`apps/web/lib/picker-panel.ts`). Playwright still calls a clipped option "visible", so assert the click actually changes the trigger label — a visibility check alone will not catch it.
- With the rail expanded, a 480px window leaves the chat pane ~48px wide (rail 232 + thread list 199 are fixed, no responsive auto-collapse), so everything in the pane overflows. Collapse the rail (`rail-collapse`) before judging narrow-pane layout, or verify at ≥640px.
- `new-chat` is the header button on the Chat page. `new-chat-link` is the `+ New chat` control in the session rail. The smoke uses `new-chat`.
- Wait for `composer-send` text `Send`, not a fixed sleep. Stub and live both hold the button in a busy state.
- Live contact miss (no channel, 502/503, network): host retries the same model up to 3 times internally. The UI stays `Sending…` / `Thinking…` — do not require `1st try` labels on the frontend. Then `chat-error` / `composer-error` reads `Could not reach {model} after 3 tries`. Do not treat that as a harness fail if the gateway is down.
- GPT-6 with Thinking **Off** snaps to **Light** on the wire (`none` is not allowed). The picker still says Off.
- Host auto-routes the POST path. Product Chat does not send `wire` (always auto). GPT-5 / GPT-6 / o-series → `/v1/responses`; Claude 5 / Opus 4.7 / 4.8 / Sonnet 4.6 → `/v1/messages` with the gateway key as `x-api-key` + `anthropic-version: 2023-06-01`; Gemini chat → `/v1beta/models/{id}:generateContent` (404 falls back to Completions); else `/v1/chat/completions`. Probe is still only `GET /v1/models`. Claude 5 never sends `thinking: { type: "enabled", budget_tokens }`. Off → `thinking: { type: "disabled" }`; thinking on → `thinking: { type: "adaptive" }` + `output_config.effort` after a silent closest snap (Ultra → `max` on Messages; Extra → `xhigh`; Max stays `max`). Toko Completions keeps Ultra as `ultra`. Official OpenAI Completions/Responses snap Ultra → `max` (never `xhigh`, never send `ultra`).
- A thinking **400** is a bad request for that send — not a signal to try another path. Fallback is 404-only to Completions.
- A 403 (`no access` / quota) must fail closed in seconds, not sit on Running until the 60s idle watchdog.
- `chat-usage` loads asynchronously from `/api/v1/settings`. Assert the settled label, not the initial `…`.
- Empty-state “paste a … key” uses ping `gatewayName` (Toko Token on webdev). Local flavor windows say AIHub — [desktop-brands.md](./desktop-brands.md).
- `chat-context` is a local estimate (~4 characters per token) from visible text and thinking, not the gateway tokenizer.
- Cursor's browser overlay can inject `data-cursor-ref` and eat clicks. Report it; do not retry by coordinates forever.
- Sending on `runtime: "ai"` spends the operator's gateway. Do not do that as a silent stub check.
- MiniMax M3 (`minimax-m3`) streams thinking in `reasoning_content`. That belongs in `message-thinking`, not in `message-output`.
- Arithmetic fires calculator. The **output** is `2 + 3 = 5`. The tool row stays visible after the run.
- Do not POST `/api/v1/chat` as a substitute for the composer.
- Documents / Research / Presentation collect `assistant.delta` only (JSON/markdown output). They ignore thinking events on purpose so drafts are not polluted with chain-of-thought.
- The Chat work card is written after the stream closes (fire-and-forget). If `/knowledge` does not show the row at once, reload once. A thread with only media output (no assistant text) writes no card.
