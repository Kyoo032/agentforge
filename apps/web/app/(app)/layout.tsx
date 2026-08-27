import { db, workspaces } from "@agentforge/db";
import { eq } from "drizzle-orm";
import { isDefaultChatAgent } from "@agentforge/core";
import { AppShell } from "@/components/app-shell";
import { agentService, getTenant } from "@/lib/tenant";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, tenant.workspaceId))
    .limit(1);
  const agents = (await agentService.list(tenant))
    .filter(
      (agent) =>
        !isDefaultChatAgent(agent) &&
        !/office[- ]hours/i.test(agent.slug) &&
        !/office hours/i.test(agent.name),
    )
    .map((agent) => ({ id: agent.id, name: agent.name }));

  return (
    <AppShell workspaceName={workspace?.name ?? "Home"} agents={agents}>
      {children}
    </AppShell>
  );
}
