import type { ReactNode } from "react";
import { ChatThreadList } from "@/components/chat-thread-list";

export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <ChatThreadList basePath="/chat" scope="chat" />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
