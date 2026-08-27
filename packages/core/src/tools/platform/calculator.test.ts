import { describe, expect, it } from "vitest";
import type { TenantContext } from "../../tenancy/types";
import { invokeTool } from "../define-tool";
import { calculatorTool } from "./calculator";

const tenant: TenantContext = {
  organizationId: "org-1",
  workspaceId: "ws-1",
  userId: "user-1",
  role: "member",
};

describe("calculatorTool", () => {
  it("evaluates arithmetic", async () => {
    await expect(invokeTool(calculatorTool, { expression: "2 + 3 * 4" }, tenant)).resolves.toEqual({
      result: 14,
    });
  });

  it("rejects unsafe expressions", async () => {
    await expect(invokeTool(calculatorTool, { expression: "os.exit()" }, tenant)).rejects.toThrow();
  });
});
