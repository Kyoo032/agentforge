import { ChatSession } from "@/components/chat-session";

export default async function AgentChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ thread?: string }>;
}) {
  const { agentId } = await params;
  const { thread } = await searchParams;
  return <ChatSession agentId={agentId} initialThreadId={thread} />;
}
