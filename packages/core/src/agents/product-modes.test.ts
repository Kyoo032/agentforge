import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { DEFAULT_CHAT_SLUG } from "./default-chat";
import {
  FALLBACK_PRODUCT_MODES,
  LEGACY_PRODUCT_MODES,
  firstVisibleHref,
  redirectIfHiddenMode,
  requireProductModes,
  resolveProductModes,
  sanitizeProductModes,
} from "./product-modes";

describe("sanitizeProductModes", () => {
  it("returns undefined for missing values (legacy)", () => {
    expect(sanitizeProductModes(undefined)).toBeUndefined();
    expect(sanitizeProductModes(null)).toBeUndefined();
  });

  it("keeps catalog order and drops unknown ids", () => {
    expect(sanitizeProductModes(["videos", "chat", "nope", "chat"])).toEqual(["chat", "videos"]);
  });

  it("preserves an explicit empty list", () => {
    expect(sanitizeProductModes([])).toEqual([]);
  });
});

describe("requireProductModes", () => {
  it("defaults missing input to chat", () => {
    expect(requireProductModes(undefined)).toEqual(["chat"]);
  });

  it("rejects an empty selection", () => {
    try {
      requireProductModes([]);
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("invalid_request");
    }
  });
});

describe("resolveProductModes", () => {
  it("falls back to Chat + Agents when there are no custom agents", () => {
    expect(resolveProductModes([])).toEqual(FALLBACK_PRODUCT_MODES);
    expect(
      resolveProductModes([{ slug: DEFAULT_CHAT_SLUG, productModes: ["images", "videos"] }]),
    ).toEqual(FALLBACK_PRODUCT_MODES);
  });

  it("maps a Students-like agent", () => {
    expect(
      resolveProductModes([
        {
          slug: "student",
          productModes: ["chat", "documents", "research", "images", "presentations"],
        },
      ]),
    ).toEqual(["chat", "documents", "research", "images", "presentations"]);
  });

  it("maps a Marketing-like agent", () => {
    expect(
      resolveProductModes([
        { slug: "marketing", productModes: ["chat", "documents", "images", "videos", "presentations"] },
      ]),
    ).toEqual(["chat", "documents", "images", "videos", "presentations"]);
  });

  it("maps a Legal-like agent", () => {
    expect(
      resolveProductModes([
        { slug: "legal", productModes: ["chat", "documents", "research", "presentations"] },
      ]),
    ).toEqual(["chat", "documents", "research", "presentations"]);
  });

  it("unions two custom agents in catalog order", () => {
    expect(
      resolveProductModes([
        { slug: "student", productModes: ["chat", "documents", "presentations"] },
        { slug: "marketing", productModes: ["images", "videos"] },
      ]),
    ).toEqual(["chat", "documents", "images", "videos", "presentations"]);
  });

  it("treats missing productModes as the original five", () => {
    expect(resolveProductModes([{ slug: "old-desk" }])).toEqual(LEGACY_PRODUCT_MODES);
    expect(resolveProductModes([{ slug: "old-desk", productModes: null }])).toEqual(LEGACY_PRODUCT_MODES);
  });

  it("falls back when every custom agent unlocks nothing", () => {
    expect(resolveProductModes([{ slug: "blank", productModes: [] }])).toEqual(FALLBACK_PRODUCT_MODES);
  });

  it("ignores the default chat agent even when mixed with custom agents", () => {
    expect(
      resolveProductModes([
        { slug: DEFAULT_CHAT_SLUG, productModes: ["images", "videos"] },
        { slug: "legal", productModes: ["documents"] },
      ]),
    ).toEqual(["documents"]);
  });
});

describe("firstVisibleHref and hidden redirects", () => {
  it("prefers Chat when it is visible", () => {
    expect(firstVisibleHref(["images", "chat"])).toBe("/chat");
    expect(firstVisibleHref(["images", "videos"])).toBe("/images");
  });

  it("redirects hidden generate studios but keeps Build and agent talk", () => {
    const visible = ["chat", "documents"] as const;
    expect(redirectIfHiddenMode("/videos", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/chat", [...visible])).toBeNull();
    expect(redirectIfHiddenMode("/studio/new", [...visible])).toBeNull();
    expect(redirectIfHiddenMode("/agents/abc", [...visible])).toBeNull();
    expect(redirectIfHiddenMode("/agents", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/settings", [...visible])).toBeNull();
  });
});
