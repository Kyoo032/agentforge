import { getTool } from "../tools/registry";
import { summarizeParts } from "../content/parse-run-input";
import type { AgentRuntime, RuntimeEvent } from "./types";
import { invokeToolGuarded } from "./invoke-guarded";
import { resolveRequestReasoningEffort } from "../models/reasoning-effort";
import { MODEL_CONTACT_ATTEMPTS, formatContactProbe } from "./retry";
import { parseAppLocale } from "../locale";
import { sentenceFromCalculator, sentenceFromDatetime, sentenceFromPastSessions } from "../agents/chat-turn";
import {
  chatTurnCopy,
  stubChatCopy,
  wantsStubClock,
  wantsStubDeskSource,
  wantsStubPastChat,
} from "../agents/chat-locale";

function hasEnabledBinding(bindings: Parameters<AgentRuntime["execute"]>[0]["bindings"], toolKey: string): boolean {
  return bindings.some((binding) => binding.toolKey === toolKey && binding.enabled);
}

async function emitText(
  onEvent: (event: RuntimeEvent) => Promise<void> | void,
  text: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const chunk of text.match(/.{1,24}/g) ?? [text]) {
    signal?.throwIfAborted();
    await onEvent({ type: "assistant.delta", text: chunk });
  }
}

export class StubRuntime implements AgentRuntime {
  async execute(input: Parameters<AgentRuntime["execute"]>[0]): Promise<void> {
    // Same contract as the live runtime: once the caller leaves, nothing further is sent and the run
    // rejects with the signal's reason.
    input.signal?.throwIfAborted();
    const last = input.history[input.history.length - 1];
    const summary = last ? summarizeParts(last.parts) : "";
    const showThinking = resolveRequestReasoningEffort(input) !== "none";
    const locale = parseAppLocale(input.locale);
    const copy = stubChatCopy(locale);
    const turn = chatTurnCopy(locale);
    const understand = input.modality !== "text";
    const generateBound = input.bindings.some(
      (binding) => binding.enabled && (binding.toolKey === "image_generate" || binding.toolKey === "video_generate"),
    );
    await input.onEvent({
      type: "run.probing",
      model: input.version.model,
      attempt: 1,
      attempts: MODEL_CONTACT_ATTEMPTS,
      message: formatContactProbe(input.version.model, 1, MODEL_CONTACT_ATTEMPTS, locale),
    });
    const answers: string[] = [];

    const wantsCalc = hasEnabledBinding(input.bindings, "calculator") && /\d+\s*[+\-*/]\s*\d+/.test(summary);
    const wantsPast = hasEnabledBinding(input.bindings, "past_sessions") && wantsStubPastChat(summary);
    // "last time" contains the word time. An earlier-chat question is not a request for the clock.
    const wantsClock = hasEnabledBinding(input.bindings, "datetime") && wantsStubClock(summary) && !wantsPast;
    const wantsDesk = /## Retrieved sources/.test(input.version.systemPrompt) && wantsStubDeskSource(summary);

    if (showThinking) {
      const plan = wantsCalc
        ? copy.thinkCalc
        : wantsClock
          ? copy.thinkClock
          : wantsPast
            ? turn.thinkPast
            : understand && generateBound
              ? turn.lookingAttached
              : wantsDesk
                ? turn.thinkDesk
                : copy.thinkDefault;
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
        const result = sentenceFromCalculator(expression, output);
        answers.push(result ?? JSON.stringify(output));
      }
    }

    if (wantsClock) {
      const tool = getTool("datetime");
      if (tool) {
        await input.onEvent({ type: "tool.started", toolKey: "datetime", input: {} });
        const output = await invokeToolGuarded(tool, {}, input.tenant);
        await input.onEvent({ type: "tool.completed", toolKey: "datetime", output });
        const result = sentenceFromDatetime(output);
        answers.push(result ?? JSON.stringify(output));
      }
    }

    if (wantsPast) {
      const tool = getTool("past_sessions");
      if (tool) {
        await input.onEvent({ type: "tool.started", toolKey: "past_sessions", input: { action: "list" } });
        const output = await invokeToolGuarded(tool, { action: "list" }, input.tenant);
        await input.onEvent({ type: "tool.completed", toolKey: "past_sessions", output });
        answers.push(sentenceFromPastSessions(output, locale));
      }
    }

    if (wantsDesk) {
      answers.push(turn.deskCite);
    }

    const body = answers.length > 0 ? answers.join("\n") : copy.needKey;
    await emitText(input.onEvent, body, input.signal);
    await input.onEvent({ type: "run.completed", runId: input.runId });
  }
}
