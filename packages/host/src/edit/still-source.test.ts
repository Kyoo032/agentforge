import { describe, expect, it } from "vitest";
import { emptyProject, type EditProject } from "@agentforge/core/edit";
import { resolveStillSource, withInlinedStill } from "./still-source";

function doc(): EditProject {
  const base = emptyProject({ id: "p1", workspaceId: "w1", name: "Loop", aspect: "16:9" });
  return {
    ...base,
    assets: {
      still: { id: "still", kind: "image", mediaId: "11111111-1111-4111-8111-111111111111", storagePath: "edit/p1/still.png" },
      draft: { id: "draft", kind: "image", storagePath: "edit/p1/draft.png" },
    },
  };
}

describe("resolveStillSource", () => {
  it("returns null when no still was requested", () => {
    expect(resolveStillSource(doc(), {})).toBeNull();
  });

  it("maps a timeline asset to its local media", () => {
    expect(resolveStillSource(doc(), { imageAssetId: "still" })).toEqual({
      kind: "local",
      assetId: "still",
      mediaId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("maps a relative or loopback media URL back to the project asset", () => {
    const relative = resolveStillSource(doc(), {
      imageUrl: "/api/v1/media/11111111-1111-4111-8111-111111111111/file",
    });
    const loopback = resolveStillSource(doc(), {
      imageUrl: "http://127.0.0.1:3000/api/v1/media/11111111-1111-4111-8111-111111111111/file",
    });
    const desktop = resolveStillSource(doc(), {
      imageUrl: "agentforge://media/11111111-1111-4111-8111-111111111111",
    });
    const expected = { kind: "local", assetId: "still", mediaId: "11111111-1111-4111-8111-111111111111" };
    expect(relative).toEqual(expected);
    expect(loopback).toEqual(expected);
    expect(desktop).toEqual(expected);
  });

  it("keeps a local media id that is not yet an asset", () => {
    expect(
      resolveStillSource(doc(), { imageUrl: "/api/v1/media/22222222-2222-4222-8222-222222222222/file" }),
    ).toEqual({ kind: "local", assetId: undefined, mediaId: "22222222-2222-4222-8222-222222222222" });
  });

  it("passes a public https URL through untouched", () => {
    expect(resolveStillSource(doc(), { imageUrl: "https://cdn.example/a.png" })).toEqual({
      kind: "remote",
      url: "https://cdn.example/a.png",
    });
  });

  it("flags stills that cannot be used instead of silently dropping them", () => {
    expect(resolveStillSource(doc(), { imageAssetId: "draft" })).toBe("unresolvable");
    expect(resolveStillSource(doc(), { imageAssetId: "nope" })).toBe("unresolvable");
    expect(resolveStillSource(doc(), { imageUrl: "not a url" })).toBe("unresolvable");
    expect(resolveStillSource(doc(), { imageUrl: "http://localhost:3000/foo.png" })).toBe(
      "unresolvable",
    );
  });

  it("withInlinedStill swaps the media id for a data URL only at submit time", async () => {
    const request = { prompt: "x", stillMediaId: "m1", model: "veo" };
    const out = await withInlinedStill(request, async (id) => (id === "m1" ? "data:image/png;base64,AAAA" : null));
    expect(out).toEqual({ prompt: "x", model: "veo", imageUrl: "data:image/png;base64,AAAA" });
    expect(request).toEqual({ prompt: "x", stillMediaId: "m1", model: "veo" });
    await expect(withInlinedStill({ prompt: "x" }, async () => null)).resolves.toEqual({ prompt: "x" });
    await expect(withInlinedStill({ prompt: "x", stillMediaId: "gone" }, async () => null)).rejects.toMatchObject({
      code: "still_not_found",
    });
  });

  it("prefers the asset id when both are given", () => {
    expect(
      resolveStillSource(doc(), { imageAssetId: "still", imageUrl: "https://cdn.example/a.png" }),
    ).toEqual({ kind: "local", assetId: "still", mediaId: "11111111-1111-4111-8111-111111111111" });
  });
});
