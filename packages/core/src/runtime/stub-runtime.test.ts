import { describe, expect, it } from "vitest";
import { registerPlatformTools } from "../tools/platform/register";
import { StubRuntime } from "./stub-runtime";
import type { AgentVersionRecord, ToolBindingRecord } from "../agents/service";

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

async function run(prompt: string, toolKeys: string[]): Promise<string> {
  const runtime = new StubRuntime();
  let seen = "";
  await runtime.execute({
    tenant,
    runId: "run-stub",
    modality: "text",
    version,
    bindings: toolKeys.map(binding),
    history: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    onEvent: (event) => {
      if (event.type === "assistant.delta") {
        seen += event.text;
      }
    },
  });
  return seen;
}

describe("StubRuntime answers", () => {
  it("returns the calculator result instead of echoing the question", async () => {
    const prompt = "What is 2 + 3?";
    const seen = await run(prompt, ["calculator"]);
    expect(seen.startsWith("Stub reply (text / stub-model):")).toBe(true);
    expect(seen).toContain("2 + 3 = 5");
    expect(seen).not.toBe(`Stub reply (text / stub-model): ${prompt}`);
    expect(seen).not.toContain(prompt);
  });

  it("does not copy-paste a general question as the reply", async () => {
    const prompt = "Write a haiku about rain.";
    const seen = await run(prompt, []);
    expect(seen.startsWith("Stub reply (text / stub-model):")).toBe(true);
    expect(seen).toMatch(/gateway key|Settings/i);
    expect(seen).not.toBe(`Stub reply (text / stub-model): ${prompt}`);
    expect(seen).not.toContain(prompt);
  });

  it("answers a clock question with datetime output", async () => {
    const seen = await run("What time is it now?", ["datetime"]);
    expect(seen).toMatch(/Current time is \d{4}-\d{2}-\d{2}T/);
    expect(seen).not.toContain("What time is it now?");
  });
});
