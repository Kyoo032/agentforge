import type { ResolvedChatWire } from "../runtime/chat-wire";
import { EVERYDAY_MODEL_IDS, GATEWAY_BEST_FOR } from "./gateway-roles";
import { mediaKind } from "./media-kind";
import type { ReasoningEffort } from "./reasoning-effort";
import { bareModelId } from "./request-constraints";

/**
 * How each gateway model is CALLED, in one place.
 *
 * New models reach the picker on their own (`GET /v1/models`). What the picker cannot say is how a
 * model wants to be called: which wire, which Thinking levels it accepts, how Off is spelled, and
 * whether a job should ask it to think less. That used to be guessed from name regexes scattered over
 * `chat-wire.ts`, `api-mode.ts`, `effort-allowlist.ts`, `reasoning-effort.ts`, `job-thinking.ts`,
 * `curation.ts` and `preferred.ts`. They all ask `modelPolicy(id)` now.
 *
 * **Adding a model.** Add an entry to `MODEL_POLICY_TABLE`, above anything that would also match it,
 * with a `verified` note that says when and how the behaviour was seen (a probe, a driven call, a
 * vendor page) or, honestly, that it is carried over unverified. Do not widen a family pattern to the
 * next generation because it "probably" behaves the same: an id no entry matches gets the
 * conservative unknown profile below, which cannot make the gateway answer 400 by itself.
 *
 * **Roles.** Tier (Recommended or not) and best-for are per-id facts kept in `gateway-roles.ts`; the
 * lookup lays them over the behaviour entry, so `modelPolicy` is still the single answer. An id the
 * role table has no line for gets Image, Video or Audio from `mediaKind`, and General chat otherwise.
 */

/** Toko Completions: pass through including ultra. Keep xhigh/max so they are not snapped to ultra. */
export const TOKO_COMPLETIONS_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

/** Official OpenAI Completions + Responses. No ultra. */
export const OFFICIAL_OPENAI_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** GPT-5.6 Sol/Terra/Luna: none is allowed; no minimal; no ultra. */
export const GPT_56_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

/** GPT-6 Astra, and any GPT-6 id not listed by name: no none (start at low); no ultra. */
export const GPT_6_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/**
 * GPT-6 Luna and Sol: none is allowed (probe 2026-09-30: none, low, medium, high all answered 200); no
 * ultra. xhigh and max are carried over from the GPT-6 rule and were not tried.
 */
export const GPT_6_OFFABLE_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

/** A model whose probe took none, low, medium and high and was not asked for more (hy3, 2026-09-30). */
export const NONE_TO_HIGH_EFFORTS = ["none", "low", "medium", "high"] as const;

/** Anthropic Messages `output_config.effort`. Off is thinking.disabled. No ultra. */
export const ANTHROPIC_MESSAGES_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

/** Gemini thinkingConfig. Extra/Max/Ultra snap to Deep (`high`). */
export const GEMINI_EFFORTS = ["none", "low", "medium", "high"] as const;

/** Toko Responses: ultra is unproven — snap Ultra to max. */
export const TOKO_RESPONSES_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * An id no entry matches. Three levels every reasoning gateway accepts, no Off value, nothing above
 * Deep: Extra, Max and Ultra snap to `high`.
 */
export const UNKNOWN_MODEL_EFFORTS = ["low", "medium", "high"] as const;

export type ModelTier = "everyday" | "advanced";

/** The wire a model prefers. `auto` leaves it to the name rules in `chat-wire.ts` / `api-mode.ts`. */
export type ModelWirePreference = ResolvedChatWire | "auto";

/**
 * How Off reaches the wire.
 * - `send_none`: the level `none` itself.
 * - `floor`: the model cannot be turned off; Off becomes its lowest level.
 * - `omit`: send no effort parameter at all.
 * - `thinking_disabled`: the wire's own switch (Messages `thinking: {type: "disabled"}`, Gemini
 *   `thinkingBudget: 0`). Applied whatever the entry says on those two wires, except `omit`.
 */
export type OffFormat = "send_none" | "floor" | "omit" | "thinking_disabled";

/** `always`: the resolved level is sent every time. `explicit_only`: only when the person chose one. */
export type ReasoningDefault = "always" | "explicit_only";

export type EffortSlot =
  | "responses"
  | "chat_completions"
  | "official_openai"
  | "anthropic_messages"
  | "google_generate_content";

export type EffortLevels = readonly ReasoningEffort[];

