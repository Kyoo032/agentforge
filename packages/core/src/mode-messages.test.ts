import { describe, expect, it } from "vitest";
import { APP_LOCALES } from "./locale";
import { MODE_MESSAGE_KEYS, modeMessage } from "./mode-messages";

describe("mode messages", () => {
  it("has a non-empty string for every key in every locale", () => {
    for (const key of MODE_MESSAGE_KEYS) {
      for (const locale of APP_LOCALES) {
        const text = modeMessage(key, locale);
        expect(typeof text).toBe("string");
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("gives Indonesian a distinct wording from English", () => {
    for (const key of MODE_MESSAGE_KEYS) {
      expect(modeMessage(key, "id")).not.toBe(modeMessage(key, "en"));
    }
  });

  it("keeps the English wording the renderer already shows", () => {
    expect(modeMessage("emptyDocumentDraft", "en")).toBe("Model returned an empty document draft");
    expect(modeMessage("videoGenerateFailed", "en")).toBe("Video generation failed");
    expect(modeMessage("webSearchFailed", "en")).toBe("Web search failed");
    expect(modeMessage("editAgentFailed", "en")).toBe("edit agent failed");
    expect(modeMessage("editFileRequired", "en")).toBe("file is required");
    expect(modeMessage("editMediaUnreadable", "en")).toBe("ffprobe could not read this file");
  });

  it("falls back to English for an unknown locale", () => {
    expect(modeMessage("emptyAnalysis", "de" as never)).toBe(modeMessage("emptyAnalysis", "en"));
  });
});
