import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { imageGenerateFailedMessage, imageOutputLanguageHint, withImageOutputLanguage } from "./image-output-locale";

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/locales");

function loadImages(locale: "en" | "id"): { outputTextLanguage: string; generateError: string } {
  return JSON.parse(readFileSync(resolve(localesDir, locale, "images.json"), "utf8")) as {
    outputTextLanguage: string;
    generateError: string;
  };
}

describe("image output locale", () => {
  it("appends on-image text language without duplicating the hint", () => {
    const prompt = "A lantern on a stone slab.";
    const once = withImageOutputLanguage(prompt, "id");
    expect(once.startsWith(prompt)).toBe(true);
    expect(once).toContain("bahasa Indonesia");
    expect(withImageOutputLanguage(once, "id")).toBe(once);
    expect(withImageOutputLanguage(prompt, "en")).toContain("English");
  });

  it("keeps generate-failed copy on the run locale", () => {
    expect(imageGenerateFailedMessage("en")).toBe("Image generation failed");
    expect(imageGenerateFailedMessage("id")).toBe("Pembuatan gambar gagal");
    expect(imageOutputLanguageHint("id")).toContain("bahasa Indonesia");
  });

  it("falls back to English for an unknown locale and ignores AGENTFORGE_LOCALE", () => {
    const previous = process.env.AGENTFORGE_LOCALE;
    process.env.AGENTFORGE_LOCALE = "id";
    try {
      expect(imageGenerateFailedMessage("en")).toBe("Image generation failed");
      expect(imageOutputLanguageHint("en")).toContain("English");
      expect(imageGenerateFailedMessage("de" as never)).toBe("Image generation failed");
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTFORGE_LOCALE;
      } else {
        process.env.AGENTFORGE_LOCALE = previous;
      }
    }
  });

  it("stays aligned with images locale JSON", () => {
    for (const locale of ["en", "id"] as const) {
      const json = loadImages(locale);
      expect(imageOutputLanguageHint(locale)).toBe(json.outputTextLanguage);
      expect(imageGenerateFailedMessage(locale)).toBe(json.generateError);
    }
  });
});
