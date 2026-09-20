import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../locales");

function load(locale: "en" | "id", file: string): unknown {
  return JSON.parse(readFileSync(resolve(localesDir, locale, file), "utf8"));
}

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("music locale JSON", () => {
  it("keeps en and id key trees aligned", () => {
    expect(keys(load("id", "music.json")).sort()).toEqual(keys(load("en", "music.json")).sort());
  });

  it("keeps brand names untranslated in id", () => {
    const raw = readFileSync(resolve(localesDir, "id", "music.json"), "utf8");
    expect(raw).not.toMatch(/TokenKu/);
  });

  it("gives the rail a Music label in both locales", () => {
    for (const locale of ["en", "id"] as const) {
      const rail = load(locale, "rail.json") as Record<string, unknown>;
      expect(typeof rail.music).toBe("string");
      expect(String(rail.music).length).toBeGreaterThan(0);
    }
  });

  it("carries a reason for each way voice-over can be unavailable", () => {
    // The host answers with one of these two reason codes; a missing key would render blank.
    for (const locale of ["en", "id"] as const) {
      const music = load(locale, "music.json") as { voiceUnavailable?: Record<string, unknown> };
      expect(typeof music.voiceUnavailable?.realtimeOnly).toBe("string");
      expect(typeof music.voiceUnavailable?.noAudioModels).toBe("string");
    }
  });
});
