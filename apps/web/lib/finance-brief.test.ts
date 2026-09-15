import { describe, expect, it } from "vitest";
import { briefLooksLikeFigures, parseFailureMessage } from "./finance-brief";

describe("briefLooksLikeFigures", () => {
  it("reads the Jakarta coffee chain brief as figures", () => {
    const brief =
      "Q3 2026 operating review for a Jakarta coffee chain with 12 outlets: revenue IDR 18.4B, " +
      "COGS IDR 7.9B, opex IDR 6.1B, net profit IDR 2.6B. Summarise margins and give three actions.";
    expect(briefLooksLikeFigures(brief)).toBe(true);
  });

  it("accepts magnitude suffixes", () => {
    expect(briefLooksLikeFigures("Revenue 18.4B, opex 6,1 M, cash 900k")).toBe(true);
  });

  it("accepts currency and percent tokens without a bare digit", () => {
    expect(briefLooksLikeFigures("Revenue in IDR against opex")).toBe(true);
    expect(briefLooksLikeFigures("Harga dalam Rp per cangkir")).toBe(true);
    expect(briefLooksLikeFigures("Cash in USD versus EUR")).toBe(true);
    expect(briefLooksLikeFigures("Payroll in $ this quarter")).toBe(true);
    expect(briefLooksLikeFigures("Gross margin as a % of revenue")).toBe(true);
  });

  it("rejects a narrative brief with no figures", () => {
    expect(briefLooksLikeFigures("Summarise our margins and give three actions")).toBe(false);
    expect(briefLooksLikeFigures("Jelaskan brief keuangan untuk kuartal berikutnya")).toBe(false);
  });

  it("rejects empty and whitespace-only text", () => {
    expect(briefLooksLikeFigures("")).toBe(false);
    expect(briefLooksLikeFigures("   \n\t ")).toBe(false);
  });

  it("does not throw on a non-string value", () => {
    expect(briefLooksLikeFigures(undefined as unknown as string)).toBe(false);
    expect(briefLooksLikeFigures(null as unknown as string)).toBe(false);
  });
});

describe("parseFailureMessage", () => {
  const hint = "Add line items first: paste figures and parse them, add rows by hand, or pick a saved dataset.";

  function coded(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
  }

  it("adds the add-items hint to a 422 invalid_finance parse", () => {
    const failure = coded("invalid_finance", "No figures could be read from that text");
    expect(parseFailureMessage(failure, "fallback", hint)).toBe(`No figures could be read from that text. ${hint}`);
  });

  it("does not double a full stop the host message already carries", () => {
    const failure = coded("invalid_finance", "Tidak ada angka yang dapat dibaca dari teks itu.");
    expect(parseFailureMessage(failure, "fallback", hint)).toBe(
      `Tidak ada angka yang dapat dibaca dari teks itu. ${hint}`,
    );
  });

  it("leaves a gateway failure message alone", () => {
    const failure = coded("runtime_stub", "Finance needs a live gateway. Paste a Toko Token API key in Settings.");
    expect(parseFailureMessage(failure, "fallback", hint)).toBe(
      "Finance needs a live gateway. Paste a Toko Token API key in Settings.",
    );
  });

  it("leaves an uncoded network failure alone", () => {
    expect(parseFailureMessage(new Error("Failed to fetch"), "fallback", hint)).toBe("Failed to fetch");
  });

  it("falls back when the error carries no message", () => {
    expect(parseFailureMessage(new Error("   "), "Could not read those figures", hint)).toBe(
      "Could not read those figures",
    );
    expect(parseFailureMessage("not an error", "Could not read those figures", hint)).toBe(
      "Could not read those figures",
    );
  });
});
