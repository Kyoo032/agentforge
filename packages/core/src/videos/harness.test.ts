import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { outputLanguageRule } from "../output-language";
import {
  acceptVideoShot,
  clipIsVideoUrl,
  composeVideoShot,
  runVideoHarness,
  videoRenderShouldRetry,
  type VideoRenderResult,
} from "./harness";

const LISTED = ["grok-imagine-video", "veo_3_1-fast", "mj_video"] as const;

function ok(url: string, model = "grok-imagine-video"): VideoRenderResult {
  return { ok: true, url, model };
}

function fail(message: string, status = 400): VideoRenderResult {
  return { ok: false, message, code: "tool_failed", status };
}

describe("videos harness skills", () => {
  it("runs write-shot, render-retry, and keep-clip", async () => {
    const calls: string[] = [];
    const result = await runVideoHarness(
      {
        prompt: "a cat in the rain",
        requestedModel: "grok-imagine-video",
        availableIds: LISTED,
        aspect: "16:9",
        seconds: 5,
        locale: "en",
        draftShot: "A dog in a bright studio, no weather.",
      },
      async (call) => {
        calls.push(call.prompt);
        if (calls.length === 1) {
          return fail("job timed out", 504);
        }
        return ok("https://cdn.example/clip.mp4");
      },
    );
    expect(result.skills).toEqual(["write-shot", "render-retry", "keep-clip"]);
    expect(result.shotRepaired).toBe(true);
    expect(result.shot).toContain("a cat in the rain");
    expect(result.shot).toContain("Camera: one steady shot.");
    expect(result.seconds).toBe(5);
    expect(result.attempts).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("a cat in the rain");
    expect(calls[0]).toContain(outputLanguageRule("videos", "en"));
    expect(calls[1]).toBe(calls[0]);
  });

  it("keeps a prompt that already names a camera and a motion", () => {
    const prompt = "A slow push-in on a ceramic cup as window light moves across the desk";
    expect(composeVideoShot(prompt)).toBe(prompt);
    expect(acceptVideoShot(prompt)).toEqual({ shot: prompt, repaired: false });
  });

  it("writes a shot around a bare sentence and keeps that sentence", () => {
    const shot = composeVideoShot("a cat in the rain");
    expect(shot).toMatch(/^Subject: a cat in the rain/);
    expect(shot).toContain("Motion:");
    expect(shot).toContain("Camera: one steady shot.");
    expect(acceptVideoShot("a cat in the rain").repaired).toBe(false);
  });

  it("snaps the length and does not retry a model the key did not list", async () => {
    let calls = 0;
    const snapped = await runVideoHarness(
      {
        prompt: "waves on a dock",
        requestedModel: "veo_3_1-fast",
        availableIds: LISTED,
        aspect: "16:9",
        seconds: 5,
        locale: "id",
      },
      async (call) => {
        calls += 1;
        expect(call.seconds).toBe(4);
        expect(call.prompt).toContain(outputLanguageRule("videos", "id"));
        return ok("https://cdn.example/veo.mp4", "veo_3_1-fast");
      },
    );
    expect(snapped.seconds).toBe(4);
    expect(snapped.skills).toEqual(["write-shot", "keep-clip"]);
    expect(calls).toBe(1);

    let refused = 0;
    await expect(
      runVideoHarness(
        {
          prompt: "waves on a dock",
          requestedModel: "not-on-this-key",
          availableIds: LISTED,
          aspect: "16:9",
          locale: "en",
        },
        async () => {
          refused += 1;
          return ok("https://cdn.example/nope.mp4");
        },
      ),
    ).rejects.toMatchObject({ code: "model_not_on_key" });
    expect(refused).toBe(0);
  });

  it("refuses a still the model cannot take and does not render", async () => {
    let calls = 0;
    await expect(
      runVideoHarness(
        {
          prompt: "animate this",
          requestedModel: "mj_video",
          availableIds: LISTED,
          aspect: "16:9",
          imageUrl: "https://cdn.example/still.png",
          locale: "en",
        },
        async () => {
          calls += 1;
          return ok("https://cdn.example/clip.mp4");
        },
      ),
    ).rejects.toMatchObject({ code: "video_still_unsupported" });
    expect(calls).toBe(0);
  });

  it("does not retry a missing key or a prepaid refusal", () => {
    expect(videoRenderShouldRetry("job timed out")).toBe(true);
    expect(
      videoRenderShouldRetry("No available channel. This video model has no live gateway channel (HTTP 503)."),
    ).toBe(true);
    expect(videoRenderShouldRetry("Add a Toko Token gateway key in Settings to generate videos.")).toBe(false);
    expect(videoRenderShouldRetry("rejected the API key")).toBe(false);
    expect(videoRenderShouldRetry("prepaid_async_requires_fixed_price")).toBe(false);
    expect(videoRenderShouldRetry("This model does not accept a still image")).toBe(false);
  });

  it("retries a still that came back instead of a video, then refuses a second one", async () => {
    let calls = 0;
    await expect(
      runVideoHarness(
        {
          prompt: "a cat in the rain",
          requestedModel: "grok-imagine-video",
          availableIds: LISTED,
          aspect: "16:9",
          locale: "en",
        },
        async () => {
          calls += 1;
          return ok("https://cdn.example/frame.png");
        },
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(2);
    expect(clipIsVideoUrl("https://cdn.example/clip.mp4")).toBe(true);
    expect(clipIsVideoUrl("data:video/mp4;base64,AAAA")).toBe(true);
    expect(clipIsVideoUrl("https://cdn.example/frame.png")).toBe(false);
    expect(clipIsVideoUrl("data:image/png;base64,AAAA")).toBe(false);
  });
});
