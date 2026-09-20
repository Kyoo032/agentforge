# Map — Knowledge Base page

Last verified: 2026-09-20 at b482611

The page half of Knowledge. The ingest pipeline behind it — extract, guard, chunk, embed, work cards, tenant scoping — is [`knowledge-ingest-loop.md`](knowledge-ingest-loop.md); this page does not repeat it. Citations are anchored at `b482611`; `packages/host/src/knowledge.ts` and `apps/web/components/knowledge-page.tsx` are rewritten often, so grep the function or testid name if a number looks wrong.

## Overview

`/knowledge` is an Account-rail screen, not a `PRODUCT_MODES` id: one React component with four tabs (Sources / Soul / Memory / Map), a model row that is always on screen, and two read-only visualisations (the Knowledge health strip and the topic↔source↔thread graph). It is the only place a user can say what the desk *is* (Soul), what it must never forget (Memory), what it may read (Sources), and which Embedding / Brain / Verifier models do that work.

Everything on it is local. Chunk text lives in a SQLite FTS5 virtual table, vectors live in a plain SQLite table as JSON arrays, and retrieval fuses both with RRF — so keyword search still answers when the embedding call fails. The gateway is touched for exactly two things: embeddings, and the live "Map knowledge" generate.

What it is **not**: a place Chat reads from directly. The page writes state; `startModalityRun` reads it, once per turn, and only for thread runs.

## How it works

### 1. Entry point and shell

The rail's Account group renders one `RailItem` to `/knowledge` with `testId="mode-knowledge"` (`apps/web/components/app-rail.tsx:362-370`). It is not a workspace `productModes` checkbox, so hiding Finance or Data cannot hide it.

`KnowledgePage` (`apps/web/components/knowledge-page.tsx:131`) holds the whole screen in one component: `tab` (`:134`), `sources` / `soul` / `memories` (`:135`, `:139`, `:140`), the three model ids (`:148-150`), and the three numbers the loop chart needs — `retrievals`, `graphCounts`, `verified` (`:153-155`). `<main data-testid="knowledge-page">` at `:303`; the tab strip `knowledge-tabs` at `:310` renders `knowledge-tab-${id}` for `sources | soul | memory | map` (`:311-322`). Tab state is component-local — there is no route per tab, so a reload always lands on Sources.

### 2. One read fills the page

`reload()` (`apps/web/components/knowledge-page.tsx:157-188`) fires two requests in parallel: `GET /api/v1/knowledge` and `GET /api/v1/models`. It runs on mount and on every `workspaceId` change (`:190-194`), and again after every mutation the page performs.

`handleGetKnowledge` (`packages/host/src/handlers/knowledge.ts:125-147`) answers the whole page in one payload — `soul`, `memories`, `sources`, `models`, `map`, `retrievals`, `graph`, `verified`, `backend` — and sweeps orphan work cards on the way (`sweepOrphanThreadSources`, `packages/host/src/handlers/knowledge.ts:131`). **That name is now an alias** (`packages/host/src/knowledge.ts:702-704`): it calls `sweepOrphanSources` (`:676`), which covers all three origin kinds — `thread`, `artifact` and `media` (`ORIGIN_OWNERS`, `:631`) — drops their traces and stored uploads, and then runs `sweepOrphanGraph` (`packages/host/src/knowledge-graph-prune.ts:110`) to repair nodes, edges and retrieval rows left by builds that had no cascade. Landed 2026-09-17; before it, the sweep was thread-only. The route is **not** gated: a closed gateway gate still renders the page. The graph *itself* is deliberately a second route so that drawing the loop chart never pays for a node list (`packages/host/src/handlers/knowledge.ts:107-110`).

The model row `knowledge-models` (`apps/web/components/knowledge-page.tsx:327`) is rendered on **every** tab. Embedding is seeded from `modes.embedding` of the catalog, Brain and Verifier from `modes.chat` (`:174-187`), each falling back through `seedModel` (`:107-116`): saved id → catalog default → first entry. Changing one calls `persistModels` (`:196-210`), which sets local state first and then `PUT /api/v1/knowledge/models`; the handler (`packages/host/src/handlers/knowledge.ts:270-288`) accepts only string fields and `putKnowledgeModels` (`packages/host/src/knowledge.ts:112-131`) upserts one `knowledge_settings` row per workspace, keeping the current value for anything blank. Picking a model **never** generates — only Map does.

### 3. Sources tab — add, list, delete

Three entry points, all in the `knowledge-sources` block (`apps/web/components/knowledge-page.tsx:368`):

