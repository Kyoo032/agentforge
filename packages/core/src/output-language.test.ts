import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  editStubAssistantCopy,
  GATEWAY_REQUIRED_SURFACES,
  gatewayRequiredMessage,
  outputLanguageRule,
  searchKeyRequiredMessage,
  withOutputLanguage,
} from "./output-language";

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/locales");

function loadJson(locale: "en" | "id", file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(localesDir, locale, file), "utf8")) as Record<string, unknown>;
}

describe("output language", () => {
  it("appends Bahasa Indonesia for job surfaces when locale is id", () => {
    const base = "Return JSON only.";
    const once = withOutputLanguage(base, "documents", "id");
    expect(once.startsWith(base)).toBe(true);
    expect(once).toMatch(/Bahasa Indonesia/);
    expect(withOutputLanguage(once, "documents", "id")).toBe(once);
    expect(withOutputLanguage(base, "documents", "en")).toContain("English");
  });

  it("stays aligned with renderer locale catalogs", () => {
    for (const locale of ["en", "id"] as const) {
      const documents = loadJson(locale, "documents.json");
      const research = loadJson(locale, "research.json");
      const finance = loadJson(locale, "finance.json") as { pipeline: { languageInstruction: string } };
      const data = loadJson(locale, "data.json");
      const videos = loadJson(locale, "videos.json");
      const edit = loadJson(locale, "edit.json") as {
        pipeline: { languageInstruction: string; stubHelp: string; stubUndo: string };
      };
      const knowledge = loadJson(locale, "knowledge.json");
      expect(outputLanguageRule("documents", locale)).toBe(documents.outputTextLanguage);
      expect(outputLanguageRule("research", locale)).toBe(research.languageRule);
      expect(outputLanguageRule("finance", locale)).toBe(finance.pipeline.languageInstruction);
      expect(outputLanguageRule("data", locale)).toBe(data.outputTextLanguage);
      expect(outputLanguageRule("videos", locale)).toBe(videos.outputTextLanguage);
      expect(outputLanguageRule("edit", locale)).toBe(edit.pipeline.languageInstruction);
      expect(outputLanguageRule("knowledge", locale)).toBe(knowledge.languageRule);
      expect(editStubAssistantCopy(locale)).toEqual({
        help: edit.pipeline.stubHelp,
        undo: edit.pipeline.stubUndo,
      });
    }
  });
});

describe("gateway required copy", () => {
  it("has a distinct en and id message for every surface", () => {
    for (const surface of GATEWAY_REQUIRED_SURFACES) {
      const en = gatewayRequiredMessage(surface, "en");
      const id = gatewayRequiredMessage(surface, "id");
      expect(en.trim().length).toBeGreaterThan(0);
      expect(id.trim().length).toBeGreaterThan(0);
      expect(id).not.toBe(en);
    }
  });

  it("keeps the English wording the modes already threw", () => {
    expect(gatewayRequiredMessage("documents", "en")).toBe(
      "Document generation needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
    );
    expect(gatewayRequiredMessage("research", "en")).toBe(
      "Research needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
    );
    expect(gatewayRequiredMessage("finance", "en")).toBe(
      "Finance needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
    );
    expect(gatewayRequiredMessage("data", "en")).toBe(
      "Data analysis needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
    );
    expect(gatewayRequiredMessage("market", "en")).toBe(
      "Market needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
    );
    expect(gatewayRequiredMessage("videos", "en")).toBe("Add a Toko Token gateway key in Settings to generate videos.");
  });

  it("writes Indonesian for id and falls back to English for an unknown locale", () => {
    expect(gatewayRequiredMessage("data", "id")).toContain("gerbang yang aktif");
    expect(gatewayRequiredMessage("videos", "id")).toContain("membuat video");
    expect(gatewayRequiredMessage("finance", "de" as never)).toBe(gatewayRequiredMessage("finance", "en"));
  });

  it("localizes the Research search-key message", () => {
    expect(searchKeyRequiredMessage("en")).toBe(
      "Research needs a Tavily or Brave Search API key. Add it in Settings, then try again.",
    );
    expect(searchKeyRequiredMessage("id")).toContain("Tavily atau Brave Search");
    expect(searchKeyRequiredMessage("de" as never)).toBe(searchKeyRequiredMessage("en"));
  });
});
