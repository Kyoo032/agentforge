import { getTool } from "../tools/registry";
import { invokeTool } from "../tools/define-tool";
import { summarizeParts } from "../content/parse-run-input";
import type { AgentRuntime, RuntimeEvent } from "./types";

function hasEnabledBinding(
  bindings: Parameters<AgentRuntime["execute"]>[0]["bindings"],
  toolKey: string,
): boolean {
  return bindings.some((binding) => binding.toolKey === toolKey && binding.enabled);
}

function calculatorResult(output: unknown): string | null {
  if (!output || typeof output !== "object" || !("result" in output)) {
    return null;
  }
  const result = (output as { result: unknown }).result;
  return typeof result === "number" && Number.isFinite(result) ? String(result) : null;
}

function datetimeResult(output: unknown): string | null {
  if (!output || typeof output !== "object") {
    return null;
  }
  const record = output as { iso?: unknown; timezone?: unknown };
  if (typeof record.iso !== "string" || !record.iso) {
    return null;
  }
  const zone = typeof record.timezone === "string" && record.timezone ? record.timezone : "UTC";
  return `${record.iso} (${zone})`;
}

export class StubRuntime implements AgentRuntime {
  async execute(input: Parameters<AgentRuntime["execute"]>[0]): Promise<void> {
    const last = input.history[input.history.length - 1];
    const summary = last ? summarizeParts(last.parts) : "";
    const answers: string[] = [];

    if (hasEnabledBinding(input.bindings, "calculator") && /\d+\s*[+\-*/]\s*\d+/.test(summary)) {
      const tool = getTool("calculator");
      if (tool) {
        const match = summary.match(/(\d+\s*[+\-*/]\s*\d+)/);
        const expression = match?.[1] ?? "1+1";
        await input.onEvent({ type: "tool.started", toolKey: "calculator", input: { expression } });
        const output = await invokeTool(tool, { expression }, input.tenant);
        await input.onEvent({ type: "tool.completed", toolKey: "calculator", output });
        const result = calculatorResult(output);
        answers.push(result ? `${expression} = ${result}` : JSON.stringify(output));
      }
    }

    if (
      hasEnabledBinding(input.bindings, "datetime") &&
      /\b(date|time|today|now|clock)\b/i.test(summary)
    ) {
      const tool = getTool("datetime");
      if (tool) {
        await input.onEvent({ type: "tool.started", toolKey: "datetime", input: {} });
        const output = await invokeTool(tool, {}, input.tenant);
        await input.onEvent({ type: "tool.completed", toolKey: "datetime", output });
        const result = datetimeResult(output);
        answers.push(result ? `Current time is ${result}` : JSON.stringify(output));
      }
    }

    const body =
      answers.length > 0
        ? answers.join(" ")
        : "This desk is on the stub runtime, so I cannot think live. Paste a Toko Token gateway key in Settings for a real answer.";
    const text = `Stub reply (${input.modality} / ${input.version.model}): ${body}`;
    for (const chunk of text.match(/.{1,24}/g) ?? [text]) {
      await input.onEvent({ type: "assistant.delta", text: chunk });
    }
    const completed: RuntimeEvent = { type: "run.completed", runId: input.runId };
    await input.onEvent(completed);
  }
}
