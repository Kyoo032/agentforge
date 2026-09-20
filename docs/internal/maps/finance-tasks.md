# Map — Finance tasks: the catalog and the generic runner

Last verified: 2026-09-20 at 69afca9

## Overview

Finance used to be one job — figures in, one brief out. It is now five named tasks behind one set of routes: `brief`, `cashflow`, `budget`, `appraisal`, `ratios`. Each owns its own confirmed input, its own phases, its own arithmetic and its own report; none owns a pipeline.

This page is the catalog and the seam: the task id, the phase graph, the `FinanceTaskModule` contract, the per-task parse hooks, and the single runner every task but the brief runs on. The shared spine — routes, gates, import, privacy, number guard, exports — is [`finance-parse-and-generate.md`](finance-parse-and-generate.md).

Adding a task is an entry in the meta, one in the rules, one module file and one step folder. It is never a second pipeline.

## How it works

### 1. The catalog

Three frozen maps, one per layer, all keyed by the same five ids:

| Layer | File | Holds |
|---|---|---|
| ids | `packages/core/src/finance/task-ids.ts:12` | `FINANCE_TASKS`, `DEFAULT_FINANCE_TASK = "brief"` (`:16`), `isFinanceTask` (`:20`) |
| meta | `packages/core/src/finance/tasks.ts:47` | label, hint, `defaultPrompt`, `sampleFigures`, `phases`, `sections`, `available` (type at `:27-45`) |
| modules | `packages/core/src/finance/tasks/registry.ts:17` | one `FinanceTaskModule` per id, or `null` while a flow is unbuilt |
| parse hooks | `packages/host/src/finance-tasks/parsers.ts:16` | one `parse-<task>.ts` per id, falling back to the brief's (`:27-30`) |
| steps | `apps/web/components/finance-steps/registry.tsx:18` | one `{ Inputs, Result? }` per id (`financeStepsFor`, `:29-31`) |

Every one of the five is `available: true` today (`tasks.ts:72`, `:98`, `:125`, `:151`, `:177`) and every one has a module, a parse hook and a step folder. `financeTaskMeta` falls back to the brief behind an unknown id (`:184-186`), as does `financeStepsFor`.

### 2. The phase graph

`FINANCE_PHASES` (`packages/core/src/finance/phase-ids.ts:13-49`) is a flat list of 29 ids grouped by task, and `FINANCE_PHASE_KINDS` (`:55-86`) labels each `shared`, `input` or `math` — the graph legend: a step several tasks share, a step only that task asks the user for, a step computed in code (`:1-11`).

Each task declares exactly the steps its own graph draws, in order (`tasks.ts:63-70`, `:89-96`, `:115-123`, `:142-149`, `:168-175`):

| Task | Phases |
|---|---|
| `brief` | paste-figures · parse-items · confirm-rows · core-metrics · narrate-sections · number-guard-export |
| `cashflow` | monthly-flows · parse-periods · confirm-periods · runway-math · scenario · narrate-guard-export |
| `budget` | budget-and-actuals · parse-both-sets · match-pairs · variance-math · flag-over-limit · explain-flagged · guard-export |
| `appraisal` | outlay-and-flows · discount-rate · confirm-flows · appraisal-math · sensitivity-grid · memo-guard-export |
| `ratios` | balance-and-pl · parse-items · classify-buckets · ratio-math · bands-vs-thresholds · scorecard-guard-export |

The strip renders them as `finance-phase-<id>` (`apps/web/components/finance-steps/finance-phase-strip.tsx:34`), labelled from `finance.phases.*` in the locale catalog.

A run does **not** announce the whole graph. `runnerMathPhases` (`packages/host/src/finance-tasks/runner.ts:49-63`) emits only the `math` steps after the task's last shared step — everything before that already happened on the parse route — with a documented fallback so a run is never silent. `runnerPhases` (`:69-78`) then names the two the runner ends on: its last math step and its last step.

### 3. What one task module is

`FinanceTaskModule<Input, Computed>` (`packages/core/src/finance/tasks/types.ts:40-57`) is five things and nothing else:

