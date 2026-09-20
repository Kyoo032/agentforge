# Map — Data analysis

Last verified: 2026-09-20 at 69afca9

## Overview

Data mode turns a table the user owns into an analysis in which **every number came from a SQL query the host ran itself**. It has two halves that meet only at a dataset id: a **dataset store** (upload or paste → parse → profile → one in-memory SQLite per dataset, owned by a worker thread) and an **analysis job** (the model writes SQL through a `run_sql` tool, answers in JSON with the SQL behind each claim, and the host re-runs that SQL in code to build the evidence tables and the charts).

The thing to hold onto: **the model never sees the table.** It sees a column list, a numeric profile and 20 sample rows, and one tool. Prose in the answer is the model's; every cell in every table and every point on every chart is a query result the host produced after the model finished.

It is not Research. `analyzeDataset` passes `toolKeys: ["run_sql", "calculator"]` (`packages/host/src/data-generate.ts:257`) and nothing else — no Tavily, no Brave, no `web_search`.

## How it works

### 1. Rail → studio

`mode-data` is a rail tab whose testid is `mode-${href.slice(1)}`; Default carries it. `/data` is declared in `App.tsx` as `element={null}` (`apps/web/src/App.tsx:156`) because every work mode actually mounts through `WorkModeKeepAlive`, which maps `"/data" → DataStudio` (`apps/web/components/work-mode-keep-alive.tsx:21`) and keeps the component alive across tab switches. That is why an in-progress analysis and the adopted dataset survive a hop to Chat and back, and why there is no route-level unmount to reset the studio.

On mount the studio does one thing: `listDatasets()` → `GET /api/v1/datasets` (`apps/web/components/data-studio.tsx:76-89`, `apps/web/lib/data-client.ts:72-76`). No key is needed and none is checked; the studio shell is fully functional on a stub desk.

### 2. Getting a table in — three doors, one store

All three end in `adopt()` (`apps/web/components/data-studio.tsx:91-97`), which sets the dataset, clears the follow-up history and any shown analysis, and unshifts the summary into the saved list.

| Door | testid | Client | Wire |
|---|---|---|---|
| Upload a file | `data-upload` → hidden `data-file-input` (`:203`, `:210`) | `uploadDatasetFile` (`apps/web/lib/data-client.ts:53-61`) | `POST /api/v1/datasets`, `multipart/form-data`, field `file` |
| Paste text | `data-csv` + `data-use-pasted` (`:244`, `:251`) | `createPastedDataset` (`apps/web/lib/data-client.ts:63-70`) | `POST /api/v1/datasets`, JSON `{name, text}` |
| Reopen a saved one | `data-saved` `<select>` (`:221`) | `getDataset` (`apps/web/lib/data-client.ts:78-81`) | `GET /api/v1/datasets/:datasetId` |

The client refuses a file over 25 MB before it leaves the browser (`apps/web/lib/data-client.ts:54-56`), mirroring `DATASET_MAX_BYTES` on the host (`packages/host/src/datasets.ts:21`). `DATASET_ACCEPT` (`apps/web/lib/data-client.ts:33`) is what the file chooser filters on: `.csv,.tsv,.txt,.xlsx,.xlsm,.xls` plus the matching MIME types.

`handlePostDatasets` (`packages/host/src/handlers/datasets.ts:27-57`) prefers the multipart file and falls back to the pasted body. **Multipart form fields are not surfaced by the HTTP adapter**, so an uploaded dataset's `name` is its filename (`:35-38`); a pasted one is named by the client, which sends the localized `data.pastedTable` string (`apps/web/components/data-studio.tsx:123`).

### 3. Parse and profile — pure core, no key, no model

`parseTabular` (`packages/core/src/tabular/index.ts:54-61`) routes on the filename extension or the workbook magic bytes: `.xlsx`/`.xlsm`/`.xls` → `parseXlsx`, everything else → `parseDelimited`.

`parseDelimited` (`packages/core/src/tabular/parse-delimited.ts:150-158`) sniffs the delimiter from the first 20 non-empty lines across `, ; \t |` by scoring how many records match the modal field count (`sniffDelimiter`, `:81-95`), tokenizes RFC-4180 (quoted fields may carry the delimiter, doubled quotes and newlines; `tokenize`, `:20-65`), then `tableFromRows` (`:126-141`) trims every cell, drops fully-empty rows, takes **the first row as headers** (empty → `column_<n>`, duplicates → `_2`, `_3`), and pads or truncates the body to the header width. **No header row plus at least one data row → `null`**, which the store turns into a 400.

