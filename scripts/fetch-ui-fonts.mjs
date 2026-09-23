// One-off: bundle DM Sans + Source Serif 4 as local woff2 so the app renders with no
// internet. Writes apps/web/app/fonts/*.woff2 and a manifest the CSS mirrors.
// Run: node scripts/fetch-ui-fonts.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "apps", "web", "app", "fonts");

// Google's Windows UA is what makes it serve woff2 (not ttf).
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Only latin + latin-ext ship; the other subsets would triple the payload for copy we never render. */
const WANTED_SUBSETS = new Set(["latin", "latin-ext"]);

const FAMILIES = [
  { css: "DM+Sans:wght@400;500;600;700", slug: "dm-sans" },
  {
    css: "Source+Serif+4:ital,wght@0,400;0,600;1,400",
    slug: "source-serif",
  },
];

function slugFor(family, weight, style, subset, existing) {
  const base = `${family}-${weight}${style === "italic" ? "-italic" : ""}-${subset}`;
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

mkdirSync(OUT, { recursive: true });

const used = new Set();
/** DM Sans is a variable font: Google serves one file per subset and varies only the `font-weight`. */
const bySourceUrl = new Map();
const manifest = [];

for (const family of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${family.css}&display=swap`;
  const css = await (await get(url)).text();
  console.log(`\n${family.slug}: ${css.length} bytes of CSS`);

  // Blocks look like: /* subset */\n@font-face { ... }
  const blocks = css.split(/\/\*\s*([a-z0-9-]+)\s*\*\//i);
  for (let i = 1; i < blocks.length; i += 2) {
    const subset = blocks[i].trim();
    const body = blocks[i + 1] ?? "";
    if (!WANTED_SUBSETS.has(subset)) continue;

    const weight = /font-weight:\s*(\d+)/.exec(body)?.[1];
    const style = /font-style:\s*(\w+)/.exec(body)?.[1] ?? "normal";
    const src = /url\((https:\/\/[^)]+)\)/.exec(body)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
    if (!weight || !src || !range) continue;

    const key = `${family.slug}|${src}`;
    let file = bySourceUrl.get(key);
    if (file) {
      console.log(`  ${file}  (reused for weight ${weight})`);
    } else {
      const name = slugFor(family.slug, weight, style, subset, used);
      used.add(name);
      file = `${name}.woff2`;
      const bytes = Buffer.from(await (await get(src)).arrayBuffer());
      writeFileSync(join(OUT, file), bytes);
      bySourceUrl.set(key, file);
      console.log(`  ${file}  ${bytes.length} bytes`);
    }
    manifest.push({ family, weight, style, subset, file, range });
  }
}

const summary = manifest.map((m) => ({
  family: m.family.slug,
  weight: m.weight,
  style: m.style,
  subset: m.subset,
  file: m.file,
  range: m.range,
}));
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\nwrote ${summary.length} files + manifest.json to ${OUT}`);