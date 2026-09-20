# Map — Knowledge ingest loop

Last verified: 2026-09-20 at a504555

> **Read against the working tree, not the commit.** The extraction, delete-cascade and loop-chart sections below were re-read on **2026-09-17** against the uncommitted tree on `main`, after `packages/host/src/file-extract/` and `knowledge-graph-prune.ts` landed. `knowledge.ts` and `knowledge-extract.ts` moved several times that day; grep the function name rather than trusting a line number.

## Overview

A file, a URL, a pasted block or a finished piece of work goes in; a tenant-scoped, retrievable chunk comes out, and a later Chat turn gets it back as a numbered source in its system prompt. Everything is local: SQLite for both the FTS index and the vectors, the pinned gateway for embeddings only.

Two things surprise people. **Only Chat retrieves** — job modes write cards but never read them. And **the injection guard refuses rather than sanitizes**: a source that trips it is stored as a `Failed` row and never becomes retrievable.

## How it works

### Routes

All in `packages/host/src/handlers/knowledge.ts`, registered at `packages/host/src/router.ts:245-260`.

| Method | Path | Handler | Gate |
|---|---|---|---|
| GET | `/api/v1/knowledge` | `handleGetKnowledge` `:97` | open |
| GET | `/api/v1/knowledge/context` | `handleGetKnowledgeContext` `:284` | gated `:288` |
| GET | `/api/v1/knowledge/graph` | `handleGetKnowledgeGraph` `:190` | open |
| POST | `/api/v1/knowledge/sources` | `handlePostKnowledgeSource` `:344` | gated `:348` |
| POST | `/api/v1/knowledge/sources/url` | `handlePostKnowledgeSourceUrl` `:377` | gated `:381` |
| DELETE | `/api/v1/knowledge/sources/:sourceId` | `handleDeleteKnowledgeSource` `:392` | open |
| POST | `/api/v1/knowledge/sources/:sourceId/reindex` | `handlePostKnowledgeSourceReindex` `:162` | gated |
| POST | `/api/v1/knowledge/reindex` | `handlePostKnowledgeReindex` `:178` | gated |
| POST | `/api/v1/knowledge/verify` | `handlePostKnowledgeVerify` `:227` | gated `:231`, throttled 10 s `:206` |
| POST | `/api/v1/knowledge/map` | `handlePostKnowledgeMap` `:262` | gated `:266` |
| PUT | `/api/v1/knowledge/models` | `handlePutKnowledgeModels` `:242` | open |
| PUT | `/api/v1/knowledge/backend` | `handlePutKnowledgeBackend` `:131` | open |
| POST | `/api/v1/knowledge/backend/reindex` | `handlePostKnowledgeBackendReindex` `:145` | gated `:149` |
| PUT/POST/DELETE | `/api/v1/knowledge/soul`, `/memories`, `/memories/:id` | `:301`, `:321`, `:334` | open |

There is no separate list route; listing rides on `GET /api/v1/knowledge`. `POST /sources` dispatches on payload shape: a multipart `file` → `addFileSource` (201); JSON `artifactId` → `sendArtifactToKnowledge` (idempotent); JSON `text` → `addPastedSource` (201); anything else → 400.

### Ingest

**Manual.** `addFileSource` (`packages/host/src/knowledge.ts:495`, working tree) mints a `crypto.randomUUID()` and calls `extractText(filename, mime, bytes)` (`packages/host/src/knowledge-extract.ts:225`). **Changed on 2026-09-17:** every extraction failure is now a structured 4xx with no row at all — `pdf_*`, `docx_*`, `document_*` and `unsupported_content_type` alike — where a `pdf_*` / `docx_*` failure used to be recorded as a `Failed` row answered `201`. The injection scan also runs *before* the write now, so a tripped upload is `400 injection_blocked` with no row and no stored bytes. It also writes the raw bytes to `tenantMediaRoot(tenantId)/knowledge/${organizationId}/${id}-${filename}` — the tenant prefix is empty for `local-tenant`, so a desktop install keeps `mediaRoot()/knowledge/<organizationId>/…` (`uploadDir`, `packages/host/src/knowledge.ts:447-450`; see [`tenant-storage.md`](tenant-storage.md)). `addUrlSource` (`:468-485`) forces HTTPS via `assertAllowedEndpointUrl`, fetches through `fetchPublicHttps` (SSRF guards, per-hop revalidation, byte and time caps), then routes the body through `htmlToText` or `plainToText`. `addPastedSource` caps at 2,000,000 chars with a 413 (`:508`, `:527-528`).