`profileTable` (`packages/core/src/tabular/profile.ts:58-64`) then produces, per column: inferred type (`string` / `number` / `date` / `boolean`), null count, distinct count, top-5 values with counts, and — for numbers — min/max/mean/median/stddev, or for dates min/max as ISO strings. This is what the UI renders in `DatasetProfile` (`apps/web/components/dataset-profile.tsx:70-114`) and what `profileToMarkdown` (`packages/core/src/tabular/profile.ts:104-112`) later hands the model.

### 4. The store — a row, a file, and two SQLites

`createDatasetStore` (`packages/host/src/datasets.ts:195-311`) is a repository over the kernel `datasets` table (`packages/db/src/schema.ts:641-656`, mirrored for older DBs at `packages/db/src/ensure-schema.ts:362-379`). `create` (`:208-253`):

1. `parseOrThrow` (`:126-143`) — 25 MB cap → 413, unparseable → 413, no header/data row → 400, more than `DATASET_MAX_ROWS = 200_000` rows → 413.
2. Writes the raw bytes to `<datasetRoot()>/<workspaceId>/<uuid><ext>` (`:198-216`); `datasetRoot()` is `localDataDir()/datasets` (`:315-317`).
3. `loadFromTable` (`:165-177`) builds the in-process view: `toTypedTable`, `datasetColumns`, `profileTable`, **`buildDatasetDb`** and **`createQueryRunner`**.
4. Inserts the row. **If the insert throws, the loaded dataset is disposed and the file is unlinked** (`:245-250`) — no row means no dataset, and no orphan on disk.
5. Caches the loaded dataset under `<workspaceId>:<id>`.

`datasetColumns` (`:78-85`) is where a header becomes a SQL identifier: `toSqlIdentifier` (`packages/host/src/sql-guard.ts:152-166`) lowercases, NFKD-normalizes, replaces every run of non-alphanumerics with `_`, strips edge underscores, truncates to 48 chars, prefixes `c_` when the result is empty, starts with a digit or is a reserved word (the `RESERVED` set at `:12-43` includes `data` itself), and de-duplicates with `_2`, `_3`. The original header is kept alongside so the brief can show both.

**There are two SQLite copies of every dataset**, and knowing which is which matters:

| Copy | Built by | Used by |
|---|---|---|
| Same-thread `db` | `buildDatasetDb` (`packages/host/src/datasets.ts:100-114`) | Unit tests and internal sync callers via `runReadOnlySql` (`packages/host/src/sql-tool.ts:56-92`). **Not** the model's path. |
| Worker `runner` | `createQueryRunner` (`packages/host/src/sql-runner.ts:185-299`) | Every query the model writes. |

Both are `:memory:`, both set `hard_heap_limit = 128 MB` and `query_only = 1` (`packages/host/src/datasets.ts:111-112`; worker at `packages/host/src/sql-worker-source.ts:31-32`). The worker exists so a runaway aggregate can be **killed**: the worker source is a string (`sql-worker-source.ts:9`) so it runs identically under `tsx` ESM and inside the packaged CommonJS bundle, and the main thread hands it the resolved `better-sqlite3` path — `sqliteModulePath()` (`packages/host/src/sql-runner.ts:124-129`) rewrites `app.asar/` to `app.asar.unpacked/` because a worker thread cannot load a native binding out of an asar.

`get` (`:262-285`) is cache-first; on a cache miss it re-reads the file from disk and re-parses it, which is how a dataset survives a host restart. A row whose file is gone is a 404 with "Dataset file is missing on disk" (`:277-278`).

### 5. Generate → the job stream

`onGenerate` (`apps/web/components/data-studio.tsx:147-169`) refuses an empty prompt, and with no adopted dataset sets a **client-side** error from `data.errors.needTable` without touching the network (`:153-155`). Otherwise it posts to `/api/v1/data/stream` with `{ datasetId, prompt, model, history }` (`:158-163`).

`handlePostDataStream` (`packages/host/src/handlers/jobs.ts:224-235`) resolves the tenant, calls `requireGatewayAllowed(loadSettings(...))` — a closed gateway gate is a flat `403 gateway_blocked` here, before any stream — and then wraps `analyzeDataset` in `streamJob`.