export type ModelPolicyEntry = {
  /** Stable name for tests and the log. */
  key: string;
  /** Exact bare ids (lower case, no vendor prefix). */
  ids?: readonly string[];
  /** Tested against the bare id. Never global. */
  pattern?: RegExp;
  /** The pattern only applies to ids `mediaKind` calls chat (a Gemini image id is not a chat model). */
  chatOnly?: boolean;
  wire: ModelWirePreference;
  /** Levels per wire. A slot left out gets the gateway default for that wire. */
  efforts?: Partial<Record<EffortSlot, EffortLevels>>;
  /** Off on the OpenAI-shaped wires. Default `send_none`. */
  off?: OffFormat;
  /** Default `always`. */
  reasoning?: ReasoningDefault;
  /** Extra chat-completions body fields a job sends so a thinking model answers sooner. */
  jobThinking?: Readonly<Record<string, unknown>>;
  tier?: ModelTier;
  bestFor?: string;
  /** When and how the behaviour was seen, or that it is carried over unverified. Never empty. */
  verified: string;
};

export type ModelPolicy = Readonly<{
  key: string;
  /** False only for an id no entry matches. */
  known: boolean;
  wire: ModelWirePreference;
  efforts: Readonly<Record<EffortSlot, EffortLevels>>;
  off: OffFormat;
  reasoning: ReasoningDefault;
  jobThinking: Readonly<Record<string, unknown>> | null;
  tier: ModelTier;
  bestFor: string;
  verified: string;
}>;

const WIRE_DEFAULT_EFFORTS: Readonly<Record<EffortSlot, EffortLevels>> = Object.freeze({
  responses: TOKO_RESPONSES_EFFORTS,
  chat_completions: TOKO_COMPLETIONS_EFFORTS,
  official_openai: OFFICIAL_OPENAI_EFFORTS,
  anthropic_messages: ANTHROPIC_MESSAGES_EFFORTS,
  google_generate_content: GEMINI_EFFORTS,
});

const UNKNOWN_EFFORTS: Readonly<Record<EffortSlot, EffortLevels>> = Object.freeze({
  responses: UNKNOWN_MODEL_EFFORTS,
  chat_completions: UNKNOWN_MODEL_EFFORTS,
  official_openai: UNKNOWN_MODEL_EFFORTS,
  anthropic_messages: UNKNOWN_MODEL_EFFORTS,
  google_generate_content: UNKNOWN_MODEL_EFFORTS,
});

const GPT_6_LEVELS: Partial<Record<EffortSlot, EffortLevels>> = {
  responses: GPT_6_EFFORTS,
  chat_completions: GPT_6_EFFORTS,
  official_openai: GPT_6_EFFORTS,
};

const GPT_6_OFFABLE_LEVELS: Partial<Record<EffortSlot, EffortLevels>> = {
  responses: GPT_6_OFFABLE_EFFORTS,
  chat_completions: GPT_6_OFFABLE_EFFORTS,
  official_openai: GPT_6_OFFABLE_EFFORTS,
};

const NONE_TO_HIGH_LEVELS: Partial<Record<EffortSlot, EffortLevels>> = {
  responses: NONE_TO_HIGH_EFFORTS,
  chat_completions: NONE_TO_HIGH_EFFORTS,
  official_openai: NONE_TO_HIGH_EFFORTS,
};

const GPT_56_LEVELS: Partial<Record<EffortSlot, EffortLevels>> = {
  responses: GPT_56_EFFORTS,
  chat_completions: GPT_56_EFFORTS,
  official_openai: GPT_56_EFFORTS,
};

const QUIET_JOB_KNOB = Object.freeze({ reasoning_effort: "low" });

const SHIPPED =
  "Carried over from the name rules that shipped before this table (2026-09-30): the id is sent reasoning_effort as-is; levels not re-probed.";

/**
 * Ordered: the first entry that matches wins, so an exact or narrower entry sits above the wider one.
 * Patterns are anchored on the family and its proven generations on purpose.
 */
