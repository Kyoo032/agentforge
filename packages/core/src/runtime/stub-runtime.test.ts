import { describe, expect, it } from "vitest";
import { registerPlatformTools } from "../tools/platform/register";
import { StubRuntime } from "./stub-runtime";
import type { AgentVersionRecord, ToolBindingRecord } from "../agents/service";
import type { RuntimeEvent } from "./types";

registerPlatformTools();

const tenant = { organizationId: "org", workspaceId: "ws", userId: "user" };

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
});
