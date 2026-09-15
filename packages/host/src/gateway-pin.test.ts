import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The gateway endpoint is pinned (`core/gateway/pinned.ts`). `resolveProviderKeys` is the only place
 * allowed to decide it, because the gateway key rides on every request that uses it: a module that
 * reads `settings.openaiBaseUrl` straight off stored settings and builds a URL from it would send
 * `Authorization: Bearer <gateway key>` to whatever host landed in `settings.enc`.
 *
 * This is a grep, not a type: the reads it forbids are spelled the same everywhere, and the whole
 * point is that a new call site must not be able to reintroduce the leak quietly.
 */

const HOST_SRC = path.resolve(__dirname);
const CORE_SRC = path.resolve(__dirname, "../../core/src");

/**
 * `secrets.ts` defines `resolveProviderKeys` itself, and `settings-store.ts` is the load path that
 * discards a stored endpoint. Both must read the raw field to do their job.
 */
const EXCLUDED_FILES = new Set(["secrets.ts", "settings-store.ts"]);

/**
 * Permanent exceptions. Must stay empty: any entry here is a module that can be pointed at an
 * owner-chosen host.
 */
const ALLOWLIST: readonly string[] = [];

const RAW_READ = /\b(?:settings|secrets|stored|saved)\s*\??\.\s*openaiBaseUrl\b/g;

function listTsFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules" && entry !== "dist") {
          walk(full);
        }
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".d.ts") || entry.includes(".test.")) {
        continue;
      }
      if (EXCLUDED_FILES.has(entry)) {
        continue;
      }
      out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Comments describe the rule; only code can break it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function rawBaseUrlReads(root: string): string[] {
  const hits: string[] = [];
  for (const file of listTsFiles(root)) {
    const lines = stripComments(readFileSync(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, index) => {
      RAW_READ.lastIndex = 0;
      if (RAW_READ.test(line)) {
        hits.push(`${path.relative(root, file).split(path.sep).join("/")}:${index + 1}`);
      }
    });
  }
  return hits;
}

function unexpected(hits: string[]): string[] {
  return hits.filter((hit) => {
    const file = hit.split(":")[0] ?? "";
    return !ALLOWLIST.includes(file);
  });
}

describe("gateway endpoint pin", () => {
  it("has no permanent exceptions", () => {
    expect(ALLOWLIST).toEqual([]);
  });

  it("no host module reads settings.openaiBaseUrl outside resolveProviderKeys", () => {
    expect(unexpected(rawBaseUrlReads(HOST_SRC))).toEqual([]);
  });

  it("no core module reads settings.openaiBaseUrl outside resolveProviderKeys", () => {
    expect(unexpected(rawBaseUrlReads(CORE_SRC))).toEqual([]);
  });

  it("the settings patch reader no longer accepts an endpoint from the request body", () => {
    const handler = readFileSync(path.join(HOST_SRC, "handlers", "settings.ts"), "utf8");
    expect(handler).not.toMatch(/body\.openaiBaseUrl/);
  });
});
