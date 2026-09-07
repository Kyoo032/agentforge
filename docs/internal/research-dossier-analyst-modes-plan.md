# Research dossier + Finance / Data depth — implementation plan

Status: Phase A landed on the working tree (2026-09-07, ships as 0.14.22; see `0.14.22-changelog.md`). Phase B (dossier pipeline, `web_fetch`, KB handoff) landed the same day. Phases C (data analyst) and D (finance) landed the same day. All four phases are on the working tree for 0.14.22. Owner priority order: (1) Research dossier as a portable Markdown artifact that feeds Knowledge Base, Presentation, and Documents; (2) make Finance and Data real analyst modes. Android app is paused (`mobile-android-plan.md`).

Ships as desktop builds in the 0.14.2x line. Append each landed item to the internal changelog and public notes as usual.

## Where we are (from the code, 2026-09-07)

| Mode | Today | Why it is shallow |
|---|---|---|
| Research | `research-generate.ts`: one `web_search` call (5 snippets), one model call, zod `ResearchNotes`, JSON response. Nothing persisted. No page fetching anywhere in the repo. | Snippet-only, single query, output lives only in browser memory, no streaming. |
| Finance | Documents path with `FINANCE_SYSTEM` swapped in. Prompt + free-text figures box (4000 chars), `bindings: []`, prose-only `{heading, body}`, DOCX = headings + paragraphs. | Model does all arithmetic; "never invent numbers" is prompt-only; no structured input, tables, files, persistence; regen not wired. |
| Data | Hand-rolled comma-only CSV parser, first ~4000 chars sent as text, `bindings: []`, output forced into the Research `sources[]` shape. | Zero computation in code; truncated sample answers questions about totals; no grid, no charts; markdown tables do not even render (`parse-markdown.ts` has no table block). |
| Cross-mode | None. Modes are independent `useState` components kept mounted by `WorkModeKeepAlive`. Documents/Presentation accept only `prompt` (+ image attachments on regen). | No handoff, no shared artifact store. |
| Knowledge Base | `POST /api/v1/knowledge/sources {name, text}` → `addPastedSource` → chunks + FTS + vectors. Works today. | Type label hardcoded `"Paste"`; no provenance; RAG only injected into Chat, never job modes. |

## Design principles

1. **Code computes, model narrates.** Every number in Finance/Data output is produced or verified by TypeScript, never by the LLM alone.
2. **Markdown is the interchange format.** Research dossier, Data analysis, Finance brief all serialize to a structured `.md` with a fixed skeleton. Any mode can consume "source material" Markdown.
3. **One artifact store.** A single kernel-neutral `artifacts` table (not per-mode tables) so dossiers, analyses, and briefs persist, list, reopen, and hand off the same way.
4. **Local only, as always.** Files under `localDataDir()`, SQLite via `ensure-schema.ts` (this repo has no migration files; that file is the migration mechanism). No new native modules (see DuckDB decision below).
5. **Caps everywhere.** Queries, pages, bytes per page, total dossier size, rows, query time. "Fully detailed" must not mean unbounded.

## Phase A — shared foundations (everything else depends on these)

**Done 2026-09-07.** Notes against the plan: `ensure-schema.ts` is not the only migration mechanism — `packages/db/drizzle/` has a journal, so A1 adds `0006_artifacts.sql` plus the `CREATE IF NOT EXISTS` mirror. Research already persists every result (`kind: draft`) so the artifact picker has something to pick before Phase B replaces it with the dossier. `sourceText` cap is 120k chars (truncated with a visible marker, not rejected) so a full dossier fits. Decisions 1–4 below were taken with the plan defaults.

A1. **`artifacts` table** in `packages/db/src/schema.ts` + DDL in `ensure-schema.ts`: `id, workspaceId, mode ('research'|'data'|'finance'|'documents'|'presentations'), kind ('dossier'|'analysis'|'brief'|'draft'), title, mime ('text/markdown'|'application/json'), body (text, encrypted at rest like messages), meta (json: model, question, sourceCount, sizeBytes, parentArtifactId), createdAt, updatedAt`. Routes: `GET /api/v1/artifacts?mode=`, `GET /api/v1/artifacts/:id`, `DELETE`, `GET /api/v1/artifacts/:id/file` → `type:"bytes"` with `filename` (native save for free via `apiFetch`). Do **not** route `.md` through the `media` table (its mime allowlist is image/video only).

