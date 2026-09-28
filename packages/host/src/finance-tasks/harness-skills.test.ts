import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@agentforge/core";
import {
  briefTaskModule,
  extractNumbers,
  financeTaskMeta,
  getFinanceTaskModule,
  lineItemsFromRows,
  matchesAllowed,
  readFiguresText,
  type DirectionClaim,
  type FinanceTask,
  type ReportLocale,
} from "@agentforge/core/finance";
import type { JobEvent } from "@agentforge/core/jobs";
import type { WorkCard } from "../work-cards";
import { parseAppraisalInput, type ParsedAppraisal } from "./parse-appraisal";
import { parseBudgetInput, type BudgetParseResult } from "./parse-budget";
import { parseCashflowInput, type CashflowParseResult } from "./parse-cashflow";
import { parseRatiosInput, type ParsedRatios } from "./parse-ratios";

/**
 * The two skills the harness adds, against each task's own catalog sentence.
 * The first answer is not sections, so the reading is asked for once more. The second quotes a
 * computed figure and says the opposite of its direction, so that section is rewritten once.
 * The third answer keeps the direction. Nothing here reaches the network.
 */
const asked: Array<Record<string, unknown>> = [];
const answers: string[] = [];

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

const { runFinanceTask } = await import("./runner");
const { generateFinanceBrief } = await import("../finance-generate");

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws-finance-harness",
  userId: "local",
  role: "owner",
};

const TASKS: readonly FinanceTask[] = ["brief", "cashflow", "budget", "appraisal", "ratios"];

function phrase(words: DirectionClaim["agree"], locale: ReportLocale): string {
  const word = words[0];
  if (!word) {
    throw new Error("direction claim has no phrase");
  }
  return locale === "id" ? word.id : word.en;
}

/** A spelling the number guard accepts for this computed figure. */
function quote(amount: number): string {
  const candidates = [String(Math.round(amount)), amount.toFixed(2), amount.toFixed(1), String(amount)];
  for (const text of candidates) {
    const token = extractNumbers(text)[0];
    if (!token) {
      continue;
    }
    const value = matchesAllowed(token.value, [amount]);
    const alternate = token.alternate !== undefined && matchesAllowed(token.alternate, [amount]);
    if (value || alternate) {
      return text;
    }
  }
  return String(amount);
}

async function confirmed(task: FinanceTask, locale: ReportLocale): Promise<Record<string, unknown>> {
  const figures = financeTaskMeta(task).sampleFigures[locale];
  const prompt = financeTaskMeta(task).defaultPrompt[locale];
  if (task === "brief") {
    // The catalog sentence dates only the revenue. The other amounts join that year so the
    // published operating profit — the figure this skill holds — is the sample's own numbers.
    const items = lineItemsFromRows(readFiguresText(figures).rows).items;
    const year = items.find((item) => item.period)?.period ?? "";
    const dated = year ? items.map((item) => (item.period ? item : { ...item, period: year })) : items;
    return { items: dated, prompt, locale };
  }
  if (task === "cashflow") {
    const parsed = (await parseCashflowInput(tenant, { figures })) as CashflowParseResult;
    const params = {
      ...(parsed.openingCash == null ? {} : { openingCash: parsed.openingCash }),
      ...(parsed.currency ? { currency: parsed.currency } : {}),
    };
    return { items: parsed.items, prompt, locale, ...(Object.keys(params).length > 0 ? { params } : {}) };
  }
  if (task === "budget") {
    const parsed = (await parseBudgetInput(tenant, { figures })) as BudgetParseResult;
    return { items: parsed.items, prompt, locale };
  }
  if (task === "appraisal") {
    const parsed = (await parseAppraisalInput(tenant, { figures })) as ParsedAppraisal;
    return {
      items: parsed.items,
      prompt,
      locale,
      ...(parsed.discountRatePercent == null ? {} : { params: { discountRatePercent: parsed.discountRatePercent } }),
    };
  }
  const parsed = (await parseRatiosInput(tenant, { figures })) as ParsedRatios;
  return { items: parsed.items, prompt, locale };
}

function claimsFor(task: FinanceTask, body: Record<string, unknown>): readonly DirectionClaim[] {
  const module = task === "brief" ? briefTaskModule : getFinanceTaskModule(task);
  if (!module?.directionClaims) {
    throw new Error(`${task} has no direction claims`);
  }
  return module.directionClaims(module.compute(module.inputSchema.parse(body)));
}

function narration(task: FinanceTask, locale: ReportLocale, sentence: string): string {
  if (task === "brief") {
    return JSON.stringify({
      title: "Reading",
      sections: [{ heading: "The result", body: sentence, metrics: [] }],
      assumptions: [],
    });
  }
  const module = getFinanceTaskModule(task);
  const sections = (module?.sections ?? []).map((section, index) => ({
    id: section.id,
    heading: locale === "id" ? section.title.id : section.title.en,
    body: index === 0 ? sentence : "The figures stand as computed.",
  }));
  return JSON.stringify({ title: "Reading", sections, assumptions: [] });
}

function readingOf(task: FinanceTask, result: unknown): string {
  if (task === "brief") {
    const brief = result as { brief?: { sections?: { body?: string }[] } };
    return brief.brief?.sections?.[0]?.body ?? "";
  }
  const report = result as { report?: { notes?: { body?: string }[] } };
  return report.report?.notes?.[0]?.body ?? "";
}

describe("finance harness skills", () => {
  beforeEach(() => {
    asked.length = 0;
    answers.length = 0;
    ingested.length = 0;
  });

  it.each(TASKS.flatMap((task) => (["en", "id"] as const).map((locale) => [task, locale] as const)))(
    "%s asks once more and keeps the computed direction (%s)",
    async (task, locale) => {
      const body = await confirmed(task, locale);
      const claims = claimsFor(task, body);
      const claim = claims[0];
      expect(claim, `${task} ${locale} produced no direction claim`).toBeTruthy();
      if (!claim) {
        return;
      }
      const figure = quote(claim.amount);
      const against = phrase(claim.contradict, locale);
      const withDirection = phrase(claim.agree, locale);
      const wrong = `The reading is ${against} at ${figure}.`;
      const right = `The reading is ${withDirection} at ${figure}.`;
      answers.push("not json", narration(task, locale, wrong), JSON.stringify({ heading: "The result", body: right }));
      const events: JobEvent[] = [];
      const emit = (event: JobEvent) => events.push(event);
      const module = getFinanceTaskModule(task);
      if (task !== "brief" && !module) {
        throw new Error(`${task} has no module`);
      }
      const result =
        task === "brief" || !module
          ? await generateFinanceBrief(tenant, body, emit)
          : await runFinanceTask(module, { tenant, body, emit });
      const steps = events.filter((event) => event.type === "job.step").map((event) => event.label);
      expect(asked).toHaveLength(3);
      expect(asked[2]?.runPrefix).toBe("finance-direction");
      for (const call of asked) {
        const system = String(call.systemPrompt);
        if (locale === "id") {
          expect(system).toContain("Bahasa Indonesia");
        } else {
          expect(system).toContain("Keep every number exactly as given.");
        }
      }
      expect(steps).toContain("Asked once more for the reading");
      expect(steps).toContain("Reading contradicted a computed direction");
      expect(
        steps.some((label) => label.includes("contradicted a computed direction") && label.includes("removed")),
      ).toBe(false);
      expect(readingOf(task, result)).toContain(withDirection);
    },
  );
});
