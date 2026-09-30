import { describe, expect, it } from "vitest";
import type { ReasoningEffort } from "@agentforge/core";
import type { ProbeCallRecord } from "./probe-call";
import { CallBudget, MAX_ADJUSTED_TOKENS, runProbe, type ProbeModelPlan } from "./probe-run";
import type { ProbeRequest } from "./probe-request";

const BASE = "https://gateway.example.test/v1";

function record(request: ProbeRequest, attempt: number, over: Partial<ProbeCallRecord> = {}): ProbeCallRecord {
  return {
    model: request.model,
    wire: request.wire,
    level: request.level ?? "baseline",
    sends: request.sends,
    maxTokens: request.maxTokens,
    tokenField: request.tokenField,
    attempt,
    status: 200,
    ok: true,
    totalMs: 10,
    answered: true,
    ...over,
  };
}

type Script = (request: ProbeRequest, attempt: number, index: number) => Partial<ProbeCallRecord> | undefined;

function harness(script: Script = () => undefined) {
  const requests: Array<{ request: ProbeRequest; attempt: number }> = [];
  const sleeps: number[] = [];
  const seen: ProbeCallRecord[] = [];
  return {
    requests,
    sleeps,
    seen,
    call: async (request: ProbeRequest, attempt: number) => {
      requests.push({ request, attempt });
      return record(request, attempt, script(request, attempt, requests.length - 1));
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    onRecord: (r: ProbeCallRecord) => {
      seen.push(r);
    },
  };
}

const LEVELS: ReasoningEffort[] = ["none", "low", "medium", "high"];
const model = (id: string, wire: ProbeModelPlan["wire"] = "chat_completions"): ProbeModelPlan => ({
  id,
  wire,
  inCatalog: true,
  policyKey: "unknown",
});

function input(h: ReturnType<typeof harness>, models: ProbeModelPlan[], over: Partial<Parameters<typeof runProbe>[0]> = {}) {
  return { models, levels: LEVELS, baseUrl: BASE, maxCalls: 60, delayMs: 100, maxTokens: 32, call: h.call, sleep: h.sleep, onRecord: h.onRecord, ...over };
}

describe("CallBudget", () => {
  it("hands out exactly as many calls as it was given", () => {
    const budget = new CallBudget(2);
    expect([budget.take(), budget.take(), budget.take(), budget.take()]).toEqual([true, true, false, false]);
    expect(budget.used).toBe(2);
    expect(budget.remaining).toBe(0);
    expect(budget.exhausted).toBe(true);
  });

  it("refuses a budget that is not a positive whole number", () => {
    expect(() => new CallBudget(0)).toThrow();
    expect(() => new CallBudget(1.5)).toThrow();
  });
});

describe("runProbe", () => {
  it("makes a baseline call and then one call per level, in order, for each model", async () => {
    const h = harness();
    const run = await runProbe(input(h, [model("a"), model("b", "responses")]));
    expect(h.requests.map(({ request }) => `${request.model}:${request.level ?? "baseline"}`)).toEqual([
      "a:baseline", "a:none", "a:low", "a:medium", "a:high",
      "b:baseline", "b:none", "b:low", "b:medium", "b:high",
    ]);
    expect(h.requests.map(({ request }) => request.wire)).toEqual([...Array(5).fill("chat_completions"), ...Array(5).fill("responses")]);
    expect(run.callsUsed).toBe(10);
    expect(run.budgetExhausted).toBe(false);
    expect(run.models.map((m) => m.records.length)).toEqual([5, 5]);
    expect(h.seen).toHaveLength(10);
  });

  it("stops probing a model whose baseline fails, and says why, without spending its levels", async () => {
    const h = harness((request) => (request.model === "a" && request.level === undefined ? { ok: false, status: 404, failureKind: "other" } : undefined));
    const run = await runProbe(input(h, [model("a"), model("b")]));
    expect(h.requests.filter(({ request }) => request.model === "a")).toHaveLength(1);
    expect(run.models[0]).toMatchObject({ id: "a", skipped: "baseline_failed", notRun: LEVELS });
    expect(run.models[1]?.records).toHaveLength(5);
  });

  it("never makes more calls than the budget, and marks what it did not get to", async () => {
    const h = harness();
    const run = await runProbe(input(h, [model("a"), model("b")], { maxCalls: 3 }));
    expect(h.requests).toHaveLength(3);
    expect(run.callsUsed).toBe(3);
    expect(run.budgetExhausted).toBe(true);
    expect(run.models[0]).toMatchObject({ id: "a", notRun: ["medium", "high"] });
    expect(run.models[1]).toMatchObject({ id: "b", skipped: "budget", notRun: LEVELS });
    expect(run.models[1]?.records).toEqual([]);
  });

  it("counts a retry against the same budget", async () => {
    const h = harness((_request, attempt) =>
      attempt === 1 ? { ok: false, status: 400, failureKind: "token_floor", tokenFloor: 64 } : undefined,
    );
    const run = await runProbe(input(h, [model("a")], { maxCalls: 2 }));
    expect(h.requests).toHaveLength(2);
    expect(run.callsUsed).toBe(2);
    expect(run.budgetExhausted).toBe(true);
  });

  it("does not retry when the floor the gateway named is under what it already sent", async () => {
    const h = harness(() => ({ ok: false, status: 400, failureKind: "token_floor", tokenFloor: 16 }));
    const run = await runProbe(input(h, [model("a", "responses")]));
    expect(h.requests).toHaveLength(1);
    expect(run.models[0]).toMatchObject({ skipped: "baseline_failed" });
  });

  it("retries with the floor when the request was under it", async () => {
    const h = harness((request) =>
      request.maxTokens < 64 ? { ok: false, status: 400, failureKind: "token_floor", tokenFloor: 64 } : undefined,
    );
    const run = await runProbe(input(h, [model("a", "responses")], { maxTokens: 8 }));
    const sent = h.requests.map(({ request, attempt }) => [request.level ?? "baseline", request.maxTokens, attempt]);
    expect(sent[0]).toEqual(["baseline", 8, 1]);
    expect(sent[1]).toEqual(["baseline", 64, 2]);
    // Every later call starts from 64: the lesson is kept for the model.
    expect(sent.slice(2).every(([, tokens, attempt]) => tokens === 64 && attempt === 1)).toBe(true);
    expect(run.models[0]?.records.filter((r) => r.ok)).toHaveLength(5);
  });

  it("guesses double when the gateway names a floor without a number, and never past the ceiling", async () => {
    const h = harness((request) => (request.maxTokens < 40 ? { ok: false, status: 400, failureKind: "token_floor" } : undefined));
    await runProbe(input(h, [model("a", "responses")], { maxTokens: 30, maxCalls: 2 }));
    expect(h.requests[1]?.request.maxTokens).toBe(60);
    const big = harness(() => ({ ok: false, status: 400, failureKind: "token_floor", tokenFloor: 999_999 }));
    await runProbe(input(big, [model("a", "responses")], { maxCalls: 2 }));
    expect(big.requests[1]?.request.maxTokens).toBe(MAX_ADJUSTED_TOKENS);
  });

  it("switches a chat-completions model to max_completion_tokens once the gateway says so", async () => {
    const h = harness((request) =>
      request.tokenField === "max_tokens" ? { ok: false, status: 400, failureKind: "token_field" } : undefined,
    );
    const run = await runProbe(input(h, [model("a")]));
    expect(h.requests[0]?.request.tokenField).toBe("max_tokens");
    expect(h.requests[1]?.request.tokenField).toBe("max_completion_tokens");
    expect(h.requests.slice(1).every(({ request }) => request.tokenField === "max_completion_tokens")).toBe(true);
    expect(run.models[0]?.records.filter((r) => r.ok)).toHaveLength(5);
  });

  it("follows a chain of adjustments: the spelling first, then the floor, each once, and keeps both for the model", async () => {
    const h = harness((request) => {
      if (request.tokenField === "max_tokens") {
        return { ok: false, status: 400, failureKind: "token_field" };
      }
      return request.maxTokens < 64 ? { ok: false, status: 400, failureKind: "token_floor", tokenFloor: 64 } : undefined;
    });
    const run = await runProbe(input(h, [model("a")]));
    const sent = h.requests.map(({ request, attempt }) => [request.tokenField, request.maxTokens, attempt]);
    expect(sent.slice(0, 3)).toEqual([
      ["max_tokens", 32, 1],
      ["max_completion_tokens", 32, 2],
      ["max_completion_tokens", 64, 3],
    ]);
    expect(sent.slice(3).every(([field, tokens, attempt]) => field === "max_completion_tokens" && tokens === 64 && attempt === 1)).toBe(true);
    expect(run.models[0]?.records.filter((r) => r.ok)).toHaveLength(5);
    expect(run.callsUsed).toBe(7);
  });

  it("never tries a call more than three times, however the refusals alternate", async () => {
    const h = harness((request) =>
      request.tokenField === "max_tokens"
        ? { ok: false, status: 400, failureKind: "token_field" }
        : { ok: false, status: 400, failureKind: "token_floor", tokenFloor: 1_000 },
    );
    const run = await runProbe(input(h, [model("a")]));
    expect(h.requests).toHaveLength(3);
    expect(run.models[0]).toMatchObject({ skipped: "baseline_failed" });
  });

  it("does not loop: a second refusal of the same kind ends the model's baseline", async () => {
    const h = harness(() => ({ ok: false, status: 400, failureKind: "token_floor", tokenFloor: 1_000 }));
    const run = await runProbe(input(h, [model("a", "responses")]));
    expect(h.requests).toHaveLength(2);
    expect(run.models[0]).toMatchObject({ skipped: "baseline_failed" });
  });

  it("waits between calls but not before the first one", async () => {
    const h = harness();
    await runProbe(input(h, [model("a")], { delayMs: 250 }));
    expect(h.sleeps).toHaveLength(4);
    expect(h.sleeps.every((ms) => ms === 250)).toBe(true);
    const none = harness();
    await runProbe(input(none, [model("a")], { delayMs: 0 }));
    expect(none.sleeps).toEqual([]);
  });

  it("hands every record to the observer as it is made, in order", async () => {
    const h = harness();
    const run = await runProbe(input(h, [model("a")]));
    expect(h.seen).toEqual(run.models[0]?.records);
  });

  it("does not change the plan it was given", async () => {
    const models = [model("a")];
    const levels: ReasoningEffort[] = [...LEVELS];
    const h = harness();
    await runProbe(input(h, models, { levels }));
    expect(models).toEqual([model("a")]);
    expect(levels).toEqual(LEVELS);
  });
});