A2. **Job progress streaming.** Widen `encodeSse` / `HostStreamResult` to accept a `JobEvent` union (`phase`, `step`, `source`, `delta`, `done`, `error`) alongside `RuntimeEvent`. Add `apps/web/lib/use-job-stream.ts` on top of `consumeSse`. Research/Data/Finance switch from silent-spinner JSON POSTs to streamed phases. Keep the JSON endpoints for tests and as fallback.

A3. **Markdown tables render.** Add a `table` block to `apps/web/lib/parse-markdown.ts` `MdBlock` + `FormattedText`. Needed by dossier preview, Data output, and Finance previews. Serializers emit real Markdown tables.

A4. **Shared schemas move to `packages/core`.** `ResearchNotes` currently exists twice (host + a verbatim web copy). Move `research-notes`, new `DataAnalysis`, `FinanceBrief`, `Dossier` zod schemas + Markdown serializers to `packages/core/src/artifacts/`. Web imports from core.

A5. **Source-material input on Documents and Presentation.** Optional `sourceText` body field on `POST /api/v1/documents` and `/presentations` (read like `data-generate.ts readCsv`), appended as `Source material:` with a char cap, plus a system-prompt line: use only supplied material when present. Same field on regenerate.

A6. **Renderer handoff.** `apps/web/lib/mode-handoff.ts`: module-level pending payload + `agentforge-mode-handoff` CustomEvent (same pattern as `agentforge-shell-refresh` and `threads-events.ts`). `DocumentsStudio`/`PresentationsStudio` subscribe, prefill `sourceText` + a suggested prompt, then `navigate()`. Because `WorkModeKeepAlive` keeps modes mounted, no router state or storage is needed. Plus an **artifact picker** in those studios ("Use a saved dossier/analysis…") so handoff also works for reopened artifacts, not only the one just created.

A7. **Tabular parser in core.** Move `apps/web/lib/parse-csv.ts` to `packages/core/src/tabular/`: delimiter sniffing (`, ; \t |`), BOM strip, quoted fields, ragged rows, **type inference** (numbers with locale separators, ISO/common dates, booleans, strings), XLSX via `xlsx` (SheetJS, Apache-2.0) as the one new dependency. Column profile: type, nulls, distinct, min/max/mean/median/stddev, top-k. Used by Data, Finance, and KB CSV ingestion. Property-tested with `fast-check` (already installed).

## Phase B — Research dossier

**Done 2026-09-07.** Deviations: no separate distill model call — the notes preview is derived deterministically from the dossier findings (citations always resolve). Extraction is one model call per read page (concurrency 3) so passages can be verified verbatim against the page text; non-verbatim passages are dropped. `web_fetch` is HTTPS-only with loopback / private-range blocking on every redirect hop (`packages/core/src/security/safe-fetch.ts`).

**Pipeline** (`packages/host/src/research-dossier.ts`; `research-generate.ts` stays the entry point):

1. **Plan** — model turns the question into 3–6 sub-queries (cap configurable, default 5).
2. **Search** — `web_search` per sub-query (Tavily/Brave, 5 hits each), dedupe by URL.
3. **Read** — new `web_fetch` platform tool: HTTPS only, `assertAllowedEndpointUrl`, 1.5 MB raw cap, reuse the KB URL extractor (`addUrlSource` tag-strip; upgrade to a readability-style extractor later). Cap pages per run (default 10) and chars kept per page (default 8k). Per-page timeout; failures are recorded in the dossier as "unreachable", never silently dropped.
4. **Accumulate** — write the dossier Markdown incrementally with a fixed skeleton (below). Per source, the model extracts key passages verbatim + a short "why it matters" note; code inserts URL, title, retrieved-at, and the query that found it.
5. **Distill** — `collectJobAssistantText` with the dossier as source material → existing `ResearchNotes` shape so `ResearchPreview` keeps working, each note citing dossier source ids. Distill may use a smaller model than plan/extract (`mode-defaults` gains `researchDistillModel`).
6. **Persist** — `artifacts` row (`kind: dossier`, body = Markdown, meta = question, queries, source count, models). Response = `{ notes, dossierId, dossier: { title, markdown } }`.

