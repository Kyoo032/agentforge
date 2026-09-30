import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { curateModel } from "./curation";
import { GATEWAY_BEST_FOR } from "./gateway-roles";
import { jobThinkingExtras } from "./job-thinking";
import {
  ANTHROPIC_MESSAGES_EFFORTS,
  GEMINI_EFFORTS,
  GPT_56_EFFORTS,
  GPT_6_EFFORTS,
  GPT_6_OFFABLE_EFFORTS,
  MODEL_POLICY_TABLE,
  NONE_TO_HIGH_EFFORTS,
  OFFICIAL_OPENAI_EFFORTS,
  TOKO_COMPLETIONS_EFFORTS,
  TOKO_RESPONSES_EFFORTS,
  UNKNOWN_MODEL_EFFORTS,
  allowedEffortsFor,
  floorEffort,
  modelPolicy,
  offFormatFor,
} from "./model-policy";
import { coerceReasoningEffortForModel, REASONING_LADDER } from "./reasoning-effort";
import { preferredOpenAiWire, usesResponsesApi } from "../runtime/api-mode";
import { resolveChatWire, usesAnthropicMessages, usesGeminiGenerateContent } from "../runtime/chat-wire";
import { allowedReasoningEfforts, snapReasoningEffort } from "../runtime/effort-allowlist";

/**
 * The golden file was recorded from the name-regex implementation before `model-policy.ts` existed
 * (`__fixtures__/model-policy-golden.json`). Every id the table calls known must still answer
 * byte for byte the way the regexes did, so moving the rules into one table changes no request.
 */
type Golden = {
  ids: Record<
    string,
    {
      autoWire: string;
      usesResponses: boolean;
      usesMessages: boolean;
      usesGemini: boolean;
      preferredOpenAiWire: string;
      coerceNone: string;
      jobThinking: Record<string, unknown> | null;
      curate: { friendlyLabel: string; bestFor: string; tier: string };
      snapAuto: string;
      allowed: Record<string, string[]>;
      snap: Record<string, string>;
    }
  >;
};

const golden = JSON.parse(
  readFileSync(new URL("./__fixtures__/model-policy-golden.json", import.meta.url), "utf8"),
) as Golden;

const WIRES = ["chat_completions", "responses", "anthropic_messages", "google_generate_content"] as const;

/**
 * The only places today's answer differs from the recording, all on purpose, all of 2026-09-30, all in
 * `curate` and nowhere on the wire: the wire, the levels, the snaps, the Off coercion and the job knob
 * of every recorded id are byte for byte the recording's.
 *
 * - The Recommended group changed (owner, 2026-09-30): `gpt-5.6-luna`, `gpt-5.6-terra`, `claude-sonnet-5`
 *   (and its dated snapshots), `MiniMax-M3` (both spellings) and `doubao-seed-2-1-turbo-260628` left it,
 *   so their tier is advanced now.
 * - `claude-opus-5-5` gained its best-for word (Deep reasoning); `deepseek-v4-1-flash` joined the
 *   Recommended group with Fast drafts.
 *
 * A stale line fails: each one must still differ from the recording, so it cannot outlive its cause.
 */
const CHANGED_ON_PURPOSE: Record<string, Partial<{ bestFor: string; tier: string }>> = {
  "gpt-5.6-luna": { tier: "advanced" },
  "gpt-5.6-terra": { tier: "advanced" },
  "claude-sonnet-5": { tier: "advanced" },
  "claude-sonnet-5-20250514": { tier: "advanced" },
  "anthropic/claude-sonnet-5-20250514": { tier: "advanced" },
  "MiniMax-M3": { tier: "advanced" },
  "minimax-m3": { tier: "advanced" },
  "doubao-seed-2-1-turbo-260628": { tier: "advanced" },
  "claude-opus-5-5": { bestFor: "Deep reasoning" },
  "deepseek-v4-1-flash": { bestFor: "Fast drafts", tier: "everyday" },
};