- `inputSchema` — the **confirmed** input, validated at the host boundary (`:46`);
- `compute(input)` — plain arithmetic, no I/O, no model, no formatting (`:48`);
- `buildReport(computed, prose, options)` — the format-neutral `FinanceReport` (`:50`);
- `promptFacts(computed, locale)` — **the only numbers the model is shown** (`:52`);
- `allowedNumbers(input, computed)` — the only figures the guard will accept back (`:54`);
- plus `sections`, the section ids the narration is asked for, in order (`:56`).

The invariant is stated at `:9-12`: `compute` is the only place a number is produced, `promptFacts` the only thing the model sees, `allowedNumbers` the only thing the guard accepts. A task that narrates a figure it never declared has that figure stripped, by construction. `cashflow.ts` is the shape to copy — 47 lines of wiring over `../cashflow/**` (`packages/core/src/finance/tasks/cashflow.ts:27-47`).

The authoring contract is `packages/core/src/finance/tasks/README.md`: seven files per task, an explicit do-not-touch list (the registries, the runner, `parsers.ts`, the step registry), and the hard privacy requirement that a parse hook redacts its own rows with `guardFinanceInput({ lineItems })` before answering.

### 4. Parse: one route, five hooks, and mostly no model at all

`handlePostFinanceParse` dispatches through `financeTaskParser(task)` (`packages/host/src/handlers/finance.ts:55`). Each hook turns free text — or an imported sheet's figures text — into the confirmed input its schema accepts, and every one of them redacts what it answers with:

- **brief** — `parse-brief.ts`, the line-item read unchanged (`:2-5`). Table first, model only for categories; prose falls through to `PARSE_SYSTEM`. Calls `requireLive`.
- **cashflow** — `parse-cashflow.ts`, fully deterministic (`:4-7`): which columns are months, which rows are totals, what the opening balance was are all already in the importer's text, so `cellValue` transcribes every amount. It answers one cash-in and one cash-out per period, the financing, the opening balance and each category's cost behaviour, for the owner to confirm (`:9-12`).
- **budget** — `parse-budget.ts`, deterministic rows and a **proposed** pairing (`:4-8`). Local stages first — exact label, then an acronym/synonym dictionary, then character trigrams — and only when both sides still hold an unmatched line is a cosine asked for over the two **labels** (`budget-embed.ts`). The stage travels back as `matching.embedding` so the screen can say when the pairing was local-only.
- **appraisal** — `parse-appraisal.ts`: an appraisal sheet is a label column and year columns, so `appraisalGridFromText` reads it outright and the model is never asked to transcribe an amount (`:4-7`). Only text that is not such a table falls through to the brief's read (`:93-94`).
- **ratios** — `parse-ratios.ts`: rows, periods, signs and buckets are read in code; only a *label the dictionary has never met* is handed to the model, alone, with no amount beside it, and comes back at half the confidence of a rule, tagged `model`, so the owner sees exactly which rows were guessed at (`:4-9`). With nothing left over — the normal case for a real balance sheet — **the endpoint makes no gateway call at all** (`:11-12`); `requireLive` sits inside the assist branch (`:156`).

That is the practical consequence worth remembering: **`/finance/parse` is not uniformly keyless-refusing.** The brief's parse is 503 without a key; cashflow, budget and the appraisal's grid path never call `requireLive`, and ratios only does when it has an unknown label to place.

### 5. The generic runner

`generateFinanceBrief` hands anything that is not the brief to `runFinanceTask` (`packages/host/src/finance-generate.ts:152-158`). One pipeline, every task (`packages/host/src/finance-tasks/runner.ts:204-301`):

