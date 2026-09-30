import {
  REASONING_EFFORTS,
  REASONING_LADDER,
  allowedEffortsFor,
  bareModelId,
  modelPolicy,
  type EffortSlot,
  type OffFormat,
  type ReasoningEffort,
  type ResolvedChatWire,
} from "@agentforge/core";
import type { ProbeCallRecord } from "./probe-call";
import type { ModelProbe } from "./probe-run";

/** A level's verdict from the gateway. Only a 400 or 422 with the baseline passing is a refusal of that level. */
type Verdict = "accepted" | "refused" | "unclear";

export type LevelStat = {
  level: ReasoningEffort;
  status: number;
  ttftMs?: number;
  totalMs: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
};

export type ModelSummary = {
  id: string;
  wire: ResolvedChatWire;
  slot: EffortSlot;
  baselineOk: boolean;
  /** Levels the gateway took, in ladder order. */
  accepted: ReasoningEffort[];
  refused: Array<{ level: ReasoningEffort; status: number; code?: string; message?: string }>;
  /** Timeouts, rate limits, upstream errors and anything else that says nothing about the level. */
  unclear: ReasoningEffort[];
  notRun: ReasoningEffort[];
  /** Whether Off (`none`) was taken; undefined when it was not tried or gave no verdict. */
  offAccepted: boolean | undefined;
  /** The Off format the results point to; undefined when they do not say. */
  offFormat: OffFormat | undefined;
  policy: { key: string; known: boolean; allowed: ReasoningEffort[]; off: OffFormat };
  disagreements: {
    /** The table allows it and the gateway refused it. */
    policyTooWide: ReasoningEffort[];
    /** The gateway took it and the table would not send it. */
    policyTooNarrow: ReasoningEffort[];
  };
  levelStats: LevelStat[];
};

const RANK = new Map<ReasoningEffort, number>(REASONING_LADDER.map((level, index) => [level, index]));
const byLadder = (a: ReasoningEffort, b: ReasoningEffort) => (RANK.get(a) ?? 0) - (RANK.get(b) ?? 0);

function verdictOf(record: ProbeCallRecord): Verdict {
  if (record.ok) {
    return "accepted";
  }
  return record.status === 400 || record.status === 422 ? "refused" : "unclear";
}

/** The last record per level: a retry after an output-budget adjustment replaces the try it fixed. */
function finalPerLevel(records: readonly ProbeCallRecord[]): Map<ReasoningEffort, ProbeCallRecord> {
  const last = new Map<ReasoningEffort, ProbeCallRecord>();
  for (const record of records) {
    if (record.level !== "baseline") {
      last.set(record.level, record);
    }
  }
  return last;
}

function offFormatFrom(wire: ResolvedChatWire, offAccepted: boolean | undefined, others: number): OffFormat | undefined {
  if (offAccepted === undefined) {
    return undefined;
  }
  if (wire === "anthropic_messages" || wire === "google_generate_content") {
    return offAccepted ? "thinking_disabled" : "omit";
  }
  if (offAccepted) {
    return "send_none";
  }
  // Off refused: the model cannot be turned off. With other levels taken, the lowest of them stands in
  // for Off (`floor`); with none, sending nothing is all that is left.
  return others > 0 ? "floor" : "omit";
}

/** What one model's probe says, next to what the policy table says today. Pure. */
export function summariseModel(probe: ModelProbe): ModelSummary {
  const baselineFinal = [...probe.records].reverse().find((record) => record.level === "baseline");
  const finals = finalPerLevel(probe.records);
  const accepted: ReasoningEffort[] = [];
  const refused: ModelSummary["refused"] = [];
  const unclear: ReasoningEffort[] = [];
  const levelStats: LevelStat[] = [];

  for (const [level, record] of [...finals.entries()].sort(([a], [b]) => byLadder(a, b))) {
    const verdict = verdictOf(record);
    if (verdict === "accepted") {
      accepted.push(level);
    } else if (verdict === "refused") {
      refused.push({
        level,
        status: record.status,
        ...(record.errorCode === undefined ? {} : { code: record.errorCode }),
        ...(record.errorMessage === undefined ? {} : { message: record.errorMessage }),
      });
    } else {
      unclear.push(level);
    }
    levelStats.push({
      level,
      status: record.status,
      ...(record.ttftMs === undefined ? {} : { ttftMs: record.ttftMs }),
      totalMs: record.totalMs,
      ...(record.usage?.inputTokens === undefined ? {} : { inputTokens: record.usage.inputTokens }),
      ...(record.usage?.outputTokens === undefined ? {} : { outputTokens: record.usage.outputTokens }),
      ...(record.usage?.reasoningTokens === undefined ? {} : { reasoningTokens: record.usage.reasoningTokens }),
    });
  }

  const none = finals.get("none");
  const offVerdict = none === undefined ? undefined : verdictOf(none);
  const offAccepted = offVerdict === undefined || offVerdict === "unclear" ? undefined : offVerdict === "accepted";
  const policy = modelPolicy(probe.id);
  const allowed = allowedEffortsFor(policy, probe.wire, false);
  const refusedLevels = refused.map((item) => item.level);

  return {
    id: probe.id,
    wire: probe.wire,
    slot: probe.wire,
    baselineOk: baselineFinal?.ok === true,
    accepted,
    refused,
    unclear,
    notRun: [...probe.notRun],
    offAccepted,
    offFormat: offFormatFrom(probe.wire, offAccepted, accepted.filter((level) => level !== "none").length),
    policy: { key: policy.key, known: policy.known, allowed, off: policy.off },
    disagreements: {
      policyTooWide: refusedLevels.filter((level) => allowed.includes(level)).sort(byLadder),
      policyTooNarrow: accepted.filter((level) => !allowed.includes(level)),
    },
    levelStats,
  };
}