**Dossier skeleton** (frontmatter + fixed headings so distill and other modes can navigate it deterministically):

```
---
question, created, models, queries[], sourceCount, agentforge: dossier v1
---
# <title>
## Question
## Queries run
## Sources            (### S1 — title / url / retrieved / found-by-query / key passages / notes)
## Findings           (each finding cites [S#])
## Contradictions
## Open questions
```

**UI** (`research-studio.tsx`): streamed phase list (planning → searching 3/5 → reading 7/10 → distilling), a dossier tab beside the notes preview, buttons: Download `.md`, **Send to Knowledge Base**, **Make a document**, **Make a presentation**, and a list to reopen previous dossiers.

**Handoffs:** KB → `POST /api/v1/knowledge/sources {name, text, type:"Dossier"}` (thread a `type` param through `handlePostKnowledgeSource` → `addPastedSource` → `indexSource`; add a pasted-text size cap while there). Documents/Presentation → A5 + A6.

**Docs:** update `docs/product-modes.md` Research section (multi-query accumulate, dossier, handoff buttons).

**Tests:** planner output schema; fetch tool (HTTPS-only, cap, timeout, blocked hosts); skeleton serializer round-trip; cap enforcement; distill citations resolve to real `S#`; artifact persistence; handoff event → prefilled studio; KB source type label.

## Phase C — Data analyst

**Done 2026-09-07.** Deviations: the 2 s query timeout is a soft cap checked between rows (better-sqlite3 has no interrupt); the 25 MB dataset cap and LIMITed row reads bound the rest. Charts are `{sql, x, series}` re-run in code rather than model-supplied values. The dataset grid is a sliced table (first 100 rows), not virtualized. `run_sql` lives in host (needs better-sqlite3) and is only usable inside `withActiveDataset`.

**Engine decision: SQLite, not DuckDB.** `better-sqlite3` is already bundled and packaged; DuckDB would add a second native module with its own Electron ABI rebuild in `pack-brand.mjs`. SQLite covers group-by, joins, and window functions at closed-beta file sizes. Revisit DuckDB only if profiling shows a real limit.

**Flow:**

1. **Ingest** — file upload (CSV/TSV/XLSX; paste still works). Cap 25 MB via the IPC bytes envelope. Parse + profile with A7. Store the raw file under `localDataDir()/datasets/<id>` and a `datasets` row (id, workspaceId, name, rows, cols, columns json, storagePath). Load into a **per-dataset in-memory SQLite** (`:memory:`, typed columns from inference).
2. **Profile to model** — the model never sees raw rows first. It gets row count, per-column type/nulls/distinct/min/max/mean/top-k, and 20 sample rows.
3. **Agentic analysis** — `collectJobAssistantText` finally passes `bindings`: a new `run_sql` tool (SELECT-only via a whitelist parser + `PRAGMA query_only`, 2 s timeout, 500-row cap, results as compact tables) and `calculator`. Step cap (default 8 queries). Every tool call streams as a `step` event with the SQL visible to the user.
4. **Output** — new `DataAnalysis` schema: `{ title, summary, findings: [{ heading, body, evidence: { sql, table } }], tables: [...], charts: [{ type: bar|line|scatter, x, series[] }] }`. No fake `sources[]`. Serializes to Markdown with real tables.
5. **Render** — dataset grid (virtualized, first N rows), findings with evidence tables, charts as hand-rolled SVG (precedent: `usage-range-chart.tsx`; no chart library), Markdown download.
6. **Persist + follow-up** — analysis saved as `artifacts` (`kind: analysis`, `meta.datasetId`). Dataset stays loaded for follow-up questions in the same session ("now break that down by month") without re-upload.

**Handoffs:** same buttons as Research (KB, Documents, Presentation). Finance can open a dataset created here.

