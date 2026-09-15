import { findMediaListPrice } from "@agentforge/core/media-pricing";
import { beforeEach, describe, expect, it } from "vitest";
import { freezeLocale, resetLocaleForTests } from "./i18n";
import {
  imageEstimateView,
  mediaPriceHint,
  mediaPriceHints,
  videoEstimateView,
  type PricedModel,
} from "./media-estimate";

function priced(id: string, label?: string): PricedModel {
  return { id, label: label ?? id, price: findMediaListPrice(id) };
}

const IMAGE_MODELS: PricedModel[] = [
  priced("seedream-4.0"),
  priced("gpt-image-2", "gpt-image-2.5"),
  priced("nano-banana"),
  priced("gpt-image-1"),
  { id: "seedream-5.0-pro", label: "seedream-5.0-pro", price: null },
];

const VIDEO_MODELS: PricedModel[] = [
  priced("grok-imagine-video"),
  priced("seedance-2.0-fast"),
  priced("seedance-2.5"),
  priced("omni-fast"),
  { id: "mj_video", label: "mj_video", price: null },
];

beforeEach(() => {
  resetLocaleForTests();
  freezeLocale("en");
});

describe("imageEstimateView", () => {
  it("prices the selected model at its default tier with the source and a tier word", () => {
    const view = imageEstimateView({ model: "seedream-4.0", models: IMAGE_MODELS, aspect: "square" });
    expect(view.unknown).toBe(false);
    expect(view.unverified).toBe(false);
    expect(view.line).toContain("≈ $0.03 per image");
    // seedream's figure comes from a reseller listing, so it must not be called a vendor list price.
    expect(view.line).toContain("ByteDance price, third-party figure, checked Sep 15, 2026");
    expect(view.line).not.toContain("list price");
    expect(view.line).toContain("cheapest");
    expect(view.tier).toBe("cheapest");
  });

  it("says a token-derived OpenAI price is a medium-quality image", () => {
    const view = imageEstimateView({ model: "gpt-image-2", models: IMAGE_MODELS });
    expect(view.line).toContain("at medium quality");
    expect(view.line).toContain("OpenAI list price");
  });

  it("names the cheapest model instead of comparing it to itself", () => {
    expect(imageEstimateView({ model: "seedream-4.0", models: IMAGE_MODELS }).compare).toBe(
      "The cheapest image model here",
    );
  });

  it("compares a mid model against the most expensive listed one", () => {
    const view = imageEstimateView({ model: "nano-banana", models: IMAGE_MODELS });
    expect(view.compare).toBe("About 1.1× cheaper than gpt-image-1");
  });

  it("scales a token-priced row with the aspect and softens the inexact one", () => {
    const square = imageEstimateView({ model: "gpt-image-2", models: IMAGE_MODELS, aspect: "square" });
    const portrait = imageEstimateView({ model: "gpt-image-2", models: IMAGE_MODELS, aspect: "portrait" });
    const landscape = imageEstimateView({ model: "gpt-image-2", models: IMAGE_MODELS, aspect: "landscape" });
    expect(square.line).toContain("≈ $0.03 per image");
    expect(portrait.line).toContain("≈ $0.05 per image");
    expect(landscape.line.startsWith("~")).toBe(true);
    expect(landscape.line).not.toContain("≈");
  });

  it("leaves a per-image vendor price unchanged across aspects", () => {
    for (const aspect of ["square", "portrait", "landscape"] as const) {
      const view = imageEstimateView({ model: "nano-banana", models: IMAGE_MODELS, aspect });
      expect(view.line).toContain("≈ $0.04 per image");
    }
  });

  it("compares the most expensive model against the cheapest", () => {
    const view = imageEstimateView({ model: "gpt-image-1", models: IMAGE_MODELS });
    expect(view.compare).toBe("About 1.4× more than seedream-4.0");
    expect(view.tier).toBe("cheap");
  });

  it("reports an unpriced model plainly", () => {
    const view = imageEstimateView({ model: "seedream-5.0-pro", models: IMAGE_MODELS });
    expect(view).toMatchObject({ unknown: true, unverified: false, tier: null, compare: null });
    expect(view.line).toBe("No list price on file for this model");
  });

  it("softens a quality fallback with ~", () => {
    const models: PricedModel[] = [priced("gpt-image-1-mini"), priced("nano-banana")];
    const view = imageEstimateView({ model: "gpt-image-1-mini", models, quality: "high" });
    expect(view.line.startsWith("~")).toBe(true);
    expect(view.line).not.toContain("≈");
    expect(view.line).toContain("at medium quality");
  });

  it("writes Indonesian when the desk locale is id", () => {
    resetLocaleForTests();
    freezeLocale("id");
    const view = imageEstimateView({ model: "seedream-4.0", models: IMAGE_MODELS });
    expect(view.line).toContain("≈ $0.03 per gambar");
    expect(view.line).toContain("Harga ByteDance, angka pihak ketiga, dicek 15 Sep 2026");
    expect(view.line).toContain("termurah");
    expect(view.compare).toBe("Model gambar termurah di sini");
  });
});

