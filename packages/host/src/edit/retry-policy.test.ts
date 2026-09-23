import { afterEach, describe, expect, it } from "vitest";
import { ApiError, type TenantContext } from "@agentforge/core";
import { runGenerateJob, setGenerateSubmit } from "./generate";
import { maskPii } from "@agentforge/core";

/** The tenant the job runner resolved; these tests are about retries and masking, not about who. */
const TENANT: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org-retry",
  workspaceId: "desk-retry",
  userId: "user-retry",
  role: "owner",
};

describe("retry policy (G-18)", () => {
  afterEach(() => {
    setGenerateSubmit(null);
  });

  it("never retries prepaid 403", async () => {
    let calls = 0;
    setGenerateSubmit(async () => {
      calls += 1;
      return { status: 403, body: { error: "prepaid_async_requires_fixed_price" } };
    });
    await expect(
      runGenerateJob("generate_video", { prompt: "hi" }, new AbortController().signal, TENANT),
    ).rejects.toMatchObject({ code: "prepaid_async_requires_fixed_price" });
    expect(calls).toBe(1);
  });

  it("retries once on 5xx", async () => {
    let calls = 0;
    setGenerateSubmit(async () => {
      calls += 1;
      if (calls === 1) {
        return { status: 503, body: { error: "busy" } };
      }
      return { status: 200, body: {}, outputAssetIds: ["a1"] };
    });
    const result = await runGenerateJob("generate_image", { prompt: "hi" }, new AbortController().signal, TENANT);
    expect(result.outputAssetIds).toEqual(["a1"]);
    expect(calls).toBe(2);
  });
});

describe("maskPii on generate (G-23)", () => {
  afterEach(() => {
    setGenerateSubmit(null);
  });

  it("masks prompts before submit", async () => {
    const seen: unknown[] = [];
    setGenerateSubmit(async ({ request }) => {
      seen.push(request);
      return { status: 200, body: {}, outputAssetIds: [] };
    });
    const prompt = "Contact me at ada@example.com please";
    await runGenerateJob("generate_image", { prompt }, new AbortController().signal, TENANT);
    expect(JSON.stringify(seen)).not.toContain("ada@example.com");
    expect(JSON.stringify(seen[0])).toContain(maskPii(prompt));
  });
});
