/**
 * Education tasks sit under the Education rail entry on the Finance rules:
 * shared submenu, chevron inside one `h-8` row, route-derived open state,
 * hidden when the rail is collapsed. The studio reads `?task=` and an unknown
 * value is the lesson. An empty query is the chooser, which the studio owns.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import enEducation from "../locales/en/education.json";
import idEducation from "../locales/id/education.json";
import enRail from "../locales/en/rail.json";
import idRail from "../locales/id/rail.json";
import { DEFAULT_EDUCATION_TASK, EDUCATION_TASKS, taskFromParam } from "./education-task";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relative: string): string {
  return readFileSync(join(web, relative), "utf8");
}

const block = source("components/rail-education-tasks.tsx");
const finance = source("components/rail-finance-tasks.tsx");
const appRail = source("components/app-rail.tsx");
const studio = source("components/education-studio.tsx");
const prefs = source("lib/rail-prefs.ts");

describe("rail education tasks block", () => {
  it("renders one row per task, in catalog order", () => {
    expect(block).toContain("EDUCATION_TASKS.map((id) => ({");
    expect(block).toContain("rowTestId={(id) => `education-task-${id}`}");
    expect([...EDUCATION_TASKS]).toEqual(["lesson", "quiz", "page", "show"]);
  });

  it("links each row to its task and marks the open one", () => {
    expect(block).toContain("onMode={pathname === EDUCATION_PATH}");
    expect(block).toContain('currentId={taskFromParam(searchParams.get("task"))}');
    expect(source("lib/education-task.ts")).toContain('export const EDUCATION_PATH = "/education";');
    expect(source("lib/education-task.ts")).toContain("return `${EDUCATION_PATH}?task=${encodeURIComponent(id)}`;");
  });

  it("defaults an absent or unknown query value to the lesson", () => {
    expect(taskFromParam(null)).toBe("lesson");
    expect(taskFromParam("")).toBe("lesson");
    expect(taskFromParam("nope")).toBe("lesson");
    expect(taskFromParam("quiz")).toBe("quiz");
    expect(DEFAULT_EDUCATION_TASK).toBe("lesson");
  });

  it("uses the same chrome as Finance rather than its own", () => {
    for (const fragment of ["RailSubmenu", "RailSubmenuToggle", "useRailSubmenu"]) {
      expect(block, fragment).toContain(fragment);
      expect(finance, fragment).toContain(fragment);
    }
    for (const fragment of ["border-l border-[var(--line)]", "mask-image", "ResizeObserver", "overflow-y-auto"]) {
      expect(block, fragment).not.toContain(fragment);
    }
  });

  it("carries the testids the harness drives", () => {
    expect(block).toContain('testId="education-tasks-toggle"');
    expect(block).toContain('testId="rail-education-tasks"');
    expect(block).toContain('branchTestId="rail-education-tasks-branch"');
    expect(block).toContain('ariaLabel={t("rail.educationTasksAria")}');
  });

  it("is open exactly while the route is Education, and persists nothing", () => {
    expect(block).toContain("return useRailSubmenu(EDUCATION_PATH);");
    expect(block).not.toContain("localStorage");
    expect(block).not.toContain("rail-prefs");
    expect(prefs).not.toContain("EducationTasks");
  });

  it("names each task in both catalogs, and the Indonesian label differs", () => {
    for (const id of EDUCATION_TASKS) {
      const en = enEducation.tasks[id];
      const idCopy = idEducation.tasks[id];
      expect(en.label.length).toBeGreaterThan(0);
      expect(en.hint.length).toBeGreaterThan(0);
      expect(idCopy.label.length).toBeGreaterThan(0);
      expect(idCopy.hint.length).toBeGreaterThan(0);
      expect(idCopy.label).not.toBe(en.label);
    }
    expect(enRail.educationTasksWord).toBe("tasks");
    expect(idRail.educationTasksWord).toBe("tugas");
    expect(idRail.educationTasksWord).not.toBe(enRail.educationTasksWord);
    expect(enEducation.guide.lead.length).toBeGreaterThan(0);
    expect(idEducation.guide.lead).not.toBe(enEducation.guide.lead);
  });
});

describe("app rail education block", () => {
  it("hangs the tasks off the Education row inside one h-8 row", () => {
    expect(appRail).toContain('<div key={mode.href} className="shrink-0" data-testid="rail-education-mode">');
    expect(appRail).toContain('<div className="flex h-8 items-center gap-0.5">');
    expect(appRail).toContain("{educationTasks.open ? <RailEducationTasks /> : null}");
    expect(appRail).toContain("enabled={educationTasks.enabled}");
  });

  it("renders nothing extra while the rail is collapsed", () => {
    expect(appRail).toContain(
      'if (collapsed || (mode.id !== "market" && mode.id !== "finance" && mode.id !== "education")) {',
    );
    expect(appRail).toContain("      return item;");
  });
});

describe("education studio reads the rail's choice", () => {
  it("takes the task from the URL and shows the chooser only when the query is empty", () => {
    expect(studio).toContain('const taskQuery = searchParams.get("task");');
    expect(studio).toContain("const urlTask = taskFromParam(taskQuery);");
    expect(studio).toContain("const onEducation = pathname === EDUCATION_PATH;");
    expect(studio).toContain("const task = onEducation ? urlTask : lastTaskRef.current;");
    expect(studio).toContain('const showChooser = onEducation && (taskQuery == null || taskQuery.trim() === "");');
  });

  it("offers the four cards and no second picker", () => {
    expect(studio).toContain('data-testid="education-guide-choices"');
    expect(studio).toContain("education-guide-${id}");
    expect(studio).toContain('data-testid="education-guide-change"');
    expect(studio).not.toContain("education-tab-lesson");
    expect(studio).not.toContain("<select");
  });
});
