# Map — Finance: parse and generate

Last verified: 2026-09-15 at b9f931a

## Overview

A two-stage, two-model pipeline whose governing rule is that **a model never computes a number**. Stage one turns pasted free text into structured line items — a deterministic rewrite, one JSON-only model call, then two deterministic guards. Stage two computes every metric in TypeScript and asks a second model only to write prose *around* those numbers, then strips any figure the prose invented.

The two stages are separate HTTP calls with a human confirmation between them. The user reviews and edits the parsed rows before anything is computed.

## How it works

### Stage 1 — parse

**Entry.** `FinanceStudio` (`apps/web/components/finance-studio.tsx:46`) checks the brief with `briefLooksLikeFigures` (`apps/web/lib/finance-brief.ts:11`) to decide whether to auto-call parse, then `parseFigures()` (`apps/web/lib/finance-client.ts:79`) POSTs `/api/v1/finance/parse` → `handlePostFinanceParse` (`packages/host/src/handlers/finance.ts:38`) → `parseFinanceFigures` (`packages/host/src/finance-generate.ts:124`).

**`expandMagnitudes`** (`packages/host/src/finance-generate.ts:135`, implementation `packages/core/src/finance/magnitude.ts:102`) rewrites magnitude words into plain integers **before the model ever sees them**, capped at `FIGURES_TEXT_MAX = 12_000` chars (`packages/host/src/finance-generate.ts:43`). It handles English and Indonesian suffixes (`rb`, `juta`, `jt`, `miliar`, `triliun`, `K`, `M`, `B`, `T`), grouped-digit locale parsing and negative signs, and rounds mantissa × multiplier with `Math.round` (`packages/core/src/finance/magnitude.ts:88`). **`M` is decided by the run locale**: a million in English, `miliar` (1e9) in Indonesian (`:65-73`).

**The model call.** The expanded text goes out with `PARSE_SYSTEM` (`packages/host/src/finance-generate.ts:45-53`) through `collectJobAssistantText` (`packages/host/src/job-regen.ts:66`) with `jobMode: "finance"`. The reply is JSON-parsed after stripping fenced code (`:148`); a parse failure is `ApiError("invalid_finance", …, 502)` (`:150`).

**Two deterministic guards, in this order** (`packages/host/src/finance-generate.ts:154`):

```ts
const items = looksScaled(source, dropCountRows(parseLineItems(parsed)), locale);
```

- `parseLineItems` (`packages/core/src/finance/line-items.ts:74`) validates each row through `lineItemSchema` and **drops** bad rows rather than repairing them. Cap `LINE_ITEMS_MAX = 500` (`:5`).
- `dropCountRows` (`packages/core/src/finance/count-rows.ts:54`) removes rows that are counts, not money — "12 outlets" goes, "units sold 12000 IDR" stays because it carries a currency, and anything at or above `COUNT_ROW_MAX_AMOUNT = 1000` (`:23`) is assumed to be money whatever it is labelled.
- `looksScaled` (`packages/core/src/finance/magnitude.ts:125`) re-scales a mantissa the model dropped, checking `MAGNITUDE_EXPONENTS = [3, 6, 9, 12]` (`:41`). It must be given the **raw** user text, not the expanded copy — the suffixes are the evidence (`:124`), and `packages/host/src/finance-generate.ts:154` correctly passes `source`.

Zero surviving items is `ApiError("invalid_finance", modeMessage("noFiguresParsed", locale), 422)` (`:156`). Otherwise the response is `{ items, needsConfirmation: true }` and **nothing has been computed yet**.

### Stage 2 — compute, then narrate

The confirmed items (or a `datasetId`) POST to `/api/v1/finance` or `/finance/stream` → `generateFinanceBrief` (`packages/host/src/finance-generate.ts:200`).

**`computeFinance(items, params)`** (`packages/core/src/finance/metrics.ts:209`) is pure TypeScript. It is **not** a formal three-statement model — it is a flat metric list plus two tables, derived per category and per period:

| Group | Contents | Line |
|---|---|---|
| `periodMetrics` | revenue, gross profit and margin (needs `cogs`), net profit and margin (needs `opex`), revenue growth | `packages/core/src/finance/metrics.ts:46` |
| `cashMetrics` | cash on hand, net burn per period, runway in months (only when burn > 0) | `:102` |
| `ratioMetrics` | current ratio, debt-to-equity | `:119` |
| `paramMetrics` | breakeven units and revenue, NPV and IRR | `:136` |
| tables | `lineItemTable` (all rows), `totalsTable` (category totals by period, only with ≥ 2 periods) | `:188-206` |
| `allowed` | **every number the narrative is permitted to cite** — item amounts, non-null metric values, period totals, table subtotals, numeric params | `:223-229` |

