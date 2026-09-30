import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseProbeArgs } from "./args";
import { EvalRefusal, GatewayCredentials } from "./credentials";
import { makeProbeSender, type ProbeCallRecord } from "./probe-call";
import { PROBE_PROMPT, type ProbeRequest } from "./probe-request";
import { planLevels, runProbeCommand, selectProbeModels, type ProbeCommandDeps } from "./run-probe";

let resultsDir = "";
beforeEach(() => {
  resultsDir = mkdtempSync(join(tmpdir(), "eval-models-probe-"));
});
afterEach(() => {
  rmSync(resultsDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const argsOf = (...flags: string[]) => parseProbeArgs(["--delay-ms", "0", ...flags], resultsDir);

/** Chat ids the policy knows (gpt-5.6-luna, claude-sonnet-5), two it does not, and ids that are not chat models. */
const CATALOGUE = ["gpt-5.6-luna", "claude-sonnet-5", "mystery-model-a", "mystery-model-b", "text-embedding-3-small", "gpt-image-2"];

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
    totalMs: 100,
    ttftMs: 40,
    answered: true,
    answer: "OK",
    ...over,
  };
}

function harness(over: Partial<ProbeCommandDeps> = {}, script?: (request: ProbeRequest) => Partial<ProbeCallRecord> | undefined) {
  const out: string[] = [];
  const sent: ProbeRequest[] = [];
  let made = 0;
  const deps: ProbeCommandDeps = {
    env: { AGENTFORGE_DATA_DIR: "/desk", AGENTFORGE_RUNTIME: "ai" },
    now: () => new Date("2026-09-30T10:00:00.000Z"),
    readSavedModels: () => ({ models: CATALOGUE.map((id) => ({ id })) }),
    makeSender: () => {
      made += 1;
      return {
        host: "gateway.example.test",
        baseUrl: "https://gateway.example.test/v1",
        send: async (request, attempt) => {
          sent.push(request);
          return record(request, attempt, script?.(request));
        },
      };
    },
    sleep: async () => undefined,
    out: (text) => {
      out.push(text);
    },
    ...over,
  };
  return { deps, out, sent, made: () => made };
}

describe("selectProbeModels", () => {
  it("defaults to the live chat ids the policy table does not know", () => {
    const models = selectProbeModels(CATALOGUE, argsOf());
    expect(models.map((model) => model.id)).toEqual(["mystery-model-a", "mystery-model-b"]);
    expect(models.every((model) => model.inCatalog && model.policyKey === "unknown")).toBe(true);
  });

  it("leaves out ids that are not chat models, however unknown they are", () => {
    expect(selectProbeModels(CATALOGUE, argsOf()).map((model) => model.id)).not.toContain("text-embedding-3-small");
    expect(selectProbeModels(CATALOGUE, argsOf()).map((model) => model.id)).not.toContain("gpt-image-2");
  });

  it("adds --ids, in the catalogue's own spelling, and adds an id the catalogue does not list as typed", () => {
    const models = selectProbeModels(CATALOGUE, argsOf("--ids", "GPT-5.6-LUNA,not-listed"));
    expect(models.map((model) => [model.id, model.inCatalog])).toEqual([
      ["mystery-model-a", true],
      ["mystery-model-b", true],
      ["gpt-5.6-luna", true],
      ["not-listed", false],
    ]);
    expect(models.find((model) => model.id === "gpt-5.6-luna")).toMatchObject({ policyKey: "gpt-5.6", wire: "responses" });
  });

  it("probes only --ids with --only-ids, and never twice", () => {
    const models = selectProbeModels(CATALOGUE, argsOf("--only-ids", "--ids", "mystery-model-a,MYSTERY-MODEL-A,claude-sonnet-5"));
    expect(models.map((model) => model.id)).toEqual(["mystery-model-a", "claude-sonnet-5"]);
  });

  it("uses the policy's wire, or the one --wire names", () => {
    expect(selectProbeModels(CATALOGUE, argsOf("--only-ids", "--ids", "claude-sonnet-5"))[0]?.wire).toBe("anthropic_messages");
    expect(selectProbeModels(CATALOGUE, argsOf("--only-ids", "--ids", "claude-sonnet-5", "--wire", "chat_completions"))[0]?.wire).toBe("chat_completions");
    expect(selectProbeModels(CATALOGUE, argsOf())[0]?.wire).toBe("chat_completions");
  });
});

describe("planLevels", () => {
  it("is Off, Light, Normal and Deep, and adds Extra and Max only with the flag", () => {
    expect(planLevels(argsOf())).toEqual(["none", "low", "medium", "high"]);
    expect(planLevels(argsOf("--extra"))).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
  });

  it("takes an explicit list in ladder order", () => {
    expect(planLevels(argsOf("--levels", "max,none,low"))).toEqual(["none", "low", "max"]);
  });
});

describe("runProbeCommand", () => {
  it("refuses the stub runtime before anything is built, and refuses to guess a desk", async () => {
    const stub = harness({ env: { AGENTFORGE_DATA_DIR: "/desk", AGENTFORGE_RUNTIME: "stub" } });
    await expect(runProbeCommand(argsOf(), stub.deps)).rejects.toThrow(EvalRefusal);
    expect(stub.made()).toBe(0);
    const bare = harness({ env: {} });
    await expect(runProbeCommand(argsOf(), bare.deps)).rejects.toThrow(/AGENTFORGE_DATA_DIR/);
    expect(bare.made()).toBe(0);
  });

  it("--dry-run prints the plan and the call count, builds no sender and needs no key", async () => {
    const h = harness();
    expect(await runProbeCommand(argsOf("--dry-run"), h.deps)).toBe(0);
    const text = h.out.join("");
    expect(text).toContain("mystery-model-a");
    expect(text).toContain("mystery-model-b");
    expect(text).toMatch(/levels: none, low, medium, high/);
    expect(text).toMatch(/10 nominal/);
    expect(text).toMatch(/budget 60/);
    expect(h.made()).toBe(0);
    expect(readdirSync(resultsDir)).toEqual([]);
  });

  it("--dry-run works under the stub runtime, since it calls nothing", async () => {
    const h = harness({ env: { AGENTFORGE_DATA_DIR: "/desk", AGENTFORGE_RUNTIME: "stub" } });
    expect(await runProbeCommand(argsOf("--dry-run"), h.deps)).toBe(0);
  });

  it("does nothing, and says why, when every live chat id is already in the table", async () => {
    const h = harness({ readSavedModels: () => ({ models: [{ id: "gpt-5.6-luna" }, { id: "claude-sonnet-5" }] }) });
    expect(await runProbeCommand(argsOf(), h.deps)).toBe(0);
    expect(h.out.join("")).toMatch(/nothing to probe/i);
    expect(h.made()).toBe(0);
  });

  it("probes each model raw and writes the trace and a proposed entry for each", async () => {
    const h = harness({}, (request) =>
      request.level === "none" ? { ok: false, status: 400, failureKind: "other", errorCode: "unsupported_value", errorMessage: "none is not supported", answered: false } : undefined,
    );
    expect(await runProbeCommand(argsOf(), h.deps)).toBe(0);
    // Two models, a baseline and four levels each.
    expect(h.sent).toHaveLength(10);
    const files = readdirSync(resultsDir).sort();
    expect(files).toEqual(["probe-2026-09-30T10-00-00-000Z.json", "probe-2026-09-30T10-00-00-000Z.snippets.txt"]);
    const trace = JSON.parse(readFileSync(join(resultsDir, files[0] as string), "utf8")) as {
      run: { callsUsed: number; budgetExhausted: boolean };
      models: Array<{ id: string; summary: { accepted: string[]; offFormat: string }; proposal: { snippet: string } | null; records: unknown[] }>;
    };
    expect(trace.run).toMatchObject({ callsUsed: 10, budgetExhausted: false });
    expect(trace.models.map((model) => model.id)).toEqual(["mystery-model-a", "mystery-model-b"]);
    expect(trace.models[0]?.summary).toMatchObject({ accepted: ["low", "medium", "high"], offFormat: "floor" });
    expect(trace.models[0]?.proposal?.snippet).toContain('ids: ["mystery-model-a"]');
    expect(trace.models[0]?.records).toHaveLength(5);
    const snippets = readFileSync(join(resultsDir, files[1] as string), "utf8");
    expect(snippets).toContain("mystery-model-a");
    expect(snippets).toContain("mystery-model-b");
    expect(h.out.join("")).toContain("Proposed for review, never applied");
  });

  it("never edits the policy table", async () => {
    const before = readFileSync(new URL("../../../core/src/models/model-policy.ts", import.meta.url), "utf8");
    await runProbeCommand(argsOf(), harness().deps);
    expect(readFileSync(new URL("../../../core/src/models/model-policy.ts", import.meta.url), "utf8")).toBe(before);
  });

  it("says nothing rather than none for a list that is empty, so Off is never confused with an empty list", async () => {
    const h = harness();
    await runProbeCommand(argsOf("--only-ids", "--ids", "mystery-model-a"), h.deps);
    expect(h.out.join("")).toMatch(/refused:\s+nothing/);
  });

  it("stops at the call budget and says the run is incomplete", async () => {
    const h = harness();
    await runProbeCommand(argsOf("--max-calls", "3"), h.deps);
    expect(h.sent).toHaveLength(3);
    expect(h.out.join("")).toMatch(/budget of 3 calls was used up/i);
    const trace = JSON.parse(readFileSync(join(resultsDir, "probe-2026-09-30T10-00-00-000Z.json"), "utf8")) as { run: { budgetExhausted: boolean } };
    expect(trace.run.budgetExhausted).toBe(true);
  });

  it("probes Extra and Max only when asked, and a chosen wire when told", async () => {
    const h = harness();
    await runProbeCommand(argsOf("--only-ids", "--ids", "mystery-model-a", "--extra", "--wire", "responses"), h.deps);
    expect(h.sent.map((request) => request.level ?? "baseline")).toEqual(["baseline", "none", "low", "medium", "high", "xhigh", "max"]);
    expect(h.sent.every((request) => request.wire === "responses")).toBe(true);
  });

  it("prints one progress line per call, with status and timing and no body", async () => {
    const h = harness();
    await runProbeCommand(argsOf("--only-ids", "--ids", "mystery-model-a"), h.deps);
    const lines = h.out.join("").split("\n").filter((line) => line.startsWith("["));
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/\[1\] mystery-model-a\s+baseline\s+200/);
    // Retries after an output-budget adjustment can make a run longer than the plan, so a line carries no total.
    expect(lines.every((line) => !/\[\d+\/\d+\]/.test(line))).toBe(true);
    expect(h.out.join("")).not.toContain(PROBE_PROMPT);
  });

  it("puts no key, no prompt and no request body in anything it writes", async () => {
    const KEY = "sk-live-ZZZ-never-in-a-trace-123";
    const credentials = new GatewayCredentials(KEY, "https://gateway.example.test/v1");
    const encoder = new TextEncoder();
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      // A gateway that echoes the caller's key back in its refusal, the worst case for a trace.
      const body = JSON.parse(String(init?.body)) as { reasoning_effort?: string };
      if (body.reasoning_effort === "none") {
        return new Response(JSON.stringify({ error: { message: `Unsupported value for key ${KEY}: none`, code: "bad" } }), { status: 400 });
      }
      const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}\n\n`;
      return new Response(encoder.encode(frame), { status: 200 });
    }) as typeof fetch;
    const h = harness({
      makeSender: () => ({
        host: credentials.host,
        baseUrl: credentials.baseUrl,
        send: makeProbeSender({ credentials, fetch: fetchFn, timeoutMs: 2_000, now: () => Date.now() }),
      }),
    });
    await runProbeCommand(argsOf("--only-ids", "--ids", "mystery-model-a"), h.deps);
    const everything = [
      h.out.join(""),
      ...readdirSync(resultsDir).map((name) => readFileSync(join(resultsDir, name), "utf8")),
    ].join("\n");
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("sk-live");
    expect(everything).not.toContain(PROBE_PROMPT);
    expect(everything).not.toContain("Authorization");
    expect(everything).toContain("[key]");
  });
});
