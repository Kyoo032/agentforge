// Cuts the Nultron app logo tile out of its white corners: the step between the master (Rizky's painted logo,
// branding/agentforge/source/app-logo.webp, 1600 px, no alpha) and app-logo-cut.png (the same picture as RGBA with transparent
// corners) that brand-icons.mjs derives every icon from. Pure function on RGBA bytes, so it runs under plain node.
//
// Shape. The tile's white corners are not a circular radius. Fitting the source's own edge gave a superellipse
// |x/a|^n + |y/a|^n = 1 with n = 4.669, a = 806 to 808 px about (800, 800) (rms 1.2 px against 1073 subpixel edge points; a
// rounded rectangle fitted worse). The tile is 1600 px wide but a is 807, so the source crops it by about 3.5 px a side.
// Alpha. The fit is only good to about 3 px, so inside a 6 px band around it alpha is measured from the source itself (how white
// each edge pixel is, unmixed against the tile colour 5 px inside), then the soft edge is tightened with a smoothstep to about
// 2 px. Outside the band alpha is 0, inside it is 1. Every band pixel takes its colour from 5 px inside the edge, so no white
// survives (checked at 6x on dark and on white when the kit was made: no source-blue pixel cut away, no white pixel kept).

/** The fitted tile edge, in pixels of the 1600 px master. `band` and `inset` are the widths described above. */
export const CUT_SHAPE = { cx: 800, cy: 800, a: 807, b: 807, n: 4.6687499999999975, band: 6, inset: 5 };
/** The master is this many px square; the shape above is fitted to it. */
export const CUT_SOURCE_SIZE = 1600;

/**
 * @param {Uint8Array} rgba straight RGBA of the master, `width` x `width`, top row first
 * @returns {Buffer} RGBA of the same size: the tile with transparent corners
 */
export function cutLogoTile(rgba, width, height, shape = CUT_SHAPE) {
  if (width !== height) throw new Error("cutLogoTile: the logo must be square");
  if (width !== CUT_SOURCE_SIZE) {
    throw new Error(`cutLogoTile: the tile shape is fitted to a ${CUT_SOURCE_SIZE} px master, got ${width} px`);
  }
  const { cx, cy, a, b, n, band, inset } = shape;
  const out = Buffer.alloc(width * height * 4);
  const bilinear = (x, y) => {
    const fx = Math.min(width - 1.001, Math.max(0, x - 0.5));
    const fy = Math.min(height - 1.001, Math.max(0, y - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const px = (xx, yy, c) => rgba[(yy * width + xx) * 4 + c];
    return [0, 1, 2].map(
      (c) =>
        (px(x0, y0, c) * (1 - tx) + px(x0 + 1, y0, c) * tx) * (1 - ty) +
        (px(x0, y0 + 1, c) * (1 - tx) + px(x0 + 1, y0 + 1, c) * tx) * ty,
    );
  };
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = i + 0.5;
      const y = j + 0.5;
      const o = (j * width + i) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const ux = Math.abs(dx) / a;
      const uy = Math.abs(dy) / b;
      const f = ux ** n + uy ** n;
      const gx = (n * ux ** (n - 1)) / a;
      const gy = (n * uy ** (n - 1)) / b;
      const g = Math.hypot(gx, gy) || 1e-9;
      const d = (f - 1) / g; // signed distance to the fitted edge, > 0 outside
      if (d > band) continue; // well outside: transparent
      if (d < -band) {
        out.set([rgba[o], rgba[o + 1], rgba[o + 2], 255], o); // well inside: untouched
        continue;
      }
      const nx = (Math.sign(dx) * gx) / g;
      const ny = (Math.sign(dy) * gy) / g;
      const tile = bilinear(x - nx * (d + inset), y - ny * (d + inset)); // colour from `inset` px inside the fitted edge
      let alpha;
      const contrast = 255 - tile[0];
      if (contrast >= 60) {
        const cov = Math.min(1, Math.max(0, (255 - rgba[o]) / contrast));
        const t = Math.min(1, Math.max(0, (cov - 0.12) / 0.76)); // ~4 px soft edge with a faint pre-edge tint: tighten to ~2 px
        alpha = t * t * (3 - 2 * t);
      } else {
        alpha = Math.min(1, Math.max(0, 0.5 - d));
      }
      if (alpha < 0.004) continue;
      out.set([Math.round(tile[0]), Math.round(tile[1]), Math.round(tile[2]), Math.round(alpha * 255)], o);
    }
  }
  return out;
}
