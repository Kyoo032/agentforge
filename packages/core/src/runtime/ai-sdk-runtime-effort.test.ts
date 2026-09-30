import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSdkRuntime } from "./ai-sdk-runtime";
import { learnedEffortLimit, resetLearnedEffortLimits } from "./effort-selfheal";
import type { AgentVersionRecord, ToolBindingRecord } from "../agents/service";
import { defineTool } from "../tools/define-tool";
import { registerTool, resetToolRegistry } from "../tools/registry";
import type { TenantContext } from "../tenancy/types";
import type { ReasoningEffort } from "../models/reasoning-effort";
import type { JobMode } from "../models/mode-defaults";
import type { RuntimeEvent } from "./types";

/**
 * The Thinking parameter against a gateway that refuses it. `fetch` is replaced, so nothing leaves the
 * machine, but the request goes through the real AI SDK and the real wire bodies: what these tests read
 * is what the gateway would have received.
 */

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws",
  userId: "user",
  role: "owner",
};

function versionFor(model: string): AgentVersionRecord {
  return {
    id: `v-${model}`,
    agentId: "chat",
    organizationId: "org",
    version: 1,
    systemPrompt: "You are helpful.",
    model,
    inputModalities: ["text"],
    config: {},
    createdAt: new Date(),
  };
}

type Captured = { url: string; body: Record<string, unknown> };

const encoder = new TextEncoder();

function json(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message, type: "invalid_request_error" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function chunk(delta: Record<string, unknown>, finish: string | null = null, usage?: Record<string, number>) {
  return {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  };
}

/** An OpenAI-compatible chat-completions stream that answers `text`, calls tool `tool`, or both. */
function chatStream(input: { text?: string; tool?: string; args?: string }): Response {
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const frames = [
    ...(input.text === undefined ? [] : [chunk({ role: "assistant", content: input.text })]),
    ...(input.tool === undefined
      ? []
      : [
          chunk({
            ...(input.text === undefined ? { role: "assistant" } : {}),
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: input.tool, arguments: input.args ?? "{}" } },
            ],
          }),
        ]),
    chunk({}, input.tool === undefined ? "stop" : "tool_calls", usage),
  ];
  const body = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(encoder.encode(body), { status: 200, headers: { "content-type": "text/event-stream" } });
}

type Reply = (request: Captured) => Response;

function gateway(replies: Reply[]): Captured[] {
  const seen: Captured[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    const request: Captured = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
    seen.push(request);
    const reply = replies[seen.length - 1];
    if (!reply) {
      throw new Error(`unexpected request number ${seen.length} to ${request.url}`);
    }
    return reply(request);
  });
  return seen;
}

async function run(options: {
  model: string;
  reasoningEffort?: ReasoningEffort;
  reasoningEffortExplicit?: boolean;
  thinking?: boolean;
  jobMode?: JobMode;
  bindings?: ToolBindingRecord[];
  tenantId?: string;
}): Promise<{ events: RuntimeEvent[]; failed: unknown }> {
  const events: RuntimeEvent[] = [];
  let failed: unknown;
  try {
    await new AiSdkRuntime({ openai: "sk-test", openaiBaseUrl: "https://gateway.test/v1" }).execute({
      tenant: options.tenantId ? { ...tenant, tenantId: options.tenantId } : tenant,
      runId: "run-effort",
      modality: "text",
      version: versionFor(options.model),
      bindings: options.bindings ?? [],
      history: [{ role: "user", parts: [{ type: "text", text: "Say ok." }] }],
      ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(options.reasoningEffortExplicit === undefined ? {} : { reasoningEffortExplicit: options.reasoningEffortExplicit }),
      ...(options.thinking === undefined ? {} : { thinking: options.thinking }),
      ...(options.jobMode ? { jobMode: options.jobMode } : {}),
      onEvent: (event) => {
        events.push(event);
      },
    });
  } catch (error) {
    failed = error;
  }
  return { events, failed };
}

const answered = (events: RuntimeEvent[]) => events.some((event) => event.type === "run.completed");
const failedEvent = (events: RuntimeEvent[]) => events.find((event) => event.type === "run.failed");
const answerText = (events: RuntimeEvent[]) =>
  events.flatMap((event) => (event.type === "assistant.delta" ? [event.text] : [])).join("");

