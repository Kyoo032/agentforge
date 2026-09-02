import { z } from "zod";
import { GATEWAY_BASE_URL } from "../../gateway";
import { DEFAULT_GATEWAY_VIDEO_MODEL } from "../../models/media-kind";
import { clampVideoSeconds } from "../../models/video-capabilities";
import { ApiError } from "../../errors";
import { defineTool } from "../define-tool";
import { missingToolRouteMessage, resolveToolBackend } from "../credentials";
import { getSecret } from "../secret-scope";
import { falVideoUrl, runFalQueue } from "./fal-queue";
import { generateGatewayVideo } from "./gateway-media";

const FAL_VIDEO_TEXT = "fal-ai/pixverse/v6/text-to-video";
const FAL_VIDEO_IMAGE = "fal-ai/pixverse/v6/image-to-video";
const SEEDANCE_MODEL = "doubao-seedance-2-0-fast-260128";

async function generateWithFal(
  prompt: string,
  imageUrl: string | undefined,
  aspectRatio: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ url: string; model: string; modality: "text" | "image" }> {
  const modality = imageUrl ? "image" : "text";
  const endpoint = imageUrl ? FAL_VIDEO_IMAGE : FAL_VIDEO_TEXT;
  const payload: Record<string, unknown> = { prompt, aspect_ratio: aspectRatio };
  if (imageUrl) {
    payload.image_url = imageUrl;
  }
  const body = await runFalQueue({
    endpoint,
    apiKey,
    payload,
    fetchImpl,
  });
  const url = falVideoUrl(body);
  if (!url) {
    throw new ApiError("tool_failed", "FAL returned no video URL", 502);
  }
  return { url, model: endpoint, modality };
}

async function generateWithSeedance(
  prompt: string,
  imageUrl: string | undefined,
  aspectRatio: string,
  apiKey: string,
  baseUrl: string,
  fetchImpl: typeof fetch,
  seconds?: number,
): Promise<{ url: string; model: string; modality: "text" | "image" }> {
  const origin = baseUrl.replace(/\/+$/, "");
  const duration = clampVideoSeconds(seconds);
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: `${prompt} --rt ${aspectRatio} --dur ${duration}` },
  ];
  if (imageUrl) {
    content.push({ type: "image_url", image_url: { url: imageUrl } });
  }
  const created = await fetchImpl(`${origin}/contents/generations/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: SEEDANCE_MODEL, content }),
  });
  const createdBody = (await created.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string } | string;
  };
  if (!created.ok || !createdBody.id) {
    const message =
      typeof createdBody.error === "string"
        ? createdBody.error
        : createdBody.error?.message || `Seedance returned HTTP ${created.status}`;
    throw new ApiError("tool_failed", message, 502);
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const statusRes = await fetchImpl(`${origin}/contents/generations/tasks/${createdBody.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const statusBody = (await statusRes.json().catch(() => ({}))) as {
      status?: string;
      content?: { video_url?: string };
      error?: { message?: string } | string;
    };
    if (statusBody.status === "succeeded" && statusBody.content?.video_url) {
      return {
        url: statusBody.content.video_url,
        model: SEEDANCE_MODEL,
        modality: imageUrl ? "image" : "text",
      };
    }
    if (statusBody.status === "failed") {
      const message =
        typeof statusBody.error === "string"
          ? statusBody.error
          : statusBody.error?.message || "Seedance job failed";
      throw new ApiError("tool_failed", message, 502);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new ApiError("tool_failed", "Seedance job timed out", 504);
}

export const videoGenerateTool = defineTool({
  key: "video_generate",
  name: "Create video",
  description:
    "Create a video from a text prompt, or animate a still by passing image_url. Uses the Toko Token gateway by default (POST /v1/video/generations, then poll). Pass model to pick a catalog video id.",
  capability: "video_gen",
  schema: z.object({
    prompt: z.string().min(1).describe("Video prompt"),
    aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).optional().describe("Output aspect ratio"),
    image_url: z.string().url().optional().describe("Optional still image to animate"),
    model: z.string().min(1).optional().describe("Optional catalog video model id"),
    seconds: z.number().int().min(2).max(12).optional().describe("Clip length in seconds (2–12)"),
    resolution: z.enum(["480p", "720p", "1080p"]).optional().describe("Output resolution for Seedance-class models"),
  }),
  execute: async ({ prompt, aspect_ratio, image_url, model, seconds, resolution }) => {
    const route = resolveToolBackend("video_gen");
    if (!route.ready || !route.envVar) {
      return {
        success: false,
        error: missingToolRouteMessage(
          route,
          "Add a Toko Token gateway key in Settings to generate video, or pick FAL / Volcengine Seedance.",
        ),
      };
    }
    const apiKey = getSecret(route.envVar);
    if (!apiKey) {
      return { success: false, error: `${route.envVar} is not set.` };
    }
    const aspect = aspect_ratio ?? "16:9";
    const fetchImpl = globalThis.fetch;
    try {
      const generated =
        route.backend === "gateway"
          ? await generateGatewayVideo({
              prompt,
              aspectRatio: aspect,
              imageUrl: image_url,
              seconds,
              resolution,
              apiKey,
              model: model || getSecret("VIDEO_GEN_MODEL") || DEFAULT_GATEWAY_VIDEO_MODEL,
              baseUrl: getSecret("OPENAI_BASE_URL") || GATEWAY_BASE_URL,
              fetchImpl,
            })
          : route.backend === "volcengine"
            ? await generateWithSeedance(
                prompt,
                image_url,
                aspect,
                apiKey,
                getSecret("ARK_BASE_URL") || "https://ark.cn-beijing.volces.com/api/v3",
                fetchImpl,
                seconds,
              )
            : await generateWithFal(prompt, image_url, aspect, apiKey, fetchImpl);
      return {
        success: true,
        backend: route.backend,
        video: generated.url,
        model: generated.model,
        modality: image_url ? "image" : "text",
        prompt,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Video generation failed" };
    }
  },
});
