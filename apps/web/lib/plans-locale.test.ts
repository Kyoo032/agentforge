/**
 * The `plans` namespace, in both languages and against the catalog that names its keys.
 *
 * Modelled on `account-locales.test.ts`, with one extra obligation that namespace does not have:
 * the copy for a tier is not written in the JSON by hand alone, it is *demanded* by
 * `packages/core/src/plans/catalog.ts`. Every tier carries a `nameKey`, a `descriptionKey` and a
 * list of `featureKeys`, and `t()` answers a key it cannot find with the raw dotted path — so a
 * feature added to a tier and not to the catalogs would reach a customer's screen as
 * `plans.feature.somethingNew`. The catalog is therefore read here and every key it emits is
 * looked up in both files, which is a relation between two tables rather than a restatement of
 * either.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLAN_TIERS } from "@agentforge/core/plans";
import { applyLocale, resetLocaleForTests, t } from "./i18n";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "../locales");

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    leafKeys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

function load(locale: "en" | "id"): unknown {
  return JSON.parse(readFileSync(join(localesDir, locale, "plans.json"), "utf8"));
}

/** Every dotted key the catalog asks a surface to render, `plans.` prefix included. */
function catalogKeys(): string[] {
  return PLAN_TIERS.flatMap((tier) => [tier.nameKey, tier.descriptionKey, ...tier.featureKeys]);
}

describe("the plans namespace", () => {
  it("has the same keys in id as in en", () => {
    expect(leafKeys(load("id")).sort()).toEqual(leafKeys(load("en")).sort());
  });

  it("names every tier and feature the catalog emits, in both languages", () => {
    for (const locale of ["en", "id"] as const) {
      const catalog = load(locale) as Record<string, unknown>;
      const keys = leafKeys(catalog);
      for (const key of catalogKeys()) {
        expect(key.startsWith("plans."), `${key} is not in the plans namespace`).toBe(true);
        expect(keys, `${locale} has no copy for ${key}`).toContain(key.slice("plans.".length));
      }
    }
  });

  it("is registered with the translator, so a tier renders as a sentence rather than a key", () => {
    for (const locale of ["en", "id"] as const) {
      resetLocaleForTests();
      applyLocale(locale);
      try {
        for (const key of catalogKeys()) {
          expect(t(key), `${locale} / ${key}`).not.toBe(key);
        }
        expect(t("plans.placeholderNotice")).not.toBe("plans.placeholderNotice");
        // The seat line is the one piece of tier copy that takes a number.
        expect(t("plans.seats.capped", { count: 20 })).toContain("20");
      } finally {
        resetLocaleForTests();
      }
    }
  });
});
