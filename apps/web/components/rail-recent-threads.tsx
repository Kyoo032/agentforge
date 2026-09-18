"use client";

import { useState } from "react";
import { Link, usePathname, useRouter, useSearchParams } from "@/lib/nav";
import { t } from "@/lib/i18n";
import { RAIL_RECENT_THREADS, takeRecentThreads } from "@/lib/thread-groups";
import { useChatThreads, type ChatThread } from "@/lib/use-chat-threads";

const CHAT_PATH = "/chat";

/** Indent and type scale line up with `RailItem` so JOB MODES still reads as the next group. */
const ROW_BASE = "flex h-7 min-w-0 flex-1 items-center rounded-lg px-2 text-xs tracking-[var(--track)]";
const MUTED_ROW = `wash ${ROW_BASE} text-[var(--text-3)] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]`;

function rowClass(active: boolean) {
  return active
    ? `select-row ${ROW_BASE} bg-[var(--accent-soft)] text-[var(--accent)]`
    : `wash ${ROW_BASE} text-[var(--text-2)] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]`;
}

/**
 * The Chat sessions, parked under the Chat rail entry (owner decision 2026-09-17). This is the
 * only session list in the product: the second column is gone, so the toggle expands in place
 * from the few most recent to everything the host returned (it caps the list at 40).
 */
export function RailRecentThreads() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { threads, error, deletingId, removeThread } = useChatThreads({ scope: "chat" });
  const [expanded, setExpanded] = useState(false);

  const onChat = pathname === CHAT_PATH;
  const openThread = searchParams.get("thread");
  const activeThread = onChat ? openThread : null;
  const shown = expanded ? threads : takeRecentThreads(threads, RAIL_RECENT_THREADS);

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
        className={`wash ${ROW_BASE} font-medium text-[var(--text-2)] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]`}
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
              className={`wash shrink-0 rounded-lg px-1 py-0.5 text-xs text-[var(--text-3)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-[var(--danger)] ${
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
