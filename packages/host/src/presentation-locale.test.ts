import { describe, expect, it } from "vitest";
import {
  presentationBootLocale,
  presentationGatewayMessage,
  presentationKicker,
  presentationLanguageRule,
  presentationLocale,
  resetPresentationBootLocaleForTests,
} from "./presentation-locale";

describe("presentationLocale", () => {
  it("defaults to en", () => {
    expect(presentationLocale({})).toBe("en");
  });

  it("prefers settings over env and body", () => {
    const previous = process.env.AGENTFORGE_LOCALE;
    process.env.AGENTFORGE_LOCALE = "id";
    try {
      expect(presentationLocale({ settings: { locale: "en" }, body: { locale: "id" } })).toBe("en");
      expect(presentationLocale({ body: { locale: "id" } })).toBe("id");
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTFORGE_LOCALE;
      } else {
        process.env.AGENTFORGE_LOCALE = previous;
      }
    }
  });

  it("freezes the first boot locale", () => {
    resetPresentationBootLocaleForTests();
    expect(presentationBootLocale({ locale: "id" })).toBe("id");
    expect(presentationBootLocale({ locale: "en" })).toBe("id");
    resetPresentationBootLocaleForTests();
    expect(presentationBootLocale({ locale: "en" })).toBe("en");
    resetPresentationBootLocaleForTests();
  });
});

describe("presentation language copy", () => {
  it("instructs Bahasa Indonesia slide copy for id", () => {
    expect(presentationLanguageRule("id")).toMatch(/Bahasa Indonesia/);
    expect(presentationKicker("id")).toBe("PRESENTASI");
    expect(presentationGatewayMessage("id")).toMatch(/Pengaturan/);
    expect(presentationGatewayMessage("id")).toMatch(/Toko Token/);
  });

  it("keeps English slide copy for en", () => {
    expect(presentationLanguageRule("en")).toMatch(/English/);
    expect(presentationKicker("en")).toBe("PRESENTATION");
    expect(presentationGatewayMessage("en")).toMatch(/Settings/);
  });
});
