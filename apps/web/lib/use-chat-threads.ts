"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspaceScope } from "./workspace-scope";
import { apiFetch } from "./api-client";
import { t } from "./i18n";
import { THREADS_CHANGED_EVENT, notifyThreadsChanged } from "./threads-events";

export type ChatThreadScope = "chat" | "agent";

export type ChatThread = {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  createdAt: string;
  isDefaultChat: boolean;
  preview?: string | null;
};

/**
 * `GET /api/v1/threads` path for one scope. `agentId` only rides along on the agent scope —
 * the host ignores it for `chat` and would widen the list if we sent it anyway.
 */
export function threadsPath(scope: ChatThreadScope, agentId?: string): string {
  const params = new URLSearchParams({ scope });
  if (scope === "agent" && agentId) {
    params.set("agentId", agentId);
  }
  return `/api/v1/threads?${params}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  return fallback;
}

/** Keeps only rows that carry the fields the UI reads; a malformed row is dropped, not rendered blank. */
function toThread(value: unknown): ChatThread | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, title, agentId, agentName, createdAt, isDefaultChat, preview } = value;
  if (typeof id !== "string" || typeof title !== "string" || typeof createdAt !== "string") {
    return null;
  }
  return {
    id,
    title,
    agentId: typeof agentId === "string" ? agentId : "",
    agentName: typeof agentName === "string" ? agentName : "",
    createdAt,
    isDefaultChat: isDefaultChat === true,
    preview: typeof preview === "string" ? preview : null,
  };
}

/**
 * Newest-first list for a scope. The host already orders by `createdAt` desc (capped at 40),
 * so callers may slice the head without re-sorting. Throws with a readable message on failure.
 */
export async function fetchChatThreads(scope: ChatThreadScope, agentId?: string): Promise<ChatThread[]> {
  const response = await apiFetch(threadsPath(scope, agentId));
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessage(payload, t("chat.error.loadSessions")));
  }
  const rows = isRecord(payload) && Array.isArray(payload.threads) ? payload.threads : [];
  return rows.map(toThread).filter((thread): thread is ChatThread => thread !== null);
}

/** `DELETE /api/v1/threads/:id`. Throws with the host message when the row survives. */
export async function deleteChatThread(threadId: string): Promise<void> {
  const response = await apiFetch(`/api/v1/threads/${encodeURIComponent(threadId)}`, { method: "DELETE" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessage(payload, t("chat.error.deleteSession")));
  }
}

export type ChatThreadsState = {
  /** Newest first, as the host returned them. Never mutated in place. */
  threads: ChatThread[];
  /** Last load or delete failure, already localized. `null` once a later call succeeds. */
  error: string | null;
  /** Id currently being deleted, for the busy affordance. */
  deletingId: string | null;
  /** Confirms, deletes, drops the row. Resolves `true` when the thread is gone. */
  removeThread: (thread: ChatThread) => Promise<boolean>;
};

/**
 * One source of truth for the Chat session list, read by the rail block. The workspace id is a
 * dependency because threads are per desk: switching desks re-renders the shell without
 * remounting the rail, and a stale list would show the previous desk's titles.
 */
export function useChatThreads({ scope, agentId }: { scope: ChatThreadScope; agentId?: string }): ChatThreadsState {
  const { id: workspaceId } = useWorkspaceScope();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const rows = await fetchChatThreads(scope, agentId);
        if (cancelled) {
          return;
        }
        setThreads(rows);
        setError(null);
      } catch (failure) {
        if (cancelled) {
          return;
        }
        // A transient failure keeps the last good list on screen; only the error line is new.
        setError(failure instanceof Error ? failure.message : t("chat.error.loadSessions"));
      }
    }
    void load();
    const onChange = () => {
      void load();
    };
    window.addEventListener(THREADS_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(THREADS_CHANGED_EVENT, onChange);
    };
  }, [scope, agentId, workspaceId]);

  const removeThread = useCallback(
    async (thread: ChatThread) => {
      if (deletingId) {
        return false;
      }
      if (!window.confirm(t("chat.deleteConfirm", { title: thread.title }))) {
        return false;
      }
      setDeletingId(thread.id);
      try {
        await deleteChatThread(thread.id);
        setThreads((current) => current.filter((item) => item.id !== thread.id));
        setError(null);
        notifyThreadsChanged();
        return true;
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : t("chat.error.deleteSession");
        setError(message);
        window.alert(message);
        return false;
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId],
  );

  return { threads, error, deletingId, removeThread };
}
