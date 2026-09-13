import { useSearchParams } from "@/lib/nav";
import { ChatThreadList } from "@/components/chat-thread-list";
import { ChatSession } from "@/components/chat-session";

export function ChatPage() {
  const params = useSearchParams();
  const thread = params.get("thread") ?? undefined;
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <ChatThreadList basePath="/chat" scope="chat" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ChatSession initialThreadId={thread} />
      </div>
    </div>
  );
}
