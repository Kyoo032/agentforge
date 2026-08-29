import { db, workspaces } from "@agentforge/db";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { agentService, getTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, tenant.workspaceId))
    .limit(1);
  const visibleModes = await agentService.listVisibleProductModes(tenant);

  return (
    <AppShell workspaceName={workspace?.name ?? "Home"} visibleModes={visibleModes}>
      {children}
    </AppShell>
  );
}