1. `readPrompt`, `requireLive`, `resolveModel` (`:209-211`).
2. Source text redacted with `guardFinanceInput` on the same terms as the task's own rows (`:214-216`).
3. Locale from the request, `runnerLocale` (`:86-88`) — the same reader the brief uses, so the two can never disagree.
4. One `job.phase` per math step the graph draws (`:224-226`).
5. `readInput` → `module.inputSchema.safeParse`, a 400 that says "parse the figures first and confirm them" (`:90-100`).
6. `module.compute(input)` and `module.allowedNumbers(...)`, then a `job.step` with the figure count (`:228-230`).
7. `narrate` (`:102-141`): `FINANCE_TASK_SYSTEM` (`packages/host/src/finance-tasks/narrate.ts:18-31`) plus the task's own bullet rules and the output-language rule, with a prompt of `promptFacts` + `sectionRequest` + source text + the question. Empty answer is 502 `generation_failed` (`runner.ts:137-139`).
8. `parseNarration` (`narrate.ts:64`) keeps only the section ids the task asked for, in order; zero survivors is 502 `invalid_finance` (`:84-86`).
9. `verifyNarration` (`runner.ts:161-194`): `guardNumbers` over every body against `allowedNumbers`, then **one** rewrite of each marked section through `repairTaskProse` (`packages/host/src/finance-tasks/repair.ts:78`), which is an adapter onto the brief's `repairUnverifiedSections` — the logic lives in one place (`repair.ts:1-11`).
10. `module.buildReport(...)`, then `scrubReportMarkers` (`repair.ts:129`) sweeps the report's own notes and chart captions, because a builder may write prose too; `withRemovedFlag` (`:144`) tells the reader once.
11. Markdown via `renderMd`, then `persistFinanceTaskReport` (`packages/host/src/finance-tasks/persist.ts:73`) with `financeTaskArtifactMeta` (`:53`) — the whole `FinanceReport` under `meta.report` (`:19`) behind the same 256 KB cap — and a Knowledge Base work card when an id came back (`runner.ts:276-288`).

The result is `FinanceTaskRunResult` (`packages/host/src/finance-tasks/types.ts:22-38`): `task`, `report`, `artifactId`, `markdown`, `guard`, `pii`, and optionally `model`, `notice` and `warnings`. The brief answers with a `FinanceBrief` instead; the studio branches on which arrived (`apps/web/components/finance-steps/finance-result-panel.tsx:43-46`).

### 6. Task rules in the prompt

`financeTaskSystemRules(task, language)` (`packages/core/src/finance/task-rules.ts:94-97`) returns that task's extra bullets, in both languages, appended under the shared "Rules:" heading by `withFinanceTaskRules` (`packages/host/src/finance-task.ts:46-49`). **`brief` is deliberately empty** (`task-rules.ts:22`), so the brief's system prompt stays byte-identical to the one that shipped.

No rule ever asks the model to compute. They constrain what it may say: cash-flow keeps cash apart from profit (`:36`), budget explains only the flagged lines and never averages percentages across periods (`:51-56`), appraisal names the discount rate behind every conclusion and **may not write a buy/sell/fund directive** (`:69`, `:72`), ratios compares only against the thresholds given (`:87`).

### 7. The five step folders

The studio hands every task the same opaque draft bag and one `setDraft` patch channel (`apps/web/components/finance-steps/types.ts:36-44`), so five flows are built without two workers touching one file. Each folder exports `{ Inputs, Result? }`.

| Task | Inputs testids (at load) | Result root |
|---|---|---|
| brief | `finance-inputs` (`finance-inputs-panel.tsx:66`), `finance-figures-input` (`:80`), `finance-parse` (`:87`), `finance-items*`, four `finance-param-*` (`:149`), `finance-dataset` (`:112`); `finance-stated-facts` / `-fact` / `-fact-label` / `-fact-value` / `-fact-remove` / `-fact-sentence` after a parse returns prose facts (`brief/stated-facts-list.tsx:47`, `:55`, `:66`, `:68`, `:77`, `:82`) | the shared `FinanceResultPanel` |
| cashflow | `finance-inputs` (`cashflow/index.tsx:142`), `finance-figures-input` (`:156`), `finance-parse` (`:163`), `cashflow-opening-cash` (`:192`), `cashflow-no-periods` / `cashflow-periods` (`periods-table.tsx:71`, `:77`), `cashflow-what-if` (`what-if-panel.tsx:52`) with `cashflow-lever-<key>` (`:74`) | `cashflow-result` (`result.tsx:67`) |
| budget | `finance-inputs` (`budget/index.tsx:156`), `finance-figures-input` (`:170`), `finance-parse` (`:177`), `budget-flag-mode` (`:218`), `budget-error` (`:186`), `budget-pairing` (`pairing-table.tsx:173`) | `budget-result` / `budget-no-report` (`result.tsx:148`, `:142`) |
| appraisal | `finance-inputs` (`appraisal/index.tsx:238`), `finance-figures-input` (`:252`), `finance-parse` (`:259`), `appraisal-flows` (`:66`), `appraisal-add-year` (`:120`), `appraisal-preview` (`:181`) | `appraisal-result` / `appraisal-no-report` (`result.tsx:84`, `:78`) |
| ratios | **`finance-ratios-inputs`** (`ratios/ratios-inputs.tsx:99`), **`finance-ratios-figures`** (`:113`), **`finance-ratios-parse`** (`:120`), `finance-ratios-bands` (`bands-editor.tsx:32`), `finance-ratios-buckets` (`bucket-table.tsx:93`) | `finance-ratios-result` / `finance-ratios-no-report` (`ratios-result.tsx:89`, `:83`) |