function slug(id: string): string {
  return bareModelId(id).replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

function verifiedNote(summary: ModelSummary, when: string, tested: readonly ReasoningEffort[]): string {
  const parts = [...tested]
    .sort(byLadder)
    .map((level) => {
      if (summary.accepted.includes(level)) {
        return `${level} ok`;
      }
      const refusal = summary.refused.find((item) => item.level === level);
      if (refusal) {
        const why = refusal.message ? `: ${refusal.message.length > 70 ? `${refusal.message.slice(0, 69)}…` : refusal.message}` : "";
        return `${level} refused (HTTP ${refusal.status}${why})`;
      }
      return summary.unclear.includes(level) ? `${level} no verdict` : `${level} not tried`;
    });
  return `${when} eval/models probe on ${summary.wire}: ${parts.join(", ")}. Proposed, not yet reviewed.`;
}

export type PolicyProposal = { snippet: string | null; notes: string[] };

/**
 * A `MODEL_POLICY_TABLE` entry for a human to review, plus the things to weigh before pasting it. It is
 * text: nothing here edits `model-policy.ts`. `null` when there is nothing to propose (the baseline
 * failed, so the probe says nothing about the model).
 */
export function proposePolicyEntry(
  summary: ModelSummary,
  options: { now: Date; tested: readonly ReasoningEffort[] },
): PolicyProposal | null {
  if (!summary.baselineOk) {
    return null;
  }
  const notes: string[] = [];
  const untried = REASONING_EFFORTS.filter((level) => !options.tested.includes(level));
  if (untried.length > 0) {
    notes.push(`not tried: ${untried.join(", ")}. The proposed levels list leaves them out; re-run with --extra or --levels to decide.`);
  }
  if (summary.unclear.length > 0) {
    notes.push(`no verdict (timeout, rate limit or upstream error) for: ${summary.unclear.join(", ")}. Re-run before trusting the list.`);
  }
  if (summary.disagreements.policyTooWide.length > 0 && summary.policy.known) {
    notes.push(`the table allows ${summary.disagreements.policyTooWide.join(", ")} but the gateway refused ${summary.disagreements.policyTooWide.length === 1 ? "it" : "them"}.`);
  }
  if (summary.disagreements.policyTooNarrow.length > 0) {
    notes.push(`the gateway took ${summary.disagreements.policyTooNarrow.join(", ")}, which the ${summary.policy.known ? "table" : "unknown-model profile"} would not send.`);
  }
  if (summary.offAccepted === undefined) {
    notes.push("Off was not tried or gave no verdict, so no off format is proposed.");
  }
  if (summary.accepted.length === 0) {
    notes.push(
      "no level was accepted while the baseline answered: the model takes no effort parameter, or refuses every value probed. The table has no way to say never send one; the runtime's heal drops it after one refused call.",
    );
    return { snippet: null, notes };
  }

  const when = options.now.toISOString().slice(0, 10);
  const lines = [
    `// Proposed for review, never applied (${when}, eval/models probe). Add it to MODEL_POLICY_TABLE above anything that also matches.`,
    "{",
    `  key: ${JSON.stringify(slug(summary.id))},`,
    `  ids: [${JSON.stringify(bareModelId(summary.id))}],`,
    `  wire: ${JSON.stringify(summary.wire)},`,
    `  efforts: { ${summary.slot}: [${summary.accepted.map((level) => JSON.stringify(level)).join(", ")}] },`,
    ...(summary.offFormat === "floor" || summary.offFormat === "omit" ? [`  off: ${JSON.stringify(summary.offFormat)},`] : []),
    `  verified: ${JSON.stringify(verifiedNote(summary, when, options.tested))},`,
    "},",
  ];
  return { snippet: lines.join("\n"), notes };
}
