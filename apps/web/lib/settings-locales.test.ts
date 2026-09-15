import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "../locales");
const NAMESPACES = ["settings", "onboarding"] as const;

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

describe("settings surface locales", () => {
  for (const namespace of NAMESPACES) {
    it(`id/${namespace}.json has the same keys as en`, () => {
      const en = leafKeys(load("en", namespace)).sort();
      const id = leafKeys(load("id", namespace)).sort();
      expect(id).toEqual(en);
    });
  }

  it("ships every Start over key in both locales", () => {
    const expected = [
      "reset.cancel",
      "reset.failed",
      "reset.freshInstall",
      "reset.freshInstallHelp",
      "reset.freshInstallSubmit",
      "reset.freshInstallTypeToConfirm",
      "reset.freshInstallWarning",
      "reset.heading",
      "reset.help",
      "reset.restartNeeded",
      "reset.restarting",
      "reset.signOut",
      "reset.signOutConfirm",
      "reset.signOutHelp",
      "reset.signOutSubmit",
    ];
    for (const locale of ["en", "id"] as const) {
      const keys = leafKeys(load(locale, "settings"));
      for (const key of expected) {
        expect(keys).toContain(key);
      }
    }
  });

  it("keeps the literal RESET word untranslated", () => {
    for (const locale of ["en", "id"] as const) {
      const catalog = load(locale, "settings") as Record<string, string>;
      expect(catalog["reset.freshInstallTypeToConfirm"]).toContain("RESET");
    }
  });
});
