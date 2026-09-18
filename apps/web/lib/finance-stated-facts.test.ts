import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock("./api-client", () => ({ apiFetch }));

import { parseFinanceFigures, usableStatedFacts, type StatedFact } from "./finance-client";
import { financeImportIsDocument, importFinanceFileAllSheets, parseFinanceImport } from "./finance-import-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function source(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

function fact(patch: Partial<StatedFact> = {}): StatedFact {
  return { id: "S1#1", label: "Karyawan tetap", sentence: "…148 karyawan tetap", value: 148, unit: "count", currency: "", ...patch };
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("parseFinanceFigures", () => {
  it("sends the document's prose and reads the figures its sentences state", async () => {
    apiFetch.mockResolvedValue(
      jsonResponse({
        items: [{ label: "Pendapatan usaha", period: "2024", amount: 21_965_000_000, currency: "IDR", category: "revenue" }],
        proseFacts: [
          { id: "S9#2", label: "", sentence: "Perseroan mempekerjakan 148 karyawan tetap.", value: 148, unit: "count", currency: "" },
          { id: "S22#3", label: "", sentence: "Rasio lancar tercatat 1,84 kali.", value: 1.84, unit: "ratio", currency: "" },
        ],
      }),
    );
    const parsed = await parseFinanceFigures("Pendapatan usaha | 2024 | 21965000000", {
      task: "brief",
      proseText: "Perseroan mempekerjakan 148 karyawan tetap.",
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.statedFacts.map((entry) => entry.value)).toEqual([148, 1.84]);
    expect(parsed.statedFacts[1]?.unit).toBe("ratio");
    const body = JSON.parse(String(apiFetch.mock.calls[0]?.[1]?.body ?? "{}"));
    expect(body.proseText).toBe("Perseroan mempekerjakan 148 karyawan tetap.");
  });

  it("leaves out a fact with no figure rather than reading it as a zero", async () => {
    apiFetch.mockResolvedValue(
      jsonResponse({ items: [], proseFacts: [{ id: "S1#1", sentence: "no number here", unit: "count" }] }),
    );
    expect((await parseFinanceFigures("x")).statedFacts).toEqual([]);
  });

  it("sends no proseText at all when there is none", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ items: [] }));
    await parseFinanceFigures("x", { proseText: "   " });
    expect(JSON.parse(String(apiFetch.mock.calls[0]?.[1]?.body ?? "{}")).proseText).toBeUndefined();
  });
});

describe("usableStatedFacts", () => {
  it("keeps a fact the owner can recognise and drops one that names nothing", () => {
    expect(usableStatedFacts([fact(), fact({ label: "", sentence: "" })])).toHaveLength(1);
    expect(usableStatedFacts([fact({ label: "", sentence: "a sentence" })])).toHaveLength(1);
  });
});

describe("a document is read whole", () => {
  it("knows which uploads are documents", () => {
    expect(financeImportIsDocument("laporan.docx")).toBe(true);
    expect(financeImportIsDocument("laporan.PDF")).toBe(true);
    expect(financeImportIsDocument("gaji.xlsx")).toBe(false);
  });

  it("merges every table of the file instead of keeping one and dropping the rest", async () => {
    const sheets = [
      { name: "Laba Rugi", rowCount: 12, preview: [] },
      { name: "Posisi Kas", rowCount: 6, preview: [] },
    ];
    apiFetch
      .mockResolvedValueOnce(
        jsonResponse({ sheets, sheet: "Laba Rugi", figuresText: "Sheet: Laba Rugi\nPendapatan | 1", proseText: "prose" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ sheets, sheet: "Posisi Kas", figuresText: "Sheet: Posisi Kas\nKas | 2", proseText: "prose" }),
      );
    const result = await importFinanceFileAllSheets(new File([new Uint8Array(10)], "laporan.docx"));
    expect(result.figuresText).toBe("Sheet: Laba Rugi\nPendapatan | 1\nSheet: Posisi Kas\nKas | 2");
    expect(result.proseText).toBe("prose");
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("carries the prose back, and reads its absence as an empty string", () => {
    const base = { sheets: [{ name: "S", rowCount: 1, preview: [] }], sheet: "S", figuresText: "x" };
    expect(parseFinanceImport({ ...base, proseText: "a sentence" })?.proseText).toBe("a sentence");
    expect(parseFinanceImport(base)?.proseText).toBe("");
  });
});

describe("the stated facts reach the brief", () => {
  it("lists them for confirmation, with the sentence and no box to change the figure in", () => {
    const list = source("components/finance-steps/brief/stated-facts-list.tsx");
    expect(list).toContain('data-testid="finance-stated-fact-sentence"');
    expect(list).toContain('data-testid="finance-stated-fact-remove"');
    // The label is editable; the value is rendered, never typed into.
    expect(list).toContain('data-testid="finance-stated-fact-label"');
    expect(list).not.toContain('type="number"');
  });

  it("sends them with the brief, and never adds them to the line items", () => {
    const step = source("components/finance-steps/brief/index.tsx");
    expect(step).toContain("usableStatedFacts(state.statedFacts)");
    expect(step).toContain("statedFacts: facts");
    expect(source("components/finance-studio.tsx")).toContain("briefInputsBody(briefState)");
  });
});
