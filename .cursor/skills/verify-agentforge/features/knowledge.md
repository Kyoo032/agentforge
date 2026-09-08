# Knowledge

Knowledge is an Account-rail page (like Usage), not a `PRODUCT_MODES` id. Soul, pinned Memory, and Sources persist in workspace SQLite. The owner picks Embedding / Brain / Verifier models. Chat injects soul + pinned memories + RAG-retrieved chunks (vectors with FTS fallback). Map reviews the desk; stub map is valid. Sources also fill themselves: every finished Chat turn or job writes a text work card (see [knowledge-ingest.md](./knowledge-ingest.md)); the Sources tab shows that cycle as `knowledge-loop`.

## Sub-features

- `knowledge-rail` reaches `/knowledge` from `mode-knowledge` on every desk (Account group).
- `knowledge-tabs` switches Sources / Soul / Memory / Map (`knowledge-tab-sources`, `knowledge-tab-soul`, `knowledge-tab-memory`, `knowledge-tab-map`). Tab bodies: `knowledge-sources`, Soul/Memory fields, `knowledge-map-panel`.
- `knowledge-models` wraps Embedding / Brain / Verifier pickers (`knowledge-model-embedding`, `knowledge-model-brain`, `knowledge-model-verifier`) on every tab. Embedding is a flat Embeddings `<select>` (chat hide-lists must not strip those ids). Change persists via PUT models (seed from GET knowledge.models, else catalog defaults).
- `knowledge-url` + `knowledge-add-url` indexes an HTTPS URL. `file://` fails.
- `knowledge-paste` + `knowledge-add-paste` indexes pasted text. `knowledge-file` uploads `.txt` / `.md` / `.csv` / `.json`.
- `knowledge-source-row` shows type tag (`knowledge-source-type`), chunk count, and Indexed or Failed (never a fake Indexed; Failed carries the reason on hover). Types are `File` / `URL` / `Paste` for manual adds and `Chat` / `Documents` / `Research` / `Finance` / `Data` / `Images` / `Videos` / `Presentation` / `Edit` for auto cards.
- `knowledge-loop` (Sources tab, above Add a source) draws Work → Saved → Indexed → Retrieved → Work and one count bar per type (`knowledge-loop-count-<Type>`). Counts come from the same Sources list; with no sources it shows `knowledge-loop-empty`.
- `knowledge-soul-name` / `knowledge-soul-role` / `knowledge-soul-voice` + `knowledge-soul-save` persist the soul.
- `knowledge-memory-input` + `knowledge-memory-add` pins a memory (`knowledge-memory-row`).
- `knowledge-map-run` ("Map knowledge") builds a map; result under `knowledge-map` (overview, topics with Ready / Not ready + source tags, gaps). Stub map is a valid proof. Overview text may be markdown (`FormattedText`).
- Chat send injects that knowledge. Stub Chat still replies. Context popover (`chat-context` → `chat-context-breakdown`) lists Soul / Memories / Sources; Sources may show `N chunks · rag` or `fts`.

## How to get to it (user POV)

- Choose Knowledge Base on the Account rail (`mode-knowledge`).
- Open `http://127.0.0.1:3000/knowledge`.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- `mode-knowledge` is visible even on a Legal desk.

- **Open Knowledge.** Click `mode-knowledge`. URL matches `/knowledge`. `knowledge-page`, `knowledge-tabs`, and `knowledge-models` are visible. Model pickers (`knowledge-model-embedding`, `knowledge-model-brain`, `knowledge-model-verifier`) are present.
- **Sources.** `knowledge-sources` and `knowledge-loop` are visible. Paste notes in `knowledge-paste`. Click `knowledge-add-paste`. A `knowledge-source-row` shows Indexed plus a `Paste` type tag / chunk count, and `knowledge-loop-count-Paste` appears (or its `data-count` grows). A fresh desk that already had a Chat send shows a `Chat` row too — that is the ingest loop, not stray data.
- **Soul.** Click `knowledge-tab-soul`. Change `knowledge-soul-name`. Click `knowledge-soul-save`. Reload still shows the name.
- **Memory.** Click `knowledge-tab-memory`. Fill `knowledge-memory-input`. Click `knowledge-memory-add`. A pinned `knowledge-memory-row` appears.
- **Map.** Click `knowledge-tab-map`. `knowledge-map-panel` is visible. Click `knowledge-map-run`. `knowledge-map` shows overview / topics (Ready or Not ready + source) / gaps (stub is fine).
- **Chat inject.** Open Chat. Click `chat-context`. `chat-context-breakdown` lists Soul / Memories / Sources. Send a stub prompt. Chat still replies.

## Gotchas

- Knowledge is not a workspace mode checkbox. Hiding Finance/Data must not hide Knowledge.
- v1 extract is text-like only. PDF/Word should be Failed with a reason, not Indexed.
- URL fetch is HTTPS only, existing TLS rules, size-capped. GET settings still never returns the gateway key.
- Do not POST `/api/v1/knowledge/*` as a substitute for the page on a live proof.
- Only Map triggers a generate; picking models only PUTs the saved ids.
- Pasted / uploaded / URL text goes through the injection guard like auto cards: "Ignore all previous instructions…" pasted into `knowledge-paste` gives a `Failed` row (`injection_blocked`), not `Indexed`. That is correct; the owner bypass in Settings lifts it.
- Offline with a saved key: the first KB write after the gateway goes dark takes ~4 s, then everything is instant for 5 min (local vectors + FTS). Chat fails within ~10 s with "Gateway unreachable"; Settings save within ~8 s. Nothing here needs the internet.
- Work cards never copy files into `data/media/knowledge/`; only `knowledge-file` uploads write there. `addFileSource` is text extract only.
- Chat's context popover `Sources` count excludes the current thread's own card (anti-loop). A thread that only has its own card shows `0 chunks`.
- Webdev doctor reports `knowledge: true` when `GET /api/v1/knowledge` is 200. If `false`, do not treat Chat as broken — skip this feature.
