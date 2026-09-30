import { CATALOG_DIFF_USAGE, type CatalogDiffArgs } from "./args";
import { buildCatalogReport, renderCatalogReport, snapshotOf } from "./catalog-report";
import { requireDataDir, requireEvalDesk } from "./credentials";
import { preferenceLists } from "./lists";
import type { PriceLookup } from "./pricing";
import { readLatestSnapshot, writeSnapshot } from "./snapshots";

export type CatalogDiffDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  /** The models the desk's saved cache lists, read the way the host reads it. */
  readSavedModels: () => { models: Array<{ id: string }>; probedAt?: string | undefined; error?: string | undefined };
  /** A live `GET /models` with the desk's saved key. Refuses (EvalRefusal) when the desk has none. */
  fetchLiveModels: (workspace: string | undefined) => Promise<Array<{ id: string }>>;
  loadPrices: () => Promise<PriceLookup>;
  out: (text: string) => void;
};

/**
 * `catalog-diff`: which live model ids the policy table knows, how each preference list fares against
 * the live catalogue, what each model costs, and what changed since the last run. Reads the desk's saved
 * cache by default and calls nothing; `--refresh` asks the gateway for its list instead. Returns the exit
 * code; a refusal (no desk, stub runtime, no key) is thrown for the entry point to print.
 */
export async function runCatalogDiff(args: CatalogDiffArgs, deps: CatalogDiffDeps): Promise<number> {
  if (args.help) {
    deps.out(CATALOG_DIFF_USAGE);
    return 0;
  }
  const { dataDir } = args.refresh ? requireEvalDesk(deps.env) : requireDataDir(deps.env);

  const generatedAt = deps.now();
  let source: { dataDir: string; refreshed: boolean; probedAt?: string | undefined; error?: string | undefined };
  let models: Array<{ id: string }>;
  if (args.refresh) {
    models = await deps.fetchLiveModels(args.workspace);
    source = { dataDir, refreshed: true };
  } else {
    const saved = deps.readSavedModels();
    models = saved.models;
    source = { dataDir, refreshed: false, probedAt: saved.probedAt, error: saved.error };
  }
  if (models.length === 0) {
    deps.out(
      `The ${args.refresh ? "gateway" : `saved catalogue in ${dataDir}`} lists no models${
        source.error ? ` (the last probe said: ${source.error})` : ""
      }. ${args.refresh ? "Check the key on that desk." : "Run with --refresh to ask the gateway."}\n`,
    );
    return 1;
  }

  const prices: PriceLookup = args.prices
    ? await deps.loadPrices()
    : { priceOf: undefined, note: "not shown (--no-prices)" };
  // Read the previous run before this one is written, and never diff a run against itself.
  const previous = readLatestSnapshot(args.resultsDir, { before: generatedAt.toISOString() });
  const report = buildCatalogReport({
    generatedAt,
    models,
    lists: preferenceLists(),
    source,
    priceOf: prices.priceOf,
    pricesNote: prices.note,
    previous,
  });

  deps.out(args.json ? `${JSON.stringify(report, null, 2)}\n` : renderCatalogReport(report));
  if (args.save) {
    const path = writeSnapshot(args.resultsDir, snapshotOf(report), report);
    if (!args.json) {
      deps.out(`snapshot saved: ${path}\n`);
    }
  }
  return 0;
}
