# Chat

Chat is the default assistant: model picker, composer, thinking toggle, usage chip, and its own sessions at `/chat`. Stub replies without a gateway key; a saved key uses the live Toko Token gateway.

A turn is three layers: **Thinking** (collapsible), **tools** (one row per call), **output** (the answer only — never a copy of the prompt, never a `Stub reply` prefix).

## Sub-features

- `chat-open` shows the empty Chat home with composer, model picker, and wrapping composer toolbar (`composer-toolbar`). Header chips sit in `chat-header`.
- `chat-usage` shows the Chat header chip (`chat-usage`): loading (`…`), then `No key saved` (stub / needs_key), `Unlimited`, `<used> used · <left> left`, or `Usage unavailable`.
- `chat-context` shows the Chat header context chip (`chat-context`): estimated tokens in this thread vs the selected model’s `contextLength` (`<used> / <window>`, or `<used> used` if the catalog has no window).
- `chat-thinking` shows `thinking-toggle` next to the model picker. On by default. Off skips reasoning events. Reasoning models also carry a `model-thinking-badge` in the picker.
- `chat-send` puts the user prompt in the transcript and returns the send button to `Send`.
- `chat-new` starts a blank session from `new-chat` without losing the previous thread in the list.
- `chat-switch` reopens the first thread from `thread-list`.
- `chat-rail` keeps `mode-chat` visible. On Home, Documents/Research/Images/Videos/Presentation are also visible. `mode-agents` count is 0.

## How to get to it (user POV)

- Open `http://127.0.0.1:3000/chat`.
- Choose `Chat` on the left rail (`mode-chat`).
- `/` redirects to the first visible mode (Chat on Home).
- `/agents/<uuid>` redirects to Chat (Build is parked).

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0 against `http://127.0.0.1:3000`.
- You are proving Chat at `/chat`.
- Unique prompt text, e.g. `VERIFY chat <run-id>: What is 2 + 3?`.
- `runtime: "stub"` for a stub-proof send. If doctor says `ai`, say so and treat the reply as live.

- **Open Chat.** Go to `/chat`. `model-picker`, `composer`, `composer-toolbar`, `thinking-toggle`, and `chat-empty` are visible. `chat-empty` contains `Ask anything`. `mode-chat` plus the other work modes are visible. `mode-agents` count is 0.
- **Usage chip.** `chat-usage` is visible in the Chat header (next to `new-chat`). On stub / no key, it settles on `No key saved`.
- **Context chip.** `chat-context` is visible in the Chat header. Empty chat with a known window is `0 / <window>`. After messages exist, used tokens are greater than 0.
- **Send (short).** Fill `composer-text` with the unique prompt. Click `composer-send`. `message-list` contains that prompt (20s). On stub with thinking on, `message-thinking` is present. Arithmetic like `What is 2 + 3?` shows `message-tools` (Calculator) and `message-output` equal to `2 + 3 = 5` — not the question, not `Stub reply`. `composer-send` reads `Send` again (30s). After refresh, thinking + tool + output stay on the turn (they do not vanish).
- **Longer task.** Same transcript layout if several tools fire (search, then calculator, then prose): stacked `message-tool` rows, then `message-output`.
- **New session.** Click `new-chat`. `chat-empty` contains `Ask anything` again (10s).
- **Second send.** Fill and send a second unique prompt. `message-list` and `thread-list` contain it.
- **Switch.** Click the `thread-item` whose text is the first prompt. `message-list` contains the first prompt and its answer.
- **IDE proof.** Screenshot under `evidence/chat/<run-id>/` showing thinking, a tool row, and output.
- **Cloud.** Same steps via `page.getByTestId` in `foundation.spec.ts` (do not run that spec on Windows).

## Gotchas

- `new-chat` is the header button on the Chat page. `new-chat-link` is the `+ New chat` control in the session rail. The smoke uses `new-chat`.
- Wait for `composer-send` text `Send`, not a fixed sleep. Stub and live both hold the button in a busy state.
- `chat-usage` loads asynchronously from `/api/v1/settings`. Assert the settled label, not the initial `…`.
- Empty-state “paste a … key” uses ping `gatewayName` (Toko Token on webdev). Local flavor windows say AIHub — [desktop-brands.md](./desktop-brands.md).
- `chat-context` is a local estimate (~4 characters per token) from visible text and thinking, not the gateway tokenizer.
- Cursor's browser overlay can inject `data-cursor-ref` and eat clicks. Report it; do not retry by coordinates forever.
- Sending on `runtime: "ai"` spends the operator's gateway. Do not do that as a silent stub check.
- MiniMax M3 (`minimax-m3`) streams thinking in `reasoning_content`. That belongs in `message-thinking`, not in `message-output`.
- Arithmetic fires calculator. The **output** is `2 + 3 = 5`. The tool row stays visible after the run.
- Do not POST `/api/v1/chat` as a substitute for the composer.
- Documents / Research / Presentation collect `assistant.delta` only (JSON/markdown output). They ignore thinking events on purpose so drafts are not polluted with chain-of-thought.