| Control | testid | Request | Handler |
|---|---|---|---|
| HTTPS URL | `knowledge-url` + `knowledge-add-url` (`:392`, `:398`) | `POST /api/v1/knowledge/sources/url` (`:233-251`) | `handlePostKnowledgeSourceUrl` (`packages/host/src/handlers/knowledge.ts:405`) → `addUrlSource` (`packages/host/src/knowledge.ts:523`) |
| Pasted text | `knowledge-paste` + `knowledge-add-paste` (`:409`, `:416`) | `POST /api/v1/knowledge/sources` JSON (`:253-271`) | `handlePostKnowledgeSource` (`packages/host/src/handlers/knowledge.ts:372`) → `addPastedSource` (`packages/host/src/knowledge.ts:577`) |
| File | `knowledge-file` (`apps/web/components/knowledge-page.tsx:426`) | `POST /api/v1/knowledge/sources` multipart (`:427-447`) | same handler → `addFileSource` (`packages/host/src/knowledge.ts:499`) |

All three are gated (`requireGatewayAllowed`, `packages/host/src/handlers/knowledge.ts:376`, `:409`) because all three may need an embedding call. All three end in `await reload()`, which is why a new row and the loop numbers land together.

**The paste box cannot name its source.** `addPaste` sends `name: t("knowledge.sources.pastedName")` (`apps/web/components/knowledge-page.tsx:262`) — the localized constant "Pasted notes" / "Catatan tempelan" (`apps/web/locales/en/knowledge.json:36`, `id/knowledge.json:36`). The host takes any name (`addPastedSource`, `packages/host/src/knowledge.ts:577-588`); the page just never offers a field. Every pasted source on a desk therefore carries the same name, and so does its `[n] <name>` citation marker.

The list is one `<li data-testid="knowledge-source-row">` per source (`:455`), rendering name, `knowledge-source-type` tag (`:457`), chunk count, a status tag whose `title` carries the failure reason on `Failed` (`:463-468`), and a **Remove** button with no testid (`:469-477`) that `DELETE`s `/api/v1/knowledge/sources/:id` and reloads. `deleteSource` (`packages/host/src/knowledge.ts:605`) drops the vectors, the FTS chunks and the source row in one immediate transaction, then tells the backend to forget it and removes the raw upload from disk (`removeStoredUpload`). **As of 2026-09-17 it also takes the graph and the retrieval rows**: `dropSourceTraces` calls `removeGraphForSource` (`packages/host/src/knowledge-graph-prune.ts:57`) inside the same transaction, "so the projection can never survive the thing it projects" (`knowledge.ts:595-598`).

Status is `Indexed | Indexing | Failed` (`apps/web/components/knowledge-page.tsx:22`), and the `accept` list is `KNOWLEDGE_UPLOAD_ACCEPT` (`apps/web/lib/knowledge-upload.ts`) — every one of the eighteen extensions the host reads plus the common mimes. A `knowledge-file-formats` line under the button names the same list from the same constant, in both locales.

### 4. Knowledge health (was the loop chart)

**Rewritten on 2026-09-17: the six-box pipeline drawing is gone.** `KnowledgeLoop` (`apps/web/components/knowledge-loop.tsx:94`) now renders a header row with the Verified pill and the self-check button, a row of stat tiles, and — only sometimes — one muted by-type line. The component keeps its name and its `knowledge-loop` root testid (`:127`); the arithmetic moved to `apps/web/lib/knowledge-health.ts`, which sits on top of the unchanged `apps/web/lib/knowledge-loop.ts` (`summarizeLoop`, `countSourcesByType`, `loopStageCounts`). The file header says so in one line: "This replaced the six-box pipeline drawing; the stage testids ride on the tiles they became, and the graph size moved to the map panel header" (`knowledge-loop.tsx:88-93`).

**The stage testids survived the rewrite, deliberately, so an older harness still finds its numbers** (`knowledge-health.ts:23-28`). `knowledge-loop-stage-<Stage>` is now on a tile root (`knowledge-loop.tsx:232`) rather than an SVG group, still carrying `data-value` and `data-state`:

| Tile (`knowledge-loop-<key>`) | Stage testid it carries | Headline `data-value` | Sub-line |
|---|---|---|---|
| `knowledge-loop-work` | `knowledge-loop-stage-Work` | work-card sources | fixed copy |
| `knowledge-loop-manual` | `knowledge-loop-stage-Saved` | **manual** sources — while the *stage's* `data-value` on the same element is `sources.length` (`knowledge-health.ts:86-94`) | the Saved total |
| `knowledge-loop-indexed` | `knowledge-loop-stage-Indexed` | sources reading `Indexed` | chunk count, also exposed as `knowledge-loop-chunks` with its own `data-value` (`knowledge-loop.tsx:247-248`) |
| `knowledge-loop-retrieved` | `knowledge-loop-stage-Retrieved` | `retrievals` | fixed copy |
| `knowledge-loop-failed` | **none** — Failed was never a stage (`knowledge-health.ts:117`) | failed sources | fixed copy |