`streamJob` (`packages/host/src/job-stream.ts:30-86`) is the shape that matters for verification: it **always returns `{ type: "stream", status: 200 }`** (`:85`) and pushes the job's rejection onto the stream as a `job.error` event carrying the original code and status (`:57-59`, `jobErrorFromUnknown` at `:8-14`). On the client `settleJobEvents` (`apps/web/lib/job-stream.ts:34-46`) turns that event into a thrown `JobStreamError`, `useJobStream` stores it (`apps/web/lib/use-job-stream.ts:60-65`), and `DataStudio` renders `job.error.message` in `data-error` (`:73`, `:180-190`). So **the 503 is in the SSE payload, not on the wire** — the HTTP response to `POST /api/v1/data/stream` is 200 even when the desk has no key. The non-streaming twin `POST /api/v1/data` (`packages/host/src/handlers/jobs.ts:212-221`) does answer a real 503, but no UI calls it.

`analyzeDataset` (`packages/host/src/data-generate.ts:199-288`) then runs four emitted phases: `profiling` → `analyzing` → `verifying` → `saving`. `requireLive` (`:110-120`) is checked **before** the dataset is resolved, so a keyless generate never builds a worker: `resolveRuntimeMode` returning `stub` throws `ApiError("runtime_stub", gatewayRequiredMessage("data", localeForRun()), 503)`.

### 6. The brief the model sees, and the injection guard

`datasetBrief` (`packages/host/src/data-generate.ts:138-170`) is the whole of the model's knowledge of the table:

- a head line: name, `rows x columns`, and the literal table name `data`;
- one line per column — SQL identifier, inferred type, and the original header when it differs (`columnLines`, `:124-131`);
- the full profile as a markdown table (`profileToMarkdown`);
- the **first 20 rows** (`SAMPLE_ROWS`, `:31`) as a markdown table with the original headers (`tableSample`, `packages/core/src/tabular/index.ts:73-81`).

Cell text is third-party content, so the assembled brief goes through `scanInjection` unless `settings.injectionGuardBypass` is set. On a hit the brief is **rebuilt numerically**: top-K values are emptied, the sample rows are dropped entirely, and the model is told the rule that fired and instructed to query instead of guessing (`:155-169`). The job emits a `job.step` naming the rule (`:217-223`) so the user can see why the sample vanished.

The final prompt is brief + up to `DATA_HISTORY_MAX = 5` earlier question/summary pairs (`readHistory`, `:80-95`) + optional pasted extra context + the question (`:224-232`). The system prompt `DATA_SYSTEM` (`:33-51`) fixes the output contract: JSON only, `findings[].sql` must be a single SELECT the model already ran because **it is re-run in code**, 0–3 charts, 3–6 findings, and no invented campus/student nouns.

### 7. `run_sql` — the only road to a number

The tool is defined once (`packages/host/src/sql-tool.ts:94-121`) and finds its dataset through an `AsyncLocalStorage` (`:25-33`): `analyzeDataset` wraps the model call in `withActiveDataset({ id, query, steps, stepCap, onQuery })` (`packages/host/src/data-generate.ts:247-259`), so the tool has no dataset argument and cannot be pointed at someone else's table. Outside that scope it returns `{ success: false, error: "No dataset is attached to this run." }`.

Three caps stack:

1. **Step cap.** `SQL_STEP_CAP = 8` (`packages/host/src/sql-tool.ts:10`); past it the tool answers "Query cap reached (8). Answer with what you have." and the model must conclude.
2. **Grammar.** `assertReadOnlySql` (`packages/host/src/sql-guard.ts:125-149`) strips string literals first, then rejects: a second statement (`;`), any comment (`--`, `/*`), anything not starting `SELECT` or `WITH`, and a long forbidden-keyword list (`:7-8`) covering writes, DDL, `PRAGMA`, `ATTACH`, `load_extension`, `readfile`/`writefile`, `sqlite_master`/`sqlite_schema` and `RECURSIVE`. A self-join of `data` with no `ON`/`WHERE`/`USING` predicate is refused too (`:144-147`) — that is the cross-join blow-up guard. It runs twice: once on the runner's front door (`packages/host/src/sql-runner.ts:273`) and once in the sync helper (`packages/host/src/sql-tool.ts:61`).
3. **Runtime.** The worker serializes queries on a promise chain (`sql-runner.ts:276-281`); each gets `SQL_TIME_CAP_MS = 2000` and on expiry the pending promise rejects 408 **and the worker is terminated** (`:222-226`), to be respawned lazily on the next query. Results are capped at `SQL_ROW_CAP = 500` rows and each cell at `SQL_CELL_MAX_CHARS = 400` chars, with blobs replaced by `[blob N bytes]` (`sql-worker-source.ts:13-20`).

