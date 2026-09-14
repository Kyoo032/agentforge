import { afterEach, describe, expect, it } from "vitest";
import { freezeLocale, getLocale, resetLocaleForTests, t } from "./i18n";

afterEach(() => {
  resetLocaleForTests();
});

describe("t()", () => {
  it("returns English by default and Indonesian after freeze", () => {
    expect(getLocale()).toBe("en");
    expect(t("settings.title")).toBe("Settings");
    expect(t("rail.settings")).toBe("Settings");
    expect(t("common.restartApp")).toBe("Restart DPSBuddy");
    freezeLocale("id");
    expect(getLocale()).toBe("id");
    expect(t("settings.title")).toBe("Pengaturan");
    expect(t("rail.settings")).toBe("Pengaturan");
    expect(t("onboarding.welcome", { productName: "DPSBuddy" })).toBe("Selamat datang di DPSBuddy");
    freezeLocale("en");
    expect(getLocale()).toBe("id");
  });

  it("fails closed on a missing key", () => {
    freezeLocale("id");
    expect(t("settings.doesNotExist")).toBe("settings.doesNotExist");
  });
});
