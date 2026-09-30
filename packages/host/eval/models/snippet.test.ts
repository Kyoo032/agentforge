import { describe, expect, it } from "vitest";
import type { ReasoningEffort } from "@agentforge/core";
import type { ProbeCallRecord } from "./probe-call";
import type { ModelProbe } from "./probe-run";
import { proposePolicyEntry, summariseModel } from "./snippet";

const NOW = new Date("2026-09-30T10:00:00Z");

function rec(level: ReasoningEffort | "baseline", over: Partial<ProbeCallRecord> = {}): ProbeCallRecord {
  return {
    model: "new-model-1",
    wire: "chat_completions",
    level,
    sends: level === "baseline" ? "no effort parameter" : `reasoning_effort=${level}`,
    maxTokens: 32,
    tokenField: "max_tokens",
    attempt: 1,
    status: 200,
    ok: true,
    totalMs: 900,
    ttftMs: 300,
    answered: true,
    ...over,
  };
}

const refused = (level: ReasoningEffort, message = "Unsupported value", over: Partial<ProbeCallRecord> = {}) =>
  rec(level, { ok: false, status: 400, errorMessage: message, errorCode: "unsupported_value", failureKind: "other", answered: false, ...over });

function probe(records: ProbeCallRecord[], over: Partial<ModelProbe> = {}): ModelProbe {
  return {
    id: "new-model-1",
    wire: "chat_completions",
    inCatalog: true,
    policyKey: "unknown",
    records,
    notRun: [],
    ...over,
  };
}

