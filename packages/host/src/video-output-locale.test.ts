import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  videoGenerateFailedMessage,
  videoNeedsKeyMessage,
  videoOutputLanguageHint,
  videoStillUnsupportedMessage,
  videoStudioLocale,
  withVideoOutputLanguage,
} from "./video-output-locale";

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/locales");

function loadVideos(locale: "en" | "id"): {
  outputTextLanguage: string;
  generateError: string;
  hostNeedsKey: string;
  stillUnsupported: string;
} {
  return JSON.parse(readFileSync(resolve(localesDir, locale, "videos.json"), "utf8")) as {
    outputTextLanguage: string;
    generateError: string;
    hostNeedsKey: string;
    stillUnsupported: string;
  };
}

describe("video output locale", () => {
  it("defaults to en and honors id", () => {
    const previous = process.env.AGENTFORGE_LOCALE;
    try {
      delete process.env.AGENTFORGE_LOCALE;
      expect(videoStudioLocale(undefined)).toBe("en");
      expect(videoStudioLocale({})).toBe("en");
      expect(videoStudioLocale({ locale: "en" })).toBe("en");
      expect(videoStudioLocale({ locale: "id" })).toBe("id");
      process.env.AGENTFORGE_LOCALE = "id";
      expect(videoStudioLocale({ locale: "en" })).toBe("id");
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTFORGE_LOCALE;
      } else {
        process.env.AGENTFORGE_LOCALE = previous;
      }
    }
  });

  it("appends spoken and on-screen language without duplicating the hint", () => {
    const prompt = "A lantern swinging over wet cobblestones.";
    const once = withVideoOutputLanguage(prompt, "id");
    expect(once.startsWith(prompt)).toBe(true);
    expect(once).toContain("bahasa Indonesia");
    expect(withVideoOutputLanguage(once, "id")).toBe(once);
    expect(withVideoOutputLanguage(prompt, "en")).toContain("English");
  });

  it("keeps generate-failed copy on the boot locale", () => {
    expect(videoGenerateFailedMessage("en")).toBe("Video generation failed");
    expect(videoGenerateFailedMessage("id")).toBe("Pembuatan video gagal");
    expect(videoNeedsKeyMessage("id")).toContain("Toko Token");
    expect(videoStillUnsupportedMessage("id")).toContain("gambar diam");
    expect(videoOutputLanguageHint("id")).toContain("bahasa Indonesia");
  });

  it("stays aligned with videos locale JSON", () => {
    for (const locale of ["en", "id"] as const) {
      const json = loadVideos(locale);
      expect(videoOutputLanguageHint(locale)).toBe(json.outputTextLanguage);
      expect(videoGenerateFailedMessage(locale)).toBe(json.generateError);
      expect(videoNeedsKeyMessage(locale)).toBe(json.hostNeedsKey);
      expect(videoStillUnsupportedMessage(locale)).toBe(json.stillUnsupported);
    }
  });
});
