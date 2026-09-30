/**
 * Entry point of `pnpm --filter @agentforge/host eval:models:probe`. Thin wiring: the work is in
 * `run-probe.ts`, `probe-run.ts` and `probe-call.ts`, which the tests drive with fakes. This is the one
 * file that gives the desk's saved key to a real `fetch`, and only through `GatewayCredentials`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROBE_USAGE, UsageError, parseProbeArgs } from "./args";
import { EvalRefusal, loadGatewayCredentials, type SettingsLoader } from "./credentials";
import { makeProbeSender } from "./probe-call";
import { runProbeCommand } from "./run-probe";

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "results");

async function main(): Promise<number> {
  const args = parseProbeArgs(process.argv.slice(2), RESULTS_DIR);
  const { loadModelCache } = await import("../../src/model-cache");
  const { listProbedModels } = await import("../../src/selectable-models");
  // Only a run that sends needs the desk's settings; a dry run or --help never opens them.
  const loadSettings: SettingsLoader | undefined =
    args.dryRun || args.help ? undefined : (await import("../../src/settings-store")).loadSettings;

  return runProbeCommand(args, {
    env: process.env,
    now: () => new Date(),
    readSavedModels: () => {
      const cache = loadModelCache();
      return { models: listProbedModels(cache), probedAt: cache.openaiProbedAt, error: cache.openaiError };
    },
    makeSender: () => {
      if (!loadSettings) {
        throw new EvalRefusal("internal: a sender was asked for on a run that should not send");
      }
      const credentials = loadGatewayCredentials({ env: process.env, workspace: args.workspace, loadSettings });
      return {
        host: credentials.host,
        baseUrl: credentials.baseUrl,
        send: makeProbeSender({ credentials, fetch: globalThis.fetch, timeoutMs: args.timeoutMs, now: () => Date.now() }),
      };
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
      process.stderr.write(`${message}\n\n${PROBE_USAGE}`);
    } else if (error instanceof EvalRefusal) {
      process.stderr.write(`Refused: ${message}\n`);
    } else {
      process.stderr.write(`probe failed: ${message}\n`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = 2;
  },
);