Three things a driver has to know. **The Failed tile is conditional** — it is appended only when something failed (`knowledge-health.ts:114-124`), because "a permanent `Failed 0` is noise on a healthy desk". **There is no `Graph` stage any more**: `knowledge-loop-stage-Graph` does not exist on this page at all, and the graph size lives only on the map panel header (`knowledge-graph-counts`). And **`knowledge-loop-cycle` is gone** — it was the six-box drawing's own testid and nothing renders it.

`knowledge-loop-summary` (`:180`) is now the `<dl>` wrapping the tiles, not a separate counters row. `knowledge-loop-empty` (`:189`) still paints when no type has any source. `knowledge-loop-counts` (`:197`) is the one-line by-type breakdown and is **conditional on `shouldShowByType`** — it renders only when *more than one* type has sources (`knowledge-health.ts:132-134`), so a desk holding only Chat cards shows no `knowledge-loop-count-Chat` at all. Each entry is still `knowledge-loop-count-<Type>` with `data-count` (`:205-206`), but the `auto` tag per bar is gone with the bars.

The Verified pill (`knowledge-loop-verified`, `:148`) gained `data-tone` alongside `data-state`: `pass`, `fail`, `stale` or `never` (`verifiedTone`, `knowledge-health.ts:49-61`). A pass older than `VERIFIED_STALE_MS = 24 h` (`:41`) reads `stale` — not a failure, and not proof either.

`knowledge-loop-verify` (`:165`) POSTs `/api/v1/knowledge/verify` and then calls the page's own `reload()` through `onRefresh`, so a self-check refreshes every stage at once (`runSelfCheck`, `:103-122`, wired at `apps/web/components/knowledge-page.tsx:369-379`). The host side plants a token source, retrieves it, deletes it in a `finally`, and upserts one `knowledge_verify` row (`packages/host/src/knowledge-verify.ts:86-110`, `:145-157`); `throttledSelfCheck` returns the stored record unchanged inside `SELF_CHECK_MIN_INTERVAL_MS = 10_000` (`packages/host/src/handlers/knowledge.ts:234-252`), so a held button cannot churn the live index. A failed check is a `200` with `ok: false`, not an error; only a transport failure paints `knowledge-loop-verify-error` (`apps/web/components/knowledge-loop.tsx:173`).

### 5. The graph panel

`KnowledgeGraphPanel` (`apps/web/components/knowledge-graph-panel.tsx:43`) sits directly under the loop chart on the Sources tab and is collapsed until `knowledge-graph-toggle` (`:110`). Its header always shows `knowledge-graph-counts` with `data-nodes` / `data-edges` (`:115-117`), computed as `Math.max(counts?.nodes ?? 0, graph.nodes.length)` (`:92-93`) — the page's counts, corrected upward by whatever the panel itself fetched.

Opening it fetches `GET /api/v1/knowledge/graph?limit=200` (`knowledge-graph-panel.tsx:63`, `GRAPH_NODE_LIMIT` at `apps/web/lib/knowledge-graph.ts:19`). The effect keys on `[open, reload]` and deliberately does **not** gate on `status === "idle"` (`knowledge-graph-panel.tsx:52-85`, comment at `:56-57`). `handleGetKnowledgeGraph` (`packages/host/src/handlers/knowledge.ts:218-227`) is ungated and hands off to `getGraph` (`packages/host/src/knowledge-graph.ts:301-332`), which returns the `limit` highest-degree nodes and only the edges whose both ends survived that cut (`:324`).

Drawing is deterministic three-column SVG, no physics: `normalizeGraph` → `capGraph` → optional `egoSubgraph` → `layoutGraph` (`apps/web/lib/knowledge-graph.ts:64`, `:125`, `:105`, `:232`). Topics anchor left, sources centre, threads right (`graphColumn`, `apps/web/lib/knowledge-graph.ts:176-182`). Each node is `knowledge-graph-node-<id>` with `data-kind` (`apps/web/components/knowledge-graph-panel.tsx:259-260`); clicking one toggles `focus`, which swaps the drawing for that node's one-hop neighbourhood and reveals `knowledge-graph-clear-focus` (`:152`, `:252`). Each edge line carries a `<title>` reading `<kind> · weight <w>` (`:238`); `knowledge-graph-legend` (`:190`) names all three node kinds and all three edge kinds — `covers` / `retrieved` / `cites` (`apps/web/lib/knowledge-graph.ts:8-9`) — unconditionally, before any such edge exists.

Four terminal states, one testid each: `knowledge-graph-loading` (`:162`), `knowledge-graph-error` + `knowledge-graph-retry` (`:168`, `:175`), `knowledge-graph-empty` (`:182`), and `knowledge-graph-shown` + `knowledge-graph-svg` (`:125`, `:226`).

### 6. Soul and Memory

