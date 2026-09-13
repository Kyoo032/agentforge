"use client";

import { Suspense, useEffect, useState } from "react";
import { Link } from "@/lib/nav";
import { useRouter, useSearchParams } from "@/lib/nav";
import { groupThreadsByDay } from "@/lib/thread-groups";
import { THREADS_CHANGED_EVENT } from "@/lib/threads-events";
import { apiFetch } from "@/lib/api-client";

type RailThread = {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  createdAt: string;
  isDefaultChat: boolean;
  preview?: string | null;
};

type Props = {
  /** Base path for new chat / thread links, e.g. `/chat` or `/agents/<id>`. */
  basePath: string;
  /** API scope: `chat` for default-chat sessions, `agent` for a specialist. */
  scope: "chat" | "agent";
  /** Required when scope is `agent`. */
  agentId?: string;
};

function itemClass(active: boolean) {
  return active
    ? "flex h-11 min-w-0 flex-1 flex-col justify-center rounded-lg bg-[var(--accent-soft)] px-2 text-sm tracking-[var(--track)] text-[var(--text)]"
    : "flex h-11 min-w-0 flex-1 flex-col justify-center rounded-lg px-2 text-sm tracking-[var(--track)] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]";
}

function ChatThreadListInner({ basePath, scope, agentId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeThread = searchParams.get("thread");
  const [threads, setThreads] = useState<RailThread[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const params = new URLSearchParams({ scope });
      if (scope === "agent" && agentId) {
        params.set("agentId", agentId);
      }
      const payload = await apiFetch(`/api/v1/threads?${params}`).then((res) => res.json());
      if (cancelled) {
        return;
      }
      setThreads(Array.isArray(payload.threads) ? payload.threads : []);
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
  }, [scope, agentId, activeThread]);

  async function removeThread(thread: RailThread) {
    if (deletingId) {
      return;
    }
    const confirmed = window.confirm(`Delete "${thread.title}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    setDeletingId(thread.id);
    try {
      const response = await apiFetch(`/api/v1/threads/${thread.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Could not delete session");
      }
      if (activeThread === thread.id) {
        router.push(basePath);
      }
      setThreads((current) => current.filter((item) => item.id !== thread.id));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not delete session");
    } finally {
      setDeletingId(null);
    }
  }

  const groups = groupThreadsByDay(threads);

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--line)] bg-[var(--surface)]"
      style={{ width: "var(--thread)" }}
      aria-label="Sessions"
    >
      <div className="px-3 py-3">
        <Link
          href={basePath}
          className="flex h-8 w-full items-center justify-center rounded-pill border border-[var(--line)] text-sm font-medium text-[var(--text)] hover:bg-[var(--accent-soft)]"
          data-testid="new-chat-link"
        >
          + New chat
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="thread-list">
        {groups.length === 0 ? (
          <p className="px-1 text-xs text-[var(--text-3)]">Sessions show up here after you send.</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-1 text-xs font-medium uppercase tracking-[0.06em] text-[var(--text-3)]">{group.label}</p>
              <div className="mt-1">
                {group.threads.map((thread) => {
                  const href = `${basePath}?thread=${thread.id}`;
                  const active = activeThread === thread.id;
                  const deleting = deletingId === thread.id;
                  const preview = thread.preview?.trim();
                  return (
                    <div key={thread.id} className="group flex h-11 items-center gap-0.5">
                      <Link
                        href={href}
                        className={itemClass(active)}
                        data-testid="thread-item"
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="block truncate">{thread.title}</span>
                        {preview ? (
                          <span className="block truncate text-xs text-[var(--text-3)]">{preview}</span>
                        ) : null}
                      </Link>
                      <button
                        type="button"
                        className={`shrink-0 rounded-lg px-1.5 py-1 text-sm text-[var(--text-3)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-[var(--danger)] ${
                          deleting ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                        }`}
                        onClick={() => void removeThread(thread)}
                        disabled={deleting}
                        aria-label={`Delete ${thread.title}`}
                        title="Delete session"
                        data-testid="thread-delete"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

export function ChatThreadList(props: Props) {
  return (
    <Suspense
      fallback={
        <aside
          className="shrink-0 border-r border-[var(--line)] bg-[var(--surface)]"
          style={{ width: "var(--thread)" }}
          aria-hidden
        />
      }
    >
      <ChatThreadListInner {...props} />
    </Suspense>
  );
}