**Automatic — the loop.** Every finished Chat turn and every job mode (Research, Data, Finance, Documents, Presentation, Images, Videos, Edit) becomes one "work card" through `upsertWorkSource` (`packages/host/src/knowledge-ingest.ts:24-70`), fired and forgotten from `packages/host/src/runs.ts:384`. It is **idempotent per `(workspace, origin.kind, origin.id)`** via `findSourceByOrigin` (`packages/host/src/knowledge.ts:214-221`), so re-running a thread rewrites one row instead of piling up duplicates.

### The injection guard

`indexSource` (`packages/host/src/knowledge.ts:425-440`) runs `scanInjection` over name **and** text, unless bypassed. The scan (`packages/core/src/security/injection-guard.ts:77-88`) applies a fixed HIGH/CRITICAL rule set — `ignore-previous`, `dan`, `system-delimiter`, `prompt-leak`, `id-override` and its Indonesian variant — over text first NFKC-normalized, zero-width-stripped and homoglyph-folded (`:64-69`).

On a hit it **does not strip or sanitize**. It refuses to index and writes a `Failed` source row whose `error` is `injection_blocked (rule: <rule>)` (`packages/host/src/knowledge.ts:436-438`, `packages/host/src/knowledge-ingest.ts:48-51`).

**The bypass** is the `injectionGuardBypass` boolean on `StoredSecrets` (`packages/core/src/secrets.ts:30`, `:87`), set through `POST /api/v1/settings` (`packages/host/src/handlers/settings.ts:159`), persisted per workspace in the encrypted settings file, read back at `packages/host/src/knowledge.ts:409-415` and `knowledge-ingest.ts:79-85`. When true the scan is skipped outright — `bypass ? null : scanInjection(...)`.

Source **names** get the same treatment, deliberately: an upload filename or a remote `<title>` is attacker-controlled the same way body text is, so `sanitizeSourceName` runs at index time and again at render time (`packages/host/src/knowledge.ts:359-366`, `:672-673`).

### Chunk, store, embed

`indexKnowledgeSource` (`packages/host/src/knowledge.ts:369-385`) sanitizes the name, then `chunkKnowledgeText` (`packages/host/src/knowledge-text.ts:141-163`) splits heading-aware with overlap — `CHUNK_TARGET = 800` chars, `CHUNK_OVERLAP = 120` (`:53`, `:56`), boundary search in the last fifth of the window, 48-char page-marker lookback.

`replaceSourceRows` (`packages/host/src/knowledge.ts:273-336`) commits the source row and one `knowledge_chunks` FTS5 row per chunk in **one immediate transaction, before embedding**. That ordering is the reason keyword search always works even when the embedding call fails.

Then `indexThroughBackend` → `indexSourceVectors` (`packages/host/src/knowledge-embed.ts:147`) → `embedTextsWithModel` (`:94`), which POSTs to `${pinnedBase}/embeddings` in batches of 16 (`EMBED_BATCH`, `:15`). The endpoint is pinned the same way chat is: `resolveProviderKeys(settings).openaiBaseUrl` always returns `resolvedGatewayBaseUrl()`, so an owner-edited endpoint is silently ignored for embeddings (`packages/host/src/knowledge-embed.ts:61-63`, `packages/core/src/secrets.ts:292-293`).

Vectors go to `knowledge_vectors` with the embedding stored as a **JSON-stringified `number[]`** (`packages/host/src/knowledge-embed.ts:190`, `:235`) — no vector column type, no ANN index.

### Retrieve and inject

`retrieveChunks` (`packages/host/src/knowledge.ts:598-612`) → `SqliteBuiltinBackend.retrieve` (`packages/host/src/knowledge/backends/builtin.ts:249-272`) runs FTS5 bm25 and a cosine scan in parallel and fuses them with Reciprocal Rank Fusion (`fuseRrf`, `:154-175`, `RRF_K = 60`). Default `limit` is 4 (`packages/host/src/knowledge.ts:598`), vector floor `MIN_COSINE = 0.12` (`packages/host/src/knowledge-embed.ts:257`).

`knowledgeInjection` (`packages/host/src/knowledge.ts:650-692`) renders the hits as `[n] <name>\n<body>` inside a `## Retrieved sources` block. It is called from exactly one product path: `startModalityRun` (`packages/host/src/runs.ts:152`), appended to the agent's system prompt at `:157`. The Knowledge context popover route is the only other caller.

