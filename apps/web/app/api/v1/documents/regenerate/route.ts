import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { regenerateDocumentSection } from "@/lib/document-generate";

export async function POST(request: Request) {
  try {
    const tenant = await getTenant();
    const body = await request.json().catch(() => null);
    const draft = await regenerateDocumentSection(tenant, body);
    return NextResponse.json(draft);
  } catch (error) {
    return jsonError(error);
  }
}
