// Live walk of /market on the keyed instance (port 3177). Never touches Settings.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://127.0.0.1:3177";
const OUT = process.env.OUT ?? "C:/Users/rizky/AppData/Local/Temp/af-market-verify/out/ux";
mkdirSync(OUT, { recursive: true });
const STAGES = (process.env.STAGES ?? "cancel,generate,result,rewrite,download,actions,cache,unknown,mobile").split(",");

const log = [];
const note = (step, data) => {
  log.push({ step, t: new Date().toISOString(), ...data });
  console.log(step, JSON.stringify(data));
  writeFileSync(join(OUT, "live-log.json"), JSON.stringify(log, null, 2));
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on("dialog", (d) => d.dismiss());
const shot = async (name, full = true) => {
  const p = join(OUT, `${name}.png`);
  await page.screenshot({ path: p, fullPage: full });
  return p;
};
const chips = async () => page.locator('[data-testid="market-ticker-chip"]').evaluateAll((els) => els.map((e) => e.dataset.ticker));
const clearChips = async () => {
  while ((await page.locator('[data-testid="market-ticker-chip"]').count()) > 0) {
    await page.locator('[data-testid="market-ticker-chip"] button').first().click();
  }
};

/** Click Generate, poll the progress list, return per-phase timings + heartbeat observations. */
async function runGenerate(tag, { cancelAtMs = null } = {}) {
  const gen = page.locator('[data-testid="market-generate"]');
  const t0 = Date.now();
  await gen.click();
  const phases = [];
  let lastSnapshot = "";
  let heartbeat = false;
  let heartbeatLabels = new Set();
  let cancelVisible = null;
  let cancelled = false;
  let frozenGapMs = 0;
  let lastChange = Date.now();
  let shotAt5 = false;
  let shotDrafting = false;
  while (true) {
    const elapsed = Date.now() - t0;
    const busy = await page.locator('[data-testid="market-cancel"]').count();
    if (cancelVisible === null && busy) cancelVisible = true;
    const progress = page.locator('[data-testid="market-progress"]');
    const text = (await progress.textContent().catch(() => "")) ?? "";
    if (text !== lastSnapshot) {
      const gap = Date.now() - lastChange;
      if (gap > frozenGapMs) frozenGapMs = gap;
      lastChange = Date.now();
      lastSnapshot = text;
      const items = await progress.locator('[data-testid="market-progress-phase"]').allTextContents().catch(() => []);
      phases.push({ ms: elapsed, items });
      if (/Still drafting/.test(text)) {
        heartbeat = true;
        const m = text.match(/Still drafting… \d+s/g);
        if (m) for (const x of m) heartbeatLabels.add(x);
      }
      if (/drafting/i.test(text) && !shotDrafting) {
        shotDrafting = true;
        await shot(`${tag}-progress-drafting`, false);
      }
    }
    if (!shotAt5 && elapsed > 5000) {
      shotAt5 = true;
      await shot(`${tag}-progress-5s`, false);
    }
    if (cancelAtMs !== null && elapsed >= cancelAtMs && !cancelled) {
      await shot(`${tag}-before-cancel`, false);
      const cancelBtn = page.locator('[data-testid="market-cancel"]');
      const box = await cancelBtn.boundingBox();
      await cancelBtn.click();
      cancelled = true;
      await page.waitForTimeout(1500);
      const after = {
        cancelStill: await page.locator('[data-testid="market-cancel"]').count(),
        generateText: await gen.textContent(),
        generateDisabled: await gen.isDisabled(),
        progressCount: await page.locator('[data-testid="market-progress"]').count(),
        progressText: (await page.locator('[data-testid="market-progress"]').textContent().catch(() => null)),
        error: (await page.locator('[data-testid="market-error"]').textContent().catch(() => null)),
        emptyState: await page.locator('[data-testid="market-studio-empty"]').count(),
        cancelBox: box,
      };
      await shot(`${tag}-after-cancel`, false);
      return { phases, heartbeat, cancelVisible, cancelled: true, after, totalMs: Date.now() - t0 };
    }
    if (!busy && elapsed > 1500) {
      const gapNow = Date.now() - lastChange;
      if (gapNow > frozenGapMs) frozenGapMs = gapNow;
      break;
    }
    if (elapsed > 420000) break;
    await page.waitForTimeout(250);
  }
  const totalMs = Date.now() - t0;
  const err = await page.locator('[data-testid="market-error"]').textContent().catch(() => null);
  const hasPreview = await page.locator('[data-testid="market-preview"]').count();
  return { phases, heartbeat, heartbeatLabels: [...heartbeatLabels], cancelVisible, frozenGapMs, totalMs, err, hasPreview };
}

await page.goto(`${BASE}/market`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="market-studio"]');
note("open", { url: page.url() });

// Starter + position
await page.locator('[data-testid="market-starter"]').first().click();
await page.locator('[data-testid="market-position"]').fill("MU: $100 @ $860, $200 @ $900, target $1,000.");
note("setup", { chips: await chips() });
await shot("L01-setup");

if (STAGES.includes("cancel")) {
  const r = await runGenerate("L02-cancel", { cancelAtMs: 10000 });
  note("cancel-run", r);
}

let gen1;
if (STAGES.includes("generate")) {
  gen1 = await runGenerate("L03-gen1");
  note("gen1", gen1);
  await shot("L03-result-viewport", false);
  await shot("L03-result-full");
}

if (STAGES.includes("result")) {
  const preview = page.locator('[data-testid="market-preview"]');
  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height), w: Math.round(r.width) }; };
    const sections = [...document.querySelectorAll('[data-testid="market-section"] h3')].map((h) => h.textContent);
    const clock = q('[data-testid="market-clock"]');
    const guard = q('[data-testid="market-guard"]');
    const charts = [...document.querySelectorAll('[data-testid="market-chart"]')].map((c) => {
      const svg = c.tagName === "svg" ? c : c.querySelector("svg");
      const r = (svg || c).getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), texts: svg ? [...svg.querySelectorAll("text")].map((t) => t.textContent).slice(0, 30) : [], title: c.getAttribute("aria-label") || c.querySelector("title")?.textContent || null, outerText: c.textContent.slice(0, 200) };
    });
    const unverified = (document.querySelector('[data-testid="market-preview"]')?.textContent.match(/\[unverified figure\]/g) || []).length;
    return {
      title: q('[data-testid="market-preview"] h2')?.textContent,
      previewBox: box('[data-testid="market-preview"]'),
      actionsBox: box('[data-testid="market-actions"]'),
      firstSectionBox: box('[data-testid="market-section"]'),
      clock: clock?.textContent, session: clock?.querySelector("[data-session]")?.dataset.session,
      guard: guard?.textContent, guardClean: guard?.dataset.clean,
      failures: q('[data-testid="market-failures"]')?.textContent ?? null,
      sections,
      sectionLengths: [...document.querySelectorAll('[data-testid="market-section"]')].map((s) => s.textContent.length),
      unverified,
      rankingIndex: sections.findIndex((s) => /rank/i.test(s)),
      rankingBox: (() => { const els = [...document.querySelectorAll('[data-testid="market-section"]')]; const el = els.find((s) => /rank/i.test(s.querySelector("h3")?.textContent || "")); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top + scrollY) }; })(),
      cards: document.querySelectorAll('[data-testid="market-ticker-card"]').length,
      charts: charts.slice(0, 3), chartCount: charts.length,
      factsRows: q('[data-testid="market-ticker-facts"]')?.querySelectorAll("tr").length,
      watchlistRows: q('[data-testid="market-watchlist"]')?.querySelectorAll("tbody tr").length,
      watchlistHeaders: [...(q('[data-testid="market-watchlist"]')?.querySelectorAll("th") || [])].map((t) => t.textContent),
      macroRows: q('[data-testid="market-macro"]')?.querySelectorAll("tbody tr").length,
      headlines: document.querySelectorAll('[data-testid="market-headline"]').length,
      sources: q('[data-testid="market-sources"]')?.querySelectorAll("li").length,
      disclaimer: q('[data-testid="market-disclaimer"]')?.textContent?.slice(0, 200),
      docH: document.documentElement.scrollHeight,
      downloadButtons: [...document.querySelectorAll('[data-testid="market-download"]')].map((b) => b.textContent),
    };
  });
  note("result", info);
  const md = await page.evaluate(() => [...document.querySelectorAll('[data-testid="market-section"]')].map((s) => s.textContent).join("\n\n---\n\n"));
  writeFileSync(join(OUT, "gen1-sections.txt"), md);
  // Screenshot the first ticker card and a chart close-up
  const card = page.locator('[data-testid="market-ticker-card"]').first();
  if (await card.count()) await card.screenshot({ path: join(OUT, "L04-ticker-card.png") });
  const chart = page.locator('[data-testid="market-chart"]').first();
  if (await chart.count()) await chart.screenshot({ path: join(OUT, "L04-chart.png") });
  await page.locator('[data-testid="market-clock"]').screenshot({ path: join(OUT, "L04-clock-guard.png") }).catch(() => null);
  const guardEl = page.locator('[data-testid="market-guard"]');
  if (await guardEl.count()) await guardEl.screenshot({ path: join(OUT, "L04-guard.png") });
  const wl = page.locator('[data-testid="market-watchlist"]');
  if (await wl.count()) await wl.screenshot({ path: join(OUT, "L04-watchlist-table.png") });
  const macro = page.locator('[data-testid="market-macro"]');
  if (await macro.count()) await macro.screenshot({ path: join(OUT, "L04-macro-table.png") });
}