Afterwards, on a *completed* run only: `recordRetrievals` (`packages/host/src/knowledge-retrievals.ts:38-71`) writes one row per served chunk and projects a `retrieved` graph edge, and `recordCites` parses `[n]` markers out of the reply (`packages/host/src/knowledge-cites.ts`, fenced code excluded) and bumps `cites` edge weights.

### Reindex, re-embed, verify

Two different things share the word "reindex":

- **`reindexSource` / `reindexWorkspace`** (`packages/host/src/knowledge-reindex.ts:274`, `:312`) — explicit, re-reads the source body, **re-chunks** (so it picks up chunker changes), rewrites FTS and vectors. Routes `POST /knowledge/sources/:id/reindex` and `POST /knowledge/reindex`.
- **`reembedWorkspaceChunks`** (`packages/host/src/knowledge-embed.ts:209`) — implicit, runs at the start of **every** "Map knowledge" click (`packages/host/src/knowledge-map.ts:103`). Re-embeds the existing chunk rows under the current embedding model and deliberately does **not** re-chunk (`packages/host/src/knowledge-reindex.ts:16-18`).

`runKnowledgeSelfCheck` (`packages/host/src/knowledge-verify.ts:128`) plants a token source, retrieves it, deletes it, and records one row per workspace. Throttled to once per 10 s.

### Tenant scoping

