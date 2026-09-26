import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../locales");

function load(locale: "en" | "id"): unknown {
  return JSON.parse(readFileSync(resolve(localesDir, locale, "education.json"), "utf8"));
}

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("education locale JSON", () => {
  it("keeps en and id key trees aligned", () => {
    expect(keys(load("id")).sort()).toEqual(keys(load("en")).sort());
  });
});
