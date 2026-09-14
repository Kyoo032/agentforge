import { describe, expect, it } from "vitest";
import {
  presentationGatewayMessage,
  presentationKicker,
  presentationLanguageRule,
  presentationLocale,
} from "./presentation-locale";

describe("presentationLocale", () => {
  it("defaults to en", () => {
    expect(presentationLocale()).toBe("en");
    expect(presentationLocale({})).toBe("en");
  });

  it("reads owner settings.locale when core has persisted it", () => {
    expect(presentationLocale({ locale: "id" })).toBe("id");
    expect(presentationLocale({ locale: "en" })).toBe("en");
  });

  it("prefers AGENTFORGE_LOCALE freeze over settings", () => {
    const previous = process.env.AGENTFORGE_LOCALE;
    process.env.AGENTFORGE_LOCALE = "id";
    try {
      expect(presentationLocale({ locale: "en" })).toBe("id");
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTFORGE_LOCALE;
      } else {
        process.env.AGENTFORGE_LOCALE = previous;
      }
    }
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