Every read and write is parameterized by `workspace_id` in application code. There is **no schema-level enforcement**: `knowledge_chunks` is a bare FTS5 virtual table with `workspace_id` as a plain column (`packages/db/src/ensure-schema.ts:571-575`), no foreign key, no row-level security. The actual guarantee is the tests: `packages/host/src/knowledge-reindex.test.ts:314-322` (reindexing another workspace's source id resolves `{status:"missing"}` and leaves its chunks untouched), `:369-394` (a workspace sweep never touches another), `packages/host/src/knowledge-retrievals.test.ts:61-64` ("Another workspace never shows up in this one's count").

### Storage

| Table | Migration | Notes |
|---|---|---|
| `knowledge_sources` | `0003`, columns in `0008` | `origin_kind` / `origin_id` drive work-card idempotence |
| `knowledge_chunks` | `0003` | **FTS5 virtual table** — the system of record for chunk text |
| `knowledge_vectors` | `0004`, index in `0012` | `embedding` is JSON text; indexed on `(workspace_id, model)` |
| `knowledge_settings` | `0004` | per-workspace embedding / brain / verifier model |
| `knowledge_maps` | `0004` | one `KnowledgeMap` payload per workspace |
| `knowledge_retrievals` | `0010` | one row per chunk injected into a completed run |
| `knowledge_graph_nodes` / `_edges` | `0011` | kinds `topic|source|thread`; edges `covers|retrieved|cites`, aggregated weight |
| `knowledge_verify` | `0011` | last self-check per workspace |
| `knowledge_workspace_backend`, `knowledge_backend_outbox` | `0013` | **dead** — WeKnora sidecar was stripped |
| `knowledge_memories`, `knowledge_soul` | `0003` | |

### Constants

`KNOWLEDGE_FILE_MAX_BYTES = PDF_MAX_BYTES = 25 MB` (`packages/host/src/knowledge-extract.ts:25`), `DOCX_TIMEOUT_MS = 20_000` (`:27`), `DOCX_MAX_INFLATED_BYTES = 100 MB` (`packages/core/src/docx/zip-limits.ts:17`), `PDF_MAX_PAGES = 500` / `PDF_MIN_TEXT_CHARS = 20` (`packages/core/src/pdf/index.ts:32`, `:34`), `KNOWLEDGE_TEXT_MAX_CHARS = 2_000_000` (`packages/host/src/knowledge-text.ts:2`), `SOURCE_NAME_MAX = 120` (`:8`), `MAX_BODY_BYTES = 26 MB` (`packages/host/src/http-adapter.ts:14`), safe-fetch `5` hops / `1_500_000` bytes / `15_000` ms (`packages/core/src/security/safe-fetch.ts:4-6`), `EMBED_BATCH = 16` / `EMBED_TIMEOUT_MS = 4_000` / `EMBED_DOWN_MS = 5 min` (`packages/host/src/knowledge-embed.ts:15`, `:32-33`), `STUB_EMBED_MODEL = "stub-fnv-32"` (`:23`), `MIN_COSINE = 0.12` (`:257`), `RRF_K = 60` (`packages/host/src/knowledge/backends/builtin.ts:133`), `SELF_CHECK_MIN_INTERVAL_MS = 10_000` (`packages/host/src/handlers/knowledge.ts:206`).

### Failure modes

| Case | Behaviour |
|---|---|
| Unsupported type (arbitrary binary) | 400 `unsupported_content_type` (`packages/host/src/knowledge-extract.ts:249-253`). **`.xlsx` is no longer an example of this** — it and nine other document formats are read by the converter as of 2026-09-17 |
| PDF/DOCX parse failure, timeout, zip bomb, too large | a structured 4xx (`pdf_*` / `docx_*`), **no row**. Changed 2026-09-17; this used to be a `Failed` row answered `201` |
| Converter refuses a `document` upload | `document_<code>` for the ten codes at `packages/host/src/file-extract/errors.ts:12-32` — `413` for `too_large`, `400` for the rest (`packages/host/src/knowledge-extract.ts:119-123`) |
| Scanned PDF on the converter path | 400 `document_needs_ocr`. **No OCR runs and nothing is uploaded** — anydoc's `ocr: 'hosted'` option is unreachable because `file-extract/anydoc.ts:72-86` never builds an options object |
| No extractable text | `Failed` / `NO_TEXT` — same row shape as an injection block (`packages/host/src/knowledge.ts:258`, `:374-377`) |
| Injection hit | `Failed`, `error = injection_blocked (rule: …)`, never retrievable |
| Embedding call fails mid-batch | **the whole batch** falls back to `stub-fnv-32` vectors and a 5-minute circuit breaker opens workspace-wide (`packages/host/src/knowledge-embed.ts:88-89`, `:94-115`). The FTS row is already committed, so the source still reads `Indexed` and is findable by keyword |
| Duplicate manual ingest | not deduped — a second upload of the same file is a second source row |
| Duplicate work-card ingest | deduped by origin |
| Embedding model changed | `resolveVectorModel` (`:238-246`) only checks the configured model and the stub, so rows under a *previously* configured real model become unreachable until an explicit reindex. No sweep exists |

## Where things live

| File | Role |
|---|---|
| `packages/host/src/handlers/knowledge.ts` | Routes |
| `packages/host/src/knowledge.ts` | Sources, chunk+index pipeline, `knowledgeInjection` |
| `packages/host/src/knowledge-ingest.ts` | Work-card auto-ingest, idempotent by origin |
| `packages/host/src/knowledge-extract.ts` | pdf / docx / text dispatch and caps |
| `packages/host/src/knowledge-text.ts` | Chunker, FTS query builder, name sanitizer |
| `packages/host/src/knowledge-embed.ts` | Embedding calls, vector storage, cosine scan, circuit breaker |
| `packages/host/src/knowledge/backends/builtin.ts` | Hybrid FTS + vector retrieval, RRF fusion |
| `packages/host/src/knowledge-reindex.ts` | Explicit re-chunk + re-index |
| `packages/host/src/knowledge-verify.ts` | Plant / retrieve / delete self-check |
| `packages/host/src/knowledge-graph.ts`, `-retrievals.ts`, `-cites.ts` | Graph projection, retrieval log, `[n]` parsing |
| `packages/core/src/security/injection-guard.ts` | `scanInjection` and its rule set |
| `packages/core/src/security/safe-fetch.ts` | SSRF-guarded URL fetch |
| `packages/db/drizzle/0003,0004,0008,0010-0013*.sql` | Schema |

## Gotchas

- **The guard refuses; it does not clean.** There is no sanitized-and-indexed outcome. A tripped source is `Failed` and invisible to retrieval.
- **A bypass leaves no audit line.** When `injectionGuardBypass` is true the scan is skipped with no log — only actual blocks get a `console.warn`. There is no record that a given source was ingested unscanned, and no test exercises the bypass on the knowledge path. **Finding.**
- **An uploaded `.html` file used to keep its markup. Fixed 2026-09-17.** `sourceKind()` (`packages/host/src/knowledge-extract.ts:69-90`) now tests `text/html` / `application/xhtml+xml` and the `.html` / `.htm` extensions **ahead of** the `text/*` branch (`:80`) and routes them to the same `htmlToText` the URL path uses (`:242`). The comment at `:77-79` records why: HTML *is* text, and reading it as text is what put `<script>` bodies inside the trusted `## Retrieved sources` block.
- **Ten document formats now go through one local converter, and it has no network path.** `.pptx .ppt .xlsx .xls .ods .odt .odp .doc .rtf .epub` (`KNOWLEDGE_DOCUMENT_EXTENSIONS`, `packages/host/src/knowledge-extract.ts:56-67`) reach `extractFile` (`packages/host/src/file-extract/index.ts:171`). anydoc is required through `createRequire` so a platform with no native binding degrades to the old pdf / docx / workbook extractors instead of failing the upload (`file-extract/anydoc.ts:53-67`, `file-extract/fallback.ts:70-81`) — and on that path `.pptx` / `.odt` / `.rtf` / `.epub` are `unsupported` again. `format_mismatch` is thrown when the extension and the magic bytes disagree (`file-extract/detect.ts:77-95`), which is how a renamed workbook is kept away from the CSV parser.
- **The `.pdf` and `.docx` readers did not move.** Two readers now sit behind one upload dialog, with two failure vocabularies (`pdf_*` / `docx_*` versus `document_*`). The reason is recorded in the file header (`packages/host/src/knowledge-extract.ts:9-13`): the index, its page markers and its failure codes are built on the existing parsers.
- **The converter's tables are parsed and then thrown away here.** `extractFile` returns `tables`, `meta.sheets` and `meta.truncated`; `documentText` keeps `extracted.text` only (`packages/host/src/knowledge-extract.ts:126-131`). A document truncated at `KNOWLEDGE_TEXT_MAX_CHARS` inside the converter is indexed with no marker on the knowledge side.
- **Uploads leave a raw copy scoped to the organization, not the desk** (`packages/host/src/knowledge.ts:458-461`). Everything else on this path is workspace-scoped.
- **Only Chat retrieves.** Job modes write cards and never call `knowledgeInjection`. A knowledge answer inside Finance does not exist.
- **A thread cannot retrieve its own card.** `excludeThreadId` (`packages/host/src/knowledge.ts:619-625`) breaks the loop, which is why proving retrieval of a Chat-authored card needs a *fresh* thread.
- **Embedding degradation is whole-source, on purpose.** "One source's vectors must share one geometry, or cosine across them is noise" (`packages/host/src/knowledge-embed.ts:88-89`). A stub-vector source still reads `Indexed`, so "indexed" does not mean "semantically searchable".
- **32-dim stub vectors and 1536-dim real ones would silently "match" on noise** if compared, because `cosineSimilarity` truncates to the shorter vector — which is why stub rows are always stored under `stub-fnv-32` and never mixed (`:128-131`).
- **There is no ANN index.** `packages/host/src/knowledge/ann.ts` is unused scaffolding pending a `sqlite-vec` spike; every vector search is a full linear scan.
- **WeKnora is dead code, not a disabled option.** `registry.ts` hardcodes `builtin`; the `0013` tables remain, and `PUT /knowledge/backend {id:"weknora"}` answers 400 "WeKnora sidecar is not part of this product" (pinned by `packages/host/src/knowledge-backend-routes.test.ts`).
- **Graph expansion is built, tested and off.** `RetrieveOptions.expand` exists and `packages/host/src/knowledge-expand.ts` is unit-tested, but there is no Settings key and Chat never passes `expand: true`.
- **`[n]` citations are positional, not name-matched.** A marker past the injected count is silently dropped (`packages/host/src/knowledge-cites.ts:64-76`).

## Verify

`.cursor/skills/verify-agentforge/features/knowledge-ingest.md` and `features/knowledge.md`; `features/knowledge-graph.md` and `features/knowledge-phases.md` for the graph and the phase state.

Testids: `knowledge-page`, `knowledge-sources`, `knowledge-url` / `knowledge-add-url`, `knowledge-paste` / `knowledge-add-paste`, `knowledge-file`, `knowledge-source-row` / `knowledge-source-type` (`apps/web/components/knowledge-page.tsx:297-446`); `knowledge-loop`, `knowledge-loop-verify`, `knowledge-loop-verified`, `knowledge-loop-stage-*` (`apps/web/components/knowledge-loop.tsx:127-247`); `knowledge-graph-*` (`apps/web/components/knowledge-graph-panel.tsx:115-243`).

Tests: `knowledge-reindex.test.ts` (cross-tenant isolation, body reconstruction, corrupt-embedding guard), `knowledge-ingest.test.ts` (one source per origin, guard-blocked bodies and titles, PII masking, delete/re-embed race), `knowledge-extract.test.ts` and `knowledge-file-source.test.ts` (the whole extraction failure matrix), `knowledge-chunk.test.ts` (boundaries, exact overlap, page markers, determinism), `knowledge-source-name.test.ts` (name as injection surface), `knowledge-cites.test.ts` (`[n]` parsing incl. unterminated fences), `knowledge-verify.test.ts`, `knowledge-stub-vectors.test.ts` and `knowledge-query-model.test.ts` (stub vs real model geometry), `knowledge-graph.test.ts`, `knowledge-expand.test.ts`, `knowledge/backend.contract.test.ts`.
