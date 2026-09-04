# Knowledge

Knowledge is an Account-rail page (like Usage), not a `PRODUCT_MODES` id. Soul, pinned Memory, and Sources persist in workspace SQLite. Chat injects soul + pinned memories + FTS-retrieved chunks.

## Sub-features

- `knowledge-rail` reaches `/knowledge` from `mode-knowledge` on every desk (Account group).
- `knowledge-tabs` switches Sources / Soul / Memory (`knowledge-tab-sources`, `knowledge-tab-soul`, `knowledge-tab-memory`).
- `knowledge-url` + `knowledge-add-url` indexes an HTTPS URL. `file://` fails.
- `knowledge-paste` + `knowledge-add-paste` indexes pasted text. `knowledge-file` uploads `.txt` / `.md` / `.csv` / `.json`.
- `knowledge-source-row` shows Indexed or Failed (never a fake Indexed).
- `knowledge-soul-name` / `knowledge-soul-role` / `knowledge-soul-voice` + `knowledge-soul-save` persist the soul.
- `knowledge-memory-input` + `knowledge-memory-add` pins a memory (`knowledge-memory-row`).
- Chat send injects that knowledge. Stub Chat still replies. Context popover (`chat-context`) lists Soul / Memories / Sources.

## How to get to it (user POV)

- Choose Knowledge on the Account rail (`mode-knowledge`).
- Open `http://127.0.0.1:3000/knowledge`.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- `mode-knowledge` is visible even on a Legal desk.

- **Open Knowledge.** Click `mode-knowledge`. URL matches `/knowledge`. `knowledge-page` and `knowledge-tabs` are visible.
- **Sources.** Paste notes in `knowledge-paste`. Click `knowledge-add-paste`. A `knowledge-source-row` shows Indexed.
- **Soul.** Click `knowledge-tab-soul`. Change `knowledge-soul-name`. Click `knowledge-soul-save`. Reload still shows the name.
- **Memory.** Click `knowledge-tab-memory`. Fill `knowledge-memory-input`. Click `knowledge-memory-add`. A pinned `knowledge-memory-row` appears.
- **Chat inject.** Open Chat. Click `chat-context`. Soul / Memories rows are present. Send a stub prompt. Chat still replies.

## Gotchas

- Knowledge is not a workspace mode checkbox. Hiding Finance/Data must not hide Knowledge.
- v1 extract is text-like only. PDF/Word should be Failed with a reason, not Indexed.
- URL fetch is HTTPS only, existing TLS rules, size-capped. GET settings still never returns the gateway key.
- Do not POST `/api/v1/knowledge/*` as a substitute for the page on a live proof.