/** Roles that are not chat: the golden file lists them because `mediaKind` misfiles a few of them as chat. */
const NOT_CHAT_ROLES = new Set(["Image", "Video", "Audio", "Embedding", "Rerank", "Translation"]);

describe("golden master: every known id keeps its wire, levels and roles", () => {
  const knownIds = Object.keys(golden.ids).filter((id) => modelPolicy(id).known);

  it("recorded a real catalog, and the table knows every chat model in it", () => {
    expect(Object.keys(golden.ids).length).toBeGreaterThan(100);
    expect(knownIds.length).toBeGreaterThan(110);
    const chatIds = Object.keys(golden.ids).filter((id) => {
      const leaf = id.slice(id.lastIndexOf("/") + 1);
      return !NOT_CHAT_ROLES.has(GATEWAY_BEST_FOR[leaf.toLowerCase()] ?? "");
    });
    const unknown = chatIds.filter((id) => !modelPolicy(id).known);
    expect(unknown).toEqual([]);
  });

  it("answers the wire the regexes did", () => {
    for (const id of knownIds) {
      const before = golden.ids[id];
      expect(before, id).toBeDefined();
      expect(resolveChatWire("auto", id), id).toBe(before?.autoWire);
      expect(usesResponsesApi(id), id).toBe(before?.usesResponses);
      expect(usesAnthropicMessages(id), id).toBe(before?.usesMessages);
      expect(usesGeminiGenerateContent(id), id).toBe(before?.usesGemini);
      expect(preferredOpenAiWire(id), id).toBe(before?.preferredOpenAiWire);
    }
  });

  it("allows the levels the regexes did on every wire, with and without official OpenAI", () => {
    for (const id of knownIds) {
      for (const wire of WIRES) {
        for (const official of [false, true]) {
          expect(allowedReasoningEfforts(id, { wire, officialOpenAI: official }), `${id} ${wire} ${official}`).toEqual(
            golden.ids[id]?.allowed[`${wire}:${official}`],
          );
        }
      }
    }
  });

  it("snaps every requested level the way the regexes did", () => {
    for (const id of knownIds) {
      for (const wire of WIRES) {
        for (const official of [false, true]) {
          const got = REASONING_LADDER.map((requested) =>
            snapReasoningEffort(id, requested, { wire, officialOpenAI: official }),
          ).join(",");
          expect(got, `${id} ${wire} ${official}`).toBe(golden.ids[id]?.snap[`${wire}:${official}`]);
        }
      }
      const auto = REASONING_LADDER.map((requested) => snapReasoningEffort(id, requested)).join(",");
      expect(auto, id).toBe(golden.ids[id]?.snapAuto);
    }
  });

  it("keeps coerceReasoningEffortForModel, the job knob and the curation metadata", () => {
    for (const id of knownIds) {
      const before = golden.ids[id];
      expect(coerceReasoningEffortForModel(id, "none"), id).toBe(before?.coerceNone);
      expect(jobThinkingExtras(id, "finance"), id).toEqual(before?.jobThinking);
      expect(curateModel(id), id).toEqual({ ...before?.curate, ...CHANGED_ON_PURPOSE[id] });
    }
  });

  it("lists each intentional change once, and each still differs from the recording", () => {
    for (const [id, change] of Object.entries(CHANGED_ON_PURPOSE)) {
      const before = golden.ids[id];
      expect(before, `${id} is not in the recording`).toBeDefined();
      const recorded: Record<string, string> = { ...before?.curate };
      for (const [field, value] of Object.entries(change)) {
        expect(recorded[field], `${id} ${field}`).not.toBe(value);
      }
    }
  });
});