Every call fires `onQuery`, which the job turns into a `job.step` carrying the SQL text, the row count or the failure, and `current`/`total` against the step cap (`packages/host/src/data-generate.ts:237-241`) — that is what `JobProgressList` shows under `data-progress`.

While the job runs it holds `dataset.runner.acquire()` (`:243`, released in a `finally` at `:268`), which bumps `inUse()`; `remove` refuses with 409 while that is non-zero.

### 8. Materializing — prose is the model's, numbers are not

`parseAnalysisDraft` (`packages/host/src/data-analysis-build.ts:34-72`) pulls the JSON out of whatever the model wrapped it in (`extractJsonObject`), drops findings missing a heading or body, **throws 502 `invalid_analysis` when nothing survives**, and drops charts whose type is not `bar`/`line`/`scatter` or that lack `sql`, `x` or a series.

`materializeAnalysis` (`:146-159`) then re-runs the SQL **in code, through the same guarded worker**:

- `materializeFinding` (`:78-93`) attaches `evidence: { sql, table }` capped at `EVIDENCE_ROW_CAP = 50` rows. A failed evidence query does not fail the analysis — the finding keeps its prose with `(Evidence query failed: …)` appended (`:91`).
- `chartFromResult` (`:110-135`) matches `x` and each series **by column name in the real result**; rows where any plotted series is missing or non-numeric are **left out, never zero-filled** (`:121`), capped at `CHART_POINT_CAP = 50` points, and the chart is dropped entirely when the named columns are absent or no row is fully numeric.
- The result is validated by `dataAnalysisSchema.parse` (`packages/core/src/artifacts/data-analysis.ts:45-51`), so a malformed shape is a throw, not a half-rendered card. `tables` is always `[]` on this path — the schema supports named tables but nothing populates them.

### 9. Artifact, markdown, knowledge card

`dataAnalysisToMarkdown` (`packages/core/src/artifacts/data-analysis.ts:79-91`) flattens the analysis: `# title`, summary, then per finding `## heading`, body, a ```sql fence, and the evidence table as markdown; charts become markdown tables under `## Charts`.

That markdown is saved as an artifact with `mode: "data"`, `kind: "analysis"`, `mime: "text/markdown"` and meta `{ question, model, datasetId, datasetName, queries }` (`packages/host/src/data-generate.ts:274-280`). `persistAnalysis` (`:177-197`) **swallows a save failure** — it warns and returns `null`, and the analysis is still returned to the user, just without a download-by-id or a KB card. When it does save, `upsertWorkSource` writes a Data work card into the knowledge ingest loop (`:281-286`).

The studio renders the result through `ArtifactActions` (`apps/web/components/data-studio.tsx:295-302`, testids `data-actions` / `data-download` / `data-send-kb` / `data-make-document` / `data-make-presentation`) and `DataAnalysisView` (`:303`, testids `data-analysis` / `data-summary` / `data-finding` / `data-evidence` / `data-evidence-sql` / `data-evidence-table` / `data-charts` / `data-chart`). The summary is added to `history` so the next question is a follow-up (`:166`), shown as `data-history`.

### 10. Delete

`DELETE /api/v1/datasets/:datasetId` → `handleDeleteDataset` (`packages/host/src/handlers/datasets.ts:77-87`) → `store.remove` (`packages/host/src/datasets.ts:287-309`): refuse with 409 while the runner is in use, delete the row, dispose both SQLites and the worker, drop the cache entry, `rmSync` the raw file. A missing row is a 404.

**No UI reaches this route.** `deleteDataset` exists in the client (`apps/web/lib/data-client.ts:83-86`) with zero callers in `apps/web`; the `data-saved` picker can open a dataset but never remove one.

### Failure modes

