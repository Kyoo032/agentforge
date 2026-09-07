import { describe, expect, it } from "vitest";
import { chargeTurnBudget, createTurnBudget } from "./budget";

describe("edit budget (G-17)", () => {
  it("uses the cap when remainingUsd is unknown", () => {
    const budget = createTurnBudget({ capUsd: 2, remainingUsd: null });
    expect(budget.turnBudget).toBe(2);
    const ok = chargeTurnBudget(budget, 0.4);
    expect(ok.ok).toBe(true);
  });

  it("refuses unknown prices", () => {
    const budget = createTurnBudget({ capUsd: 2 });
    const refused = chargeTurnBudget(budget, null);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.refusal.refused).toBe("price_unknown");
    }
  });

  it("refuses when the estimate would exceed the cap", () => {
    const budget = createTurnBudget({ capUsd: 0.5, remainingUsd: null });
    const refused = chargeTurnBudget(budget, 0.9);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.refusal.refused).toBe("turn_cap_exceeded");
    }
  });

  it("takes the min of cap and remaining when remaining is known", () => {
    const budget = createTurnBudget({ capUsd: 2, remainingUsd: 0.3 });
    expect(budget.turnBudget).toBe(0.3);
  });
});
