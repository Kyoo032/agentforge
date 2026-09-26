"use client";

import { useState } from "react";
import { Link, usePathname, useRouter, useSearchParams } from "@/lib/nav";
import { t } from "@/lib/i18n";
import { RAIL_RECENT_THREADS, takeRecentThreads } from "@/lib/thread-groups";
import { useChatThreads, type ChatThread } from "@/lib/use-chat-threads";

const CHAT_PATH = "/chat";

/** Indent and type scale line up with `RailItem` so JOB MODES still reads as the next group. */
const ROW_BASE = "flex h-7 min-w-0 flex-1 items-center rounded-md px-2 text-xs tracking-[var(--track)]";
const MUTED_ROW = `wash ${ROW_BASE} text-[var(--rail-text-3)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-active-text)]`;

function rowClass(active: boolean) {
  return active
    ? `select-row ${ROW_BASE} shadow-elev-1 text-[var(--rail-active-text)] [background-image:var(--grad-soft)]`
    : `wash ${ROW_BASE} text-[var(--rail-text-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-active-text)]`;
}

/**
 * The Chat sessions, parked under the Chat rail entry (owner decision 2026-09-17). This is the
 * only session list in the product: the second column is gone, so the toggle expands in place
 * from the few most recent to everything the host returned (it caps the list at 40).
 */
export function RailRecentThreads({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { threads, error, deletingId, removeThread } = useChatThreads({ scope: "chat" });
  const [expanded, setExpanded] = useState(false);

  const onChat = pathname === CHAT_PATH;
  const openThread = searchParams.get("thread");
  const activeThread = onChat ? openThread : null;
  const shown = expanded ? threads : takeRecentThreads(threads, RAIL_RECENT_THREADS);

  if (collapsed) {
    return (
      <Link
        href={CHAT_PATH}
        className="wash flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--rail-text-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-active-text)]"
        data-testid="new-chat-link"
        aria-label={t("rail.newChat")}
        title={t("rail.newChat")}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>
    );
  }

  async function onDelete(thread: ChatThread) {
    const removed = await removeThread(thread);
    // The pane keeps a deleted thread alive in its own ref, so leave it whatever route we are on.
    if (removed && openThread === thread.id) {
      router.push(CHAT_PATH);
    }
  }

  return (
    <div className="mt-0.5" role="group" aria-label={t("rail.recentSessionsAria")} data-testid="rail-thread-list">
      <Link
        href={CHAT_PATH}
        className={`wash ${ROW_BASE} font-medium text-[var(--rail-text-2)] hover:bg-[var(--rail-hover)] hover:text-[var(--rail-active-text)]`}
        data-testid="new-chat-link"
      >
        <span className="truncate">{t("rail.newChat")}</span>
      </Link>

      {error ? (
        <p className="px-2 py-1 text-xs text-[var(--text-3)]" data-testid="rail-thread-error">
          {error}
        </p>
      ) : null}

      {shown.map((thread) => {
        const active = activeThread === thread.id;
        const deleting = deletingId === thread.id;
        return (
          <div key={thread.id} className="group flex items-center gap-0.5">
            <Link
              href={`${CHAT_PATH}?thread=${encodeURIComponent(thread.id)}`}
              className={rowClass(active)}
              data-testid="thread-item"
              aria-current={active ? "true" : undefined}
              title={thread.title}
            >
              <span className="truncate">{thread.title}</span>
            </Link>
            <button
              type="button"
              className={`wash shrink-0 rounded-md px-1 py-0.5 text-xs text-[var(--text-3)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-[var(--danger)] ${
                deleting ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              }`}
              onClick={() => void onDelete(thread)}
              disabled={deleting}
              aria-label={t("chat.deleteAria", { title: thread.title })}
              title={t("chat.deleteSession")}
              data-testid="thread-delete"
            >
              ×
            </button>
          </div>
        );
      })}

      {threads.length > RAIL_RECENT_THREADS ? (
        <button
          type="button"
          className={MUTED_ROW}
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          data-testid="threads-see-all"
        >
          <span className="truncate">{expanded ? t("rail.showFewerSessions") : t("rail.seeAllSessions")}</span>
        </button>
      ) : null}
    </div>
  );
}
