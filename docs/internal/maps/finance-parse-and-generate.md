# Map — Finance: parse and generate

Last verified: 2026-09-26. The renderer surface in § 2 and the paste door in § 4 were re-read against the guided path and driven on stub webdev. Host and core citations are unchanged from 2026-09-23 at d4561b8.

## Overview

Finance is a **task-based** mode: one set of routes, five named tasks behind them, and one governing rule — **a model never computes a number**. The rail picks the task, the URL carries it (`/finance?task=<id>`), the studio puts it on every request body, and the host validates it at the boundary.

This page is the spine every task shares: the surface, the two gates, how pasted text and uploaded files become confirmed rows, the deterministic compute → narrate → guard → persist chain, the exports, and the failure modes. The five tasks themselves — their ids, phases, module contract and the generic runner — are [`finance-tasks.md`](finance-tasks.md).

What Finance is not: a spreadsheet, and not a keyless preview. Every generating route needs a live gateway; only the two file-rendering routes (`/finance/export`, `/finance/docx`) and the file reader (`/finance/import`) work without one.

## How it works

### 1. The task is the URL's

`RailFinanceTasks` (`apps/web/components/rail-finance-tasks.tsx:52`) draws one row per `FINANCE_TASKS` entry (`packages/core/src/finance/task-ids.ts:12` — `brief`, `cashflow`, `budget`, `appraisal`, `ratios`), each linking `financeTaskHref(id)` = `/finance?task=<id>` (`apps/web/lib/finance-task.ts:55-57`). The chevron is `finance-tasks-toggle` (`rail-finance-tasks.tsx:39`), the submenu `rail-finance-tasks` (`:69`) with `rail-finance-tasks-branch` (`:70`) and one `finance-task-<id>` row (`:71`).

`taskFromParam` (`apps/web/lib/finance-task.ts:50-52`) resolves an absent or unknown `?task=` to `DEFAULT_FINANCE_TASK = "brief"` (`packages/core/src/finance/task-ids.ts:16`) — **no error**. The studio keeps the last task seen on `/finance` while it is mounted behind another mode (`apps/web/components/finance-studio.tsx:67-70`).

On the host, `readFinanceTask` does the same fallback (`packages/host/src/finance-task.ts:23-29`) and `requireFinanceTask` (`:55-61`) throws `finance_task_unavailable` 400 for a task whose `available` flag is false. **Today all five are `available: true`** (`packages/core/src/finance/tasks.ts:72`, `:98`, `:125`, `:151`, `:177`), so that 400 and the studio's one-line `finance-task-unavailable` fallback are both currently unreachable.

### 2. The surface

`/finance` with a blank or missing `task` query shows the chooser (`showChooser`, `apps/web/components/finance-studio.tsx:64`). Any non-empty query, including an unknown one, uses `taskFromParam` and opens that task. The chooser is `FinanceChooser` (`apps/web/components/finance-steps/finance-guide.tsx:11`): `finance-guide-choices` and one `finance-guide-<id>` card per task, linking `financeTaskHref(id)`. The question itself is the mode header’s outcome, `finance-guide-lead` (`apps/web/components/finance-studio-view.tsx:117`).

`FinanceStudio` (`finance-studio.tsx:47`) still owns state and the job. The layout is `FinanceStudioView` (`apps/web/components/finance-studio-view.tsx:59`). On a task it renders:

- `finance-studio` (`:99`), `finance-guide-steps`, `finance-task-current` (`:190`), `finance-task-hint` (`:195`), `finance-task-term` (`:201`), `finance-guide-change` (`:206`, back to `/finance`);
- the task's inputs from `financeStepsFor(task)` (`apps/web/components/finance-steps/registry.tsx:29-31`), then one primary in `finance-primary` (`finance-studio-view.tsx:412`): `finance-parse` or, on ratios, `finance-ratios-parse` (`:405`) until rows are confirmed, then `finance-generate` (`:394`). On a result the primary is `finance-export` and a second `finance-generate` sits inside More options (`:334`);
- `finance-studio-empty` (`:288`) until a result exists, then `FinanceResultNotices` plus the task's `StepResult` (default `FinanceResultPanel`);
- `finance-advanced` (`:311`, “More options”) holding `FinancePromptFields` — `finance-enhance`, `finance-studio-model`, `finance-prompt` (`apps/web/components/finance-steps/finance-prompt-bar.tsx:12-46`, an `<input>`) — and `finance-how` (`finance-studio-view.tsx:324`) with `FinancePhaseStrip` (`finance-phase-strip.tsx:28`);
- `finance-cancel` (`:415`) only while a job runs;
- `finance-export` / `finance-export-toggle` (`apps/web/components/finance-export-menu.tsx:114`, `:126`) only once a result exists. `emphasis="primary"` uses `btn btn-primary` on the download button.

The form is `finance-studio-prompt-bar` (`finance-studio-view.tsx:227`). An empty instruction on generate uses `defaultFinancePrompt(task, language)` (`finance-studio.tsx:235`), so confirmed rows enable Write it up with More options left closed. Auto-parse still looks at the owner's own prompt (`briefLooksLikeFigures(prompt)` at `:240`), not the default.

Drafts are per desk **and per task**: key `agentforge-finance-draft:<scope>:<task>` (`apps/web/lib/finance-drafts.ts:18`, `:40`), capped at `FINANCE_DRAFT_MAX_CHARS = 12_000` (`:24`), `localStorage` with an in-memory fallback. Switching task swaps the whole draft and clears items, prose, facts, params, source and result (`finance-studio.tsx:119-136`).

### 3. Routes and the two gates

Seven routes, all `POST` (`packages/host/src/router.ts:289-295`):

