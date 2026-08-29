import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { generateResearchNotes } from "@/lib/research-generate";

export async function POST(request: Request) {
  try {
    const tenant = await getTenant();
    const body = await request.json().catch(() => null);
    const notes = await generateResearchNotes(tenant, body);
    return NextResponse.json(notes);
  } catch (error) {
    return jsonError(error);
  }
}
