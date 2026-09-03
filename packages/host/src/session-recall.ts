import type { TenantContext } from "@agentforge/core";
import { listPastSessionsForAgent, readPastSessionMessages } from "./threads";
import { messageText } from "./message-text";

export { messageText };

function formatSessionDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export async function formatPastSessionsHint(
  tenant: TenantContext,
  agentId: string,
  currentThreadId: string,
): Promise<string> {
  const sessions = await listPastSessionsForAgent(tenant, agentId, currentThreadId, 8);
  if (sessions.length === 0) {
    return "";
  }
  const lines = sessions.map(
    (session, index) => `${index + 1}. "${session.title}" — ${formatSessionDate(session.createdAt)} (id: ${session.id})`,
  );
  return (
    "\n\nThe user has earlier chats with you in this app. When they refer to a past conversation, use the past_sessions tool to read it.\n" +
    `Recent sessions:\n${lines.join("\n")}`
  );
}

export async function executePastSessionsTool(
  tenant: TenantContext,
  agentId: string,
  currentThreadId: string,
  args: { action: "list" | "read"; session_id?: string; search?: string },
): Promise<unknown> {
  if (args.action === "read") {
    if (!args.session_id) {
      return { success: false, message: "session_id is required to read a past chat" };
    }
    if (args.session_id === currentThreadId) {
      return { success: false, message: "That is the current chat — scroll up in this thread instead." };
    }
    const transcript = await readPastSessionMessages(tenant, agentId, args.session_id);
    if (!transcript) {
      return { success: false, message: "Session not found" };
    }
    return { success: true, ...transcript };
  }

  let sessions = await listPastSessionsForAgent(tenant, agentId, currentThreadId, 20);
  const query = args.search?.trim().toLowerCase();
  if (query) {
    sessions = sessions.filter((session) => session.title.toLowerCase().includes(query));
  }
  return {
    success: true,
    sessions: sessions.map((session) => ({
      id: session.id,
      title: session.title,
      date: formatSessionDate(session.createdAt),
      preview: session.preview,
    })),
  };
}