describe("the table", () => {
  it("has unique keys and a verified note on every entry", () => {
    const keys = MODEL_POLICY_TABLE.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of MODEL_POLICY_TABLE) {
      expect(entry.verified.trim().length, entry.key).toBeGreaterThan(10);
      expect(entry.ids !== undefined || entry.pattern !== undefined, entry.key).toBe(true);
    }
  });

  it("matches an exact bare id before a pattern that would also catch it, in table order", () => {
    // gpt-5-mini is the one gpt-5 id that stays on Completions, so it must sit ahead of the gpt-5 rule.
    expect(modelPolicy("gpt-5-mini").wire).toBe("chat_completions");
    expect(modelPolicy("gpt-5-nano").wire).toBe("responses");
    expect(modelPolicy("claude-sonnet-4-6").wire).toBe("anthropic_messages");
    expect(modelPolicy("claude-opus-4-6").wire).toBe("chat_completions");
  });

  it("matches on the bare id: vendor prefix, case and a date suffix do not hide a family", () => {
    expect(modelPolicy("openai/gpt-6").key).toBe(modelPolicy("gpt-6").key);
    expect(modelPolicy("MiniMax-M3").key).toBe(modelPolicy("minimax-m3").key);
    expect(modelPolicy("anthropic/claude-sonnet-5-20250514").wire).toBe("anthropic_messages");
    expect(modelPolicy("  GPT-5.6-Luna ").known).toBe(true);
  });
});

