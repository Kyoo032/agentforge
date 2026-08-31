import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, media } from "@agentforge/db";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { mediaRoot } from "@/lib/media-root";

type RouteContext = { params: Promise<{ mediaId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const tenant = await getTenant();
    const { mediaId } = await context.params;
    const rows = await db
      .select()
      .from(media)
      .where(and(eq(media.organizationId, tenant.organizationId), eq(media.id, mediaId)))
      .limit(1);
    const item = rows[0];
    if (!item) {
      return NextResponse.json({ error: { code: "not_found", message: "Media not found" } }, { status: 404 });
    }
    const bytes = await readFile(path.join(mediaRoot(), item.storagePath));
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": item.mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
