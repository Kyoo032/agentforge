"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { groupThreadsByDay } from "@/lib/thread-groups";
import { THREADS_CHANGED_EVENT } from "@/lib/threads-events";

export type RailAgent = {
  id: string;
  name: string;
};

type RailThread = {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  createdAt: string;
  isDefaultChat: boolean;
};

type Props = {
  workspaceName: string;
  agents: RailAgent[];
};

function itemClass(active: boolean) {
  return active
    ? "block rounded-md bg-navy px-3 py-2 text-sm text-white"
    : "block rounded-md px-3 py-2 text-sm text-ink hover:bg-mist";
}

function threadHref(thread: RailThread) {
  return thread.isDefaultChat ? `/chat?thread=${thread.id}` : `/chat/${thread.agentId}?thread=${thread.id}`;
}

function AppRailInner({ workspaceName, agents }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeThread = searchParams.get("thread");
  const onBuild = pathname.startsWith("/studio");
  const onSettings = pathname.startsWith("/settings");
  const onWorkspaces = pathname.startsWith("/workspaces");
  const [threads, setThreads] = useState<RailThread[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const payload = await fetch("/api/v1/threads").then((res) => res.json());
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
  }, [pathname, activeThread]);

  const groups = groupThreadsByDay(threads);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col rounded-xl border border-mist/80 bg-paper">
      <div className="border-b border-mist px-3 py-4">
        <Link href="/chat" className="block font-semibold tracking-tight text-ink">
          Agentforge
        </Link>
        <p className="mt-1 truncate text-xs text-ink/50">{workspaceName}</p>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="App">
        <div className="space-y-1">
          <Link
            href="/chat"
            className="block rounded-md border border-mist px-3 py-2 text-sm font-medium text-ink hover:bg-mist"
            data-testid="new-chat-link"
          >
            + New chat
          </Link>
        </div>

        <div data-testid="thread-list">
          {groups.length === 0 ? (
            <p className="px-3 text-xs text-ink/50">Sessions show up here after you send.</p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mb-4">
                <p className="px-3 text-xs font-medium uppercase tracking-wide text-ink/50">{group.label}</p>
                <div className="mt-1 space-y-1">
                  {group.threads.map((thread) => {
                    const href = threadHref(thread);
                    const active = activeThread === thread.id;
                    return (
                      <Link
                        key={thread.id}
                        href={href}
                        className={itemClass(active)}
                        data-testid="thread-item"
                        aria-current={active ? "page" : undefined}
                      >
                        <span className="block truncate">{thread.title}</span>
                        {!thread.isDefaultChat ? (
                          <span className={`block truncate text-xs ${active ? "text-white/80" : "text-ink/50"}`}>
                            {thread.agentName}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div>
          <p className="px-3 text-xs font-medium uppercase tracking-wide text-ink/50">Desks</p>
          <div className="mt-1 space-y-1">
            {agents.length === 0 ? (
              <p className="px-3 py-2 text-xs text-ink/50">None yet. Build one when you want a specialist.</p>
            ) : (
              agents.map((agent) => {
                const href = `/chat/${agent.id}`;
                const active = pathname === href && !activeThread;
                return (
                  <Link
                    key={agent.id}
                    href={href}
                    className={itemClass(active)}
                    aria-current={active ? "page" : undefined}
                  >
                    {agent.name}
                  </Link>
                );
              })
            )}
            <Link
              href="/studio/new"
              className={itemClass(onBuild)}
              data-testid="new-agent-link"
              aria-current={onBuild ? "page" : undefined}
            >
              Build
            </Link>
          </div>
        </div>
      </nav>

      <div className="space-y-1 border-t border-mist px-3 py-4">
        <Link
          href="/settings"
          className={itemClass(onSettings)}
          data-testid="settings-link"
          aria-current={onSettings ? "page" : undefined}
        >
          Settings
        </Link>
        <Link
          href="/workspaces"
          className={itemClass(onWorkspaces)}
          aria-current={onWorkspaces ? "page" : undefined}
        >
          Workspaces
        </Link>
        <ThemeToggle />
      </div>
    </aside>
  );
}

export function AppRail(props: Props) {
  return (
    <Suspense fallback={<aside className="w-64 shrink-0 rounded-xl border border-mist/80 bg-paper" />}>
      <AppRailInner {...props} />
    </Suspense>
  );
}