if (STAGES.includes("rewrite")) {
  const regen = page.locator('[data-testid="market-section-regen"]').first();
  const sectionBefore = await page.locator('[data-testid="market-section"]').first().textContent();
  await regen.click();
  await page.waitForTimeout(300);
  await shot("L05-rewrite-panel", false);
  const panelPrompt = page.locator('[data-testid="market-regen-prompt"]');
  note("rewrite-panel", { promptVisible: await panelPrompt.count(), submit: await page.locator('[data-testid="market-regen-submit"]').count(), panelText: await page.locator('[data-testid="market-section"]').first().textContent() });
  await panelPrompt.fill("Ringkas jadi 3 poin");
  const t0 = Date.now();
  await page.locator('[data-testid="market-regen-submit"]').click();
  await page.waitForTimeout(800);
  const during = {
    regenBtnText: await regen.textContent(),
    allRegenDisabled: await page.locator('[data-testid="market-section-regen"]').evaluateAll((els) => els.every((e) => e.disabled)),
    generateDisabled: await page.locator('[data-testid="market-generate"]').isDisabled(),
    spinnerAnywhere: await page.locator('text=/Rewriting/').count(),
  };
  await shot("L05-rewrite-during", false);
  await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="market-section-regen"]')].some((b) => /Rewriting/.test(b.textContent)), null, { timeout: 180000 }).catch(() => null);
  const rewriteMs = Date.now() - t0;
  const sectionAfter = await page.locator('[data-testid="market-section"]').first().textContent();
  note("rewrite", { during, rewriteMs, changed: sectionBefore !== sectionAfter, after: sectionAfter.slice(0, 600), guard: await page.locator('[data-testid="market-guard"]').textContent(), err: await page.locator('[data-testid="market-error"]').textContent().catch(() => null), downloadButtons: await page.locator('[data-testid="market-download"]').allTextContents() });
  await shot("L05-rewrite-after", false);
}

