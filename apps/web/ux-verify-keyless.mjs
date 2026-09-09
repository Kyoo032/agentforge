// Key-less first-run walk of /market on the stub instance (port 3179).
// Writes screenshots + a JSON log to OUT.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3179";
const OUT = process.env.OUT ?? "C:/Users/rizky/AppData/Local/Temp/af-market-verify/out/ux";
mkdirSync(OUT, { recursive: true });

const log = [];
const note = (step, data) => {
  log.push({ step, ...data });
  console.log(step, JSON.stringify(data));
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const shot = async (name) => {
  const p = join(OUT, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
};
const chips = async () => page.locator('[data-testid="market-ticker-chip"]').evaluateAll((els) => els.map((e) => e.dataset.ticker));

// 1. Home -> rail -> /market
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await shot("01-home");
const rail = page.locator('[data-testid="mode-market"]');
note("rail", { count: await rail.count(), text: (await rail.first().textContent())?.trim(), title: await rail.first().getAttribute("title"), aria: await rail.first().getAttribute("aria-label") });
await rail.first().click();
await page.waitForURL(/\/market/);
await page.waitForSelector('[data-testid="market-studio"]');
await shot("02-market-empty");
note("open", { url: page.url() });

// Default instruction
const prompt = page.locator('[data-testid="market-prompt"]');
const promptText = await prompt.inputValue();
const promptBox = await prompt.boundingBox();
const promptScroll = await prompt.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight, rows: el.rows, readOnly: el.readOnly, disabled: el.disabled }));
note("prompt", { chars: promptText.length, lines: promptText.split("\n").length, box: promptBox, ...promptScroll });

// Above-the-fold check: where is Generate?
const gen = page.locator('[data-testid="market-generate"]');
const genBox = await gen.boundingBox();
note("generate-position", { box: genBox, disabled: await gen.isDisabled(), text: await gen.textContent() });
await page.screenshot({ path: join(OUT, "02b-market-viewport-only.png") });

// 2. Type mu, nvda + Enter
const input = page.locator('[data-testid="market-tickers"]');
await input.click();
await input.pressSequentially("mu, nvda");
await shot("03-typing-before-enter");
note("typing", { chipsBeforeEnter: await chips(), draft: await input.inputValue() });
await input.press("Enter");
note("after-enter", { chips: await chips() });
await shot("04-after-enter");

