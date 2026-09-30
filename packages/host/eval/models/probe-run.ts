import type { ReasoningEffort, ResolvedChatWire } from "@agentforge/core";
import type { ProbeCallRecord } from "./probe-call";
import type { FailureKind } from "./probe-errors";
import { buildProbeRequest, type ProbeRequest, type TokenField } from "./probe-request";

/** A probe asks for a handful of tokens; a floor above this is not one this tool will chase. */
export const MAX_ADJUSTED_TOKENS = 1024;

/**
 * The hard stop. Every request the run makes, retries included, takes one; when none is left the run
 * ends and says which models it did not get to.
 */
export class CallBudget {
  #used = 0;
  #refused = false;

  constructor(readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error("a call budget is a positive whole number");
    }
  }

  take(): boolean {
    if (this.#used >= this.limit) {
      this.#refused = true;
      return false;
    }
    this.#used += 1;
    return true;
  }

  get used(): number {
    return this.#used;
  }

  get remaining(): number {
    return this.limit - this.#used;
  }

  /** True once a call was refused for want of budget (not merely when the last one was spent). */
  get exhausted(): boolean {
    return this.#refused || this.#used >= this.limit;
  }

  get refused(): boolean {
    return this.#refused;
  }
}

export type ProbeModelPlan = {
  id: string;
  wire: ResolvedChatWire;
  /** Whether the saved catalogue lists it (an id passed with --ids may not be). */
  inCatalog: boolean;
  /** The policy entry's key, or `unknown`. */
  policyKey: string;
};

export type ModelProbe = {
  id: string;
  wire: ResolvedChatWire;
  inCatalog: boolean;
  policyKey: string;
  records: ProbeCallRecord[];
  /** Why no levels were tried: the baseline call failed, or the budget ran out first. */
  skipped?: "baseline_failed" | "budget";
  /** Levels that were planned and not tried. */
  notRun: ReasoningEffort[];
};

export type ProbeRun = {
  models: ModelProbe[];
  callsUsed: number;
  maxCalls: number;
  /** A call was refused for want of budget: the run is incomplete and `notRun` says where. */
  budgetExhausted: boolean;
};

export type ProbeRunInput = {
  models: readonly ProbeModelPlan[];
  /** In the order to try them. */
  levels: readonly ReasoningEffort[];
  baseUrl: string;
  maxCalls: number;
  delayMs: number;
  maxTokens: number;
  call: (request: ProbeRequest, attempt: number) => Promise<ProbeCallRecord>;
  sleep: (ms: number) => Promise<void>;
  onRecord?: (record: ProbeCallRecord) => void;
};

type ModelState = { maxTokens: number; tokenField: TokenField };

function adjustedState(state: ModelState, record: ProbeCallRecord, done: ReadonlySet<FailureKind>): ModelState | undefined {
  if (record.ok || done.has(record.failureKind ?? "other")) {
    return undefined;
  }
  if (record.failureKind === "token_floor") {
    const wanted = record.tokenFloor ?? state.maxTokens * 2;
    const next = Math.min(MAX_ADJUSTED_TOKENS, wanted);
    return next > state.maxTokens ? { ...state, maxTokens: next } : undefined;
  }
  if (record.failureKind === "token_field" && record.wire === "chat_completions") {
    return { ...state, tokenField: state.tokenField === "max_tokens" ? "max_completion_tokens" : "max_tokens" };
  }
  return undefined;
}

/**
 * The plan: for each model a baseline call with no effort parameter (so a refusal later can be told
 * from a model that is simply unreachable), then one call per level, sequential, with a pause. A refused
 * output budget is adjusted once and retried; the self-heal is not involved because nothing here goes
 * through the runtime: each request is built and sent raw.
 */
export async function runProbe(input: ProbeRunInput): Promise<ProbeRun> {
  const budget = new CallBudget(input.maxCalls);
  const models: ModelProbe[] = [];
  let made = 0;

  const send = async (request: ProbeRequest, attempt: number): Promise<ProbeCallRecord> => {
    if (made > 0 && input.delayMs > 0) {
      await input.sleep(input.delayMs);
    }
    made += 1;
    const record = await input.call(request, attempt);
    input.onRecord?.(record);
    return record;
  };

  for (const plan of input.models) {
    let state: ModelState = { maxTokens: input.maxTokens, tokenField: "max_tokens" };
    const adjusted = new Set<FailureKind>();
    const records: ProbeCallRecord[] = [];
    const notRun: ReasoningEffort[] = [];

    /**
     * One call, plus a retry each time the gateway refuses the output budget rather than the level: its
     * spelling, then its floor, each adjusted once per model, so a call is tried at most three times and
     * what was learned is kept for the model's later calls. `undefined` is a refusal for want of budget.
     */
    const attemptLevel = async (level: ReasoningEffort | undefined): Promise<ProbeCallRecord | undefined> => {
      const build = () =>
        buildProbeRequest({ model: plan.id, wire: plan.wire, baseUrl: input.baseUrl, level, ...state });
      if (!budget.take()) {
        return undefined;
      }
      let attempt = 1;
      let record = await send(build(), attempt);
      records.push(record);
      for (;;) {
        const next = adjustedState(state, record, adjusted);
        if (!next) {
          return record;
        }
        adjusted.add(record.failureKind ?? "other");
        state = next;
        if (!budget.take()) {
          return record;
        }
        attempt += 1;
        record = await send(build(), attempt);
        records.push(record);
      }
    };

    const base: Omit<ModelProbe, "records" | "notRun"> = {
      id: plan.id,
      wire: plan.wire,
      inCatalog: plan.inCatalog,
      policyKey: plan.policyKey,
    };

    const baseline = await attemptLevel(undefined);
    if (!baseline?.ok) {
      models.push({
        ...base,
        records,
        skipped: baseline ? "baseline_failed" : "budget",
        notRun: [...input.levels],
      });
      continue;
    }

    for (const level of input.levels) {
      // `undefined` is a refusal for want of budget, which also marks the run as cut short.
      if ((await attemptLevel(level)) === undefined) {
        notRun.push(level);
      }
    }
    models.push({ ...base, records, notRun });
  }

  return { models, callsUsed: budget.used, maxCalls: input.maxCalls, budgetExhausted: budget.refused };
}