describe("known entries", () => {
  it("GPT-6 cannot be turned off: it floors Off to low and goes to Responses", () => {
    const policy = modelPolicy("gpt-6-astra");
    expect(policy.wire).toBe("responses");
    expect(allowedEffortsFor(policy, "responses", false)).toEqual([...GPT_6_EFFORTS]);
    expect(allowedEffortsFor(policy, "chat_completions", true)).toEqual([...GPT_6_EFFORTS]);
    expect(offFormatFor(policy, "responses")).toBe("floor");
    expect(floorEffort(policy)).toBe("low");
    expect(policy.tier).toBe("advanced");
    expect(policy.bestFor).toBe("Deep reasoning");
    expect(policy.verified).toMatch(/2026-09/);
  });

  it("GPT-6 Luna and Sol take none, so Off is sent as none and every level up to max is allowed", () => {
    for (const id of ["gpt-6-luna", "gpt-6-sol"]) {
      const policy = modelPolicy(id);
      expect(policy.known, id).toBe(true);
      expect(policy.wire, id).toBe("responses");
      expect(allowedEffortsFor(policy, "responses", false), id).toEqual([...GPT_6_OFFABLE_EFFORTS]);
      expect(allowedEffortsFor(policy, "chat_completions", true), id).toEqual([...GPT_6_OFFABLE_EFFORTS]);
      expect(offFormatFor(policy, "responses"), id).toBe("send_none");
      expect(coerceReasoningEffortForModel(id, "none"), id).toBe("none");
      expect(snapReasoningEffort(id, "none", { wire: "responses" }), id).toBe("none");
      expect(snapReasoningEffort(id, "ultra", { wire: "responses" }), id).toBe("max");
      expect(policy.verified, id).toMatch(/probe 2026-09-30/);
    }
    expect(modelPolicy("gpt-6-luna").tier).toBe("everyday");
    expect(modelPolicy("gpt-6-luna").bestFor).toBe("Fast drafts");
    expect(modelPolicy("gpt-6-sol").tier).toBe("everyday");
    expect(modelPolicy("gpt-6-sol").bestFor).toBe("Everyday chat");
  });

  it("GPT-6 Astra still floors Off to low, with its own entry now", () => {
    const policy = modelPolicy("gpt-6-astra");
    expect(policy.key).toBe("gpt-6-astra");
    expect(coerceReasoningEffortForModel("gpt-6-astra", "none")).toBe("low");
    expect(snapReasoningEffort("gpt-6-astra", "none", { wire: "responses" })).toBe("low");
    expect(policy.verified).toMatch(/probe 2026-09-30/);
  });

  it("a GPT-6 id with no entry of its own keeps the conservative rule: no none, Off floors to low", () => {
    for (const id of ["gpt-6", "openai/gpt-6", "gpt-6-terra", "gpt-6-luna-20260930"]) {
      const policy = modelPolicy(id);
      expect(policy.key, id).toBe("gpt-6");
      expect(allowedEffortsFor(policy, "responses", false), id).toEqual([...GPT_6_EFFORTS]);
      expect(offFormatFor(policy, "responses"), id).toBe("floor");
    }
    // Its tier and hint still come from the role table, dated snapshot included.
    expect(modelPolicy("gpt-6-luna-20260930").tier).toBe("everyday");
  });

  it("Claude Sonnet 5.5 and Opus 5.5 keep the Messages list and thinking.disabled for Off, with a probe note each", () => {
    for (const id of ["claude-sonnet-5-5", "claude-opus-5-5"]) {
      const policy = modelPolicy(id);
      expect(policy.key, id).toBe(id);
      expect(policy.wire, id).toBe("anthropic_messages");
      expect(allowedEffortsFor(policy, "anthropic_messages", false), id).toEqual([...ANTHROPIC_MESSAGES_EFFORTS]);
      expect(offFormatFor(policy, "anthropic_messages"), id).toBe("thinking_disabled");
      expect(policy.jobThinking, id).toBeNull();
      expect(policy.verified, id).toMatch(/probe 2026-09-30/);
    }
    expect(modelPolicy("claude-sonnet-5-5").tier).toBe("everyday");
    expect(modelPolicy("claude-sonnet-5-5").bestFor).toBe("Everyday chat");
    expect(modelPolicy("claude-opus-5-5").tier).toBe("advanced");
    expect(modelPolicy("claude-opus-5-5").bestFor).toBe("Deep reasoning");
    // Opus 5.5 Off is a capacity 503 in the probe, not a verdict: the note says so.
    expect(modelPolicy("claude-opus-5-5").verified).toMatch(/503/);
    // The dotted spelling and a dated snapshot stay with the family.
    expect(modelPolicy("claude-sonnet-5.5").key).toBe("claude-5");
  });

  it("DeepSeek V4.1 Flash keeps the family's wire, levels and job knob, with a probe note", () => {
    const policy = modelPolicy("deepseek-v4-1-flash");
    expect(policy.key).toBe("deepseek-v4-1-flash");
    expect(policy.wire).toBe("chat_completions");
    expect(allowedEffortsFor(policy, "chat_completions", false)).toEqual([...TOKO_COMPLETIONS_EFFORTS]);
    expect(policy.jobThinking).toEqual({ reasoning_effort: "low" });
    expect(policy.tier).toBe("everyday");
    expect(policy.bestFor).toBe("Fast drafts");
    expect(policy.verified).toMatch(/probe 2026-09-30/);
    // The dotted spelling still matches the family.
    expect(modelPolicy("deepseek-v4.1-flash").key).toBe("deepseek-v4");
  });

  it("hy3 is known: Completions, none through high, nothing above, no job knob, not recommended", () => {
    const policy = modelPolicy("hy3");
    expect(policy.known).toBe(true);
    expect(policy.key).toBe("hy3");
    expect(policy.wire).toBe("chat_completions");
    expect(allowedEffortsFor(policy, "chat_completions", false)).toEqual([...NONE_TO_HIGH_EFFORTS]);
    expect(offFormatFor(policy, "chat_completions")).toBe("send_none");
    expect(policy.jobThinking).toBeNull();
    expect(policy.tier).toBe("advanced");
    for (const requested of ["xhigh", "max", "ultra"] as const) {
      expect(snapReasoningEffort("hy3", requested, { wire: "chat_completions" }), requested).toBe("high");
    }
    expect(snapReasoningEffort("hy3", "none", { wire: "chat_completions" })).toBe("none");
    expect(policy.verified).toMatch(/probe 2026-09-30/);
    // Only the exact id: a neighbour is unknown until it is probed.
    expect(modelPolicy("hy3-preview").known).toBe(false);
    expect(modelPolicy("hy-3").known).toBe(false);
  });

  it("an id that only names Astra takes the GPT-6 levels but keeps the wire the name rules give it", () => {
    const policy = modelPolicy("astra-lite");
    expect(policy.key).toBe("astra");
    expect(policy.wire).toBe("auto");
    expect(allowedEffortsFor(policy, "chat_completions", false)).toEqual([...GPT_6_EFFORTS]);
    expect(offFormatFor(policy, "chat_completions")).toBe("floor");
    // It was never sent to Responses by name, and still is not.
    expect(resolveChatWire("auto", "astra-lite")).toBe("chat_completions");
    expect(resolveChatWire("auto", "openai/astra")).toBe("chat_completions");
    expect(resolveChatWire("auto", "gpt-6-astra")).toBe("responses");
  });

  it("GPT-5.6 keeps none and stops at max", () => {
    const policy = modelPolicy("gpt-5.6-luna");
    expect(allowedEffortsFor(policy, "responses", false)).toEqual([...GPT_56_EFFORTS]);
    expect(allowedEffortsFor(policy, "responses", true)).toEqual([...GPT_56_EFFORTS]);
    expect(offFormatFor(policy, "responses")).toBe("send_none");
    // Left the Recommended group on 2026-09-30 (GPT 6 Luna took its place); the hint is unchanged.
    expect(policy.tier).toBe("advanced");
    expect(policy.bestFor).toBe("Fast drafts");
  });

  it("other GPT-5 and o-series use the Toko Responses list, or the official one", () => {
    for (const id of ["gpt-5.5", "gpt-5.4-pro", "gpt-5", "o3", "o4-mini"]) {
      const policy = modelPolicy(id);
      expect(policy.wire, id).toBe("responses");
      expect(allowedEffortsFor(policy, "responses", false), id).toEqual([...TOKO_RESPONSES_EFFORTS]);
      expect(allowedEffortsFor(policy, "chat_completions", false), id).toEqual([...TOKO_COMPLETIONS_EFFORTS]);
      expect(allowedEffortsFor(policy, "responses", true), id).toEqual([...OFFICIAL_OPENAI_EFFORTS]);
    }
  });

  it("Claude 5 and the 4.x ids the gateway routes to Messages use the Messages list and disable thinking for Off", () => {
    for (const id of ["claude-sonnet-5", "claude-opus-5-5", "claude-fable-5-1", "claude-opus-4-8", "claude-sonnet-4.6"]) {
      const policy = modelPolicy(id);
      expect(policy.wire, id).toBe("anthropic_messages");
      expect(allowedEffortsFor(policy, "anthropic_messages", false), id).toEqual([...ANTHROPIC_MESSAGES_EFFORTS]);
      expect(offFormatFor(policy, "anthropic_messages"), id).toBe("thinking_disabled");
    }
  });

  it("Gemini chat goes to generateContent and snaps to none..high", () => {
    const policy = modelPolicy("gemini-3.6-flash");
    expect(policy.wire).toBe("google_generate_content");
    expect(allowedEffortsFor(policy, "google_generate_content", false)).toEqual([...GEMINI_EFFORTS]);
    expect(offFormatFor(policy, "google_generate_content")).toBe("thinking_disabled");
  });

  it("the quiet-thinking families carry the job knob, and only they do", () => {
    const quiet = ["deepseek-v4-flash", "deepseek-v4.1-flash", "glm-5.3", "glm-5.3-flash", "kimi-k3", "qwen3.8-max"];
    for (const id of quiet) {
      expect(modelPolicy(id).jobThinking, id).toEqual({ reasoning_effort: "low" });
    }
    for (const id of ["gpt-5.6-luna", "claude-opus-5", "glm-5.2-fast-preview", "qwen3.7-plus", "kimi-k2.6"]) {
      expect(modelPolicy(id).jobThinking, id).toBeNull();
    }
  });

  it("hands out a policy nobody can edit", () => {
    const policy = modelPolicy("deepseek-v4-flash");
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() => {
      (policy.jobThinking as Record<string, unknown>).reasoning_effort = "high";
    }).toThrow();
  });

  it("takes tier and best-for from the gateway roles, also for a dated snapshot", () => {
    expect(modelPolicy("claude-haiku-4-5-20251001").bestFor).toBe("Fast drafts");
    expect(modelPolicy("gpt-6-luna-20260930").tier).toBe("everyday");
    expect(modelPolicy("gpt-6-luna-20260930").bestFor).toBe("Fast drafts");
    expect(modelPolicy("gpt-5.6-terra").tier).toBe("advanced");
    expect(modelPolicy("gpt-5.5").tier).toBe("advanced");
  });

  it("says Image, Video or Audio for a media id the role table has no line for, and General chat for a chat id", () => {
    expect(modelPolicy("gpt-image-1").bestFor).toBe("Image");
    expect(modelPolicy("gpt-image-2.5-flare-token").bestFor).toBe("Image");
    expect(modelPolicy("seedance-2.0").bestFor).toBe("Video");
    expect(modelPolicy("gpt-4o-mini-tts").bestFor).toBe("Audio");
    expect(modelPolicy("gpt-image-1").known).toBe(false);
    expect(modelPolicy("some-new-lab-model-1").bestFor).toBe("General chat");
    // A role-table line still wins over the guess.
    expect(modelPolicy("gpt-image-2").bestFor).toBe("Image");
    expect(modelPolicy("qwen-mt-turbo").bestFor).toBe("Translation");
  });
});

