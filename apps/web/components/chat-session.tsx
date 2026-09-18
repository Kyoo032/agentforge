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
import { useProductBrand } from "@/lib/product-brand";
import { isReasoningEffort, type ReasoningEffort } from "@agentforge/core/reasoning-effort";
import { t } from "@/lib/i18n";

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

function EmptyCardIcon({ name }: { name: "documents" | "research" | "finance" }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "documents" ? (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8M16 17H8" />
        </>
      ) : null}
      {name === "research" ? (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </>
      ) : null}
      {name === "finance" ? (
        <>
          <path d="m3 17 6-6 4 4 8-8" />
          <path d="M17 7h4v4" />
          <path d="M3 21h18" />
        </>
      ) : null}
    </svg>
  );
}

export function ChatSession({ agentId, initialThreadId }: Props) {
  const router = useRouter();
  const { gatewayName } = useProductBrand();
  const [agentName, setAgentName] = useState(() => t("chat.title"));
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
  /** Last `initialThreadId` this pane saw, so leaving a thread (rail "+ New chat") empties it. */
  const lastInitialThreadRef = useRef(initialThreadId);
  /**
   * `?thread=<id>` is known synchronously, but `threadIdRef` only fills once
   * `GET /api/v1/threads/:id` resolves. A send inside that window has to land on the thread
   * the URL already names, otherwise `ensureThread` forks a fresh one (rail sessions make
   * this trivially reachable). Cleared whenever the pane is deliberately emptied or the
   * initial load fails, so "+ New chat" and a dead id still fall through to a real create.
   */
  const pendingThreadRef = useRef<string | null>(initialThreadId ?? null);
  const seenInitialThreadRef = useRef(initialThreadId);
  if (seenInitialThreadRef.current !== initialThreadId) {
    seenInitialThreadRef.current = initialThreadId;
    pendingThreadRef.current = initialThreadId ?? null;
  }

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
    // The loaded thread wins; the URL's thread is the fallback while its GET is still in flight.
    const openThread = threadIdRef.current ?? pendingThreadRef.current;
    if (openThread) {
      return openThread;
    }
    if (!agentIdReady) {
      throw new Error(t("chat.error.loading"));
    }
    const created = await apiFetch("/api/v1/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agentIdReady }),
    }).then((res) => res.json());
    if (created.error) {
      throw new Error(created.error.message ?? t("chat.error.start"));
    }
    const id = created.thread.id as string;
    threadIdRef.current = id;
    pendingThreadRef.current = id;
    seenInitialThreadRef.current = id;
    setThreadId(id);
    rememberModel(modelId, id);
    router.replace(`${chatPath()}?thread=${id}`);
    notifyThreadsChanged();
    return id;
  }

  useEffect(() => {
    // `?thread=<id>` -> `/chat` is the rail asking for a blank pane, not a re-render to ignore.
    const leftThread = lastInitialThreadRef.current !== undefined && initialThreadId === undefined;
    lastInitialThreadRef.current = initialThreadId;
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
            throw new Error(agentPayload.error.message ?? t("chat.error.agentMissing"));
          }
          if (cancelled) {
            return;
          }
          setAgentName(agentPayload.agent?.name ?? t("chat.agent"));
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
            throw new Error(home.error.message ?? t("chat.error.open"));
          }
          if (cancelled) {
            return;
          }
          setAgentName(home.agent?.name ?? t("chat.title"));
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
            throw new Error(payload.error.message ?? t("chat.error.threadMissing"));
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
          pendingThreadRef.current = payload.thread.id;
          setThreadId(payload.thread.id);
          setMessages(payload.messages ?? []);
          resetLive();
          return;
        }

        if (threadIdRef.current && !leftThread) {
          return;
        }

        threadIdRef.current = null;
        pendingThreadRef.current = null;
        setThreadId(null);
        setMessages([]);
        resetLive();
      } catch (err) {
        if (!cancelled) {
          // The URL's thread never loaded, so it is not a safe send target any more.
          pendingThreadRef.current = threadIdRef.current;
          setError(err instanceof Error ? err.message : t("chat.error.open"));
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
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 px-6" data-testid="chat-header">
        <h1 className={`${empty ? "text-sm" : "text-2xl"} font-medium tracking-[var(--track)] text-[var(--text)]`}>
          {isDefaultChat ? t("chat.title") : agentName}
        </h1>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3 text-xs">
          <ChatContextChip
            usedTokens={contextTokens}
            contextLength={selectedModel?.contextLength}
            parts={contextParts}
          />
          <ChatUsageChip />
          {agentIdReady ? (
            <button
              type="button"
              className="wash rounded-lg px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--accent-soft)]"
              data-testid="new-chat"
              onClick={() => {
                // Clear the URL fallback here too: `router.push` lands a render later.
                threadIdRef.current = null;
                pendingThreadRef.current = null;
                setThreadId(null);
                setMessages([]);
                resetLive();
                setError(null);
                router.push(chatPath());
              }}
            >
              {t("chat.newChat")}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="px-6 text-sm text-[var(--danger)]" data-testid="chat-error" role="alert">
          {error}
        </p>
      ) : null}

      <div
        key={threadId ?? "empty"}
        className={`stage-fade min-h-0 flex-1 overflow-y-auto px-6 ${empty ? "" : "space-y-4 py-4"}`}
        data-testid="message-list"
      >
        {empty && !error ? (
          <div className="mx-auto w-full max-w-[520px] pt-8 text-center" data-testid="chat-empty">
            <BrandMark size={28} className="mx-auto text-[var(--accent)]" />
            <p className="mt-4 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">
              {t("chat.empty.headline")}
            </p>
            <p className="mt-2 text-sm text-[var(--text-2)]">
              {t("chat.empty.pasteKeyPrefix", { gatewayName })}{" "}
              <Link href="/settings" className="text-[var(--accent)] no-underline hover:underline">
                {t("chat.empty.settingsLink")}
              </Link>{" "}
              {t("chat.empty.pasteKeySuffix")}
            </p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {(
                [
                  {
                    href: "/documents",
                    icon: "documents" as const,
                    title: t("chat.empty.documentsTitle"),
                    hint: t("chat.empty.documentsHint"),
                  },
                  {
                    href: "/research",
                    icon: "research" as const,
                    title: t("chat.empty.researchTitle"),
                    hint: t("chat.empty.researchHint"),
                  },
                  {
                    href: "/finance",
                    icon: "finance" as const,
                    title: t("chat.empty.financeTitle"),
                    hint: t("chat.empty.financeHint"),
                  },
                ] as const
              ).map((card) => (
                <Link
                  key={card.href}
                  href={card.href}
                  className="wash rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-3 text-left hover:bg-[var(--accent-soft)]"
                >
                  <span className="text-[var(--text-3)]">
                    <EmptyCardIcon name={card.icon} />
                  </span>
                  <p className="mt-2 text-sm font-medium tracking-[var(--track)] text-[var(--text)]">{card.title}</p>
                  <p className="mt-1 text-xs text-[var(--text-3)]">{card.hint}</p>
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
            <ChatTurn role="assistant" live={{ thinking, tools, streaming, running, thinkingEnabled }} />
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
              payload.parts && payload.parts.length > 0 ? payload.parts : [{ type: "text", text: payload.text }];
            setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", content }]);
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
      ) : error ? null : (
        <p className="mt-6 text-sm text-ink/50">{t("chat.starting")}</p>
      )}
    </main>
  );
}
