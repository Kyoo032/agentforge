import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { jsonError } from "./http";

describe("jsonError", () => {
  it("does not echo API keys in internal errors", async () => {
    const response = jsonError(new Error("upstream 401 Authorization: Bearer sk-secret-key-value"));
    const body = (await response.json()) as { error: { message: string } };
    expect(response.status).toBe(500);
    expect(body.error.message).not.toContain("sk-secret-key-value");
    expect(body.error.message).toContain("[REDACTED]");
  });

  it("redacts keys on ApiError bodies too", async () => {
    const response = jsonError(new ApiError("probe_failed", "bad key sk-secret-key-value", 502));
    const body = (await response.json()) as { error: { message: string } };
    expect(response.status).toBe(502);
    expect(body.error.message).not.toContain("sk-secret-key-value");
  });

  it("maps tenant_required to a local-owner error, not sign-in", async () => {
    const response = jsonError(new Error("tenant_required"));
    const body = (await response.json()) as { error: { message: string } };
    expect(response.status).toBe(401);
    expect(body.error.message.toLowerCase()).not.toContain("sign in");
  });
});
