/**
 * The logo files the desktop shell ships, checked as bytes.
 *
 * Owner ruling, 2026-09-29: the logo is the painted Nultron head in a blue tile. The Windows icon
 * (`icon.ico`), the macOS icon (`icon.icns`), the icon sources (`icon.png`) and the display logo
 * (`logo.png`, on the splash page and inlined by the preload) all come from one brand kit. A swap
 * that copies one file and forgets a twin passes every type check, so this reads them.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { join } = require("node:path");

const PNG_MAGIC = "89504e470d0a1a0a";
const MAX_DISPLAY_LOGO_BYTES = 200 * 1024;

const brandDir = join(__dirname, "branding", "agentforge");
const buildDir = join(__dirname, "build");
const splashDir = join(__dirname, "splash");
const resourceDir = join(__dirname, "resources", "brand");

const read = (file) => fs.readFileSync(file);

function pngSize(bytes, label) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), PNG_MAGIC, `${label} is a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function icoSizes(bytes, label) {
  assert.equal(bytes.readUInt16LE(0), 0, `${label}: ICO reserved word`);
  assert.equal(bytes.readUInt16LE(2), 1, `${label}: ICO type is icon`);
  return Array.from({ length: bytes.readUInt16LE(4) }, (_, index) => bytes[6 + index * 16] || 256);
}

function icnsEntries(bytes, label) {
  assert.equal(bytes.toString("ascii", 0, 4), "icns", `${label}: ICNS magic`);
  assert.equal(bytes.readUInt32BE(4), bytes.length, `${label}: ICNS length field is the file size`);
  const entries = [];
  for (let offset = 8; offset < bytes.length; ) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32BE(offset + 4);
    assert.ok(length >= 8 && offset + length <= bytes.length, `${label}: ICNS entry ${type} fits`);
    entries.push({ type, data: bytes.subarray(offset + 8, offset + length) });
    offset += length;
  }
  return entries;
}

// ---------- Windows: icon.ico, one file in three places ----------

{
  const source = read(join(brandDir, "icon.ico"));
  for (const dir of [buildDir, splashDir]) {
    assert.ok(read(join(dir, "icon.ico")).equals(source), `${dir}/icon.ico is the branding copy`);
  }
  assert.deepEqual(icoSizes(source, "icon.ico"), [16, 24, 32, 48, 64, 128, 256]);
}

// ---------- macOS: icon.icns, the file electron-builder's mac.icon names ----------

{
  const source = read(join(brandDir, "icon.icns"));
  assert.ok(read(join(buildDir, "icon.icns")).equals(source), "build/icon.icns is the branding copy");
  const entries = icnsEntries(source, "icon.icns");
  assert.deepEqual(
    entries.map((entry) => entry.type),
    ["icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10"],
  );
  const sizes = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024 };
  for (const { type, data } of entries) {
    const { width, height } = pngSize(data, type);
    // ic10 is the 1024 px image; the others are stored at their own size.
    assert.deepEqual({ width, height }, { width: sizes[type], height: sizes[type] }, `${type} size`);
  }
  const config = JSON.parse(fs.readFileSync(join(__dirname, "package.json"), "utf8")).build;
  assert.equal(config.mac.icon, "icon.icns");
  assert.equal(config.win.icon, "icon.ico");
  assert.equal(config.directories.buildResources, "build");
}

// ---------- pack-brand copies the .icns, and removes one a flavor does not ship ----------

{
  const source = fs.readFileSync(join(__dirname, "scripts", "pack-brand.mjs"), "utf8");
  assert.match(source, /icon\.icns/);
  assert.match(source, /unlinkSync\(buildIcns\)/);
}

// ---------- icon sources: 1024 px, the same file for build/ and the branding source ----------

{
  const source = read(join(brandDir, "icon.png"));
  assert.deepEqual(pngSize(source, "icon.png"), { width: 1024, height: 1024 });
  assert.ok(read(join(buildDir, "icon.png")).equals(source), "build/icon.png is the branding copy");
  assert.deepEqual(pngSize(read(join(brandDir, "mark.png")), "mark.png"), { width: 1024, height: 1024 });
}

// ---------- display logo: small, and one file for the splash, the preload and the source ----------

{
  const source = read(join(brandDir, "logo.png"));
  for (const dir of [splashDir, resourceDir]) {
    assert.ok(read(join(dir, "logo.png")).equals(source), `${dir}/logo.png is the branding copy`);
  }
  const { width, height } = pngSize(source, "logo.png");
  assert.equal(width, height, "logo.png is square");
  assert.ok(width >= 128 && width <= 512, `logo.png is ${width} px; the splash shows it at 88 CSS px`);
  // The preload inlines this file as base64 on every launch (brand-read.cjs `loadBrandLogo`).
  assert.ok(
    source.length <= MAX_DISPLAY_LOGO_BYTES,
    `logo.png is ${source.length} bytes, over the ${MAX_DISPLAY_LOGO_BYTES} the preload should carry`,
  );
}

// ---------- the splash page draws that logo and names the product ----------

{
  const html = fs.readFileSync(join(splashDir, "index.html"), "utf8");
  assert.match(html, /<img class="logo" src="\.\/logo\.png"/);
  assert.match(html, /<title>Nultron<\/title>/);
  assert.ok(!/\.svg/.test(html), "the splash draws no SVG logo");
}

console.log("brand-assets.test.cjs: ok");