**Soul** (`apps/web/components/knowledge-page.tsx:485-541`) is four fields and a Save: `knowledge-soul-name` (`:491`), `knowledge-soul-role` (`:498`), `knowledge-soul-voice` (`:506`), a rules list with an untestid'd draft input and Add button (`:513-532`) that only mutates local state, and `knowledge-soul-save` (`:537`) which `PUT`s the whole object and reloads (`saveSoul`, `:273-286`). `putSoul` (`packages/host/src/knowledge.ts:154`) substitutes the default for any field that trims to empty, drops blank rules, and upserts one `knowledge_soul` row per workspace. Nothing is saved until Save — closing the tab discards typed rules.

**The default Soul moved and changed on 2026-09-17** (`packages/host/src/knowledge-soul.ts`). `defaultSoul()` is **built per call, never a module constant** (`:52`), because a branded flavor sets `AGENTFORGE_PRODUCT_NAME` / `AGENTFORGE_GATEWAY_NAME` before the host loads and a default frozen at import time would hand every flavor the public name. It now names the product, the gateway and the eleven rail modes, so "what is this?" is answerable from the Soul block instead of guessed. A desk still holding the old `Forge` row byte for byte is migrated on read — `getSoul` returns `defaultSoul()` when `isLegacyDefaultSoul(stored)` (`knowledge.ts:150`), since a desk holding that row never chose it; anything the owner actually typed is left alone. The page's pre-load placeholder follows the brand too (`apps/web/components/knowledge-page.tsx:132`, `:138`), so `knowledge-soul-name` never flashes `Forge` any more.

**Memory** (`:545-584`) is `knowledge-memory-input` (`:551`) + `knowledge-memory-add` (`:558`), which POSTs `{ text, pinned: true }` (`:293-297`); every memory the UI creates is pinned. Rows are `knowledge-memory-row` (`:568`) with an untestid'd Forget button that `DELETE`s `/memories/:id`. `listMemories` orders `pinned DESC, created_at DESC` (`packages/host/src/knowledge.ts:172-184`); `addMemory` rejects blank text with a 400 (`:186-197`). Both routes are ungated.

### 7. Map

`knowledge-map-run` (`apps/web/components/knowledge-page.tsx:597`) calls `runMap` (`:212-231`) → `POST /api/v1/knowledge/map` → `handlePostKnowledgeMap` (`packages/host/src/handlers/knowledge.ts:290-310`, gated at `:294`) → `mapKnowledge` (`packages/host/src/knowledge-map.ts:84-180`). The button is the page's only generate.

`mapKnowledge` writes a `Mapping` placeholder row first (`:101`), then **re-embeds the whole workspace** under the current embedding model (`reembedWorkspaceChunks`, `:104`) — the one implicit side effect on this page, and the reason a Map click after switching the embedding model is slow. `resolveRuntimeMode` (`:107-110`) then picks:

- **stub** — `stubKnowledgeMap(sources, models, locale)` (`:116`). A valid result: `source: "stub"`, one topic per source, verdict `stub`.
- **live** — two model calls: the Brain drafts from one chunk excerpt per source (`sourceExcerpts`, `:68-81`; `collectJobAssistantText` at `:119-133`), and the Verifier re-reads the draft (`:141-154`), falling back to the draft when its output will not parse (`:155`).

On success the map is saved (`:158`) and `projectMapToGraph` (`:165`) writes one `topic` node per topic plus a `covers` edge to every source it names that still exists (`packages/host/src/knowledge-graph.ts:131-157`, edge push at `:152`). That projection is wrapped in its own try/catch (`packages/host/src/knowledge-map.ts:164-170`): a graph failure never fails the map.

The result renders as `knowledge-map` (`apps/web/components/knowledge-page.tsx:603`), present only once a map exists — a stored map from a previous run is seeded straight out of `reload()` (`:170-172`). A Ready / Not ready tag and a live / stub tag sit at the top (`:604-611`), overview and each topic summary go through `FormattedText` (`:612`, `:622`), and each topic carries a **verdict** tag — `supported` / `weak` / `unsupported` / `stub` (`:618-620`, `verdictTagClass` at `:118-129`) — not a Ready tag.

### 8. What Chat does with all of it

Chat never reads the page's state; the host rebuilds it per turn. `startModalityRun` calls `knowledgeInjection(tenant, userText, { excludeThreadId: thread.id })` (`packages/host/src/runs.ts:153`) and concatenates the result onto the published agent's system prompt (`:158`).

`knowledgeInjection` (`packages/host/src/knowledge.ts:833-875`) assembles three sections under one `# Workspace knowledge` heading: `## Soul` from `getSoul`, `## Pinned memories` from the pinned subset of `listMemories`, and `## Retrieved sources` — `retrieveChunks(tenant, query, 4, …)` rendered as `[${index + 1}] ${sanitizeSourceName(chunk.sourceName)}\n${chunk.body}` (`:855-857`). An empty query skips retrieval entirely (`:840-842`). The anti-loop is `excludedSourceIds` (`:802-808`): the asking thread's own work card is looked up by origin and excluded, which is why proving retrieval of a Chat card needs a fresh thread.

