import { describe, expect, it } from "vitest";
import { financeBriefToMarkdown, type FinanceBrief } from "@agentforge/core/artifacts";
import type { FinanceReport } from "@agentforge/core/finance";
import type { HostRequest, HostResult } from "../types";
import { artifactStore } from "../artifacts";
import { financeArtifactMeta } from "../finance-artifact";
import { financeTaskArtifactMeta, financeTaskProvenance, persistFinanceTaskReport } from "../finance-tasks/persist";
import { REPORT_MIME } from "../renderers/types";
import { PDF_UNAVAILABLE_CODE } from "../renderers/registry";
import { getTenant } from "../tenant";
import { handlePostFinanceExport } from "./finance-export";

const brief: FinanceBrief = {
  title: "Margins held while cash thinned",
  sections: [{ heading: "Revenue grew", body: "Revenue reached 1200 in 2026.", tables: [], metrics: [] }],
  assumptions: ["Figures are unaudited."],
  computed: {
    metrics: [
      { key: "revenue 2026", label: "Revenue 2026", value: 1200, unit: "IDR", period: "2026", formula: "sum(revenue)" },
      { key: "runway", label: "Runway", value: 3, unit: "months", period: "", formula: "cash / burn" },
    ],
    tables: [
      {
        name: "Line items",
        columns: ["Label", "Period", "Category", "Amount", "Currency"],
        rows: [["Sales", "2026", "revenue", 1200, "IDR"]],
      },
    ],
  },
};

/** What a task run saves: no brief behind it, the format-neutral report on the meta instead. */
const REPORT: FinanceReport = {
  task: "cashflow",
  title: "Runway to March",
  locale: "id",
  currency: "IDR",
  summary: [{ label: "Runway", value: 7.5, unit: "months", flag: "watch" }],
  tables: [{ id: "inputs", title: "Periode", columns: ["Periode", "Masuk"], rows: [["Jan", 200]] }],
  charts: [{ id: "cash", title: "Kas", kind: "line", categories: ["Jan"], series: [{ name: "Kas", values: [900] }] }],
  flags: [{ level: "watch", text: "Runway di bawah 12 bulan" }],
  notes: [{ heading: "Posisi kas", body: "Kas tersisa 900." }],
};

function request(body: unknown): HostRequest {
  return { method: "POST", path: "/api/v1/finance/export", query: {}, params: {}, headers: {}, body };
}

/** A saved brief, exactly as the generate writes one: markdown body, provenance on the meta. */
async function saveBrief(meta: Record<string, unknown>): Promise<string> {
  const tenant = await getTenant();
  return artifactStore().create(tenant, {
    mode: "finance",
    kind: "brief",
    title: brief.title,
    mime: "text/markdown",
    body: financeBriefToMarkdown(brief),
    meta,
  }).id;
}

function text(result: HostResult): string {
  if (result.type !== "bytes") {
    throw new Error(`expected bytes, got ${result.type}`);
  }
  return Buffer.from(result.bytes).toString("utf8");
}

function json(result: HostResult): { status: number; code: string } {
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return { status: result.status, code: (result.body as { error?: { code?: string } })?.error?.code ?? "" };
}

