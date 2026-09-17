# Knowledge ingest loop

Every finished piece of work becomes a **text work card** in the Knowledge Base without the user doing anything: Chat turns, Images / Videos / Edit generates, Research dossiers, Data analyses, Finance briefs, Documents drafts, Presentation outlines. Bytes stay where they already live (`media` rows, `artifacts` rows); the card carries title, mode, prompt excerpt, a pointer (`media:<id>` / `artifact:<id>` / `thread:<id>`), and a capped body (≤ 8k chars). Chat retrieves cards, never mp4s. The Sources tab shows the cycle as `knowledge-loop`. Stub runtime indexes too, so a webdev stub proof is valid. Per-surface detail — what triggers each mode's card, what text lands in it, what is left out, who can retrieve it and what a delete removes — is [`docs/internal/maps/knowledge-flows.md`](../../../../docs/internal/maps/knowledge-flows.md); the pipeline underneath it is [`docs/internal/maps/knowledge-ingest-loop.md`](../../../../docs/internal/maps/knowledge-ingest-loop.md).

## Sub-features

- `knowledge-loop` on the Sources tab is the **Knowledge health** strip as of 2026-09-17. The six-box cycle diagram is gone: **`knowledge-loop-cycle` no longer exists, and neither does `knowledge-loop-stage-Graph`** — do not assert either, and do not file their absence. What is there: the Verified pill `knowledge-loop-verified`, carrying `data-state` and a new `data-tone` of `pass` / `stale` / `fail` / `never` (a pass older than 24 h reads `stale` — not a failure and not proof); the self-check button `knowledge-loop-verify`; and `knowledge-loop-summary`, now the wrapper around stat tiles `knowledge-loop-work`, `-manual`, `-indexed`, `-retrieved`, `-chunks`, each with `data-value`. `knowledge-loop-failed` renders **only when something failed**. The stage testids `knowledge-loop-stage-<Work|Saved|Indexed|Retrieved|Verified>` ride on the tiles they became, so an older recipe still finds its numbers — but on the `Saved` tile the stage's `data-value` is the total while the tile's own number is the manual count. `knowledge-loop-count-<Type>` with `data-count` now sits in the one-line breakdown `knowledge-loop-counts`, which renders **only when more than one type has sources** — a desk holding only Chat cards shows no by-type line at all, and the per-bar `auto` tag went with the bars. `knowledge-loop-empty` still paints when there are none.
- `knowledge-file` reaches ten more formats on the host — `.pptx .ppt .xlsx .xls .ods .odt .odp .doc .rtf .epub`, plus `.html` — through one local converter. **The picker's `accept` was not widened with it**, so the OS dialog still offers only `.txt,.md,.csv,.json,.pdf,.docx`; drive the new formats with a `POST`, not a click. A scanned PDF is refused locally as `document_needs_ocr` and **nothing is uploaded** — there is no hosted OCR anywhere on this path, and a network call during a document upload is a fail. An upload that cannot be read is now a **4xx with no row**, not a `Failed` row answered `201`.
- `knowledge-source-type` tag on every `knowledge-source-row`. Auto types, all eleven: `Chat`, `Documents`, `Research`, `Finance`, `Data`, `Market`, `Legal`, `Images`, `Videos`, `Presentation`, `Edit`. `Market` and `Legal` used to be missing from the renderer's `WORK_SOURCE_ORDER`, so their cards counted as manual; **both were fixed on 2026-09-17** (`apps/web/lib/knowledge-loop.ts:22-34`). Manual types stay `File`, `URL`, `Paste` (legacy `Dossier` / `Analysis` / `Brief` still exist for text-only sends).
- Chat writes **one card per thread**, rewritten after each completed assistant turn (latest user + assistant only). Retrieval for that thread skips its own card (`knowledgeInjection` / `GET /api/v1/knowledge/context?threadId=`), so Chat never reads its last reply back.
- Idempotent origin: `(workspace, origin_kind, origin_id)` is unique. Re-generating the same media / artifact / thread updates the row; it does not add a duplicate.
- `*-send-kb` (Research / Data / Finance) is idempotent: when the job already indexed that artifact the note reads `Already in the Knowledge Base.`; otherwise it indexes once as the work type and later clicks say already.
- Index failure never fails the work: the generate still succeeds and the row shows `Failed` with the reason on hover.
- Cards are PII-masked (`[email]` / `[phone]` / card tokens, same as the outbound prompt) because chunks are plaintext FTS while messages are sealed. A card whose text trips the injection guard is recorded `Failed` with `injection_blocked (rule: …)` and zero chunks; it is never retrieved. The owner bypass (`injectionGuardBypass` in Settings) applies here too.
- Deleting a thread (`thread-delete`) or a saved artifact removes its card. A source that lists a deleted thread's `thread:<id>` pointer is a bug.
- Example clips on Videos (`videos-example-use-*`) load a prompt only. They never `POST /api/v1/videos`, so they never add a source.

## How to get to it (user POV)