/** What the runtime has learned for the tenant these runs use. */
const learned = (model: string) => learnedEffortLimit(model, tenant.tenantId);

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetLearnedEffortLimits();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetLearnedEffortLimits();
  resetToolRegistry();
});

describe("a known model on Completions", () => {
  it("steps the level down one when the gateway refuses it, retries once, and answers", async () => {
    const seen = gateway([
      () => json(400, "Unsupported value: 'ultra' for reasoning_effort. Supported values are: 'low', 'high', 'max'."),
      () => chatStream({ text: "ok" }),
    ]);
    const { events, failed } = await run({ model: "deepseek-v4-flash", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    expect(failed).toBeUndefined();
    expect(seen).toHaveLength(2);
    expect(seen[0]?.body.reasoning_effort).toBe("ultra");
    expect(seen[1]?.body.reasoning_effort).toBe("max");
    expect(answerText(events)).toBe("ok");
    expect(answered(events)).toBe(true);
    expect(failedEvent(events)).toBeUndefined();
    // Healing is not a contact attempt: the person sees one probe, not two.
    expect(events.filter((event) => event.type === "run.probing")).toHaveLength(1);
  });

  it("remembers the limit for the model: the next call goes straight to the safe level", async () => {
    gateway([
      () => json(400, "Unsupported value: 'ultra' for reasoning_effort"),
      () => chatStream({ text: "ok" }),
    ]);
    await run({ model: "deepseek-v4-flash", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    expect(learned("deepseek-v4-flash")).toEqual({ drop: false, ceiling: "max", replace: {} });
    vi.unstubAllGlobals();

    const seen = gateway([() => chatStream({ text: "ok" })]);
    const second = await run({ model: "deepseek-v4-flash", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    expect(second.failed).toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.body.reasoning_effort).toBe("max");

    // A lower level is not raised, and Off stays Off.
    vi.unstubAllGlobals();
    const lower = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "deepseek-v4-flash", reasoningEffort: "medium", reasoningEffortExplicit: true });
    expect(lower[0]?.body.reasoning_effort).toBe("medium");
  });

  it("forgets the limit when the learned limits are reset, the way saving Settings does", async () => {
    gateway([
      () => json(400, "Unsupported value: 'ultra' for reasoning_effort"),
      () => chatStream({ text: "ok" }),
    ]);
    await run({ model: "deepseek-v4-flash", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    resetLearnedEffortLimits();
    vi.unstubAllGlobals();

    const seen = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "deepseek-v4-flash", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    expect(seen[0]?.body.reasoning_effort).toBe("ultra");
  });

  it("when Off is refused, omits the parameter for Off only and keeps sending every other level", async () => {
    const seen = gateway([
      () => json(400, "Unsupported value: 'none' for reasoning_effort. Supported values are: 'low', 'medium', 'high'."),
      () => chatStream({ text: "ok" }),
    ]);
    const { failed } = await run({ model: "deepseek-v4-pro", thinking: false });
    expect(failed).toBeUndefined();
    expect(seen[0]?.body.reasoning_effort).toBe("none");
    expect("reasoning_effort" in (seen[1]?.body ?? {})).toBe(false);
    expect(learned("deepseek-v4-pro")).toEqual({ drop: false, ceiling: undefined, replace: { none: "omit" } });

    vi.unstubAllGlobals();
    const off = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "deepseek-v4-pro", thinking: false });
    expect(off).toHaveLength(1);
    expect("reasoning_effort" in (off[0]?.body ?? {})).toBe(false);

    vi.unstubAllGlobals();
    const deep = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "deepseek-v4-pro", reasoningEffort: "high", reasoningEffortExplicit: true });
    expect(deep[0]?.body.reasoning_effort).toBe("high");
  });

  it("keeps what one tenant learned to that tenant", async () => {
    gateway([
      () => json(400, "Unsupported value: 'ultra' for reasoning_effort"),
      () => chatStream({ text: "ok" }),
    ]);
    await run({ model: "deepseek-v4-flash", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    expect(learned("deepseek-v4-flash")?.ceiling).toBe("max");
    vi.unstubAllGlobals();

    const other = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "deepseek-v4-flash", reasoningEffort: "ultra", reasoningEffortExplicit: true, tenantId: "another-tenant" });
    expect(other[0]?.body.reasoning_effort).toBe("ultra");
  });

  it("drops the parameter for good when the model takes no such parameter", async () => {
    const seen = gateway([
      () => json(400, "Unsupported parameter: 'reasoning_effort' is not supported with this model."),
      () => chatStream({ text: "ok" }),
    ]);
    const { events, failed } = await run({ model: "deepseek-v4-flash", reasoningEffort: "high", reasoningEffortExplicit: true });
    expect(failed).toBeUndefined();
    expect(seen).toHaveLength(2);
    expect(seen[0]?.body.reasoning_effort).toBe("high");
    expect(seen[1]).toBeDefined();
    expect("reasoning_effort" in (seen[1]?.body ?? {})).toBe(false);
    expect(answered(events)).toBe(true);
    expect(learned("deepseek-v4-flash")).toEqual({ drop: true, ceiling: undefined, replace: {} });

    vi.unstubAllGlobals();
    const next = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "deepseek-v4-flash", reasoningEffort: "high", reasoningEffortExplicit: true });
    expect("reasoning_effort" in (next[0]?.body ?? {})).toBe(false);
  });

  it("heals a job the same way, and the healed level is not put back by the job knob", async () => {
    const seen = gateway([
      () => json(400, "Unsupported value: 'low' for reasoning_effort. Supported values are: 'none', 'high'."),
      () => chatStream({ text: "ok" }),
    ]);
    const { failed } = await run({ model: "deepseek-v4-flash", jobMode: "finance" });
    expect(failed).toBeUndefined();
    expect(seen).toHaveLength(2);
    expect(seen[0]?.body.reasoning_effort).toBe("low");
    // Nothing sits below low but Off, so that is the one step down; the knob must not overwrite it.
    expect(seen[1]?.body.reasoning_effort).toBe("none");
  });

  it("logs exactly one redacted line for the whole heal", async () => {
    gateway([
      () => json(400, "Unsupported value: 'ultra' for reasoning_effort. Your prompt was: Say ok. key=sk-test"),
      () => chatStream({ text: "ok" }),
    ]);
    await run({ model: "deepseek-v4-flash", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    // The runtime's own "gateway: HTTP 400 ..." line for the refused request is older than the heal
    // and is not counted; the heal adds exactly one more.
    const lines = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith("gateway: effort"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("deepseek-v4-flash");
    expect(lines[0]).not.toContain("sk-test");
    expect(lines[0]).not.toContain("Say ok");
  });
});

describe("what the runtime does not retry", () => {
  const others: Array<[string, number, string]> = [
    ["a context-length 400", 400, "This model's maximum context length is 1000 tokens. However, you requested 5000 tokens."],
    ["a bad key", 400, "Invalid API key provided."],
    ["a missing model", 404, "The model `deepseek-v4-flash` does not exist or you do not have access to it."],
    ["a 400 about something else", 400, "messages: roles must alternate between user and assistant"],
  ];
  for (const [name, status, message] of others) {
    it(`does not retry ${name}`, async () => {
      const seen = gateway([() => json(status, message)]);
      const { events, failed } = await run({ model: "deepseek-v4-flash", reasoningEffort: "ultra", reasoningEffortExplicit: true });
      expect(failed).toBeInstanceOf(Error);
      expect(seen).toHaveLength(1);
      expect(failedEvent(events)).toBeDefined();
      expect(learned("deepseek-v4-flash")).toBeUndefined();
    });
  }

  it("does not retry twice: a second refusal is the answer, and nothing is learned", async () => {
    const seen = gateway([
      () => json(400, "Unsupported value: 'ultra' for reasoning_effort"),
      () => json(400, "Unsupported value: 'max' for reasoning_effort"),
    ]);
    const { events, failed } = await run({ model: "deepseek-v4-flash", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    expect(failed).toBeInstanceOf(Error);
    expect(seen).toHaveLength(2);
    expect(failedEvent(events)).toBeDefined();
    expect(learned("deepseek-v4-flash")).toBeUndefined();
  });

  it("never retries once text and a tool call have come back, however the next request fails", async () => {
    resetToolRegistry();
    registerTool(
      defineTool({
        key: "echo",
        name: "Echo",
        description: "Echo a number.",
        schema: z.object({ x: z.number() }),
        execute: async (args) => ({ echoed: args.x }),
      }),
    );
    const seen = gateway([
      () => chatStream({ text: "Let me check. ", tool: "echo", args: '{"x":1}' }),
      () => json(400, "Unsupported value: 'ultra' for reasoning_effort"),
    ]);
    const { events } = await run({
      model: "deepseek-v4-flash",
      reasoningEffort: "ultra",
      reasoningEffortExplicit: true,
      bindings: [{ id: "b1", agentVersionId: "v", organizationId: "org", toolKey: "echo", config: {}, enabled: true }],
    });
    expect(seen).toHaveLength(2);
    expect(answerText(events)).toContain("Let me check.");
    expect(learned("deepseek-v4-flash")).toBeUndefined();
  });

  it("never retries once a tool has run, however the next request fails", async () => {
    resetToolRegistry();
    registerTool(
      defineTool({
        key: "echo",
        name: "Echo",
        description: "Echo a number.",
        schema: z.object({ x: z.number() }),
        execute: async (args) => ({ echoed: args.x }),
      }),
    );
    const bindings: ToolBindingRecord[] = [
      {
        id: "b1",
        agentVersionId: "v",
        organizationId: "org",
        toolKey: "echo",
        config: {},
        enabled: true,
      },
    ];
    const seen = gateway([
      () => chatStream({ tool: "echo", args: '{"x":1}' }),
      () => json(400, "Unsupported value: 'ultra' for reasoning_effort"),
    ]);
    const { events } = await run({
      model: "deepseek-v4-flash",
      reasoningEffort: "ultra",
      reasoningEffortExplicit: true,
      bindings,
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]?.body.reasoning_effort).toBe("ultra");
    expect(events.some((event) => event.type === "tool.completed")).toBe(true);
    expect(learned("deepseek-v4-flash")).toBeUndefined();
  });
});

describe("a model the table does not know", () => {
  it("sends no effort parameter when the person chose none", async () => {
    const seen = gateway([() => chatStream({ text: "ok" })]);
    const { failed } = await run({ model: "some-new-lab-model" });
    expect(failed).toBeUndefined();
    expect(seen[0]?.url).toContain("/chat/completions");
    expect("reasoning_effort" in (seen[0]?.body ?? {})).toBe(false);
  });

  it("sends no effort parameter when the host says the level was only defaulted", async () => {
    const seen = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "some-new-lab-model", reasoningEffort: "medium", reasoningEffortExplicit: false });
    expect("reasoning_effort" in (seen[0]?.body ?? {})).toBe(false);
  });

  it("sends the chosen level, capped at high, and never Off", async () => {
    const chosen = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "some-new-lab-model", reasoningEffort: "medium", reasoningEffortExplicit: true });
    expect(chosen[0]?.body.reasoning_effort).toBe("medium");

    vi.unstubAllGlobals();
    const ultra = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "some-new-lab-model", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    expect(ultra[0]?.body.reasoning_effort).toBe("high");

    vi.unstubAllGlobals();
    const off = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "some-new-lab-model", thinking: false });
    expect("reasoning_effort" in (off[0]?.body ?? {})).toBe(false);
  });

  it("takes a chosen level from a caller that passes only the level", async () => {
    const seen = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "some-new-lab-model", reasoningEffort: "low" });
    expect(seen[0]?.body.reasoning_effort).toBe("low");
  });

  it("drops the parameter when the gateway refuses even the lowest level", async () => {
    const seen = gateway([
      () => json(400, "Unsupported value: 'low' for reasoning_effort"),
      () => chatStream({ text: "ok" }),
    ]);
    const { failed } = await run({ model: "some-new-lab-model", reasoningEffort: "low", reasoningEffortExplicit: true });
    expect(failed).toBeUndefined();
    expect(seen).toHaveLength(2);
    expect("reasoning_effort" in (seen[1]?.body ?? {})).toBe(false);
  });

  it("puts a newer GPT on Responses, with no reasoning block unless chosen", async () => {
    // gpt-5.7 is past the table but still starts with gpt-5, so the SDK would send a reasoning block.
    const seen = gateway([() => json(401, "Incorrect API key provided.")]);
    await run({ model: "gpt-5.7-terra", reasoningEffort: "medium", reasoningEffortExplicit: false });
    expect(seen[0]?.url).toContain("/responses");
    expect(seen[0]?.body.reasoning).toBeUndefined();

    vi.unstubAllGlobals();
    const chosen = gateway([() => json(401, "Incorrect API key provided.")]);
    await run({ model: "gpt-5.7-terra", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    expect((chosen[0]?.body.reasoning as { effort?: string } | undefined)?.effort).toBe("high");
  });
});

