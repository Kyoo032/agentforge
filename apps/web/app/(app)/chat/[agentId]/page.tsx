import { redirect } from "next/navigation";

export default async function LegacyAgentChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ thread?: string }>;
}) {
  const { agentId } = await params;
  const { thread } = await searchParams;
  const qs = thread ? `?thread=${encodeURIComponent(thread)}` : "";
  redirect(`/agents/${agentId}${qs}`);
}
