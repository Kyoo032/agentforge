import { describe, expect, it } from "vitest";
import {
  MEDIA_PRICE_ENTRIES,
  costTier,
  estimateImageCost,
  estimateVideoCost,
  findMediaListPrice,
  relativeFactor,
} from "./media-pricing";

describe("media price table", () => {
  it("prices every entry at its own default tier", () => {
    for (const entry of MEDIA_PRICE_ENTRIES) {
      const value = entry.price.tiers[entry.price.defaultTier];
      expect(typeof value).toBe("number");
      expect(value as number).toBeGreaterThan(0);
    }
  });

  it("carries a source, an ISO date and a confidence on every entry", () => {
    for (const entry of MEDIA_PRICE_ENTRIES) {
      expect(entry.price.source).toMatch(/^(https?:\/\/|repo:|thirdparty:)/);
      expect(entry.price.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["high", "medium", "low"]).toContain(entry.price.confidence);
      expect(entry.price.origin).toBe("list");
      expect(entry.ids.length).toBeGreaterThan(0);
    }
  });

  it("never points `source` at a vendor page that does not carry the figure", () => {
    for (const entry of MEDIA_PRICE_ENTRIES) {
      const isVendorUrl = /^https?:\/\//.test(entry.price.source);
      // A non-vendor source must say where the number really came from, so the UI can stop
      // calling it a "vendor list price".
      expect(isVendorUrl || (entry.price.citation ?? "").length > 0).toBe(true);
      if (isVendorUrl) {
        expect(entry.price.citation).toBeUndefined();
      }
      expect(entry.price.source).not.toMatch(/github\.com/);
    }
  });

  it("only leaves the vendor blank on an unverified row", () => {
    for (const entry of MEDIA_PRICE_ENTRIES) {
      if (entry.price.vendor.length === 0) {
        expect(entry.price.confidence).toBe("low");
      }
    }
  });

  it("freezes the shared rows so a caller cannot edit them", () => {
    const entry = MEDIA_PRICE_ENTRIES[0];
    expect(Object.isFrozen(MEDIA_PRICE_ENTRIES)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.price)).toBe(true);
    expect(Object.isFrozen(entry.price.tiers)).toBe(true);
  });

  it("publishes no image tier the studio cannot ask for", () => {
    for (const entry of MEDIA_PRICE_ENTRIES) {
      if (entry.price.unit === "image") {
        expect(Object.keys(entry.price.tiers).sort()).toEqual(
          Object.keys(entry.price.tiers)
            .filter((tier) => ["default", "low", "medium", "high"].includes(tier))
            .sort(),
        );
      }
    }
  });

  it("uses the unit that matches the tiers it publishes", () => {
    for (const entry of MEDIA_PRICE_ENTRIES) {
      const resolutionTier = Object.keys(entry.price.tiers).some((tier) => /^(480p|720p|1080p|4k)$/.test(tier));
      if (entry.price.unit === "second") {
        expect(resolutionTier).toBe(true);
      }
    }
  });

  it("never lists two entries under the same canonical id", () => {
    const ids = MEDIA_PRICE_ENTRIES.flatMap((entry) => entry.ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("findMediaListPrice", () => {
  it("finds the exact gateway ids", () => {
    expect(findMediaListPrice("gpt-image-2")?.vendor).toBe("OpenAI");
    expect(findMediaListPrice("nano-banana")?.tiers.default).toBe(0.039);
    expect(findMediaListPrice("seedance-2.0-fast")?.tiers["720p"]).toBe(0.12);
    expect(findMediaListPrice("grok-imagine-video")?.tiers["480p"]).toBe(0.05);
  });

  it("maps gateway aliases through the ordered patterns", () => {
    expect(findMediaListPrice("dreamina-seedance-2-5")?.tiers["720p"]).toBe(0.231);
    expect(findMediaListPrice("doubao-seedance-2-0-fast-260128")?.tiers["480p"]).toBe(0.06);
    expect(findMediaListPrice("dreamina-seedance-2-0-260128")?.tiers["1080p"]).toBe(0.37);
    expect(findMediaListPrice("doubao-seedance-2-0-mini-260615")?.tiers["720p"]).toBe(0.08);
    expect(findMediaListPrice("veo-3.1-fast")?.tiers["720p"]).toBe(0.1);
    expect(findMediaListPrice("veo_3_1-fast")?.tiers["720p"]).toBe(0.1);
    expect(findMediaListPrice("gpt-image-2-count")?.tiers.medium).toBe(0.032);
    expect(findMediaListPrice("gemini-3-pro-image-preview")?.tiers.default).toBe(0.134);
  });

  it("keeps the more specific pattern ahead of the looser one", () => {
    expect(findMediaListPrice("grok-imagine-video-1.5-preview")?.tiers["1080p"]).toBe(0.25);
    expect(findMediaListPrice("grok-imagine-video")?.tiers["1080p"]).toBeUndefined();
    expect(findMediaListPrice("gpt-image-1-mini")?.tiers.medium).toBe(0.008);
    expect(findMediaListPrice("gpt-image-1")?.tiers.medium).toBe(0.042);
    expect(findMediaListPrice("grok-imagine-image-quality")?.tiers.default).toBe(0.05);
    expect(findMediaListPrice("grok-imagine-image-2.0")?.tiers.default).toBe(0.04);
    expect(findMediaListPrice("grok-imagine-image")?.tiers.default).toBe(0.02);
    expect(findMediaListPrice("gemini-3.1-flash-lite-image")?.tiers.default).toBe(0.0336);
  });

  it("returns null for ids with no list price on file", () => {
    expect(findMediaListPrice("seedream-5.0-pro")).toBeNull();
    expect(findMediaListPrice("mj_imagine")).toBeNull();
    expect(findMediaListPrice("mj_video")).toBeNull();
    expect(findMediaListPrice("")).toBeNull();
    expect(findMediaListPrice("   ")).toBeNull();
    expect(findMediaListPrice("something-nobody-priced")).toBeNull();
  });
});

describe("estimateImageCost", () => {
  it("prices one image at the default tier", () => {
    const price = findMediaListPrice("seedream-4.0");
    if (!price) throw new Error("expected a price");
    const estimate = estimateImageCost(price);
    expect(estimate.usd).toBeCloseTo(0.03, 6);
    expect(estimate.perUnitUsd).toBeCloseTo(0.03, 6);
    expect(estimate.unit).toBe("image");
    expect(estimate.tier).toBe("default");
    expect(estimate.approx).toBe(false);
    expect(estimate.origin).toBe("list");
    expect(estimate.vendor).toBe("ByteDance");
  });

  it("multiplies by count", () => {
    const price = findMediaListPrice("nano-banana");
    if (!price) throw new Error("expected a price");
    expect(estimateImageCost(price, { count: 4 }).usd).toBeCloseTo(0.156, 6);
  });

  it("honours an explicit quality tier", () => {
    const price = findMediaListPrice("gpt-image-2");
    if (!price) throw new Error("expected a price");
    expect(estimateImageCost(price, { quality: "low" }).usd).toBeCloseTo(0.008, 6);
    expect(estimateImageCost(price, { quality: "high" }).usd).toBeCloseTo(0.125, 6);
    expect(estimateImageCost(price, { quality: "high" }).approx).toBe(false);
  });

  it("falls back to the nearest tier and flags it approx", () => {
    const price = findMediaListPrice("gpt-image-1-mini");
    if (!price) throw new Error("expected a price");
    const low = estimateImageCost(price, { quality: "low" });
    expect(low.tier).toBe("medium");
    expect(low.approx).toBe(true);
    expect(low.usd).toBeCloseTo(0.008, 6);
  });

  it("scales a token-priced OpenAI row with the canvas aspect", () => {
    const price = findMediaListPrice("gpt-image-2");
    if (!price) throw new Error("expected a price");
    const square = estimateImageCost(price, { aspect: "square" });
    const portrait = estimateImageCost(price, { aspect: "portrait" });
    const landscape = estimateImageCost(price, { aspect: "landscape" });
    expect(square.usd).toBeCloseTo(0.032, 6);
    expect(square.approx).toBe(false);
    // Portrait is exactly 1.5x square in OpenAI's own token table, so it stays exact.
    expect(portrait.usd).toBeCloseTo(0.048, 6);
    expect(portrait.approx).toBe(false);
    // Landscape drifts between quality tiers (1.471 / 1.485 / 1.492), so it is flagged approximate.
    expect(landscape.usd).toBeCloseTo(0.04736, 6);
    expect(landscape.approx).toBe(true);
  });

  it("leaves a per-image vendor price alone whatever the aspect", () => {
    const price = findMediaListPrice("nano-banana");
    if (!price) throw new Error("expected a price");
    for (const aspect of ["square", "portrait", "landscape"] as const) {
      const estimate = estimateImageCost(price, { aspect });
      expect(estimate.usd).toBeCloseTo(0.039, 6);
      expect(estimate.approx).toBe(false);
    }
  });

  it("does not call a flat single-price row approximate just because a quality was asked for", () => {
    const price = findMediaListPrice("nano-banana");
    if (!price) throw new Error("expected a price");
    const estimate = estimateImageCost(price, { quality: "high" });
    expect(estimate.tier).toBe("default");
    expect(estimate.approx).toBe(false);
    expect(estimate.usd).toBeCloseTo(0.039, 6);
  });

  it("carries the citation of a third-party figure into the estimate", () => {
    const price = findMediaListPrice("seedream-4.0");
    if (!price) throw new Error("expected a price");
    expect(estimateImageCost(price).citation).toMatch(/reseller/);
    const vendorPage = findMediaListPrice("nano-banana");
    if (!vendorPage) throw new Error("expected a price");
    expect(estimateImageCost(vendorPage).citation).toBeUndefined();
  });

  it("never returns a negative or fractional count", () => {
    const price = findMediaListPrice("nano-banana");
    if (!price) throw new Error("expected a price");
    expect(estimateImageCost(price, { count: 0 }).usd).toBeCloseTo(0.039, 6);
    expect(estimateImageCost(price, { count: -3 }).usd).toBeCloseTo(0.039, 6);
  });
});

describe("estimateVideoCost", () => {
  it("multiplies the per-second price by the clip length", () => {
    const price = findMediaListPrice("seedance-2.0-fast");
    if (!price) throw new Error("expected a price");
    const estimate = estimateVideoCost(price, { seconds: 5, resolution: "720p" });
    expect(estimate.perUnitUsd).toBeCloseTo(0.12, 6);
    expect(estimate.usd).toBeCloseTo(0.6, 6);
    expect(estimate.unit).toBe("second");
    expect(estimate.tier).toBe("720p");
    expect(estimate.approx).toBe(false);
  });

  it("uses the default tier when no resolution is given", () => {
    const price = findMediaListPrice("grok-imagine-video");
    if (!price) throw new Error("expected a price");
    const estimate = estimateVideoCost(price, { seconds: 8 });
    expect(estimate.tier).toBe("720p");
    expect(estimate.usd).toBeCloseTo(0.56, 6);
  });

  it("falls back to the nearest lower tier and flags approx", () => {
    const price = findMediaListPrice("seedance-2.5");
    if (!price) throw new Error("expected a price");
    const estimate = estimateVideoCost(price, { seconds: 5, resolution: "1080p" });
    expect(estimate.tier).toBe("720p");
    expect(estimate.approx).toBe(true);
    expect(estimate.usd).toBeCloseTo(1.155, 6);
  });

  it("falls back upward when no lower tier exists", () => {
    const price = findMediaListPrice("happyhorse-1.1-i2v");
    if (!price) throw new Error("expected a price");
    const estimate = estimateVideoCost(price, { seconds: 5, resolution: "480p" });
    expect(estimate.tier).toBe("720p");
    expect(estimate.approx).toBe(true);
  });

  it("keeps an unverified row free of any vendor claim", () => {
    const price = findMediaListPrice("omni-fast");
    if (!price) throw new Error("expected a price");
    expect(price.vendor).toBe("");
    expect(price.confidence).toBe("low");
    expect(estimateVideoCost(price, { seconds: 5 }).vendor).toBe("");
  });

  it("clamps a missing or silly clip length to one second", () => {
    const price = findMediaListPrice("veo_3_1-fast");
    if (!price) throw new Error("expected a price");
    expect(estimateVideoCost(price, { seconds: Number.NaN }).usd).toBeCloseTo(0.1, 6);
    expect(estimateVideoCost(price, { seconds: -4 }).usd).toBeCloseTo(0.1, 6);
  });
});

describe("costTier", () => {
  const set = [0.02, 0.03, 0.08, 0.5];

  it("names the minimum the cheapest", () => {
    expect(costTier(0.02, set)).toBe("cheapest");
  });

  it("calls anything within 1.5x of the minimum cheap", () => {
    expect(costTier(0.03, set)).toBe("cheap");
  });

  it("calls anything within 4x of the minimum mid", () => {
    expect(costTier(0.08, set)).toBe("mid");
  });

  it("calls everything above 4x premium", () => {
    expect(costTier(0.5, set)).toBe("premium");
  });

  it("stays mid when there is nothing to compare against", () => {
    expect(costTier(0.5, [])).toBe("mid");
    expect(costTier(0, set)).toBe("mid");
  });
});

describe("relativeFactor", () => {
  it("rounds the gap for copy", () => {
    expect(relativeFactor(0.032, 0.125)).toBe(3.9);
    expect(relativeFactor(0.125, 0.032)).toBe(3.9);
    expect(relativeFactor(0.02, 0.5)).toBe(25);
    expect(relativeFactor(0.03, 0.03)).toBe(1);
  });

  it("returns 0 when either side has no price", () => {
    expect(relativeFactor(0, 0.1)).toBe(0);
    expect(relativeFactor(0.1, 0)).toBe(0);
    expect(relativeFactor(Number.NaN, 0.1)).toBe(0);
  });
});
