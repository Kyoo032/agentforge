import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  REASONING_LADDER,
  isPickerHidden,
  mediaKind,
  modelPolicy,
  resolveChatWire,
  type ReasoningEffort,
} from "@agentforge/core";
import { PROBE_USAGE, type ProbeArgs } from "./args";
import type { CatalogDiffDeps } from "./run-catalog-diff";
import { requireDataDir, requireEvalDesk } from "./credentials";
import type { ProbeCallRecord } from "./probe-call";
import type { ProbeRequest } from "./probe-request";
import { runProbe, type ModelProbe, type ProbeModelPlan, type ProbeRun } from "./probe-run";
import { proposePolicyEntry, summariseModel, type ModelSummary, type PolicyProposal } from "./snippet";

export type ProbeCommandDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  readSavedModels: CatalogDiffDeps["readSavedModels"];
  /**
   * What sends requests. Called only once every refusal check has passed, and never for `--dry-run`, so
   * a run that is refused, or only planned, has not so much as opened the desk's key.
   */
  makeSender: () => {
    host: string;
    baseUrl: string;
    send: (request: ProbeRequest, attempt: number) => Promise<ProbeCallRecord>;
  };
  sleep: (ms: number) => Promise<void>;
  out: (text: string) => void;
};

const BASE_LEVELS: readonly ReasoningEffort[] = ["none", "low", "medium", "high"];
const EXTRA_LEVELS: readonly ReasoningEffort[] = ["xhigh", "max"];
const RANK = new Map<ReasoningEffort, number>(REASONING_LADDER.map((level, index) => [level, index]));

/** Off, Light, Normal and Deep; Extra and Max only with `--extra`; or exactly `--levels`, in ladder order. */
export function planLevels(args: Pick<ProbeArgs, "levels" | "extra">): ReasoningEffort[] {
  const chosen = args.levels ?? [...BASE_LEVELS, ...(args.extra ? EXTRA_LEVELS : [])];
  return [...new Set(chosen)].sort((a, b) => (RANK.get(a) ?? 0) - (RANK.get(b) ?? 0));
}

/**
 * Who gets probed: every live chat id the policy table does not know (the ones nothing has ever been
 * verified about), plus any id passed with `--ids`, or only those with `--only-ids`. An id that is not a
 * chat model (an embedding, an image model, a rerank id) is never in the default set.
 */
export function selectProbeModels(
  savedIds: readonly string[],
  args: Pick<ProbeArgs, "ids" | "onlyIds" | "wire">,
): ProbeModelPlan[] {
  const catalogue = [...new Set(savedIds)];
  const byLower = new Map(catalogue.map((id) => [id.toLowerCase(), id]));
  const chat = catalogue.filter((id) => mediaKind(id) === "chat" && !isPickerHidden(id)).sort();
  const wanted = args.onlyIds ? [] : chat.filter((id) => !modelPolicy(id).known);
  const explicit = args.ids.map((id) => byLower.get(id.toLowerCase()) ?? id);

  const seen = new Set<string>();
  const plans: ProbeModelPlan[] = [];
  for (const id of [...wanted, ...explicit]) {
    const key = id.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const policy = modelPolicy(id);
    plans.push({
      id,
      wire: args.wire ?? resolveChatWire(undefined, id),
      inCatalog: byLower.has(key),
      policyKey: policy.known ? policy.key : "unknown",
    });
  }
  return plans;
}

function nominalCalls(models: number, levels: number): number {
  return models * (1 + levels);
}

function planText(input: {
  dataDir: string;
  models: readonly ProbeModelPlan[];
  levels: readonly ReasoningEffort[];
  args: ProbeArgs;
}): string {
  const { models, levels, args } = input;
  const nominal = nominalCalls(models.length, levels.length);
  return [
    `Probe plan (a dry run sends nothing)`,
    `  desk: ${input.dataDir}`,
    `  models (${models.length}):`,
    ...models.map(
      (model) => `    ${model.id}  [${model.wire}, policy ${model.policyKey}${model.inCatalog ? "" : ", not in the saved catalogue"}]`,
    ),
    `  levels: ${levels.join(", ")}  (after a baseline call with no effort parameter)`,
    `  calls: ${nominal} nominal, at most ${nominal + models.length * 2} if output budgets need adjusting; budget ${args.maxCalls}`,
    `  output tokens ${args.maxTokens} · pause ${args.delayMs} ms · timeout ${args.timeoutMs} ms · the runtime's self-heal is not involved`,
    "",
  ].join("\n");
}

function progressLine(index: number, record: ProbeCallRecord): string {
  const head = `[${index}] ${record.model.padEnd(28)} ${String(record.level).padEnd(9)}`;
  if (record.ok) {
    const tokens = record.usage
      ? ` tokens in/out/reasoning ${record.usage.inputTokens ?? "?"}/${record.usage.outputTokens ?? "?"}/${record.usage.reasoningTokens ?? "-"}`
      : "";
    return `${head} ${record.status}  ttft ${record.ttftMs ?? "-"} ms  total ${record.totalMs} ms${record.answered ? "" : "  (no answer text)"}${tokens}`;
  }
  const why = [record.errorCode, record.errorMessage?.slice(0, 90)].filter(Boolean).join(": ");
  return `${head} ${record.status || "no response"}  ${record.failureKind ?? "failed"}${why ? `  ${why}` : ""}  total ${record.totalMs} ms`;
}

