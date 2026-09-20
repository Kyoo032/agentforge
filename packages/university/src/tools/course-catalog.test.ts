import { describe, expect, it } from "vitest";
import { invokeTool, type TenantContext } from "@agentforge/core";
import { courseCatalogSearchTool } from "./course-catalog";

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org-1",
  workspaceId: "ws-1",
  userId: "user-1",
  role: "member",
};

describe("course_catalog.search", () => {
  it("finds CS101 by code", async () => {
    const result = (await invokeTool(courseCatalogSearchTool, { query: "CS101" }, tenant)) as {
      matches: Array<{ code: string }>;
    };
    expect(result.matches[0]?.code).toBe("CS101");
  });

  it("rejects empty query", async () => {
    await expect(invokeTool(courseCatalogSearchTool, { query: "" }, tenant)).rejects.toThrow();
  });
});
