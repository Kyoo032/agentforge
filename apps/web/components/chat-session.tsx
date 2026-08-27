"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChatComposer } from "@/components/chat-composer";
import { isRenderableImageUrl, isRenderableVideoUrl } from "@/lib/composer-attach";
import { notifyThreadsChanged } from "@/lib/threads-events";
import { GATEWAY_NAME } from "@agentforge/core/gateway";

type Message = { id: string; role: string; content: unknown };

type ModelProvider = "openai" | "anthropic" | "google" | "volcengine";

type ChatModel = {
  id: string;
  label: string;
  provider?: ModelProvider;
  inputModalities: string[];
};

type Specialist = {
  id: string;
  name: string;
  description: string;
};

type Props = {
  agentId?: string;
  initialThreadId?: string;
};

export function ChatSession({ agentId, initialThreadId }: Props) {
  const router = useRouter();
  const [agentName, setAgentName] = useState("Chat");
  const [isDefaultChat, setIsDefaultChat] = useState(!agentId);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [agentIdReady, setAgentIdReady] = useState<string | null>(agentId ?? null);
  const [agentModalities, setAgentModalities] = useState<string[]>(["text"]);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState("");
  const [thinking, setThinking] = useState("");
  const [tools, setTools] = useState<Array<{ key: string; status: "started" | "completed"; detail?: string }>>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  const selectedModel = models.find((model) => model.id === modelId);
  const modalities = useMemo(() => {
    const modelMods = selectedModel?.inputModalities ?? ["text"];
    return ["text", "image", "video"].filter(
      (modality) => agentModalities.includes(modality) && modelMods.includes(modality),
    );
  }, [agentModalities, selectedModel]);

  function chatPath() {
    return agentId ? `/chat/${agentId}` : "/chat";
  }

  function resetLive() {
    setStreaming("");
    setThinking("");
    setTools([]);
    setRunning(false);
  }

  async function ensureThread() {
    if (threadIdRef.current) {
      return threadIdRef.current;
    }
    if (!agentIdReady) {
      throw new Error("Chat is still loading");
    }
    const created = await fetch("/api/v1/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agentIdReady }),
    }).then((res) => res.json());
    if (created.error) {
      throw new Error(created.error.message ?? "Could not start a chat");
    }
    const id = created.thread.id as string;
    threadIdRef.current = id;
    setThreadId(id);
    router.replace(`${chatPath()}?thread=${id}`);
    notifyThreadsChanged();
    return id;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setError(null);
        let readyId = agentId ?? null;
        if (agentId) {
          const [agentPayload, caps, modelPayload] = await Promise.all([
            fetch(`/api/v1/agents/${agentId}`).then((res) => res.json()),
            fetch(`/api/v1/agents/${agentId}/capabilities`).then((res) => res.json()),
            fetch("/api/v1/models").then((res) => res.json()),
          ]);
          if (agentPayload.error) {
            throw new Error(agentPayload.error.message ?? "Agent not found");
          }
          if (cancelled) {
            return;
          }
          setAgentName(agentPayload.agent?.name ?? "Agent");
          setIsDefaultChat(agentPayload.agent?.slug === "quick-chat");
          setAgentModalities(caps.inputModalities ?? ["text"]);
          setModels(modelPayload.models ?? []);
          setModelId(
            agentPayload.agent?.slug === "quick-chat"
              ? (modelPayload.defaultModel ?? caps.model ?? "")
              : (caps.model ?? modelPayload.defaultModel ?? ""),
          );
          readyId = agentId;
          setAgentIdReady(agentId);
        } else {
          const home = await fetch("/api/v1/chat").then((res) => res.json());
          if (home.error) {
            throw new Error(home.error.message ?? "Could not open chat");
          }
          if (cancelled) {
            return;
          }
          setAgentName(home.agent?.name ?? "Chat");
          setIsDefaultChat(true);
          setAgentModalities(home.version?.inputModalities ?? ["text", "image", "video"]);
          setModels(home.models ?? []);
          setModelId(home.defaultModel ?? home.version?.model ?? "");
          setSpecialists(home.specialists ?? []);
          readyId = home.agent.id;
          setAgentIdReady(home.agent.id);
        }

        if (initialThreadId) {
          if (initialThreadId === threadIdRef.current) {
            return;
          }
          const payload = await fetch(`/api/v1/threads/${initialThreadId}`).then((res) => res.json());
          if (payload.error) {
            throw new Error(payload.error.message ?? "Thread not found");
          }
          if (cancelled) {
            return;
          }
          const threadAgentId = payload.thread?.agentId as string | undefined;
          if (threadAgentId && readyId && threadAgentId !== readyId && !agentId) {
            router.replace(`/chat/${threadAgentId}?thread=${initialThreadId}`);
            return;
          }
          threadIdRef.current = payload.thread.id;
          setThreadId(payload.thread.id);
          setMessages(payload.messages ?? []);
          resetLive();
          return;
        }

        threadIdRef.current = null;
        setThreadId(null);
        setMessages([]);
        resetLive();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not open chat");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, initialThreadId, router]);

  async function refreshMessages(id: string) {
    const payload = await fetch(`/api/v1/threads/${id}`).then((res) => res.json());
    setMessages(payload.messages ?? []);
  }

  const empty = messages.length === 0 && !streaming && !thinking && !running && tools.length === 0;

  return (
    <main className="mx-auto flex min-h-full max-w-4xl flex-col px-6 py-8" data-testid="chat-home">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{isDefaultChat ? "Chat" : agentName}</h1>
          {!isDefaultChat ? (
            <p className="mt-1 text-sm text-ink/50">Specialist agent · pick any model for this thread</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {agentIdReady ? (
            <button
              type="button"
              className="rounded-md border border-mist px-3 py-2 text-sm"
              data-testid="new-chat"
              onClick={() => router.push(chatPath())}
            >
              New chat
            </button>
          ) : null}
        </div>
      </div>

      {isDefaultChat && specialists.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2" data-testid="specialist-list">
          {specialists.map((specialist) => (
            <Link
              key={specialist.id}
              href={`/chat/${specialist.id}`}
              className="rounded-full border border-mist bg-mist/60 px-3 py-1.5 text-sm"
              data-testid="specialist-chip"
              title={specialist.description}
            >
              {specialist.name}
            </Link>
          ))}
        </div>
      ) : null}

      {error ? <p className="mt-6 text-sm text-red-700">{error}</p> : null}

      <div className={`mt-6 flex-1 space-y-4 ${empty ? "flex flex-col justify-center" : ""}`} data-testid="message-list">
        {empty && !error ? (
          <div className="text-center" data-testid="chat-empty">
            <p className="text-2xl font-semibold">You're in. Ask anything.</p>
            <p className="mt-2 text-ink/60">
              The Default assistant is already here — pick a model and start chatting. This is yours, no account.
              Paste a {GATEWAY_NAME} gateway key in{" "}
              <Link href="/settings" className="underline">
                Settings
              </Link>{" "}
              when you want a live model.
            </p>
          </div>
        ) : null}
        {messages
          .filter((message) => message.role === "user" || messageHasDisplayableContent(message.content))
          .map((message) => (
          <article
            key={message.id}
            className={
              message.role === "user"
                ? "ml-10 rounded-2xl rounded-br-md bg-mist px-4 py-3"
                : "mr-10 rounded-xl px-1 py-1"
            }
            data-testid="message"
          >
            <MessageContent content={message.content} />
          </article>
        ))}
        {running || thinking || tools.length > 0 || streaming ? (
          <article className="mr-10 rounded-xl px-1 py-1" data-testid="assistant-live">
            {running && !thinking && !streaming && tools.length === 0 ? (
              <p className="text-sm text-ink/50" data-testid="thinking-placeholder">
                Thinking…
              </p>
            ) : null}
            {thinking ? (
              <pre
                className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-mist/60 px-3 py-2 text-xs text-ink/60"
                data-testid="thinking-text"
              >
                {thinking}
              </pre>
            ) : null}
            {tools.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-ink/60" data-testid="tool-status">
                {tools.map((tool, index) => {
                  const liveImage = tool.detail ? extractLiveToolImageUrl(tool.detail) : null;
                  return (
                    <li key={`${tool.key}-${index}`}>
                      {tool.status === "started" ? `Using ${tool.key}…` : `${tool.key} finished`}
                      {tool.detail && !liveImage ? ` · ${tool.detail}` : ""}
                      {liveImage ? (
                        <img
                          src={liveImage}
                          alt=""
                          className="mt-2 max-w-full rounded-lg"
                          data-testid="message-image"
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {streaming ? (
              <p className="mt-2 whitespace-pre-wrap text-sm" data-testid="streaming-text">
                {streaming}
              </p>
            ) : null}
          </article>
        ) : null}
      </div>
      {agentIdReady ? (
        <ChatComposer
          threadId={threadId}
          onEnsureThread={ensureThread}
          modalities={modalities.length > 0 ? modalities : ["text"]}
          model={modelId}
          models={models}
          onModelChange={setModelId}
          onUserSend={(payload) => {
            setError(null);
            setRunning(true);
            setThinking("");
            setTools([]);
            setStreaming("");
            const content =
              payload.parts && payload.parts.length > 0
                ? payload.parts
                : [{ type: "text", text: payload.text }];
            setMessages((current) => [
              ...current,
              { id: `local-${Date.now()}`, role: "user", content },
            ]);
          }}
          onStarted={() => setRunning(true)}
          onDelta={(text) => setStreaming((current) => current + text)}
          onThinking={(text) => setThinking((current) => current + text)}
          onTool={(event) => {
            setTools((current) => {
              if (event.phase === "started") {
                return [...current, { key: event.toolKey, status: "started" }];
              }
              const next = [...current];
              let index = -1;
              for (let i = next.length - 1; i >= 0; i -= 1) {
                if (next[i]?.key === event.toolKey && next[i]?.status === "started") {
                  index = i;
                  break;
                }
              }
              const detail =
                event.output && typeof event.output === "object"
                  ? JSON.stringify(event.output)
                  : event.output != null
                    ? String(event.output)
                    : undefined;
              if (index >= 0) {
                next[index] = { key: event.toolKey, status: "completed", detail };
                return next;
              }
              return [...next, { key: event.toolKey, status: "completed", detail }];
            });
          }}
          onFailed={(message) => setError(message)}
          onComplete={async () => {
            notifyThreadsChanged();
            const liveImages = toolsRef.current
              .map((tool) => (tool.detail ? extractLiveToolImageUrl(tool.detail) : null))
              .filter((url): url is string => Boolean(url));
            setStreaming("");
            setThinking("");
            setRunning(false);
            if (threadIdRef.current) {
              await refreshMessages(threadIdRef.current);
            }
            setTools([]);
            if (liveImages.length > 0) {
              setMessages((current) => {
                const hasImage = current.some(
                  (message) =>
                    message.role === "assistant" &&
                    Array.isArray(message.content) &&
                    message.content.some((part) => partImageUrl(part)),
                );
                if (hasImage) {
                  return current;
                }
                return [
                  ...current,
                  {
                    id: `local-image-${Date.now()}`,
                    role: "assistant",
                    content: liveImages.map((url) => ({ type: "image_url", image_url: { url } })),
                  },
                ];
              });
            }
          }}
        />
      ) : error ? null : (
        <p className="mt-6 text-sm text-ink/50">Starting chat…</p>
      )}
    </main>
  );
}

function partImageUrl(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const record = part as { type?: unknown; image_url?: { url?: unknown } };
  if (record.type !== "image_url") return null;
  const url = record.image_url?.url;
  return typeof url === "string" && isRenderableImageUrl(url) ? url : null;
}

function partVideoUrl(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const record = part as { type?: unknown; video_url?: { url?: unknown } };
  if (record.type !== "video_url") return null;
  const url = record.video_url?.url;
  return typeof url === "string" && isRenderableVideoUrl(url) ? url : null;
}

function messageHasDisplayableContent(content: unknown): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0;
  }
  if (!Array.isArray(content)) {
    return content != null;
  }
  return content.some((part) => {
    if (part && typeof part === "object" && "text" in part) {
      return String((part as { text: string }).text).trim().length > 0;
    }
    return partImageUrl(part) != null || partVideoUrl(part) != null;
  });
}

function extractLiveToolImageUrl(detail: string): string | null {
  try {
    const parsed = JSON.parse(detail) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const image = (parsed as { image?: unknown }).image;
    return typeof image === "string" && isRenderableImageUrl(image) ? image : null;
  } catch {
    return null;
  }
}

function MessageContent({ content }: { content: unknown }) {
  if (typeof content === "string") {
    return <p className="whitespace-pre-wrap text-sm">{content}</p>;
  }
  if (!Array.isArray(content)) {
    return <p className="whitespace-pre-wrap text-sm">{JSON.stringify(content)}</p>;
  }

  return (
    <div className="space-y-2">
      {content.map((part, index) => {
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
        if (part && typeof part === "object" && "text" in part) {
          const text = String((part as { text: string }).text);
          if (!text.trim()) return null;
          return (
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
