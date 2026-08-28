"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { groupThreadsByDay } from "@/lib/thread-groups";
import { THREADS_CHANGED_EVENT } from "@/lib/threads-events";

type RailThread = {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  createdAt: string;
  isDefaultChat: boolean;
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
    ? "block rounded-md bg-navy px-2.5 py-1.5 text-sm text-white"
    : "block rounded-md px-2.5 py-1.5 text-sm text-ink hover:bg-mist";
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
      const payload = await fetch(`/api/v1/threads?${params}`).then((res) => res.json());
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
      const response = await fetch(`/api/v1/threads/${thread.id}`, { method: "DELETE" });
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
      className="flex h-full w-52 shrink-0 flex-col border-r border-mist bg-paper"
      aria-label="Sessions"
    >
      <div className="border-b border-mist px-2 py-3">
        <Link
          href={basePath}
          className="block rounded-md border border-mist px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-mist"
          data-testid="new-chat-link"
        >
          + New chat
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3" data-testid="thread-list">
        {groups.length === 0 ? (
          <p className="px-1 text-xs text-ink/50">Sessions show up here after you send.</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-ink/50">{group.label}</p>
              <div className="mt-1 space-y-0.5">
                {group.threads.map((thread) => {
                  const href = `${basePath}?thread=${thread.id}`;
                  const active = activeThread === thread.id;
                  const deleting = deletingId === thread.id;
                  return (
                    <div key={thread.id} className="group flex items-center gap-0.5">
                      <Link
                        href={href}
                        className={`${itemClass(active)} min-w-0 flex-1`}
                        data-testid="thread-item"
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="block truncate">{thread.title}</span>
                      </Link>
                      <button
                        type="button"
                        className={`shrink-0 rounded-md px-1.5 py-1 text-sm text-ink/40 hover:bg-red-50 hover:text-red-700 ${
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
    <Suspense fallback={<aside className="w-52 shrink-0 border-r border-mist bg-paper" aria-hidden />}>
      <ChatThreadListInner {...props} />
    </Suspense>
  );
}
