import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINANCE_IMPORT_EXTENSIONS,
  FINANCE_IMPORT_MAX_BYTES as CORE_MAX_BYTES,
  FINANCE_IMPORT_MAX_SHEETS as CORE_MAX_SHEETS,
} from "@agentforge/core/finance";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock("./api-client", () => ({ apiFetch }));

import {
  FINANCE_IMPORT_ACCEPT,
  FINANCE_IMPORT_MAX_BYTES,
  FINANCE_IMPORT_MAX_SHEETS,
  financeImportFileAllowed,
  importFinanceFile,
  parseFinanceImport,
} from "./finance-import-client";

const PAYLOAD = {
  sheets: [
    {
      name: "Summary",
      rowCount: 3,
      preview: [
        ["Label", "Amount"],
        ["Revenue", "120000"],
      ],
    },
    { name: "Budget", rowCount: 2, preview: [["Label", "Plan"]] },
  ],
  sheet: "Summary",
  figuresText: "Sheet: Summary\nRevenue: 120000",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function file(name: string, size = 10): File {
  const blob = new File([new Uint8Array(size)], name, { type: "text/csv" });
  return blob;
}

beforeEach(() => {
  apiFetch.mockReset();
});

/**
 * The caps are the host's, not a copy of them.
 *
 * A restated `12` against the host's `30` is how a document with thirteen tables lost the rest
 * without anyone being told, so this pins both halves: the values must be the core ones, and the
 * module must not hold a number that could drift away from them again.
 */
describe("import caps", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "finance-import-client.ts"), "utf8");

  it("takes the sheet and byte caps from core rather than restating them", () => {
    expect(FINANCE_IMPORT_MAX_SHEETS).toBe(CORE_MAX_SHEETS);
    expect(FINANCE_IMPORT_MAX_BYTES).toBe(CORE_MAX_BYTES);
    expect(source).toContain('from "@agentforge/core/finance"');
    expect(source).not.toMatch(/FINANCE_IMPORT_MAX_(?:SHEETS|BYTES)\s*[:=]\s*[\d_]/);
  });

  it("offers every spreadsheet extension core reads, plus the documents the host converts", () => {
    for (const extension of FINANCE_IMPORT_EXTENSIONS) {
      expect(FINANCE_IMPORT_ACCEPT.split(","), extension).toContain(extension);
    }
  });
});

describe("financeImportFileAllowed", () => {
  it("takes the three spreadsheet extensions, the three document ones, and nothing else", () => {
    expect(FINANCE_IMPORT_ACCEPT).toBe(".csv,.xlsx,.xls,.pdf,.docx,.pptx");
    expect(financeImportFileAllowed("Q3.CSV")).toBe(true);
    expect(financeImportFileAllowed("book.xlsx")).toBe(true);
    expect(financeImportFileAllowed("old.xls")).toBe(true);
    expect(financeImportFileAllowed("laporan.pdf")).toBe(true);
    expect(financeImportFileAllowed("laporan.DOCX")).toBe(true);
    expect(financeImportFileAllowed("deck.pptx")).toBe(true);
    expect(financeImportFileAllowed("photo.png")).toBe(false);
    expect(financeImportFileAllowed("figures.csv.exe")).toBe(false);
  });
});

describe("parseFinanceImport", () => {
  it("reads a well-formed payload and refuses a half-formed one", () => {
    expect(parseFinanceImport(PAYLOAD)?.sheet).toBe("Summary");
    expect(parseFinanceImport({ ...PAYLOAD, sheet: undefined })?.sheet).toBe("Summary");
    expect(parseFinanceImport({ sheets: [], figuresText: "x" })).toBeNull();
    expect(parseFinanceImport({ sheets: PAYLOAD.sheets })).toBeNull();
    expect(parseFinanceImport(null)).toBeNull();
  });

  it("carries the reader's warnings and what the guard hid", () => {
    const parsed = parseFinanceImport({
      ...PAYLOAD,
      warnings: [{ code: "dropped_columns", message: "3 columns were not imported", detail: ["No", "NPWP", "Bank"] }],
      pii: { count: 51, kinds: ["name", "nik"], samples: ["Karyawan 1"] },
    });
    expect(parsed?.warnings.map((warning) => warning.code)).toEqual(["dropped_columns"]);
    expect(parsed?.warnings[0]?.detail).toEqual(["No", "NPWP", "Bank"]);
    expect(parsed?.pii).toEqual({ count: 51, kinds: ["name", "nik"] });
  });

  it("reads an answer without either field as nothing to report", () => {
    const parsed = parseFinanceImport(PAYLOAD);
    expect(parsed?.warnings).toEqual([]);
    expect(parsed?.pii.count).toBe(0);
  });

  it("coerces preview cells to strings instead of trusting the wire", () => {
    const parsed = parseFinanceImport({
      sheets: [{ name: "S", rowCount: 1, preview: [[1, null, "x"]] }],
      figuresText: "x",
    });
    expect(parsed?.sheets[0]?.preview[0]).toEqual(["1", "", "x"]);
  });
});

describe("importFinanceFile", () => {
  it("posts the file as multipart and returns the parsed result", async () => {
    apiFetch.mockResolvedValue(jsonResponse(PAYLOAD));
    const result = await importFinanceFile(file("Q3.csv"));
    expect(result.figuresText).toContain("Revenue: 120000");
    const [path, init] = apiFetch.mock.calls[0] ?? [];
    expect(path).toBe("/api/v1/finance/import");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it("names the sheet in the query string when one is asked for", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ ...PAYLOAD, sheet: "Budget" }));
    const result = await importFinanceFile(file("book.xlsx"), "Budget");
    expect(result.sheet).toBe("Budget");
    expect(apiFetch.mock.calls[0]?.[0]).toBe("/api/v1/finance/import?sheet=Budget");
  });

  it("refuses the wrong extension and an oversized file before any request", async () => {
    await expect(importFinanceFile(file("photo.png"))).rejects.toThrow();
    await expect(importFinanceFile(file("big.csv", FINANCE_IMPORT_MAX_BYTES + 1))).rejects.toThrow();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("surfaces the host's own message on failure", async () => {
    apiFetch.mockResolvedValue(
      jsonResponse({ error: { code: "invalid_request", message: "That sheet is not in this file" } }, 400),
    );
    await expect(importFinanceFile(file("book.xlsx"), "Nope")).rejects.toThrow("That sheet is not in this file");
  });

  it("treats a malformed answer as unreadable rather than half a result", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ sheets: [] }));
    await expect(importFinanceFile(file("Q3.csv"))).rejects.toThrow();
  });
});