All five render `ArtifactActions` with `testIdPrefix="finance"`, so the `finance-actions` / `finance-download` / `finance-send-kb` bar is the same everywhere. All but budget render `FinanceReportCharts`; budget draws `budget-variance-bars` (`budget/variance-bars.tsx:35`) instead.

Chart ids, which become `finance-chart-<id>` (`apps/web/components/finance-charts/chart-frame.tsx:47`): brief `margin-growth` (`packages/core/src/finance/report-brief.ts:209`), cashflow `cash-balance` / `net-cash` (`cashflow/report-charts.ts:64`, `:88`), budget `variance-bars` / `variance-by-period` (`budget/report.ts:98`, `:114`), appraisal `cumulative-cash-flow` / `sensitivity` (`appraisal/report.ts:132`, `:148`), ratios `gauge-<key>` (`ratios/report.ts:86`).

### 8. The eval harness (dev-only, never ships)

`packages/host/eval/finance/` drives the running app's own HTTP API — import, parse, stream, export — over 11 synthetic cases and scores the result against an independently computed oracle. Thresholds are named constants so they cannot be tuned quietly: `PASS_EXTRACTION_F1 = 0.9`, `PASS_FIGURE_ACCURACY = 0.9`, `PASS_MAX_WRONG_RATE = 0.02`, `PASS_MAX_HALLUCINATED = 0` (`runner/scoring.mjs:25-28`), plus `PASS_BUDGET_PAIR_F1` / `PASS_BUDGET_FLAGGED_F1` (`:35-36`). It is run by hand — `node packages/host/eval/finance/runner/run.mjs` — and no `package.json` script references it.

It is fenced to the machine it runs on: `LOOPBACK = new Set(["127.0.0.1","localhost","::1"])` (`runner/client.mjs:36`) with `requireLoopbackBase` (`:41-56`) enforced up front and again on every request, because a case file is the owner's financial data. Run traces land in `results/`, which is gitignored for the same reason (`packages/host/eval/finance/.gitignore:1-4`).

**It cannot reach a product build.** `@agentforge/host` is `"private": true` and its export map exposes only `./src/index.ts` and `./src/http-adapter.ts` (`packages/host/package.json:4-9`), so nothing outside can import `eval/`. The tree is `.mjs` outside `src`, and the desktop bundle is esbuilt from a single entry that re-exports `@agentforge/host` alone; electron-builder's `files` list is file-by-file under `apps/desktop/` (`apps/desktop/package.json:48-61`). Nothing in `packages/host/src` imports it. The tree is committed now (95 files under `packages/host/eval/`), so it is in git history — but only `results/` is gitignored (`packages/host/eval/finance/.gitignore:4`), and nothing outside `eval/` reaches in.

## Where things live

