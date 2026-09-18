# Finance accuracy harness

Measures the one thing the owner asked for: **retrieve and generate a finance report
that is at least 90 % accurate to the real documents and raw data** — measured in the
app that is actually running, not in a unit test of a helper.

Every case drives the real HTTP API exactly as the Finance studio does — and, for a
task other than the brief, exactly as **that task's own step component** does:

```
upload the case file  →  POST /api/v1/finance/import      (figures text + sheet previews)
                      →  POST /api/v1/finance/parse       (the task's OWN proposal: line items,
                                                           period rows, netted flows, classified
                                                           buckets or a proposed pairing — taken
                                                           as-is, which is the confirm step)
                      →  POST /api/v1/finance/stream      (brief, or `{ task, report, markdown,
                                                           guard, pii }`, over SSE)
                      →  POST /api/v1/finance/export      (xlsx, pptx — mime and bytes checked,
                                                           the workbook re-opened, its Summary
                                                           numbers and Calc formula caches read
                                                           back, the deck's chart parts counted)
```

One adapter per task, in `runner/adapters/<task>.mjs`, owns the three task-specific
answers and nothing else: which rows the parse proposed, what body generate is posted,
and what body the export menu posts. A task with no adapter falls back to the brief's.

Only `127.0.0.1` / `localhost` is ever contacted. `--base` is validated to be loopback
before the first request and the run refuses anything else, because case data is the
owner's financial data and it does not leave the machine. No key, header or credential
is written to a result file.

## Run it

The app must already be running (the owner's webdev on `:3000`). The harness never
starts a server.

```bash
node packages/host/eval/finance/runner/run.mjs
node packages/host/eval/finance/runner/run.mjs --case brief-umkm-2y
node packages/host/eval/finance/runner/run.mjs --task cashflow
node packages/host/eval/finance/runner/run.mjs --base http://127.0.0.1:3000 --model gpt-5.6-sol
node packages/host/eval/finance/runner/run.mjs --out /tmp/finance-eval
node packages/host/eval/finance/runner/run.mjs --retry-transient
```

`--task <brief|cashflow|budget|appraisal|ratios>` runs only that task's cases.
`--retry-transient` re-runs a case ONCE when it stopped on a gateway failure — off by
default, because a silent retry turns a flaky gateway into a number nobody can
reproduce. Every retry is listed in `summary.md` under **Retried**, with the first
attempt's error, and the row in the table is the second attempt.

Output lands in `packages/host/eval/finance/results/<timestamp>/`:

- `<case-id>.json` — the whole trace: the figures text the import returned, the task's
  own parse response, the rows the adapter scored, the finished `FinanceReport`, every
  score, every miss, every wrong figure, every hallucinated number, the export checks
  and the timings.
- `summary.md` — one row per case, a per-task roll-up and the verdict line.
- `results/latest.md` — a copy of the newest `summary.md`, at one stable path.

`results/` is gitignored. Exit code is `0` when every scored case passes, `1` when a
scored case fails or stops on a transient error, `2` when the harness itself could not
run.

Unit tests for the pure parts (the scorer and the number reader):

```bash
cd packages/host && npx vitest run --root eval/finance/runner
```

## The pass rule

A case passes only when **all** of these hold:

| gate | threshold |
| --- | --- |
| extraction F1 | ≥ 0.90 |
| figure accuracy | ≥ 0.90 |
| wrong-figure rate | ≤ 0.02 |
| hallucinated numbers in the narrative | 0 |
| figures the case calls undefined that were given a number | 0 |
| planted personal values in anything the app handed back | 0 |
| `mustNotContain` phrases | none present |
| budget pair F1 *(budget cases)* | ≥ 0.90 |
| flagged-set F1 *(budget cases)* | ≥ 0.90 |

The thresholds are named constants in `runner/scoring.mjs` so they can never be tuned
quietly. Some of them deserve a word:

- **Extraction F1** is over `(label, period, amount)` triples, taken from whichever shape
  the task's parse proposed — a brief's line items, a cash flow's per-period categories,
  a ratio run's classified buckets, both sides of a budget comparison, an appraisal's
  component rows. A label is forgiven its typography — case, accents, punctuation,
  spacing — and nothing else. A translated or renamed label is *wrong*, because a model
  that renames the owner's rows and still scores 100 % is measuring nothing. An extra row
  is named: `double_counted_subtotal`, `zero_filled_grid_cell` (a 0 the parse invented so
  every label has a cell in every period) or `not_in_truth`. All three cost precision.
  When a task's parse shape genuinely cannot express `truth.lineItems` — the appraisal's
  netted flows carry no label — the case is reported as **not measurable**, with the
  reason and the shape counts, and it fails. It is never scored `0.000`, which would read
  as "the app got every row wrong".
- **Figure accuracy** is `found / total` over the case's truth figures, asked of the
  finished `FinanceReport` for every task — summary KPIs, table cells, chart series and
  the report's own notes. A figure is matched by **value and unit** within tolerance; its
  NAME is used only to tell two cells with the same value apart, and the trace says when
  it had to (`candidates`, `disambiguatedByName`). Each figure ends as
  `FOUND_STRUCTURED`, `FOUND_PROSE` (only in the narrative), `WRONG` or `MISSING`.
  `WRONG` is deliberately rare and strict: the report must state the **same metric** —
  every significant word of the truth's own name, at the same period — with a different
  value. A number nobody mentioned is `MISSING`, which is a different problem with a
  different fix. `WRONG` is reported separately as `wrongRate` and counts double in
  `penalisedAccuracy`.
- **Units are read from a declaration, never sniffed.** A KPI's `unit` field and a table
  column's header (a trailing `%`, a parenthesised `(x)` / `(bulan)` / `(IDR)`, or a header
  that IS the unit word) are the only things that give a cell a unit; a cell that declares
  none answers `unknown` and contradicts nothing. Reading the words around a cell instead
  turned a table titled *"Arus kas per tahun"* — cash flow **per year** — into a table of
  durations, and every currency figure in it was then refused.