Retrieval itself is `SqliteBuiltinBackend.retrieve` (`packages/host/src/knowledge/backends/builtin.ts:250-273`). **Both engines always run** — a cosine scan of `knowledge_vectors` and an FTS5 `bm25(knowledge_chunks)` query — and `fuseRrf` (`:155-176`, `RRF_K = 60` at `:134`) interleaves them; an empty list simply contributes nothing (`:167-171`). `fusedMode` (`:200-208`) labels the result `hybrid` / `rag` / `fts` / `none`, and `sourcesDetail` (`packages/host/src/knowledge.ts:825-831`) turns that into the popover line `"<k> chunks · <mode>"`, appending ` (degraded)` when the desk's own engine is not the one that answered.

That line reaches the user through `GET /api/v1/knowledge/context?threadId=` (`packages/host/src/handlers/knowledge.ts:312-327`, gated at `:316`) — the only other caller of `knowledgeInjection`. `ChatSession` fetches it (`apps/web/components/chat-session.tsx:347-357`) and hands the `parts` array to `ChatContextChip`, which renders `chat-context` (`apps/web/components/chat-context-chip.tsx:171`) and, on click, the portalled `chat-context-breakdown` (`:120`) with one row per part: Soul / Memories / Sources. The route returns `prompt` and `parts` only — `chunks` stays server-side because it is the retrieval record.

After a **completed** run the host closes the loop: `recordRetrievals` writes one row per injected chunk and projects the `retrieved` edge, and `recordCites(…, citedSources(assistantText, knowledge.chunks))` turns bare `[n]` markers into `cites` edges (`packages/host/src/runs.ts:362-380`, mirrored at `:411-422`). `citedSources` (`packages/host/src/knowledge-cites.ts:64-76`) is positional: `chunks[marker - 1]`, deduped by source, and a marker past the injected count is silently dropped.

### Failure modes

| Failure | Where | What the user sees |
|---|---|---|
| Gate closed on add / verify / map / context | `requireGatewayAllowed` (`packages/host/src/handlers/knowledge.ts:376`, `:409`, `:259`, `:294`, `:316`) | `403 gateway_blocked`; the page paints its red `error` line (`apps/web/components/knowledge-page.tsx:325`). `GET /api/v1/knowledge` and `/graph` stay open, so the page still renders |
| `file://` or non-HTTPS URL | `addUrlSource` → `assertAllowedEndpointUrl` (`packages/host/src/knowledge.ts:525`) | error line, no row |
| Pasted text over 2 MB | `addPastedSource` (`packages/host/src/knowledge.ts:583-584`) | `413`, error line |
| Unsupported file type | `extractText` (`packages/host/src/knowledge-extract.ts:266-271`) | `400 unsupported_content_type`, error line, no row. The sentence now names the whole list, `.txt` through `.epub` |
| A `.pptx` / `.xlsx` / `.odt` / `.rtf` / `.epub` the converter refuses | `documentText` (`packages/host/src/knowledge-extract.ts:143-155`) | `400` (or `413` for `too_large`) as `document_<code>`, error line, no row. A scanned PDF is `document_needs_ocr` and the sentence says plainly that nothing was sent anywhere |
| PDF/DOCX parse failure, no text, injection hit on an upload | `addFileSource` (`packages/host/src/knowledge.ts:499-512`) | **a structured 4xx and no row** as of 2026-09-17. This used to be a `Failed` row answered `201`; a `Failed` row with a hover reason is now only how a *pasted* or *fetched* source fails |
| Embedding call fails | `embedTextsWithModel` (`packages/host/src/knowledge-embed.ts:95-117`) | nothing visible: the row still reads `Indexed` because the FTS rows were committed first; the source is keyword-findable only |
| Self-check fails | `runKnowledgeSelfCheck` (`packages/host/src/knowledge-verify.ts:129`) | `200`; `knowledge-loop-stage-Verified` reads `fail` with `data-state="fail"` |
| Self-check re-clicked inside 10 s | `throttledSelfCheck` (`packages/host/src/handlers/knowledge.ts:241-252`) | the previous record, `throttled: true` — the stage does not move |
| Map generate fails (live) | `mapKnowledge` (`packages/host/src/knowledge-map.ts:134-136`) | `generation_failed`, error line, previous map still shown |
| Graph route missing (old host) | `KnowledgeGraphPanel` effect (`apps/web/components/knowledge-graph-panel.tsx:68-79`) | `knowledge-graph-error` + `knowledge-graph-retry`; the other four loop stages still count |
| No graph yet | `full.nodes.length === 0` (`apps/web/components/knowledge-graph-panel.tsx:181`) | `knowledge-graph-empty` — "Build map to create topic links." |