- Send anything in Chat, or finish any job mode, then open Knowledge Base on the Account rail (`mode-knowledge`) → Sources.
- Open `http://127.0.0.1:3000/knowledge` after a send.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0 and reports `knowledge: true`.
- Stub or live both count. On `runtime: "ai"` a Chat send spends the operator's gateway; say so.
- Live Images / Videos generate only when the operator asked.

- **Baseline.** Open `/knowledge`. `knowledge-loop` is visible on the Sources tab. Note `knowledge-loop-work` `data-value` (call it W) and whether a `knowledge-loop-count-Chat` row exists.
- **Chat card.** Open `/chat`, click `new-chat`, send a unique prompt (`VERIFY ingest <run-id>: What is 2 + 3?`), wait for `composer-send` to read `Send`. Back on `/knowledge`: a `knowledge-source-row` with `knowledge-source-type` = `Chat` and the thread title as name is present and reads `Indexed`. `knowledge-loop-work` is W + 1 (or W if that thread already had a card) and `knowledge-loop-count-Chat` exists with `data-count` ≥ 1.
- **One row per thread.** Send a second prompt in the same thread. The Chat row count for that thread stays 1; its name / chunks may change. `knowledge-loop-count-Chat` `data-count` is unchanged.
- **Skip-self.** In that thread, click `chat-context` → `chat-context-breakdown`. `Sources` may read `0 chunks` even though the thread's own card is indexed; that is the anti-loop, not a retrieval bug. A different new thread asking the same question may show `1 chunks · rag`.
- **Videos does not ingest on example use.** Open `/videos`, click a `videos-example-use-*`. Reload `/knowledge`: no new `Videos` row, `knowledge-loop-work` unchanged.
- **Live generate (operator asked only).** Generate on Videos or Images. `/knowledge` shows a `Videos` / `Images` row named after the prompt, `Indexed`, chunks ≥ 1; the gallery keeps the clip; nothing appears under `data/media/knowledge/`.
- **Send to KB idempotent (live Research only).** After a dossier, click `research-send-kb`. `research-actions-note` reads `Already in the Knowledge Base.`; `/knowledge` shows one `Research` row for it, not a `Dossier` copy.
- **Unit.** `packages/host/src/knowledge-ingest.test.ts` (upsert twice → one source; retrieve excludes own thread; empty card skipped), `work-cards.test.ts`, `packages/db/src/ensure-schema.test.ts` (origin columns + unique index + heal), `apps/web/lib/knowledge-loop.test.ts`.
- **IDE proof.** Screenshot of `knowledge-loop` with a `Chat` bar and the matching `knowledge-source-row` under `evidence/knowledge-ingest/<run-id>/`.

## Gotchas

- A stub Chat reply is still indexed (stub embeddings + FTS). That is the product's own test mode, not a mock.
- The Chat card is the *latest exchange only*. Do not expect earlier turns of a long thread to be retrievable from that thread's card.
- Chat cards are fire-and-forget after the stream ends; reload `/knowledge` once if the row is not there within a second.
- Do not read `data/media/knowledge/` as proof of Images / Videos ingest. Nothing is written there for work cards; the pointer is `media:<id>`.
- Failed rows are correct output when the embed or write fails; the generate must still have returned its result.
- Documents / Presentation generate now also saves a `draft` artifact (mode `documents` / `presentations`). The saved-artifact picker on those studios lists them.
- Type `test@example.com` in Chat and the Chat row name / chunk reads `[email]`, not the address. Raw PII in `knowledge_chunks` is a fail.
- "Ignore all previous instructions…" in a turn gives a `Failed` Chat row (`injection_blocked`), not `Indexed`. That is the guard working; the next clean turn flips it back to `Indexed`.
- Older sources (before origin columns) have no origin; `Send to Knowledge Base` on an artifact from before this change indexes it once as the work type, then reports already.
- **The graph sweep landed on 2026-09-17.** A deleted source or thread used to leave its node and its `cites` / `retrieved` edges behind, so the graph could show more than the Sources list did. `packages/host/src/knowledge-graph-prune.ts` now cascades inside the delete transaction and `sweepOrphanGraph` repairs older residue on every `GET /api/v1/knowledge`. A node for a row that is no longer in Sources is now worth filing — but reload the page once first, since the sweep runs on that read.
- `knowledgeRetrievals` (doctor, and the `knowledge-loop-retrieved` tile) is one row per injected chunk. Retrieval rows are dropped with their source now, so the number is no longer strictly monotonic — but it still only ever counts *completed* runs, so use it to prove a retrieval happened, not to size the knowledge base.
- **Market auto-ingest landed on 2026-09-17.** A completed `POST /api/v1/market` now writes its own card through `upsertWorkSource`, `Market` is a real work type, and a briefing sent with `market-send-kb` is filed from the artifact's own mode rather than the client's label — so a Market briefing no longer files itself as `Finance`. Both the auto card and the button write the same origin row, so one delete covers both.
- A media card holds the **prompt and the settings only** — `Prompt:` / `Aspect:` / `Duration:` / `File: /api/v1/media/<id>/file`. There is no caption, no alt-text and no vision read anywhere on that path, so an Images / Videos / Edit row can never answer a question about what the picture shows, only about what was asked for.
