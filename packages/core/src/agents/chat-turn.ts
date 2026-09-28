import { parseAppLocale, type AppLocale } from "../locale";
import type { InputModality } from "../tenancy/types";
import { chatTurnCopy, fillChatTurn } from "./chat-locale";

/** Generate tools stay on a text turn. An attached picture or clip is understand, not a new file. */
export const CHAT_UNDERSTAND_HIDDEN_TOOLS = ["image_generate", "video_generate"] as const;

const MARKER = /\[(\d+)\]/g;
const FENCE = /^\s{0,3}(```|~~~)/;

export function bindingsForChatModality<T extends { toolKey: string }>(
  bindings: readonly T[],
  modality: InputModality,
): T[] {
  if (modality === "text") {
    return [...bindings];
  }
  const hidden = new Set<string>(CHAT_UNDERSTAND_HIDDEN_TOOLS);
  return bindings.filter((binding) => !hidden.has(binding.toolKey));
}

export type SettledTool = {
  toolKey: string;
  status: "started" | "completed";
  input?: unknown;
  output?: unknown;
};

function calculatorResult(output: unknown): number | null {
  if (!output || typeof output !== "object" || !("result" in output)) {
    return null;
  }
  const result = (output as { result: unknown }).result;
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}

export function sentenceFromCalculator(expression: string, output: unknown): string | null {
  const result = calculatorResult(output);
  if (result === null) {
    return null;
  }
  const expr = expression.trim();
  return expr ? `${expr} = ${result}` : String(result);
}

export function sentenceFromDatetime(output: unknown): string | null {
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

function pastTitle(output: unknown): { title: string; count: number } | null {
  if (!output || typeof output !== "object") {
    return null;
  }
  const sessions = (output as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) {
    return null;
  }
  const titles = sessions
    .map((session) => {
      if (!session || typeof session !== "object" || !("title" in session)) {
        return "";
      }
      const title = (session as { title: unknown }).title;
      return typeof title === "string" ? title.trim() : "";
    })
    .filter((title) => title.length > 0);
  const title = titles[0];
  if (!title) {
    return null;
  }
  return { title, count: titles.length };
}

export function sentenceFromPastSessions(output: unknown, locale: AppLocale): string {
  const copy = chatTurnCopy(locale);
  const found = pastTitle(output);
  if (!found) {
    return copy.pastNone;
  }
  const template = found.count > 1 ? copy.pastMany : copy.pastOne;
  return fillChatTurn(template, found.title);
}

function expressionOf(input: unknown): string {
  if (!input || typeof input !== "object" || !("expression" in input)) {
    return "";
  }
  const expression = (input as { expression: unknown }).expression;
  return typeof expression === "string" ? expression : "";
}

/** One sentence from a tool that already ran. Null when this tool has nothing to say in words. */
export function sentenceFromTool(tool: SettledTool, locale: AppLocale): string | null {
  if (tool.status !== "completed") {
    return null;
  }
  if (tool.toolKey === "calculator") {
    return sentenceFromCalculator(expressionOf(tool.input), tool.output);
  }
  if (tool.toolKey === "datetime") {
    return sentenceFromDatetime(tool.output);
  }
  if (tool.toolKey === "past_sessions") {
    return sentenceFromPastSessions(tool.output, locale);
  }
  return null;
}

/**
 * Drop `[n]` markers the desk did not offer. Markers inside a fence stay, matching `parseCiteMarkers`.
 * When every marker was invented, add one sentence. A marker that does map is left alone.
 */
export function repairUnresolvedCites(text: string, offered: number, locale: AppLocale): string {
  if (!text) {
    return text;
  }
  let fence: string | null = null;
  let removed = 0;
  let kept = 0;
  const lines = text.split("\n").map((line) => {
    const token = FENCE.exec(line)?.[1];
    if (token) {
      if (fence === null) {
        fence = token;
      } else if (fence === token) {
        fence = null;
      }
      return line;
    }
    if (fence !== null) {
      return line;
    }
    return line.replace(MARKER, (full, digits: string) => {
      const n = Number(digits);
      if (!Number.isSafeInteger(n) || n < 1) {
        return full;
      }
      if (n <= offered) {
        kept += 1;
        return full;
      }
      removed += 1;
      return "";
    });
  });
  let next = lines
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/\s+(?:and|dan)\s*([.?!])/gi, "$1")
    .replace(/[ \t]+$/gm, "")
    .trim();
  if (removed > 0 && kept === 0) {
    const note = chatTurnCopy(locale).noSource;
    if (!next.includes(note)) {
      next = next ? `${next}\n\n${note}` : note;
    }
  }
  return next;
}

export type SettledChatTurn = {
  text: string;
  /** Suffix to stream when the saved reply only grew. Empty when the check rewrote the middle. */
  appended: string;
};

/**
 * The check after one bounded answer. No second model call.
 * A reply that already has words keeps them, minus source numbers the desk did not offer.
 * A tool that returned and left no sentence becomes that sentence.
 */
export function settleChatTurn(options: {
  text: string;
  offeredSources: number;
  tools: readonly SettledTool[];
  locale: AppLocale;
}): SettledChatTurn {
  const locale = parseAppLocale(options.locale);
  const repaired = repairUnresolvedCites(options.text, options.offeredSources, locale);
  if (repaired.trim()) {
    const appended = repaired.startsWith(options.text) ? repaired.slice(options.text.length) : "";
    return { text: repaired, appended };
  }
  const lines: string[] = [];
  for (const tool of options.tools) {
    const line = sentenceFromTool(tool, locale);
    if (line) {
      lines.push(line);
    }
  }
  const sentence = lines.join("\n");
  if (!sentence) {
    return { text: repaired, appended: "" };
  }
  return { text: sentence, appended: sentence };
}
