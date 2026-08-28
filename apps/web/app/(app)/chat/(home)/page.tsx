import { ChatSession } from "@/components/chat-session";

export default async function ChatHomePage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const params = await searchParams;
  return <ChatSession initialThreadId={params.thread} />;
}