| Failure | Where | What the user gets |
|---|---|---|
| Gate closed | `requireGatewayAllowed`, `packages/host/src/handlers/jobs.ts:228` | HTTP 403 flat `gateway_blocked`; `runJobStream` sees a JSON body and throws (`apps/web/lib/job-stream.ts:61-62`) → `data-error` |
| No key / stub runtime | `requireLive`, `packages/host/src/data-generate.ts:110-120` | HTTP **200** stream, `job.error` `runtime_stub` status 503 → `data-error` with the Toko Token / Settings hint |
| No dataset adopted | client, `apps/web/components/data-studio.tsx:153-155` | `data-error` from `data.errors.needTable`, **no network call at all** |
| Empty prompt | client `:150` then `readPrompt` `:64-73` | button disabled (`:367`); a direct post is 400 `prompt is required` |
| No `datasetId` and no `csv` | `resolveDataset`, `:98-108` | 400 `datasetId (or a pasted csv) is required` |
| File > 25 MB | client `data-client.ts:54`, host `datasets.ts:127-129` / `handlers/datasets.ts:32-34` | 413 "Dataset exceeds the 25 MB cap" |
| Unparseable bytes | `parseOrThrow`, `datasets.ts:130-135` | 413 with the parser's own message |
| One line, no data row | `tableFromRows` → `parseOrThrow`, `datasets.ts:136-138` | 400 "Could not find a header row plus at least one data row" (**English on every desk**) |
| > 200 000 rows | `datasets.ts:139-141` | 413 row-cap message |
| Empty paste body | `readPastedDataset`, `handlers/datasets.ts:12-14` | 400 "file or text is required" |
| Dataset row gone | `requireDataset`, `datasets.ts:326-331` | 404 "Dataset not found" |
| Dataset file gone | `datasets.ts:277-278` | 404 "Dataset file is missing on disk" |
| Model wrote a write/DDL/`PRAGMA` query | `assertReadOnlySql`, `sql-guard.ts:140-143` | tool returns `{success:false}`; the model retries within its 8 steps |
| Query over 2 s | `sql-runner.ts:222-226` | 408, worker terminated and respawned; tool reports the failure |
| Step cap hit | `sql-tool.ts:107-110` | tool tells the model to answer with what it has |
| Model returned no JSON object / no findings | `parseAnalysisDraft`, `data-analysis-build.ts:38-49` | 502 `invalid_analysis` → `data-error` |
| Model returned nothing | `data-generate.ts:260-262` | 502 `generation_failed` |
| Evidence query fails at materialize time | `materializeFinding`, `data-analysis-build.ts:89-92` | finding kept, prose gains "(Evidence query failed: …)" |
| Chart columns not in the result | `chartFromResult`, `:113` | chart silently dropped |
| Artifact save fails | `persistAnalysis`, `data-generate.ts:192-196` | analysis still shown, `artifactId: null`, console warn only |
| Delete during a run | `store.remove`, `datasets.ts:290-292` | 409 "Dataset is being analyzed right now" |
| User cancels | `data-cancel` → `job.cancel` (`data-studio.tsx:360`) | progress reset, **no error shown** (`use-job-stream.ts:55-59`) |

## Where things live

| File | Role |
|---|---|
| `apps/web/components/data-studio.tsx` | The whole studio: three ingest doors, profile, preview, starters, prompt bar, follow-up history |
| `apps/web/components/dataset-profile.tsx` | Per-column profile table (`data-profile`) |
| `apps/web/components/data-grid.tsx` | Row grid used for the preview, evidence tables and named tables |
| `apps/web/components/data-analysis-view.tsx` | The analysis card: summary, findings, evidence `<details>`, charts |
| `apps/web/lib/data-client.ts` | The four dataset routes plus `DATASET_ACCEPT` and the 25 MB mirror |
| `apps/web/lib/use-job-stream.ts`, `apps/web/lib/job-stream.ts` | Job SSE: progress reducer, `job.error` → thrown `JobStreamError` |
| `apps/web/components/work-mode-keep-alive.tsx` | Why `/data` is `element={null}` and the studio never unmounts |
| `packages/host/src/router.ts:241-246` | The six data routes |
| `packages/host/src/handlers/datasets.ts` | Upload / paste / list / get / delete; `datasetPayload` (profile + 100-row preview) |
| `packages/host/src/handlers/jobs.ts:212-235` | `POST /api/v1/data` (real 503) and `/data/stream` (always 200 + SSE) |
| `packages/host/src/datasets.ts` | The store: caps, parse, profile, file layout, cache, both SQLites, delete |
| `packages/host/src/data-generate.ts` | `analyzeDataset`: system prompt, brief + injection guard, phases, artifact, KB card |
| `packages/host/src/data-analysis-build.ts` | Draft JSON → re-run SQL → evidence tables and charts |
| `packages/host/src/sql-guard.ts` | `assertReadOnlySql`, `toSqlIdentifier`, `DATASET_TABLE = "data"` |
| `packages/host/src/sql-tool.ts` | The `run_sql` tool, its `AsyncLocalStorage` scope, the step cap |
| `packages/host/src/sql-runner.ts` | Worker-backed runner: spawn, serialize, time cap, kill, `inUse` |
| `packages/host/src/sql-worker-source.ts` | The worker body, kept as a string for ESM + packaged CJS parity |
| `packages/host/src/job-stream.ts` | `streamJob` — why a failed job is still HTTP 200 |
| `packages/core/src/tabular/*` | Delimiter sniffing, RFC-4180 tokenizer, type inference, profile, XLSX |
| `packages/core/src/artifacts/data-analysis.ts` | `dataAnalysisSchema`, `CHART_TYPES`, `dataAnalysisToMarkdown` |
| `packages/db/src/schema.ts:641-656`, `packages/db/src/ensure-schema.ts:362-379` | The `datasets` table and its back-fill |

