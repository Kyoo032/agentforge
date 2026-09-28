import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outputLanguageRule, type TenantContext } from "@agentforge/core";
import { db, ensureLocalOwner } from "@agentforge/db";
import { saveModelCache } from "./model-cache";
import { resetCatalogMemo } from "./selectable-models";
import { getStudioMediaMeta } from "./studio-media-meta";
import { generateStudioVideo, type VideoGenerateOptions } from "./studio-generate";

let tenant: TenantContext;

const clip = `data:video/mp4;base64,${Buffer.from("stub-clip").toString("base64")}`;

function listedModels(): void {
  saveModelCache({
    openai: [
      { id: "grok-imagine-video", label: "Grok Imagine Video", provider: "openai", inputModalities: ["text"] },
      { id: "veo_3_1-fast", label: "Veo", provider: "openai", inputModalities: ["text"] },
      { id: "mj_video", label: "MJ Video", provider: "openai", inputModalities: ["text"] },
    ],
  });
  resetCatalogMemo();
}

describe("videos harness on generate", () => {
  beforeAll(async () => {
    tenant = await ensureLocalOwner(db);
  });

  afterAll(async () => {
    const { sql } = await import("@agentforge/db");
    sql.close();
  });

  it("runs the shot, one retry, and keeps the billed clip", async () => {
    listedModels();
    const prompts: string[] = [];
    const options: VideoGenerateOptions = {
      renderVideo: async (call) => {
        prompts.push(call.prompt);
        if (prompts.length === 1) {
          return { success: false, error: "job timed out" };
        }
        expect(call.seconds).toBe(5);
        return { success: true, video: clip, model: "grok-imagine-video" };
      },
    };
    const result = await generateStudioVideo(
      tenant,
      { prompt: "a cat in the rain", aspect: "16:9", model: "grok-imagine-video", seconds: 5 },
      options,
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Subject: a cat in the rain");
    expect(prompts[0]).toContain(outputLanguageRule("videos", "en"));
    expect(result.prompt).toBe("a cat in the rain");
    expect(result.id).toBeTruthy();
    const meta = await getStudioMediaMeta(tenant.tenantId, result.id ?? "");
    expect(meta?.prompt).toContain("Subject: a cat in the rain");
    expect(meta?.durationSeconds).toBe(5);
  });

  it("bills the snapped Veo length", async () => {
    listedModels();
    let seconds = 0;
    const result = await generateStudioVideo(
      tenant,
      { prompt: "waves on a dock", aspect: "16:9", model: "veo_3_1-fast", seconds: 5 },
      {
        renderVideo: async (call) => {
          seconds = call.seconds;
          return { success: true, video: clip, model: call.model };
        },
      },
    );
    expect(seconds).toBe(4);
    const meta = await getStudioMediaMeta(tenant.tenantId, result.id ?? "");
    expect(meta?.durationSeconds).toBe(4);
  });

  it("does not render a still the model cannot take", async () => {
    listedModels();
    let calls = 0;
    await expect(
      generateStudioVideo(
        tenant,
        {
          prompt: "animate this",
          aspect: "16:9",
          model: "mj_video",
          imageUrl: "https://cdn.example/still.png",
        },
        {
          renderVideo: async () => {
            calls += 1;
            return { success: true, video: clip, model: "mj_video" };
          },
        },
      ),
    ).rejects.toMatchObject({ code: "video_still_unsupported" });
    expect(calls).toBe(0);
  });
});
