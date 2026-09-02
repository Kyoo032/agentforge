"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChatComposer } from "@/components/chat-composer";
import { ChatUsageChip } from "@/components/chat-usage-chip";
import { ChatTurn, messageHasDisplayableContent, type LiveTool } from "@/components/chat-turn";
import { collectToolMediaParts } from "@/lib/tool-media";
import { notifyThreadsChanged } from "@/lib/threads-events";
import { GATEWAY_NAME } from "@agentforge/core/gateway";

type Message = { id: string; role: string; content: unknown };

type ModelProvider = "openai" | "anthropic" | "google" | "volcengine";

type ChatModel = {
  id: string;
  label: string;
  provider?: ModelProvider;
  inputModalities: string[];
  contextLength?: number;
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState("");
  const [thinking, setThinking] = useState("");
  const [tools, setTools] = useState<LiveTool[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("agentforge-chat-thinking");
      if (stored === "off") {
        setThinkingEnabled(false);
      }
    } catch {
      // private mode
    }
  }, []);

  function setThinkingPref(next: boolean) {
    setThinkingEnabled(next);
    try {
      window.localStorage.setItem("agentforge-chat-thinking", next ? "on" : "off");
    } catch {
      // private mode
    }
  }

  const selectedModel = models.find((model) => model.id === modelId);
  const modalities = useMemo(() => {
    const modelMods = selectedModel?.inputModalities ?? ["text"];
    return ["text", "image", "video"].filter(
      (modality) => agentModalities.includes(modality) && modelMods.includes(modality),
    );
  }, [agentModalities, selectedModel]);

  function chatPath() {
    return agentId ? `/agents/${agentId}` : "/chat";
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
    const next = `${chatPath()}?thread=${id}`;
    window.history.replaceState(window.history.state, "", next);
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
            router.replace(`/agents/${threadAgentId}?thread=${initialThreadId}`);
            return;
          }
          threadIdRef.current = payload.thread.id;
          setThreadId(payload.thread.id);
          setMessages(payload.messages ?? []);
          resetLive();
          return;
        }

        if (threadIdRef.current) {
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
          <ChatUsageChip />
          {agentIdReady ? (
            <button
              type="button"
              className="rounded-md border border-mist px-3 py-2 text-sm"
              data-testid="new-chat"
              onClick={() => {
                threadIdRef.current = null;
                setThreadId(null);
                setMessages([]);
                resetLive();
                setError(null);
                router.push(chatPath());
              }}
            >
              New chat
            </button>
          ) : null}
        </div>
      </div>

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
            <ChatTurn key={message.id} role={message.role} content={message.content} />
          ))}
        {running || thinking || tools.length > 0 || streaming ? (
          <div data-testid="assistant-live">
            <ChatTurn
              role="assistant"
              live={{ thinking, tools, streaming, running }}
            />
          </div>
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
          thinkingEnabled={thinkingEnabled}
          onThinkingChange={setThinkingPref}
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
                return [...current, { key: event.toolKey, status: "started", input: event.input }];
              }
              const next = [...current];
              let index = -1;
              for (let i = next.length - 1; i >= 0; i -= 1) {
                if (next[i]?.key === event.toolKey && next[i]?.status === "started") {
                  index = i;
                  break;
                }
              }
              const completed = {
                key: event.toolKey,
                status: "completed" as const,
                input: index >= 0 ? next[index]?.input : event.input,
                output: event.output,
              };
              if (index >= 0) {
                next[index] = completed;
                return next;
              }
              return [...next, completed];
            });
          }}
          onFailed={(message) => setError(message)}
          onComplete={async () => {
            notifyThreadsChanged();
            const liveMedia = toolsRef.current.flatMap((tool) => collectToolMediaParts(tool.output));
            setStreaming("");
            setThinking("");
            setRunning(false);
            if (threadIdRef.current) {
              await refreshMessages(threadIdRef.current);
            }
            setTools([]);
            if (liveMedia.length > 0) {
              setMessages((current) => {
                const hasMedia = current.some(
                  (message) =>
                    message.role === "assistant" &&
                    Array.isArray(message.content) &&
                    message.content.some(
                      (part) =>
                        part &&
                        typeof part === "object" &&
                        ((part as { type?: unknown }).type === "image_url" ||
                          (part as { type?: unknown }).type === "video_url"),
                    ),
                );
                if (hasMedia) {
                  return current;
                }
                return [
                  ...current,
                  {
                    id: `local-media-${Date.now()}`,
                    role: "assistant",
                    content: liveMedia,
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