| File | Role |
|---|---|
| `packages/core/src/finance/task-ids.ts` | The five ids, the default, `isFinanceTask` |
| `packages/core/src/finance/phase-ids.ts` | The 29 phase ids and their kinds |
| `packages/core/src/finance/tasks.ts` | `FINANCE_TASK_META` — labels, hints, samples, phases, sections, `available` |
| `packages/core/src/finance/task-rules.ts` | The per-task bullets under the shared system prompt |
| `packages/core/src/finance/tasks/registry.ts`, `types.ts` | The module map and the `FinanceTaskModule` contract |
| `packages/core/src/finance/tasks/README.md` | The task-authoring contract: seven files, the do-not-touch list, the privacy rule |
| `packages/core/src/finance/tasks/{brief,cashflow,budget,appraisal,ratios}.ts` | One task module each, wiring only |
| `packages/core/src/finance/{cashflow,budget,appraisal,ratios}/` | The arithmetic, one module per question, plus `facts.ts` and `report*.ts` |
| `packages/host/src/finance-tasks/runner.ts` | The one pipeline: validate → compute → narrate → guard → report → save |
| `packages/host/src/finance-tasks/parsers.ts`, `parse-<task>.ts` | Which parse hook the route runs, and the five hooks |
| `packages/host/src/finance-tasks/narrate.ts`, `repair.ts` | The narration prompt and the guard/repair adapter |
| `packages/host/src/finance-tasks/persist.ts`, `report-schema.ts` | The stored report and its boundary schema |
| `packages/host/src/finance-tasks/budget-embed.ts` | The one labels-only gateway call, and the rules around it |
| `packages/host/src/finance-task.ts` | `requireFinanceTask`, `withFinanceTaskRules` |
| `apps/web/components/finance-steps/registry.tsx`, `types.ts` | Task id → step components, and the props contract |
| `apps/web/components/finance-steps/{brief,cashflow,budget,appraisal,ratios}/` | One folder per task |
| `apps/web/components/rail-finance-tasks.tsx`, `apps/web/lib/finance-task.ts` | The rail rows and the URL plumbing |
| `packages/host/eval/finance/` | Dev-only accuracy harness. Never ships |

## Gotchas

- **The model that answers may not be the one the picker shows.** Every Finance model call goes through `collectJobAssistantRun` in `packages/host/src/job-regen.ts`, which wraps `runWithJobModelFallback` (`packages/host/src/job-model-fallback.ts`): one retry on the next live model of the mode's ranked list, transport-class failures only, never on a pinned model, five-minute breaker. The result carries `notice: { code: "model_fallback", from, to }` and the studio renders `finance-result-model-fallback`. Details and the verify steps are in `.cursor/skills/verify-agentforge/features/models.md` (`models-job-fallback`).
- **A task id is never an error.** An absent or unknown `?task=` resolves to `brief` on both sides (`apps/web/lib/finance-task.ts:50-52`, `packages/host/src/finance-task.ts:23-29`). `?task=nope` opens the brief silently.
- **`finance-inputs` is not on every task.** Ratios uses `finance-ratios-inputs` / `finance-ratios-figures` / `finance-ratios-parse`. A recipe that asserts the shared ids across all five fails there and only there.
- **Parse is keyless for most tasks.** Cashflow, budget and the appraisal's grid path never call `requireLive`; ratios only does when a label needs placing (`packages/host/src/finance-tasks/parse-ratios.ts:156`). Only the brief's parse refuses a keyless desk outright. Generate still needs a key on every task.
- **There is no coming-soon panel.** It was removed on 2026-09-17; every task is `available: true`, so the studio's one-line `finance-task-unavailable` fallback never renders and `finance_task_unavailable` is never thrown. `finance-task-coming-soon`, `finance-task-sample` and `finance-coming-soon-back` no longer exist. Do not write a recipe around any of them without first re-reading `tasks.ts`.
- **The brief's prompt must stay byte-identical.** `task-rules.ts:22` gives `brief` no bullets on purpose, and `withFinanceTaskRules` returns the base string untouched when the list is empty (`packages/host/src/finance-task.ts:48`). Adding a "harmless" brief rule changes a shipping prompt.
- **The runner announces fewer phases than the strip draws.** Everything up to the task's last shared step happened on the parse route; re-emitting it would tell the reader work is being redone (`packages/host/src/finance-tasks/runner.ts:38-48`). A `finance-phase-*` chip with no matching `job.phase` is correct.
- **A section id is the task's, not the model's.** `parseNarration` drops a section the task did not ask for rather than renaming it (`narrate.ts:63`, `:83`), and the repair carries the id through even when the rewrite renames the heading (`repair.ts:74-76`).
- **`[unverified figure]` must never reach a reader.** It is guarded, rewritten once, then the sentence is removed, and the finished report is swept again for notes and chart captions the builder wrote itself (`repair.ts:129`). Seeing the marker in an export is a bug, not the guard working.
- **The budget pairing is the only stage that leaves the desk, and it sends labels.** No amount, period, scenario or filename (`budget-embed.ts:3-9`). A stub-runtime embedding is discarded rather than scored, and the screen says `budget-embedding-note`.
- **A task exports through `report`, not `brief`.** There is no `FinanceBrief` behind a cash-flow or ratio run, so the studio posts the report itself and the host shapes and size-caps it (`packages/host/src/finance-tasks/report-schema.ts:73-81`).
- **The eval harness is not a test.** It is excluded from `packages/host`'s vitest include, needs a running app and a live model, and writes gitignored traces. Never wire it into CI as if it were unit coverage, and never point `--base` at anything but loopback.