Currency is simply the first non-empty `item.currency` (`:42`); there is no conversion. Display rounds to 4 decimals (`formatCellNumber`, `packages/core/src/artifacts/markdown-table.ts:7-15`), and so does the prompt-facing `formatMetricForPrompt` (`packages/core/src/finance/metrics.ts:236-245`).

**The narrative call** (`packages/host/src/finance-generate.ts:223-238`) sends `BRIEF_SYSTEM` (`:55-68`) wrapped in `withOutputLanguage(BRIEF_SYSTEM, "finance", localeForRun())`. The prompt body, built by `financePromptBlock` (`packages/host/src/finance-brief-build.ts:137`), shows line items and computed metrics **only as Markdown tables** — never as loose prose numbers.

**The number guard.** `buildFinanceBrief(parseBriefDraft(raw), computed)` (`packages/host/src/finance-brief-build.ts:118`, `:64`) runs every section body through `guardNumbers` (`packages/core/src/finance/number-guard.ts:150`), which replaces any figure that does not trace to `computed.allowed` with the literal `[unverified figure]` (`UNVERIFIED_MARKER`, `:12`). Tolerances: relative `0.005`, absolute `0.5`, small-absolute `0.0500001` (`:7-10`); integers ≤ `FREE_INTEGER_MAX = 12` and years in `1900..2100` pass without matching anything (`:15-17`, `:123-129`). An invented figure is **not an error** — it is silently marked, and counted into the `guard.total` progress event (`packages/host/src/finance-generate.ts:246-250`).

The brief is serialized by `financeBriefToMarkdown` (`packages/core/src/artifacts/finance-brief.ts:71`) and persisted as an artifact.

### Model, thinking and watchdog

**Default model.** `JOB_MODE_PREFERENCES.finance = ["hy3", "hy-3", "hunyuan-3", "deepseek-v4-flash"]` (`packages/core/src/models/mode-defaults.ts:50`). None of the `hy3` ids are in this gateway's catalog (comment at `:29-34`), so Finance resolves to the fallback `EFFECTIVE_JOB_MODEL = "deepseek-v4-flash"` (`:36`). The preference list is effectively dead weight today.

**Thinking.** Both Finance calls carry `jobMode: "finance"`, so `applyJobThinking` (`packages/core/src/models/job-thinking.ts:49-58`) merges `{ reasoning_effort: "low" }` — and nothing else — for the quiet-thinking families `^deepseek-v4`, `^glm-5\.3`, `^kimi-k3`, `^qwen3\.8-max` (`:19-29`), applied at `packages/core/src/runtime/ai-sdk-runtime.ts:272`. Chat is untouched; see [`chat-send.md`](chat-send.md).

**Watchdog.** Because `deepseek-v4-flash` matches `QUIET_REASONING_FAMILY` (`packages/core/src/runtime/stream-watchdog.ts:40`), a Finance call gets the long budgets: `STREAM_REASONING_TTFB_MS = 240_000` and `STREAM_REASONING_IDLE_MS = 180_000` (`:11`, `:9`), not the 120 s / 60 s pair. Finance passes no `streamWatchdog` override, so the model defaults apply as-is.

### Failure modes

| Case | Result |
|---|---|
| Brief has no figures | `briefLooksLikeFigures` declines to auto-parse client-side |
| Model returns non-JSON at parse | 502 `invalid_finance` (`packages/host/src/finance-generate.ts:150`) |
| Every row invalid or dropped | 422 `invalid_finance` with `modeMessage("noFiguresParsed")` (`:156`) |
| Narrative model returns non-JSON | 502 `invalid_finance` (`packages/host/src/finance-brief-build.ts:69`) |
| Narrative returns zero sections | 502 `invalid_finance` (`:78`) |
| Narrative returns empty text | 502 `generation_failed` (`packages/host/src/finance-generate.ts:240`) |
| Narrative invents a number | silently replaced with `[unverified figure]`, counted in `guard.total` |
| Stall | the shared watchdog aborts, surfaced as `run.failed` → `collectJobAssistantText` throws 502 `generation_failed` (`packages/host/src/job-regen.ts:140-141`) |

