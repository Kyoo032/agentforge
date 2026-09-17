# Building one Finance task

Four task flows are built in parallel. The seam exists so no two workers edit the same file.
Replace the files listed for **your** task only; everything else here is already wired.

## Files you create or replace (one task = seven files)

| Layer | File | What it holds |
|---|---|---|
| core | `packages/core/src/finance/tasks/<task>.ts` | **replace the stub** — the real `FinanceTaskModule` |
| core | `packages/core/src/finance/<your math>.ts` (+ `.test.ts`) | pure arithmetic modules (`periods`, `variance`, `sensitivity`, `bands`, …) |
| core | `packages/core/src/finance/tasks/<task>.test.ts` | module contract tests |
| host | `packages/host/src/finance-tasks/parse-<task>.ts` | **replace the stub** — free text → your confirmed input |
| web | `apps/web/components/finance-steps/<task>/index.tsx` | **replace the placeholder export** — your inputs panel |
| locale | `apps/web/locales/{en,id}/finance.json` → `"<task>": { … }` | your reserved block, already present and empty |
| meta | `packages/core/src/finance/tasks.ts` | flip **only** your task's `available: false` → `true` |

Do not edit `tasks/registry.ts`, `tasks/types.ts`, `finance-tasks/runner.ts`,
`finance-tasks/parsers.ts`, `finance-steps/registry.tsx` or another task's block.

## The core contract (`tasks/types.ts`)

```ts
type FinanceTaskModule<Input, Computed> = {
  id: FinanceTask;
  inputSchema: z.ZodType<Input>;                 // the CONFIRMED input, validated at the boundary
  compute(input): Computed;                      // pure code math — the only place numbers are made
  buildReport(computed, prose, options?): FinanceReport;
  promptFacts(computed, locale): string;         // the ONLY numbers the model ever sees
  allowedNumbers(input, computed): readonly number[];  // the only numbers the guard accepts back
  sections: { id: string; title: { id: string; en: string } }[];
};
```

Keep the exported const name the stub already uses (`<task>TaskModule`) — `registry.ts` imports it.
`compute` must not reach the gateway, the filesystem or `Date.now()`. `promptFacts` and
`allowedNumbers` must agree: a figure the model is shown but not allowed is stripped as
`[unverified figure]`, and that is a bug in your module, not in the guard.
`sections` must match this task's `sections` in `tasks.ts` and have a locale key per id.

## Host and web

`runFinanceTask` already does: validate → `compute` → `promptFacts` → narrate → `guardNumbers`
against `allowedNumbers` → `buildReport` → persist → progress events named by your phase ids.
You write no pipeline. `parse-<task>.ts` exports a `FinanceTaskParser` (or stays `null` to reuse
the brief's line-item parse). Web steps get the props contract in `finance-steps/types.ts`; the
result side is generic already — the host sends `report` and `FinanceResultPanel` renders it.

**Privacy.** The runner redacts the request's source text (`guardFinanceInput`) and nothing else —
it cannot know your input's shape. Your `parse-<task>.ts` MUST pass the rows it produces through
`guardFinanceInput({ lineItems })` (or the sheet form) before they are answered or narrated, the
way `finance-generate.ts` does for the brief. Financial data stays local: no network call of any
kind belongs in a task module or its parse hook.

## Before you call it done

- `npx vitest run` green in `packages/core`, `packages/host`, `apps/web`.
- Your math module has its own tests written first (RED → GREEN), 80%+ on the new files.
- A module test that `allowedNumbers` covers every number `promptFacts` prints.
- A report test: `buildReport` fills every id in `sections`, and its charts match the plan's list.
- `en` and `id` key trees stay aligned (`finance-locale.test.ts`).
- `npx biome check --formatter-enabled=false --assist-enabled=false <your files>` clean.
