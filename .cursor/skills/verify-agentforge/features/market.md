# Market

Market is a job: a watchlist of up to 15 tickers from any market plus a briefing instruction → the host fetches quotes, two years of bars, TradingView ratings, headlines, and macro levels on the user's machine, builds a chart per ticker, and the model writes a briefing (Bahasa Indonesia by default) over that data packet → guarded briefing → DOCX. It is analysis, not investment advice, and it never tells the reader to buy or sell now. Runs inside the host like Research, Data, and Finance: no server, no sidecar, no port, no Settings fields. Landed on `feat/market-mode` (2026-09-09, v2); see `docs/internal/0.14.25-changelog.md` and `docs/internal/market-mode-plan.md`.

## Sub-features

- `market-rail` reaches `/market` from `mode-market` on Home, between Data and Images.
- `market-shell` shows `market-studio`, `market-inputs` with the chip input `market-watchlist-input` (`market-tickers`, chips `market-ticker-chip`), `market-prompt` prefilled with the default briefing, `market-position`, `market-language`, `market-maxchars`, `market-studio-model`, `market-enhance`, three `market-starter` cards, `market-generate`.
- Generate without a gateway key shows `market-error` "Market needs a live gateway…" (HTTP 503, `runtime_stub`). An unresolvable symbol is listed in `market-failures`, never a crash.
- Live generate runs `market-progress` phases resolving → quotes → technicals → charts → news → macro → drafting (with "Still drafting… Ns" heartbeats) → verifying → saving.
- `market-preview` renders `market-clock` (session badge `data-session` pre / regular / post / closed + note), the model sections `market-section` with `market-section-regen`, `market-guard` (`data-clean`), `market-watchlist` rows, a `market-ticker-card` per ticker with `market-chart` (SVG line: close, SMA50, SMA200), `market-ticker-facts`, `market-headline` links, `market-macro` rows, `market-sources`, `market-disclaimer` (stamped by code, never editable), `market-failures` (sources that were down; a note, not a fail).
- `market-download` builds a DOCX with the disclaimer under the title and as the last paragraph; charts export as tables. `market-send-kb` (type Brief), `market-make-document`, `market-make-presentation` via the shared artifact actions.

## How to get to it (user POV)

- Choose Market on the left rail (`mode-market`). Home has the tab.
- Open `http://127.0.0.1:3000/market` when the tab is unlocked.
- Legal / Marketing / Students presets do not add this tab unless the owner checks it.
- Nothing to install and nothing to configure beyond the gateway key. Web search is used when a Tavily/Brave key exists; otherwise headlines come from Yahoo.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0 and `modeKeys` includes `market`.
- `mode-market` is visible on Home. If count is 0, you are on a desk that hid it.
- Stub proof stops at chips, starters, and generate 503. Live generate only if the operator asked and doctor reports `runtime: "ai"` and `hasOpenai: true`. Live needs the internet for Yahoo Finance and the TradingView scanner; a source that is down shows in `market-failures` and the briefing still builds.
- Unit proof is Vitest in `packages/core` (`src/market`), `packages/host` (`src/market`, `market-generate`, `market-briefing-build`, `market-docx`, `handlers/market`) and `apps/web` (`market-client`). No sockets in tests.

- **Open Market.** Click `mode-market`. URL matches `/market`. `market-studio`, three `market-starter`, `market-prompt` non-empty in Bahasa Indonesia.
- **Starter.** Click the first `market-starter` ("US pre-market favorites"). 11 `market-ticker-chip` appear (MU … SPCX). Type `bbca` + Enter in `market-tickers` → chip `BBCA`.
- **Generate without a key.** Click `market-generate`. `market-error` mentions gateway / Settings / API key.
- **Live.** Only after doctor `ai`: paste `MU: $100 @ $860, $200 @ $900, target $1,000` in `market-position`, generate. Phases complete (drafting may take 1–2 min), `market-clock` shows the real session, one `market-ticker-card` and one drawn `market-chart` per chip, `market-watchlist` rows carry TradingView labels, `market-macro` has 10 rows, sections are in Indonesian, `market-guard` reads clean, `market-disclaimer` visible.
- **IDX.** Chips `BBCA, BBRI, BMRI, TLKM` → quotes in IDR, TradingView labels, IHSG and USD/IDR in `market-macro`.
- **Rewrite.** Click a `market-section-regen`, type "Ringkas jadi 3 poin, pertahankan angka." in `market-regen-prompt`, click `market-regen-submit`. The section changes; `market-guard` stays clean.
- **Download.** Click `market-download`. DOCX first page and last paragraph carry the disclaimer.

## Gotchas

- A briefing that reads "beli sekarang", "jual sekarang", "buy now", "sell now", "you should buy" is a C1 leak: the sentence is replaced with `[removed: directive language]` and counted in `market-guard`; the API rejects such a briefing on `/market/docx` and `/market/regenerate` with 502 `advice_leak`. Ranking, sentiment, targets, and levels are allowed.
- `[unverified figure]` in a section means the model wrote a number that is not in the packet, the headlines, or the position context. One or two on a long briefing is a note; many is a fail (check the packet block rounding).
- A run outside 04:00–09:30 ET is labelled by `market-clock`; the default prompt tells the model to say so. That is correct behaviour, not a bug.
- Yahoo or TradingView being down is a note when the briefing still builds from the rest; a fail only when the studio hangs or invents figures.
- Do not POST `/api/v1/market` as a substitute for the studio on a live proof.
- The operator's `:3000` desk does not restart on host changes; drive new host code on an isolated instance (`PORT=3177`, own `AGENTFORGE_DATA_DIR` + `AGENTFORGE_SETTINGS_PATH`), and delete that data dir afterwards if a key was saved there.