## Where things live

| File | Role |
|---|---|
| `apps/web/components/knowledge-page.tsx` | The whole page: tabs, model row, Sources / Soul / Memory / Map, every mutation and `reload()` |
| `apps/web/components/knowledge-loop.tsx` | Knowledge health: the Verified pill, the stat tiles, the by-type line, the self-check button. Same name and same `knowledge-loop` root as the six-box chart it replaced |
| `apps/web/lib/knowledge-health.ts` | `healthTiles`, `verifiedTone`, `shouldShowByType`, `VERIFIED_STALE_MS` — which stage each tile carries and when Failed and the by-type line appear |
| `apps/web/lib/knowledge-loop.ts` | Pure stage / summary / count maths and `WORK_SOURCE_ORDER` (all eleven work types) |
| `packages/host/src/knowledge-graph-prune.ts` | `removeGraphForSource` / `removeGraphForThread` (the cascade) and `sweepOrphanGraph` (the self-heal) |
| `packages/host/src/knowledge-soul.ts` | `defaultSoul()` — built per call so a branded flavor gets its own name — plus `LEGACY_DEFAULT_SOUL` and `isLegacyDefaultSoul` |
| `apps/web/components/knowledge-graph-panel.tsx` | Collapsed graph panel, fetch, focus, legend |
| `apps/web/lib/knowledge-graph.ts` | `normalizeGraph` / `capGraph` / `egoSubgraph` / `layoutGraph`, node + edge kinds, `GRAPH_NODE_LIMIT` |
| `apps/web/components/chat-context-chip.tsx` | `chat-context` ring and `chat-context-breakdown` popover |
| `apps/web/components/app-rail.tsx` | Account-group `mode-knowledge` item |
| `apps/web/locales/{en,id}/knowledge.json` | Every string on the page, including the hardcoded pasted-source name |
| `packages/host/src/handlers/knowledge.ts` | All 16 routes, the gate decisions, the self-check throttle |
| `packages/host/src/knowledge.ts` | Sources CRUD, soul, memories, models, `retrieveChunks`, `knowledgeInjection`, `sourcesDetail` |
| `packages/host/src/knowledge-map.ts` | "Map knowledge": re-embed, stub vs Brain+Verifier, save, graph projection |
| `packages/host/src/knowledge-verify.ts` | Planted-token self-check and its `knowledge_verify` row |
| `packages/host/src/knowledge-graph.ts` | `projectMapToGraph`, `recordCites`, `getGraph`, `graphCounts` |
| `packages/host/src/knowledge/backends/builtin.ts` | FTS5 + cosine retrieval and RRF fusion |
| `packages/host/src/knowledge-embed.ts` | Embedding calls, JSON vector storage, cosine scan, circuit breaker |
| `packages/host/src/knowledge/registry.ts` | Backend selection — hardcoded `builtin` (`:27-29`) |
| `packages/host/src/runs.ts` | The one product path that injects knowledge (`:152`) and records the loop back (`:362-380`) |

## Gotchas

