"use client";

import { isRenderableImageUrl, isRenderableVideoUrl } from "@/lib/composer-attach";
import { mediaSrc } from "@/lib/api-client";
import { FormattedText } from "@/components/formatted-text";
import { collectToolMediaParts } from "@/lib/tool-media";
import { showsToolSpinner, toolActivityLabel, toolCallSummary } from "@/lib/tool-labels";
import type { ContentPart, ToolCallPart } from "@agentforge/core/content";
import { t } from "@/lib/i18n";

export type LiveTool = {
  key: string;
  status: "started" | "completed";
  input?: unknown;
  output?: unknown;
};

type Props = {
  role: string;
  content?: unknown;
  live?: {
    thinking: string;
    tools: LiveTool[];
    streaming: string;
    running: boolean;
    thinkingEnabled?: boolean;
  };
};

function PulseDots() {
  return (
    <span className="pulse-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function ChatTurn({ role, content, live }: Props) {
  const isUser = role === "user";
  const thinking = live ? live.thinking : thinkingFromContent(content);
  const tools = live ? live.tools : toolsFromContent(content);
  const visibleTools = tools.filter((tool) => tool.status === "started" || tool.status === "completed");
  const liveMedia = live ? live.tools.flatMap((tool) => collectToolMediaParts(tool.output)) : [];
  const thinkingEnabled = live?.thinkingEnabled !== false;
  const showThinkingPlaceholder =
    Boolean(live?.running) && thinkingEnabled && !thinking && !live?.streaming && visibleTools.length === 0;
  /*
   * Thinking and the tool calls are one block now (owner ruling 2026-09-23): the tool rows used
   * to sit above the answer as their own list, so a finished turn showed the machinery before the
   * prose. They belong to the work, not to the result. The disclosure opens itself while the turn
   * is live and collapses when it lands, which is the "curious user can still open it" shape.
   *
   * `hasActivity` also covers a tool with no thinking at all — a stub run with thinking off fires
   * tools without emitting reasoning, and folding on `thinking` alone would have hidden them.
   */
  const hasActivity = Boolean(thinking) || visibleTools.length > 0;
  const showDisclosure = hasActivity || showThinkingPlaceholder;

  return (
    <article
      className={
        isUser
          ? "enter-rise ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md border-2 border-[color-mix(in_srgb,var(--accent)_24%,var(--line))] bg-[var(--accent-soft)] px-4 py-3 text-[var(--text)] shadow-[0_3px_0_color-mix(in_srgb,var(--accent)_24%,var(--line))]"
          : "enter-rise mr-10 px-1 py-1"
      }
      data-testid="message"
    >
      {isUser ? (
        <MessageBody content={content} />
      ) : (
        <div className="space-y-2">
          {showDisclosure ? (
            <details
              className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 shadow-elev-1"
              data-testid="message-thinking"
              open={Boolean(live)}
            >
              <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--text-3)]">
                {t("chat.turn.thinking")}
                {live?.running && thinking ? <PulseDots /> : null}
              </summary>
              {thinking ? (
                /* Markdown, not a raw `<pre>`: reasoning arrives with lists, emphasis and fenced
                   code, and the block should embed them the way a message does. */
                <div className="mt-2 max-h-72 overflow-auto" data-testid="thinking-text">
                  <FormattedText text={thinking} className="text-xs" />
                </div>
              ) : (
                <p
                  className="mt-2 flex items-center gap-2 text-xs text-[var(--text-2)]"
                  data-testid="thinking-placeholder"
                >
                  {live?.running ? <PulseDots /> : null}
                  {t("chat.turn.thinkingPlaceholder")}
                </p>
              )}
              {visibleTools.length > 0 ? (
                <ul className="mt-2 space-y-1" data-testid="message-tools">
                  {visibleTools.map((tool, index) => (
                    <li
                      key={`${tool.key}-${index}`}
                      /* `break-words` + `whitespace-pre-wrap`: a payload used to be cut at 80
                         characters with an ellipsis. Wrapping it is what makes the call readable. */
                      className="whitespace-pre-wrap break-words rounded-xl border border-[var(--line)] px-3 py-1.5 font-mono text-xs text-[var(--text-2)]"
                      data-testid="message-tool"
                    >
                      {tool.status === "started" && showsToolSpinner(tool.key)
                        ? toolActivityLabel(tool.key)
                        : toolCallSummary(tool.key, tool.input, tool.output)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </details>
          ) : null}
          {live?.streaming ? (
            <div className="space-y-2">
              <FormattedText text={live.streaming} className="text-sm" testId="message-output" />
              {live.running && !showDisclosure ? <PulseDots /> : null}
            </div>
          ) : (
            <>
              <MessageBody content={content} outputOnly />
              {live?.running && !showDisclosure ? <PulseDots /> : null}
            </>
          )}
          {liveMedia.length > 0 ? <MediaParts parts={liveMedia} /> : null}
        </div>
      )}
    </article>
  );
}

export function messageHasDisplayableContent(content: unknown): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0;
  }
  if (!Array.isArray(content)) {
    return content != null;
  }
  return content.some((part) => {
    if (!part || typeof part !== "object") {
      return false;
    }
    const type = (part as { type?: unknown }).type;
    if (type === "thinking") {
      return String((part as { text?: unknown }).text ?? "").trim().length > 0;
    }
    if (type === "tool_call") {
      return true;
    }
    if (type === "text") {
      return String((part as { text?: unknown }).text ?? "").trim().length > 0;
    }
    return partImageUrl(part) != null || partVideoUrl(part) != null;
  });
}

function thinkingFromContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "thinking")
    .map((part) => String((part as { text: string }).text ?? ""))
    .join("")
    .trim();
}

function toolsFromContent(content: unknown): LiveTool[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .filter((part): part is ToolCallPart =>
      Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "tool_call"),
    )
    .map((part) => ({
      key: part.toolKey,
      status: part.status,
      input: part.input,
      output: part.output,
    }));
}

