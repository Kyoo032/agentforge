import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { db, organizationMembers, organizations } from "@agentforge/db";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const tenant = await getTenant();
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, tenant.organizationId))
      .limit(1);
    const members = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, tenant.organizationId));
    return NextResponse.json({ organization, members });
  } catch (error) {
    return jsonError(error);
  }
}
