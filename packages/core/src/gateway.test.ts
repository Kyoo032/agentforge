import { describe, expect, it } from "vitest";
import { GATEWAY_BASE_URL, GATEWAY_HOST, GATEWAY_NAME, formatUsd, gatewayOriginFromBaseUrl, isGatewayBaseUrl, quotaToUsd } from "./gateway";

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
});