- **Numbers in the app's prose are read in the app's own number culture**, taken from
  `report.locale`, not from the case. The host writes a task's report in the locale its
  process runs in, so an `en` case can legitimately come back in Indonesian — where
  `-151.000` is minus a hundred and fifty-one **thousand**. Reading it as English turns
  every figure in that report into a hallucination. `figures.readAs` records which was
  used.
- **A figure is identified by the case's own `label`**, which is written in the same
  language as the report. The `key` is an English slug (`currentRatio.2024`) and is used
  only as a tie-breaker when two cells share a value — requiring its words as well would
  mean no Indonesian report could ever be recognised as talking about the figure, and
  every contradiction would be filed as a polite `MISSING`.
- **`naFigures`** are truth figures whose `value` is `null`: the case is saying the number
  does not exist (a variance percentage against a budget of zero). Silence is the right
  answer, so they are tallied in their own block and kept OUT of the headline accuracy —
  a case with ten of them must not score well by saying nothing at all. A number stated
  for one of them fails the case.
- **Hallucinated numbers** are figures in the narrative that trace to neither an input
  row, nor the case truth, nor anything the report itself displays (including the numbers
  inside its own string cells, such as a sensitivity grid's `10%` axis), nor a parameter
  the owner typed (a scenario axis arrives as an array and every entry counts). Calendar
  years and small counts are free, using the product's own `isFreeNumber`. The count of
  `[unverified figure]` markers the product's guard left behind is reported beside it.
  This check asks about **provenance, not sign**, so it compares magnitudes: prose carries
  the sign in its words — "an outlay of 820,000", "cash flow turns negative at 65,000",
  "(151.000)" as a bracketed aside the accounting convention would read as a minus — and
  calling those inventions says something false about the app. A sign that is genuinely
  wrong is caught by the figure scorer, which stays strictly signed.
- **Privacy** is scored two ways. `pii` asks whether the product's own scanner found the
  values the case planted. `piiLeak` asks the harder question: did any planted value
  survive into something that reached the model? The harness cannot read the prompt the
  host builds, so it scans everything the app handed back on the way there —
  `figuresText`, the report's prose, and every `sheets[].preview` — verbatim and with
  punctuation stripped. Values that must NOT be redacted (a bank's name) are declared as
  `truth.piiMustRemain`; when a case declares none the retention half is reported as
  **not asked**, naming the exact JSON path to add.

- **Budget pairing and flags** are two gates nothing else has, and they are the failures
  this task exists to avoid: a perfectly computed variance between the wrong two rows is
  still the wrong answer, and so is a clean table that flags the wrong lines. `budget`
  scores the pairing the task proposed — each side's figure, and whether a line the case
  says has no partner was in fact left unpaired — and `budgetFlags` scores the flagged
  set. Both appear in their own table in `summary.md` with their bars,
  `PASS_BUDGET_PAIR_F1` and `PASS_BUDGET_FLAGGED_F1`.

## Multi-sheet inputs

The import route answers **one sheet per call**, and the studio appends what comes back
each time the reader picks another (`apps/web/lib/finance-brief.ts:mergeFigures`, one
newline between them). The harness does the same:

- a `files[]` entry that names a `sheet` gets exactly that sheet;
- an entry that names none gets **every** sheet the route lists, in listed order, capped
  at `MAX_SHEETS_PER_FILE` — which is what a reader who uploaded the workbook and wanted
  all of it would do;
- the same file may appear twice with two sheet names, which is how a case says "plan,
  then actuals".

`stages.import.sheets` records what was asked for and what came back, so a case that read
half its workbook is visible rather than merely low-scoring.

## Export checks

An export is the artefact the owner keeps, so it is checked as one rather than by byte
count:

- **xlsx** is re-opened with exceljs. Every numeric KPI on the report's Summary must be a
  number on the `Summary` sheet, and every live formula on the `Calc` sheet must carry a
  cached result that matches the number the report states. A formula whose cache is
  missing or disagrees is a file that changes its mind the first time Excel recalculates.
- **pptx** is unzipped and its `ppt/charts/chartN.xml` parts are counted against the
  charts the report declares. A `heat` chart is drawn as a table of coloured cells and is
  not expected to produce a chart part.

A file with the right mime and the wrong numbers inside is not a passing export.

## Statuses

| status | meaning |
| --- | --- |
| `PASS` / `FAIL` | the case ran end to end and was scored |
| `SKIPPED_UNAVAILABLE` | the app says this finance task is not built yet — not a harness failure |
| `BLOCKED_NO_RUNTIME` | the app says there is no model behind it at all (`runtime_stub`, `gateway_required`, `gateway_blocked`) |
| `BLOCKED_UNSUPPORTED_INPUT` | the finance import refuses this file type (it reads tables, not documents) |
| `ERROR_TRANSIENT` | the gateway gave up on this attempt — a 5xx, a timeout, a 429 — and the raw message is kept verbatim |
| `ERROR` | the harness itself could not complete the case |

**Only `PASS` and `FAIL` carry scores.** Everything else prints `-` in every score
column, because a number there would be a claim about an app that never answered. There
is no truth-row stand-in and no deterministic brief behind a failed stage: scoring a
fallback against the very rows it was seeded from once produced a perfect `1.000` for a
case whose parse had fallen over, which is the most expensive kind of wrong a harness can
be. `stoppedAt` says which stage it was, and `error.message` is the app's own words,
never paraphrased.

`ERROR_TRANSIENT` is retryable and `BLOCKED_NO_RUNTIME` is not: one means "ask again",
the other means "there is nothing to ask".

## Reading the runtime line

```
Runtime: model calls go out for real · key saved (openai) · gate `stub` allowed=true — …
```

The two fields are about different things and running them together reads as nonsense.
`runtime` is *"a key exists, so model calls go out for real"*. `gateway.status` is the
gate's verdict on that key, and `stub` means the process was started with
`AGENTFORGE_RUNTIME=stub`, so the gate is open **without the key ever having been
validated** — it does not mean the answers are stubbed. The owner's webdev is exactly
that: `runtime=ai`, `gate=stub`. The header spells the meaning out rather than printing
the word alone.

## When a route is newer than the running app

The owner's dev server keeps a host process alive across edits, so a route added in this
tree can 404 on `:3000` until the process is next restarted. The harness never restarts
anything, so it falls back and says so:

- import 404 → the figures are read in-process with core's own `readFinanceTable` +
  `tableToFiguresText`, the same functions the handler calls. `stages.import.ok` is
  `false` and `via` is `core-fallback`.
- export 404 → the legacy `/api/v1/finance/docx` route is tried once, recorded with
  `via: "legacy-docx-route"`.

The parse route is the one to watch. A task parser that landed after the host process
started answers with the *brief's* shape — `{ items, needsConfirmation, pii }` and none
of the task's own rows. The trace records what actually came back in
`stages.parse.shapes`, so a run against a stale process shows an extraction score for a
parse that is not the one in the tree. Compare the file's mtime against the process start
time before calling that an app bug.

`summary.md` lists every such fallback under **Stages that did not go through the app**.
A score from a run with fallbacks is still a score — but it is a score of the code, not
of the deployed surface, and the summary is explicit about which.

## Adding a case

Create `packages/host/eval/finance/cases/<case-id>/` with the input file(s) and a
`case.json`:

```json
{
  "id": "brief-umkm-2y",
  "task": "brief",
  "locale": "id",
  "currency": "IDR",
  "description": "…",
  "files": [{ "path": "input.xlsx", "sheet": "Ringkasan" }],
  "prompt": "what the user types in the prompt bar",
  "params": { "discountRatePercent": 12 },
  "truth": {
    "lineItems": [{ "label": "Pendapatan", "period": "2024", "amount": 1250000000, "category": "revenue" }],
    "figures": [
      { "key": "gross_margin.2024", "label": "Gross margin 2024", "value": 41.6, "unit": "percent", "tolerance": 0.005 }
    ],
    "mustMention": ["runway"],
    "mustNotContain": ["[unverified figure]"]
  }
}
```

Rules that matter:

- **The truth is an independent oracle.** Compute it with plain arithmetic in the case's
  own `build.mjs` and write the formula beside each figure. Never import the finance
  engine to produce it — a truth computed by the thing under test proves nothing.
- **Synthetic data only.** Invented companies and people. Never a real filing, never real
  personal data.
- **Deterministic generators.** Fixed seed, no `Date.now`, no `Math.random`, so a rerun
  compares like with like.
- `figures[].key` may be written either way (`gross_margin.2024` or `gross_margin 2024`):
  keys are compared normalised, so it matches the engine's own metric key.
- `figures[].unit` is one of `percent`, `currency`, `ratio`, `months`, `years`, `count`,
  `number`. It stops a percentage from being accepted as a currency figure.
- `figures[].tolerance` is **absolute, in the figure's own unit** (`1` means one rupiah on
  an IDR figure, `0.5` half a dollar). The product's own number-guard tolerance — half a
  display unit, or 0.5 % of the figure, whichever is larger — is always the floor
  underneath it, so a figure the app itself calls verified is never failed here. Write
  `0` for "exact, as far as the guard is concerned".
- `figures[].source: "prose"` marks a figure that is meant to be argued in the narrative
  rather than tabled; those are tallied in their own block.
- `figures[].value: null` means **there is no such number** — not "we did not compute it".
  The report must report it as n/a and must not state a value. These are scored in the
  `naFigures` block, outside the headline accuracy.
- A budget case writes its pairs as `truth.variances[]`, where `budgetLabel`,
  `actualLabel`, `budget`, `actual`, `variance` and `variancePct` may each be `null`: a
  budget-only line has no actual, an actual-only line has no budget, and a percentage of
  a zero budget is not a number. Every null is read as "the report must not state a value
  here". `truth.flagged[]` lists the lines that cross the threshold.
- `truth.piiMustRemain[]` lists values that are NOT personal data and must survive
  redaction (a bank's name on a payroll sheet). Without it the retention check is
  reported as not asked rather than silently passed.
- A case with no input file may carry `figuresText` inline; the import stage is skipped
  and says so.

`case.json` is validated with zod at load time, so a malformed field fails loudly with
its own name before any request is made.

The runner keeps two tiny cases of its own under `runner/__fixtures__/`. They exist so
the harness can be smoke-tested without any other author's work, and they are picked up
by a normal run alongside `cases/` — but the verdict line counts **real cases only**, so
they can never flatter a run.

## Adding a task

Write `runner/adapters/<task>.mjs` exporting one object and add its row to
`runner/adapters/index.mjs`. Nothing else in the runner grows a branch.

```js
export const myTaskAdapter = {
  id: "mytask",
  resultKind: "report",                    // or "brief"
  extractionRows(parsed),                  // → { rows, via } or unscorable(why, shapes)
  generateBody(kase, parsed),              // the body its step component posts
  exportBody(kase, run, format),           // the body its export menu posts
};
```

The rule the adapters exist to keep: **whatever the parse proposed is accepted
unchanged**. The eval's contract is "the owner confirms without editing", so an adapter
that quietly repaired a row would be measuring a person who does not exist. When a shape
cannot express the truth, return `unscorable(...)` and say why.
