import { afterEach, describe, expect, it } from "vitest";
import { applyLocale, freezeLocale, getLocale, resetLocaleForTests, t } from "./i18n";

afterEach(() => {
  resetLocaleForTests();
});

describe("t()", () => {
  it("freezeLocale ignores a second call; applyLocale overwrites", () => {
    expect(getLocale()).toBe("en");
    expect(t("settings.title")).toBe("Settings");
    expect(t("rail.settings")).toBe("Settings");
    expect(t("common.restartApp")).toBe("Restart DPSBuddy");
    freezeLocale("id");
    expect(getLocale()).toBe("id");
    expect(t("settings.title")).toBe("Pengaturan");
    expect(t("rail.settings")).toBe("Pengaturan");
    expect(t("onboarding.welcome", { productName: "DPSBuddy" })).toBe("Selamat datang di DPSBuddy");
    expect(t("chat.empty.headline")).toBe("Kerja dimulai di sini.");
    expect(t("chat.empty.pickModel")).toBe("Pilih model di bawah, lalu tulis.");
    expect(t("documents.title")).toBe("Dokumen");
    expect(t("research.title")).toBe("Riset");
    expect(t("images.title")).toBe("Gambar");
    expect(t("videos.title")).toBe("Video");
    expect(t("presentation.title")).toBe("Presentasi");
    expect(t("market.studio.title")).toBe("Pantauan Pasar");
    expect(t("data.title")).toBe("Data");
    expect(t("finance.title")).toBe("Keuangan");
    expect(t("legal.studio.title")).toBe("Legal");
    expect(t("knowledge.title")).toBe("Basis Pengetahuan");
    expect(t("knowledge.tabs.sources")).toBe("Sumber");
    expect(t("settings.title")).toBe("Pengaturan");
    expect(t("workspaces.title")).toBe("Ruang kerja");
    expect(t("usage.title")).toBe("Pemakaian");
    freezeLocale("en");
    expect(getLocale()).toBe("id");
    applyLocale("en");
    expect(getLocale()).toBe("en");
    expect(t("settings.title")).toBe("Settings");
    expect(t("chat.empty.headline")).toBe("Work starts here.");
  });

  it("fails closed on a missing key", () => {
    freezeLocale("id");
    expect(t("settings.doesNotExist")).toBe("settings.doesNotExist");
  });
});
