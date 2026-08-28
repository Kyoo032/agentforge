import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { generatePresentationOutline } from "@/lib/presentation-generate";

export async function POST(request: Request) {
  try {
    const tenant = await getTenant();
    const body = await request.json().catch(() => null);
    const outline = await generatePresentationOutline(tenant, body);
    return NextResponse.json(outline);
  } catch (error) {
    return jsonError(error);
  }
}
