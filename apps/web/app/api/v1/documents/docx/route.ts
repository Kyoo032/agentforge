import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { parseDocumentDraftBody } from "@/lib/document-outline";
import { buildDocumentDocx } from "@/lib/document-docx";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const draft = parseDocumentDraftBody(body);
    const { buffer, filename } = await buildDocumentDocx(draft);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
