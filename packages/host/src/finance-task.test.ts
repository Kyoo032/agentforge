import { ApiError } from "@agentforge/core";
import { FINANCE_TASKS, financeTaskAvailable } from "@agentforge/core/finance";
import { describe, expect, it } from "vitest";
import {
  financeTaskUnavailableMessage,
  readFinanceTask,
  requireFinanceTask,
  withFinanceTaskRules,
} from "./finance-task";

describe("readFinanceTask", () => {
  it("reads a known task off the request body", () => {
    for (const task of FINANCE_TASKS) {
      expect(readFinanceTask({ task })).toBe(task);
    }
  });

  it("falls back to the brief for a missing, unknown or malformed value", () => {
    for (const body of [{}, null, undefined, "brief", { task: "" }, { task: "docx" }, { task: 3 }, { task: {} }]) {
      expect(readFinanceTask(body)).toBe("brief");
    }
  });
});

describe("requireFinanceTask", () => {
  it("lets the brief through, with or without the field", () => {
    expect(requireFinanceTask({})).toBe("brief");
    expect(requireFinanceTask({ task: "brief" })).toBe("brief");
    expect(requireFinanceTask({ task: "not-a-task" })).toBe("brief");
  });

  // A task ships the day its own flow is built; until then the boundary refuses it outright.
  it("refuses a task that is not built yet with a 400 naming the field", () => {
    for (const task of FINANCE_TASKS.filter((id) => !financeTaskAvailable(id))) {
      let thrown: unknown;
      try {
        requireFinanceTask({ task });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, task).toBeInstanceOf(ApiError);
      const error = thrown as ApiError;
      expect(error.status).toBe(400);
      expect(error.code).toBe("finance_task_unavailable");
      expect(error.message).toMatch(/task/i);
    }
  });

  it("names the task the reader asked for, in their language", () => {
    expect(financeTaskUnavailableMessage("cashflow", "en")).toContain("Cash flow & runway");
    expect(financeTaskUnavailableMessage("cashflow", "id")).toContain("Arus Kas & Runway");
  });
});

describe("withFinanceTaskRules", () => {
  it("leaves the brief's system prompt byte-identical", () => {
    const base = "You write a finished finance brief.\nRules:\n- Only computed numbers.";
    for (const locale of ["id", "en"] as const) {
      expect(withFinanceTaskRules(base, "brief", locale)).toBe(base);
    }
  });

  it("appends the task's own bullets for every other task", () => {
    const base = "BASE";
    for (const task of FINANCE_TASKS.filter((id) => id !== "brief")) {
      for (const locale of ["id", "en"] as const) {
        const prompt = withFinanceTaskRules(base, task, locale);
        expect(prompt.startsWith(`${base}\n- `), `${task}/${locale}`).toBe(true);
      }
    }
  });

  it("keeps the two languages apart", () => {
    expect(withFinanceTaskRules("BASE", "cashflow", "id")).not.toBe(withFinanceTaskRules("BASE", "cashflow", "en"));
  });
});
