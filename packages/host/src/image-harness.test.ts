import { afterEach, describe, expect, it, vi } from "vitest";
import { imageGenerateTool, type TenantContext } from "@agentforge/core";
import { imageModelRejectedMessage } from "./image-output-locale";
import { withRunContext } from "./run-context";
import { generateStudioImage } from "./studio-generate";

vi.mock("./media", () => ({
  saveGeneratedImage: vi.fn(async () => "/api/v1/media/11111111-1111-4111-8111-111111111111/file"),
}));

vi.mock("./knowledge-ingest", () => ({
  upsertWorkSource: vi.fn(async () => undefined),
}));

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org-images",
  workspaceId: "ws-images",
  userId: "user-images",
  role: "owner",
};

const STUB_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("generateStudioImage harness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.AGENTFORGE_RUNTIME = "stub";
  });

  it("refuses a clip model before any image call", async () => {
    const spy = vi.spyOn(imageGenerateTool, "execute");
    await expect(generateStudioImage(tenant, { prompt: "a lantern", model: "veo_3_1-fast" })).rejects.toMatchObject({
      code: "invalid_request",
      message: imageModelRejectedMessage("en"),
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("on a stub desk keeps their words and the inferred frame", async () => {
    const spy = vi.spyOn(imageGenerateTool, "execute");
    const result = await withRunContext({ threadId: "t", agentId: "a", locale: "id" }, () =>
      generateStudioImage(tenant, { prompt: "a poster of a bakery", model: "gpt-image-2" }),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(result.prompt).toBe("a poster of a bakery");
    expect(result.aspect).toBe("portrait");
    expect(result.model).toBe("gpt-image-2");
    expect(result.url).toBe("/api/v1/media/11111111-1111-4111-8111-111111111111/file");
    expect(result.id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("retries once when the call never left, with the locale on the brief", async () => {
    process.env.AGENTFORGE_RUNTIME = "ai";
    const prompts: string[] = [];
    vi.spyOn(imageGenerateTool, "execute").mockImplementation(async (args) => {
      prompts.push(String(args.prompt));
      if (prompts.length === 1) {
        return { success: false, error: "fetch failed" };
      }
      return { success: true, image: STUB_PNG, model: "gpt-image-2" };
    });
    const result = await withRunContext({ threadId: "t", agentId: "a", locale: "id" }, () =>
      generateStudioImage(tenant, { prompt: "a banner for the shop", model: "gpt-image-2" }),
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toBe(prompts[1]);
    expect(prompts[0]).toContain("One still image.");
    expect(prompts[0]).toContain("Subject: a banner for the shop");
    expect(prompts[0]).toContain("bahasa Indonesia");
    expect(result.aspect).toBe("landscape");
    expect(result.prompt).toBe("a banner for the shop");
    expect(result.url).toBe("/api/v1/media/11111111-1111-4111-8111-111111111111/file");
  });

  it("does not retry a timeout", async () => {
    process.env.AGENTFORGE_RUNTIME = "ai";
    const spy = vi.spyOn(imageGenerateTool, "execute").mockResolvedValue({
      success: false,
      error: "Gateway image request timed out. The gateway may already have billed and generated the image",
    });
    await expect(generateStudioImage(tenant, { prompt: "a lantern", model: "gpt-image-2" })).rejects.toThrow(/billed/);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
