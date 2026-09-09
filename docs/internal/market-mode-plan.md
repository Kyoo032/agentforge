# Market Watch — implementation plan (in-process, local Electron only)

Status: **v2 rebuilt 2026-09-09** on branch `feat/market-mode` after Kyo rejected v1 (LQ45-only, one ticker, rule-based bull/bear lists) as the wrong direction. Market is now a prompt-driven analyst: any tickers from any market, several at once, a chart per ticker, quotes + TradingView technical rating + headlines + macro, and a briefing the model writes in Bahasa Indonesia or English over that data packet, the way Kyo's Hermes "pre-market favorites" bot does. On demand only; no schedule yet. No server, no sidecar, no port, no MCP (later). The Python repo `C:\Users\rizky\dps-market-mcp` stays a reference only.

## What the user does

1. Click Market. Paste or pick a watchlist: `MU, WDC, NVDA, AMD, INTC, DELL, AVGO, SNOW, GOOGL, AAPL, SPCX`, or `BBCA, BBRI`, or a mix. Up to 15.
2. Keep or edit the instruction. The default is the pre-market briefing prompt (TL;DR + confidence, macro, watchlist snapshot, ranking most bullish to most bearish, catalysts, position focus, signals at the open, risk note; Bahasa Indonesia; under 6,000 characters; no preamble).
3. Optionally paste position context ("MU: $100 @ $860, $200 @ $900, target $1,000"). Its numbers are allowed in the prose.
4. Generate. The host resolves the symbols, fetches quotes with pre-market moves, six months of daily bars, TradingView ratings, headlines, and macro levels (S&P/Nasdaq/Dow/Russell futures, VIX, 10Y, WTI, DXY, IHSG, USD/IDR), builds a line chart per ticker (close, SMA50, SMA200), and hands the packet plus the instruction to the model.
5. The briefing renders with a session badge (pre / regular / post / closed, so a late run never poses as pre-market), the sections, the watchlist table, a card per ticker with its chart, quote, technicals, and headlines, the macro table, sources, and the disclaimer. DOCX and Markdown download, Send to KB, section rewrite.

## Principles that survived v1

1. **Code fetches and computes, model narrates.** Every number the model may use is in the packet or in the user's position context; the number guard strips anything else as `[unverified figure]`.
2. **Attributed.** Every packet row carries source, URL, and observed time. Sources list on every briefing.
3. **Analysis, not a directive.** The model may rank, read sentiment, and discuss targets and levels. It may not tell the reader to buy or sell now. The advice guard is now imperative-only (`beli sekarang`, `jual sekarang`, `buy now`, `sell now`, `you should buy`…). The disclaimer is stamped by code on every render.
4. **Local desk, on-demand fetch.** Network only on click, short timeouts, per-kind cache in SQLite (quotes 5 min, technicals 15 min, history 6 h, news 30 min, macro 5 min), stale fallback when a source is down, the failures listed in the briefing.
5. **Honest clock.** The host computes the U.S. session from the run time and tells the model and the reader.

## Sources

| Need | Source | Notes |
|---|---|---|
| Quotes, pre/post-market, futures, indices, FX, history, headlines | `yahoo-finance2` (MIT) | Verified today for US tickers incl. SPCX, `.JK`, `ES=F`, `^VIX`, `^TNX`, `CL=F`, `DX-Y.NYB`, `^JKSE`, `IDR=X`. |
| Technical rating (Recommend.All / MA / Other), RSI, SMA/EMA, MACD, 52w | TradingView scanner (`scanner.tradingview.com/{market}/scan`) | Unauthenticated JSON, markets `america`, `indonesia`, … Vendor client like the Tavily one. Terms risk noted in the module; computed fallback from bars when it fails. |
| Web research | existing `web_search` / `web_fetch` tools | Bound when a Tavily/Brave key is saved. |
| IDX aliases | `universe.json` | `BBCA` → `BBCA.JK`. Not a restriction. |

## Phases

- **T1 core (done in v1, rewritten in v2):** `watch-schemas.ts`, relaxed `advice-guard.ts`, `technicals.ts`, `symbols.ts`, `market-clock.ts`, `chart-builder.ts`, `briefing-prompt.ts` (default ID/EN prompts, system prompt, packet block, allowed numbers), `artifacts/market-briefing.ts`.
- **T2 host:** `market/yahoo.ts`, `market/tradingview.ts`, `market/macro.ts`, `market/repo.ts`, `market/packet.ts`, `market/tools.ts` (`market_quotes`, `market_history`, `market_technical`, `market_news`, `market_macro`), `market-generate.ts`, `market-briefing-build.ts`, `market-docx.ts`, handlers, routes.
- **T3 studio:** `market-studio.tsx`, `market-briefing-view.tsx` (chart per ticker via `SvgChart`), `lib/market-client.ts`.
- **T4 pack + verify:** `0.14.25-changelog.md`, `features/market.md`, pack checklist, packaged drive.

## Later

- Schedule (the Hermes cron equivalent) and delivery to Telegram/Discord. Not now.
- MCP exposure of the same tools once people like the mode.
- More TradingView markets (uk, japan, hongkong) are a symbol-map change.

## Decisions taken

1. No loopback exception, in-process TypeScript (Kyo, 2026-09-09).
2. Installer size is not a constraint; v2 adds no new dependencies over v1.
3. Market on Home by default, hidden on Legal / Marketing / Students like Finance and Data.
4. Ranking and targets are analysis, allowed; imperatives are not (Kyo's prompt, 2026-09-09).
5. OJK review of the disclaimer wording before public release remains open.
