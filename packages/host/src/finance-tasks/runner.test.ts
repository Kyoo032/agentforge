import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TenantContext } from "@agentforge/core";
import {
  REMOVED_SENTENCE_FLAG,
  UNVERIFIED_MARKER,
  type FinanceReport,
  type FinanceTaskModule,
} from "@agentforge/core/finance";
import type { JobEvent } from "@agentforge/core/jobs";
import type { WorkCard } from "../work-cards";

/**
 * The whole pipeline with the gateway replaced by a queue: one answer per call, in order — the
 * narration first, then whatever the repair asks for. Nothing here reaches the network, and the
 * gate is stubbed because this test is about the pipeline, not about who is allowed to run it.
 */
const answers: string[] = [];
const asked: Array<Record<string, unknown>> = [];

vi.mock("../job-regen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../job-regen")>();
  return {
    ...actual,
    collectJobAssistantRun: async (options: Record<string, unknown>) => {
      asked.push(options);
      return { text: answers.shift() ?? "", model: "stub-model" };
    },
  };
});

vi.mock("./live", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./live")>();
  return { ...actual, requireLive: () => ({}), resolveModel: () => "stub-model" };
});

vi.mock("../knowledge-ingest", () => ({
  upsertWorkSource: async (_tenant: TenantContext, card: WorkCard) => {
    ingested.push(card);
    return { status: "skipped" as const, reason: "test" };
  },
  ingestWorkSource: () => {},
}));

const ingested: WorkCard[] = [];

const { runFinanceTask, runnerMathPhases } = await import("./runner");
const { readStoredFinanceReport } = await import("./persist");
const { artifactStore } = await import("../artifacts");

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws-finance-runner",
  userId: "local",
  role: "owner",
};

type Input = { readonly cash: number };

/**
 * A stand-in for a real task: it computes one figure, declares one section, and writes the model's
 * prose straight into the report's notes — which is what makes a marker that survived visible.
 */
const taskModule: FinanceTaskModule<Input, Input> = {
  id: "cashflow",
  inputSchema: z.object({ cash: z.number() }),
  compute: (input) => input,
  buildReport: (computed, prose, options): FinanceReport => ({
    task: "cashflow",
    title: prose.title,
    locale: options?.locale ?? "en",
    summary: [{ label: "Cash", value: computed.cash, unit: "IDR" }],
    tables: [],
    charts: [],
    flags: [],
    notes: prose.sections.map((section) => ({ heading: section.heading, body: section.body })),
  }),
  promptFacts: (computed) => `Cash: ${computed.cash}`,
  allowedNumbers: (_input, computed) => [computed.cash],
  sections: [{ id: "position", title: { id: "Posisi", en: "Position" } }],
};

function narration(body: string): string {
  return JSON.stringify({
    title: "Runway to March",
    sections: [{ id: "position", heading: "Where cash sits", body }],
    assumptions: ["Monthly figures."],
  });
}

function rewrite(body: string): string {
  return JSON.stringify({ heading: "Where cash sits", body, metrics: [] });
}

function body(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { prompt: "How is cash?", cash: 900, locale: "en", ...extra };
}

async function run(extra: Record<string, unknown> = {}) {
  const events: JobEvent[] = [];
  const result = await runFinanceTask(taskModule, {
    tenant,
    body: body(extra),
    emit: (event) => events.push(event),
  });
  return { result, events };
}

function phases(events: readonly JobEvent[]): string[] {
  return events.filter((event) => event.type === "job.phase").map((event) => event.phase);
}

function steps(events: readonly JobEvent[]): string[] {
  return events.filter((event) => event.type === "job.step").map((event) => event.label);
}

function reset() {
  asked.length = 0;
  answers.length = 0;
  ingested.length = 0;
}

describe("runnerMathPhases", () => {
  it("names the math steps this run performs, in the task's own order", () => {
    // Everything up to the task's last shared step ran on the parse route, not here.
    expect(runnerMathPhases("cashflow")).toEqual(["runway-math"]);
    expect(runnerMathPhases("budget")).toEqual(["variance-math", "flag-over-limit"]);
    expect(runnerMathPhases("appraisal")).toEqual(["appraisal-math", "sensitivity-grid"]);
    expect(runnerMathPhases("ratios")).toEqual(["ratio-math", "bands-vs-thresholds"]);
    expect(runnerMathPhases("brief")).toEqual(["core-metrics"]);
  });
});

describe("runFinanceTask", () => {
  it("walks the task's own phases in order and says nothing about a repair that did not happen", async () => {
    reset();
    answers.push(narration("Cash was 900."));
    const { result, events } = await run();
    expect(phases(events)).toEqual(["runway-math", "narrate-guard-export"]);
    expect(steps(events)).toEqual(["1 figure(s) computed in code", "All figures trace to inputs"]);
    expect(asked).toHaveLength(1);
    expect(result.guard).toEqual({ flagged: [], total: 0, removed: 0 });
    expect(result.warnings).toBeUndefined();
  });

  it("repairs a blanked figure, emits a step only then, and ships no marker anywhere", async () => {
    reset();
    answers.push(narration("Cash was 900. Burn was 1234 a month."));
    answers.push(rewrite("Cash was 900."));
    const { result, events } = await run();
    expect(asked).toHaveLength(2);
    expect(String(asked[1]?.prompt)).toContain("Cash: 900");
    expect(steps(events)).toEqual([
      "1 figure(s) computed in code",
      "1 unverified figure(s) removed",
      "0 sentence(s) removed after one rewrite",
    ]);
    expect(JSON.stringify(result.report)).not.toContain(UNVERIFIED_MARKER);
    expect(result.markdown).not.toContain(UNVERIFIED_MARKER);
    expect(result.report.notes[0]?.body).toBe("Cash was 900.");
  });

  it("removes the sentence, flags it for the reader and warns the desk when the rewrite invents again", async () => {
    reset();
    answers.push(narration("Cash held steady. Burn was 1234 a month."));
    answers.push(rewrite("Cash held steady. Burn was 4321 a month."));
    const { result, events } = await run({ locale: "id" });
    expect(JSON.stringify(result.report)).not.toContain(UNVERIFIED_MARKER);
    expect(result.markdown).not.toContain(UNVERIFIED_MARKER);
    expect(result.report.flags).toContainEqual({ level: "watch", text: REMOVED_SENTENCE_FLAG.id });
    expect(result.guard.removed).toBe(1);
    expect(steps(events)).toContain("1 sentence(s) removed after one rewrite");
    expect(result.warnings).toEqual([
      "2 figure(s) did not trace to the computed facts and were taken out",
      "1 sentence(s) were removed because their figure could not be traced",
    ]);
  });

  it("saves the task, the model and the locale beside the report, so an export by id is full fidelity", async () => {
    reset();
    answers.push(narration("Cash was 900."));
    const { result } = await run();
    expect(result.artifactId).toBeTruthy();
    const artifact = artifactStore().get(tenant, String(result.artifactId));
    expect(artifact?.meta?.task).toBe("cashflow");
    expect(artifact?.meta?.model).toBe("stub-model");
    expect(artifact?.meta?.locale).toBe("en");
    expect(readStoredFinanceReport(artifact?.meta)).toEqual(result.report);
  });
});
