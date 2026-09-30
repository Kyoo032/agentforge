import { allowedEffortsFor, modelPolicy, offFormatFor, type ModelPolicy } from "../models/model-policy";
import { closestReasoningEffort, type ReasoningEffort } from "../models/reasoning-effort";
import { bareModelId } from "../models/request-constraints";
import type { ResolvedChatWire } from "./chat-wire";
import {
  capEffortAtCeiling,
  classifyEffortRejection,
  learnedEffortLimit,
  limitFromHeal,
  rememberEffortLimit,
  saferEffortAction,
  type EffortRejection,
  type GatewayFailureDetail,
  type LearnedEffort,
  type LearnedEffortLimit,
} from "./effort-selfheal";

/**
 * What Thinking level a run puts on the wire, and how it backs off if the gateway refuses it.
 *
 * `planEffort` is the one place the request's level meets the model's policy: the allowed list of the
 * wire in use, how Off is written, whether a level nobody chose is sent at all, and anything the
 * runtime already learned about this model. `level: undefined` means send no effort parameter.
 */
export type EffortPlan = Readonly<{
  /** The level the request asked for, before the model had a say. */
  requested: ReasoningEffort;
  /** What goes on the wire; undefined sends no effort parameter at all. */
  level: ReasoningEffort | undefined;
}>;

type PlanInput = { requested: ReasoningEffort; explicit: boolean };
type PlanOptions = {
  wire: ResolvedChatWire;
  officialOpenAI?: boolean;
  /** Whose learned limits apply (the tenant); what one tenant's gateway key refused says nothing about another's. */
  scope?: string;
};

/** A learned refusal applied to the level the model's own list would have sent. */
function withLearned(
  level: ReasoningEffort,
  learned: LearnedEffort | undefined,
  allowed: readonly ReasoningEffort[],
): ReasoningEffort | undefined {
  if (!learned) {
    return level;
  }
  if (learned.drop) {
    return undefined;
  }
  const swap = learned.replace[level];
  const swapped = swap === undefined ? level : swap === "omit" ? undefined : swap;
  if (swapped === undefined) {
    return undefined;
  }
  return learned.ceiling ? capEffortAtCeiling(swapped, learned.ceiling, allowed) : swapped;
}

function levelFor(
  policy: ModelPolicy,
  input: PlanInput,
  options: PlanOptions,
  allowed: readonly ReasoningEffort[],
  learned: LearnedEffort | undefined,
): ReasoningEffort | undefined {
  if (learned?.drop) {
    return undefined;
  }
  if (policy.reasoning === "explicit_only" && !input.explicit) {
    return undefined;
  }
  if (input.requested === "none" && offFormatFor(policy, options.wire) === "omit") {
    return undefined;
  }
  return withLearned(closestReasoningEffort(input.requested, allowed), learned, allowed);
}

export function planEffort(modelId: string, input: PlanInput, options: PlanOptions): EffortPlan {
  const policy = modelPolicy(modelId);
  const allowed = allowedEffortsFor(policy, options.wire, options.officialOpenAI === true);
  const learned = learnedEffortLimit(modelId, options.scope);
  return { requested: input.requested, level: levelFor(policy, input, options, allowed, learned) };
}

/** The run's effort, shared by every request it makes: the first try, a wire fallback, a retry. */
export type EffortState = {
  /** What to put on the wire now; undefined sends no effort parameter at all. */
  level(): ReasoningEffort | undefined;
  /**
   * A gateway refused the request. When it refused the Thinking parameter, switch to a safer shape and
   * return true so the caller retries once. False when it is anything else, when no effort was sent,
   * or when this run has already healed once.
   */
  heal(failure: GatewayFailureDetail, wire: ResolvedChatWire): boolean;
  /** The retry after a heal has finished. A retry that answered teaches the model's limit; either way one line is logged. */
  settle(succeeded: boolean): void;
};

type Pending = { from: ReasoningEffort; to: ReasoningEffort | undefined; rejection: EffortRejection };

/** A model id is safe to print once it is a plain lower-case name. */
function loggableModel(modelId: string): string {
  return bareModelId(modelId).replace(/[^a-z0-9._:-]/g, "_").slice(0, 80);
}

export function createEffortState(args: {
  modelId: string;
  requested: ReasoningEffort;
  explicit: boolean;
  wire: ResolvedChatWire;
  officialOpenAI: boolean;
  scope?: string;
}): EffortState {
  const policy = modelPolicy(args.modelId);
  let current = planEffort(
    args.modelId,
    { requested: args.requested, explicit: args.explicit },
    { wire: args.wire, officialOpenAI: args.officialOpenAI, ...(args.scope === undefined ? {} : { scope: args.scope }) },
  ).level;
  let healed = false;
  let pending: Pending | undefined;

  return {
    level: () => current,
    heal(failure, wire) {
      if (healed) {
        return false;
      }
      const rejection = classifyEffortRejection(failure);
      if (!rejection) {
        return false;
      }
      const action = saferEffortAction(current, allowedEffortsFor(policy, wire, args.officialOpenAI), rejection);
      if (!action || current === undefined) {
        return false;
      }
      healed = true;
      pending = { from: current, to: action.action === "drop" ? undefined : action.level, rejection };
      current = pending.to;
      return true;
    },
    settle(succeeded) {
      const done = pending;
      pending = undefined;
      if (!done) {
        return;
      }
      if (succeeded) {
        const limit: LearnedEffortLimit = limitFromHeal(done.from, done.to, done.rejection);
        rememberEffortLimit(args.modelId, limit, args.scope);
      }
      // One line, no prompt, no key, no gateway body: the model and the levels are all it says.
      console.warn(
        `gateway: effort ${succeeded ? "limit learned" : "retry did not help"} model=${loggableModel(args.modelId)} requested=${done.from} ${succeeded ? "learned" : "tried"}=${done.to ?? "omitted"}`,
      );
    },
  };
}
