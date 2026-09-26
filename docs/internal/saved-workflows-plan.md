# Saved workflows — plan of record

Status: design only, nothing built. Product: **Personal only** (Rizky, 2026-09-26). Enterprise follows later, once its extended backend exists; until then the feature is gated off in the hosted build.

## The idea

Someone who uses Nultron for the same job every week should not set it up every week. The path is Chat → a mode → a result → the Knowledge Base, and after a setup period the app has learned how this person runs this job and does it better the next time.

## Owner rulings (2026-09-26)

1. **No approval step.** Adjustments the app learns during the setup period apply on their own. Every adjustment is still a new version, so the owner can see what changed and roll it back.
2. **A workflow is a chain of phases, and each phase is exactly one mode run.** Example: Research → Documents → Presentation. A phase never mixes modes.
3. **Personal first.** The desktop app, SQLite in the user data dir. The hosted app does not expose it until the Enterprise backend is extended.

## What already exists to build on

Mapped on 2026-09-26 against `bf74c96`.

- Modes are fixed harnesses in code (`packages/core/src/agents/product-modes.ts`); a desk's `productModes` only decides visibility.
- Every mode run writes an artifact with `mode`, `kind`, sealed `body` and `meta` (`packages/db/src/schema.ts`, `packages/core/src/artifacts/artifact-meta.ts`) — most of what a phase needs to replay.
- Finished runs already land in Knowledge as work cards (`packages/host/src/work-cards.ts` → `upsertWorkSource`), from Research, Market, Documents, Data, Finance, Presentation, Legal, Meeting and Chat.
- Per-desk preferences today are only the job model (`documentGenModel`, `researchGenModel`, `presentationGenModel` in `packages/core/src/secrets.ts`).
- Cross-mode handoff is renderer-only and in memory (`apps/web/lib/mode-handoff.ts`).

Missing: a workflow record, a learning loop, and a way to rerun.

## Shape

**Data (new tables, desk-scoped):**

- `workflows` — id, workspace id, name, created from which artifact, current version, run count, setup state (`learning` | `tuned`).
- `workflow_versions` — the phases in order; per phase: mode, task/specialist id where the mode has them, model, input template, Knowledge sources to attach, and an *adjustment layer* (extra instructions and defaults). Append-only.
- `workflow_runs` — one row per run: version used, per-phase artifact ids, what the owner changed afterwards (edited output, rerun, rewritten prompt).

**Adjustment layer, not a prompt rewrite.** A mode's built-in instructions stay in code. A workflow adds a layer on top, the way `withOutputLanguage` does today. The deterministic rules hold unchanged: Finance and Market figures still come from core, never from a learned instruction; PII masking and the gateway gate still apply per run.

**Learning loop.** During `learning` (length open — see below), after each run the host compares the result with what the owner did next and derives adjustments — preferred structure, tone, recurring edits, sources always attached, inputs that never change. Each derivation writes a new version and applies at once (ruling 1). The workflow's page shows a version history with a one-click revert.

**Surfaces.**

- "Save as workflow" on a finished result (the artifact actions row), with an "add next phase" step to chain the next mode.
- Saved workflows as cards on the Chat empty state and under their first mode in the rail.
- A run page: phases as steps, each phase's result, "run again" with fresh inputs.

## Open

- Length of the setup period (a number of runs, or until adjustments stop changing).
- Whether a phase's output feeds the next phase automatically or waits for the owner to open it.
- Where a workflow lives when its desk no longer shows one of its modes.
- Scheduling ("every Monday") — not in the first cut.
