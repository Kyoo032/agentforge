import { useSearchParams } from "@/lib/nav";
import { ChatSession } from "@/components/chat-session";

export function ChatPage() {
  const params = useSearchParams();
  const thread = params.get("thread") ?? undefined;
  // Every Chat session lives in the left rail since 2026-09-17, so the pane owns the whole width.
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[var(--bg)]">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <ChatSession initialThreadId={thread} />
      </div>
    </div>
  );
}
