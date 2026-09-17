import { describe, expect, it } from "vitest";
import {
  DEFAULT_FINANCE_TASK,
  FINANCE_PHASES,
  FINANCE_PHASE_KINDS,
  FINANCE_TASKS,
  FINANCE_TASK_META,
  availableFinanceTasks,
  financeTaskPhases,
  financeTaskSystemRules,
  isFinancePhase,
  isFinanceTask,
} from "./index";

describe("finance task ids", () => {
  it("lists the five tasks the flow graph names, brief first", () => {
    expect([...FINANCE_TASKS]).toEqual(["brief", "cashflow", "budget", "appraisal", "ratios"]);
    expect(DEFAULT_FINANCE_TASK).toBe("brief");
  });

  it("recognises only its own ids", () => {
    for (const task of FINANCE_TASKS) {
      expect(isFinanceTask(task)).toBe(true);
    }
    for (const value of ["", "Brief", "docx", null, undefined, 3, {}]) {
      expect(isFinanceTask(value)).toBe(false);
    }
  });
});

describe("finance task meta", () => {
  it("has one frozen entry per task, keyed by its own id", () => {
    for (const task of FINANCE_TASKS) {
      const meta = FINANCE_TASK_META[task];
      expect(meta.id).toBe(task);
      expect(Object.isFrozen(meta)).toBe(true);
    }
    expect(Object.isFrozen(FINANCE_TASK_META)).toBe(true);
  });

  it("carries both languages for every piece of copy", () => {
    for (const task of FINANCE_TASKS) {
      const meta = FINANCE_TASK_META[task];
      for (const text of [meta.label, meta.hint, meta.defaultPrompt, meta.sampleFigures]) {
        expect(text.id.trim(), `${task} id copy`).not.toBe("");
        expect(text.en.trim(), `${task} en copy`).not.toBe("");
      }
    }
  });

  // A task ships the day its own flow is built; until then its row answers coming soon.
  it("always ships the brief, and lists the shipped tasks in the catalog's own order", () => {
    expect(FINANCE_TASK_META.brief.available).toBe(true);
    expect(FINANCE_TASK_META.appraisal.available).toBe(true);
    expect([...availableFinanceTasks()]).toEqual(FINANCE_TASKS.filter((id) => FINANCE_TASK_META[id].available));
  });

  it("gives each task the six or seven phases its own flow graph draws", () => {
    expect([...financeTaskPhases("brief")]).toEqual([
      "paste-figures",
      "parse-items",
      "confirm-rows",
      "core-metrics",
      "narrate-sections",
      "number-guard-export",
    ]);
    expect([...financeTaskPhases("cashflow")]).toEqual([
      "monthly-flows",
      "parse-periods",
      "confirm-periods",
      "runway-math",
      "scenario",
      "narrate-guard-export",
    ]);
    expect([...financeTaskPhases("budget")]).toEqual([
      "budget-and-actuals",
      "parse-both-sets",
      "match-pairs",
      "variance-math",
      "flag-over-limit",
      "explain-flagged",
      "guard-export",
    ]);
    expect([...financeTaskPhases("appraisal")]).toEqual([
      "outlay-and-flows",
      "discount-rate",
      "confirm-flows",
      "appraisal-math",
      "sensitivity-grid",
      "memo-guard-export",
    ]);
    expect([...financeTaskPhases("ratios")]).toEqual([
      "balance-and-pl",
      "parse-items",
      "classify-buckets",
      "ratio-math",
      "bands-vs-thresholds",
      "scorecard-guard-export",
    ]);
  });

  it("names only known phases, and every declared phase belongs to a task", () => {
    const used = new Set(FINANCE_TASKS.flatMap((task) => [...financeTaskPhases(task)]));
    for (const phase of used) {
      expect(isFinancePhase(phase), phase).toBe(true);
    }
    for (const phase of FINANCE_PHASES) {
      expect(used.has(phase), `${phase} is declared but unused`).toBe(true);
    }
  });

  it("classifies every phase the way the graph legend does", () => {
    expect(FINANCE_PHASE_KINDS["parse-items"]).toBe("shared");
    expect(FINANCE_PHASE_KINDS["monthly-flows"]).toBe("input");
    expect(FINANCE_PHASE_KINDS["runway-math"]).toBe("math");
    for (const phase of FINANCE_PHASES) {
      expect(["shared", "input", "math"], phase).toContain(FINANCE_PHASE_KINDS[phase]);
    }
  });

  it("keeps a task's phase list free of repeats", () => {
    for (const task of FINANCE_TASKS) {
      const phases = [...financeTaskPhases(task)];
      expect(new Set(phases).size, task).toBe(phases.length);
    }
  });
});

describe("financeTaskSystemRules", () => {
  it("adds nothing for the brief, so today's prompt is unchanged", () => {
    expect(financeTaskSystemRules("brief", "en")).toEqual([]);
    expect(financeTaskSystemRules("brief", "id")).toEqual([]);
  });

  it("gives every other task bullet rules in both languages", () => {
    for (const task of FINANCE_TASKS.filter((id) => id !== "brief")) {
      for (const language of ["id", "en"] as const) {
        const rules = financeTaskSystemRules(task, language);
        expect(rules.length, `${task}/${language}`).toBeGreaterThan(0);
        for (const rule of rules) {
          expect(rule.startsWith("- "), rule).toBe(true);
        }
      }
    }
  });

  it("never asks the model to do arithmetic of its own", () => {
    for (const task of FINANCE_TASKS) {
      for (const language of ["id", "en"] as const) {
        for (const rule of financeTaskSystemRules(task, language)) {
          expect(rule).not.toMatch(/\d+\s*[+\-*/]\s*\d+/);
        }
      }
    }
  });
});