| Route | Handler | Gate | Live runtime |
|---|---|---|---|
| `/api/v1/finance` | `handlePostFinance` (`packages/host/src/handlers/finance.ts:13`) | yes (`:17`) | yes |
| `/api/v1/finance/stream` | `handlePostFinanceStream` (`:29`) | yes (`:33`) | yes |
| `/api/v1/finance/parse` | `handlePostFinanceParse` (`:49`) | yes (`:53`) | yes |
| `/api/v1/finance/regenerate` | `handlePostFinanceRegen` (`:61`) | yes (`:65`) | yes |
| `/api/v1/finance/docx` | `handlePostFinanceDocx` (`:79`) | **no** | no |
| `/api/v1/finance/export` | `handlePostFinanceExport` (`packages/host/src/handlers/finance-export.ts:119`) | **no** | no |
| `/api/v1/finance/import` | `handlePostFinanceImport` (`packages/host/src/handlers/finance-import.ts:290`) | **no** | no |

**Gate first.** `requireGatewayAllowedFor(tenant)` runs at the top of the four gateway-bound handlers; a closed gate is `403 gateway_blocked` before any work — see [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md). `requireFinanceTask` runs immediately after, so a bad `task` is a 400 before the model is reached.

**Then liveness.** `requireLive` (`packages/host/src/finance-tasks/live.ts:47-57`) resolves the runtime from the saved key and `AGENTFORGE_RUNTIME` and throws `ApiError("runtime_stub", gatewayRequiredMessage("finance", localeForRun()), 503)` on `stub`. Finance has no stub path.

The refusal reaches the client in two shapes, because `/finance/stream` has already sent its headers: `/parse`, `/finance` and `/regenerate` answer a real HTTP **503**; `/finance/stream` answers HTTP **200**, `text/event-stream`, with one `event: job.error` frame carrying `status: 503`. `streamJob` (`packages/host/src/job-stream.ts:30`) builds it through `jobErrorFromUnknown` (`:8-14`, `:85` returns `status: 200`); `useJobStream` puts it in `job.error` and the studio renders `error = localError ?? job.error?.message ?? null` (`finance-studio.tsx:93`) in `finance-error` (`apps/web/components/finance-studio-view.tsx:211`). **The status on the wire is not the status the user sees.**

### 4. Getting figures in — three doors

**Paste.** `finance-figures-input` (`apps/web/components/finance-steps/finance-inputs-panel.tsx:78`). The read button is the footer primary, `finance-parse` (`apps/web/components/finance-studio-view.tsx:405`; `finance-ratios-parse` on ratios). It calls `onRead()` (`finance-studio.tsx:217`), which runs a task-local reader when one is registered and otherwise `onParse()` (`:174`) → `parseFinanceFigures` (`apps/web/lib/finance-client.ts:143`) → `POST /api/v1/finance/parse`.

**Upload.** `FinanceFileUpload` is the first control in the inputs panel, above the figures box (`finance-inputs-panel.tsx:65`): `finance-upload` (`apps/web/components/finance-file-upload.tsx:164`), `-input` (`:174`), `-drop` (`:183`), `-error` (`:192`), `-sheet` (`:210`, only for a multi-sheet file), `-preview` (`:44`), `-warnings` (`:91`), `-pii` (`:101`), `-use` (`:231`), `-remove` (`:235`). `finance-upload-use` writes text into `finance-figures-input` through `mergeFigures` (`finance-inputs-panel.tsx:65`) — it **appends on a new line** and never becomes a line item on its own.

**Saved dataset.** `finance-dataset` (`finance-inputs-panel.tsx:112`), rendered only when `listDatasets()` returned rows (`:99`). Brief only.

#### The import path

`POST /api/v1/finance/import` takes **multipart** (`packages/host/src/handlers/finance-import.ts:84`, field `file`) and a sheet through `?sheet=` or a JSON body (`:108-112`). Accepted: `.csv`, `.xlsx`, `.xls` (`packages/core/src/finance/import-table/limits.ts:23`) plus `.pdf`, `.docx`, `.pptx` (`finance-import.ts:45`, all six at `:50-53`). The client does not restate any of it: `FINANCE_IMPORT_ACCEPT` is built from core's `FINANCE_IMPORT_EXTENSIONS` plus the three document ones, and `FINANCE_IMPORT_MAX_SHEETS` / `FINANCE_IMPORT_MAX_BYTES` are re-exported from `@agentforge/core/finance` (`apps/web/lib/finance-import-client.ts`).

Order in `requireImportFile` (`finance-import.ts:83-106`): empty → 400; over `FINANCE_IMPORT_MAX_BYTES = 25_000_000` (`packages/core/src/finance/import-table/limits.ts:11`) → **413**; unknown extension → `unsupported_content_type` 400; magic bytes checked for the spreadsheet extensions (`:70-79`, `:104`) — a `.csv` that is really a workbook is refused.

Documents go through `extractFile` (`:211`, `packages/host/src/file-extract/index.ts:172`): each markdown table becomes a selectable sheet (`finance-import.ts:150-156`), the prose is kept separately and capped at `FINANCE_FIGURES_TEXT_MAX` (`:159-169`). Spreadsheets go through `readFinanceTable` (`packages/core/src/finance/import-table/read.ts:228`), with `FINANCE_IMPORT_MAX_SHEETS = 30`, `MAX_ROWS = 5_000`, `MAX_COLS = 100`, `MAX_CELL_CHARS = 160` (`limits.ts:13-21`).

