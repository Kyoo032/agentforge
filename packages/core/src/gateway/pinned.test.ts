import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { assertPinnedGatewayIntegrity } from "./pinned-integrity";
import {
  isPackagedRuntime,
  PINNED_GATEWAY_BASE_URL,
  PINNED_GATEWAY_BASE_URL_SHA256,
  pinnedGatewayBaseUrl,
  pinnedGatewayOrigin,
} from "./pinned";
import { resolvedGatewayBaseUrl } from "../gateway";

const ENV_KEYS = ["AGENTFORGE_GATEWAY_URL", "AGENTFORGE_PACKAGED", "NODE_ENV"] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const previous: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    previous[key] = process.env[key];
  }
  return previous;
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("pinned gateway endpoint", () => {
  const previous = snapshotEnv();

  afterEach(() => {
    restoreEnv(previous);
  });

  it("hardcodes the Toko Token endpoint", () => {
    expect(PINNED_GATEWAY_BASE_URL).toBe("https://api.tokotokenai.com/v1");
    expect(pinnedGatewayBaseUrl()).toBe(PINNED_GATEWAY_BASE_URL);
    expect(pinnedGatewayOrigin()).toBe("https://api.tokotokenai.com");
  });

  it("matches the recomputed SHA-256 of the pinned string", () => {
    const recomputed = createHash("sha256").update(PINNED_GATEWAY_BASE_URL, "utf8").digest("hex");
    expect(recomputed).toBe(PINNED_GATEWAY_BASE_URL_SHA256);
  });

  it("passes the boot integrity check", () => {
    expect(() => assertPinnedGatewayIntegrity()).not.toThrow();
  });

  it("reads AGENTFORGE_PACKAGED for the packaged flag", () => {
    delete process.env.AGENTFORGE_PACKAGED;
    expect(isPackagedRuntime()).toBe(false);
    process.env.AGENTFORGE_PACKAGED = "1";
    expect(isPackagedRuntime()).toBe(true);
    process.env.AGENTFORGE_PACKAGED = "0";
    expect(isPackagedRuntime()).toBe(false);
  });

  it("honours AGENTFORGE_GATEWAY_URL only in a dev/test runtime", () => {
    process.env.NODE_ENV = "test";
    delete process.env.AGENTFORGE_PACKAGED;
    process.env.AGENTFORGE_GATEWAY_URL = "https://aihub.metranet.co.id/v1/";
    expect(resolvedGatewayBaseUrl()).toBe("https://aihub.metranet.co.id/v1");
  });

  it("ignores AGENTFORGE_GATEWAY_URL when packaged", () => {
    process.env.NODE_ENV = "test";
    process.env.AGENTFORGE_PACKAGED = "1";
    process.env.AGENTFORGE_GATEWAY_URL = "https://evil.example/v1";
    expect(resolvedGatewayBaseUrl()).toBe(PINNED_GATEWAY_BASE_URL);
  });

  it("ignores AGENTFORGE_GATEWAY_URL in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.AGENTFORGE_PACKAGED;
    process.env.AGENTFORGE_GATEWAY_URL = "https://evil.example/v1";
    expect(resolvedGatewayBaseUrl()).toBe(PINNED_GATEWAY_BASE_URL);
  });
});
