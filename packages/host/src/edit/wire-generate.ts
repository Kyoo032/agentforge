import { eq } from "drizzle-orm";
import { media } from "@agentforge/db";
import { db } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { generateStudioImage, generateStudioVideo } from "../studio-generate";
import { mediaIdFromUrl } from "../media-id";
import { setGenerateSubmit } from "./generate";

let wired = false;

export function ensureGenerateSubmitWired(): void {
  if (wired) {
    return;
  }
  wired = true;
  setGenerateSubmit(async ({ kind, request, signal }) => {
    void signal;
    const body = (request ?? {}) as Record<string, unknown>;
    const tenant = body.tenant as TenantContext | undefined;
    if (!tenant?.organizationId || !tenant.workspaceId || !tenant.userId) {
      return { status: 400, body: { error: "tenant_required" } };
    }
    try {
      if (kind === "generate_image") {
        const aspectRaw = String(body.aspect ?? "square");
        const aspect =
          aspectRaw === "16:9" || aspectRaw === "landscape"
            ? "landscape"
            : aspectRaw === "9:16" || aspectRaw === "portrait"
              ? "portrait"
              : "square";
        const result = await generateStudioImage(
          tenant,
          {
            prompt: String(body.prompt ?? ""),
            aspect,
            model: typeof body.model === "string" ? body.model : undefined,
            imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
          },
          { workType: "Edit" },
        );
        const mediaId = result.id ?? mediaIdFromUrl(result.url);
        return {
          status: 200,
          body: result,
          outputAssetIds: mediaId ? [mediaId] : [],
        };
      }
      const result = await generateStudioVideo(
        tenant,
        {
          prompt: String(body.prompt ?? ""),
          aspect: (body.aspect as "16:9" | "9:16" | "1:1") ?? "16:9",
          model: typeof body.model === "string" ? body.model : undefined,
          imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
          seconds: typeof body.seconds === "number" ? body.seconds : undefined,
          resolution: body.resolution as "480p" | "720p" | "1080p" | undefined,
        },
        { workType: "Edit" },
      );
      const mediaId = result.id ?? mediaIdFromUrl(result.url);
      return {
        status: 200,
        body: result,
        outputAssetIds: mediaId ? [mediaId] : [],
      };
    } catch (error) {
      const status =
        error && typeof error === "object" && "status" in error && typeof (error as { status: unknown }).status === "number"
          ? (error as { status: number }).status
          : 500;
      const message = error instanceof Error ? error.message : "generate_failed";
      return { status, body: { error: message } };
    }
  });
}

export async function loadMediaRow(mediaId: string) {
  const rows = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  return rows[0] ?? null;
}
