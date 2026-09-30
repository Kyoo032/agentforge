import { parseArgs } from "node:util";
import { CHAT_WIRES, REASONING_LADDER, type ReasoningEffort, type ResolvedChatWire } from "@agentforge/core";

/** A command line the tool refuses. The message is the whole explanation; nothing here is a secret. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type CatalogDiffArgs = {
  /** Ask the gateway for its model list now (into a scratch cache, never the desk's own). */
  refresh: boolean;
  /** Print each model's price from the gateway's public price list. */
  prices: boolean;
  /** Write this run's snapshot to the results folder, so the next run can diff against it. */
  save: boolean;
  json: boolean;
  resultsDir: string;
  workspace: string | undefined;
  help: boolean;
};

export type ProbeArgs = {
  ids: string[];
  /** Probe only `ids`; skip the live chat ids the policy table does not know. */
  onlyIds: boolean;
  /** Add Extra and Max to Off, Light, Normal and Deep. */
  extra: boolean;
  /** An explicit list of levels, replacing the default set. */
  levels: ReasoningEffort[] | undefined;
  /** Send every model on this wire instead of the one the policy picks. */
  wire: ResolvedChatWire | undefined;
  maxCalls: number;
  delayMs: number;
  timeoutMs: number;
  maxTokens: number;
  /** Print the plan and stop before the first call. */
  dryRun: boolean;
  resultsDir: string;
  workspace: string | undefined;
  help: boolean;
};

export const DEFAULT_MAX_CALLS = 60;
/** A typo of a budget ("--max-calls 6000") stops here rather than spending it. */
export const MAX_CALLS_CEILING = 1000;
export const DEFAULT_DELAY_MS = 750;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_TOKENS = 32;

export const CATALOG_DIFF_USAGE = `catalog-diff: which live model ids the policy table knows, and what changed since the last run.

  AGENTFORGE_DATA_DIR=<desk> pnpm --filter @agentforge/host eval:models:diff [flags]

  --refresh          ask the gateway for its model list now (needs a saved key). It goes into a scratch cache
                     under the results folder; the desk's own cache is never written.
  --no-prices        skip the gateway's public price list
  --no-save          do not write this run's snapshot
  --json             print the report as JSON
  --out <dir>        results folder (default: eval/models/results)
  --workspace <id>   which desk's key --refresh uses (default: the selected desk)
  --help
`;

export const PROBE_USAGE = `probe: one tiny real request per Thinking level per model, raw, with the self-heal off.

  AGENTFORGE_DATA_DIR=<desk> pnpm --filter @agentforge/host eval:models:probe [flags]

  --ids a,b          also probe these ids (default set: every live chat id the policy table does not know)
  --only-ids         probe only --ids
  --extra            add Extra and Max to Off, Light, Normal and Deep
  --levels a,b       replace the level set (none,minimal,low,medium,high,xhigh,max,ultra)
  --wire <wire>      chat_completions | responses | anthropic_messages | google_generate_content
  --max-calls <n>    hard budget of requests, retries included (default ${DEFAULT_MAX_CALLS}, ceiling ${MAX_CALLS_CEILING})
  --delay-ms <n>     pause between requests (default ${DEFAULT_DELAY_MS})
  --timeout-ms <n>   per-request timeout (default ${DEFAULT_TIMEOUT_MS})
  --max-tokens <n>   output tokens per request (default ${DEFAULT_MAX_TOKENS}; raised once if the gateway names a floor)
  --dry-run          print the plan and the worst-case call count, then stop
  --out <dir>        results folder (default: eval/models/results)
  --workspace <id>   which desk's key to use (default: the selected desk)
  --help

Refuses to run with AGENTFORGE_RUNTIME=stub, with no AGENTFORGE_DATA_DIR, or with no saved gateway key.
`;

function parse<T extends Record<string, { type: "boolean" | "string" }>>(argv: string[], options: T) {
  try {
    return parseArgs({ args: argv, options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : "Could not read the command line");
  }
}

function whole(name: string, raw: string | undefined, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(value) || value < min || value > max) {
    const range = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `between ${min} and ${max}`;
    throw new UsageError(`${name} must be a whole number ${range}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function list(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return [...new Set(raw.split(",").map((part) => part.trim()).filter(Boolean))];
}

function levelsFrom(raw: string | undefined): ReasoningEffort[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const words = list(raw);
  if (words.length === 0) {
    throw new UsageError("--levels needs at least one level");
  }
  const known = new Set<string>(REASONING_LADDER);
  const bad = words.filter((word) => !known.has(word));
  if (bad.length > 0) {
    throw new UsageError(`--levels does not know ${bad.join(", ")}; use ${REASONING_LADDER.join(", ")}`);
  }
  return words as ReasoningEffort[];
}

function wireFrom(raw: string | undefined): ResolvedChatWire | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const concrete = CHAT_WIRES.filter((wire): wire is ResolvedChatWire => wire !== "auto");
  if (!(concrete as readonly string[]).includes(raw)) {
    throw new UsageError(`--wire must be one of ${concrete.join(", ")}, got ${JSON.stringify(raw)}`);
  }
  return raw as ResolvedChatWire;
}

export function parseCatalogDiffArgs(argv: string[], defaultResultsDir: string): CatalogDiffArgs {
  const values = parse(argv, {
    refresh: { type: "boolean" },
    "no-prices": { type: "boolean" },
    "no-save": { type: "boolean" },
    json: { type: "boolean" },
    out: { type: "string" },
    workspace: { type: "string" },
    help: { type: "boolean" },
  });
  return {
    refresh: values.refresh === true,
    prices: values["no-prices"] !== true,
    save: values["no-save"] !== true,
    json: values.json === true,
    resultsDir: values.out ?? defaultResultsDir,
    workspace: values.workspace,
    help: values.help === true,
  };
}

export function parseProbeArgs(argv: string[], defaultResultsDir: string): ProbeArgs {
  const values = parse(argv, {
    ids: { type: "string" },
    "only-ids": { type: "boolean" },
    extra: { type: "boolean" },
    levels: { type: "string" },
    wire: { type: "string" },
    "max-calls": { type: "string" },
    "delay-ms": { type: "string" },
    "timeout-ms": { type: "string" },
    "max-tokens": { type: "string" },
    "dry-run": { type: "boolean" },
    out: { type: "string" },
    workspace: { type: "string" },
    help: { type: "boolean" },
  });
  const ids = list(values.ids);
  const onlyIds = values["only-ids"] === true;
  if (onlyIds && ids.length === 0 && values.help !== true) {
    throw new UsageError("--only-ids needs --ids to say which models");
  }
  return {
    ids,
    onlyIds,
    extra: values.extra === true,
    levels: levelsFrom(values.levels),
    wire: wireFrom(values.wire),
    maxCalls: whole("--max-calls", values["max-calls"], DEFAULT_MAX_CALLS, 1, MAX_CALLS_CEILING),
    delayMs: whole("--delay-ms", values["delay-ms"], DEFAULT_DELAY_MS, 0),
    timeoutMs: whole("--timeout-ms", values["timeout-ms"], DEFAULT_TIMEOUT_MS, 1),
    maxTokens: whole("--max-tokens", values["max-tokens"], DEFAULT_MAX_TOKENS, 1),
    dryRun: values["dry-run"] === true,
    resultsDir: values.out ?? defaultResultsDir,
    workspace: values.workspace,
    help: values.help === true,
  };
}