describe("videoEstimateView", () => {
  it("multiplies the per-second price by the clip length", () => {
    const view = videoEstimateView({
      model: "seedance-2.0-fast",
      models: VIDEO_MODELS,
      seconds: 5,
      resolution: "720p",
    });
    expect(view.line).toContain("≈ $0.60 for 5 s at 720p");
    expect(view.line).toContain("$0.12/s");
    expect(view.line).toContain("ByteDance price, third-party figure, checked Sep 15, 2026");
    expect(view.unknown).toBe(false);
  });

  it("recomputes when the resolution changes", () => {
    const at480 = videoEstimateView({
      model: "seedance-2.0-fast",
      models: VIDEO_MODELS,
      seconds: 5,
      resolution: "480p",
    });
    expect(at480.line).toContain("≈ $0.30 for 5 s at 480p");
    expect(at480.line).toContain("$0.06/s");
  });

  it("recomputes when the clip length changes", () => {
    const at10 = videoEstimateView({
      model: "seedance-2.0-fast",
      models: VIDEO_MODELS,
      seconds: 10,
      resolution: "720p",
    });
    expect(at10.line).toContain("≈ $1.20 for 10 s at 720p");
  });

  it("falls back to the nearest published tier and softens the number", () => {
    const view = videoEstimateView({ model: "seedance-2.5", models: VIDEO_MODELS, seconds: 5, resolution: "1080p" });
    expect(view.line.startsWith("~")).toBe(true);
    expect(view.line).not.toContain("≈");
    expect(view.line).toContain("at 720p");
  });

  it("softens the comparison when the peer it names was itself approximated", () => {
    // At 1080p seedance-2.0-fast has a published rate but grok-imagine-video and seedance-2.5 do not,
    // so the sentence rests on a fallback tier and must not read as fact.
    const view = videoEstimateView({
      model: "seedance-2.0-fast",
      models: VIDEO_MODELS,
      seconds: 5,
      resolution: "1080p",
    });
    expect(view.line.startsWith("≈")).toBe(true);
    expect(view.compare?.startsWith("~")).toBe(true);
  });

  it("marks a low-confidence row unverified", () => {
    const view = videoEstimateView({ model: "omni-fast", models: VIDEO_MODELS, seconds: 5, resolution: "720p" });
    expect(view.unverified).toBe(true);
    expect(view.line.startsWith("~")).toBe(true);
    expect(view.line).toContain("(unverified)");
    // A hypothesis must never be dressed up as a vendor list price.
    expect(view.line).toContain("Unverified estimate, no vendor page");
    expect(view.line).not.toContain("list price");
    expect(view.line).not.toContain("Google");
  });

  it("reports an unpriced model plainly", () => {
    const view = videoEstimateView({ model: "mj_video", models: VIDEO_MODELS, seconds: 5 });
    expect(view.unknown).toBe(true);
    expect(view.line).toBe("No list price on file for this model");
  });

  it("writes Indonesian when the desk locale is id", () => {
    resetLocaleForTests();
    freezeLocale("id");
    const view = videoEstimateView({
      model: "seedance-2.0-fast",
      models: VIDEO_MODELS,
      seconds: 5,
      resolution: "720p",
    });
    expect(view.line).toContain("≈ $0.60 untuk 5 dtk pada 720p");
    expect(view.line).toContain("$0.12/dtk");
    expect(view.line).toContain("Harga ByteDance, angka pihak ketiga, dicek 15 Sep 2026");
  });

  it("formats the comparison factor with the Indonesian number format", () => {
    resetLocaleForTests();
    freezeLocale("id");
    const view = videoEstimateView({
      model: "seedance-2.0-fast",
      models: VIDEO_MODELS,
      seconds: 5,
      resolution: "720p",
    });
    expect(view.compare).toBe("Sekitar 1,9× lebih murah dari seedance-2.5");
  });
});

describe("picker hints", () => {
  it("tags image rows per image and video rows per second", () => {
    expect(mediaPriceHint("images", findMediaListPrice("seedream-4.0"))).toBe("$0.03/img");
    expect(mediaPriceHint("videos", findMediaListPrice("seedance-2.0-fast"))).toBe("$0.12/s");
  });

  it("skips rows with no price", () => {
    expect(mediaPriceHint("images", null)).toBeNull();
    const hints = mediaPriceHints("videos", VIDEO_MODELS);
    expect(hints["seedance-2.0-fast"]).toBe("$0.12/s");
    expect(hints.mj_video).toBeUndefined();
  });

  it("uses Indonesian units", () => {
    resetLocaleForTests();
    freezeLocale("id");
    expect(mediaPriceHint("images", findMediaListPrice("seedream-4.0"))).toBe("$0.03/gbr");
    expect(mediaPriceHint("videos", findMediaListPrice("seedance-2.0-fast"))).toBe("$0.12/dtk");
  });
});
