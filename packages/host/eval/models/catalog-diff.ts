/**
 * Entry point of `pnpm --filter @agentforge/host eval:models:diff`. Thin wiring: the work is in
 * `run-catalog-diff.ts`, which the tests drive with fakes. Reads the desk named by AGENTFORGE_DATA_DIR.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { probeOpenAIModels, resolvedGatewayBaseUrl } from "@agentforge/core";
import { CATALOG_DIFF_USAGE, UsageError, parseCatalogDiffArgs } from "./args";
import { EvalRefusal, loadGatewayCredentials } from "./credentials";
import { loadPriceLookup } from "./pricing";
import { runCatalogDiff } from "./run-catalog-diff";

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "results");

async function main(): Promise<number> {
  const args = parseCatalogDiffArgs(process.argv.slice(2), RESULTS_DIR);
  // The host's own modules, loaded after the arguments are read so `--help` costs nothing.
  const { loadModelCache } = await import("../../src/model-cache");
  const { listProbedModels } = await import("../../src/selectable-models");
  const { loadSettings } = await import("../../src/settings-store");

  return runCatalogDiff(args, {
    env: process.env,
    now: () => new Date(),
    readSavedModels: () => {
      const cache = loadModelCache();
      return { models: listProbedModels(cache), probedAt: cache.openaiProbedAt, error: cache.openaiError };
    },
    // The very call the host's own refresh makes for this gateway (`GET <endpoint>/models`), but the
    // answer goes into the report only: the desk's saved cache is never written.
    fetchLiveModels: async (workspace) => {
      const credentials = loadGatewayCredentials({ env: process.env, workspace, loadSettings });
      return credentials.withKey((apiKey) => probeOpenAIModels({ baseURL: credentials.baseUrl, apiKey }));
    },
    loadPrices: () => loadPriceLookup({ baseUrl: resolvedGatewayBaseUrl() }),
    out: (text) => {
      process.stdout.write(text);
    },
  });
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : "The run failed.";
    if (error instanceof UsageError) {
      process.stderr.write(`${message}\n\n${CATALOG_DIFF_USAGE}`);
    } else if (error instanceof EvalRefusal) {
      process.stderr.write(`Refused: ${message}\n`);
    } else {
      process.stderr.write(`catalog-diff failed: ${message}\n`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = 2;
  },
);
