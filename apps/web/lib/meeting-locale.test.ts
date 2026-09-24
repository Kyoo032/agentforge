import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRODUCT_MODES } from "@agentforge/core/product-modes";

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../locales");

function load(locale: "en" | "id", file = "meeting.json"): unknown {
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

describe("meeting locale JSON", () => {
  it("keeps en and id key trees aligned", () => {
    expect(keys(load("id")).sort()).toEqual(keys(load("en")).sort());
  });

  it("translates the Indonesian catalog rather than shipping the English strings", () => {
    const en = load("en") as Record<string, string>;
    const id = load("id") as Record<string, string>;
    expect(id.title).not.toBe(en.title);
    expect(id.subtitle).not.toBe(en.subtitle);
  });

  it("keeps the interpolation placeholders identical in both languages", () => {
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    const en = load("en") as Record<string, string>;
    const id = load("id") as Record<string, string>;
    for (const key of ["uploaded", "unverified", "deleteConfirm"]) {
      expect(placeholders(id[key] ?? ""), key).toEqual(placeholders(en[key] ?? ""));
    }
  });

  it("names the meeting in both languages on the notices that are about one", () => {
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    const en = (load("en") as { record: Record<string, string> }).record;
    const id = (load("id") as { record: Record<string, string> }).record;
    for (const key of ["uploadFailedFor", "otherDesk"]) {
      expect(placeholders(en[key] ?? ""), key).toEqual(["{title}"]);
      expect(placeholders(id[key] ?? ""), key).toEqual(["{title}"]);
    }
  });

  it("keeps brand names untranslated in id", () => {
    const raw = readFileSync(resolve(localesDir, "id", "meeting.json"), "utf8");
    expect(raw).not.toMatch(/TokenKu/);
  });
});

describe("meeting rail label", () => {
  it("is present in both rail catalogs, as every product mode must be", () => {
    for (const locale of ["en", "id"] as const) {
      const rail = load(locale, "rail.json") as Record<string, string>;
      for (const mode of PRODUCT_MODES) {
        expect(rail[mode.id], `${locale}/rail.json is missing ${mode.id}`).toBeTruthy();
      }
    }
  });

  it("is present in both workspace mode-chip catalogs", () => {
    for (const locale of ["en", "id"] as const) {
      const workspaces = load(locale, "workspaces.json") as { mode: Record<string, string> };
      for (const mode of PRODUCT_MODES) {
        expect(workspaces.mode[mode.id], `${locale}/workspaces.json is missing mode.${mode.id}`).toBeTruthy();
      }
    }
  });
});
