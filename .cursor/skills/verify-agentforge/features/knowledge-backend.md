# Knowledge backend

Which engine answers retrieval for a desk. Built-in SQLite hybrid search is the default and never goes away; WeKnora is a bundled offline sidecar the owner can select when the host reports it installed. The Knowledge page shows the choice as a small card under `knowledge-models` (`knowledge-backend`), visible on every tab. `id` is the engine answering right now, `selected` is the owner's choice — they differ when WeKnora is selected but degraded, and then built-in keeps answering while writes queue in an outbox. Ingest always dual-writes agentforge SQLite, so WeKnora is never the only path to a working knowledge base. See [knowledge.md](./knowledge.md) for the rest of the page and [knowledge-ingest.md](./knowledge-ingest.md) for the work-card loop.

## Sub-features

- `knowledge-backend` (Knowledge page, directly under `knowledge-models`, on every tab) holds the whole choice. It only renders when `GET /api/v1/knowledge` carries a `backend` block; an older host shows `knowledge-backend-unsupported` instead and nothing else.
- `knowledge-backend-builtin` / `knowledge-backend-weknora` are the two radio options. `knowledge-backend-weknora` is `disabled` with the host's `reason` as its hover title when the host reports `available: false` (no binary staged, bootstrap failed, unsupported platform).
- `knowledge-backend-status` is one sentence plus machine handles: `data-id` (engine answering), `data-selected` (owner's choice), `data-health` (`ok` / `down` / `unknown`), `data-outbox` (queued writes). The sentence reads `Built-in search`, `WeKnora · healthy · 0 queued`, `WeKnora selected · degraded, built-in answering · 3 queued`, or `WeKnora not installed: <reason>`. Hovering shows the host's health detail.
- `knowledge-backend-apply` ("Switch") PUTs `/api/v1/knowledge/backend` with the picked id. It is disabled until the picked option differs from `data-selected`. While it runs, `knowledge-backend-busy` reads `Starting WeKnora… the first switch can take up to 30 seconds.` (or `Switching back to built-in search…`) and both radios are disabled.
- `knowledge-backend-error` renders the host's message inline when the PUT fails — a 409 `backend_unavailable` is the expected failure when WeKnora is not installed or not healthy. It is a real answer, not a harness fault.
- `knowledge-backend-reindex` ("Re-index existing sources") appears **only** while `data-selected` is `weknora`. It POSTs `/api/v1/knowledge/backend/reindex` and then `knowledge-backend-queued` shows the returned count with `data-queued`. The queue drains through `data-outbox` on later loads.
- Every action reloads the page data, so `knowledge-backend-status`, the `knowledge-loop` chart, and the source list all reflect the new state without a manual refresh.
- Chat's context popover is where the engine is visible from the user side: `chat-context` → `chat-context-breakdown` → Sources reads `<k> chunks · weknora` when the sidecar answered and `<k> chunks · fts (degraded)` when it did not. The page never hard-codes those words; whatever the host reports is what is shown.

## How to get to it (user POV)

- Choose Knowledge Base on the Account rail (`mode-knowledge`), then read the card under Models — it is on Sources, Soul, Memory, and Map alike.
- Open `http://127.0.0.1:3000/knowledge` (or `:3100` on the isolated verify instance).

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0 and reports `knowledge: true`.
- Drive the **isolated instance on `PORT=3100`** with its own data dir and its own sidecar data dir, started with `AGENTFORGE_WEKNORA_PATH` pointing at the staged binary. `:3000` is the operator's live desk — never start, restart, or kill anything on it, and never switch its backend.
- Without `AGENTFORGE_WEKNORA_PATH` (or on a host with no staged binary) the WeKnora option is disabled. That is the "not installed" path below, not a skip.

- **Read the card.** Open `/knowledge` on :3100. `knowledge-backend` is visible under `knowledge-models`. `knowledge-backend-status` starts at `data-id="builtin"`, `data-selected="builtin"`, and the sentence `Built-in search` (or `WeKnora not installed: <reason>` when the binary is missing).
- **Not installed.** With no `AGENTFORGE_WEKNORA_PATH`: `knowledge-backend-weknora` is disabled and its hover title is the host's reason. Clicking it does nothing; `knowledge-backend-apply` stays disabled. Stop here and report the reason — do not try to install anything.
- **Switch to WeKnora.** Select `knowledge-backend-weknora`, click `knowledge-backend-apply`. `knowledge-backend-busy` appears and names the 30 s expectation; the first switch really can take that long (bootstrap: spawn, auto-setup, api-key, KB create). When it lands, `knowledge-backend-status` reads `WeKnora · healthy · 0 queued` with `data-id="weknora"`, `data-selected="weknora"`, `data-health="ok"`. A 409 instead shows `knowledge-backend-error` and `data-selected` stays `builtin`.
- **Planted fact through WeKnora.** On the Sources tab paste a note with a token that exists nowhere else (e.g. `The internal code name is zorblatt7731.`); the row reaches `Indexed`. Open Chat in a **new thread** and ask for that token. `chat-context` → `chat-context-breakdown` → Sources reads `1 chunks · weknora`. `0 chunks` is a fail.
- **Degraded mode.** Kill the sidecar process only (the WeKnora child of the :3100 host — find it by pid, never by port, and never touch :3000). Paste a second planted note: it still reaches `Indexed`, because ingest dual-writes SQLite. Ask about it in a new Chat thread: Sources now reads `k chunks · fts (degraded)`. Reload `/knowledge`: `knowledge-backend-status` reads `WeKnora selected · degraded, built-in answering · N queued` with `data-id="builtin"`, `data-selected="weknora"`, `data-health="down"`, and `data-outbox` > 0.
- **Outbox drains.** Restart the :3100 host (or let it respawn the sidecar on the next knowledge call) and reload `/knowledge` a few seconds later. `data-health` returns to `ok`, `data-id` returns to `weknora`, and `data-outbox` falls back to `0`. Ask about the second planted note again — it now answers `· weknora`.
- **Re-index.** With `data-selected="weknora"`, click `knowledge-backend-reindex`. `knowledge-backend-queued` shows `data-queued` > 0 (one per existing source). Reload until `knowledge-backend-status` `data-outbox` is back to `0`; the sources are then served by the sidecar.
- **Switch back.** Select `knowledge-backend-builtin` and click `knowledge-backend-apply`. It is instant, `knowledge-backend-reindex` disappears, the status reads `Built-in search`, and the same planted question still answers (`· hybrid` or `· fts`). That is the rollback proof: a flag flip, no data loss.

## Gotchas

- An older host has no `backend` block: the card is gone and only `knowledge-backend-unsupported` renders. Built-in is answering and the rest of the Knowledge page works normally. That is an old host, not a broken page.
- The first switch to WeKnora can take up to ~30 s. `knowledge-backend-busy` is the expected state, not a hang — do not click Switch twice, and do not restart the host while it is showing.
- WeKnora is never the only path. Every ingest writes agentforge SQLite + FTS5 first, so a dead sidecar degrades retrieval quality, never the KB. A `Failed` source row during degraded mode is a real ingest failure, not the sidecar.
- `data-selected` is the owner's choice and `data-id` is what answered; treat them as two different assertions. Reading only the sentence hides the degraded case.
- The WeKnora radio being disabled is a host verdict (`available: false`), not a UI bug. Report the `reason` verbatim.
- Re-index is queue-only: `knowledge-backend-queued` reports what was accepted, not what finished. Progress is `data-outbox` on later loads.
- Never drive this feature on `:3000`, and never point the :3100 instance at the operator's sidecar data dir — the sidecar is single-writer per data dir.
- Switching the embedding model still needs an explicit re-index; the card does not do it for you.
- A 409 on Switch, a `down` health, and a non-zero outbox are all legitimate results to report. Do not retry in a loop to make them go away.
