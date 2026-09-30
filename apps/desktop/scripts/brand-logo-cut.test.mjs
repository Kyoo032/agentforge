import assert from "node:assert/strict";
import { test } from "node:test";
import { CUT_SHAPE, CUT_SOURCE_SIZE, cutLogoTile } from "./brand-logo-cut.mjs";

const N = CUT_SOURCE_SIZE;
const TILE = [38, 136, 200];
const at = (rgba, x, y) => [...rgba.subarray((y * N + x) * 4, (y * N + x) * 4 + 4)];

/** A stand-in master: the blue tile inside the fitted superellipse, white outside it, no alpha, a soft one-pixel edge. */
function master() {
  const rgba = Buffer.alloc(N * N * 4);
  const { cx, cy, a, b, n } = CUT_SHAPE;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const f = (Math.abs(i + 0.5 - cx) / a) ** n + (Math.abs(j + 0.5 - cy) / b) ** n;
      const inside = Math.min(1, Math.max(0, (1 - f) * 400 + 0.5)); // a few px of antialiasing, like the painted edge
      const o = (j * N + i) * 4;
      for (let c = 0; c < 3; c++) rgba[o + c] = Math.round(255 * (1 - inside) + TILE[c] * inside);
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

test("cutLogoTile: white corners become transparent, the tile stays untouched and opaque", () => {
  const src = master();
  const cut = cutLogoTile(src, N, N);
  assert.equal(cut.length, src.length);
  assert.equal(at(cut, 2, 2)[3], 0, "the corner is transparent");
  assert.equal(at(cut, N - 3, N - 3)[3], 0);
  assert.deepEqual(at(cut, N / 2, N / 2), [...TILE, 255], "the middle is the source colour, opaque");
  assert.deepEqual(at(cut, N / 2, 20), [...TILE, 255], "well inside the top edge");
});

test("cutLogoTile: no white survives on the edge (colour comes from inside the tile)", () => {
  const cut = cutLogoTile(master(), N, N);
  let visibleWhite = 0;
  let soft = 0;
  for (let i = 0; i < cut.length; i += 4) {
    const alpha = cut[i + 3];
    if (alpha > 0 && alpha < 255) soft++;
    if (alpha > 128 && Math.min(cut[i], cut[i + 1], cut[i + 2]) > 215) visibleWhite++;
  }
  assert.equal(visibleWhite, 0);
  assert.ok(soft > 100 && soft < 40000, `the antialiased rim is a thin band (${soft} px)`);
});

test("cutLogoTile: the cut is symmetric, as the shape is", () => {
  const cut = cutLogoTile(master(), N, N);
  for (const [x, y] of [
    [100, 40],
    [300, 15],
    [810, 4],
  ]) {
    assert.equal(at(cut, x, y)[3], at(cut, N - 1 - x, y)[3], `mirror in x at ${x},${y}`);
    assert.equal(at(cut, x, y)[3], at(cut, x, N - 1 - y)[3], `mirror in y at ${x},${y}`);
  }
});

test("cutLogoTile refuses a picture the shape was not fitted to", () => {
  assert.throws(() => cutLogoTile(Buffer.alloc(1024 * 1024 * 4), 1024, 1024), /fitted to a 1600 px master/);
  assert.throws(() => cutLogoTile(Buffer.alloc(1600 * 800 * 4), 1600, 800), /must be square/);
});