describe("the other wires", () => {
  it("Responses: steps the level down in the reasoning block", async () => {
    const seen = gateway([
      () => json(400, "Unsupported value: 'xhigh' for reasoning.effort. Supported values are: 'low', 'medium', 'high'."),
      () => json(401, "Incorrect API key provided."),
    ]);
    await run({ model: "gpt-5.5", reasoningEffort: "xhigh", reasoningEffortExplicit: true });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.url).toContain("/responses");
    expect((seen[0]?.body.reasoning as { effort?: string } | undefined)?.effort).toBe("xhigh");
    expect((seen[1]?.body.reasoning as { effort?: string } | undefined)?.effort).toBe("high");
  });

  it("Responses: drops the reasoning effort when the model takes no such parameter", async () => {
    const seen = gateway([
      () => json(400, "Unsupported parameter: 'reasoning.effort' is not supported with this model."),
      () => json(401, "Incorrect API key provided."),
    ]);
    await run({ model: "gpt-5.5", reasoningEffort: "high", reasoningEffortExplicit: true });
    expect(seen).toHaveLength(2);
    expect((seen[1]?.body.reasoning as { effort?: string } | undefined)?.effort).toBeUndefined();
  });

  it("Messages: steps output_config.effort down one", async () => {
    const seen = gateway([
      () => json(400, "output_config.effort: 'max' is not supported for this model. Input should be 'low', 'medium', 'high' or 'xhigh'."),
      () => json(401, "Incorrect API key provided."),
    ]);
    await run({ model: "claude-sonnet-5", reasoningEffort: "max", reasoningEffortExplicit: true });
    expect(seen).toHaveLength(2);
    expect(seen[0]?.url).toContain("/messages");
    expect((seen[0]?.body.output_config as { effort?: string } | undefined)?.effort).toBe("max");
    expect((seen[1]?.body.output_config as { effort?: string } | undefined)?.effort).toBe("xhigh");
  });

  it("Messages: leaves thinking alone when the parameter itself is refused", async () => {
    const seen = gateway([
      () => json(400, "This model does not support thinking."),
      () => json(401, "Incorrect API key provided."),
    ]);
    await run({ model: "claude-sonnet-5", reasoningEffort: "high", reasoningEffortExplicit: true });
    expect(seen).toHaveLength(2);
    expect(seen[1]?.body.thinking).toBeUndefined();
    expect(seen[1]?.body.output_config).toBeUndefined();
  });
});

describe("known models are byte for byte what they were", () => {
  it("Chat on a Completions model sends the request's level as it always did", async () => {
    const seen = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "deepseek-v4-pro", reasoningEffort: "ultra", reasoningEffortExplicit: true });
    expect(seen[0]?.body.reasoning_effort).toBe("ultra");
  });

  it("a default level on a known model is still sent, chosen or not", async () => {
    const seen = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "deepseek-v4-pro" });
    expect(seen[0]?.body.reasoning_effort).toBe("medium");
  });

  it("a job on a quiet family still sends the knob, and Off still sends none", async () => {
    const job = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "deepseek-v4-flash", jobMode: "finance" });
    expect(job[0]?.body.reasoning_effort).toBe("low");
    vi.unstubAllGlobals();
    const off = gateway([() => chatStream({ text: "ok" })]);
    await run({ model: "deepseek-v4-pro", thinking: false });
    expect(off[0]?.body.reasoning_effort).toBe("none");
  });
});
