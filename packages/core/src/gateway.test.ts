import { describe, expect, it } from "vitest";
import { GATEWAY_BASE_URL, GATEWAY_HOST, GATEWAY_NAME, formatUsd, gatewayOriginFromBaseUrl, isGatewayBaseUrl, quotaToUsd, resolvedGatewayBaseUrl, resolvedGatewayName, resolvedProductName } from "./gateway";

describe("gateway", () => {
  it("is the Toko Token OpenAI-compatible host", () => {
    expect(GATEWAY_NAME).toBe("Toko Token");
    expect(GATEWAY_HOST).toBe("api.tokotokenai.com");
    expect(GATEWAY_BASE_URL).toBe("https://api.tokotokenai.com/v1");
    expect(isGatewayBaseUrl()).toBe(true);
    expect(isGatewayBaseUrl("https://api.tokotokenai.com")).toBe(true);
    expect(isGatewayBaseUrl("https://api.openai.com/v1")).toBe(false);
    expect(gatewayOriginFromBaseUrl("https://api.tokotokenai.com/v1")).toBe("https://api.tokotokenai.com");
    expect(quotaToUsd(500_000)).toBe(1);
    expect(formatUsd(1.5)).toBe("$1.50");
  });

  it("reads packaged brand env for Kemenkeu AI / AIHub Metranet", () => {
    const previousUrl = process.env.AGENTFORGE_GATEWAY_URL;
    const previousName = process.env.AGENTFORGE_GATEWAY_NAME;
    const previousProduct = process.env.AGENTFORGE_PRODUCT_NAME;
    process.env.AGENTFORGE_GATEWAY_URL = "https://aihub.metranet.co.id/v1";
    process.env.AGENTFORGE_GATEWAY_NAME = "AIHub";
    process.env.AGENTFORGE_PRODUCT_NAME = "Kemenkeu AI";
    try {
      expect(resolvedGatewayBaseUrl()).toBe("https://aihub.metranet.co.id/v1");
      expect(resolvedGatewayName()).toBe("AIHub");
      expect(resolvedProductName()).toBe("Kemenkeu AI");
      expect(isGatewayBaseUrl("https://aihub.metranet.co.id/v1")).toBe(true);
      expect(isGatewayBaseUrl("https://aihub.metranet.co.id")).toBe(true);
    } finally {
      if (previousUrl === undefined) {
        delete process.env.AGENTFORGE_GATEWAY_URL;
      } else {
        process.env.AGENTFORGE_GATEWAY_URL = previousUrl;
      }
      if (previousName === undefined) {
        delete process.env.AGENTFORGE_GATEWAY_NAME;
      } else {
        process.env.AGENTFORGE_GATEWAY_NAME = previousName;
      }
      if (previousProduct === undefined) {
        delete process.env.AGENTFORGE_PRODUCT_NAME;
      } else {
        process.env.AGENTFORGE_PRODUCT_NAME = previousProduct;
      }
    }
  });
});
