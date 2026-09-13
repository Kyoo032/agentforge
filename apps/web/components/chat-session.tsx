"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/lib/nav";
import { useRouter } from "@/lib/nav";
import { ChatComposer } from "@/components/chat-composer";
import { ChatContextChip } from "@/components/chat-context-chip";
import { ChatUsageChip } from "@/components/chat-usage-chip";
import { estimateContextParts, estimateConversationTokens, textFromMessageContent } from "@/lib/estimate-tokens";
import type { ContextPart } from "@/components/chat-context-chip";
import { ChatTurn, messageHasDisplayableContent, type LiveTool } from "@/components/chat-turn";
import { collectToolMediaParts } from "@/lib/tool-media";
import { notifyThreadsChanged } from "@/lib/threads-events";
import { apiFetch } from "@/lib/api-client";
import {
  pickChatModel,
  readLastChatModel,
  readThreadChatModel,
  writeLastChatModel,
  writeThreadChatModel,
} from "@/lib/chat-model-pref";
import { BrandMark } from "@/components/brand-mark";
import { RailIcon } from "@/components/app-rail";
import { useProductBrand } from "@/lib/product-brand";
import { isReasoningEffort, type ReasoningEffort } from "@agentforge/core/reasoning-effort";

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
  const { gatewayName } = useProductBrand();
  const [agentName, setAgentName] = useState("Chat");
  const [isDefaultChat, setIsDefaultChat] = useState(!agentId);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [agentIdReady, setAgentIdReady] = useState<string | null>(agentId ?? null);
  const [agentModalities, setAgentModalities] = useState<string[]>(["text"]);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [catalogDefault, setCatalogDefault] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState("");
  const [thinking, setThinking] = useState("");
  const [tools, setTools] = useState<LiveTool[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("medium");
  const [knowledgeParts, setKnowledgeParts] = useState<ContextPart[]>([]);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  useEffect(() => {
    try {
      const storedEffort = window.localStorage.getItem("agentforge-chat-reasoning-effort");
      if (isReasoningEffort(storedEffort) && storedEffort !== "minimal") {
        setReasoningEffort(storedEffort);
        setThinkingEnabled(storedEffort !== "none");
      } else {
        const stored = window.localStorage.getItem("agentforge-chat-thinking");
        if (stored === "off") {
          setThinkingEnabled(false);
          setReasoningEffort("none");
        }
      }
    } catch {
      // private mode
    }
  }, []);

  function setReasoningPref(next: ReasoningEffort) {
    setReasoningEffort(next);
    setThinkingEnabled(next !== "none");
    try {
      window.localStorage.setItem("agentforge-chat-reasoning-effort", next);
      window.localStorage.setItem("agentforge-chat-thinking", next === "none" ? "off" : "on");
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

  function rememberModel(id: string, forThreadId?: string | null) {
    const next = id.trim();
    if (!next) {
      return;
    }
    writeLastChatModel(next);
    const thread = forThreadId ?? threadIdRef.current;
    if (thread) {
      writeThreadChatModel(thread, next);
    }
  }

  function handleModelChange(id: string) {
    setModelId(id);
    rememberModel(id);
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
    const created = await apiFetch("/api/v1/threads", {
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
    rememberModel(modelId, id);
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
            apiFetch(`/api/v1/agents/${agentId}`).then((res) => res.json()),
            apiFetch(`/api/v1/agents/${agentId}/capabilities`).then((res) => res.json()),
            apiFetch("/api/v1/models").then((res) => res.json()),
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
          setCatalogDefault(
            agentPayload.agent?.slug === "quick-chat"
              ? (modelPayload.defaultModel ?? caps.model ?? "")
              : (caps.model ?? modelPayload.defaultModel ?? ""),
          );
          readyId = agentId;
          setAgentIdReady(agentId);
        } else {
          const home = await apiFetch("/api/v1/chat").then((res) => res.json());
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
          setCatalogDefault(home.defaultModel ?? home.version?.model ?? "");
          readyId = home.agent.id;
          setAgentIdReady(home.agent.id);
        }

        if (initialThreadId) {
          if (initialThreadId === threadIdRef.current) {
            return;
          }
          const payload = await apiFetch(`/api/v1/threads/${initialThreadId}`).then((res) => res.json());
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

  useEffect(() => {
    if (models.length === 0) {
      return;
    }
    const threadKey = initialThreadId ?? threadId ?? "";
    setModelId((current) =>
      pickChatModel({
        models,
        current,
        threadModel: threadKey ? readThreadChatModel(threadKey) : "",
        lastModel: readLastChatModel(),
        catalogDefault,
      }),
    );
  }, [models, catalogDefault, initialThreadId, threadId]);

  async function refreshMessages(id: string) {
    const payload = await apiFetch(`/api/v1/threads/${id}`).then((res) => res.json());
    setMessages(payload.messages ?? []);
  }

  const empty = messages.length === 0 && !streaming && !thinking && !running && tools.length === 0;
  const conversationTokens = estimateConversationTokens(messages, [thinking, streaming]);
  const knowledgeTokens = knowledgeParts.reduce((sum, part) => sum + part.tokens, 0);
  const contextTokens = conversationTokens + knowledgeTokens;
  const contextParts = estimateContextParts({ conversation: conversationTokens, knowledge: knowledgeParts });

  useEffect(() => {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const query = lastUser ? textFromMessageContent(lastUser.content) : "";
    const params = new URLSearchParams();
    if (query) {
      params.set("query", query.slice(0, 400));
    }
    if (threadIdRef.current) {
      // Same anti-loop rule as the host run: the thread's own card is not "Sources" for itself.
      params.set("threadId", threadIdRef.current);
    }
    const search = params.toString();
    const href = search ? `/api/v1/knowledge/context?${search}` : "/api/v1/knowledge/context";
    void apiFetch(href)
      .then((res) => res.json())
      .then((payload) => {
        const parts = Array.isArray(payload.parts) ? payload.parts : [];
        setKnowledgeParts(
          parts.filter((part: unknown): part is ContextPart => {
            return Boolean(part && typeof part === "object" && typeof (part as ContextPart).label === "string");
          }),
        );
      })
      .catch(() => {
        setKnowledgeParts([]);
      });
  }, [messages]);

  return (
    <main className="flex h-full min-h-0 flex-col bg-[var(--bg)]" data-testid="chat-home">
      <div
        className="flex h-14 shrink-0 items-center justify-between gap-4 px-6"
        data-testid="chat-header"
      >
        <h1 className="stage-title">{isDefaultChat ? "Chat" : agentName}</h1>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
          <ChatContextChip usedTokens={contextTokens} contextLength={selectedModel?.contextLength} parts={contextParts} />
          <ChatUsageChip />
          {agentIdReady ? (
            <button
              type="button"
              className="btn btn-ghost px-3 py-1.5 text-[12px]"
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

      {error ? (
        <p className="px-6 text-[14px] text-[var(--danger)]" data-testid="chat-error" role="alert">
          {error}
        </p>
      ) : null}

      <div
        className={`min-h-0 flex-1 overflow-y-auto px-6 ${empty ? "flex flex-col justify-center" : "space-y-4 py-4"}`}
        data-testid="message-list"
      >
        {empty && !error ? (
          <div className="mx-auto w-full max-w-[520px] text-center" data-testid="chat-empty">
            <BrandMark size={28} className="mx-auto text-[var(--accent)]" />
            <p className="mt-4 text-[24px] font-bold tracking-[-0.015em] text-[var(--text)]">
              You&apos;re in. Ask anything.
            </p>
            <p className="mt-2 text-[14px] leading-[1.45] text-[var(--text-2)]">
              Paste a {gatewayName} gateway key in{" "}
              <Link href="/settings" className="text-[var(--accent)] no-underline hover:underline">
                Settings
              </Link>{" "}
              to talk to live models.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {(
                [
                  { href: "/documents", icon: "documents" as const, title: "Documents", hint: "Memos and reports" },
                  { href: "/research", icon: "research" as const, title: "Research", hint: "Dossiers from the web" },
                  { href: "/finance", icon: "finance" as const, title: "Finance", hint: "Models and briefs" },
                ] as const
              ).map((card) => (
                <Link
                  key={card.href}
                  href={card.href}
                  className="quiet-card px-3 py-3 text-left transition-colors duration-[120ms] hover:bg-[var(--accent-soft)]"
                >
                  <span className="text-[var(--text-3)]">
                    <RailIcon name={card.icon} size={20} />
                  </span>
                  <p className="mt-2 text-[14px] font-medium tracking-[-0.015em] text-[var(--text)]">{card.title}</p>
                  <p className="mt-1 text-[12px] text-[var(--text-3)]">{card.hint}</p>
                </Link>
              ))}
            </div>
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
              live={{ thinking, tools, streaming, running, thinkingEnabled }}
            />
          </div>
        ) : null}
      </div>
      {agentIdReady ? (
        <div className="shrink-0 px-6">
        <ChatComposer
          threadId={threadId}
          onEnsureThread={ensureThread}
          modalities={modalities.length > 0 ? modalities : ["text"]}
          model={modelId}
          models={models}
          onModelChange={handleModelChange}
          thinkingEnabled={thinkingEnabled}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningPref}
          onUserSend={(payload) => {
            setError(null);
            setRunning(true);
            rememberModel(modelId);
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
          onFailed={(message) => {
            setError(message);
            setRunning(false);
          }}
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
        </div>
      ) : error ? null : (
        <p className="px-6 pb-6 text-[14px] text-[var(--text-3)]">Starting chat…</p>
      )}
    </main>
  );
}
