import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  imageGenerateFailedMessage,
  imageOutputLanguageHint,
  imageStudioLocale,
  withImageOutputLanguage,
} from "./image-output-locale";

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/locales");

function loadImages(locale: "en" | "id"): { outputTextLanguage: string; generateError: string } {
  return JSON.parse(readFileSync(resolve(localesDir, locale, "images.json"), "utf8")) as {
    outputTextLanguage: string;
    generateError: string;
  };
}

describe("image output locale", () => {
  it("defaults to en and honors id", () => {
    const previous = process.env.AGENTFORGE_LOCALE;
    delete process.env.AGENTFORGE_LOCALE;
    expect(imageStudioLocale(undefined)).toBe("en");
    expect(imageStudioLocale({})).toBe("en");
    expect(imageStudioLocale({ locale: "en" })).toBe("en");
    expect(imageStudioLocale({ locale: "id" })).toBe("id");
    process.env.AGENTFORGE_LOCALE = "id";
    expect(imageStudioLocale({ locale: "en" })).toBe("id");
    if (previous === undefined) {
      delete process.env.AGENTFORGE_LOCALE;
    } else {
      process.env.AGENTFORGE_LOCALE = previous;
    }
  });

  it("appends on-image text language without duplicating the hint", () => {
    const prompt = "A lantern on a stone slab.";
    const once = withImageOutputLanguage(prompt, "id");
    expect(once.startsWith(prompt)).toBe(true);
    expect(once).toContain("bahasa Indonesia");
    expect(withImageOutputLanguage(once, "id")).toBe(once);
    expect(withImageOutputLanguage(prompt, "en")).toContain("English");
  });

  it("keeps generate-failed copy on the boot locale", () => {
    expect(imageGenerateFailedMessage("en")).toBe("Image generation failed");
    expect(imageGenerateFailedMessage("id")).toBe("Pembuatan gambar gagal");
    expect(imageOutputLanguageHint("id")).toContain("bahasa Indonesia");
  });

  it("stays aligned with images locale JSON", () => {
    for (const locale of ["en", "id"] as const) {
      const json = loadImages(locale);
      expect(imageOutputLanguageHint(locale)).toBe(json.outputTextLanguage);
      expect(imageGenerateFailedMessage(locale)).toBe(json.generateError);
    }
  });
});