export const MODEL_POLICY_TABLE: readonly ModelPolicyEntry[] = Object.freeze([
  {
    key: "gpt-6-luna",
    ids: ["gpt-6-luna"],
    wire: "responses",
    efforts: GPT_6_OFFABLE_LEVELS,
    verified:
      "probe 2026-09-30 (eval/models, raw Responses requests): reasoning.effort none, low, medium and high all answered HTTP 200, first token about 2 s; also driven through the running :3000 app at high, none and the default (owner's report: all 200, no heal). xhigh and max are carried over from the GPT-6 rule, not tried. Unlike Astra it takes none, so Off is sent as none.",
  },
  {
    key: "gpt-6-sol",
    ids: ["gpt-6-sol"],
    wire: "responses",
    efforts: GPT_6_OFFABLE_LEVELS,
    verified:
      "probe 2026-09-30 (eval/models, raw Responses requests): reasoning.effort none, low, medium and high all answered HTTP 200, first token 2 to 5 s (none was the slow one, 5 s). xhigh and max are carried over from the GPT-6 rule, not tried. Unlike Astra it takes none, so Off is sent as none.",
  },
  {
    key: "gpt-6-astra",
    ids: ["gpt-6-astra"],
    wire: "responses",
    efforts: GPT_6_LEVELS,
    off: "floor",
    verified:
      "probe 2026-09-30 (eval/models, raw Responses requests): none refused (HTTP 400 Unsupported value none), low, medium and high answered 200, first token 5 to 7 s; also driven through the running :3000 app with Off (owner's report: 200, no heal). xhigh and max are carried over, not tried.",
  },
  {
    key: "gpt-6",
    pattern: /^gpt-6/,
    wire: "responses",
    efforts: GPT_6_LEVELS,
    off: "floor",
    verified:
      "2026-09-13 docs/internal/gateway-model-selection.md section 3: reasoning.effort low..max, none is HTTP 400, so Off floors to low. Any GPT-6 id without an entry of its own keeps this conservative rule; Luna, Sol and Astra have theirs (probe 2026-09-30).",
  },
  {
    // The allowlist has always treated any id naming Astra as GPT-6 for levels only; the wire stays
    // with the name rules, as it did.
    key: "astra",
    pattern: /astra/,
    wire: "auto",
    efforts: GPT_6_LEVELS,
    off: "floor",
    verified:
      "Carried over from the effort allowlist (2026-09-30): an id containing astra takes the GPT-6 levels; same source as gpt-6, wire left to the name rules.",
  },
  {
    key: "gpt-5.6",
    pattern: /^gpt-5\.6/,
    wire: "responses",
    efforts: GPT_56_LEVELS,
    verified:
      "2026-09-13 docs/internal/gateway-model-selection.md section 3: none..xhigh plus max; on Responses because Completions answers 400 to tools (api-mode.ts).",
  },
  {
    key: "gpt-5-mini",
    pattern: /^gpt-5-mini/,
    wire: "chat_completions",
    verified: `Stays on Completions, the Hermes/OpenCode rule api-mode.ts always carried. ${SHIPPED}`,
  },
  {
    key: "openai-responses",
    pattern: /^(?:gpt-5(?:$|-|\.[0-5](?:$|[^0-9]))|o[1-4](?:$|[-._]))/,
    wire: "responses",
    verified:
      "2026-09-13 docs/internal/gateway-model-selection.md section 3 (GPT-5.x and o-series on reasoning.effort); Toko Responses list kept as shipped.",
  },
  {
    key: "openai-completions",
    pattern: /^(?:gpt-4|gpt-oss|chatgpt)/,
    wire: "chat_completions",
    verified: `Non-reasoning OpenAI ids (docs/internal/gateway-model-selection.md section 3). ${SHIPPED}`,
  },
  {
    key: "claude-sonnet-5-5",
    ids: ["claude-sonnet-5-5"],
    wire: "anthropic_messages",
    verified:
      "probe 2026-09-30 (eval/models, raw Messages requests): thinking disabled (Off), and adaptive thinking with output_config.effort low, medium and high all answered HTTP 200, first token about 2 to 4 s (the Off call took 31 s to finish in total: one sample, unexplained). Levels stay the Messages list of the claude-5 family: xhigh and max were not tried.",
  },
  {
    key: "claude-opus-5-5",
    ids: ["claude-opus-5-5"],
    wire: "anthropic_messages",
    verified:
      "probe 2026-09-30 (eval/models, raw Messages requests): output_config.effort low, medium and high answered HTTP 200 (first token 3 s, high 9 s). Off (thinking disabled) got a 503 supply pool unavailable: capacity, not a verdict on the parameter, so Off stays thinking.disabled as for the claude-5 family. xhigh and max were not tried.",
  },
  {
    key: "claude-5",
    pattern: /^claude-(?:opus|sonnet|haiku|fable)-5(?:$|[^0-9])/,
    wire: "anthropic_messages",
    verified:
      "2026-09-13 docs/internal/gateway-model-selection.md section 3 and chat-wire.test.ts: Messages, adaptive thinking plus output_config.effort, Off is thinking.disabled.",
  },
  {
    key: "claude-4-messages",
    pattern: /^claude-(?:sonnet-4[.-]6|opus-4[.-][78])(?:$|[^0-9])/,
    wire: "anthropic_messages",
    verified:
      "2026-09-13 docs/internal/gateway-model-selection.md section 3 and chat-wire.test.ts: Sonnet 4.6 and Opus 4.7/4.8 use adaptive thinking on Messages.",
  },
  {
    key: "claude-4-completions",
    pattern: /^claude-(?:(?:opus|sonnet|haiku)-4|4)/,
    wire: "chat_completions",
    verified: `Haiku 4.5, Opus 4.5 and 4.6 stay on Completions (chat-wire.ts). ${SHIPPED}`,
  },
  {
    key: "gemini",
    pattern: /^gemini/,
    chatOnly: true,
    wire: "google_generate_content",
    verified:
      "2026-09-13 docs/internal/gateway-model-selection.md section 3 and effort-allowlist.test.ts: generateContent thinkingConfig, none..high.",
  },
  {
    key: "deepseek-v4-1-flash",
    ids: ["deepseek-v4-1-flash"],
    wire: "chat_completions",
    jobThinking: QUIET_JOB_KNOB,
    verified:
      "probe 2026-09-30 (eval/models, raw Completions requests): reasoning_effort none, low, medium and high all answered HTTP 200, first token 1.3 to 1.9 s; low is also the job knob's value, so the knob is seen accepted on this id. Levels above high stay the Completions defaults: not tried.",
  },
  {
    key: "deepseek-v4",
    pattern: /^deepseek-v4/,
    wire: "chat_completions",
    jobThinking: QUIET_JOB_KNOB,
    verified:
      "2026-09-15 driven against the gateway: reasoning_effort low answers HTTP 200, thinking.disabled answers 400 (job-thinking.ts).",
  },
  {
    key: "glm-5.3",
    pattern: /^glm-5\.3/,
    wire: "chat_completions",
    jobThinking: QUIET_JOB_KNOB,
    verified: "2026-09-15 driven against the gateway: reasoning_effort low answers HTTP 200 (job-thinking.ts).",
  },
  {
    key: "glm-5",
    pattern: /^glm-5(?:\.[0-2])?(?:$|[^0-9.])/,
    wire: "chat_completions",
    verified: `GLM 5 and 5.2. ${SHIPPED}`,
  },
  {
    key: "kimi-k3",
    pattern: /^kimi-k3/,
    wire: "chat_completions",
    jobThinking: QUIET_JOB_KNOB,
    verified:
      "2026-09-15 job-thinking.ts: Chat already sends reasoning_effort to this id on every turn, so the job knob is the same field; not driven on its own.",
  },
  {
    key: "kimi-k2",
    pattern: /^kimi-k2(?:\.\d+)?(?:$|[^0-9.])/,
    wire: "chat_completions",
    verified: `Kimi K2.x. ${SHIPPED}`,
  },
  {
    key: "qwen3.8-max",
    pattern: /^qwen3\.8-max/,
    wire: "chat_completions",
    jobThinking: QUIET_JOB_KNOB,
    verified:
      "2026-09-15 job-thinking.ts: the vendor enable_thinking field has never been seen accepted, so it gets the reasoning_effort knob Chat already sends; not driven on its own.",
  },
  {
    key: "qwen",
    pattern: /^qwen(?:3(?:\.[5-8])?)?-/,
    wire: "chat_completions",
    verified: `Qwen 3 to 3.8 and the unversioned qwen-* ids. ${SHIPPED}`,
  },
  {
    key: "minimax",
    pattern: /^minimax-m(?:2\.\d|3)(?:$|[^0-9.])/,
    wire: "chat_completions",
    verified: `MiniMax M2.x and M3 (their reasoning rides minimax-compat.ts). ${SHIPPED}`,
  },
  {
    key: "doubao-seed",
    pattern: /^(?:doubao-seed-2-[01](?:$|[^0-9])|seed-(?:1\.[68]|2\.0)(?:$|[^0-9.]))/,
    wire: "chat_completions",
    verified: `Doubao Seed 2.x and Seed 1.6 to 2.0. ${SHIPPED}`,
  },
  {
    key: "gui-plus",
    ids: ["gui-plus"],
    wire: "chat_completions",
    verified: SHIPPED,
  },
  {
    key: "hy3",
    ids: ["hy3"],
    wire: "chat_completions",
    efforts: NONE_TO_HIGH_LEVELS,
    verified:
      "probe 2026-09-30 (eval/models, raw Completions requests): reasoning_effort none, low, medium and high all answered HTTP 200, first token 2 to 2.8 s; it thinks a little by default (13 to 24 reasoning tokens on a one-word prompt, 0 at none). xhigh and max were not tried, so they are left out and snap to high. No job knob: nothing seen says jobs need one.",
  },
] satisfies ModelPolicyEntry[]);

