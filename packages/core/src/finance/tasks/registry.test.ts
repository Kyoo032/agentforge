import { describe, expect, it } from "vitest";
import { FINANCE_TASKS } from "../task-ids";
import { FINANCE_TASK_META } from "../tasks";
import { briefInputSchema, briefTaskModule } from "./brief";
import { FINANCE_TASK_MODULES, getFinanceTaskModule, hasFinanceTaskModule, implementedFinanceTasks } from "./registry";
import type { FinanceTaskProse } from "./types";

const ITEMS = [
  { label: "Revenue", period: "2025", amount: 1000, currency: "IDR", category: "revenue" as const },
  { label: "COGS", period: "2025", amount: 400, currency: "IDR", category: "cogs" as const },
];

const PROSE: FinanceTaskProse = {
  title: "FY2025 margin",
  sections: [{ id: "one", heading: "Where the margin came from", body: "Revenue was 1000." }],
  assumptions: ["Figures are FY2025."],
};

describe("finance task registry", () => {
  it("holds one entry per task id, frozen", () => {
    expect(Object.keys(FINANCE_TASK_MODULES).sort()).toEqual([...FINANCE_TASKS].sort());
    expect(Object.isFrozen(FINANCE_TASK_MODULES)).toBe(true);
  });

  it("answers null for a task whose flow is not built, and for a stranger", () => {
    expect(getFinanceTaskModule("not-a-task")).toBeNull();
    expect(getFinanceTaskModule(null)).toBeNull();
    expect(hasFinanceTaskModule("brief")).toBe(true);
  });

  // An unavailable row and a missing module are the same fact: one flag, one file.
  it("keeps the available flags and the modules in step", () => {
    for (const task of FINANCE_TASKS) {
      expect(FINANCE_TASK_META[task].available, task).toBe(hasFinanceTaskModule(task));
    }
    expect(implementedFinanceTasks()).toEqual(FINANCE_TASKS.filter((task) => FINANCE_TASK_META[task].available));
  });
});

describe("brief task module", () => {
  it("refuses an input the user has not confirmed", () => {
    expect(briefInputSchema.safeParse({ items: [] }).success).toBe(false);
    expect(briefInputSchema.safeParse({}).success).toBe(false);
    expect(briefInputSchema.parse({ items: ITEMS }).params).toEqual({});
  });

  it("computes in code and builds the report every renderer reads", () => {
    const input = briefInputSchema.parse({ items: ITEMS });
    const computed = briefTaskModule.compute(input);
    const report = briefTaskModule.buildReport(computed, PROSE, { locale: "en" });
    expect(report.task).toBe("brief");
    expect(report.title).toBe("FY2025 margin");
    expect(report.notes.map((note) => note.heading)).toContain("Where the margin came from");
    expect(report.summary.length).toBeGreaterThan(0);
  });

  // The guard is only as honest as this pair: anything printed must also be allowed.
  it("allows every figure its prompt facts print", () => {
    const input = briefInputSchema.parse({ items: ITEMS });
    const computed = briefTaskModule.compute(input);
    const allowed = briefTaskModule.allowedNumbers(input, computed);
    expect(allowed).toContain(1000);
    expect(allowed).toContain(400);
    for (const metric of computed.metrics) {
      if (metric.value !== null) {
        expect(allowed, metric.key).toContain(metric.value);
      }
    }
  });

  it("names its facts in the reader's language and says so when there are none", () => {
    const computed = briefTaskModule.compute(briefInputSchema.parse({ items: ITEMS }));
    expect(briefTaskModule.promptFacts(computed, "en")).toContain("Computed metrics");
    expect(briefTaskModule.promptFacts(computed, "id")).toContain("Metrik terhitung");
    const empty = briefTaskModule.compute(
      briefInputSchema.parse({ items: [{ label: "Note", period: "", amount: 1, currency: "", category: "other" }] }),
    );
    expect(briefTaskModule.promptFacts(empty, "en")).toContain("Computed metrics");
  });
});
