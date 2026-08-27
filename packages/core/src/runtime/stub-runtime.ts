import { getTool } from "../tools/registry";
import { invokeTool } from "../tools/define-tool";
import { summarizeParts } from "../content/parse-run-input";
import type { AgentRuntime, RuntimeEvent } from "./types";

export class StubRuntime implements AgentRuntime {
  async execute(input: Parameters<AgentRuntime["execute"]>[0]): Promise<void> {
    const last = input.history[input.history.length - 1];
    const summary = last ? summarizeParts(last.parts) : "";
    const calculator = input.bindings.find((binding) => binding.toolKey === "calculator" && binding.enabled);
    if (calculator && /\d+\s*[+\-*/]\s*\d+/.test(summary)) {
      const tool = getTool("calculator");
      if (tool) {
        const match = summary.match(/(\d+\s*[+\-*/]\s*\d+)/);
        const expression = match?.[1] ?? "1+1";
        await input.onEvent({ type: "tool.started", toolKey: "calculator", input: { expression } });
        const output = await invokeTool(tool, { expression }, input.tenant);
        await input.onEvent({ type: "tool.completed", toolKey: "calculator", output });
      }
    }
    const text = `Stub reply (${input.modality} / ${input.version.model}): ${summary || "ready"}`;
    for (const chunk of text.match(/.{1,24}/g) ?? [text]) {
      await input.onEvent({ type: "assistant.delta", text: chunk });
    }
    const completed: RuntimeEvent = { type: "run.completed", runId: input.runId };
    await input.onEvent(completed);
  }
}