## Gotchas

- **A failed data job is HTTP 200.** `streamJob` returns `{ type: "stream", status: 200 }` unconditionally (`packages/host/src/job-stream.ts:85`); the 503 lives inside the `job.error` SSE frame. Only the unused `POST /api/v1/data` answers a real 503. Any check that asserts a 503 status code on the UI path is asserting something the product does not do.
- **Host error strings are English on every desk.** Everything the store and the parser throw is a hardcoded English `ApiError` message (`packages/host/src/datasets.ts:128`, `:134`, `:137`, `:140`, `:278`, `:291`, `:329`; `packages/host/src/handlers/datasets.ts:13`). `apps/web/locales/id/data.json` carries `errors.noHeader`, `errors.parse`, `errors.rowCap`, `errors.notFound`, `errors.inUse`, `errors.datasetCap`, `errors.fileOrText`, `errors.missingFile`, `errors.stubNeedsKey`, `errors.emptyAnalysis`, `errors.invalidJson`, `errors.noFindings`, `errors.promptRequired`, `errors.datasetRequired`, `errors.list`, `errors.delete`, `errors.fileCap`, `errors.readFile` — and **none of them has a caller**; only `errors.upload`, `errors.paste`, `errors.open` and `errors.needTable` are used, and the first three only as fallbacks when the thrown error has no message. Driven proof: on an `id` desk a bad paste shows "Could not find a header row plus at least one data row".
- **There are two SQLite copies per dataset and only one of them is the model's.** `buildDatasetDb` (`packages/host/src/datasets.ts:100-114`) is built eagerly on every `create`/`get` but is only read by `runReadOnlySql`, which the analysis path never calls. Reading the same-thread `db` to reason about what the model can do is reading the wrong object — the caps, the kill switch and the serialization all live in `createQueryRunner`.
- **The table is always called `data`.** `DATASET_TABLE = "data"` (`packages/host/src/sql-guard.ts:5`), which is also in the `RESERVED` identifier set (`:41`), so a column literally named "data" becomes `c_data`. The `DATA_REFERENCE` self-join guard (`:10`) is a regex over `FROM data` / `JOIN data` / `, data`, not a parser.
- **`tables` is dead weight in the artifact.** `dataAnalysisSchema` has a `tables: NamedTable[]` field and `dataAnalysisToMarkdown` renders a `## Tables` section for it, but `materializeAnalysis` always passes `tables: []` (`packages/host/src/data-analysis-build.ts:158`) and nothing else builds a `DataAnalysis`. `data-tables` / `data-table` can therefore never appear on this path.
- **There is no way to delete a dataset from the UI.** The route and the client function exist; no component calls `deleteDataset`. Uploaded tables accumulate in the `data-saved` picker forever, and the raw files accumulate under `localDataDir()/datasets/<workspaceId>/`.
- **Uploaded datasets are named by filename, not by the user.** `handlePostDatasets` notes that multipart fields never reach the handler (`packages/host/src/handlers/datasets.ts:35`), so `name` and `filename` are both the uploaded file's name. A pasted one gets the localized `data.pastedTable` label from the client, which means two pastes are indistinguishable in the picker.
- **`requireLive` runs before `resolveDataset`.** On a keyless desk (`packages/host/src/data-generate.ts:206` before `:215`) the 503 fires without touching the store — so a *keyless* generate driven with `{csv: …}` instead of `{datasetId: …}` never creates the on-the-fly dataset that `resolveDataset` (`:103-105`) would otherwise persist. On a live desk it does, silently, with no UI trace.
- **`data-preview` only shows the first 100 rows** and only after `data-preview-toggle` is pressed; `PREVIEW_ROWS = 100` is fixed in the handler (`packages/host/src/handlers/datasets.ts:7`), and the grid's own `maxRows` is passed as 100 too (`apps/web/components/data-studio.tsx:281`).
- **The studio never unmounts.** `/data` is `element={null}` and `WorkModeKeepAlive` owns the instance, so the adopted dataset, the follow-up history and a shown analysis all survive switching to Chat and back. There is no route-level reset.
- **Cancelling shows nothing.** `useJobStream` treats an aborted run as a quiet reset (`apps/web/lib/use-job-stream.ts:55-59`), so `data-cancel` leaves the studio looking as if the user never pressed Analyze.

