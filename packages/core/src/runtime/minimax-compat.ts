/**
 * MiniMax M3 (and MiniMax chat ids) stream thinking in non-OpenAI fields.
 * AI SDK 4 only maps delta.content → text-delta, so Chat looks empty unless
 * a proxy (Hermes serve) rewrites the stream. Do that rewrite here instead.
 */

export function isMinimaxChatModel(modelId: unknown): boolean {
  if (typeof modelId !== "string" || !modelId.trim()) {
    return false;
  }
  const trimmed = modelId.trim().toLowerCase();
  const slash = trimmed.lastIndexOf("/");
  const leaf = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  return leaf.includes("minimax");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function collectReasoningText(delta: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["reasoning_content", "reasoning"] as const) {
    const value = delta[key];
    if (typeof value === "string" && value.length > 0) {
      parts.push(value);
    }
  }
  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    for (const item of details) {
      if (typeof item === "string" && item.length > 0) {
        parts.push(item);
        continue;
      }
      const record = asRecord(item);
      if (record && typeof record.text === "string" && record.text.length > 0) {
        parts.push(record.text);
      }
    }
  }
  return parts.join("");
}

const THINK_BLOCK = /<think>([\s\S]*?)<\/think>/gi;

export function splitThinkTags(text: string): { thinking: string; visible: string } {
  if (!text) {
    return { thinking: "", visible: "" };
  }
  let thinking = "";
  let visible = text.replace(THINK_BLOCK, (_match, inner: string) => {
    thinking += inner;
    return "";
  });
  const unclosed = visible.match(/^<think>([\s\S]*)$/i);
  if (unclosed?.[1] !== undefined) {
    thinking += unclosed[1];
    visible = "";
  }
  return { thinking: thinking.trim(), visible: visible.trim() };
}

function contentToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        const record = asRecord(item);
        if (record && typeof record.text === "string") {
          return record.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

/** Rewrite a MiniMax delta/message so AI SDK 4 sees the answer in `content`. */
export function normalizeMinimaxDelta(delta: unknown): Record<string, unknown> {
  const record = asRecord(delta);
  if (!record) {
    return {};
  }
  const reasoning = collectReasoningText(record);
  const rawContent = contentToString(record.content);
  const split = splitThinkTags(rawContent);
  const thinking = [reasoning, split.thinking].filter(Boolean).join("");
  const visible = split.visible;
  const content = visible || thinking;
  const next: Record<string, unknown> = { ...record };
  if (content) {
    next.content = content;
  }
  if (thinking && thinking !== content) {
    next.reasoning_content = thinking;
  }
  return next;
}

export function normalizeMinimaxPayload(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) {
    return payload;
  }
  if (!Array.isArray(record.choices)) {
    return payload;
  }
  return {
    ...record,
    choices: record.choices.map((choice) => {
      const item = asRecord(choice);
      if (!item) {
        return choice;
      }
      const next = { ...item };
      if (item.delta) {
        next.delta = normalizeMinimaxDelta(item.delta);
      }
      if (item.message) {
        next.message = normalizeMinimaxDelta(item.message);
      }
      return next;
    }),
  };
}

export function applyMinimaxRequest(body: unknown): unknown {
  const record = asRecord(body);
  if (!record || !isMinimaxChatModel(record.model)) {
    return body;
  }
  if (record.reasoning_split === true || record.reasoning_split === false) {
    return body;
  }
  return { ...record, reasoning_split: true };
}

function rewriteSseDataLine(line: string): string {
  const match = line.match(/^(data:\s*)(.*)$/);
  if (!match) {
    return line;
  }
  const prefix = match[1] ?? "data: ";
  const rest = match[2] ?? "";
  if (!rest || rest === "[DONE]") {
    return line;
  }
  try {
    const parsed = JSON.parse(rest) as unknown;
    return `${prefix}${JSON.stringify(normalizeMinimaxPayload(parsed))}`;
  } catch {
    return line;
  }
}

export function rewriteMinimaxSseChunk(chunk: string): string {
  if (!chunk.includes("data:")) {
    return chunk;
  }
  const endsWithNewline = chunk.endsWith("\n");
  const lines = chunk.split("\n");
  const lastIncomplete = !endsWithNewline ? lines.pop() : undefined;
  const rewritten = lines.map((line) => rewriteSseDataLine(line));
  if (lastIncomplete !== undefined) {
    rewritten.push(lastIncomplete);
  }
  return rewritten.join("\n") + (endsWithNewline && chunk.length > 0 ? "" : "");
}

export async function wrapMinimaxResponse(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream") && response.body) {
    let pending = "";
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const transformed = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          pending += decoder.decode(chunk, { stream: true });
          const lastNl = pending.lastIndexOf("\n");
          if (lastNl === -1) {
            return;
          }
          const complete = pending.slice(0, lastNl + 1);
          pending = pending.slice(lastNl + 1);
          controller.enqueue(encoder.encode(rewriteMinimaxSseChunk(complete)));
        },
        flush(controller) {
          pending += decoder.decode();
          if (pending.length > 0) {
            controller.enqueue(encoder.encode(rewriteMinimaxSseChunk(pending)));
          }
        },
      }),
    );
    return new Response(transformed, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  if (contentType.includes("json")) {
    try {
      const payload = (await response.clone().json()) as unknown;
      const normalized = normalizeMinimaxPayload(payload);
      return new Response(JSON.stringify(normalized), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response;
    }
  }
  return response;
}
