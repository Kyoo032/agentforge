import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { ensureSchema } from "@agentforge/db/ensure-schema";
import { datasetBrief } from "./data-generate";
import { DATA_SKILL_IDS, runDataHarness } from "./data-harness";
import { createDatasetStore, type LoadedDataset } from "./datasets";

/**
 * Stub runtime: the gateway is not called. Each skill runs against a real sheet and a stand-in answer.
 * `AGENTFORGE_RUNTIME` is already `stub` from the host test setup.
 */
const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws-data-harness",
  userId: "local",
  role: "owner",
};

const CSV = "vendor,spend,month,note\nAcme,12000,2024-01-01,ok\nAcme,3000,2024-02-01,\nBeta,4100,2024-01-01,ok\n";

const CLEAN = JSON.stringify({
  title: "Acme leads",
  summary: "Acme is ahead of Beta.",
  findings: [{ heading: "Acme leads", body: "Acme total = 15000.", sql: null }],
  charts: [],
});

const INVENTED = JSON.stringify({
  title: "Almost everything",
  summary: "The share is 99.",
  findings: [{ heading: "A made-up share", body: "Acme is 99 percent.", sql: null }],
  charts: [],
});

const db = new Database(":memory:");
ensureSchema(db);
const dir = mkdtempSync(join(tmpdir(), "af-data-harness-"));
const store = createDatasetStore(db, dir);

describe("data harness skills on stub", () => {
  let dataset: LoadedDataset | undefined;

  afterEach(async () => {
    if (dataset) {
      dataset.db.close();
      await dataset.runner.close();
    }
  });

  it("runs all five skills, including a follow-up on the same sheet", async () => {
    expect(process.env.AGENTFORGE_RUNTIME).toBe("stub");
    const sheet = store.create(tenant, { name: "Spend", filename: "spend.csv", bytes: Buffer.from(CSV) });
    dataset = sheet;
    const prompts: string[] = [];
    const result = await runDataHarness({
      dataset: sheet,
      question: "What is going on here?",
      history: [{ question: "Who spends most?", summary: "Acme." }],
      extra: null,
      brief: datasetBrief(sheet).text,
      locale: "en",
      query: (sql) => sheet.runner.query(sql),
      answer: async (prompt) => {
        prompts.push(prompt);
        return { text: CLEAN, model: "stub-model" };
      },
    });

    expect(result.skills).toEqual([...DATA_SKILL_IDS]);
    expect(result.cuts.map((cut) => cut.kind)).toEqual(["compare", "over_time", "blanks"]);
    expect(result.retried).toBe(false);
    expect(result.model).toBe("stub-model");
    expect(prompts[0]).toContain("Earlier questions on this dataset:");
    expect(prompts[0]).toContain("Who spends most?");
    expect(prompts[0]).toContain("vendor");
    expect(result.analysis.findings[0]?.body).toContain("15000");
    expect(result.analysis.findings[0]?.body).not.toContain("99");
    expect(result.analysis.charts.some((chart) => chart.type === "bar")).toBe(true);
    const compare = result.analysis.charts.find((chart) => chart.type === "bar");
    expect(compare?.series[0]?.values).toContain(15000);
  });

  it("retries once when a sentence invents a number, then keeps the grounded wording", async () => {
    const sheet = store.create(tenant, { name: "Spend", filename: "spend.csv", bytes: Buffer.from(CSV) });
    dataset = sheet;
    const texts = [INVENTED, CLEAN];
    const result = await runDataHarness({
      dataset: sheet,
      question: "What is going on here?",
      history: [],
      extra: null,
      brief: datasetBrief(sheet).text,
      locale: "en",
      query: (sql) => sheet.runner.query(sql),
      answer: async () => ({ text: texts.shift() ?? CLEAN, model: "stub-model" }),
    });
    expect(result.retried).toBe(true);
    expect(result.skills).toContain("hold-sentence");
    expect(result.skills).toContain("run-cuts");
    expect(result.skills).toContain("pick-cuts");
    expect(result.analysis.summary).not.toContain("99");
    expect(result.analysis.findings.some((finding) => finding.body.includes("15000"))).toBe(true);
    expect(texts).toEqual([]);
  });

  it("drops an invented figure after the retry and reports the query result", async () => {
    const sheet = store.create(tenant, { name: "Spend", filename: "spend.csv", bytes: Buffer.from(CSV) });
    dataset = sheet;
    const result = await runDataHarness({
      dataset: sheet,
      question: "Forecast vendor spend",
      history: [],
      extra: null,
      brief: "sheet",
      locale: "id",
      query: (sql) => sheet.runner.query(sql),
      answer: async () => ({ text: INVENTED, model: "stub-model" }),
    });
    expect(result.retried).toBe(true);
    expect(result.analysis.summary).toContain("tidak bisa meramalkan");
    expect(JSON.stringify(result.analysis)).not.toContain("99");
    expect(result.analysis.findings.some((finding) => finding.heading.includes("menurut"))).toBe(true);
    expect(result.analysis.findings.some((finding) => finding.body.includes("15000"))).toBe(true);
    expect(result.analysis.findings.every((finding) => finding.evidence?.sql.includes("SELECT"))).toBe(true);
  });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