describe("handlePostFinanceExport", () => {
  it("defaults to a workbook when no format is named", async () => {
    const result = await handlePostFinanceExport(request({ result: { brief, guard: { flagged: [], total: 0 } } }));
    expect(result.type).toBe("bytes");
    if (result.type !== "bytes") {
      return;
    }
    expect(result.status).toBe(200);
    expect(result.contentType).toBe(REPORT_MIME.xlsx);
    expect(result.filename).toBe("Margins-held-while-cash-thinned.xlsx");
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it("renders the deck, the document and the markdown on request", async () => {
    for (const format of ["pptx", "docx", "md"] as const) {
      const result = await handlePostFinanceExport(request({ brief, format }));
      expect(result.type).toBe("bytes");
      if (result.type !== "bytes") {
        return;
      }
      expect(result.contentType).toBe(REPORT_MIME[format]);
      expect(String(result.filename).endsWith(`.${format}`)).toBe(true);
    }
  });

  it("rejects a format the registry does not know with 400 and no internals", async () => {
    const result = await handlePostFinanceExport(request({ brief, format: "csv" }));
    expect(json(result)).toEqual({ status: 400, code: "invalid_request" });
  });

  it("answers a PDF request with the typed not-available error", async () => {
    const result = await handlePostFinanceExport(request({ brief, format: "pdf" }));
    expect(json(result)).toEqual({ status: 501, code: PDF_UNAVAILABLE_CODE });
  });

  it("rejects a request that carries neither a result nor an artifact id", async () => {
    expect(json(await handlePostFinanceExport(request({})))).toEqual({ status: 400, code: "invalid_request" });
    expect(json(await handlePostFinanceExport(request(null)))).toEqual({ status: 400, code: "invalid_request" });
  });

  it("rejects a malformed brief before anything is rendered", async () => {
    expect(json(await handlePostFinanceExport(request({ brief: { nope: true } })))).toEqual({
      status: 400,
      code: "invalid_request",
    });
  });

  it("exports a saved brief from the structure the generate stored, not from its prose", async () => {
    const artifactId = await saveBrief(financeArtifactMeta({ task: "brief" }, brief, { flagged: [], total: 0 }));
    const markdown = text(await handlePostFinanceExport(request({ artifactId, format: "md" })));
    // The KPI block and the computed sheets only exist when the report was built from the brief.
    expect(markdown).toContain("| Metric | Value | Unit | Status |");
    expect(markdown).toContain("### Line items");
    expect(markdown).toContain("Revenue reached 1200 in 2026.");
  });

  it("hands the stored brief to the renderers, so a workbook still comes out of an id alone", async () => {
    const artifactId = await saveBrief(financeArtifactMeta({ task: "brief" }, brief, { flagged: [], total: 0 }));
    const result = await handlePostFinanceExport(request({ artifactId }));
    expect(result.type).toBe("bytes");
    if (result.type !== "bytes") {
      return;
    }
    expect(result.contentType).toBe(REPORT_MIME.xlsx);
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it("falls back to the markdown for a brief saved before the structure was stored", async () => {
    const artifactId = await saveBrief({ question: "How did Q3 go?", model: "gpt" });
    const markdown = text(await handlePostFinanceExport(request({ artifactId, format: "md" })));
    expect(markdown).not.toContain("| Metric | Value | Unit | Status |");
    expect(markdown).toContain("Revenue reached 1200 in 2026.");
  });

  it("exports a task's saved report from the artifact alone, tables, charts and flags included", async () => {
    // A task has no FinanceBrief behind it, so the artifact's stored report is the only thing an
    // export by id can rebuild from. Losing it turns a workbook back into prose.
    const tenant = await getTenant();
    const artifactId = persistFinanceTaskReport(
      tenant,
      REPORT,
      "# Runway to March\n\nKas tersisa 900.\n",
      financeTaskArtifactMeta(
        financeTaskProvenance({ task: "cashflow", model: "stub-model", locale: "id", question: "Bagaimana kas?" }),
        REPORT,
        { flagged: [], total: 0 },
      ),
    );
    expect(artifactId).toBeTruthy();
    const markdown = text(await handlePostFinanceExport(request({ artifactId: String(artifactId), format: "md" })));
    expect(markdown).toContain("# Runway to March");
    expect(markdown).toContain("| Metric | Value | Unit | Status |");
    expect(markdown).toContain("### Periode");
    expect(markdown).toContain("### Kas");
    expect(markdown).toContain("Runway di bawah 12 bulan");
  });

  it("hands that same stored report to the workbook renderer, not the markdown fallback", async () => {
    const tenant = await getTenant();
    const artifactId = persistFinanceTaskReport(
      tenant,
      REPORT,
      "# Runway to March\n",
      financeTaskArtifactMeta(financeTaskProvenance({ task: "cashflow", model: "stub-model", locale: "id" }), REPORT, {
        flagged: [],
        total: 0,
      }),
    );
    const result = await handlePostFinanceExport(request({ artifactId: String(artifactId) }));
    expect(result.type).toBe("bytes");
    if (result.type !== "bytes") {
      return;
    }
    expect(result.contentType).toBe(REPORT_MIME.xlsx);
    expect(result.filename).toBe("Runway-to-March.xlsx");
  });

  it("reports an artifact id that is not in this workspace as not found", async () => {
    const result = await handlePostFinanceExport(request({ artifactId: "missing-artifact", format: "md" }));
    expect(json(result)).toEqual({ status: 404, code: "not_found" });
  });
});
