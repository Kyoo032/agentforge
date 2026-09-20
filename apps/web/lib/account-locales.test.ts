import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "../locales");
const NAMESPACES = ["knowledge", "workspaces", "usage", "rail", "channels"] as const;

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    leafKeys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

function load(locale: "en" | "id", namespace: (typeof NAMESPACES)[number]): unknown {
  return JSON.parse(readFileSync(join(localesDir, locale, `${namespace}.json`), "utf8"));
}

describe("shell and account surface locales", () => {
  for (const namespace of NAMESPACES) {
    it(`id/${namespace}.json has the same keys as en`, () => {
      const en = leafKeys(load("en", namespace)).sort();
      const id = leafKeys(load("id", namespace)).sort();
      expect(id).toEqual(en);
    });
  }
});
