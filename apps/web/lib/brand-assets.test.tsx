/**
 * The logo files the renderer ships, and the one component that draws them.
 *
 * Owner ruling, 2026-09-29: the logo is Rizky's painted Nultron head in a blue rounded-square tile.
 * The brand kit turns that into every file below. What these tests hold is the part a later swap
 * can get wrong without any type error:
 *
 *   - the favicon set is what `index.html` links (an `.ico`, a 32 px PNG, a 180 px apple-touch icon,
 *     and no SVG, because a photographic logo cannot be one);
 *   - the rail mark ships at 24 and 32 px with a 2x file each, so `srcset` picks a file that is not
 *     scaled from the 1024 px logo;
 *   - `public/brand/logo.png` stays small. The packaged desktop reads its own copy of that file at
 *     launch and inlines it as a base64 data URL (`apps/desktop/brand-read.cjs`), and the portal
 *     serves its copy for a 24 px image, so a 1 MB display logo is a cost paid on every start.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandMark, MARK_FILES, MARK_SIZES } from "@/components/brand-mark";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicBrand = join(appDir, "public", "brand");
const markDir = join(appDir, "components", "brand-art");

const PNG_MAGIC = "89504e470d0a1a0a";
const MAX_DISPLAY_LOGO_BYTES = 200 * 1024;

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex"), `${file} is a PNG`).toBe(PNG_MAGIC);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function icoSizes(file: string): number[] {
  const bytes = readFileSync(file);
  expect(bytes.readUInt16LE(0), "ICO reserved word").toBe(0);
  expect(bytes.readUInt16LE(2), "ICO type is icon").toBe(1);
  const count = bytes.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const width = bytes[6 + index * 16] ?? 0;
    return width === 0 ? 256 : width;
  });
}

describe("the favicon set", () => {
  const html = readFileSync(join(appDir, "index.html"), "utf8");

  it("links an ico, a 32 px png and a 180 px apple-touch icon, and no svg", () => {
    expect(html).toContain('href="/brand/favicon.ico"');
    expect(html).toContain('href="/brand/favicon-32.png"');
    expect(html).toMatch(/rel="apple-touch-icon"[^>]*href="\/brand\/favicon-180\.png"/);
    expect(html).not.toMatch(/favicon\.svg|image\/svg/);
  });

  it("points every /brand/ link at a file that exists", () => {
    const linked = [...html.matchAll(/href="\/brand\/([^"]+)"/g)].map((match) => match[1] as string);
    expect(linked.length).toBeGreaterThanOrEqual(3);
    for (const name of linked) {
      expect(existsSync(join(publicBrand, name)), name).toBe(true);
    }
  });

  it("ships the sizes its names promise", () => {
    expect(icoSizes(join(publicBrand, "favicon.ico"))).toEqual([16, 32, 48]);
    expect(pngSize(join(publicBrand, "favicon-32.png"))).toEqual({ width: 32, height: 32 });
    expect(pngSize(join(publicBrand, "favicon-180.png"))).toEqual({ width: 180, height: 180 });
    expect(existsSync(join(publicBrand, "favicon.svg"))).toBe(false);
  });
});

describe("the display logo", () => {
  const logo = join(publicBrand, "logo.png");

  it("is a small square tile, not the 1024 px icon source", () => {
    const { width, height } = pngSize(logo);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(128);
    expect(width).toBeLessThanOrEqual(512);
    expect(statSync(logo).size).toBeLessThanOrEqual(MAX_DISPLAY_LOGO_BYTES);
  });

  it("is the same file the portal serves, which has no import path to the product", () => {
    const portalCopy = join(appDir, "..", "portal", "assets", "logo.png");
    expect(readFileSync(portalCopy).equals(readFileSync(logo))).toBe(true);
  });
});

describe("the rail mark", () => {
  it("has a file at 24, 32, 48 and 64 px", () => {
    for (const size of [24, 32, 48, 64]) {
      expect(pngSize(join(markDir, `mark-${size}.png`)), `mark-${size}`).toEqual({ width: size, height: size });
    }
  });

  it("draws the 1x file at its own size and the file twice as large for 2x", () => {
    expect(MARK_SIZES).toEqual([24, 32]);
    for (const size of MARK_SIZES) {
      const html = renderToStaticMarkup(<BrandMark size={size} />);
      expect(html).toContain(`width="${size}"`);
      expect(html).toContain(`height="${size}"`);
      expect(html).toContain(` 1x, `);
      expect(html).toContain(` 2x"`);
      expect(MARK_FILES[size].srcSet.split(",")).toHaveLength(2);
    }
    expect(MARK_FILES[24].src).not.toBe(MARK_FILES[32].src);
  });

  it("is decorative unless it is given a name", () => {
    expect(renderToStaticMarkup(<BrandMark />)).toContain('alt=""');
    expect(renderToStaticMarkup(<BrandMark alt="Nultron" testId="product-logo" />)).toMatch(
      /alt="Nultron"[^>]*data-testid="product-logo"/,
    );
  });
});
