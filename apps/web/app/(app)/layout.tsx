import { db, workspaces } from "@agentforge/db";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { getTenant } from "@/lib/tenant";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, tenant.workspaceId))
    .limit(1);

  return (
    <AppShell workspaceName={workspace?.name ?? "Home"}>
      {children}
    </AppShell>
  );
}
