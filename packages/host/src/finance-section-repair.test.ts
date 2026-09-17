import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { UNVERIFIED_MARKER, computeFinance, type LineItem } from "@agentforge/core/finance";

/** One stubbed gateway call per retry; the queue is what each retry gets back. */
const answers: string[] = [];
const asked: Array<Record<string, unknown>> = [];

vi.mock("./job-regen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./job-regen")>();
  return {
    ...actual,
    collectJobAssistantRun: async (options: Record<string, unknown>) => {
      asked.push(options);
      return { text: answers.shift() ?? "", model: "stub-model" };
    },
  };
});

const { repairUnverifiedSections, splitSentences, stripMarkedSentences } = await import("./finance-section-repair");
const { readFinanceLocale } = await import("./finance-locale");

const tenant: TenantContext = {
  organizationId: "org",
  workspaceId: "ws-finance-repair",
  userId: "local",
  role: "owner",
};

const ITEMS: LineItem[] = [
  { label: "Pendapatan", period: "2024", amount: 1_250_000_000, currency: "IDR", category: "revenue" },
  { label: "HPP", period: "2024", amount: 730_000_000, currency: "IDR", category: "cogs" },
];
const computed = computeFinance(ITEMS, {}, { locale: "id" });

function brief(body: string) {
  return {
    title: "Ringkasan",
    sections: [{ heading: "Kinerja", body, tables: [], metrics: [] }],
    assumptions: [],
    computed: { metrics: computed.metrics, tables: computed.tables },
  };
}

const prompt = {
  tenant,
  model: "stub-model",
  systemPrompt: "system",
  factsBlock: "facts",
  locale: "id" as const,
};

describe("sentence splitting", () => {
  it("does not break a grouped figure in half", () => {
    expect(splitSentences("Pendapatan Rp 1.250.000.000 naik. Marjin tetap.")).toEqual([
      "Pendapatan Rp 1.250.000.000 naik.",
      "Marjin tetap.",
    ]);
  });

  it("takes out only the sentence that carries the marker", () => {
    const stripped = stripMarkedSentences(`Pendapatan naik. Churn ${UNVERIFIED_MARKER} persen. Marjin tetap.`);
    expect(stripped.body).toBe("Pendapatan naik. Marjin tetap.");
    expect(stripped.removed).toHaveLength(1);
    expect(stripped.body).not.toContain(UNVERIFIED_MARKER);
  });

  it("drops a paragraph that had nothing else in it", () => {
    const stripped = stripMarkedSentences(`Marjin tetap.\n\nChurn ${UNVERIFIED_MARKER} persen.`);
    expect(stripped.body).toBe("Marjin tetap.");
  });
});

describe("repairUnverifiedSections", () => {
  it("leaves a clean brief alone and asks the model nothing", async () => {
    asked.length = 0;
    const result = await repairUnverifiedSections(brief("Pendapatan Rp 1.250.000.000."), computed, prompt);
    expect(asked).toEqual([]);
    expect(result.guard).toEqual({ flagged: [], total: 0, removed: 0 });
  });

  it("asks once, and keeps the rewrite when it traces", async () => {
    asked.length = 0;
    answers.length = 0;
    answers.push(JSON.stringify({ heading: "Kinerja", body: "Marjin kotor 41,6%.", metrics: [] }));
    const result = await repairUnverifiedSections(brief(`Marjin kotor ${UNVERIFIED_MARKER}.`), computed, prompt);
    expect(asked).toHaveLength(1);
    expect(String(asked[0]?.prompt)).toContain(UNVERIFIED_MARKER);
    expect(result.brief.sections[0]?.body).toBe("Marjin kotor 41,6%.");
    expect(result.guard.removed).toBe(0);
  });

  it("removes the sentence cleanly when the rewrite invents again, and says one was removed", async () => {
    asked.length = 0;
    answers.length = 0;
    answers.push(JSON.stringify({ heading: "Kinerja", body: "Marjin kotor 41,6%. Churn 4,5%.", metrics: [] }));
    const result = await repairUnverifiedSections(brief(`Marjin kotor ${UNVERIFIED_MARKER}.`), computed, prompt);
    const body = result.brief.sections[0]?.body ?? "";
    expect(body).toBe("Marjin kotor 41,6%.");
    expect(body).not.toContain(UNVERIFIED_MARKER);
    expect(result.guard.removed).toBe(1);
    expect(result.guard.flagged).toEqual([{ section: 0, text: "4,5%" }]);
  });

  it("still strips the marker when the retry itself fails", async () => {
    asked.length = 0;
    answers.length = 0;
    answers.push("not json at all");
    const result = await repairUnverifiedSections(
      brief(`Marjin kotor ${UNVERIFIED_MARKER}. Pendapatan Rp 1.250.000.000.`),
      computed,
      prompt,
    );
    expect(result.brief.sections[0]?.body).toBe("Pendapatan Rp 1.250.000.000.");
    expect(result.guard.removed).toBe(1);
  });
});

describe("readFinanceLocale", () => {
  it("takes the locale the request asked for", () => {
    expect(readFinanceLocale({ locale: "id" })).toBe("id");
    expect(readFinanceLocale({ locale: "en" })).toBe("en");
  });

  it("falls back to the run's own locale rather than to a default", () => {
    expect(readFinanceLocale({ locale: "fr" })).toBe(readFinanceLocale({}));
    expect(readFinanceLocale(null)).toBe(readFinanceLocale({}));
  });
});
