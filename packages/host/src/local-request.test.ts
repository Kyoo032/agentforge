import { describe, expect, it } from "vitest";
import {
  isAllowedMutatingApiRequest,
  isLocalRequestHost,
  isLocalRequestUrl,
} from "./local-request";

describe("isLocalRequestHost", () => {
  it("allows localhost and 127.0.0.1", () => {
    expect(isLocalRequestHost("localhost")).toBe(true);
    expect(isLocalRequestHost("127.0.0.1")).toBe(true);
    expect(isLocalRequestHost("LOCALHOST")).toBe(true);
    expect(isLocalRequestHost("::1")).toBe(true);
  });

  it("rejects non-loopback hosts", () => {
    expect(isLocalRequestHost("example.com")).toBe(false);
    expect(isLocalRequestHost("localhost.evil.com")).toBe(false);
    expect(isLocalRequestHost("127.0.0.1.attacker.test")).toBe(false);
    expect(isLocalRequestHost("")).toBe(false);
    expect(isLocalRequestHost(null)).toBe(false);
  });
});

describe("isLocalRequestUrl", () => {
  it("reads the host from Origin and Referer URLs", () => {
    expect(isLocalRequestUrl("http://localhost:3000")).toBe(true);
    expect(isLocalRequestUrl("http://127.0.0.1:3000/settings")).toBe(true);
    expect(isLocalRequestUrl("https://evil.example")).toBe(false);
  });
});

describe("isAllowedMutatingApiRequest", () => {
  it("allows missing Origin as same-machine", () => {
    expect(isAllowedMutatingApiRequest(null)).toBe(true);
    expect(isAllowedMutatingApiRequest(undefined)).toBe(true);
    expect(isAllowedMutatingApiRequest("")).toBe(true);
    expect(isAllowedMutatingApiRequest(null, "https://evil.example/")).toBe(true);
  });

  it("allows local Origin hosts", () => {
    expect(isAllowedMutatingApiRequest("http://localhost:3000")).toBe(true);
    expect(isAllowedMutatingApiRequest("http://127.0.0.1:3000")).toBe(true);
  });

  it("rejects a remote Origin", () => {
    expect(isAllowedMutatingApiRequest("https://evil.example")).toBe(false);
    expect(isAllowedMutatingApiRequest("https://evil.example", "http://localhost:3000")).toBe(false);
  });
});
