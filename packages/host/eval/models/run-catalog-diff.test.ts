import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCatalogDiffArgs } from "./args";
import { EvalRefusal } from "./credentials";
import { runCatalogDiff, type CatalogDiffDeps } from "./run-catalog-diff";

let resultsDir = "";
beforeEach(() => {
  resultsDir = mkdtempSync(join(tmpdir(), "eval-models-diff-"));
});
afterEach(() => {
  rmSync(resultsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

type Calls = { live: number; prices: number };

function deps(over: Partial<CatalogDiffDeps> = {}, saved: string[] = ["gpt-5.6-luna", "brand-new-chat"]): { deps: CatalogDiffDeps; out: string[]; calls: Calls } {
  const out: string[] = [];
  const calls: Calls = { live: 0, prices: 0 };
  const built: CatalogDiffDeps = {
    env: { AGENTFORGE_DATA_DIR: "/desk", AGENTFORGE_RUNTIME: "ai" },
    now: () => new Date("2026-09-30T10:00:00.000Z"),
    readSavedModels: () => ({ models: saved.map((id) => ({ id })), probedAt: "2026-09-30T09:00:00Z" }),
    fetchLiveModels: async () => {
      calls.live += 1;
      return [{ id: "gpt-5.6-luna" }, { id: "live-only-model" }];
    },
    loadPrices: async () => {
      calls.prices += 1;
      return { priceOf: (id) => (id === "gpt-5.6-luna" ? "$1.00 in / $4.00 out per 1M" : "not in the price list"), note: "from the test price list" };
    },
    out: (text) => {
      out.push(text);
    },
    ...over,
  };
  return { deps: built, out, calls };
}

const argsOf = (...flags: string[]) => parseCatalogDiffArgs(flags, resultsDir);

describe("runCatalogDiff", () => {
  it("prints the help and touches nothing", async () => {
    const { deps: d, out, calls } = deps();
    expect(await runCatalogDiff(argsOf("--help"), d)).toBe(0);
    expect(out.join("")).toMatch(/catalog-diff/);
    expect(calls).toEqual({ live: 0, prices: 0 });
  });

  it("reads the saved cache by default, prints the report with prices, and saves a snapshot", async () => {
    const { deps: d, out, calls } = deps();
    expect(await runCatalogDiff(argsOf(), d)).toBe(0);
    const text = out.join("");
    expect(text).toContain("gpt-5.6-luna");
    expect(text).toMatch(/brand-new-chat\s+UNKNOWN/);
    expect(text).toContain("$1.00 in / $4.00 out per 1M");
    expect(calls).toEqual({ live: 0, prices: 1 });
    expect(readdirSync(resultsDir)).toEqual(["catalog-2026-09-30T10-00-00-000Z.json"]);
    expect(text).toMatch(/snapshot saved/i);
  });

  it("diffs against the previous run's snapshot on the next run", async () => {
    await runCatalogDiff(argsOf(), deps().deps);
    const { deps: d, out } = deps(
      { now: () => new Date("2026-09-30T11:00:00.000Z") },
      ["gpt-5.6-luna", "another-new-one"],
    );
    await runCatalogDiff(argsOf(), d);
    const text = out.join("");
    expect(text).toMatch(/SINCE THE LAST RUN \(2026-09-30T10:00:00.000Z\): 1 new, 1 removed/);
    expect(text).toMatch(/\+ another-new-one\s+chat\s+UNKNOWN/);
    expect(text).toMatch(/- brand-new-chat\s+chat\s+UNKNOWN/);
    expect(readdirSync(resultsDir)).toHaveLength(2);
  });

  it("does not diff a run against its own snapshot when it is re-run at the same instant", async () => {
    await runCatalogDiff(argsOf(), deps().deps);
    const { deps: d, out } = deps();
    await runCatalogDiff(argsOf(), d);
    expect(out.join("")).toMatch(/no previous snapshot/i);
  });

  it("--refresh asks the gateway for the list and never reads the saved cache", async () => {
    let read = 0;
    const { deps: d, out, calls } = deps({
      readSavedModels: () => {
        read += 1;
        return { models: [] };
      },
    });
    expect(await runCatalogDiff(argsOf("--refresh"), d)).toBe(0);
    expect(calls.live).toBe(1);
    expect(read).toBe(0);
    expect(out.join("")).toContain("live-only-model");
    expect(out.join("")).toMatch(/refreshed from the gateway/i);
  });

  it("--refresh passes the workspace it was given", async () => {
    let seen: string | undefined;
    const { deps: d } = deps({
      fetchLiveModels: async (workspace) => {
        seen = workspace;
        return [{ id: "a" }];
      },
    });
    await runCatalogDiff(argsOf("--refresh", "--workspace", "desk-3"), d);
    expect(seen).toBe("desk-3");
  });

  it("refuses --refresh under the stub runtime, but reads the saved cache under it", async () => {
    const stub = { AGENTFORGE_DATA_DIR: "/desk", AGENTFORGE_RUNTIME: "stub" };
    const refused = deps({ env: stub });
    await expect(runCatalogDiff(argsOf("--refresh"), refused.deps)).rejects.toThrow(EvalRefusal);
    expect(refused.calls.live).toBe(0);
    const reading = deps({ env: stub });
    expect(await runCatalogDiff(argsOf(), reading.deps)).toBe(0);
  });

  it("refuses to guess a desk", async () => {
    const { deps: d } = deps({ env: {} });
    await expect(runCatalogDiff(argsOf(), d)).rejects.toThrow(/AGENTFORGE_DATA_DIR/);
  });

  it("--no-prices does not ask for the price list and says so", async () => {
    const { deps: d, out, calls } = deps();
    await runCatalogDiff(argsOf("--no-prices"), d);
    expect(calls.prices).toBe(0);
    expect(out.join("")).toMatch(/prices: not shown \(--no-prices\)/);
  });

  it("carries on without prices when the price list cannot be read", async () => {
    const { deps: d, out } = deps({ loadPrices: async () => ({ priceOf: undefined, note: "price list unavailable (503)" }) });
    expect(await runCatalogDiff(argsOf(), d)).toBe(0);
    expect(out.join("")).toMatch(/price list unavailable \(503\)/);
  });

  it("--no-save writes no snapshot", async () => {
    const { deps: d } = deps();
    await runCatalogDiff(argsOf("--no-save"), d);
    expect(readdirSync(resultsDir)).toEqual([]);
  });

  it("--json prints the report as JSON and nothing else", async () => {
    const { deps: d, out } = deps();
    await runCatalogDiff(argsOf("--json", "--no-save"), d);
    const parsed = JSON.parse(out.join("")) as { unknownChat: string[]; counts: { total: number } };
    expect(parsed.unknownChat).toEqual(["brand-new-chat"]);
    expect(parsed.counts.total).toBe(2);
  });

  it("says so, and exits 1, when the catalogue is empty", async () => {
    const { deps: d, out } = deps({}, []);
    expect(await runCatalogDiff(argsOf(), d)).toBe(1);
    expect(out.join("")).toMatch(/lists no models.*--refresh/s);
    expect(readdirSync(resultsDir)).toEqual([]);
  });
});
