import { describe, expect, it } from "vitest";
import { FINANCE_PHASES } from "./finance-task";
import { financePhaseLabel } from "./finance-phase-label";

describe("financePhaseLabel", () => {
  it("names a phase id the way the phase strip does", () => {
    expect(financePhaseLabel("narrate-guard-export")).toBe("Narrate + guard + export");
    expect(financePhaseLabel("core-metrics")).toBe("All core metrics");
    expect(financePhaseLabel("  ratio-math  ")).toBe("Liquidity, debt, DSCR");
  });

  it("has a name for every phase id Finance declares", () => {
    for (const id of FINANCE_PHASES) {
      expect({ id, label: financePhaseLabel(id) }).not.toEqual({ id, label: `finance.phases.${id}` });
    }
  });

  it("leaves a real sentence alone, so other job modes read as they always did", () => {
    expect(financePhaseLabel("Searching the web")).toBe("Searching the web");
    expect(financePhaseLabel("")).toBe("");
  });
});