describe("what a family does not get for free", () => {
  it("does not widen a proven rule to the next generation", () => {
    for (const id of [
      "gpt-7",
      "gpt-7-nova",
      "gpt-5.7-terra",
      "claude-opus-6",
      "deepseek-v5-flash",
      "glm-5.4",
      "kimi-k4",
      "qwen3.9-plus",
      "minimax-m4",
      "o5",
      "somebody-elses-model",
    ]) {
      expect(modelPolicy(id).known, id).toBe(false);
    }
  });

  it("still routes the next GPT to Responses through the name rule the code already had", () => {
    expect(modelPolicy("gpt-7").wire).toBe("auto");
    expect(resolveChatWire("auto", "gpt-7")).toBe("responses");
    expect(usesResponsesApi("gpt-7-nova")).toBe(true);
    expect(resolveChatWire("auto", "claude-opus-6")).toBe("chat_completions");
  });
});

describe("the unknown-model profile", () => {
  const policy = modelPolicy("some-new-lab-model-1");

  it("is conservative: low, medium, high only, on every wire", () => {
    expect(policy.known).toBe(false);
    expect([...UNKNOWN_MODEL_EFFORTS]).toEqual(["low", "medium", "high"]);
    for (const wire of WIRES) {
      for (const official of [false, true]) {
        expect(allowedEffortsFor(policy, wire, official), `${wire} ${official}`).toEqual(["low", "medium", "high"]);
      }
    }
  });

  it("sends no effort unless the person chose one, and omits the parameter for Off", () => {
    expect(policy.reasoning).toBe("explicit_only");
    expect(offFormatFor(policy, "chat_completions")).toBe("omit");
    expect(offFormatFor(policy, "responses")).toBe("omit");
  });

  it("snaps Extra, Max and Ultra to high and never to none", () => {
    for (const requested of ["xhigh", "max", "ultra"] as const) {
      expect(snapReasoningEffort("some-new-lab-model-1", requested, { wire: "chat_completions" })).toBe("high");
    }
    expect(snapReasoningEffort("some-new-lab-model-1", "minimal", { wire: "chat_completions" })).toBe("low");
  });

  it("is advanced and never everyday, whatever the role table says", () => {
    expect(policy.tier).toBe("advanced");
    expect(policy.bestFor).toBe("General chat");
    expect(curateModel("some-new-lab-model-1").tier).toBe("advanced");
    // Ids the roles table names but the behaviour table does not (image models) keep their role.
    expect(curateModel("gpt-image-2").bestFor).toBe("Image");
  });

  it("leaves the wire to the name rules", () => {
    expect(policy.wire).toBe("auto");
    expect(resolveChatWire("auto", "some-new-lab-model-1")).toBe("chat_completions");
  });

  it("has no job knob", () => {
    expect(policy.jobThinking).toBeNull();
    expect(jobThinkingExtras("some-new-lab-model-1", "finance")).toBeNull();
  });
});