## Where things live

| File | Role |
|---|---|
| `packages/host/src/handlers/finance.ts` | Routes: parse, generate, stream, regenerate, docx (`packages/host/src/router.ts:214-218`) |
| `packages/host/src/finance-generate.ts` | Orchestration and both system prompts |
| `packages/host/src/finance-brief-build.ts` | Draft parsing, `guardSection` / `buildFinanceBrief`, `financePromptBlock` |
| `packages/core/src/finance/magnitude.ts` | `expandMagnitudes`, `magnitudeValues`, `looksScaled` |
| `packages/core/src/finance/count-rows.ts` | `isCountRow`, `dropCountRows` |
| `packages/core/src/finance/line-items.ts` | `parseLineItems`, `lineItemsFromTable`, `guessCategory` |
| `packages/core/src/finance/metrics.ts` | `computeFinance`, `formatMetricForPrompt`, the `allowed` list |
| `packages/core/src/finance/engine.ts` | The pure math: sums, margins, growth, CAGR, runway, breakeven, NPV/IRR, ratios |
| `packages/core/src/finance/number-guard.ts` | `guardNumbers`, `extractNumbers` |
| `packages/core/src/artifacts/finance-brief.ts` | Schema and Markdown serialization |
| `packages/core/src/models/mode-defaults.ts` | `JOB_MODE_PREFERENCES.finance`, `EFFECTIVE_JOB_MODEL` |
| `packages/core/src/models/job-thinking.ts` | The `reasoning_effort: "low"` knob and its incident note |
| `packages/host/src/job-regen.ts` | `collectJobAssistantText` — the shared model-call runner |
| `apps/web/components/finance-studio.tsx`, `finance-brief-view.tsx` | The surface |
| `apps/web/lib/finance-brief.ts`, `finance-client.ts` | Client pre-check, error copy, fetch wrappers |

## Gotchas

- **`looksScaled` needs the raw text, not the expanded text.** Passing `expanded` would destroy the very suffixes it reads as evidence.
- **`M` is locale-dependent.** A mistranslated locale flag changes every parsed amount by 1000×, silently, and margins will not reveal it because ratios are scale-invariant.
- **Margins hide scale bugs.** The 0.14.26 incident was found in stored items, DOCX output and NPV/runway — never in the percentages.
- **`computeFinance` is not P&L / cash flow / balance sheet.** `quickRatio` and `dscr` exist in `packages/core/src/finance/engine.ts:174` but are unreachable from Finance, because `ratioMetrics` never supplies `inventory`, `netOperatingIncome` or `debtService`.
- **An invented figure is marked, not rejected.** `[unverified figure]` in a section body is the guard working, not a bug.
- **The Finance "default model" in `mode-defaults.ts` is not the model that runs.** `hy3` is absent from this gateway's catalog; every real run is `deepseek-v4-flash`. Do not reorder the preference list to "fix" a Finance timeout — that is not where the behaviour comes from.
- **Never add a vendor-specific thinking field here.** The comment at `packages/core/src/models/job-thinking.ts:10-17` says: no non-OpenAI vendor field without a fresh live 200 to point at. It also warns the family list must stay in sync with `QUIET_REASONING_FAMILY` in `stream-watchdog.ts`.
- Finance's parse call is itself gated: `requireGatewayAllowed` at `packages/host/src/handlers/finance.ts:16, 28, 42, 53`.

## Verify

`.cursor/skills/verify-agentforge/features/finance.md`. Its gotcha about a quiet drafting phase being the model thinking, not a stall, was added by the same pass that widened the watchdog family (`docs/internal/0.14.26-changelog.md:143`).

Testids: `finance-studio` (`apps/web/components/finance-studio.tsx:205`), `finance-figures-input` (`:257`), `finance-parse` (`:264`), `finance-inputs` (`:243`), `finance-auto-parsed` (`:236`), `finance-param-${key}` (`:335`), `finance-prompt` (`:404`), `finance-generate` (`:415`), `finance-cancel` (`:407`), `finance-error` (`:225`), `finance-download-docx` (`:218`); in the brief view, `finance-preview`, `finance-guard`, `finance-section`, `finance-section-regen`, `finance-metrics`, `finance-table`, `finance-assumptions` (`apps/web/components/finance-brief-view.tsx:41-117`).

