import { describe, expect, it } from "vitest";
import { DEFAULT_PRODUCT_BRAND, brandFromUnknown, mergePingBrand } from "./product-brand";

describe("brandFromUnknown", () => {
  it("reads flavor fields from a ping body", () => {
    expect(
      brandFromUnknown(
        {
          ok: true,
          productName: "Kemenkeu AI",
          gatewayName: "AIHub",
          gatewayBaseUrl: "https://aihub.metranet.co.id/v1",
        },
        DEFAULT_PRODUCT_BRAND,
      ),
    ).toMatchObject({
      productName: "Kemenkeu AI",
      gatewayName: "AIHub",
      gatewayBaseUrl: "https://aihub.metranet.co.id/v1",
    });
  });

  it("unwraps an IPC { body } envelope", () => {
    expect(
      brandFromUnknown(
        { body: { productName: "AIHub Metranet", gatewayName: "AIHub" } },
        DEFAULT_PRODUCT_BRAND,
      ).productName,
    ).toBe("AIHub Metranet");
  });
});

describe("mergePingBrand", () => {
  it("does not let a late Agentforge ping clobber a preload flavor", () => {
    const current = {
      productName: "Kemenkeu AI",
      gatewayName: "AIHub",
      gatewayBaseUrl: "https://aihub.metranet.co.id/v1",
      logoSrc: "data:image/png;base64,abc",
    };
    const merged = mergePingBrand(current, {
      productName: "Agentforge",
      gatewayName: "Toko Token",
      gatewayBaseUrl: "https://api.tokotokenai.com/v1",
    });
    expect(merged.productName).toBe("Kemenkeu AI");
    expect(merged.gatewayName).toBe("AIHub");
    expect(merged.logoSrc).toBe("data:image/png;base64,abc");
  });

  it("accepts a flavor ping when preload still has the public default", () => {
    const merged = mergePingBrand(DEFAULT_PRODUCT_BRAND, {
      productName: "AIHub Metranet",
      gatewayName: "AIHub",
      gatewayBaseUrl: "https://aihub.metranet.co.id/v1",
    });
    expect(merged.productName).toBe("AIHub Metranet");
    expect(merged.gatewayName).toBe("AIHub");
  });
});
