import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { saveMedia } from "@/lib/media";

export async function POST(request: Request) {
  try {
    const tenant = await getTenant();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "invalid_content_part", message: "file is required" } },
        { status: 400 },
      );
    }
    const saved = await saveMedia(tenant, file);
    return NextResponse.json({ id: saved.id, kind: saved.kind, mime: saved.mime, url: saved.url }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
