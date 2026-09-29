import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { DEFAULT_CHAT_SLUG } from "./default-chat";
import {
  FALLBACK_PRODUCT_MODES,
  FIRST_RUN_MODES,
  HOSTED_FIRST_DESK_MODES,
  LEGACY_PRODUCT_MODES,
  PRODUCT_MODE_IDS,
  WORK_PRODUCT_MODES,
  firstDeskModes,
  firstVisibleHref,
  isParkedAgentPath,
  isProductMode,
  productModeHref,
  productModeLabel,
  redirectIfHiddenMode,
  requireProductModes,
  resolveProductModes,
  resolveWorkspaceModes,
  sanitizeProductModes,
} from "./product-modes";

describe("sanitizeProductModes", () => {
  it("returns undefined for missing values (legacy)", () => {
    expect(sanitizeProductModes(undefined)).toBeUndefined();
    expect(sanitizeProductModes(null)).toBeUndefined();
  });

  it("keeps catalog order and drops unknown ids including agents", () => {
    expect(sanitizeProductModes(["videos", "chat", "nope", "agents", "chat"])).toEqual(["chat", "videos"]);
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

describe("resolveWorkspaceModes", () => {
  it("falls back to all work modes when stored is missing or empty", () => {
    expect(resolveWorkspaceModes(undefined)).toEqual(WORK_PRODUCT_MODES);
    expect(resolveWorkspaceModes(null)).toEqual(WORK_PRODUCT_MODES);
    expect(resolveWorkspaceModes([])).toEqual(WORK_PRODUCT_MODES);
  });

  it("keeps catalog order and always includes chat", () => {
    expect(resolveWorkspaceModes(["research", "documents"])).toEqual(["chat", "documents", "research"]);
    expect(resolveWorkspaceModes(["chat", "documents", "research", "presentations"])).toEqual([
      "chat",
      "documents",
      "research",
      "presentations",
    ]);
  });

  it("maps Legal and Marketing presets", () => {
    expect(resolveWorkspaceModes(["chat", "documents", "research", "presentations"])).toEqual([
      "chat",
      "documents",
      "research",
      "presentations",
    ]);
    expect(resolveWorkspaceModes(["chat", "documents", "images", "videos", "presentations"])).toEqual([
      "chat",
      "documents",
      "images",
      "videos",
      "presentations",
    ]);
  });
});

describe("the first desk of a fresh install (owner decision 2026-09-29)", () => {
  // Written out, never derived from the catalog or from the constant under test: a new catalog
  // entry, or an edit to FIRST_RUN_MODES, must make this fail rather than ride along.
  const EXPECTED_PERSONAL = ["chat", "research", "images", "videos", "presentations"];

  it("is Chat plus Research, Images, Videos and Presentation, in catalog order, and nothing else", () => {
    expect([...FIRST_RUN_MODES]).toEqual(EXPECTED_PERSONAL);
    expect(FIRST_RUN_MODES.every((id) => isProductMode(id))).toBe(true);
    const order = FIRST_RUN_MODES.map((id) => PRODUCT_MODE_IDS.indexOf(id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("is what the rail shows: resolving the stored list changes nothing", () => {
    expect(resolveWorkspaceModes([...FIRST_RUN_MODES])).toEqual(EXPECTED_PERSONAL);
  });

  it("is frozen, so no caller can widen it in place", () => {
    expect(Object.isFrozen(FIRST_RUN_MODES)).toBe(true);
    expect(Object.isFrozen(HOSTED_FIRST_DESK_MODES)).toBe(true);
  });

  it("firstDeskModes answers Personal by default and every mode for the hosted app, as copies", () => {
    expect(firstDeskModes(false)).toEqual(EXPECTED_PERSONAL);
    expect(firstDeskModes(true)).toEqual(PRODUCT_MODE_IDS);
    const a = firstDeskModes(false);
    a.push("finance");
    expect(firstDeskModes(false)).toEqual(EXPECTED_PERSONAL);
  });

  it("leaves the read fallback alone: a desk row with no stored modes still reads as every mode", () => {
    expect(resolveWorkspaceModes(null)).toEqual(PRODUCT_MODE_IDS);
    expect(FALLBACK_PRODUCT_MODES).toEqual(PRODUCT_MODE_IDS);
  });
});

describe("resolveProductModes", () => {
  it("falls back to all work modes when there are no custom agents", () => {
    expect(resolveProductModes([])).toEqual(FALLBACK_PRODUCT_MODES);
    expect(
      resolveProductModes([{ slug: DEFAULT_CHAT_SLUG, productModes: ["images", "videos"] }]),
    ).toEqual(FALLBACK_PRODUCT_MODES);
  });

  it("maps a writing-and-research desk", () => {
    expect(
      resolveProductModes([
        {
          slug: "notes-desk",
          productModes: ["chat", "documents", "research", "images", "presentations"],
        },
      ]),
    ).toEqual(["chat", "documents", "research", "images", "presentations"]);
  });

  it("maps a Marketing-like agent", () => {
    expect(
      resolveProductModes([
        { slug: "campaign-desk", productModes: ["chat", "documents", "images", "videos", "presentations"] },
      ]),
    ).toEqual(["chat", "documents", "images", "videos", "presentations"]);
  });

  it("maps a Legal-like agent", () => {
    expect(
      resolveProductModes([
        { slug: "memo-desk", productModes: ["chat", "documents", "research", "presentations"] },
      ]),
    ).toEqual(["chat", "documents", "research", "presentations"]);
  });

  it("unions two custom agents in catalog order", () => {
    expect(
      resolveProductModes([
        { slug: "notes-desk", productModes: ["chat", "documents", "presentations"] },
        { slug: "campaign-desk", productModes: ["images", "videos"] },
      ]),
    ).toEqual(["chat", "documents", "images", "videos", "presentations"]);
  });

  it("treats missing productModes as the original generate set", () => {
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
        { slug: "memo-desk", productModes: ["documents"] },
      ]),
    ).toEqual(["documents"]);
  });
});

describe("firstVisibleHref and hidden redirects", () => {
  it("prefers Chat when it is visible", () => {
    expect(firstVisibleHref(["images", "chat"])).toBe("/chat");
    expect(firstVisibleHref(["images", "videos"])).toBe("/images");
  });

  it("redirects parked Agents and Studio plus hidden generate studios", () => {
    const visible = ["chat", "documents"] as const;
    expect(isParkedAgentPath("/studio/new")).toBe(true);
    expect(redirectIfHiddenMode("/videos", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/images", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/research", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/presentations", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/documents", [...visible])).toBeNull();
    expect(redirectIfHiddenMode("/chat", [...visible])).toBeNull();
    expect(redirectIfHiddenMode("/studio/new", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/agents/abc", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/agents", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/settings", [...visible])).toBeNull();
    expect(redirectIfHiddenMode("/workspaces", [...visible])).toBeNull();
    expect(redirectIfHiddenMode("/usage", [...visible])).toBeNull();
    expect(redirectIfHiddenMode("/knowledge", [...visible])).toBeNull();
    expect(redirectIfHiddenMode("/finance", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/data", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/market", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/legal", [...visible])).toBe("/chat");
    expect(redirectIfHiddenMode("/legal", ["chat", "legal"])).toBeNull();
  });

  it("lists Market after Data in catalog order and on the Home desk", () => {
    expect(PRODUCT_MODE_IDS.indexOf("market")).toBe(PRODUCT_MODE_IDS.indexOf("data") + 1);
    expect(WORK_PRODUCT_MODES).toContain("market");
    expect(productModeHref("market")).toBe("/market");
    expect(productModeLabel("market")).toBe("Market");
    expect(resolveWorkspaceModes(["market", "chat"])).toEqual(["chat", "market"]);
  });

  it("lists Legal after Market in catalog order", () => {
    expect(PRODUCT_MODE_IDS.indexOf("legal")).toBe(PRODUCT_MODE_IDS.indexOf("market") + 1);
    expect(WORK_PRODUCT_MODES).toContain("legal");
    expect(productModeHref("legal")).toBe("/legal");
    expect(productModeLabel("legal")).toBe("Legal");
    expect(resolveWorkspaceModes(["legal", "chat"])).toEqual(["chat", "legal"]);
  });

  it("keeps /chat even when that tab is off the rail", () => {
    const visible = ["documents"] as const;
    expect(redirectIfHiddenMode("/chat", [...visible])).toBeNull();
    expect(redirectIfHiddenMode("/agents", [...visible])).toBe("/documents");
    expect(redirectIfHiddenMode("/images", [...visible])).toBe("/documents");
  });
});