function MessageBody({ content, outputOnly = false }: { content?: unknown; outputOnly?: boolean }) {
  if (typeof content === "string") {
    if (outputOnly && !content.trim()) {
      return null;
    }
    return outputOnly ? (
      <FormattedText text={content} className="text-sm" testId="message-output" />
    ) : (
      <p className="whitespace-pre-wrap text-sm">{content}</p>
    );
  }
  if (!Array.isArray(content)) {
    if (content == null) {
      return null;
    }
    return <p className="whitespace-pre-wrap text-sm">{JSON.stringify(content)}</p>;
  }

  const parts = outputOnly
    ? content.filter((part) => {
        if (!part || typeof part !== "object") return false;
        const type = (part as { type?: unknown }).type;
        return type === "text" || type === "image_url" || type === "video_url";
      })
    : content;

  return (
    <div className="space-y-2">
      {parts.map((part, index) => {
        const imageUrl = partImageUrl(part);
        if (imageUrl) {
          return (
            <img key={index} src={imageUrl} alt="" className="mt-2 max-w-full rounded-xl" data-testid="message-image" />
          );
        }
        const videoUrl = partVideoUrl(part);
        if (videoUrl) {
          return (
            <video
              key={index}
              src={videoUrl}
              controls
              className="mt-2 max-w-full rounded-xl"
              data-testid="message-video"
            />
          );
        }
        if (part && typeof part === "object" && (part as { type?: unknown }).type === "text" && "text" in part) {
          const text = String((part as { text: string }).text);
          if (!text.trim()) return null;
          return outputOnly ? (
            <FormattedText key={index} text={text} className="text-sm" testId="message-output" />
          ) : (
            <p key={index} className="whitespace-pre-wrap text-sm">
              {text}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

function MediaParts({ parts }: { parts: ContentPart[] }) {
  return (
    <div className="space-y-2">
      {parts.map((part, index) => {
        const imageUrl = partImageUrl(part);
        if (imageUrl) {
          return (
            <img key={index} src={imageUrl} alt="" className="max-w-full rounded-xl" data-testid="message-image" />
          );
        }
        const videoUrl = partVideoUrl(part);
        if (videoUrl) {
          return (
            <video key={index} src={videoUrl} controls className="max-w-full rounded-xl" data-testid="message-video" />
          );
        }
        return null;
      })}
    </div>
  );
}

function partImageUrl(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const record = part as { type?: unknown; image_url?: { url?: unknown } };
  if (record.type !== "image_url") return null;
  const url = record.image_url?.url;
  return typeof url === "string" && isRenderableImageUrl(url) ? mediaSrc(url) : null;
}

function partVideoUrl(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const record = part as { type?: unknown; video_url?: { url?: unknown } };
  if (record.type !== "video_url") return null;
  const url = record.video_url?.url;
  return typeof url === "string" && isRenderableVideoUrl(url) ? mediaSrc(url) : null;
}
