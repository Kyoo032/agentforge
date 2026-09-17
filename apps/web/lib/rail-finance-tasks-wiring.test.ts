/**
 * The Finance tasks sit under the Finance rail entry on exactly the Market
 * rules: same shared submenu, same chevron inside one `h-8` row, same
 * route-derived open state, same hidden-in-a-collapsed-rail rule, same "the
 * rail picks, the studio only names it" split. JSX and a node-only vitest run,
 * so the contract is pinned against the sources the way Market's is.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_FINANCE_TASK, FINANCE_PHASES, FINANCE_TASKS, financeTaskPhases } from "@agentforge/core/finance";
import enFinance from "../locales/en/finance.json";
import idFinance from "../locales/id/finance.json";
import enRail from "../locales/en/rail.json";
import idRail from "../locales/id/rail.json";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relative: string): string {
  return readFileSync(join(web, relative), "utf8");
}

const block = source("components/rail-finance-tasks.tsx");
const market = source("components/rail-market-specialists.tsx");
const appRail = source("components/app-rail.tsx");
const studio = source("components/finance-studio.tsx");
const prefs = source("lib/rail-prefs.ts");

describe("rail finance tasks block", () => {
  it("renders one row per task, in the core order, keyed off the enum", () => {
    expect(block).toContain("FINANCE_TASKS.map((id) => ({");
    expect(block).toContain("rowTestId={(id) => `finance-task-${id}`}");
    expect([...FINANCE_TASKS]).toEqual(["brief", "cashflow", "budget", "appraisal", "ratios"]);
  });

  it("links each row to its task and marks the open one", () => {
    expect(block).toContain("onMode={pathname === FINANCE_PATH}");
    expect(block).toContain('currentId={taskFromParam(searchParams.get("task"))}');
    expect(source("lib/finance-task.ts")).toContain('export const FINANCE_PATH = "/finance";');
    expect(source("lib/finance-task.ts")).toContain("return `${FINANCE_PATH}?task=${encodeURIComponent(id)}`;");
  });

  it("defaults an absent or unknown query value to the core default task", () => {
    expect(source("lib/finance-task.ts")).toContain("return isFinanceTask(value) ? value : DEFAULT_FINANCE_TASK;");
    expect(DEFAULT_FINANCE_TASK).toBe("brief");
  });

  it("names each task from the catalog with the core meta behind it", () => {
    expect(block).toContain("labeled(`finance.tasks.${id}.label`, financeTaskLabel(id, locale))");
    expect(block).toContain("labeled(`finance.tasks.${id}.hint`, financeTaskHint(id, locale))");
  });

  it("uses the same chrome as Market rather than its own", () => {
    for (const fragment of ["RailSubmenu", "RailSubmenuToggle", "useRailSubmenu"]) {
      expect(block, fragment).toContain(fragment);
      expect(market, fragment).toContain(fragment);
    }
    // No private copy of the row, branch or scroll rules.
    for (const fragment of ["border-l border-[var(--line)]", "mask-image", "ResizeObserver", "overflow-y-auto"]) {
      expect(block, fragment).not.toContain(fragment);
    }
  });

  it("carries the testids the harness drives", () => {
    expect(block).toContain('testId="finance-tasks-toggle"');
    expect(block).toContain('testId="rail-finance-tasks"');
    expect(block).toContain('branchTestId="rail-finance-tasks-branch"');
    expect(block).toContain('ariaLabel={t("rail.financeTasksAria")}');
  });

  it("is open exactly while the route is Finance, and persists nothing", () => {
    expect(block).toContain("return useRailSubmenu(FINANCE_PATH);");
    expect(block).not.toContain("localStorage");
    expect(block).not.toContain("rail-prefs");
    expect(prefs).not.toContain("FinanceTasks");
  });

  it("shows every task, including the ones that are not built yet", () => {
    // A hidden row would be less honest than a row that says "coming soon".
    expect(block).toContain("FINANCE_TASKS.map");
    expect(block).not.toContain("availableFinanceTasks");
  });
});

describe("app rail finance block", () => {
  it("hangs the tasks off the Finance row inside one h-8 row", () => {
    expect(appRail).toContain('<div key={mode.href} className="shrink-0" data-testid="rail-finance-mode">');
    expect(appRail).toContain('<div className="flex h-8 items-center gap-0.5">');
    expect(appRail).toContain("{financeTasks.open ? <RailFinanceTasks /> : null}");
    expect(appRail).toContain("enabled={financeTasks.enabled}");
  });

  it("renders nothing extra while the rail is collapsed", () => {
    expect(appRail).toContain('if (collapsed || (mode.id !== "market" && mode.id !== "finance")) {');
    expect(appRail).toContain("      return item;");
  });

  it("keeps the branch out of the rail itself, the way Market does", () => {
    expect(appRail.includes("border-l border-[var(--line)]")).toBe(false);
  });
});

describe("finance studio reads the rail's choice", () => {
  it("takes the task from the URL and falls back to the brief", () => {
    expect(studio).toContain('const urlTask = taskFromParam(searchParams.get("task"));');
    expect(studio).toContain("const onFinance = pathname === FINANCE_PATH;");
    expect(studio).toContain("const task = onFinance ? urlTask : lastTaskRef.current;");
  });

  it("names the open task and its hint, and offers no second picker", () => {
    expect(studio).toContain('data-testid="finance-task-current"');
    expect(studio).toContain('data-testid="finance-task-hint"');
    expect(studio).not.toContain("<select");
    expect(studio).not.toContain("setTask(");
  });

  it("renders the phase strip from the task's own phases", () => {
    expect(studio).toContain("<FinancePhaseStrip phases={financeTaskPhases(task)} />");
    expect(source("components/finance-steps/finance-phase-strip.tsx")).toContain('data-testid="finance-phase-strip"');
  });

  it("keys the draft by workspace and task, and sends the task with every request", () => {
    expect(studio).toContain('const scopeKey = `${workspaceId ?? ""}|${task}`;');
    expect(studio).toContain("saveFinanceDraft(workspaceId, task, { prompt, figures });");
    expect(studio).toContain("return { ...briefInputsBody(briefState), task };");
    expect(studio).toContain("parseFinanceFigures(figures, { model, task, proseText })");
  });

  it("shows a coming-soon panel instead of the brief inputs for a task that is not built", () => {
    expect(studio).toContain("const available = financeTaskAvailable(task);");
    expect(studio).toContain("<FinanceComingSoon task={task} locale={uiLocale} />");
    expect(source("components/finance-steps/finance-coming-soon.tsx")).toContain(
      'data-testid="finance-task-coming-soon"',
    );
  });

  it("stays a shell: the studio file is well under the 400 line ceiling", () => {
    expect(studio.split("\n").length).toBeLessThan(400);
  });
});

describe("finance task locale catalog", () => {
  it("names every task in both locales", () => {
    for (const task of FINANCE_TASKS) {
      for (const [name, catalog] of [
        ["en", enFinance],
        ["id", idFinance],
      ] as const) {
        const entry = (catalog.tasks as Record<string, { label?: string; hint?: string }>)[task];
        expect(entry?.label?.trim(), `${name}.${task}.label`).toBeTruthy();
        expect(entry?.hint?.trim(), `${name}.${task}.hint`).toBeTruthy();
      }
    }
  });

  it("names every phase a task walks, in both locales", () => {
    const used = new Set(FINANCE_TASKS.flatMap((task) => [...financeTaskPhases(task)]));
    expect(used.size).toBe(FINANCE_PHASES.length);
    for (const phase of used) {
      for (const [name, catalog] of [
        ["en", enFinance],
        ["id", idFinance],
      ] as const) {
        const label = (catalog.phases as Record<string, string>)[phase];
        expect(label?.trim(), `${name}.phases.${phase}`).toBeTruthy();
      }
    }
  });

  it("translates the tasks chrome on the rail in both locales", () => {
    expect(enRail.financeTasksAria).toBe("Finance tasks");
    expect(enRail.financeTasksToggle).toBe("Show tasks");
    expect(enRail.financeTasksHide).toBe("Hide tasks");
    expect(idRail.financeTasksAria).toBe("Tugas keuangan");
    expect(idRail.financeTasksToggle).toBe("Tampilkan tugas");
    expect(idRail.financeTasksHide).toBe("Sembunyikan tugas");
  });

  it("writes the Indonesian copy in Indonesian, not English left in place", () => {
    for (const task of FINANCE_TASKS) {
      const en = (enFinance.tasks as Record<string, { label: string }>)[task].label;
      const idLabel = (idFinance.tasks as Record<string, { label: string }>)[task].label;
      expect(idLabel, task).not.toBe(en);
    }
    expect((idFinance.phases as Record<string, string>)["paste-figures"]).toBe("Tempel angka");
  });
});
