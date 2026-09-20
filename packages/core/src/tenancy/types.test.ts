import { describe, expect, it } from "vitest";
import { canBuild, requireTenant, type TenantContext } from "./types";

describe("requireTenant", () => {
  it("returns the tenant when present", () => {
    const tenant: TenantContext = {
      tenantId: "local-tenant",
      organizationId: "org-1",
      workspaceId: "ws-1",
      userId: "user-1",
      role: "builder",
    };
    expect(requireTenant(tenant)).toEqual(tenant);
  });

  it("throws when tenant is missing", () => {
    expect(() => requireTenant(null)).toThrow("tenant_required");
    expect(() => requireTenant(undefined)).toThrow("tenant_required");
  });
});

describe("canBuild", () => {
  it("allows owner admin and builder", () => {
    expect(canBuild("owner")).toBe(true);
    expect(canBuild("admin")).toBe(true);
    expect(canBuild("builder")).toBe(true);
    expect(canBuild("member")).toBe(false);
  });
});
