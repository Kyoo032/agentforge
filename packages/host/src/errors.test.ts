import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { jsonError } from "./errors";

describe("jsonError", () => {
  it("does not echo API keys in internal errors", () => {
    const result = jsonError(new Error("upstream 401 Authorization: Bearer sk-secret-key-value"));
    const body = result.body as { error: { message: string } };
    expect(result.status).toBe(500);
    expect(body.error.message).not.toContain("sk-secret-key-value");
    expect(body.error.message).toContain("[REDACTED]");
  });

  it("redacts keys on ApiError bodies too", () => {
    const result = jsonError(new ApiError("probe_failed", "bad key sk-secret-key-value", 502));
    const body = result.body as { error: { message: string } };
    expect(result.status).toBe(502);
    expect(body.error.message).not.toContain("sk-secret-key-value");
  });

  it("maps tenant_required to a local-owner error, not sign-in", () => {
    const result = jsonError(new Error("tenant_required"));
    const body = result.body as { error: { message: string } };
    expect(result.status).toBe(401);
    expect(body.error.message.toLowerCase()).not.toContain("sign in");
  });
});
