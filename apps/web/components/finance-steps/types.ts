/**
 * The props contract every Finance task's step components are handed.
 *
 * The studio is a shell: it owns the job, the model, the workspace and the draft, and knows nothing
 * about what any one task asks for. A task's own step component reads what it needs out of `draft`
 * and writes changes back through `setDraft`, so four tasks can be built in parallel without two
 * workers ever editing the same file.
 *
 * The contract, verbatim:
 *
 *   { task, workspaceId, locked, model, onGenerate(payload), draft, setDraft }
 *
 * - `task`       — the task the rail opened. The URL owns it; a step never changes it.
 * - `workspaceId`— the desk, or null for the owner's home desk. Used for per-desk memory only.
 * - `locked`     — a job or a parse is running: every control must be disabled, not hidden.
 * - `model`      — the model the prompt bar has selected, for a step that shows or sends it.
 * - `onGenerate` — the one channel back to the studio's actions. `{ kind: "parse" }` reads the
 *                  pasted figures into rows; `{ kind: "generate" }` runs the task. A task may add
 *                  its own payload kind here — that is the only shared type it edits.
 * - `draft`      — this task's own bag of state, owned by the studio and keyed `workspace|task`.
 *                  Each task declares its own shape (see `BriefStepDraft`) and narrows it once, at
 *                  the top of its component: the bag is deliberately opaque so the registry can hold
 *                  five tasks whose drafts have nothing in common.
 * - `setDraft`   — a partial patch, never a mutation. Fields left out are untouched.
 */
import type { ComponentType } from "react";
import type { FinanceTask } from "@/lib/finance-task";
import type { FinanceResultPanelProps } from "./finance-result-panel";

/** One task's draft, seen from the registry: an opaque bag the task itself narrows. */
export type FinanceStepDraft = Record<string, unknown>;

/** What a step asks the studio to do. Tasks add their own kinds; the studio ignores what it cannot run. */
export type FinanceStepPayload = { readonly kind: "parse" } | { readonly kind: "generate" };

export type FinanceStepProps = {
  readonly task: FinanceTask;
  readonly workspaceId: string | null;
  readonly locked: boolean;
  readonly model: string;
  readonly onGenerate: (payload: FinanceStepPayload) => void;
  readonly draft: FinanceStepDraft;
  readonly setDraft: (patch: FinanceStepDraft) => void;
};

/**
 * What one task contributes to the studio. `Result` is optional because the result side is already
 * generic — `FinanceResultPanel` renders any `FinanceReport` — so a task only names one when it
 * wants something other than charts, flags and prose.
 */
export type FinanceStepEntry = {
  readonly Inputs: ComponentType<FinanceStepProps>;
  readonly Result?: ComponentType<FinanceResultPanelProps>;
};
