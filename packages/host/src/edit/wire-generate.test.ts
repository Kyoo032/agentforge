/**
 * The wired generate submit uses the tenant the worker hands it, and never one from the request.
 *
 * It used to read `request.tenant` and pass that to `generateStudioImage` / `generateStudioVideo`,
 * which is what let a queued job name somebody else's key, ledger and desk. The studio is mocked
 * here so the assertion is about which tenant reaches it, with no gateway and no media store.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@agentforge/core";

const { imageCalls, videoCalls } = vi.hoisted(() => ({
  imageCalls: [] as unknown[][],
  videoCalls: [] as unknown[][],
}));

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("../studio-generate", () => ({
  generateStudioImage: vi.fn(async (...args: unknown[]) => {
    imageCalls.push(args);
    return { id: MEDIA_ID, url: `/api/v1/media/${MEDIA_ID}/file`, prompt: "p", aspect: "square", model: "m" };
  }),
  generateStudioVideo: vi.fn(async (...args: unknown[]) => {
    videoCalls.push(args);
    return { id: MEDIA_ID, url: `/api/v1/media/${MEDIA_ID}/file`, prompt: "p", aspect: "16:9", model: "m" };
  }),
}));

import { runGenerateJob } from "./generate";
import { ensureGenerateSubmitWired } from "./wire-generate";

const OWNER: TenantContext = {
  tenantId: "wire-owner-tenant",
  organizationId: "wire-owner-org",
  workspaceId: "wire-owner-desk",
  userId: "wire-owner-user",
  role: "owner",
};

const FORGED: TenantContext = {
  tenantId: "wire-victim-tenant",
  organizationId: "wire-victim-org",
  workspaceId: "wire-victim-desk",
  userId: "wire-victim-user",
  role: "owner",
};

afterEach(() => {
  imageCalls.length = 0;
  videoCalls.length = 0;
});

describe("the wired generate submit", () => {
  it("calls the image studio with the tenant it is handed, not the request's", async () => {
    ensureGenerateSubmitWired();
    const result = await runGenerateJob(
      "generate_image",
      { prompt: "a red cube", aspect: "square", tenant: FORGED },
      new AbortController().signal,
      OWNER,
    );

    expect(imageCalls).toHaveLength(1);
    expect(imageCalls[0]?.[0]).toEqual(OWNER);
    expect(JSON.stringify(imageCalls)).not.toContain(FORGED.organizationId);
    expect(result.outputAssetIds).toEqual([MEDIA_ID]);
  });

  it("calls the video studio with the tenant it is handed, not the request's", async () => {
    ensureGenerateSubmitWired();
    await runGenerateJob(
      "generate_video",
      { prompt: "a red cube", aspect: "16:9", tenant: FORGED },
      new AbortController().signal,
      OWNER,
    );

    expect(videoCalls).toHaveLength(1);
    expect(videoCalls[0]?.[0]).toEqual(OWNER);
  });

  it("refuses when it is handed no tenant, however complete the request's is", async () => {
    // A job row written before this change still carries `tenant` in its request. It buys nothing.
    ensureGenerateSubmitWired();
    await expect(
      runGenerateJob(
        "generate_video",
        { prompt: "a red cube", tenant: FORGED },
        new AbortController().signal,
        undefined as unknown as TenantContext,
      ),
    ).rejects.toMatchObject({ code: "generate_failed" });
    expect(videoCalls).toHaveLength(0);
  });
});
