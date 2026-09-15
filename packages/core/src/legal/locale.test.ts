import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "../locale";
import { LEGAL_LOCALES, legalUserFacingLanguageInstruction, resolveLegalLocale } from "./locale";
import { fillCopy, legalOutputCopy } from "./output-copy";

describe("resolveLegalLocale", () => {
  it("defaults to en and accepts id", () => {
    expect(resolveLegalLocale()).toBe("en");
    expect(resolveLegalLocale("id")).toBe("id");
    expect(resolveLegalLocale("de", "id")).toBe("id");
  });
});

describe("legalUserFacingLanguageInstruction", () => {
  it("requires English or Bahasa Indonesia artifact text", () => {
    expect(legalUserFacingLanguageInstruction("en")).toContain("MUST be written in English");
    expect(legalUserFacingLanguageInstruction("id")).toContain("Bahasa Indonesia");
    expect(legalUserFacingLanguageInstruction("id")).toContain("Anda");
  });
});

describe("legalOutputCopy", () => {
  it("keeps English chrome and translates Indonesian chrome", () => {
    expect(legalOutputCopy("en").stubError).toMatch(/live gateway/);
    expect(legalOutputCopy("id").stubError).toMatch(/gerbang yang aktif/);
    expect(legalOutputCopy("id").phase.classify).toBe("Mengklasifikasi dokumen");
    expect(
      fillCopy(legalOutputCopy("id").roundOf, { round: 2, total: 3 }),
    ).toBe("Putaran 2 dari 3");
  });
});

describe("LEGAL_LOCALES", () => {
  it("is the app-wide locale set, not a mode-private one", () => {
    expect([...LEGAL_LOCALES]).toEqual([...APP_LOCALES]);
    for (const locale of APP_LOCALES) {
      expect(resolveLegalLocale(locale)).toBe(locale);
    }
    expect(resolveLegalLocale(null, undefined, "nope")).toBe("en");
  });
});
