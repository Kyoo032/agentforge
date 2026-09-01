# Chat

Chat is the default assistant: model picker, composer, usage chip, and its own sessions. No account. Stub replies without a gateway key; a saved key uses the live Toko Token gateway.

## Sub-features

- `chat-open` shows the empty Chat home with composer and model picker.
- `chat-usage` shows the Chat header chip (`chat-usage`): loading (`…`), then `No key saved` (stub / needs_key), `Unlimited`, `<used> used · <left> left`, or `Usage unavailable`.
- `chat-send` puts the user prompt in the transcript and returns the send button to `Send`.
- `chat-new` starts a blank session from `new-chat` without losing the previous thread in the list.
- `chat-switch` reopens the first thread from `thread-list`.
- `chat-rail` keeps `mode-chat` visible; Documents/Research/Images/Videos/Presentation stay absent until an agent unlocks them.

## How to get to it (user POV)

- Open `http://127.0.0.1:3000/chat`.
- Choose `Chat` on the left rail (`mode-chat`).
- `/` redirects to the first visible mode (Chat on a default desk).

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0 against `http://127.0.0.1:3000`.
- You are proving Chat, not a specialist agent (`/agents/<uuid>` is Build).
- Unique prompt text, e.g. `VERIFY chat <run-id>: What is 2 + 3?`.
- `runtime: "stub"` for a stub-proof send. If doctor says `ai`, say so and treat the reply as live.

- **Open Chat.** Go to `/chat`. `model-picker`, `composer`, and `chat-empty` are visible. `chat-empty` contains `Ask anything`. `mode-chat` and `mode-agents` are visible. `mode-images`, `mode-videos`, `mode-presentations`, `mode-documents`, `mode-research` have count 0 unless this workspace already has a custom agent.
- **Usage chip.** `chat-usage` is visible in the Chat header (next to `new-chat`). On stub / no key, it settles on `No key saved` (may briefly show `…` while loading). With a live key saved, expect `Unlimited` or `<used> used · <left> left` (USD); `Usage unavailable` means the host could not read this-key usage — record it, do not treat as a Chat send fail.
- **Send.** Fill `composer-text` with the unique prompt. Click `composer-send`. `message-list` contains that prompt (20s). On stub, the assistant text starts with `Stub reply (text /` and includes the prompt (or `ready`). `composer-send` reads `Send` again (30s). `thread-list` contains the prompt.
- **New session.** Click `new-chat`. `chat-empty` contains `Ask anything` again (10s).
- **Second send.** Fill and send a second unique prompt. `message-list` and `thread-list` contain it.
- **Switch.** Click the `thread-item` whose text is the first prompt. `message-list` contains the first prompt.
- **IDE proof.** Screenshot + snapshot under `evidence/chat/<run-id>/` showing the prompt in the transcript, the thread list, and the usage chip.
- **Cloud.** Same steps via `page.getByTestId` in `foundation.spec.ts` (do not run that spec on Windows).

## Gotchas

- `new-chat` is the header button on the Chat page. `new-chat-link` is the `+ New chat` control in the session rail. The smoke uses `new-chat`.
- Wait for `composer-send` text `Send`, not a fixed sleep. Stub and live both hold the button in a busy state.
- `chat-usage` loads asynchronously from `/api/v1/settings`. Assert the settled label, not the initial `…`.
- Cursor's Next overlay can inject `data-cursor-ref` and eat clicks. Report it; do not retry by coordinates forever.
- Sending on `runtime: "ai"` spends the operator's gateway. Do not do that as a silent stub check.
- MiniMax M3 (`minimax-m3`) streams thinking in `reasoning_content` / `reasoning_details` unless Agentforge rewrites the chunk. Live proof is the operator desktop against Toko Token, **not** Hermes serve. Stub Chat does not exercise MiniMax.
- Arithmetic in the prompt (`2 + 3`) can fire the calculator tool in stub if that binding is on. Assert the user prompt and `Send`, not a fixed assistant sentence.
- Do not POST `/api/v1/chat` as a substitute for the composer.
