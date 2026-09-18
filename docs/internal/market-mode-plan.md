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

## Specialists (2026-09-17)

Kyo, in Indonesian: "Yg agent utk finance/saham, nama agennya dipisah masing2: saham, forex, gold, crypto, market scanner, market summary, elliot wave count, news aggregator dll." Market mode now offers separately named specialist agents, each with its own behaviour, inside the existing pipeline.

### Contract

`packages/core/src/market/specialists.ts` (ids in `specialist-ids.ts`, default instructions in `specialist-prompts.ts`, system rules in `specialist-rules.ts`; split so no file runs long):

- `MARKET_SPECIALISTS = ["saham", "forex", "gold", "crypto", "commodities", "indices", "sector-rotation", "scanner", "summary", "elliott-wave", "news"]`, `MarketSpecialist`, `DEFAULT_MARKET_SPECIALIST = "saham"`, `isMarketSpecialist(value)`.
- `MARKET_SPECIALIST_META: Readonly<Record<MarketSpecialist, MarketSpecialistMeta>>` — per agent an `id`, a `label` and a one-sentence `hint` in both languages, a `defaultPrompt` in both languages, a `starterTickers` list the symbol resolver accepts, and a distinct `focus` (`equities` / `fx` / `commodity` / `crypto` / `commodities` / `indices` / `rotation` / `scan` / `overview` / `waves` / `news`).
- `specialistSystemRules(specialist, language): readonly string[]` — the extra bullets appended to `buildWatchSystemPrompt` describing that desk's job.
- `defaultWatchPrompt(specialist, language)` for the studio's prefill.
- `MarketWatchRequest.specialist` and `marketBriefingSchema.specialist` are `z.enum(MARKET_SPECIALISTS).default(DEFAULT_MARKET_SPECIALIST)`.

### Decisions

1. **One pipeline, one desk per run.** An agent is a prompt contract, not a second code path: `loadPacket -> draftBriefing -> verifyBriefing -> saveBriefing` is untouched, and so are both guards, the disclaimer, the tool bindings, and the curated chat model default. `buildWatchSystemPrompt` keeps the shared rules (figures only from the packet, no imperative directive, JSON out) and appends the desk's rules under a `Your desk ("<label>"):` heading, so a new agent can never quietly drop a house rule.
2. **Both locales are first class.** Labels, hints, default prompts, and system rules are written separately in Indonesian and English; the Indonesian prompt is not a translation of the English one. The advice guard is asserted over every rule and every default prompt in `specialists.test.ts`, so an agent cannot ship a directive.
3. **Starters resolve, they are not invented.** Every starter ticker passes `isValidTicker` and `toYahooSymbol` in test. IDX names use the `universe.json` aliasing (`BBCA` → `BBCA.JK`), which also covers the nine sector-rotation proxies (`UNVR`, `ICBP`, `ANTM`, `ADRO`, `PGAS` included); FX uses the repo's verified `IDR=X` form for USD/IDR next to `EURUSD=X` / `USDJPY=X` / `DX-Y.NYB`; gold uses `GC=F` with `GLD` as the spot-tracking proxy (no fixture or test in this repo evidences `XAUUSD=X`, so it is not shipped) plus `GDX` and `NEM` as the miners; commodities ships `CL=F` / `NG=F` / `HG=F` / `SI=F` and **drops palm oil** — neither `KPO=F` nor `FCPO` is evidenced anywhere in this repo, and the CPO angle survives in the commodities rules as an Indonesia read-through instead.
4. **Elliott Wave needs citable levels.** `swingPoints(bars, lookback = 3, max = 12)` in `packages/core/src/market/swings.ts` returns the most recent pivot highs and lows as `{ date, price, kind }`, strict comparison so a plateau yields no pivot. The host packet builder computes them from the same six months of daily bars and stores them on `TickerPacket.swings` (zod optional, capped at `SWING_POINTS_MAX`). They are in `packetNumbers`, so the number guard accepts a swing level the model quotes, and they are rendered into `packetToPromptBlock` **only when the specialist is `elliott-wave`** — every other desk would pay prompt budget for levels it never labels.
5. **The agent travels with the artifact.** `persistBriefing` writes `specialist` into the artifact meta, the Markdown line under the title and the DOCX subtitle name the agent in the briefing's own language (`specialistLabel`), and `/api/v1/market/regenerate` reads `briefing.specialist` so a rewritten section obeys the same desk's rules as the sections around it.
6. **Guards unchanged.** `specialist` is not a forbidden field name; the C1 schema lint over the market schemas still returns clean.

### Left to the renderer

`apps/web` picks the agent (chips or a picker from `MARKET_SPECIALIST_META`), prefills the watchlist from `starterTickers` and the instruction from `defaultWatchPrompt`, and sends `specialist` on `/api/v1/market` and `/api/v1/market/stream`.