// Paste BBCA BBRI (simulate paste event)
await input.evaluate((el) => {
  const dt = new DataTransfer();
  dt.setData("text", "BBCA BBRI");
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
note("after-paste", { chips: await chips() });
await shot("05-after-paste");

// dedupe: type nvda again
await input.pressSequentially("nvda");
await input.press("Enter");
note("dedupe", { chips: await chips() });

// Remove a chip
const removeBtn = page.locator('[data-testid="market-ticker-chip"][data-ticker="NVDA"] button');
note("remove-button", { ariaLabel: await removeBtn.getAttribute("aria-label"), box: await removeBtn.boundingBox() });
await removeBtn.click();
note("after-remove", { chips: await chips() });
await shot("06-after-remove");

// invalid entries
await input.pressSequentially("hello!!");
await input.press("Enter");
note("invalid-hello", { chips: await chips(), error: await page.locator('[data-testid="market-error"]').count() });
await shot("07-invalid-hello");
await input.pressSequentially("ABCDEFGHIJKLMNOPQRSTUVWXY");
await input.press("Enter");
note("invalid-25char", { chips: await chips(), error: await page.locator('[data-testid="market-error"]').count() });
await shot("08-invalid-25char");
// 16 tickers via paste
await input.evaluate((el) => {
  const dt = new DataTransfer();
  dt.setData("text", "A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12 A13 A14 A15 A16");
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
const after16 = await chips();
note("sixteen", { count: after16.length, chips: after16, inputDisabled: await input.isDisabled(), placeholder: await input.getAttribute("placeholder"), counter: await page.locator('[data-testid="market-watchlist-input"] + p').textContent(), error: await page.locator('[data-testid="market-error"]').count() });
await shot("09-sixteen-tickers");

// Reset to 2 chips for generate: click remove on everything then add MU NVDA
for (const t of after16) {
  await page.locator(`[data-testid="market-ticker-chip"][data-ticker="${t}"] button`).click();
}
await input.pressSequentially("MU NVDA");
await input.press("Enter");
note("reset", { chips: await chips() });

// Generate with no key
await gen.click();
await page.waitForSelector('[data-testid="market-error"]', { timeout: 30000 }).catch(() => null);
await page.waitForTimeout(1500);
const err = page.locator('[data-testid="market-error"]');
note("nokey-error", { count: await err.count(), text: (await err.textContent().catch(() => null)), hasSettingsLink: await err.locator('a[href*="settings"]').count(), progressShown: await page.locator('[data-testid="market-progress"]').count(), progressText: await page.locator('[data-testid="market-progress"]').textContent().catch(() => null) });
await shot("10-nokey-error");

// Click a starter with existing chips
const starters = page.locator('[data-testid="market-starter"]');
note("starters", { count: await starters.count(), labels: await starters.allTextContents() });
await starters.first().click();
note("after-starter", { chips: await chips() });
await shot("11-after-starter");

// Language switch
const lang = page.locator('[data-testid="market-language"]');
await lang.selectOption("en");
const enPrompt = await prompt.inputValue();
note("lang-en", { swapped: enPrompt.startsWith("Write a pre-market"), first80: enPrompt.slice(0, 80) });
await shot("12-lang-en");
// edit the prompt then switch back
await prompt.fill(enPrompt + "\nAlso mention gold.");
await lang.selectOption("id");
const backPrompt = await prompt.inputValue();
note("lang-back-after-edit", { preserved: backPrompt.includes("Also mention gold."), startsWithEn: backPrompt.startsWith("Write a pre-market"), first60: backPrompt.slice(0, 60) });
await shot("13-lang-back-after-edit");

// Position and reload
await page.locator('[data-testid="market-position"]').fill("MU: $100 @ $860, target $1,000");
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="market-studio"]');
note("after-reload", { url: page.url(), chips: await chips(), prompt: (await prompt.inputValue()).slice(0, 40), position: await page.locator('[data-testid="market-position"]').inputValue(), language: await lang.inputValue() });
await shot("14-after-reload");

// Accessibility: tab order
await page.goto(`${BASE}/market`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="market-studio"]');
await input.click();
await input.pressSequentially("MU NVDA");
await input.press("Enter");
// Focus start at watchlist input then tab through
await input.focus();
const order = [];
for (let i = 0; i < 14; i++) {
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      testid: el.getAttribute("data-testid"),
      id: el.id,
      aria: el.getAttribute("aria-label"),
      text: (el.textContent || "").trim().slice(0, 40),
      outline: cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor,
      boxShadow: cs.boxShadow.slice(0, 60),
    };
  });
  order.push(info);
  await page.keyboard.press("Tab");
}
note("tab-order", { order });
// Shift+Tab from the input back to chip remove buttons
await input.focus();
await page.keyboard.press("Shift+Tab");
const back = await page.evaluate(() => ({ tag: document.activeElement?.tagName, aria: document.activeElement?.getAttribute("aria-label") }));
note("shift-tab-from-input", back);
await page.screenshot({ path: join(OUT, "15-focus-on-chip-remove.png") });
await page.keyboard.press("Enter");
note("keyboard-remove", { chips: await chips() });

// Button names
const buttons = await page.locator("button").evaluateAll((els) =>
  els.map((b) => ({ name: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 40), testid: b.getAttribute("data-testid") })).filter((b) => !b.name),
);
note("unnamed-buttons", { buttons });
// Duplicate testids
const dupes = await page.evaluate(() => {
  const m = {};
  document.querySelectorAll("[data-testid]").forEach((e) => { const k = e.getAttribute("data-testid"); m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).filter(([k, v]) => v > 1 && !/chip|starter|phase|section|card|headline|row/.test(k));
});
note("dup-testids", { dupes });

// Mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/market`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="market-studio"]');
await starters.first().click();
await page.screenshot({ path: join(OUT, "16-mobile-inputs-viewport.png") });
await shot("17-mobile-inputs-full");
const overflow = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, winW: innerWidth, main: document.querySelector('[data-testid="market-studio"]').scrollWidth }));
note("mobile-overflow", overflow);
const genBoxM = await gen.boundingBox();
note("mobile-generate", { box: genBoxM });

writeFileSync(join(OUT, "keyless-log.json"), JSON.stringify(log, null, 2));
await browser.close();
