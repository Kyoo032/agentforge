#!/usr/bin/env tsx
/**
 * Live music probe. Does not print secrets.
 *
 * This is the first thing to run on a desk with a real gateway key, because the Suno relay wire in
 * `packages/core/src/tools/platform/gateway-audio.ts` was written from the catalog docs and has
 * never been driven: Cloud agents have no egress to the gateway host. The probe answers three
 * questions in one run — does the catalog list a music model, does the relay accept a submit, and
 * does a finished job hand back a playable URL.
 *
 * Exit 0 = a job finished and returned at least one track URL.
 * Exit 2 = no OPENAI_API_KEY (expected on Cloud stub VMs).
 * Exit 1 = gateway error. The message says which of the three steps failed.
 *
 *   OPENAI_API_KEY=… pnpm exec tsx scripts/probe-gateway-music.ts
 *   OPENAI_API_KEY=… MUSIC_GEN_MODEL=suno_music pnpm exec tsx scripts/probe-gateway-music.ts
 */
import { GATEWAY_BASE_URL } from "../packages/core/src/gateway.ts";
import { DEFAULT_GATEWAY_MUSIC_MODEL, audioRole } from "../packages/core/src/models/media-kind.ts";
import { generateGatewayMusic } from "../packages/core/src/tools/platform/gateway-audio.ts";

type CatalogModel = { id?: unknown };

/** What the gateway actually serves for audio, grouped by what each id can do. */
async function listAudioIds(baseUrl: string, apiKey: string): Promise<string[]> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`GET /models returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as { data?: CatalogModel[] };
  return (body.data ?? [])
    .map((model) => (typeof model.id === "string" ? model.id : ""))
    .filter((id) => id.length > 0);
}

async function main(): Promise<number> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "No OPENAI_API_KEY. Paste a gateway key in Settings on the local PC, then rerun with the key in the environment (never commit it).",
    );
    return 2;
  }

  const baseUrl = process.env.OPENAI_BASE_URL?.trim() || GATEWAY_BASE_URL;

  let ids: string[] = [];
  try {
    ids = await listAudioIds(baseUrl, apiKey);
  } catch (error) {
    console.error(`step 1 (catalog): ${error instanceof Error ? error.message : "failed"}`);
    return 1;
  }
  const byRole = new Map<string, string[]>();
  for (const id of ids) {
    const role = audioRole(id);
    if (role === "other") {
      continue;
    }
    byRole.set(role, [...(byRole.get(role) ?? []), id]);
  }
  for (const [role, matched] of [...byRole.entries()].sort()) {
    console.log(`${role}: ${matched.join(", ")}`);
  }
  if ((byRole.get("music") ?? []).length === 0) {
    console.error("step 1 (catalog): this gateway lists no music model. Nothing to probe.");
    return 1;
  }

  const model = process.env.MUSIC_GEN_MODEL?.trim() || byRole.get("music")?.[0] || DEFAULT_GATEWAY_MUSIC_MODEL;
  console.log(`Probing POST /suno/submit/music model=${model}`);

  try {
    const result = await generateGatewayMusic({
      baseUrl,
      apiKey,
      model,
      mode: "describe",
      prompt: "A short calm lo-fi instrumental with rhodes piano and brushed drums.",
      instrumental: true,
    });
    for (const track of result.tracks) {
      const seconds = track.durationSeconds ? ` seconds=${Math.round(track.durationSeconds)}` : "";
      console.log(`ok model=${result.model} urlHost=${new URL(track.url).host}${seconds}`);
    }
    return result.tracks.length > 0 ? 0 : 1;
  } catch (error) {
    console.error(`step 2/3 (submit or poll): ${error instanceof Error ? error.message : "probe failed"}`);
    return 1;
  }
}

main().then((code) => process.exit(code));