Tests: `packages/core/src/finance/magnitude.test.ts` (en/id briefs, the `M` ambiguity, Indonesian suffixes, grouped digits, leaves counts and identifiers and periods alone, `looksScaled` restoring dropped mantissas); `count-rows.test.ts` (drops "12 outlets", keeps a currency-bearing row, keeps large counts, does not substring-match `daysheet`, returns a new array); `number-guard.test.ts`; `metrics.test.ts` (per-period margins, growth, burn, runway, tables; breakeven and NPV/IRR with params; "feeds the number guard so invented figures are caught" at `:69`); `packages/host/src/finance-brief-build.test.ts` (input validation, figures that do not trace are stripped, prompt renders tables only, DOCX); `packages/host/src/handlers/finance.test.ts` (live-runtime gating — Finance does **not** fall back to stub); `packages/core/src/models/job-thinking.test.ts:9` (pins `reasoning_effort: "low"` for `deepseek-v4-flash` + `"finance"`, and `null` extras for non-quiet models); `apps/web/lib/finance-brief.test.ts`; `apps/web/lib/finance-locale.test.ts`.

## Why

**Why thinking-off was rejected and effort-low kept.** `[Direct]` `docs/internal/0.14.26-changelog.md:133`: "**First attempt was wrong and the desk caught it:** sending DeepSeek's documented `thinking: {"type":"disabled"}` made every Finance call on `deepseek-v4-flash` and `deepseek-v4-pro` fail with HTTP 400 in 2-4 s, 5/5, the `/finance/parse` call included — this gateway's passthrough rejects vendor-only fields — while `glm-5.3-flash` with `reasoning_effort: "low"` alone returned 200 in 12 s and Chat on the same model was unaffected. Every family now sends `{"reasoning_effort":"low"}` and nothing else (Qwen's `enable_thinking: false` dropped for the same reason), replacing the generic `reasoning_effort: "medium"` the chat ladder used to put on a studio's request; `reasoning_effort` is the proven field because Chat sends it to these ids on every turn."

`[Direct]` `docs/internal/blockers-2026-09-15.md:205` closes blocker P1 with the measurement: the close condition was 4 of 5, and "the restarted 3100 desk returned **5/5 at 29–41 s**. No model default reordered." `[Direct]` the code comment at `packages/core/src/models/job-thinking.ts:10-17` records the same finding at the call site and sets the standing rule: no vendor-only field without a fresh live 200.

**Confidence: high.** Driven, counted, and written down in three places.

**Why the magnitude rewrite exists at all.** `[Direct]` `docs/internal/0.14.26-changelog.md:189`: "With the `reasoning_effort: "low"` job knob, `deepseek-v4-flash` returned `revenue: 18.4` instead of 18 400 000 000 in 6 of 8 parses of 'revenue IDR 18.4B, COGS IDR 7.9B, opex IDR 6.1B, net profit IDR 2.6B' (`gpt-5.6-luna` 2/2 correct; margins hid it because ratios are scale-invariant, but stored items, DOCX and NPV/runway were 1e9 short). `/finance/parse` now rewrites the figures text to plain integers before the model sees it and re-scales any mantissa that still comes back, via `expandMagnitudes` / `looksScaled` in `packages/core/src/finance/magnitude.ts` (en and id suffixes; `M` is a million in en and `miliar` in id, decided by the run locale). The knob stays." **Confidence: high** — this is the decision, its evidence and its trade-off in one entry. Note the causal chain it records: the cheaper effort setting *caused* the scale bug, and the fix was to stop trusting the model with magnitudes rather than to raise the effort back.

**Why the narrative model is never allowed to produce a number.** `[Supported]` Three mechanisms converge: `financePromptBlock` renders inputs and metrics only as tables (`packages/host/src/finance-brief-build.ts:137`, pinned at `finance-brief-build.test.ts:68`); `computeFinance` publishes an explicit `allowed` list (`packages/core/src/finance/metrics.ts:223-229`); and `guardNumbers` replaces anything outside it. `[Inferred]` the reason is that an LLM arithmetic error in a financial brief is both plausible-looking and consequential, so the design makes it structurally impossible rather than merely unlikely — no source states this in words, but the three-layer defence is hard to read any other way. **Confidence: high for the mechanism, medium for the rationale.**

**Why the watchdog gives Finance 240 s / 180 s.** Recorded in [`chat-send.md`](chat-send.md#why) — the same fix, driven from Finance's timeouts.