const DATED_SUFFIX = /-\d{8}$/;

function entryMatches(entry: ModelPolicyEntry, id: string): boolean {
  if (entry.ids?.includes(id)) {
    return true;
  }
  if (!entry.pattern) {
    return false;
  }
  if (entry.chatOnly && mediaKind(id) !== "chat") {
    return false;
  }
  return entry.pattern.test(id);
}

function roleFor(id: string): { bestFor: string | undefined; everyday: boolean } {
  const stripped = id.replace(DATED_SUFFIX, "");
  return {
    bestFor: GATEWAY_BEST_FOR[id] ?? GATEWAY_BEST_FOR[stripped],
    everyday: EVERYDAY_MODEL_IDS.has(id) || EVERYDAY_MODEL_IDS.has(stripped),
  };
}

/** The best-for word an id gets from what it is, when the role table has no line for it. */
function mediaHint(id: string): string | undefined {
  switch (mediaKind(id)) {
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    default:
      return undefined;
  }
}

function resolveEfforts(entry: ModelPolicyEntry): Readonly<Record<EffortSlot, EffortLevels>> {
  return Object.freeze({ ...WIRE_DEFAULT_EFFORTS, ...entry.efforts });
}

/**
 * Everything the runtime needs to call `modelId`. Matches the bare id (vendor prefix, case and outer
 * whitespace stripped) against the table in order; an id nothing matches gets the conservative
 * unknown profile: low/medium/high only, no effort sent unless the person chose one, Off omits the
 * parameter, tier advanced, wire left to the name rules.
 */