A sheet becomes figures text in code (`financeFiguresFromSheet`, `packages/core/src/finance/import-table/text.ts:241`): header detection (`layout.ts:66`), period columns (`periods.ts:94`), locale-voted number style (`numbers.ts:147`), ledger/long-format folding (`long-format.ts:119`), register rows (`register-text.ts:178`), subtotal rows tagged `[subtotal]` (`block-rows.ts:15`). Warnings actually produced: `dropped_rows`, `dropped_columns`, `direction_mismatch`, `compacted`, `truncated`, `capped_cells` (one line counting the cells `cleanCell` cut at `FINANCE_IMPORT_MAX_CELL_CHARS`, `read.ts`), `pii_amount_restored`; the client maps them to copy in `apps/web/lib/finance-import-warnings.ts:21-29`. Every declared code is emitted — there is no dead warning left.

Finally `requireNoInjection` (`finance-import.ts:133-137`) scans the filename and the extracted text and answers `injection_blocked` 400.

### 5. Stage 1 — parse: code reads the figures, the model only names things

`handlePostFinanceParse` dispatches on the task: `financeTaskParser(task)` (`packages/host/src/finance-tasks/parsers.ts:27-30`) picks one of five hooks, with the brief's as the fallback. The brief's is `parseFinanceFigures` (`packages/host/src/finance-generate.ts:86`).

The brief's read, in order:

1. **Redact first** — `guardFinanceInput({ figuresText })` (`finance-generate.ts:116`), and the document's prose separately (`:119`). The redacted copy is the only copy that travels.
2. **Expand magnitudes** — `expandMagnitudes(text, locale)` (`packages/core/src/finance/magnitude.ts:102`) rewrites `18.4B`, `5jt`, `3 miliar`, `900k` to plain integers before any model sees them. `M` is locale-decided: a million in `en`, `miliar` (1e9) in `id` (`:68-73`). Lowercase `m`, `b`, `t` are deliberately not suffixes (`:11-17`).
3. **Table first** — `parseFiguresTable` (`packages/host/src/finance-parse-figures.ts:221`) reads the rows deterministically via `readFiguresText` and `lineItemsFromRows`. The model is asked **one** question it is better at: what category does this *label* belong to (`CATEGORY_SYSTEM`, `:62-69`; `askForCategories`, `:148`). It is given labels and ids, never amounts, and answers are matched back by id. Skipped entirely above `CATEGORY_BATCH_MAX = 120` unplaced labels (`:46`, `:233`).
4. **Prose fallback** — only text with no readable table reaches `parseFiguresProse` (`:242`) and `PARSE_SYSTEM` (`:50-60`), capped at `FIGURES_TEXT_MAX = 12_000` (`:44`). Its answer is then re-guarded in code: `looksScaled(rawText, dropCountRows(parseLineItems(...)), locale)` (`:252`) — `parseLineItems` drops invalid rows (`packages/core/src/finance/line-items.ts:74`, cap `LINE_ITEMS_MAX = 500` at `:5`), `dropCountRows` removes currency-free whole numbers under `COUNT_ROW_MAX_AMOUNT = 1000` next to a countable noun (`packages/core/src/finance/count-rows.ts:98`, `:87`, `:43`), and `looksScaled` re-scales a mantissa the model dropped (`magnitude.ts:125`, exponents at `:41`). Zero surviving items is `422 invalid_finance` (`finance-parse-figures.ts:254-256`).
5. **Stated facts** — figures a document writes in a sentence (a headcount, a ratio, a dividend) come back as `proseFacts`, named by a labels-only model pass (`FACT_LABEL_SYSTEM`, `:71-77`; skipped above `FACT_BATCH_MAX = 60`, `:48`, `:169`). They are quotations, not inputs: see §6.

The answer is `{ items, derived, statedFacts, proseFacts, needsConfirmation: true, source: "table" | "prose", pii, model? }` (`:79-95`). **Nothing has been computed yet.**

Client-side, pressing `finance-generate` with a brief, no rows and no dataset runs `briefLooksLikeFigures` (`apps/web/lib/finance-brief.ts:11`) and, if true, `autoParseBrief` (`finance-studio.tsx:192`) — which parses **and returns** (`:222-223`). `finance-auto-parsed` (`:316`) shows the count; the owner presses Generate a second time.

### 6. Stage 2 — compute in code, then narrate around it

`generateFinanceBrief` (`packages/host/src/finance-generate.ts:165-292`) reads the task and hands anything that is not the brief to the generic runner (`:173-179`) — see [`finance-tasks.md`](finance-tasks.md). The brief keeps the path below.

- **`resolveInputs`** (`:127-141`): confirmed `items` through `readFinanceInputs` (`packages/host/src/finance-brief-build.ts:51`, params filtered to `FINANCE_PARAM_KEYS` at `:15`); else a `datasetId` through `lineItemsFromTable` (`packages/core/src/finance/line-items.ts:41`), 400 when no numeric column; else 400 "items are required".
- **Redact the rows** — `guardFinanceInput({ lineItems })` (`finance-generate.ts:194`) before the prompt table is written; the summary is merged with the source text's (`:196`).
- **`computeFinance(items, params, { locale })`** (`packages/core/src/finance/metrics.ts:296`) is pure TypeScript: the per-period profit ladder, fiscal-year roll-ups, register metrics, trend and burn metrics, ratios, breakeven, NPV/IRR (`:324-338`), the tables (`:343-348`), the **`allowed`** list — every number the narrative may cite (`:349-354`) — and `checks`, the subtotals the source printed with our own arithmetic beside them (`:339`, type at `:24-30`).
- **Stated facts** are added on top by `withStatedFacts` (`packages/host/src/finance-stated.ts:65`): a table plus entries in `allowed`, and `metrics` is deliberately untouched (`:84-87`) — a quotation is not something we computed.
- **The narrative call** (`finance-generate.ts:213-225`) sends `BRIEF_SYSTEM` (`:48-61`) through `withFinanceTaskRules` and `withOutputLanguage` (`:209`), with a prompt body of `financePromptBlock` (`packages/host/src/finance-brief-build.ts:279`) plus `statedFactsBlock` — **Markdown tables only**, never loose prose numbers. The request's pin travels as `modelExplicit: readModelPinned(body)` (`:216`). An empty reply is `502 generation_failed` (`:226-228`).
- **Guard, then repair** — `buildFinanceBrief(parseBriefDraft(run.text), computed)` (`:232`) guards the title, every heading, every body and every assumption (§ 7), then `repairUnverifiedSections` (`:234-240`) asks for **one** rewrite of each marked section and finally strips the sentences that still do not trace. The marker never ships. A section the repair emptied keeps its heading and says why in the reader's language (`EMPTIED_SECTION_BODY`, `:74-77`, applied at `:241`): the schema refuses an empty body, and before 2026-09-23 that refusal answered `500`. An assumption the guard dropped counts into `guard.removed` with the repair's removals (`:242-247`), so the reader is told the same way.

