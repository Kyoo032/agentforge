import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { db, organizations, workspaces } from "@agentforge/db";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const tenant = await getTenant();
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, tenant.organizationId))
      .limit(1);
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, tenant.workspaceId))
      .limit(1);
    return NextResponse.json({
      tenant,
      organization,
      workspace,
    });
  } catch (error) {
    return jsonError(error);
  }
}