export function modelPolicy(modelId: string): ModelPolicy {
  const id = bareModelId(modelId);
  const entry = MODEL_POLICY_TABLE.find((candidate) => entryMatches(candidate, id));
  const role = roleFor(id);
  if (!entry) {
    return Object.freeze({
      key: "unknown",
      known: false,
      wire: "auto",
      efforts: UNKNOWN_EFFORTS,
      off: "omit",
      reasoning: "explicit_only",
      jobThinking: null,
      tier: "advanced",
      bestFor: role.bestFor ?? mediaHint(id) ?? "General chat",
      verified: "Not in the table: conservative profile, nothing about this id has been seen.",
    });
  }
  return Object.freeze({
    key: entry.key,
    known: true,
    wire: entry.wire,
    efforts: resolveEfforts(entry),
    off: entry.off ?? "send_none",
    reasoning: entry.reasoning ?? "always",
    jobThinking: entry.jobThinking ?? null,
    tier: role.everyday ? "everyday" : (entry.tier ?? "advanced"),
    bestFor: role.bestFor ?? entry.bestFor ?? mediaHint(id) ?? "General chat",
    verified: entry.verified,
  });
}

/**
 * The levels `policy` accepts on `wire`. Messages and generateContent have their own lists whatever
 * the model; on the OpenAI-shaped wires the official-OpenAI list comes first, then Responses, then
 * Completions — the order the allowlist always used.
 */
export function allowedEffortsFor(
  policy: ModelPolicy,
  wire: ResolvedChatWire,
  officialOpenAI: boolean,
): ReasoningEffort[] {
  if (wire === "anthropic_messages") {
    return [...policy.efforts.anthropic_messages];
  }
  if (wire === "google_generate_content") {
    return [...policy.efforts.google_generate_content];
  }
  if (officialOpenAI) {
    return [...policy.efforts.official_openai];
  }
  return [...(wire === "responses" ? policy.efforts.responses : policy.efforts.chat_completions)];
}

/** How Off is written for `policy` on `wire`. */
export function offFormatFor(policy: ModelPolicy, wire: ResolvedChatWire): OffFormat {
  if (policy.off === "omit") {
    return "omit";
  }
  if (wire === "anthropic_messages" || wire === "google_generate_content") {
    return "thinking_disabled";
  }
  return policy.off;
}

/** The lowest level a model that cannot be turned off accepts (GPT-6: `low`). */
export function floorEffort(policy: ModelPolicy): ReasoningEffort | undefined {
  return policy.efforts.responses.find((level) => level !== "none");
}
