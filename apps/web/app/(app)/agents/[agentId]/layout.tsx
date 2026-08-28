import type { ReactNode } from "react";
import { ChatThreadList } from "@/components/chat-thread-list";

export default async function AgentChatLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <ChatThreadList basePath={`/agents/${agentId}`} scope="agent" agentId={agentId} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
