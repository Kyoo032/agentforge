import { describe, expect, it } from "vitest";
import { DEFAULT_PRODUCT_BRAND, WEB_LOGO_SRC, brandFromUnknown, mergePingBrand } from "./product-brand";

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
  it("does not let a late DPSBuddy ping clobber a preload flavor", () => {
    const current = {
      productName: "Kemenkeu AI",
      gatewayName: "AIHub",
      gatewayBaseUrl: "https://aihub.metranet.co.id/v1",
      logoSrc: "data:image/png;base64,abc",
    };
    const merged = mergePingBrand(current, {
      productName: "DPSBuddy",
      gatewayName: "Toko Token",
      gatewayBaseUrl: "https://api.tokotokenai.com/v1",
    });
    expect(merged.productName).toBe("Kemenkeu AI");
    expect(merged.gatewayName).toBe("AIHub");
    expect(merged.logoSrc).toBe("data:image/png;base64,abc");
  });

  /**
   * The web preload and the host now say the SAME name, so there is nothing for this merge to
   * arbitrate: the ping confirms DPSBuddy and the mark the web preloaded survives untouched. The
   * old version of this case asserted a second web-only name here, and that second name is exactly
   * what the 2026-09-21 ruling deleted.
   */
  it("leaves the name alone and keeps the web logo when the ping agrees", () => {
    const current = { ...DEFAULT_PRODUCT_BRAND, logoSrc: WEB_LOGO_SRC };
    const merged = mergePingBrand(current, {
      productName: "DPSBuddy",
      gatewayName: "Toko Token",
      gatewayBaseUrl: "https://api.tokotokenai.com/v1",
    });
    expect(merged.productName).toBe(DEFAULT_PRODUCT_BRAND.productName);
    expect(merged.logoSrc).toBe(WEB_LOGO_SRC);
  });

  /** A white-labelled tenant still overrides the default, mark and all. */
  it("takes a tenant flavor from the ping over the web default, keeping the preloaded mark", () => {
    const merged = mergePingBrand(
      { ...DEFAULT_PRODUCT_BRAND, logoSrc: WEB_LOGO_SRC },
      { productName: "AIHub Metranet", gatewayName: "AIHub" },
    );
    expect(merged.productName).toBe("AIHub Metranet");
    expect(merged.logoSrc).toBe(WEB_LOGO_SRC);
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
