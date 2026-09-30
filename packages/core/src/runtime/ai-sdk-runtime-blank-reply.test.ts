import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSdkRuntime } from "./ai-sdk-runtime";
import { resetLearnedEffortLimits } from "./effort-selfheal";
import type { AgentVersionRecord, ToolBindingRecord } from "../agents/service";
import { defineTool } from "../tools/define-tool";
import { registerTool, resetToolRegistry } from "../tools/registry";
import type { TenantContext } from "../tenancy/types";
import type { RuntimeEvent } from "./types";

/**
 * A reply that is only whitespace is no reply. gpt-6-sol (Responses wire; these streams are Completions, on
 * deepseek-v4-flash, which the same runtime code serves) answered a Chat turn with HTTP 200 and a
 * single space on 2026-09-30, and the runtime counted the first `assistant.delta` as "text": the run
 * completed, the person got an empty turn, and neither the tool-less retry nor the failure message
 * ever ran. `fetch` is replaced, so nothing leaves the machine, but the request goes through the real
 * AI SDK: what these tests read is what the runtime does with what the gateway sent.
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
type Reply = (request: Captured) => Response;

const encoder = new TextEncoder();

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

/** A chat-completions stream that sends each of `deltas` as its own frame, then optionally a tool call. */
function chatStream(deltas: string[], tool?: { name: string; args: string }): Response {
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  const frames = [
    ...deltas.map((content, index) => chunk({ ...(index === 0 ? { role: "assistant" } : {}), content })),
    ...(tool
      ? [
          chunk({
            ...(deltas.length === 0 ? { role: "assistant" } : {}),
            tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: tool.name, arguments: tool.args } }],
          }),
        ]
      : []),
    chunk({}, tool ? "tool_calls" : "stop", usage),
  ];
  const body = `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(encoder.encode(body), { status: 200, headers: { "content-type": "text/event-stream" } });
}

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

const echoBinding: ToolBindingRecord = {
  id: "b1",
  agentVersionId: "v",
  organizationId: "org",
  toolKey: "echo",
  config: {},
  enabled: true,
};

function registerEcho() {
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
}

async function run(options: { bindings?: ToolBindingRecord[] } = {}): Promise<{ events: RuntimeEvent[]; failed: unknown }> {
  const events: RuntimeEvent[] = [];
  let failed: unknown;
  try {
    await new AiSdkRuntime({ openai: "sk-test", openaiBaseUrl: "https://gateway.test/v1" }).execute({
      tenant,
      runId: "run-blank",
      modality: "text",
      version: versionFor("deepseek-v4-flash"),
      bindings: options.bindings ?? [],
      history: [{ role: "user", parts: [{ type: "text", text: "Say ok." }] }],
      thinking: false,
      reasoningEffort: "none",
      reasoningEffortExplicit: true,
      onEvent: (event) => {
        events.push(event);
      },
    });
  } catch (error) {
    failed = error;
  }
  return { events, failed };
}

const completed = (events: RuntimeEvent[]) => events.filter((event) => event.type === "run.completed");
const failedEvent = (events: RuntimeEvent[]) => events.find((event) => event.type === "run.failed");
const deltas = (events: RuntimeEvent[]) =>
  events.flatMap((event) => (event.type === "assistant.delta" ? [event.text] : []));
const answerText = (events: RuntimeEvent[]) => deltas(events).join("");

beforeEach(() => {
  resetLearnedEffortLimits();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetLearnedEffortLimits();
  resetToolRegistry();
});

describe("a reply of whitespace only", () => {
  it("is no reply: the run fails with the empty-reply error instead of completing with a blank turn", async () => {
    const seen = gateway([() => chatStream([" "])]);
    const { events, failed } = await run();

    expect(failed).toBeInstanceOf(Error);
    expect(String((failed as Error).message)).toMatch(/returned no text/);
    expect(failedEvent(events)?.type).toBe("run.failed");
    expect(completed(events)).toHaveLength(0);
    // The blank was never handed on: nothing for a host to accumulate, persist or show.
    expect(deltas(events)).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it("counts several blank deltas, newlines included, the same way", async () => {
    gateway([() => chatStream([" ", "\n", "\n\n"])]);
    const { events, failed } = await run();

    expect(String((failed as Error).message)).toMatch(/returned no text/);
    expect(completed(events)).toHaveLength(0);
    expect(deltas(events)).toEqual([]);
  });

  it("gets the tool-less retry an empty reply gets, and the retry's answer is the only text", async () => {
    registerEcho();
    const seen = gateway([() => chatStream([" "]), () => chatStream(["ok"])]);
    const { events, failed } = await run({ bindings: [echoBinding] });

    expect(failed).toBeUndefined();
    expect(seen).toHaveLength(2);
    expect(seen[0]?.body.tools).toBeDefined();
    expect(seen[1]?.body.tools).toBeUndefined();
    // No blank in front of the answer: the first attempt's whitespace never left the runtime.
    expect(deltas(events)).toEqual(["ok"]);
    expect(failedEvent(events)).toBeUndefined();
    // One completion, so a host persists one message and records one usage row.
    const done = completed(events);
    expect(done).toHaveLength(1);
    // Both calls were paid for and both are counted, once: 1 + 1 input and 1 + 1 output tokens.
    expect(done[0]).toMatchObject({ usage: { model: "deepseek-v4-flash", inputTokens: 2, outputTokens: 2 } });
  });

  it("fails after the tool-less retry when that one is blank too, and hands on nothing", async () => {
    registerEcho();
    const seen = gateway([() => chatStream([" "]), () => chatStream(["\n"])]);
    const { events, failed } = await run({ bindings: [echoBinding] });

    expect(seen).toHaveLength(2);
    expect(String((failed as Error).message)).toMatch(/returned no text/);
    expect(completed(events)).toHaveLength(0);
    expect(deltas(events)).toEqual([]);
  });

  it("does not fail a turn that ran a tool: a tool turn with no prose keeps completing", async () => {
    registerEcho();
    const seen = gateway([
      () => chatStream([" "], { name: "echo", args: '{"x":1}' }),
      () => chatStream([" "]),
    ]);
    const { events, failed } = await run({ bindings: [echoBinding] });

    expect(failed).toBeUndefined();
    expect(seen).toHaveLength(2);
    expect(events.some((event) => event.type === "tool.completed")).toBe(true);
    expect(completed(events)).toHaveLength(1);
    expect(failedEvent(events)).toBeUndefined();
  });
});

describe("whitespace that belongs to a real reply", () => {
  it("keeps leading whitespace that is followed by text, byte for byte", async () => {
    const seen = gateway([() => chatStream(["\n", "Hello"])]);
    const { events, failed } = await run();

    expect(failed).toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(answerText(events)).toBe("\nHello");
    expect(completed(events)).toHaveLength(1);
  });

  it("forwards whitespace after the first text as it always did", async () => {
    gateway([() => chatStream(["Hello", " ", "world", "\n\n"])]);
    const { events, failed } = await run();

    expect(failed).toBeUndefined();
    expect(deltas(events)).toEqual(["Hello", " ", "world", "\n\n"]);
    expect(completed(events)).toHaveLength(1);
  });

  it("does not treat a reply that is only the digit zero as empty", async () => {
    gateway([() => chatStream(["0"])]);
    const { events, failed } = await run();

    expect(failed).toBeUndefined();
    expect(deltas(events)).toEqual(["0"]);
  });
});