## Verify

`.cursor/skills/verify-agentforge/features/data.md`.

DOM testids that prove it, all in `apps/web/components/data-studio.tsx` unless noted: `data-studio` (`:172`), `data-source` (`:194`), `data-upload` (`:210`), `data-file-input` (`:203`), `data-saved` (`:221`), `data-csv` (`:244`), `data-use-pasted` (`:251`), `data-dataset` (`:257`), `data-dataset-name` (`:258`), `data-profile` (`:268`, rendered by `apps/web/components/dataset-profile.tsx:72`), `data-preview-toggle` (`:273`), `data-preview` (`:282`), `data-studio-empty` (`:308`), `data-starters` (`:313`), `data-starter` (`:319`), `data-progress` (`:291`), `data-studio-prompt-bar` (`:332`), `data-enhance` (`:340`), `data-studio-model` (`:343`), `data-history` (`:345`), `data-prompt` (`:357`), `data-cancel` (`:360`), `data-generate` (`:368`), `data-error` (`:181`). After a live analysis only: `data-actions` / `data-download` / `data-send-kb` / `data-make-document` / `data-make-presentation` (`apps/web/components/artifact-actions.tsx:71`, `:77`, `:86`, `:95`, `:104`) and `data-analysis` / `data-summary` / `data-finding` / `data-evidence` / `data-evidence-sql` / `data-evidence-table` / `data-charts` / `data-chart` (`apps/web/components/data-analysis-view.tsx:57`, `:64`, `:44`, `:17`, `:25`, `:35`, `:72`, `:74`).

Keyless proof is the whole shell plus both ingest doors plus a `data-error` on generate. `data-download` and the analysis card are **verified-unreachable without a gateway key** — they are only mounted when `shown` is set (`:293-304`).

## Why

**Why the model's SQL is re-run in code instead of trusted from the transcript.** `[Direct]` the contract in the system prompt: "findings.sql is the exact query whose result supports the finding. It is re-run in code and shown as evidence" (`packages/host/src/data-generate.ts:47`), and the function comment on `materializeAnalysis`: "Every table and chart comes from re-running the model's SQL in code; prose is the model's, numbers are not" (`packages/host/src/data-analysis-build.ts:145`). **Confidence: high.**

**Why the model's queries run in a worker thread and not on the host's own connection.** `[Direct]` the comment on `createQueryRunner`: "One worker per dataset, spawned lazily and respawned after a kill. Queries are serialized; a query past its time cap terminates the worker so a runaway aggregate or join can never block the host process" (`packages/host/src/sql-runner.ts:175-184`). `[Supported]` the same file's `sqliteModulePath` comment (`:118-123`) shows the cost that was accepted for it — the packaged app has to unpack the native binding so a worker can load it from the real filesystem. **Confidence: high.**

**Why the dataset brief passes the injection guard.** `[Direct]` the doc comment at `packages/host/src/data-generate.ts:133-137`: "Cell text (top values, sample rows, headers) is untrusted third-party content, so it passes the same injection guard as pasted source material; on a hit the numeric profile stays and the text parts are withheld." **Confidence: high.**

**Why a failed insert unlinks the uploaded file.** `[Direct]` the inline comment at `packages/host/src/datasets.ts:246`: "No row means no dataset: do not leave an orphaned file behind." **Confidence: high.**
