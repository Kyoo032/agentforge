import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "../tools/define-tool";
import { registerPlatformTools } from "../tools/platform/register";
import { registerTool } from "../tools/registry";
import { StubRuntime } from "./stub-runtime";
import type { AgentVersionRecord, ToolBindingRecord } from "../agents/service";
import type { TenantContext } from "../tenancy/types";
import type { RuntimeEvent } from "./types";

registerPlatformTools();

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org",
  workspaceId: "ws",
  userId: "user",
  role: "builder",
};

const version: AgentVersionRecord = {
  id: "v1",
  agentId: "a1",
  organizationId: "org",
  version: 1,
  systemPrompt: "You are helpful.",
  model: "stub-model",
  inputModalities: ["text"],
  config: {},
  createdAt: new Date(),
};

function binding(toolKey: string): ToolBindingRecord {
  return {
    id: `bind-${toolKey}`,
    agentVersionId: "v1",
    organizationId: "org",
    toolKey,
    config: {},
    enabled: true,
  };
}

async function run(
  prompt: string,
  toolKeys: string[],
  thinking = true,
): Promise<{ answer: string; thinking: string; tools: string[] }> {
  const runtime = new StubRuntime();
  let answer = "";
  let thought = "";
  const tools: string[] = [];
  await runtime.execute({
    tenant,
    runId: "run-stub",
    modality: "text",
    version,
    bindings: toolKeys.map(binding),
    history: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    thinking,
    onEvent: (event: RuntimeEvent) => {
      if (event.type === "assistant.delta") {
        answer += event.text;
      }
      if (event.type === "assistant.thinking") {
        thought += event.text;
      }
      if (event.type === "tool.started") {
        tools.push(event.toolKey);
      }
    },
  });
  return { answer, thinking: thought, tools };
}

