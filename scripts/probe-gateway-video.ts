#!/usr/bin/env tsx
/**
 * Live video probe. Does not print secrets.
 * Exit 0 = generate returned a URL.
 * Exit 2 = no OPENAI_API_KEY (expected on Cloud stub VMs).
 * Exit 1 = gateway error (including HTTP 503 no-channel).
 */
import { GATEWAY_BASE_URL } from "../packages/core/src/gateway.ts";
import { DEFAULT_GATEWAY_VIDEO_MODEL } from "../packages/core/src/models/media-kind.ts";
import { generateGatewayVideo } from "../packages/core/src/tools/platform/gateway-media.ts";

async function main(): Promise<number> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "No OPENAI_API_KEY. Paste a gateway key in Settings on the local PC, then rerun with the key in the environment (never commit it).",
    );
    return 2;
  }

  const model = process.env.VIDEO_GEN_MODEL?.trim() || DEFAULT_GATEWAY_VIDEO_MODEL;
  const baseUrl = process.env.OPENAI_BASE_URL?.trim() || GATEWAY_BASE_URL;
  console.log(`Probing POST /video/generations model=${model}`);

  try {
    const result = await generateGatewayVideo({
      baseUrl,
      apiKey,
      model,
      prompt: "A short clip of rain on a window, no text, five seconds.",
      aspectRatio: "16:9",
    });
    console.log(`ok model=${result.model} urlHost=${new URL(result.url).host}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "probe failed";
    console.error(message);
    return 1;
  }
}

main().then((code) => process.exit(code));
