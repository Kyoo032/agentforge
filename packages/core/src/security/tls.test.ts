import { describe, expect, it } from "vitest";
import { isLoopbackHost, assertAllowedEndpointUrl } from "./tls";
import { ApiError } from "../errors";

describe("isLoopbackHost", () => {
  it("recognizes standard loopback names and addresses", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
  });

  it("rejects non-loopback hosts", () => {
    expect(isLoopbackHost("api.tokotokenai.com")).toBe(false);
    expect(isLoopbackHost("api.openai.com")).toBe(false);
    expect(isLoopbackHost("openrouter.ai")).toBe(false);
    expect(isLoopbackHost("192.168.1.1")).toBe(false);
    expect(isLoopbackHost("127.0.0.2")).toBe(false);
  });
});

describe("assertAllowedEndpointUrl", () => {
  it("accepts https for any host", () => {
    expect(() => assertAllowedEndpointUrl("https://api.tokotokenai.com/v1")).not.toThrow();
    expect(() => assertAllowedEndpointUrl("https://openrouter.ai/api/v1")).not.toThrow();
    expect(() => assertAllowedEndpointUrl("https://api.openai.com/v1")).not.toThrow();
  });

  it("accepts http for loopback hosts", () => {
    expect(() => assertAllowedEndpointUrl("http://localhost:11434/v1")).not.toThrow();
    expect(() => assertAllowedEndpointUrl("http://127.0.0.1:11434/v1")).not.toThrow();
    expect(() => assertAllowedEndpointUrl("http://[::1]:8080/v1")).not.toThrow();
  });

  it("rejects http for remote hosts", () => {
    expect(() => assertAllowedEndpointUrl("http://api.tokotokenai.com/v1")).toThrow(ApiError);
    expect(() => assertAllowedEndpointUrl("http://openrouter.ai/api/v1")).toThrow(ApiError);
    expect(() => assertAllowedEndpointUrl("http://api.openai.com/v1")).toThrow(ApiError);
  });

  it("throws ApiError with code invalid_endpoint for remote http", () => {
    try {
      assertAllowedEndpointUrl("http://api.tokotokenai.com/v1");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe("invalid_endpoint");
      expect((e as ApiError).status).toBe(400);
    }
  });

  it("rejects non-http/https protocols", () => {
    expect(() => assertAllowedEndpointUrl("ftp://example.com/v1")).toThrow(ApiError);
    expect(() => assertAllowedEndpointUrl("ws://localhost/v1")).toThrow(ApiError);
    expect(() => assertAllowedEndpointUrl("https://sk-secret@api.example.com/v1")).toThrow(ApiError);
  });

  it("rejects invalid URLs", () => {
    expect(() => assertAllowedEndpointUrl("not-a-url")).toThrow(ApiError);
    expect(() => assertAllowedEndpointUrl("")).toThrow(ApiError);
  });
});