describe("summariseModel", () => {
  it("reads which levels the gateway took, which it refused, and that Off was refused", () => {
    const summary = summariseModel(
      probe([rec("baseline"), refused("none", "Unsupported value: 'none'"), rec("low"), rec("medium"), rec("high")]),
    );
    expect(summary.baselineOk).toBe(true);
    expect(summary.accepted).toEqual(["low", "medium", "high"]);
    expect(summary.refused.map((item) => item.level)).toEqual(["none"]);
    expect(summary.refused[0]).toMatchObject({ status: 400, code: "unsupported_value", message: "Unsupported value: 'none'" });
    expect(summary.offAccepted).toBe(false);
    expect(summary.offFormat).toBe("floor");
    expect(summary.slot).toBe("chat_completions");
  });

  it("gives no verdict for a level that timed out, was rate limited, or failed upstream", () => {
    const summary = summariseModel(
      probe([
        rec("baseline"),
        rec("low", { ok: false, status: 0, failureKind: "timeout" }),
        rec("medium", { ok: false, status: 429 }),
        rec("high", { ok: false, status: 503 }),
        rec("xhigh", { ok: false, status: 401 }),
      ]),
    );
    expect(summary.accepted).toEqual([]);
    expect(summary.refused).toEqual([]);
    expect(summary.unclear).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("lets the retry after an output-budget adjustment decide the level", () => {
    const summary = summariseModel(
      probe([
        rec("baseline"),
        rec("low", { ok: false, status: 400, failureKind: "token_floor", tokenFloor: 64 }),
        rec("low", { attempt: 2, maxTokens: 64 }),
      ]),
    );
    expect(summary.accepted).toEqual(["low"]);
    expect(summary.refused).toEqual([]);
  });

  it("orders accepted levels along the ladder whatever order they were probed in", () => {
    const summary = summariseModel(probe([rec("baseline"), rec("high"), rec("none"), rec("low")]));
    expect(summary.accepted).toEqual(["none", "low", "high"]);
  });

  it("proposes send_none for an OpenAI-shaped model that took Off", () => {
    const summary = summariseModel(probe([rec("baseline"), rec("none"), rec("low")], { wire: "responses" }));
    expect(summary.offAccepted).toBe(true);
    expect(summary.offFormat).toBe("send_none");
    expect(summary.slot).toBe("responses");
  });

  it("proposes thinking_disabled on Messages and generateContent when Off was taken, omit when it was not", () => {
    const took = summariseModel(probe([rec("baseline"), rec("none")], { wire: "anthropic_messages" }));
    expect(took.offFormat).toBe("thinking_disabled");
    const refusedOff = summariseModel(probe([rec("baseline"), refused("none")], { wire: "google_generate_content" }));
    expect(refusedOff.offFormat).toBe("omit");
    expect(refusedOff.slot).toBe("google_generate_content");
  });

  it("says nothing about Off when Off was not tried or gave no verdict", () => {
    expect(summariseModel(probe([rec("baseline"), rec("low")])).offFormat).toBeUndefined();
    expect(summariseModel(probe([rec("baseline"), rec("none", { ok: false, status: 0, failureKind: "timeout" })])).offAccepted).toBeUndefined();
  });

  it("marks a model whose baseline failed, with nothing accepted", () => {
    const summary = summariseModel(
      probe([rec("baseline", { ok: false, status: 404 })], { skipped: "baseline_failed", notRun: ["none", "low"] }),
    );
    expect(summary.baselineOk).toBe(false);
    expect(summary.accepted).toEqual([]);
    expect(summary.notRun).toEqual(["none", "low"]);
  });

  it("compares with what the policy says today, both ways", () => {
    // `gpt-6-nova` is an id only the family entry knows: Luna, Sol and Astra have entries of their own since
    // the 2026-09-30 probe, so a real one would no longer disagree about Off.
    const summary = summariseModel(
      probe([rec("baseline"), rec("none"), rec("low"), rec("high"), refused("max")], { id: "gpt-6-nova", wire: "responses", policyKey: "gpt-6" }),
    );
    expect(summary.policy).toMatchObject({ key: "gpt-6", known: true });
    expect(summary.policy.allowed).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // The policy says GPT-6 allows max and cannot be turned off; the gateway said the opposite on both.
    expect(summary.disagreements.policyTooWide).toEqual(["max"]);
    expect(summary.disagreements.policyTooNarrow).toEqual(["none"]);
  });

  it("shows what the unknown profile would snap that the gateway takes", () => {
    const summary = summariseModel(probe([rec("baseline"), rec("high"), rec("xhigh"), rec("max")]));
    expect(summary.policy.known).toBe(false);
    expect(summary.disagreements.policyTooNarrow).toEqual(["xhigh", "max"]);
    expect(summary.disagreements.policyTooWide).toEqual([]);
  });

  it("keeps per-level timing and token facts, so it is visible whether a level changes anything", () => {
    const summary = summariseModel(
      probe([
        rec("baseline", { usage: { outputTokens: 5 } }),
        rec("low", { ttftMs: 200, totalMs: 400, usage: { inputTokens: 9, outputTokens: 12, reasoningTokens: 8 } }),
        rec("high", { ttftMs: 900, totalMs: 1500, usage: { inputTokens: 9, outputTokens: 30, reasoningTokens: 26 } }),
      ]),
    );
    expect(summary.levelStats).toEqual([
      { level: "low", status: 200, ttftMs: 200, totalMs: 400, inputTokens: 9, outputTokens: 12, reasoningTokens: 8 },
      { level: "high", status: 200, ttftMs: 900, totalMs: 1500, inputTokens: 9, outputTokens: 30, reasoningTokens: 26 },
    ]);
  });
});

describe("proposePolicyEntry", () => {
  const TESTED: ReasoningEffort[] = ["none", "low", "medium", "high"];

  /** The snippet is a TypeScript object literal; evaluating it proves it is well formed. */
  function evaluate(snippet: string): Record<string, unknown> {
    const body = snippet.replace(/^\s*\/\/.*$/gm, "").trim().replace(/,$/, "");
    return new Function(`return (${body});`)() as Record<string, unknown>;
  }

  it("writes an entry for review: id, wire, the levels that were taken, the Off format, and how it was seen", () => {
    const summary = summariseModel(
      probe([rec("baseline"), refused("none", "Unsupported value: 'none' for reasoning_effort"), rec("low"), rec("medium"), rec("high")]),
    );
    const proposal = proposePolicyEntry(summary, { now: NOW, tested: TESTED });
    expect(proposal).not.toBeNull();
    const entry = evaluate(proposal?.snippet ?? "");
    expect(entry).toMatchObject({
      key: "new-model-1",
      ids: ["new-model-1"],
      wire: "chat_completions",
      efforts: { chat_completions: ["low", "medium", "high"] },
      off: "floor",
    });
    expect(String(entry.verified)).toContain("2026-09-30");
    expect(String(entry.verified)).toContain("eval/models probe");
    expect(String(entry.verified)).toContain("none refused");
    expect(proposal?.snippet).toMatch(/^\/\/ Proposed/);
  });

  it("leaves the off line out when Off is sent as none, the default", () => {
    const summary = summariseModel(probe([rec("baseline"), rec("none"), rec("low"), rec("medium"), rec("high")], { wire: "responses" }));
    const entry = evaluate(proposePolicyEntry(summary, { now: NOW, tested: TESTED })?.snippet ?? "");
    expect("off" in entry).toBe(false);
    expect(entry).toMatchObject({ wire: "responses", efforts: { responses: ["none", "low", "medium", "high"] } });
  });

  it("proposes omit on Messages when thinking cannot be disabled", () => {
    const summary = summariseModel(probe([rec("baseline"), refused("none"), rec("low")], { wire: "anthropic_messages" }));
    const entry = evaluate(proposePolicyEntry(summary, { now: NOW, tested: ["none", "low"] })?.snippet ?? "");
    expect(entry).toMatchObject({ wire: "anthropic_messages", off: "omit", efforts: { anthropic_messages: ["low"] } });
  });

  it("says which levels were not tried, so a missing Extra or Max is not read as refused", () => {
    const summary = summariseModel(probe([rec("baseline"), rec("none"), rec("low"), rec("medium"), rec("high")]));
    const proposal = proposePolicyEntry(summary, { now: NOW, tested: TESTED });
    expect(proposal?.notes.join(" ")).toMatch(/not tried: xhigh, max, ultra/);
  });

  it("says where a level gave no verdict", () => {
    const summary = summariseModel(probe([rec("baseline"), rec("low"), rec("high", { ok: false, status: 503 })]));
    const proposal = proposePolicyEntry(summary, { now: NOW, tested: ["low", "high"] });
    expect(proposal?.notes.join(" ")).toMatch(/no verdict.*high/);
  });

  it("notes a disagreement with the table for a known model", () => {
    const summary = summariseModel(
      probe([rec("baseline"), rec("low"), refused("max")], { id: "gpt-6-nova", wire: "responses", policyKey: "gpt-6" }),
    );
    const proposal = proposePolicyEntry(summary, { now: NOW, tested: ["low", "max"] });
    expect(proposal?.notes.join(" ")).toMatch(/table allows max/);
  });

  it("proposes nothing for a model whose baseline failed", () => {
    const summary = summariseModel(probe([rec("baseline", { ok: false, status: 404 })], { skipped: "baseline_failed", notRun: TESTED }));
    expect(proposePolicyEntry(summary, { now: NOW, tested: TESTED })).toBeNull();
  });

  it("proposes nothing, and says so, when no level was taken", () => {
    const summary = summariseModel(probe([rec("baseline"), refused("none"), refused("low"), refused("medium"), refused("high")]));
    const proposal = proposePolicyEntry(summary, { now: NOW, tested: TESTED });
    expect(proposal?.snippet).toBeNull();
    expect(proposal?.notes.join(" ")).toMatch(/no level was accepted/i);
  });

  it("quotes a gateway message safely inside the note and holds no credential word", () => {
    const summary = summariseModel(
      probe([rec("baseline"), refused("none", 'Unsupported value: "none" \\ end'), rec("low")]),
    );
    const proposal = proposePolicyEntry(summary, { now: NOW, tested: ["none", "low"] });
    expect(() => evaluate(proposal?.snippet ?? "")).not.toThrow();
    expect(proposal?.snippet).not.toMatch(/authorization|bearer|api[-_ ]?key/i);
  });

  it("makes a key out of an id with awkward characters", () => {
    const summary = summariseModel(probe([rec("baseline"), rec("low")], { id: "Vendor/New Model_2.5" }));
    const entry = evaluate(proposePolicyEntry(summary, { now: NOW, tested: ["low"] })?.snippet ?? "");
    expect(entry.key).toBe("new-model-2.5");
    // The table matches the bare id: vendor prefix off, lower case.
    expect(entry.ids).toEqual(["new model_2.5"]);
  });
});