if (STAGES.includes("download")) {
  // Header "Download DOCX" is the first market-download in DOM order.
  const btn = page.locator('[data-testid="market-download"]', { hasText: "DOCX" });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), btn.click()]);
  const file = join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  const size = statSync(file).size;
  let zipList = "";
  try {
    const probe =
      "const z=require('fs').readFileSync(process.argv[1]);const s=z.toString('latin1');console.log(s.includes('word/document.xml'), s.slice(0,2))";
    zipList = execFileSync("node", ["-e", probe, file]).toString();
  } catch (e) { zipList = String(e); }
  note("download-docx", { file, size, hasWordDocumentXml: zipList.trim(), btnTextAfter: await btn.textContent(), err: await page.locator('[data-testid="market-error"]').textContent().catch(() => null) });
  // Markdown download too
  const mdBtn = page.locator('[data-testid="market-download"]', { hasText: "Markdown" });
  const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), mdBtn.click()]);
  const f2 = join(OUT, dl2.suggestedFilename());
  await dl2.saveAs(f2);
  note("download-md", { file: f2, size: statSync(f2).size });
}

if (STAGES.includes("actions")) {
  await page.locator('[data-testid="market-send-kb"]').click();
  await page.waitForSelector('[data-testid="market-actions-note"]', { timeout: 30000 }).catch(() => null);
  note("send-kb", { note: await page.locator('[data-testid="market-actions-note"]').textContent().catch(() => null) });
  await page.locator('[data-testid="market-actions"]').screenshot({ path: join(OUT, "L06-actions-after-kb.png") });
  await page.locator('[data-testid="market-make-document"]').click();
  await page.waitForTimeout(2500);
  note("make-document", { url: page.url(), promptOnTarget: await page.locator("textarea").first().inputValue().catch(() => null) });
  await shot("L07-make-document", false);
  await page.goBack();
  await page.waitForTimeout(1500);
  note("after-back", { url: page.url(), preview: await page.locator('[data-testid="market-preview"]').count(), chips: await chips() });
  await shot("L07-after-back", false);
}