## Verify

`.cursor/skills/verify-agentforge/features/finance.md` — the rail walk, the per-task load checks, and the ratios exception.

Rail: `finance-tasks-toggle`, `rail-finance-tasks`, `rail-finance-tasks-branch`, `finance-task-brief` / `-cashflow` / `-budget` / `-appraisal` / `-ratios`. Per task: `finance-task-current`, `finance-phase-strip` with that task's own `finance-phase-<id>` count (6 / 6 / 7 / 6 / 6), and the inputs root from the table in §7.

Tests: `packages/core/src/finance/tasks.test.ts`, `tasks/registry.test.ts`, `tasks/{ratios,budget,cashflow,appraisal}.test.ts`, and the per-compute suites under `packages/core/src/finance/{cashflow,budget,appraisal,ratios}/`; `packages/host/src/finance-tasks/runner.test.ts`, `repair.test.ts`, `budget-embed.test.ts`, `budget-export.test.ts`, `live.test.ts`, `parse-{ratios,budget,cashflow,appraisal}.test.ts`; `apps/web/lib/finance-steps-registry.test.ts`, `finance-cashflow.test.ts`, `finance-budget.test.ts`, `finance-appraisal.test.ts`, `finance-ratios-draft.test.ts`, `finance-phase-label.test.ts`, `finance-locale.test.ts`.

## Why

**Why a registry of modules rather than a switch.** `[Direct]` `packages/core/src/finance/tasks/registry.ts:3-8`: "One import per task file and nothing else: a worker building a task replaces exactly one file and flips one `available` flag, and never edits a switch this file would otherwise grow." `[Direct]` the same reasoning is repeated at the three other seams — `parsers.ts:3-6`, `apps/web/components/finance-steps/registry.tsx:5-8`, and the do-not-touch list in `tasks/README.md`. `[Inferred]` the shape is chosen for four workers building four tasks in parallel, which is what the README says it is for. **Confidence: high** — the intent is written at every seam it applies to.

**Why the brief keeps its own code path.** `[Direct]` `packages/host/src/finance-tasks/runner.ts:9-10`: "The brief keeps the path it has always run (`finance-generate.ts`) — this runner is what the four task flows land on", and `packages/core/src/finance/task-rules.ts:6-10` gives the same reason for the empty rule set: the brief ships today and the catalog must not move it. **Confidence: high.**

**Why the guard runs last for every task, without the task's help.** `[Direct]` `packages/core/src/finance/tasks/types.ts:9-12` names the invariant, and `runFinanceTask` is the only caller of `guardNarration` and `repairTaskProse`, so a task module has no way to skip it (`runner.ts:244-251`). `[Supported]` `tasks/README.md` tells authors that a figure shown by `promptFacts` but absent from `allowedNumbers` is stripped and that this is the author's bug, not the guard's. **Confidence: high.**

**Why the eval harness is loopback-only and gitignored.** `[Direct]` `packages/host/eval/finance/runner/client.mjs:11-12` and `packages/host/eval/finance/.gitignore:1-3` both give the same reason: a case and its trace are the owner's financial data and never leave the machine. **Confidence: high.**
