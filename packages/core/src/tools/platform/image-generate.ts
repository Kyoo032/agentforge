import { z } from "zod";
import { resolvedGatewayBaseUrl } from "../../gateway";
import { DEFAULT_GATEWAY_IMAGE_MODEL } from "../../models/media-kind";
import { ApiError } from "../../errors";
import { defineTool } from "../define-tool";
import { missingToolRouteMessage, resolveToolBackend } from "../credentials";
import { getSecret } from "../secret-scope";
import { falImageUrl, runFalQueue } from "./fal-queue";
import { generateGatewayImage } from "./gateway-media";

const FAL_IMAGE_MODEL = "fal-ai/flux-2/klein/9b";

const FAL_SIZES: Record<string, string> = {
  landscape: "landscape_16_9",
  square: "square_hd",
  portrait: "portrait_16_9",
};

async function generateWithFal(
  prompt: string,
  aspectRatio: string,
  imageUrl: string | undefined,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ url: string; model: string }> {
  const payload: Record<string, unknown> = {
    prompt,
    image_size: FAL_SIZES[aspectRatio] ?? FAL_SIZES.square,
  };
  if (imageUrl) {
    payload.image_url = imageUrl;
  }
  const body = await runFalQueue({
    endpoint: FAL_IMAGE_MODEL,
    apiKey,
    payload,
    fetchImpl,
  });
  const url = falImageUrl(body);
  if (!url) {
    throw new ApiError("tool_failed", "FAL returned no image URL", 502);
  }
  return { url, model: FAL_IMAGE_MODEL };
}

function usesGatewayImages(backend: string): boolean {
  return backend === "gateway" || backend === "openai";
}

export const imageGenerateTool = defineTool({
  key: "image_generate",
  name: "Create image",
  description:
    "Create an image from a text prompt. Uses the Toko Token gateway by default (POST /v1/images/generations). Pass model to pick a catalog image id. Pass image_url to edit when the backend supports it. If this tool errors after a long wait, do not call it again in the same turn — the image may already have been generated and billed on the gateway.",
  capability: "image_gen",
  schema: z.object({
    prompt: z.string().min(1).describe("Image prompt"),
    aspect_ratio: z.enum(["square", "landscape", "portrait"]).optional().describe("Output shape"),
    image_url: z.string().url().optional().describe("Optional source image to edit"),
    model: z.string().min(1).optional().describe("Optional catalog image model id"),
  }),
  execute: async ({ prompt, aspect_ratio, image_url, model }) => {
    const route = resolveToolBackend("image_gen");
    if (!route.ready || !route.envVar) {
      return {
        success: false,
        error: missingToolRouteMessage(
          route,
          "Add a Toko Token gateway key in Settings to generate images, or pick FAL / OpenAI Images.",
        ),
      };
    }
    const apiKey = getSecret(route.envVar);
    if (!apiKey) {
      return { success: false, error: `${route.envVar} is not set.` };
    }
    const aspect = aspect_ratio ?? "square";
    const fetchImpl = globalThis.fetch;
    try {
      const generated = usesGatewayImages(route.backend)
        ? await generateGatewayImage({
            prompt,
            aspectRatio: aspect,
            imageUrl: image_url,
            apiKey,
            model: model || getSecret("IMAGE_GEN_MODEL") || DEFAULT_GATEWAY_IMAGE_MODEL,
            baseUrl: getSecret("OPENAI_BASE_URL") || resolvedGatewayBaseUrl(),
            fetchImpl,
          })
        : await generateWithFal(prompt, aspect, image_url, apiKey, fetchImpl);
      return { success: true, backend: route.backend, image: generated.url, model: generated.model, prompt };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Image generation failed" };
    }
  },
});
