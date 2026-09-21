/**
 * Which name the sign-in mail prints.
 *
 * The bug this file exists for: the subject carried a product-name constant of the mail's own while
 * every page of the same sign-in printed a different one. It now asks the tenant first and the
 * portal's own copy catalog second -- the same catalog the pages read, which today says DPSBuddy.
 */
import { describe, expect, it } from "vitest";
import { translator } from "../views/i18n";
import { tenantProductName } from "./product-name";

const TENANT = Object.freeze({ slug: "dpsbuddy", name: "dpsbuddy" });

describe("tenantProductName", () => {
  it("prefers the tenant's branding product name", () => {
    expect(
      tenantProductName({ ...TENANT, name: "Metranet" }, { product_name: "AIHub Metranet" }),
    ).toBe("AIHub Metranet");
  });

  it("falls back to the tenant's display name", () => {
    expect(tenantProductName({ ...TENANT, name: "AIHub Metranet" }, {})).toBe("AIHub Metranet");
    expect(tenantProductName({ ...TENANT, name: "AIHub Metranet" }, null)).toBe("AIHub Metranet");
  });

  /**
   * `src/seed/args.ts` defaults `--tenant-name` to the slug when the operator passes none, and
   * `src/seed/seed.ts` writes that same value into `branding.product_name`. So a name that merely
   * repeats the slug is the seed's placeholder and not a display name anybody chose -- printing it
   * would put a lowercase slug in a subject line under a page that prints a real name.
   */
  it("treats a name that only repeats the slug as no name at all", () => {
    expect(tenantProductName(TENANT, { product_name: "dpsbuddy" })).toBeNull();
    expect(tenantProductName(TENANT, {})).toBeNull();
    expect(tenantProductName({ slug: "dpsbuddy", name: "DPSBuddy" }, {})).toBeNull();
    expect(tenantProductName({ slug: "acme-co", name: "acme co" }, {})).toBeNull();
  });

  it("ignores blank, non-string and absurdly long branding values", () => {
    expect(tenantProductName(TENANT, { product_name: "   " })).toBeNull();
    expect(tenantProductName(TENANT, { product_name: 42 })).toBeNull();
    expect(tenantProductName(TENANT, { product_name: null })).toBeNull();
    expect(tenantProductName(TENANT, { product_name: "x".repeat(200) })).toBeNull();
    expect(tenantProductName({ slug: "s", name: "   " }, null)).toBeNull();
  });

  it("never returns a name of its own, and the fallback is what the pages print", () => {
    expect(tenantProductName(TENANT, null)).toBeNull();
    expect(translator("en")("product")).toBe("DPSBuddy");
    expect(translator("id")("product")).toBe("DPSBuddy");
  });
});
