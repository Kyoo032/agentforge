import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "../locales");

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    leafKeys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

function placeholdersByKey(value: unknown, prefix = ""): Record<string, string[]> {
  if (typeof value === "string") {
    return prefix ? { [prefix]: [...value.matchAll(/\{[a-zA-Z0-9_]+\}/g)].map((match) => match[0]).sort() } : {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value as Record<string, unknown>).reduce(
    (acc, [key, nested]) => ({ ...acc, ...placeholdersByKey(nested, prefix ? `${prefix}.${key}` : key) }),
    {} as Record<string, string[]>,
  );
}

function load(locale: "en" | "id"): unknown {
  return JSON.parse(readFileSync(join(localesDir, locale, "edit.json"), "utf8"));
}

describe("edit locales", () => {
  it("id/edit.json has the same keys as en", () => {
    const en = leafKeys(load("en")).sort();
    const id = leafKeys(load("id")).sort();
    expect(id).toEqual(en);
  });

  it("id/edit.json keeps the same {placeholders} as en", () => {
    expect(placeholdersByKey(load("id"))).toEqual(placeholdersByKey(load("en")));
  });
});