- ~~**Deleting a source does not delete its graph node.**~~ **Fixed 2026-09-17.** It was real: after adding one paste, running Map and deleting the source, `GET /api/v1/knowledge` reported `sources: []` with `graph: {nodes: 2, edges: 1}`. `packages/host/src/knowledge-graph-prune.ts` now carries both halves — `removeGraphForSource` / `removeGraphForThread` as the cascade, inside the same transaction as the row, and `sweepOrphanGraph` (`:110`) as the self-heal for rows earlier builds left behind. The sweep's own comment records the scale of the residue: "the owner's desk carried 18 graph nodes against one live source" (`packages/host/src/knowledge.ts:691-693`).
- **The picker and the host read the same list — keep it that way.** `sourceKind` accepts `.txt .md .csv .json .html .htm .pdf .docx` plus `KNOWLEDGE_DOCUMENT_EXTENSIONS` (`packages/host/src/knowledge-extract.ts`), and `KNOWLEDGE_FILE_EXTENSIONS` in the same file is what the `unsupported_content_type` sentence names. The renderer cannot import `packages/host`, so `apps/web/lib/knowledge-upload.ts` mirrors it and `knowledge-upload.test.ts` reads the host file and fails the moment the two disagree. Adding a format means editing both.
- **A Map run leaves the loop chart stale.** `runMap` (`apps/web/components/knowledge-page.tsx:212-231`) only calls `setKnowledgeMap`; it never calls `reload()`. `graphCounts` comes from `GET /api/v1/knowledge`, so `knowledge-loop-stage-Graph` and `knowledge-graph-counts` keep their pre-map values until some *other* action reloads the page. Opening the graph panel masks half of it, because the panel's counts are `Math.max(page, fetched)` (`apps/web/components/knowledge-graph-panel.tsx:92-93`) — so the panel can read `2 nodes · 1 edge` while the stage beside it still reads `0`. **Finding.**
- **There is no Graph stage on this page any more.** The health strip has no Graph tile and `knowledge-loop-stage-Graph` renders nowhere; the node and edge counts live only on `knowledge-graph-counts` in the map panel header. Doctor's `knowledgeGraph` still reports both, and is now the only non-DOM place to read them.
- **`knowledge-loop-counts` is conditional on there being a *mix*.** `shouldShowByType` (`apps/web/lib/knowledge-health.ts:132-134`) requires more than one type with sources, so a fresh desk holding only `Chat` cards renders no by-type line and no `knowledge-loop-count-Chat`. Asserting that testid after a single Chat send is a recipe bug, not a product one.
- **The `manual` tile and the `Saved` stage disagree on purpose.** They are the same DOM element: the headline `data-value` on `knowledge-loop-manual` is the *manual* count, while `data-value` on the `knowledge-loop-stage-Saved` root around it is `sources.length` (`apps/web/lib/knowledge-health.ts:86-94`). Read the one you meant.
- **The paste box cannot name anything.** `apps/web/components/knowledge-page.tsx:262` hardcodes the localized "Pasted notes". Every pasted source shares one name, and so does its `[n] <name>` marker — two pastes are indistinguishable in a citation.
- **Four mutating controls on this page have no testid:** the source row's Remove (`:469-477`), the memory row's Forget (`:572-580`), and the Soul rule draft input + Add rule button (`:513-531`). Everything else here is addressable.
- **Adding a Soul rule saves nothing.** The Add button mutates `soul.rules` in React state only (`:520-531`); leaving the tab without pressing `knowledge-soul-save` discards it.
- **Empty Soul fields are silently replaced.** `putSoul` substitutes `DEFAULT_SOUL.name` / `.role` / `.voice` for anything that trims to empty (`packages/host/src/knowledge.ts:154-159`), so "clear the voice and save" is not a thing a user can do from this page.
- **Every memory the page creates is pinned** (`apps/web/components/knowledge-page.tsx:293-297`), and only pinned memories are injected (`packages/host/src/knowledge.ts:839`). The unpinned state exists in the store and has no UI.
- **"Map knowledge" re-embeds the workspace first** (`packages/host/src/knowledge-map.ts:104`) but does **not** re-chunk. A chunker change needs the explicit reindex routes, which this page does not expose at all — `POST /knowledge/sources/:id/reindex` and `POST /knowledge/reindex` have no control on the page.
- **Tab state is not in the URL.** `/knowledge` always opens on Sources; there is no `?tab=` and no deep link to Soul, Memory or Map.
- **Switching tabs unmounts the graph panel**, because the Sources block is conditionally rendered (`apps/web/components/knowledge-page.tsx:367`). Coming back from Map re-collapses the panel and re-fetches on the next toggle.
- ~~**Topic labels are clipped.**~~ **Fixed since 2026-09-17.** Topic nodes sit at `x = columnInset = 168` with their label anchored `end` at `x - labelPad` (`apps/web/lib/knowledge-graph.ts:201-209`, `:212-226`), and `truncateGraphLabel` caps at `GRAPH_LABEL_MAX = 18` characters (`:25`, `:197-199`). The 860-wide canvas and that inset are sized together so an 18-character label clears the viewBox, which the constant's own comment records (`:157-174`).
- **The legend is not evidence.** `knowledge-graph-legend` names `covers`, `retrieved` and `cites` unconditionally (`apps/web/lib/knowledge-graph.ts:9`, rendered at `apps/web/components/knowledge-graph-panel.tsx:186-196`). Read an edge's hover title, not the legend.
- **Stub Chat can never produce a `cites` edge**, so a busy stub desk with `edges > 0` is showing `covers` from Map runs only.
- ~~**`Legal` is a host work-source type that the renderer's `WORK_SOURCE_ORDER` omits.**~~ **Fixed 2026-09-17.** `WORK_SOURCE_ORDER` (`apps/web/lib/knowledge-loop.ts:22-34`) now lists all eleven in rail order — `Chat, Documents, Research, Finance, Data, Market, Legal, Images, Videos, Presentation, Edit` — so `Market` and `Legal` cards both count as work rather than falling into the manual tile.
- **The page is not gated, the writes are.** `GET /api/v1/knowledge` and `/graph` answer with the gate closed; every add, verify, map and context call is a `403`. A gate-closed desk shows a fully rendered Knowledge page whose every button errors.
- **Model pickers never generate.** Only `knowledge-map-run` spends anything. `PUT /knowledge/models` is an ungated id write.
- **`retrievals` only counts completed runs.** A failed or aborted Chat send adds nothing, so a flat Retrieved stage after a failure is correct.

## Verify

