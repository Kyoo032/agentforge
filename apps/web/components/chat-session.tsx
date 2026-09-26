"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@/lib/nav";
import { ChatAccountChip } from "@/components/chat-account-chip";
import { ChatComposer } from "@/components/chat-composer";
import { ChatContextChip } from "@/components/chat-context-chip";
import { ChatLauncher } from "@/components/chat-launcher";
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
import { isReasoningEffort, type ReasoningEffort } from "@agentforge/core/reasoning-effort";
import { t } from "@/lib/i18n";

type Message = { id: string; role: string; content: unknown };

type ModelProvider = "openai" | "anthropic" | "google" | "volcengine";

type ChatModel = {
  id: string;
  label: string;
  friendlyLabel?: string;
  bestFor?: string;
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
  /** A prompt picked from the empty screen's suggestions; handed down once, then cleared. */
  const [composerDraft, setComposerDraft] = useState<string | null>(null);
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
  /**
   * Which session the pane is showing, bumped the moment the owner opens another — a rail row or
   * "+ New chat" — in the same render that sees the new `?thread`. The composer tags every run with
   * it: a run whose session is no longer on screen keeps streaming to the host, which saves the
   * reply, but draws nothing here. `ensureThread`'s own `router.replace` is not a switch; it moves
   * `seenInitialThreadRef` first.
   */
  const sessionEpochRef = useRef(0);
  const seenInitialThreadRef = useRef(initialThreadId);
  /**
   * `ensureThread` writes the new id into `seenInitialThreadRef` and then `setThreadId`, which
   * re-renders while `?thread` is still the old value. That render must not count as the owner
   * leaving — it used to bump the session, `onComplete` saw `showing: false`, and `running` stayed
   * true, so a second Thinking row never left the list.
   */
  const awaitingUrlThreadRef = useRef<string | null>(null);
  const urlAtEnsureRef = useRef<string | undefined>(initialThreadId);
  if (awaitingUrlThreadRef.current) {
    if (initialThreadId === awaitingUrlThreadRef.current) {
      awaitingUrlThreadRef.current = null;
      seenInitialThreadRef.current = initialThreadId;
    } else if (initialThreadId !== urlAtEnsureRef.current) {
      awaitingUrlThreadRef.current = null;
      seenInitialThreadRef.current = initialThreadId;
      pendingThreadRef.current = initialThreadId ?? null;
      sessionEpochRef.current += 1;
    }
  } else if (seenInitialThreadRef.current !== initialThreadId) {
    seenInitialThreadRef.current = initialThreadId;
    pendingThreadRef.current = initialThreadId ?? null;
    sessionEpochRef.current += 1;
  }
  const sessionKey = sessionEpochRef.current;

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
    const startedIn = sessionEpochRef.current;
    const created = await apiFetch("/api/v1/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agentIdReady }),
    }).then((res) => res.json());
    if (created.error) {
      throw new Error(created.error.message ?? t("chat.error.start"));
    }
    const id = created.thread.id as string;
    rememberModel(modelId, id);
    notifyThreadsChanged();
    if (sessionEpochRef.current !== startedIn) {
      // The owner opened another session while this thread was being created. Leave the pane
      // where they went instead of pulling it back with the `?thread=` below; the composer sees
      // the same switch and sends nothing into the thread.
      return id;
    }
    threadIdRef.current = id;
    pendingThreadRef.current = id;
    urlAtEnsureRef.current = initialThreadId;
    awaitingUrlThreadRef.current = id;
    seenInitialThreadRef.current = id;
    setThreadId(id);
    router.replace(`${chatPath()}?thread=${id}`);
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

  /** Reload a thread's messages — unless the pane has moved to another session while they loaded. */
  async function refreshMessages(id: string) {
    const key = sessionEpochRef.current;
    const payload = await apiFetch(`/api/v1/threads/${id}`).then((res) => res.json());
    if (sessionEpochRef.current === key && threadIdRef.current === id) {
      setMessages(payload.messages ?? []);
    }
  }

  const empty = messages.length === 0 && !streaming && !thinking && !running && tools.length === 0;
  const hasReply = messages.some((message) => message.role === "assistant");
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
    <main className="flex h-full min-h-0 flex-col" data-testid="chat-home">
      <div
        className="mx-auto flex h-14 w-full shrink-0 items-center justify-between gap-4 px-6 max-w-[var(--content-max)]"
        data-testid="chat-header"
      >
        <h1 className={`${empty ? "text-sm" : "text-2xl"} font-medium tracking-[var(--track)] text-[var(--text)]`}>
          {isDefaultChat ? t("chat.title") : agentName}
        </h1>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3 text-xs">
          {hasReply ? (
            <ChatContextChip
              usedTokens={contextTokens}
              contextLength={selectedModel?.contextLength}
              parts={contextParts}
            />
          ) : null}
          {hasReply ? <ChatUsageChip /> : null}
          <ChatAccountChip />
        </div>
      </div>

      {error ? (
        <p
          className="mx-auto w-full px-6 text-sm text-[var(--danger)] max-w-[var(--content-max)]"
          data-testid="chat-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div
        key={threadId ?? "empty"}
        className={`mx-auto min-h-0 w-full flex-1 overflow-y-auto px-6 max-w-[var(--content-max)] ${empty ? "" : "space-y-4 py-4"}`}
        data-testid="message-list"
      >
        {empty && !error ? <ChatLauncher onSuggest={setComposerDraft} /> : null}
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
          sessionKey={sessionKey}
          onEnsureThread={ensureThread}
          modalities={modalities.length > 0 ? modalities : ["text"]}
          model={modelId}
          models={models}
          onModelChange={handleModelChange}
          thinkingEnabled={thinkingEnabled}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={setReasoningPref}
          draft={composerDraft}
          onDraftApplied={() => setComposerDraft(null)}
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
          onComplete={async (run) => {
            notifyThreadsChanged();
            if (!run.showing) {
              // The owner opened another session while this run streamed, and the host saved the
              // reply. Show it only if the pane has come back to that thread since.
              if (run.threadId && run.threadId === threadIdRef.current) {
                await refreshMessages(run.threadId).catch(() => undefined);
              }
              return;
            }
            const key = sessionEpochRef.current;
            const liveMedia = toolsRef.current.flatMap((tool) => collectToolMediaParts(tool.output));
            setStreaming("");
            setThinking("");
            setRunning(false);
            if (threadIdRef.current) {
              await refreshMessages(threadIdRef.current);
            }
            if (sessionEpochRef.current !== key) {
              // The owner moved on while the messages reloaded; this run's media is not theirs now.
              return;
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
