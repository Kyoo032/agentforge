import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FinanceBrief } from "@agentforge/core/artifacts";
import {
  DEFAULT_FINANCE_EXPORT_FORMAT,
  FINANCE_EXPORT_ENDPOINT,
  FINANCE_EXPORT_FALLBACK_NAME,
  FINANCE_EXPORT_FORMATS,
  downloadFinanceExport,
  filenameFromDisposition,
  financeExportBody,
  financeExportKey,
  isFinanceExportFormat,
  loadFinanceExportFormat,
  saveFinanceExportFormat,
} from "@/lib/finance-export";

const apiFetch = vi.hoisted(() => vi.fn());
const saveBlob = vi.hoisted(() => vi.fn());
const isElectron = vi.hoisted(() => vi.fn(() => false));

vi.mock("@/lib/api-client", () => ({ apiFetch, isElectron }));
vi.mock("@/lib/artifacts-client", () => ({ saveBlob }));

const brief: FinanceBrief = {
  title: "Q3",
  sections: [{ heading: "TL;DR", body: "Flat.", tables: [], metrics: [] }],
  assumptions: [],
  computed: { metrics: [], tables: [] },
};

function store(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    read: () => Object.fromEntries(map),
  };
}

describe("finance export formats", () => {
  it("offers the workbook, the deck and the document, and nothing else", () => {
    expect(FINANCE_EXPORT_FORMATS).toEqual(["xlsx", "pptx", "docx"]);
    expect(DEFAULT_FINANCE_EXPORT_FORMAT).toBe("xlsx");
    expect(isFinanceExportFormat("pdf")).toBe(false);
    expect(isFinanceExportFormat(null)).toBe(false);
  });

  it("keys the remembered choice by desk and falls back to a home scope", () => {
    expect(financeExportKey("ws-1")).toBe("agentforge-finance-export-format:ws-1");
    expect(financeExportKey("  ")).toBe("agentforge-finance-export-format:home");
    expect(financeExportKey(null)).toBe("agentforge-finance-export-format:home");
  });

  it("remembers one desk's choice without touching another's", () => {
    const disk = store();
    saveFinanceExportFormat("ws-1", "pptx", disk);
    expect(loadFinanceExportFormat("ws-1", disk)).toBe("pptx");
    expect(loadFinanceExportFormat("ws-2", disk)).toBe(DEFAULT_FINANCE_EXPORT_FORMAT);
  });

  it("ignores a hand-edited or unknown stored value", () => {
    const disk = store({ "agentforge-finance-export-format:ws-1": "csv" });
    expect(loadFinanceExportFormat("ws-1", disk)).toBe(DEFAULT_FINANCE_EXPORT_FORMAT);
    saveFinanceExportFormat("ws-1", "csv" as never, disk);
    expect(disk.read()["agentforge-finance-export-format:ws-1"]).toBe("csv");
  });

  it("survives storage that throws on every call", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    saveFinanceExportFormat("ws-3", "docx", hostile);
    expect(loadFinanceExportFormat("ws-3", hostile)).toBe("docx");
  });
});

describe("financeExportBody", () => {
  it("sends the brief and the format, and the artifact id only when there is one", () => {
    expect(financeExportBody({ brief, format: "xlsx" })).toEqual({ brief, format: "xlsx" });
    expect(financeExportBody({ brief, format: "docx", artifactId: "a1", task: "brief" })).toEqual({
      brief,
      format: "docx",
      artifactId: "a1",
      task: "brief",
    });
  });
});

describe("filenameFromDisposition", () => {
  it("prefers the host's name and falls back per format", () => {
    expect(filenameFromDisposition('attachment; filename="Q3.xlsx"', "xlsx")).toBe("Q3.xlsx");
    expect(filenameFromDisposition(null, "pptx")).toBe(FINANCE_EXPORT_FALLBACK_NAME.pptx);
  });
});

describe("downloadFinanceExport", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    saveBlob.mockReset();
    isElectron.mockReturnValue(false);
  });

  it("posts to the export route and saves the bytes under the host's filename", async () => {
    apiFetch.mockResolvedValue(
      new Response("PK", { status: 200, headers: { "Content-Disposition": 'attachment; filename="Q3.pptx"' } }),
    );
    await downloadFinanceExport({ brief, format: "pptx" }, "failed");
    expect(apiFetch).toHaveBeenCalledWith(FINANCE_EXPORT_ENDPOINT, expect.objectContaining({ method: "POST" }));
    const sent = apiFetch.mock.calls[0]?.[1] as { body?: string } | undefined;
    expect(JSON.parse(sent?.body ?? "{}")).toMatchObject({ format: "pptx" });
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), "Q3.pptx");
  });

  it("leaves the file to the desktop host and saves nothing in the page", async () => {
    isElectron.mockReturnValue(true);
    apiFetch.mockResolvedValue(new Response("PK", { status: 200 }));
    await downloadFinanceExport({ brief, format: "xlsx" }, "failed");
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("raises the host's own message, never a bare status", async () => {
    apiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "format_unavailable", message: "PDF is not ready yet." } }), {
        status: 501,
      }),
    );
    await expect(downloadFinanceExport({ brief, format: "xlsx" }, "failed")).rejects.toThrow("PDF is not ready yet.");
  });

  it("falls back to the caller's message when the host sends no body", async () => {
    apiFetch.mockResolvedValue(new Response("", { status: 500 }));
    await expect(downloadFinanceExport({ brief, format: "xlsx" }, "Could not build the file")).rejects.toThrow(
      "Could not build the file",
    );
  });
});