describe("StubRuntime answers", () => {
  it("returns only the calculator result as the answer", async () => {
    const prompt = "What is 2 + 3?";
    const seen = await run(prompt, ["calculator"]);
    expect(seen.answer).toBe("2 + 3 = 5");
    expect(seen.answer).not.toMatch(/Stub reply/i);
    expect(seen.answer).not.toContain(prompt);
    expect(seen.thinking).toMatch(/calculator/i);
    expect(seen.tools).toEqual(["calculator"]);
  });

  it("does not copy-paste a general question as the reply", async () => {
    const prompt = "Write a haiku about rain.";
    const seen = await run(prompt, []);
    expect(seen.answer).not.toContain(prompt);
    expect(seen.answer).not.toMatch(/Stub reply/i);
    expect(seen.thinking.length).toBeGreaterThan(0);
  });

  it("skips thinking events when thinking is off", async () => {
    const seen = await run("What is 2 + 3?", ["calculator"], false);
    expect(seen.thinking).toBe("");
    expect(seen.answer).toBe("2 + 3 = 5");
  });

  it("answers a clock question with datetime output", async () => {
    const seen = await run("What time is it now?", ["datetime"]);
    expect(seen.answer).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(seen.answer).not.toContain("What time is it now?");
    expect(seen.tools).toEqual(["datetime"]);
  });

  it("writes Bahasa Indonesia when locale is id", async () => {
    const runtime = new StubRuntime();
    let answer = "";
    let thought = "";
    await runtime.execute({
      tenant,
      runId: "run-id",
      modality: "text",
      version,
      bindings: [],
      history: [{ role: "user", parts: [{ type: "text", text: "Halo, apa kabar?" }] }],
      locale: "id",
      onEvent: (event: RuntimeEvent) => {
        if (event.type === "assistant.delta") {
          answer += event.text;
        }
        if (event.type === "assistant.thinking") {
          thought += event.text;
        }
      },
    });
    expect(answer).toMatch(/Toko Token/);
    expect(answer).toMatch(/Pengaturan/);
    expect(answer).not.toMatch(/I need a Toko Token/);
    expect(thought).toMatch(/Meja ini/);
  });

  it("looks up an earlier chat and says what it found", async () => {
    registerTool(
      defineTool({
        key: "past_sessions",
        name: "Past chats",
        description: "Earlier chats",
        schema: z.object({
          action: z.enum(["list", "read"]),
          session_id: z.string().optional(),
          search: z.string().optional(),
        }),
        execute: async () => ({
          success: true,
          sessions: [{ title: "Budget decision" }],
        }),
      }),
    );
    const seen = await run("what did we decide last time", ["past_sessions"]);
    expect(seen.tools).toEqual(["past_sessions"]);
    expect(seen.thinking).toMatch(/earlier chats/i);
    expect(seen.answer).toBe('The earlier chat is "Budget decision".');
    expect(seen.answer).not.toMatch(/gateway key/i);
  });

  it("does not read the clock when the question is about an earlier chat", async () => {
    const seen = await run("what did we decide last time", ["datetime", "past_sessions"]);
    expect(seen.tools).toEqual(["past_sessions"]);
    expect(seen.answer).not.toMatch(/T\d{2}:/);
    expect(seen.thinking).toMatch(/earlier chats/i);
  });

  it("cites the desk note and includes a number the check can drop", async () => {
    const runtime = new StubRuntime();
    let answer = "";
    await runtime.execute({
      tenant,
      runId: "run-desk",
      modality: "text",
      version: {
        ...version,
        systemPrompt: `${version.systemPrompt}\n\n## Retrieved sources\n[1] Desk note\nbody`,
      },
      bindings: [],
      history: [{ role: "user", parts: [{ type: "text", text: "what does the desk say about the note" }] }],
      onEvent: (event) => {
        if (event.type === "assistant.delta") {
          answer += event.text;
        }
      },
    });
    expect(answer).toBe("From the desk [1] [99].");
  });

  it("looks at an attachment and does not start a generate tool", async () => {
    const runtime = new StubRuntime();
    let thought = "";
    const tools: string[] = [];
    await runtime.execute({
      tenant,
      runId: "run-look",
      modality: "image",
      version,
      bindings: [binding("image_generate"), binding("video_generate")],
      history: [{ role: "user", parts: [{ type: "text", text: "What is in this image?" }] }],
      onEvent: (event) => {
        if (event.type === "assistant.thinking") {
          thought += event.text;
        }
        if (event.type === "tool.started") {
          tools.push(event.toolKey);
        }
      },
    });
    expect(thought).toMatch(/Looking at what you attached/);
    expect(tools).toEqual([]);
  });
});

describe("StubRuntime and the caller's signal", () => {
  function cancellable(signal: AbortSignal, onEvent: (event: RuntimeEvent) => void) {
    return new StubRuntime().execute({
      tenant,
      runId: "run-cancel",
      modality: "text",
      version,
      bindings: [],
      history: [{ role: "user", parts: [{ type: "text", text: "Write a haiku about rain." }] }],
      signal,
      onEvent,
    });
  }

  it("starts nothing when the caller has already left", async () => {
    const controller = new AbortController();
    controller.abort(new Error("client left"));
    const events: RuntimeEvent[] = [];
    await expect(cancellable(controller.signal, (event) => events.push(event))).rejects.toThrow("client left");
    expect(events).toEqual([]);
  });

  it("stops mid-answer with the signal's reason and never reports the run completed", async () => {
    const controller = new AbortController();
    const events: RuntimeEvent[] = [];
    const pending = cancellable(controller.signal, (event) => {
      events.push(event);
      if (event.type === "assistant.delta") {
        controller.abort(new Error("client left"));
      }
    });
    await expect(pending).rejects.toThrow("client left");
    expect(events.filter((event) => event.type === "assistant.delta")).toHaveLength(1);
    expect(events.some((event) => event.type === "run.completed")).toBe(false);
  });

  it("runs to the end exactly as before when the signal never fires", async () => {
    const events: RuntimeEvent[] = [];
    await cancellable(new AbortController().signal, (event) => events.push(event));
    expect(events.at(-1)).toEqual({ type: "run.completed", runId: "run-cancel" });
  });
});
