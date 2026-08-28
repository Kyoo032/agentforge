import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { parsePresentationOutlineBody } from "@/lib/presentation-outline";
import { buildPresentationPptx } from "@/lib/presentation-pptx";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const outline = parsePresentationOutlineBody(body);
    const { buffer, filename } = await buildPresentationPptx(outline);
    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
