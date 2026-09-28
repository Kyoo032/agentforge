import { describe, expect, it } from "vitest";
import {
  ImageModelRejectedError,
  chooseImageFrame,
  imageMissMayRetry,
  runImageSkills,
  writeImageBrief,
} from "./harness";

const STUB_URL = "https://cdn.example/still.png";

describe("image harness skills", () => {
  it("runs each new skill on a stub call", async () => {
    const calls: Array<{ prompt: string; aspect: string; model: string }> = [];
    const result = await runImageSkills({
      prompt: "a poster of a bakery",
      model: "gpt-image-2",
      execute: async (attempt) => {
        calls.push(attempt);
        if (calls.length === 1) {
          return { url: null, error: "fetch failed" };
        }
        return { url: STUB_URL, extra: "gpt-image-2" };
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(writeImageBrief("a poster of a bakery")).toContain("Subject: a poster of a bakery");
    expect(calls[0]?.prompt).toContain("One still image.");
    expect(calls[0]?.prompt).toContain("Subject: a poster of a bakery");
    expect(calls[0]?.prompt).toContain("not a collage");
    expect(calls[0]?.aspect).toBe("portrait");
    expect(calls[0]?.model).toBe("gpt-image-2");
    expect(result).toMatchObject({
      url: STUB_URL,
      aspect: "portrait",
      attempts: 2,
      extra: "gpt-image-2",
    });
  });

  it("keeps a frame they already picked", () => {
    expect(chooseImageFrame("a poster of a bakery", "landscape")).toBe("landscape");
    expect(chooseImageFrame("a banner for the shop")).toBe("landscape");
    expect(chooseImageFrame("a ceramic cup")).toBe("square");
    expect(chooseImageFrame("a wide poster")).toBe("square");
  });

  it("does not retry a timeout that may have billed", async () => {
    let calls = 0;
    await expect(
      runImageSkills({
        prompt: "a lantern",
        model: "gpt-image-2",
        execute: async () => {
          calls += 1;
          return {
            url: null,
            error: "Gateway image request timed out. The gateway may already have billed and generated the image",
          };
        },
      }),
    ).rejects.toThrow(/billed/);
    expect(calls).toBe(1);
    expect(imageMissMayRetry("fetch failed")).toBe(true);
    expect(imageMissMayRetry("ECONNREFUSED")).toBe(true);
    expect(imageMissMayRetry("Gateway images returned HTTP 502")).toBe(false);
  });

  it("refuses a model that does not make images before any call", async () => {
    let calls = 0;
    await expect(
      runImageSkills({
        prompt: "a lantern",
        model: "veo_3_1-fast",
        execute: async () => {
          calls += 1;
          return { url: STUB_URL };
        },
      }),
    ).rejects.toBeInstanceOf(ImageModelRejectedError);
    expect(calls).toBe(0);
  });
});
