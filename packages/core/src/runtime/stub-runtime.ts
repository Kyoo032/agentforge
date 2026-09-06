import { getTool } from "../tools/registry";
import { summarizeParts } from "../content/parse-run-input";
import type { AgentRuntime, RuntimeEvent } from "./types";
import { invokeToolGuarded } from "./invoke-guarded";
import { resolveRequestReasoningEffort } from "../models/reasoning-effort";
import { MODEL_CONTACT_ATTEMPTS, formatContactProbe } from "./retry";

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

async function emitText(
  onEvent: (event: RuntimeEvent) => Promise<void> | void,
  text: string,
): Promise<void> {
  for (const chunk of text.match(/.{1,24}/g) ?? [text]) {
    await onEvent({ type: "assistant.delta", text: chunk });
  }
}

export class StubRuntime implements AgentRuntime {
  async execute(input: Parameters<AgentRuntime["execute"]>[0]): Promise<void> {
    const last = input.history[input.history.length - 1];
    const summary = last ? summarizeParts(last.parts) : "";
    const showThinking = resolveRequestReasoningEffort(input) !== "none";
    await input.onEvent({
      type: "run.probing",
      model: input.version.model,
      attempt: 1,
      attempts: MODEL_CONTACT_ATTEMPTS,
      message: formatContactProbe(input.version.model, 1),
    });
    const answers: string[] = [];

    const wantsCalc = hasEnabledBinding(input.bindings, "calculator") && /\d+\s*[+\-*/]\s*\d+/.test(summary);
    const wantsClock =
      hasEnabledBinding(input.bindings, "datetime") && /\b(date|time|today|now|clock)\b/i.test(summary);

    if (showThinking) {
      const plan = wantsCalc
        ? "I'll compute this with the calculator, then return only the result."
        : wantsClock
          ? "I'll read the clock and return the timestamp."
          : "This desk has no live model. I can still use local tools; a gateway key in Settings unlocks a real answer.";
      await input.onEvent({ type: "assistant.thinking", text: plan });
    }

    if (wantsCalc) {
      const tool = getTool("calculator");
      if (tool) {
        const match = summary.match(/(\d+\s*[+\-*/]\s*\d+)/);
        const expression = match?.[1] ?? "1+1";
        await input.onEvent({ type: "tool.started", toolKey: "calculator", input: { expression } });
        const output = await invokeToolGuarded(tool, { expression }, input.tenant);
        await input.onEvent({ type: "tool.completed", toolKey: "calculator", output });
        const result = calculatorResult(output);
        answers.push(result ? `${expression} = ${result}` : JSON.stringify(output));
      }
    }

    if (wantsClock) {
      const tool = getTool("datetime");
      if (tool) {
        await input.onEvent({ type: "tool.started", toolKey: "datetime", input: {} });
        const output = await invokeToolGuarded(tool, {}, input.tenant);
        await input.onEvent({ type: "tool.completed", toolKey: "datetime", output });
        const result = datetimeResult(output);
        answers.push(result ? result : JSON.stringify(output));
      }
    }

    const body =
      answers.length > 0
        ? answers.join("\n")
        : "I need a Toko Token gateway key in Settings to answer that.";
    await emitText(input.onEvent, body);
    await input.onEvent({ type: "run.completed", runId: input.runId });
  }
}
