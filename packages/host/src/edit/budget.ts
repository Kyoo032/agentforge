import { estimateJobUsd, editToolRefusal, type EditToolRefusal } from "@agentforge/core";

export const DEFAULT_EDIT_TURN_CAP_USD = 2;

export type TurnBudget = {
  capUsd: number;
  remainingUsd: number | null;
  turnBudget: number;
  spentUsd: number;
};

export function resolveEditTurnCapUsd(raw?: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(50, Math.max(0.5, raw));
  }
  return DEFAULT_EDIT_TURN_CAP_USD;
}

/** `capUsd` comes from the running desk's settings; the caller reads it, so this stays desk-agnostic. */
export function createTurnBudget(input: { capUsd?: number; remainingUsd?: number | null } = {}): TurnBudget {
  const capUsd = resolveEditTurnCapUsd(input.capUsd);
  const remainingUsd = input.remainingUsd === undefined ? null : input.remainingUsd;
  const turnBudget = remainingUsd == null ? capUsd : Math.min(capUsd, remainingUsd);
  return { capUsd, remainingUsd, turnBudget, spentUsd: 0 };
}

export function chargeTurnBudget(
  budget: TurnBudget,
  estimate: number | null,
): { ok: true; estimate: number } | { ok: false; refusal: EditToolRefusal } {
  if (estimate == null) {
    return { ok: false, refusal: editToolRefusal("price_unknown", "Price is unknown; propose a plan") };
  }
  if (budget.spentUsd + estimate > budget.turnBudget) {
    return { ok: false, refusal: editToolRefusal("turn_cap_exceeded", "This turn would exceed the spend cap") };
  }
  budget.spentUsd += estimate;
  return { ok: true, estimate };
}

export function estimateEditJobUsd(model: string, opts: { seconds?: number; resolution?: "480p" | "720p" | "1080p"; count?: number } = {}): number | null {
  return estimateJobUsd(model, opts);
}
