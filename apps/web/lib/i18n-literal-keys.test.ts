/**
 * Every `t("literal.key")` in the renderer resolves to a real catalog entry.
 *
 * `t()` returns the raw key when English has no entry, so a renamed or deleted key does not fail a
 * build or a type check: the UI just prints `data.pasteLabel` where a label should be. That is what
 * the 0.15.0 cut shipped for the Data paste box. This scans the renderer's own sources for `t()`
 * calls whose first argument is a complete string literal and checks each one against the catalog
 * files, in English (the fallback every locale lands on) and in Indonesian.
 *
 * Dynamic keys (`t(\`edit.tools.${id}\`)`, `t(key)`) are out of reach of a text scan and are left to
 * the per-namespace parity tests.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { applyLocale, resetLocaleForTests, t } from "./i18n";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED_DIRS = ["src", "components", "lib"] as const;
const LOCALES = ["en", "id"] as const;

type Catalog = Record<string, unknown>;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function loadCatalogs(locale: (typeof LOCALES)[number]): Record<string, Catalog> {
  const dir = join(webRoot, "locales", locale);
  const catalogs: Record<string, Catalog> = {};
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".json")) {
      catalogs[name.slice(0, -".json".length)] = JSON.parse(readFileSync(join(dir, name), "utf8")) as Catalog;
    }
  }
  return catalogs;
}

/** Mirrors `lookup` in `./i18n`: a nested path first, then a flat dotted key inside the namespace. */
function resolves(catalogs: Record<string, Catalog>, key: string): boolean {
  const dot = key.indexOf(".");
  if (dot <= 0) {
    return false;
  }
  const catalog = catalogs[key.slice(0, dot)];
  if (!catalog) {
    return false;
  }
  const rest = key.slice(dot + 1);
  let node: unknown = catalog;
  for (const part of rest.split(".")) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      node = undefined;
      break;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" || typeof catalog[rest] === "string";
}

type KeyUse = { key: string; where: string };

/**
 * `t(` at a word boundary, then one complete string literal as the whole first argument: the closing
 * quote must be followed by `,` or `)`, so `t("a." + b)` and template literals are never read as keys.
 */
const LITERAL_T_CALL = /\bt\(\s*(["'])((?:(?!\1)[^\\\n$`])+)\1\s*[,)]/g;

function literalKeyUses(): KeyUse[] {
  const uses: KeyUse[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of sourceFiles(join(webRoot, dir))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(LITERAL_T_CALL)) {
        const line = text.slice(0, match.index).split("\n").length;
        uses.push({ key: match[2] ?? "", where: `${relative(webRoot, file).replaceAll("\\", "/")}:${line}` });
      }
    }
  }
  return uses;
}

describe("t() literal keys", () => {
  const uses = literalKeyUses();

  beforeAll(() => {
    resetLocaleForTests();
    applyLocale("en");
  });

  it("finds the renderer's t() calls, so a broken scan cannot pass by finding nothing", () => {
    // 1,200+ literal calls on 2026-09-23. A regex that stops matching would otherwise go green.
    expect(uses.length).toBeGreaterThan(500);
    expect(uses.some((use) => use.key === "data.title")).toBe(true);
  });

  it("resolves every literal key in the English catalog", () => {
    const en = loadCatalogs("en");
    const missing = uses.filter((use) => !resolves(en, use.key)).map((use) => `${use.where}  ${use.key}`);
    expect(missing).toEqual([]);
  });

  it("resolves every literal key through t() itself, not only through the JSON files", () => {
    // A namespace file that i18n.ts never registered would pass the file check and still print keys.
    const unresolved = uses.filter((use) => t(use.key) === use.key).map((use) => `${use.where}  ${use.key}`);
    expect(unresolved).toEqual([]);
  });

  it("resolves every literal key in the Indonesian catalog too", () => {
    const id = loadCatalogs("id");
    const missing = uses.filter((use) => !resolves(id, use.key)).map((use) => `${use.where}  ${use.key}`);
    expect(missing).toEqual([]);
  });
});

describe("the literal-key scan itself", () => {
  function keysIn(source: string): string[] {
    return [...source.matchAll(LITERAL_T_CALL)].map((match) => match[2] ?? "");
  }

  it("reads single, double and multi-line literal calls", () => {
    expect(keysIn(`t("data.title")`)).toEqual(["data.title"]);
    expect(keysIn(`t('data.title', { n: 1 })`)).toEqual(["data.title"]);
    expect(keysIn(`t(\n  "data.datasetMeta",\n  { rows },\n)`)).toEqual(["data.datasetMeta"]);
  });

  it("skips dynamic keys and look-alike calls", () => {
    expect(keysIn(`t(\`edit.tools.\${id}\`)`)).toEqual([]);
    expect(keysIn(`t("edit.tools." + id)`)).toEqual([]);
    expect(keysIn(`t(key)`)).toEqual([]);
    expect(keysIn(`split("a.b")`)).toEqual([]);
    expect(keysIn(`event.type === "edit.card"`)).toEqual([]);
  });
});
