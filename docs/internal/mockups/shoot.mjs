import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1.5 });
await page.goto("file:///" + path.join(here, "legal-mode-mockup.html").replace(/\\/g, "/"));
await page.waitForTimeout(1500);
for (const [id, name] of [["s1", "legal-1-new-matter"], ["s2", "legal-2-running"], ["s3", "legal-3-results"]]) {
  await page.locator(`#${id}`).screenshot({ path: path.join(here, `${name}.png`) });
  console.log("wrote", name);
}
await browser.close();
