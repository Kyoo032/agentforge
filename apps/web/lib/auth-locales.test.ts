/**
 * The `auth` namespace in both catalogs, modelled on `account-locales.test.ts`.
 *
 * Its own file because this namespace carries one thing no other does: the host's reason
 * vocabulary. A code the host can send with no copy behind it renders as a dotted key on a screen
 * the person cannot get past, so the reason block is checked against `AUTH_REASONS` itself rather
 * than only against the other locale — two catalogs can agree and still both be short a code.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUTH_REASONS, LOGIN_NOT_CONFIGURED } from "./auth-reason";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "../locales");

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    leafKeys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

function load(locale: "en" | "id"): Record<string, Record<string, string>> {
  return JSON.parse(readFileSync(join(localesDir, locale, "auth.json"), "utf8"));
}

describe("the auth namespace", () => {
  it("id/auth.json has the same keys as en", () => {
    expect(leafKeys(load("id")).sort()).toEqual(leafKeys(load("en")).sort());
  });

  for (const locale of ["en", "id"] as const) {
    it(`${locale} has copy for all thirteen host reasons, the config refusal and the fallback`, () => {
      const reasons = load(locale).reason ?? {};
      for (const code of [...AUTH_REASONS, LOGIN_NOT_CONFIGURED, "unknown"]) {
        expect(typeof reasons[code], `${locale}/${code}`).toBe("string");
        expect(reasons[code]?.trim().length, `${locale}/${code}`).toBeGreaterThan(3);
      }
    });

    it(`${locale} keeps the sign-in, callback and account copy the screens read`, () => {
      const catalog = load(locale);
      expect(Object.keys(catalog).sort()).toEqual(["account", "callback", "reason", "signIn"]);
      expect(catalog.signIn?.title).toContain("{productName}");
      expect(catalog.account?.expires).toContain("{when}");
    });
  }
});
