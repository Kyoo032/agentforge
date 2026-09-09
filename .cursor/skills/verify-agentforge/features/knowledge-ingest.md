# Knowledge ingest loop

Every finished piece of work becomes a **text work card** in the Knowledge Base without the user doing anything: Chat turns, Images / Videos / Edit generates, Research dossiers, Data analyses, Finance briefs, Documents drafts, Presentation outlines. Bytes stay where they already live (`media` rows, `artifacts` rows); the card carries title, mode, prompt excerpt, a pointer (`media:<id>` / `artifact:<id>` / `thread:<id>`), and a capped body (≤ 8k chars). Chat retrieves cards, never mp4s. The Sources tab shows the cycle as `knowledge-loop`. Stub runtime indexes too, so a webdev stub proof is valid.

## Sub-features

- `knowledge-loop` on the Sources tab: cycle diagram `knowledge-loop-cycle` (Work → Saved → Indexed → Retrieved → Work), summary `knowledge-loop-summary` (`knowledge-loop-work`, `-manual`, `-indexed`, `-failed`, `-chunks`, each with `data-value`), and one bar per type `knowledge-loop-count-<Type>` with `data-count` (or `knowledge-loop-empty` when there are no sources). Work types carry an `auto` tag.
- `knowledge-source-type` tag on every `knowledge-source-row`. Auto types: `Chat`, `Documents`, `Research`, `Finance`, `Data`, `Images`, `Videos`, `Presentation`, `Edit`. Manual types stay `File`, `URL`, `Paste` (legacy `Dossier` / `Analysis` / `Brief` still exist for text-only sends).
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