**Tests:** parser/profiler property tests; SQL guard (rejects INSERT/UPDATE/ATTACH/write PRAGMAs/multi-statement); timeout + row cap; `DataAnalysis` schema + Markdown round-trip; end-to-end with a fixture CSV asserting a computed total equals the SQL result, not the model's guess.

## Phase D — Finance

**Done 2026-09-07.** Deviations: free-text parsing returns line items for confirmation (`/finance/parse`) and never computes; the guard replaces unverified figures in the preview text itself (not only the DOCX) and reports them; charts in the finance preview are deferred (metrics and totals render as tables). Regenerate is wired for Finance sections.

**Flow:**

1. **Structured input** — three ways in: (a) paste/upload a table (A7, shared with Data, or pick a Data dataset), (b) a line-item form (label, period, amount, currency, unit), (c) free text as today, parsed into line items by the model **and confirmed by the user** before any math.
2. **Finance engine** — `packages/core/src/finance/`: pure, tested functions: totals and subtotals by period, margins, growth rates, burn and runway, breakeven, NPV/IRR, amortization schedule, simple projection with scenario deltas, ratio set (current, quick, debt/equity, DSCR). Deterministic; `fast-check` properties (e.g. NPV at rate 0 equals the sum of flows).
3. **Model role** — receives inputs + the computed metric table, writes narrative and structure. `run_sql` and `calculator` bound for ad-hoc checks. Output `FinanceBrief` schema: `{ title, sections: [{ heading, body, tables?, metrics? }], assumptions[], computed: MetricTable }`.
4. **Number guard** — post-generation: every numeric token in prose must match an input figure or a computed metric within rounding tolerance; mismatches are flagged in the preview and stripped from the DOCX. "Never invent numbers" becomes enforced rather than promised.
5. **DOCX** — `buildDocumentDocx` gains real tables (`docx` v9 `Table`), currency/locale formatting via `Intl.NumberFormat`, an assumptions appendix. Charts in DOCX deferred (needs a rasterizer); charts appear in the preview as SVG.
6. **Persist + regen** — `artifacts` (`kind: brief`); wire the already-existing `onRegenerate` into `FinanceStudio`.

**Tests:** engine unit + property tests; line-item parser; number guard catches an invented figure; DOCX table rendering; schema round-trip.

## Order and rationale

A → B → C → D. Foundations first because all three modes need artifacts, streaming, tables, and handoff. Research next because it is the headline idea and its handoff buttons exercise A5/A6 end to end. Data before Finance because Finance reuses Data's tabular parser, SQL tool, and grid. Each phase is shippable on its own as a 0.14.2x build.

## New dependencies (only these)

- `xlsx` (SheetJS community, Apache-2.0) — XLSX read for Data/Finance. Everything else uses what is already installed (`docx`, `zod`, `better-sqlite3`, `fast-check`).

## Non-goals for this pass

- Python / arbitrary code execution sandbox.
- DuckDB, chart libraries, PDF ingestion for the reader (revisit).
- Sync between machines; mobile.
- Any campus/student nouns in kernel (`packages/university` stays the only place).

## Open decisions for Kyo

**Taken with the plan defaults on 2026-09-07** (Kyo replied "continue" without picking): 1 = one generic table; 2 = fixed constants for beta (plus a 200,000-row ingest cap added after review); 3 = explicit button; 4 = yes, confirmation required. Reverse any of these by saying so; each is a small change.

**Follow-ups surfaced by the reviews, not done:** `tableToCsv` should prefix `=`/`+`/`-`/`@` cells before it is wired to a download; the number guard's small-integer carve-out (≤ 12, years) lets unitless small figures through; dataset disk usage has no per-workspace quota; the Data grid is a 100-row slice, not virtualized; charts in the Finance preview and DOCX are still deferred.

1. Confirm one generic `artifacts` table over per-mode tables.
2. Default caps: 5 queries × 5 hits, 10 pages read, 8k chars/page, 25 MB dataset upload. Adjustable in Settings later, or fixed constants for beta?
3. Should "Send to Knowledge Base" be automatic for every dossier, or the explicit button only (current plan: explicit).
4. Finance free-text path: require user confirmation of parsed line items before computing (current plan: yes).
