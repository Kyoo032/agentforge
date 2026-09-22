/**
 * The product is called DPSBuddy, everywhere, and there is exactly one place that says so.
 *
 * Owner ruling, 2026-09-21: the product NAME in text is DPSBuddy everywhere, and the LOGO IMAGE
 * stays the chevron lockup at `public/brand/logo.png`. The names in `FORBIDDEN_PRODUCT_NAMES` below
 * are the ones that ruling retired, and this file is the only place they may appear.
 *
 * The web used to carry a `WEB_PRODUCT_NAME` of its own, which is how the two drifted:
 * the shell said one thing, `/api/v1/ping` said another, and `mergePingBrand` spent a branch
 * keeping them apart.
 *
 * So this file locks two things down:
 *
 *   1. the default name the renderer shows is `DEFAULT_PRODUCT_NAME` from `@agentforge/core`,
 *      the same constant the host answers `productName` with -- one source, not two that agree;
 *   2. none of the strings that used to be the name survive in anything shipped to a browser --
 *      the locale catalogs and the HTML shell.
 *
 * A guard and not a comment, because "we renamed it" is a claim and a passing scan is evidence.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_PRODUCT_NAME } from "@agentforge/core/gateway";
import { DEFAULT_PRODUCT_BRAND, WEB_LOGO_SRC } from "./product-brand";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(appDir, "locales");

/** Every name the product has ever been called that is not its name. Matched case-insensitively. */
const FORBIDDEN_PRODUCT_NAMES = Object.freeze(["DPS Cloud", "DPSCloud", "Toko Token AI"]);

const PRODUCT_NAME = "DPSBuddy";

function shippedFiles(): Array<{ path: string; text: string }> {
  const files = [{ path: "index.html", text: readFileSync(join(appDir, "index.html"), "utf8") }];
  for (const locale of readdirSync(localesDir)) {
    for (const name of readdirSync(join(localesDir, locale))) {
      files.push({
        path: `locales/${locale}/${name}`,
        text: readFileSync(join(localesDir, locale, name), "utf8"),
      });
    }
  }
  return files;
}

describe("the product name", () => {
  it("is DPSBuddy, and comes from the one constant the host also answers with", () => {
    expect(DEFAULT_PRODUCT_NAME).toBe(PRODUCT_NAME);
    expect(DEFAULT_PRODUCT_BRAND.productName).toBe(DEFAULT_PRODUCT_NAME);
  });

  it("keeps the chevron logo image, which is the mark and not the name", () => {
    expect(WEB_LOGO_SRC).toBe("/brand/logo.png");
  });

  it("names the product in the HTML shell the browser gets before any script runs", () => {
    const html = readFileSync(join(appDir, "index.html"), "utf8");
    expect(html).toContain(`<title>${PRODUCT_NAME}</title>`);
  });

  it("is the only product name in anything shipped to a browser", () => {
    const offenders: string[] = [];
    for (const file of shippedFiles()) {
      for (const forbidden of FORBIDDEN_PRODUCT_NAMES) {
        // Line by line so a failure names the line, not the file.
        file.text.split("\n").forEach((line, index) => {
          if (line.toLowerCase().includes(forbidden.toLowerCase())) {
            offenders.push(`${file.path}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
