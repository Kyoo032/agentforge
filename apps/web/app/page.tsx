import { redirect } from "next/navigation";
import { firstVisibleHref, resolveWorkspaceModes } from "@agentforge/core";
import { db, workspaces } from "@agentforge/db";
import { eq } from "drizzle-orm";
import { getTenant } from "@/lib/tenant";

export default async function HomePage() {
  const tenant = await getTenant();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, tenant.workspaceId))
    .limit(1);
  redirect(firstVisibleHref(resolveWorkspaceModes(workspace?.productModes)));
}