Four `job.phase` frames bracket the work — `computing`, `drafting`, `verifying`, `saving` (`:191`, `:208`, `:231`, `:255`) — with `throwIfJobAborted` before each. They drive `finance-progress` (`finance-studio.tsx:336`; testids `finance-progress`, `-round`, `-phase`, `-sources` in `apps/web/components/job-progress.tsx:30`, `:35`, `:44`, `:60`). **None are emitted on a keyless run**, because `requireLive` throws at `finance-generate.ts:181`.

### 7. The number guard

`guardNumbers(text, allowed)` (`packages/core/src/finance/number-guard.ts:173`) replaces any figure that does not trace to `allowed` with `UNVERIFIED_MARKER = "[unverified figure]"` (`:12`). Tolerances: relative `0.005`, absolute `0.5`, small-absolute `0.0500001` (`:7-10`) with the small band under `SMALL_FIGURE_MAX = 100` (`:11`).

**Which numbers are free (tightened 2026-09-23).** Only a count written as one or two bare digits, up to `FREE_INTEGER_MAX = 12` (`:15`), and a year written as four bare digits in `1900..2100` (`:16-17`) pass without tracing (`BARE_COUNT` / `BARE_YEAR`, `:23-24`; `isFreeNumber`, `:143`). The test used to be on the parsed value, so "$2,000", "2k" and "Rp 1.950" — all unit-less integers in the year range once parsed — and "12.0" passed as a year or a count. A currency mark, a scale, a sign, a separator or a decimal now makes it an amount, and an amount has to trace ([SR-76](../security-register.md#sr-76)).

**The guard covers everything the model wrote, not only the bodies (2026-09-23).** `buildFinanceBrief` (`packages/host/src/finance-brief-build.ts:191`) guards the title with `guardTitle` (`:140`) — a title stating an untraced figure is replaced whole by `DEFAULT_BRIEF_TITLE`; each heading with `guardLabel` (`:121`) — the figure is cut out and the words kept, and a heading that was nothing but the figure becomes `…`; each body with `guardNumbers` inside `guardSection` (`:166`); and the assumptions with `guardAssumptions` (`:149`) — an assumption resting on an untraced figure is dropped whole and counted. Titles, headings and assumptions are never rewritten by the repair, so the marker is never left in them. Flags from outside any section carry `section: GUARD_OUTSIDE_SECTIONS` (`-1`, `:21`). `guardSection` also drops any metric key the section claimed that `computed` does not publish (`:181`).

A marked figure is **not an error**: it is counted into `guard.total`, one rewrite is attempted, and the remaining marked sentences are removed (`packages/host/src/finance-section-repair.ts:38`, `:98`). The reader is told once, through the report's `REMOVED_SENTENCE_FLAG` (`packages/core/src/finance/report-brief.ts:78`).

### 8. Privacy: what leaves the desk

`packages/host/src/finance-privacy.ts:10-17` states the three rules: redaction is always on (there is no bypass — `injectionGuardBypass` turns off the injection guard and nothing else), the redacted copy is the only copy that travels, and a hit is never logged in the clear.

Classification is **header-based** (`packages/core/src/finance/pii-columns.ts:64-88`): NIK → NPWP → amount veto → email → phone → name → account. A `name` column is replaced by a stable pseudonym `Karyawan N` (`:14`, `pii-scan.ts:97`); every other kind is masked (`[nik]`, `[phone]`, …). A cell that parses as an amount is never rewritten (`pii-scan.ts:91`), and a subtotal label like "TOTAL GAJI" is exempt from pseudonymising (`:94-96`).

The last line of defence is `restoreFinanceAmounts` (`finance-privacy.ts:92-110`): any cell the importer read as a number before redaction and not after is **put back**, unless its column was positively identified. It exists because `(23.960.000.000)` under a column headed `2024` once reached the model as `[phone])` (`:88-90`). The count comes back as the `pii_amount_restored` warning (`:113-124`); the studio shows `finance-upload-pii` and `finance-result-pii` (`apps/web/components/finance-steps/finance-result-notices.tsx:21`).

The file reader never opens a socket: `packages/host/src/file-extract/anydoc.ts:4-9` records that `toMarkdownBytes` is called with exactly two arguments so hosted OCR cannot be reached, and `no-hosted-ocr.test.ts` pins repo-wide that no source file carries both `anydoc` and an `ocr:` option, and that `FIRECRAWL_API` appears nowhere. A scanned PDF is refused locally as `needs_ocr` (`packages/host/src/file-extract/errors.ts:52`).

One exception worth knowing: the budget task's pairing may send **line labels only** to the gateway embedder (`packages/host/src/finance-tasks/budget-embed.ts:1-18`, cap `BUDGET_EMBED_LABEL_MAX = 200` at `:26`). No amount, period, scenario or filename goes with them, and a stub answer is discarded rather than scored.

### 9. Locale

The studio sends the locale on the request; `readFinanceLocale` (`packages/host/src/finance-locale.ts:15-18`) reads it and falls back to `localeForRun()`, never to English. That one value drives the magnitude rewrite, the prompt block, `withOutputLanguage`, the report and the export. Reading the boot locale instead is how an Indonesian sheet came back as an English brief (`:5-7`).

### 10. Persist, artifact meta, knowledge card

`persistBrief` (`finance-generate.ts:143-163`) saves `mode: "finance"`, `kind: "brief"`; a failure is a `log.warn` and a null id, never a failed run. `financeArtifactMeta` (`packages/host/src/finance-artifact.ts:36`) puts the brief JSON and the guard summary on `meta` beside the provenance (`question`, `model`, `task`, `itemCount`, `flagged`), unless the JSON exceeds `FINANCE_META_MAX_BYTES = 256 * 1024` (`:20`), in which case it is dropped with a warning. The `model` recorded is `run.model`, the one that answered (`finance-generate.ts:264`). When an id came back the brief is also written to the Knowledge Base as a work card (`:269-281`) — see [`knowledge-ingest-loop.md`](knowledge-ingest-loop.md).

**Section regen now carries the artifact id back.** `readRegenArtifactId` (`packages/host/src/finance-generate.ts:301-304`) reads it off the body and `regenerateFinanceSection` returns it (`:393`, `:409`), so "Send to Knowledge Base" after a rewrite updates the same card instead of minting a second one (`:294-300`).

**Section regen runs the same repair as a generate (2026-09-23).** `regenerateFinanceSection` (`:315`) guards the rewrite with `guardSection` and then hands it to `repairUnverifiedSections` — one rewrite of whatever the guard blanked, then the sentence goes (`:367-378`). A rewrite with nothing traceable left keeps the section it was asked to replace, and the guard says why. Before this the rewritten section went back with the literal `[unverified figure]` in it, in front of the reader ([SR-76](../security-register.md#sr-76)).

### 11. The report, the charts and the exports

Every export and every on-screen chart reads one format-neutral object, `FinanceReport` (`packages/core/src/finance/report.ts:75`): `summary` KPIs, `tables` (`inputs` at `:24`, `calc` at `:26`, then the computed ones), `charts`, `flags`, `notes`. Two builders make one from a brief: `financeReportFromBrief` (`packages/core/src/finance/report-brief.ts:242`) and, for a brief that only exists as markdown, `financeReportFromMarkdown` (`:296` — notes only, no tables, no charts). A task builds its own.

`FinanceResultPanel` (`apps/web/components/finance-steps/finance-result-panel.tsx:43-46`) uses `result.report` when the host sent one and otherwise builds it from the brief, then draws it through `FinanceReportCharts` — `finance-charts` (`apps/web/components/finance-charts/index.tsx:35`), `finance-charts-empty` (`:29`), one `finance-chart-<id>` per chart (`chart-frame.tsx:47`) — above the prose.

`POST /api/v1/finance/export` (`packages/host/src/handlers/finance-export.ts:119`) resolves what to render in this order (`:89-110`): a posted `report`, else a posted `brief`/`result.brief`, else an `artifactId` — and for an artifact, the **stored report** first (`readStoredFinanceReport`, `packages/host/src/finance-tasks/persist.ts:67`), then the stored brief (`readStoredFinanceBrief`, `finance-artifact.ts:56`), then the markdown. A posted report is untrusted input: size-capped at `FINANCE_REPORT_MAX_BYTES = 256 * 1024` (`packages/host/src/finance-tasks/report-schema.ts:14`, 413 at `:74-76`) and shaped by `financeReportSchema` (`:59`) whose cells are primitives only.

The registry renders it (`packages/host/src/renderers/registry.ts:22-28`): `xlsx` (the default, `:10`), `pptx`, `docx`, `md`, and `pdf`, which throws `501 format_unavailable` on purpose (`:12-20`). Mimes are in `packages/host/src/renderers/types.ts:32`. The picker offers only three (`FINANCE_EXPORT_FORMATS = ["xlsx","pptx","docx"]`, `apps/web/lib/finance-export.ts:15`), remembering the choice per desk under `agentforge-finance-export-format:<scope>` (`:22`, `:45-48`).

`POST /api/v1/finance/docx` survives as the older alias (`router.ts:233`) and nothing in the UI calls it.

### Failure modes

| Case | Where | Result |
|---|---|---|
| Gate closed | `requireGatewayAllowedFor`, `packages/host/src/handlers/finance.ts:17, 32, 52, 64` | 403 `gateway_blocked`; `/export`, `/docx` and `/import` are **deliberately** not gated — they never reach the gateway and a closed gate must not stop the owner reading or exporting their own files. Each handler says so; `handlers/finance-gate.test.ts` pins it |
| Task not built | `requireFinanceTask`, `packages/host/src/finance-task.ts:55-61` | 400 `finance_task_unavailable` — unreachable today, all five ship |
| No key / stub runtime | `requireLive`, `packages/host/src/finance-tasks/live.ts:47-57` | `/parse`, `/finance`, `/regenerate`: **503** `runtime_stub`. `/finance/stream`: **200** with one `job.error` frame carrying `status: 503` |
| Brief has no digit and no currency token | `briefLooksLikeFigures`, `apps/web/lib/finance-brief.ts:11` | no request at all; `finance-error` shows `finance.errors.addItems` (`finance-studio.tsx:226`) |
| Figures text missing or blank | `packages/host/src/finance-generate.ts:109-111` | 400 `invalid_request` |
| Model returns non-JSON at parse | `packages/host/src/finance-parse-figures.ts:104-110` | 502 `invalid_finance` |
| Every prose row invalid or dropped | `:254-256` | 422 `invalid_finance`, `modeMessage("noFiguresParsed")`; the client appends the add-items hint (`apps/web/lib/finance-brief.ts:58-62`) |
| `items` malformed | `readFinanceInputs`, `packages/host/src/finance-brief-build.ts:42` | 400 `invalid_request` |
| Dataset has no numeric column | `packages/host/src/finance-generate.ts:135-137` | 400 `invalid_request` |
| Neither items nor dataset | `:119` | 400 `invalid_request` |
| Prompt missing | `readPrompt`, `packages/host/src/finance-tasks/live.ts:23-32` | 400 `invalid_request` |
| Narrative returns empty text | `packages/host/src/finance-generate.ts:226-228` | 502 `generation_failed` |
| `sectionIndex` out of range | `readSectionIndex`, `:284-290` | 400 `invalid_request` |
| Narrative invents a number | `guardNumbers` → one rewrite → sentence removal | marked, counted in `guard.total`, then removed; never shown to the reader |
| Upload empty / oversized / wrong type | `requireImportFile`, `packages/host/src/handlers/finance-import.ts:88-104` | 400, **413**, `unsupported_content_type` 400 |
| Scanned PDF | `packages/host/src/file-extract/errors.ts:52` | 400 `needs_ocr`, nothing sent anywhere |
| Upload carries prompt-injection text | `requireNoInjection`, `finance-import.ts:133-137` | 400 `injection_blocked` |
| Posted report oversized / malformed | `readPostedFinanceReport`, `packages/host/src/finance-tasks/report-schema.ts:74-80` | **413** / 400 `invalid_request` |
| `pdf` export | `packages/host/src/renderers/registry.ts:18-20` | 501 `format_unavailable` |
| Artifact could not be saved | `persistBrief`, `packages/host/src/finance-generate.ts:158-162` | `log.warn`, `artifactId: null`, run still succeeds |
| Client cancels | `throwIfJobAborted`, `packages/host/src/job-stream.ts:19` | 499 `aborted`; `useJobStream` resets quietly |
| DOCX brief malformed | `packages/host/src/handlers/finance.ts:81-83` | 400 `invalid_request` — reachable **without** a key |

## Where things live

| File | Role |
|---|---|
| `packages/host/src/router.ts:289-295` | The seven Finance routes |
| `packages/host/src/handlers/finance.ts` | Generate, stream, parse, regenerate, docx; the gate and the task check |
| `packages/host/src/handlers/finance-export.ts` | `/finance/export` — report first, brief second, artifact third |
| `packages/host/src/handlers/finance-import.ts` | `/finance/import` — spreadsheet or document to figures text |
| `packages/host/src/finance-task.ts` | `readFinanceTask`, `requireFinanceTask`, `withFinanceTaskRules` |
| `packages/host/src/finance-tasks/live.ts` | `readPrompt`, `readModelPinned`, `requireLive`, `resolveModel` |
| `packages/host/src/finance-generate.ts` | The brief's pipeline, `resolveInputs`, `persistBrief`, section regen |
| `packages/host/src/finance-parse-figures.ts` | Table-first parse, the three system prompts, the prose fallback |
| `packages/host/src/finance-brief-build.ts` | Input reading, draft parsing, `guardSection`, `financePromptBlock` |
| `packages/host/src/finance-section-repair.ts` | One rewrite, then clean sentence removal |
| `packages/host/src/finance-privacy.ts` | The redaction guard and `restoreFinanceAmounts` |
| `packages/host/src/finance-stated.ts` | Stated facts as a table and as allowed figures |
| `packages/host/src/finance-locale.ts` | Which language a run answers in |
| `packages/host/src/finance-artifact.ts` | The structured brief on the artifact, and the 256 KB cap |
| `packages/host/src/file-extract/` | PDF / DOCX / PPTX reading, entirely local |
| `packages/host/src/renderers/` | `registry.ts` plus `xlsx`, `pptx`, `docx`, `md`, `pdf` |
| `packages/core/src/finance/import-table/` | Sheet → figures text: layout, periods, numbers, ledger, register |
| `packages/core/src/finance/pii-scan.ts`, `pii-columns.ts` | Header classification, pseudonyms, masks |
| `packages/core/src/finance/magnitude.ts` | `expandMagnitudes`, `looksScaled` |
| `packages/core/src/finance/count-rows.ts`, `derived-rows.ts` | Counts dropped, printed subtotals split out |
| `packages/core/src/finance/metrics.ts`, `engine.ts` | `computeFinance`, `allowed`, `checks`; the pure math |
| `packages/core/src/finance/number-guard.ts` | `guardNumbers`, `extractNumbers`, the marker |
| `packages/core/src/finance/report.ts`, `report-brief.ts`, `report-formulas.ts` | `FinanceReport` and the brief's builders |
| `apps/web/components/finance-studio.tsx` | State shell: task from the URL, drafts, parse and generate |
| `apps/web/components/finance-studio-view.tsx` | The guided layout: chooser, one primary, More options |
| `apps/web/components/finance-steps/finance-guide.tsx` | Task cards, the step trail, and the task-level fold |
| `apps/web/components/finance-steps/` | `registry.tsx`, the shared panels, and one folder per task |
| `apps/web/components/finance-file-upload.tsx` | The upload that fills the paste box |
| `apps/web/components/finance-export-menu.tsx`, `apps/web/lib/finance-export.ts` | The format picker and the per-desk memory |
| `apps/web/components/finance-charts/` | The on-screen SVG charts, off the same `FinanceReport` |
| `apps/web/lib/finance-task.ts`, `finance-client.ts`, `finance-drafts.ts` | Task plumbing, fetch wrappers, per-desk-per-task drafts |

## Gotchas

- **The generate route answers 200, not 503.** Only `/finance/parse`, `/finance` and `/finance/regenerate` are HTTP 503 keyless. A harness that asserts on the HTTP status of a generate reads a refusal as success.
- **`finance-inputs` is not universal.** Four tasks mount a panel with `data-testid="finance-inputs"`, but the ratios task mounts `finance-ratios-inputs` with `finance-ratios-figures` (`apps/web/components/finance-steps/ratios/ratios-inputs.tsx:103`, `:121`). `finance-ratios-parse` is the same footer button the other tasks call `finance-parse` (`apps/web/components/finance-studio-view.tsx:405`). A recipe that asserts `finance-inputs` on every task fails on ratios. The chooser (`/finance` with no task query) mounts none of them.
- **There is no coming-soon panel.** It was removed on 2026-09-17 with its three testids (`finance-task-coming-soon`, `finance-task-sample`, `finance-coming-soon-back`) and its `finance.comingSoon` locale block. All five tasks are `available: true` (`packages/core/src/finance/tasks.ts:72, 98, 125, 151, 177`), so the `finance_task_unavailable` 400 and the studio's one-line `finance-task-unavailable` fallback are both unreachable; the flag itself stays, because the core registry pins it to the module map.
- **Section regen no longer returns `artifactId: null`.** It carries the posted id back (`packages/host/src/finance-generate.ts:301-304`, `:393`) so the Knowledge Base card is rewritten rather than duplicated. A map or script that still expects `null` is stale.
- **The parse route barely uses the model.** For a readable table it asks one labels-only question and never sees an amount (`packages/host/src/finance-parse-figures.ts:62-69`, `:221-239`). Only text with no table falls through to `PARSE_SYSTEM`. Do not describe Finance parsing as "the model reads the figures" any more.
- **A stated fact is a quotation, not an input.** `withStatedFacts` adds a table and widens `allowed` but never touches `metrics` (`packages/host/src/finance-stated.ts:84-87`). It will never appear in a sum.
- **`looksScaled` needs the raw text, not the expanded text** (`packages/core/src/finance/magnitude.ts:125`, called with `text` at `finance-parse-figures.ts:252`) — the suffixes are the evidence.
- **`M` is locale-dependent** and margins hide scale bugs, because ratios are scale-invariant. Verify a stored **amount**.
- **Counts vanish on purpose.** `dropCountRows` removes a currency-free whole number under 1000 sitting next to a countable noun (`packages/core/src/finance/count-rows.ts:87`, `:98`). "12 outlets" is gone; "units sold 12000 IDR" stays.
- **An export by `artifactId` alone is only as good as that artifact's meta.** Stored report, then stored brief, then markdown (`packages/host/src/handlers/finance-export.ts:75-86`). A brief over the 256 KB cap, or one saved before the meta landed, exports as prose. A sparse workbook from an old id is not a renderer bug.
- **Export formats are one route, not three.** `format` selects the renderer; `pdf` is registered and answers 501 on purpose. Assert the content type, not the route.
- **`finance-prompt` is an `<input>` now, not a textarea** (`apps/web/components/finance-steps/finance-prompt-bar.tsx:40-47`), inside the closed `finance-advanced` disclosure. `finance-generate` is a real form submit (`apps/web/components/finance-studio-view.tsx:394`) — a click before hydration reloads the page and silently loses the prompt. Confirmed rows enable it even when the instruction is empty; the host still receives `defaultFinancePrompt`.
- **Three things pick the model, and the dropdown is only the first.** `resolveModel` (`packages/host/src/finance-tasks/live.ts:59-66`) takes the request's `model`, else `settings.documentGenModel`, else `modeCatalogPayload().defaults.finance` — `pickPreferredJobModel("finance", …)` over `JOB_MODE_PREFERENCES.finance = ["hy3","hy-3","hunyuan-3","deepseek-v4-flash"]` (`packages/core/src/models/mode-defaults.ts:68`). None of the `hy3` ids are on this gateway, so the fourth entry wins.
- **`EFFECTIVE_JOB_MODEL` is documentation, not a code path** (`packages/core/src/models/mode-defaults.ts:47`). The preference list is what delivers `deepseek-v4-flash`.
- **`modelPinned` matters.** Only a deliberate pick travels (`apps/web/components/finance-studio.tsx:251`; `readModelPinned`, re-exported at `packages/host/src/finance-tasks/live.ts:45` from the one reader every job shares, `packages/host/src/job-regen.ts:43`, which since 2026-09-23 reads a pin that names no model as no pin); a seeded default stays rescuable by the job fallback, which is why a run can answer on a different model with a `finance-result-model-fallback` notice.
- **There is still no stub Finance brief.** `apps/web/locales/{en,id}/finance.json` carries a `finance.stub.*` block describing one; nothing references it. See `docs/internal/unreleased.md`.

## Verify

`.cursor/skills/verify-agentforge/features/finance.md`, and [`finance-tasks.md`](finance-tasks.md) for the per-task recipes.

`/finance` with no query loads the chooser: `finance-guide-lead`, `finance-guide-choices`, `finance-guide-<id>`. A task URL loads `finance-studio`, `finance-guide-steps`, `finance-task-current`, `finance-task-hint`, `finance-task-term`, `finance-guide-change`, `finance-studio-prompt-bar`, `expected-inputs`, `finance-primary` (`finance-parse`, or `finance-ratios-parse` on ratios), `finance-studio-empty`, and `finance-advanced`. `finance-phase-strip` + `finance-phase-<id>`, `finance-enhance`, `finance-studio-model` and `finance-prompt` are in the DOM inside the closed `finance-advanced` → `finance-how` path; open those disclosures before a visibility assertion. On the brief, also `finance-inputs`, `finance-upload` / `-input` / `-drop`, `finance-figures-input`, `finance-items` / `-row` / `-label` / `-amount` / `-add`, four `finance-param-<key>` inside closed `finance-parameters`, and `finance-dataset` only with a saved dataset. `finance-generate` appears once rows are confirmed. After a result: `finance-export`, `finance-export-toggle`, `finance-result-pii`, `finance-result-model-fallback`, `finance-actions` / `-download` / `-send-kb` / `-make-document` / `-make-presentation` / `-actions-note`, `finance-charts` (or `finance-charts-empty`) with `finance-chart-<id>`, `finance-preview`, `finance-guard`, `finance-section`, `finance-section-regen`, `finance-metrics`, `finance-table`, `finance-assumptions`.

Keyless proof stops at the shell plus the refusals — `/finance/parse` 503, `/finance/stream` 200-with-`job.error`, `finance.errors.addItems` with no request at all. `finance-upload` **is** reachable keyless: `/finance/import` reads the file host-side and needs no model.

Tests: `packages/core/src/finance/magnitude.test.ts`, `count-rows.test.ts`, `derived-rows.test.ts`, `number-guard.test.ts`, `metrics.test.ts`, `engine.test.ts`, `figures-text.test.ts`, `period-figures.test.ts`, `register-metrics.test.ts`, `stated-facts.test.ts`, `report-brief.test.ts`, `report-formulas.test.ts`, `format-number.test.ts`, `import-table.test.ts`, `import-table/register.test.ts`, `pii-scan.test.ts`, `tasks.test.ts`; `packages/host/src/finance-brief-build.test.ts`, `finance-artifact.test.ts`, `handlers/finance.test.ts`, `handlers/finance-export.test.ts`, `handlers/finance-gate.test.ts`, `file-extract/no-hosted-ocr.test.ts`, `file-extract/privacy.test.ts`; `apps/web/lib/finance-brief.test.ts`, `finance-import-client.test.ts`, `finance-import-warnings.test.ts`, `finance-export.test.ts`, `finance-drafts.test.ts`, `finance-locale.test.ts`, `finance-mount-wiring.test.ts`, `finance-steps-registry.test.ts`. The 2026-09-23 guard changes are pinned by `number-guard.test.ts` ("frees only a bare year or a bare small count, never a written amount"), `finance-brief-build.test.ts` ("guards the title, every heading and every assumption, and never leaves the marker in them") and `packages/host/src/finance-generate.test.ts` (the emptied-section note, the dropped assumption counted as removed, and the three regenerate-repair cases).

## Why

**Why the parse stopped trusting the model with figures.** `[Direct]` `docs/internal/0.14.26-changelog.md:189`: with the `reasoning_effort: "low"` job knob, `deepseek-v4-flash` returned `revenue: 18.4` instead of 18 400 000 000 in 6 of 8 parses; margins hid it because ratios are scale-invariant, but stored items, DOCX and NPV/runway were 1e9 short. `expandMagnitudes` / `looksScaled` were the first answer. `[Supported]` the second answer is the current one, recorded at the call site: "an imported sheet arrives as a table with an exact shape, and code reads a table perfectly… the model is asked one question it is genuinely better at: what category does this *label* belong to" (`packages/host/src/finance-parse-figures.ts:2-8`). **Confidence: high** for the mechanism; the code comment is the only statement of the second decision's intent.

**Why the narrative model is never allowed to produce a number.** `[Supported]` Four mechanisms converge: `financePromptBlock` renders inputs and metrics only as tables (`packages/host/src/finance-brief-build.ts:201`); `computeFinance` publishes an explicit `allowed` list (`packages/core/src/finance/metrics.ts:349-354`); `guardNumbers` replaces anything outside it; and `repairUnverifiedSections` removes the sentence rather than shipping the marker. `[Inferred]` an LLM arithmetic error in a financial brief is both plausible-looking and consequential, so the design makes it structurally impossible rather than merely unlikely. **Confidence: high for the mechanism, medium for the rationale.**

**Why redaction has no bypass and why amounts are restored.** `[Direct]` `packages/host/src/finance-privacy.ts:10-17` sets the rules, and `:88-90` records the incident: 2024 cost of sales written `(23.960.000.000)` under a column headed `2024` reached the model as `[phone])` and every ratio built on it was wrong. `[Direct]` `packages/core/src/finance/pii-columns.ts:42-50` records the same event at the classification end. **Confidence: high** — the fix, the reason and the safety net are all written down where they act.

**Why Finance has no stub path when Chat does.** `[Direct]` `packages/host/src/handlers/finance.test.ts` names it as a requirement, and `requireLive` is called from every gateway-bound entry point. `[Inferred]` a stub Chat reply is obviously fake prose, while a stub *financial brief* would look like a real one. **Confidence: high for the mechanism, medium for the rationale** — the `finance.stub.*` locale block is the fossil of an earlier answer.

**Why the watchdog gives Finance 240 s / 180 s**, and why thinking-off was rejected in favour of `reasoning_effort: "low"`: recorded in [`chat-send.md`](chat-send.md#why) and `docs/internal/0.14.26-changelog.md:133`.
