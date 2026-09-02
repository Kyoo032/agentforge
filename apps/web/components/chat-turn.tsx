"use client";

import { isRenderableImageUrl, isRenderableVideoUrl } from "@/lib/composer-attach";
import { mediaSrc } from "@/lib/api-client";
import { collectToolMediaParts } from "@/lib/tool-media";
import { showsToolSpinner, toolActivityLabel, toolCallSummary } from "@/lib/tool-labels";
import type { ContentPart, ToolCallPart } from "@agentforge/core/content";

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
  };
};

export function ChatTurn({ role, content, live }: Props) {
  const isUser = role === "user";
  const thinking = live ? live.thinking : thinkingFromContent(content);
  const tools = live ? live.tools : toolsFromContent(content);
  const visibleTools = tools.filter((tool) => tool.status === "started" || tool.status === "completed");
  const liveMedia = live
    ? live.tools.flatMap((tool) => collectToolMediaParts(tool.output))
    : [];

  return (
    <article
      className={isUser ? "ml-10 rounded-2xl rounded-br-md bg-mist px-4 py-3" : "mr-10 rounded-xl px-1 py-1"}
      data-testid="message"
    >
      {isUser ? (
        <MessageBody content={content} />
      ) : (
        <div className="space-y-2">
          {thinking ? (
            <details
              className="rounded-lg border border-mist bg-mist/40 px-3 py-2"
              data-testid="message-thinking"
              open={Boolean(live)}
            >
              <summary className="cursor-pointer text-xs font-medium text-ink/60">Thinking</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-ink/70" data-testid="thinking-text">
                {thinking}
              </pre>
            </details>
          ) : live?.running && !live.streaming && visibleTools.length === 0 ? (
            <p className="text-sm text-ink/50" data-testid="thinking-placeholder">
              Thinking…
            </p>
          ) : null}
          {visibleTools.length > 0 ? (
            <ul className="space-y-1" data-testid="message-tools">
              {visibleTools.map((tool, index) => (
                <li
                  key={`${tool.key}-${index}`}
                  className="rounded-md border border-mist px-3 py-1.5 text-xs text-ink/70"
                  data-testid="message-tool"
                >
                  {tool.status === "started" && showsToolSpinner(tool.key)
                    ? toolActivityLabel(tool.key)
                    : toolCallSummary(tool.key, tool.input, tool.output)}
                </li>
              ))}
            </ul>
          ) : null}
          {live?.streaming ? (
            <p className="whitespace-pre-wrap text-sm" data-testid="message-output">
              {live.streaming}
            </p>
          ) : (
            <MessageBody content={content} outputOnly />
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
    .filter((part): part is ToolCallPart => Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "tool_call"))
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
    return (
      <p className="whitespace-pre-wrap text-sm" data-testid={outputOnly ? "message-output" : undefined}>
        {content}
      </p>
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
            <img
              key={index}
              src={imageUrl}
              alt=""
              className="mt-2 max-w-full rounded-lg"
              data-testid="message-image"
            />
          );
        }
        const videoUrl = partVideoUrl(part);
        if (videoUrl) {
          return (
            <video
              key={index}
              src={videoUrl}
              controls
              className="mt-2 max-w-full rounded-lg"
              data-testid="message-video"
            />
          );
        }
        if (part && typeof part === "object" && (part as { type?: unknown }).type === "text" && "text" in part) {
          const text = String((part as { text: string }).text);
          if (!text.trim()) return null;
          return (
            <p key={index} className="whitespace-pre-wrap text-sm" data-testid={outputOnly ? "message-output" : undefined}>
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
          return <img key={index} src={imageUrl} alt="" className="max-w-full rounded-lg" data-testid="message-image" />;
        }
        const videoUrl = partVideoUrl(part);
        if (videoUrl) {
          return (
            <video key={index} src={videoUrl} controls className="max-w-full rounded-lg" data-testid="message-video" />
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