if (STAGES.includes("cache")) {
  // Re-setup if result was lost by navigation.
  if ((await page.locator('[data-testid="market-ticker-chip"]').count()) === 0) {
    await page.locator('[data-testid="market-starter"]').first().click();
    await page.locator('[data-testid="market-position"]').fill("MU: $100 @ $860, $200 @ $900, target $1,000.");
  }
  const gen2 = await runGenerate("L08-gen2");
  note("gen2-cached", gen2);
  const stale = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="market-preview"]')?.textContent || "";
    return { mentionsCache: /cache|cached|minutes old|stale|beberapa menit/i.test(t), observed: [...document.querySelectorAll('[data-testid="market-sources"] li')].slice(0, 3).map((l) => l.textContent), clock: document.querySelector('[data-testid="market-clock"]')?.textContent };
  });
  note("gen2-staleness-hint", stale);
  await shot("L08-gen2-result", false);
}

if (STAGES.includes("unknown")) {
  await clearChips();
  const input = page.locator('[data-testid="market-tickers"]');
  await input.click();
  await input.pressSequentially("MU ZZZZQ");
  await input.press("Enter");
  note("unknown-setup", { chips: await chips() });
  const gen3 = await runGenerate("L09-gen3-unknown");
  note("gen3-unknown", gen3);
  const info = await page.evaluate(() => ({
    failures: document.querySelector('[data-testid="market-failures"]')?.textContent ?? null,
    cards: [...document.querySelectorAll('[data-testid="market-ticker-card"]')].map((c) => ({ sym: c.dataset.symbol, failures: c.querySelector('[data-testid="market-ticker-failures"]')?.textContent, hasChart: !!c.querySelector('[data-testid="market-chart"]'), text: c.textContent.slice(0, 200) })),
    error: document.querySelector('[data-testid="market-error"]')?.textContent ?? null,
    guard: document.querySelector('[data-testid="market-guard"]')?.textContent,
    watchlistRows: document.querySelector('[data-testid="market-watchlist"]')?.querySelectorAll("tbody tr").length,
  }));
  note("unknown-result", info);
  await shot("L09-unknown-result-viewport", false);
  await shot("L09-unknown-result-full");
}

if (STAGES.includes("mobile")) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await shot("L10-mobile-result-top", false);
  const m = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, winW: innerWidth, preview: document.querySelector('[data-testid="market-preview"]')?.scrollWidth, chart: document.querySelector('[data-testid="market-chart"]')?.getBoundingClientRect().width, facts: document.querySelector('[data-testid="market-ticker-facts"]')?.getBoundingClientRect().width, watchlist: document.querySelector('[data-testid="market-watchlist"]')?.scrollWidth, macro: document.querySelector('[data-testid="market-macro"]')?.scrollWidth }));
  note("mobile-result", m);
  const card = page.locator('[data-testid="market-ticker-card"]').first();
  if (await card.count()) await card.screenshot({ path: join(OUT, "L10-mobile-ticker-card.png") });
  const wl = page.locator('[data-testid="market-watchlist"]');
  if (await wl.count()) await wl.screenshot({ path: join(OUT, "L10-mobile-watchlist.png") });
  await shot("L10-mobile-result-full");
}

await browser.close();
note("done", {});