`.cursor/skills/verify-agentforge/features/knowledge.md` is the recipe for this page; `features/knowledge-graph.md` for the `cites` half of the graph panel, `features/knowledge-phases.md` for the Cloud unit path, `features/knowledge-ingest.md` (and [`knowledge-ingest-loop.md`](knowledge-ingest-loop.md)) for what fills Sources by itself.

DOM testids that prove it: `mode-knowledge` (`apps/web/components/app-rail.tsx:369`); `knowledge-page` / `knowledge-tabs` / `knowledge-tab-{sources,soul,memory,map}` / `knowledge-models` / `knowledge-model-{embedding,brain,verifier}` (`apps/web/components/knowledge-page.tsx:303`, `:310`, `:317`, `:327`, `:337`, `:349`, `:360`); `knowledge-sources` / `knowledge-url` / `knowledge-add-url` / `knowledge-paste` / `knowledge-add-paste` / `knowledge-file` / `knowledge-file-formats` / `knowledge-source-row` / `knowledge-source-type` (`:368`, `:392`, `:398`, `:409`, `:416`, `:426`, `:449`, `:455`, `:457`); `knowledge-soul` / `-name` / `-role` / `-voice` / `-save` (`:485`, `:491`, `:498`, `:506`, `:537`); `knowledge-memory` / `-input` / `-add` / `-row` (`:545`, `:551`, `:558`, `:568`); `knowledge-map-panel` / `knowledge-map-run` / `knowledge-map` (`:588`, `:597`, `:603`); `knowledge-loop` (`apps/web/components/knowledge-loop.tsx:127`), `-verified` (`:148`), `-verify` (`:165`), `-verify-error` (`:173`), `-summary` (`:180`), `-empty` (`:189`), `-counts` (`:197`), `-count-<Type>` (`:205`), the tile numbers `-work` / `-manual` / `-indexed` / `-retrieved` / `-failed` (`:240`), `-chunks` (`:247`), and `-stage-<Stage>` on the tile roots plus the Verified pill (`:232`, `:136`). **`knowledge-loop-cycle` and `knowledge-loop-stage-Graph` no longer exist** — asserting either is a stale recipe, not a regression; `knowledge-graph-panel` / `-toggle` / `-counts` / `-clear-focus` / `-loading` / `-error` / `-retry` / `-empty` / `-shown` / `-svg` / `-node-<id>` / `-legend` (`apps/web/components/knowledge-graph-panel.tsx:100`, `:110`, `:115`, `:152`, `:162`, `:168`, `:175`, `:182`, `:125`, `:226`, `:259`, `:190`); `chat-context` / `chat-context-breakdown` (`apps/web/components/chat-context-chip.tsx:171`, `:120`).

Doctor proves the preconditions: `knowledge: true`, `knowledgeRetrievals`, `knowledgeGraph: { nodes, edges }`, `knowledgeVerified`, `knowledgeBackend.id = "builtin"`.

Unit: `apps/web/lib/knowledge-loop.test.ts`, `apps/web/lib/knowledge-graph.test.ts`, `packages/host/src/knowledge.test.ts`, `knowledge-map.test.ts`, `knowledge-verify.test.ts`, `knowledge-graph.test.ts`, `knowledge-cites.test.ts`, `knowledge-forget.test.ts`, `knowledge-backend-routes.test.ts`, `knowledge/backend.contract.test.ts`.

## Why

**Why there is no backend picker on this page.** `[Direct]` `docs/internal/0.14.25-changelog.md:82-84` — "Knowledge Base is builtin-only… The WeKnora-lite sidecar (flag, extraResources stub, backend card, CI lane) is gone — the binary was never built." The backend card was removed with the sidecar; `selectedBackendId()` is a hardcoded `return "builtin"` (`packages/host/src/knowledge/registry.ts:27-29`) and `PUT /knowledge/backend {id:"weknora"}` answers 400. **Confidence: high.**

**Why the graph panel's fetch effect does not gate on its own status.** `[Direct]` `docs/internal/0.14.25-changelog.md:92` — "`Show graph` stayed on `knowledge-graph-loading` under Vite React Strict Mode. The fetch effect gated on `status === "idle"`, so after Strict Mode cancelled the first request the remount saw `"loading"` and never started a second one." `[Direct]` `:94` records the fix: "fetch whenever the panel is open; **Try again** bumps a reload token. PR #32." The code comment at `apps/web/components/knowledge-graph-panel.tsx:56-57` says the same. **Confidence: high.**

**Why the self-check is throttled to 10 s.** `[Direct]` the route's own doc comment (`packages/host/src/handlers/knowledge.ts:229-233`): the check plants a real source, retrieves it and deletes it again, "so a held button — or a page that re-mounts in a loop — would otherwise churn the live knowledge base as fast as the endpoint answers." This is the implementation's stated intent rather than an independent record. **Confidence: medium — `[Inferred]` beyond the mechanism.**