function summaryText(summary: ModelSummary, proposal: PolicyProposal | null, probe: ModelProbe): string {
  const lines = [
    `MODEL ${summary.id}  [${summary.wire}, policy ${summary.policy.known ? summary.policy.key : "UNKNOWN"}]`,
  ];
  if (probe.skipped === "baseline_failed") {
    lines.push("  the baseline call failed, so no level was tried; see the trace for the gateway's answer");
  } else if (probe.skipped === "budget") {
    lines.push("  not reached: the call budget ran out first");
  } else {
    lines.push(
      `  accepted: ${summary.accepted.join(", ") || "nothing"}`,
      `  refused:  ${summary.refused.map((item) => `${item.level} (HTTP ${item.status})`).join(", ") || "nothing"}`,
    );
    if (summary.unclear.length > 0) {
      lines.push(`  no verdict: ${summary.unclear.join(", ")}`);
    }
    if (summary.notRun.length > 0) {
      lines.push(`  not tried (budget): ${summary.notRun.join(", ")}`);
    }
    lines.push(`  Off: ${summary.offFormat ?? "not decided"}`);
  }
  if (proposal?.snippet) {
    lines.push("", ...proposal.snippet.split("\n").map((line) => `  ${line}`));
  }
  for (const note of proposal?.notes ?? []) {
    lines.push(`  note: ${note}`);
  }
  return `${lines.join("\n")}\n`;
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/**
 * `probe`: one tiny real request per Thinking level per model, sequential, with a pause, a per-call
 * timeout and a hard budget, sent raw so the gateway's own behaviour is what gets recorded. Writes a
 * trace and, for a human to review, a proposed policy entry per model; it never edits the table.
 * Returns the exit code; a refusal is thrown for the entry point to print.
 */
export async function runProbeCommand(args: ProbeArgs, deps: ProbeCommandDeps): Promise<number> {
  if (args.help) {
    deps.out(PROBE_USAGE);
    return 0;
  }
  // A dry run calls nothing, so it needs only a desk; a real run needs the full set of refusals.
  const { dataDir } = args.dryRun ? requireDataDir(deps.env) : requireEvalDesk(deps.env);
  const saved = deps.readSavedModels();
  const models = selectProbeModels(
    saved.models.map((model) => model.id),
    args,
  );
  const levels = planLevels(args);

  if (models.length === 0) {
    deps.out(
      "Nothing to probe: every live chat id is already in the policy table. Pass --ids to probe a known model on purpose.\n",
    );
    return 0;
  }
  deps.out(planText({ dataDir, models, levels, args }));
  if (args.dryRun) {
    return 0;
  }

  const sender = deps.makeSender();
  deps.out(`  sending to ${sender.host}; the key is not printed or written anywhere\n\n`);
  const startedAt = deps.now();
  let index = 0;
  const run: ProbeRun = await runProbe({
    models,
    levels,
    baseUrl: sender.baseUrl,
    maxCalls: args.maxCalls,
    delayMs: args.delayMs,
    maxTokens: args.maxTokens,
    call: sender.send,
    sleep: deps.sleep,
    onRecord: (record) => {
      index += 1;
      deps.out(`${progressLine(index, record)}\n`);
    },
  });

  deps.out("\n");
  const results = run.models.map((probe) => {
    const summary = summariseModel(probe);
    const proposal = proposePolicyEntry(summary, { now: startedAt, tested: levels });
    deps.out(summaryText(summary, proposal, probe));
    return { ...probe, summary, proposal };
  });
  if (run.budgetExhausted) {
    deps.out(
      `\nThe budget of ${run.maxCalls} calls was used up: the run is incomplete (see notRun and skipped in the trace). Raise --max-calls or narrow --ids.\n`,
    );
  }

  mkdirSync(args.resultsDir, { recursive: true });
  const base = `probe-${stamp(startedAt)}`;
  const tracePath = join(args.resultsDir, `${base}.json`);
  const trace = {
    version: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: deps.now().toISOString(),
    desk: dataDir,
    gatewayHost: sender.host,
    options: {
      ids: args.ids,
      onlyIds: args.onlyIds,
      levels,
      wire: args.wire ?? "policy",
      maxCalls: args.maxCalls,
      delayMs: args.delayMs,
      timeoutMs: args.timeoutMs,
      maxTokens: args.maxTokens,
    },
    run: { callsUsed: run.callsUsed, maxCalls: run.maxCalls, budgetExhausted: run.budgetExhausted },
    models: results,
  };
  writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  deps.out(`\ntrace written: ${tracePath}\n`);

  const snippets = results.flatMap((result) => (result.proposal?.snippet ? [result.proposal.snippet] : []));
  if (snippets.length > 0) {
    const snippetPath = join(args.resultsDir, `${base}.snippets.txt`);
    writeFileSync(snippetPath, `${snippets.join("\n\n")}\n`, "utf8");
    deps.out(`proposed entries (for review, never applied): ${snippetPath}\n`);
  }
  return 0;
}
