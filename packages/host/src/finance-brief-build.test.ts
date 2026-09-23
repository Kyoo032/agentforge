import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { UNVERIFIED_MARKER, computeFinance } from "@agentforge/core/finance";
import { buildFinanceBrief, financePromptBlock, parseBriefDraft, readFinanceInputs } from "./finance-brief-build";
import { buildFinanceDocx } from "./finance-docx";
import { formatDocxCell } from "./docx-table";

const body = {
  items: [
    { label: "Sales", period: "2025", amount: 120000, currency: "USD", category: "revenue" },
    { label: "Sales", period: "2026", amount: 150000, currency: "USD", category: "revenue" },
    { label: "Hosting", period: "2025", amount: 30000, currency: "USD", category: "cogs" },
    { label: "Payroll", period: "2025", amount: 100000, currency: "USD", category: "opex" },
  ],
  params: { discountRatePercent: 10, junk: "x", fixedCosts: "no" },
};

describe("readFinanceInputs", () => {
  it("validates items and keeps only numeric known params", () => {
    const inputs = readFinanceInputs(body);
    expect(inputs?.items).toHaveLength(4);
    expect(inputs?.items[0]).toMatchObject({ label: "Sales", category: "revenue", amount: 120000 });
    expect(inputs?.params).toEqual({ discountRatePercent: 10 });
    expect(readFinanceInputs({ prompt: "x" })).toBeNull();
    expect(() => readFinanceInputs({ items: [] })).toThrow(ApiError);
    expect(() => readFinanceInputs({ items: [{ label: "x", amount: "12" }] })).toThrow(/numeric amount/);
  });
});

describe("brief draft and guard", () => {
  const inputs = readFinanceInputs(body) as NonNullable<ReturnType<typeof readFinanceInputs>>;
  const computed = computeFinance(inputs.items, inputs.params);

  it("parses the model JSON and strips figures that do not trace to inputs or metrics", () => {
    const raw = JSON.stringify({
      title: "Growth with thin cover",
      sections: [
        {
          heading: "Revenue grew 25%",
          body: "Sales rose from $120,000 to $150,000 (25%). Gross margin was 75%.",
          metrics: ["revenue_growth 2026", "gross_margin 2025", "bogus"],
        },
        { heading: "Invented", body: "Churn is 7% and the market is worth $4 billion across 12 markets.", metrics: [] },
        { heading: "", body: "dropped" },
      ],
      assumptions: ["USD throughout", ""],
    });
    const { brief, guard } = buildFinanceBrief(parseBriefDraft(raw), computed);
    expect(brief.sections).toHaveLength(2);
    expect(brief.sections[0]?.body).toBe("Sales rose from $120,000 to $150,000 (25%). Gross margin was 75%.");
    expect(brief.sections[0]?.metrics).toEqual(["revenue_growth 2026", "gross_margin 2025"]);
    expect(brief.sections[1]?.body).toBe(
      `Churn is ${UNVERIFIED_MARKER} and the market is worth ${UNVERIFIED_MARKER} across 12 markets.`,
    );
    expect(guard).toEqual({
      flagged: [
        { section: 1, text: "7%" },
        { section: 1, text: "$4 billion" },
      ],
      total: 2,
    });
    expect(brief.assumptions).toEqual(["USD throughout"]);
    expect(brief.computed.metrics.length).toBeGreaterThan(3);
    expect(() => parseBriefDraft("{}")).toThrow(/no sections/);
    expect(() => parseBriefDraft("nope")).toThrow(ApiError);
  });

  // A title, a heading and an assumption are model prose as much as a body is, and they are read first.
  it("guards the title, every heading and every assumption, and never leaves the marker in them", () => {
    const raw = JSON.stringify({
      title: "Sales jumped 48% in 2026",
      sections: [
        { heading: "Revenue grew 25% while churn hit 4.5%", body: "Gross margin was 75%.", metrics: [] },
        { heading: "Payroll", body: "Payroll was $100,000.", metrics: [] },
      ],
      assumptions: ["USD throughout.", "Headcount holds at 140 staff.", "Hosting stays at $30,000."],
    });
    const { brief, guard } = buildFinanceBrief(parseBriefDraft(raw), computed);
    expect(brief.title).toBe("Finance brief");
    expect(brief.sections.map((section) => section.heading)).toEqual(["Revenue grew 25% while churn hit", "Payroll"]);
    expect(brief.assumptions).toEqual(["USD throughout.", "Hosting stays at $30,000."]);
    expect(JSON.stringify(brief)).not.toContain(UNVERIFIED_MARKER);
    expect(guard).toEqual({
      flagged: [
        { section: -1, text: "48%" },
        { section: 0, text: "4.5%" },
        { section: -1, text: "140" },
      ],
      total: 3,
      removed: 1,
    });
  });

  it("shows the model inputs and metrics as tables, never loose numbers", () => {
    const block = financePromptBlock(inputs, computed);
    expect(block).toContain("| Sales | 2025 | revenue | 120000 | USD | $120,000 |");
    expect(block).toContain("| gross_margin 2025 | Gross margin 2025 | 75.0% |");
    expect(block).toContain("- discountRatePercent: 10");
  });

  it("hands every figure over pre-written in the reader's own language", () => {
    const block = financePromptBlock(inputs, computed, "id");
    expect(block).toContain("Tulis sebagai");
    // 120000 in an Indonesian brief is 120.000, and a margin is one decimal, never four.
    expect(block).toContain("| Sales | 2025 | revenue | 120000 | USD | $120.000 |");
    expect(block).toContain("| 75,0% |");
    expect(block).not.toMatch(/\d[.,]\d{4}%/);
  });

  it("names the metrics in the reader's language when the run asks for it", () => {
    const localised = computeFinance(inputs.items, inputs.params, { locale: "id" });
    const labels = localised.metrics.map((metric) => metric.label);
    expect(labels).toContain("Marjin kotor 2025");
    expect(labels).toContain("Beban usaha 2025");
  });

  it("builds a DOCX with tables", async () => {
    const { brief } = buildFinanceBrief(
      parseBriefDraft(
        JSON.stringify({
          title: "Cash plan",
          sections: [{ heading: "H", body: "Gross margin was 75%." }],
          assumptions: [],
        }),
      ),
      computed,
    );
    const { buffer, filename } = await buildFinanceDocx(brief, "en-US");
    expect(filename).toBe("Cash-plan.docx");
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buffer.length).toBeGreaterThan(2000);
    expect(formatDocxCell(1234567.891, "en-US")).toBe("1,234,567.89");
    expect(formatDocxCell(null)).toBe("");
    expect(formatDocxCell(true)).toBe("true");
  });
});
