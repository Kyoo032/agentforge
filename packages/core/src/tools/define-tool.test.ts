import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "../errors";
import type { TenantContext } from "../tenancy/types";
import { defineTool, invokeTool } from "./define-tool";

const tenant: TenantContext = {
  organizationId: "org-1",
  workspaceId: "ws-1",
  userId: "user-1",
  role: "builder",
};

describe("defineTool", () => {
  const echo = defineTool({
    key: "echo",
    name: "Echo",
    description: "Echo a number",
    schema: z.object({ n: z.number() }),
    execute: async ({ n }) => ({ n }),
  });

  it("rejects invalid args", async () => {
    await expect(invokeTool(echo, { n: "x" }, tenant)).rejects.toBeInstanceOf(ApiError);
  });

  it("returns handler result when args match schema", async () => {
    await expect(invokeTool(echo, { n: 1 }, tenant)).resolves.toEqual({ n: 1 });
  });
});
