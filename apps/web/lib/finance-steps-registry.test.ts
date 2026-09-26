/**
 * The seam four task workers build against, pinned.
 *
 * `apps/web` runs vitest without a DOM, so these read the sources the way the rail and mount-wiring
 * tests do. What they protect is the split: one folder per task, one row per task in the registry,
 * and a studio that renders through it rather than naming a panel.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FINANCE_TASKS, financeTaskAvailable } from "@agentforge/core/finance";
import enFinance from "../locales/en/finance.json";
import idFinance from "../locales/id/finance.json";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relative: string): string {
  return readFileSync(join(web, relative), "utf8");
}

const registry = source("components/finance-steps/registry.tsx");
const contract = source("components/finance-steps/types.ts");
const studio = source("components/finance-studio.tsx");
const view = source("components/finance-studio-view.tsx");

describe("finance step registry", () => {
  it("has one folder and one row per task, so no two workers share a file", () => {
    for (const task of FINANCE_TASKS) {
      expect(() => source(`components/finance-steps/${task}/index.tsx`), task).not.toThrow();
      expect(registry, task).toContain(`${task}:`);
    }
    expect(registry).toContain("Object.freeze({");
  });

  it("documents the props contract the steps are handed", () => {
    for (const prop of ["task", "workspaceId", "locked", "model", "onGenerate", "draft", "setDraft"]) {
      expect(contract, prop).toContain(`readonly ${prop}`);
    }
    // The draft is opaque on purpose: five tasks whose drafts have nothing in common.
    expect(contract).toContain("export type FinanceStepDraft = Record<string, unknown>;");
  });

  it("keeps the brief on the panel it has always used", () => {
    const brief = source("components/finance-steps/brief/index.tsx");
    expect(brief).toContain('from "../finance-inputs-panel"');
    expect(brief).toContain("Result: FinanceResultPanel");
  });

  // Every task in the catalog ships today. The flag stays because it is what a task added before
  // its flow is built sets, and the core registry keeps it in step with the module map.
  it("has a panel for every task the catalog says is available", () => {
    for (const task of FINANCE_TASKS.filter((id) => financeTaskAvailable(id))) {
      expect(source(`components/finance-steps/${task}/index.tsx`), task).toContain("export");
    }
    expect(FINANCE_TASKS.every((id) => financeTaskAvailable(id))).toBe(true);
  });

  it("makes the studio render through the registry", () => {
    expect(studio).toContain("const steps = financeStepsFor(task);");
    expect(studio).toContain("StepInputs={StepInputs}");
    expect(studio).toContain("const StepResult = steps.Result ?? FinanceResultPanel;");
    expect(view).toContain("<StepInputs");
    expect(studio).not.toContain("<FinanceInputsPanel");
    expect(view).not.toContain("<FinanceInputsPanel");
  });

  it("sends the task and its report to the one export control", () => {
    expect(view).toContain("report={result.report}");
    expect(source("components/finance-steps/finance-result-panel.tsx")).toContain("result.report ??");
    expect(source("lib/finance-export.ts")).toContain("...(request.report ? { report: request.report } : {}),");
  });
});

describe("finance task locale namespaces", () => {
  it("reserves one block per task in both locales, so workers only add inside their own", () => {
    for (const task of FINANCE_TASKS) {
      expect((enFinance as Record<string, unknown>)[task], `en.${task}`).toBeDefined();
      expect((idFinance as Record<string, unknown>)[task], `id.${task}`).toBeDefined();
    }
  });
});
