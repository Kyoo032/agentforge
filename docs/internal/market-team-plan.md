# Market "analyst team" — plan and contract

Status: **core landed 2026-09-17** on `main` (host and renderer in parallel). Market Watch gains a second depth. `quick` is the single-pass briefing that has shipped since v2; `team` splits the same packet between four analysts, runs one bull-versus-bear round, reads the result through three risk lenses, and has a synthesis write the briefing. Same pipeline, same guards, same disclaimer — one more depth, not a second product.

Source of ideas: [TradingAgents](https://github.com/TauricResearch/TradingAgents) (Apache-2.0). The shape of the team is adapted; no prompt text is copied. Everything in `packages/core/src/market/team*.ts` is written from scratch in Indonesian and English. If a literal snippet is ever reused, the comment beside it must read "adapted from TradingAgents (Apache-2.0)".

## What we adopt

1. **Four analysts with disjoint views.** Fundamentals, sentiment, news, technical. The value is not four models — it is four *slices*: an analyst that reads everything writes the same note as the desk did in one pass. `analystSections(analyst)` is therefore the whole design.
2. **A bull/bear researcher debate.** One round: the bull builds a case from the notes, the bear answers the bull's own JSON. Disagreement is the output, not a problem to resolve.
3. **Risk lenses.** Aggressive, neutral, conservative — the same evidence weighed three ways, in one call.
4. **No tools for the analysts.** TradingAgents found tool-calling analysts drift and re-fetch. Ours read a pre-fetched packet block and nothing else; only the synthesis keeps the desk's harness tools.

## What we refuse, and why

| Refused | Why |
|---|---|
| Trader agent | Its output is a decision. Market mode's first principle is "analysis, not a directive" (`market-mode-plan.md`, principle 3). |
| Portfolio manager, position sizing, allocation | Same reason, plus it is investment advice with a licence attached to it. `FORBIDDEN_FIELD_NAMES` already bans `position` and `allocation` on any market schema. |
| Execution / order layer | Out of scope for a local reading desk, and the one irreversible thing in this domain. |
| Five-tier BUY…SELL ratings | A rating *is* an imperative with a label on it. The advice guard would not catch it (it scans phrases), so the refusal has to live in the prompts and the schema — hence `riskReadSchema` and `teamNotesSchema` carry no rating field and the synthesis prompt says "no rating" in both languages. |
| Price targets | A model-derived target is a number that is not in the packet: the number guard would stamp `[unverified figure]` on it anyway. A target *from the reader's own position context* stays allowed, as it has always been. |
| Reflection / memory across runs | Later, if ever. It is a second store and a second privacy question. |

The guards are unchanged and now run twice: over the synthesis output, and over every free-text field of the stored `team` notes (`guardAdviceInText` + the number guard) so the stored notes are as clean as the rendered sections.

## Pipeline

```
packet (fetched + computed in code, as today)
  ├─ analyst × n, in parallel (concurrency 2), each seeing only analystSections(analyst)
  ├─ bull      (reads the analyst notes)
  ├─ bear      (reads the analyst notes + the bull's JSON)   ← one round, TEAM_ROUNDS = 1
  ├─ risk      (one call, three lenses)
  └─ synthesis (writes {title, sections[]}, keeps the desk's harness tools)
      → verifyBriefing (number guard + advice guard) → artifact
```

Failure is degradation, never a crash: a failed analyst becomes `unavailableAnalystNote(analyst)` (`summary: "<unavailable>"`, `confidence: "low"`) and a line in `failures[]`, and the synthesis is told to weigh the absence. `depth: "team"` on a desk with no analysts falls back to quick plus a failure note.

## Per-specialist analysts

`MarketHarnessSpec.analysts`, in dispatch order. `teamAvailable(specialist)` is `analysts.length > 0`.

| Desk | Analysts | Why |
|---|---|---|
| saham | technical, fundamentals, sentiment, news | The only desk with all four inputs: filings, a crowd, headlines and a chart. |
| crypto | technical, sentiment, news | No filings to read; the crowd is the loudest real signal in the asset class. |
| forex | technical, news | A currency pair has no fundamentals row and no meaningful ticker crowd. |
| gold, commodities, indices | technical, news | Same: chart plus macro news. |
| summary | news | A cross-market overview is a news read; the rest would be four analysts on two lines of quotes. |
| news | news, sentiment | Its job is the story and how it landed. |
| scanner, sector-rotation, elliott-wave | *(none)* | They narrate a table code already computed. There is nothing for four analysts to disagree about, and eight calls to find that out is not a feature. |

## Data sources for the new packet sections

All keyless, all host-side, all cached in `market_cache` with named TTLs, all zod-validated, all free text through the existing sanitize / injection scan and `maskPii`.

| Section | Source | Notes |
|---|---|---|
| `fundamentals`, `insiders` | `yahoo-finance2` `quoteSummary` (MIT) | Already a dependency. `.JK` names usually carry no insider transactions — the section is then omitted, never zero-filled. The 90-day window is computed in code (`INSIDER_WINDOW_DAYS`). |
| `sentiment.stocktwits` | `api.stocktwits.com/api/2/streams/symbol/<SYM>.json` | Unauthenticated JSON, same class of terms risk as the TradingView scanner: vendor-client comment in the module, graceful skip on failure. Crypto maps `BTC-USD` → `BTC.X`; `.JK` is skipped (no coverage). |
| `sentiment.reddit` | `reddit.com/r/<sub>/search.rss` | Self-identifying User-Agent, 1 s between requests, one retry honouring `Retry-After` on 429. Titles only. |
| `globalNews` | `yahoo-finance2` `search(query)` over the five fixed queries in `global-news-queries.ts` | The queries are fixed in code on purpose: a desk that phrases its own macro search is steering the feed. Deduped by title, ≤ 10 rows, each row keeps the query that surfaced it. |

**Injection.** Crowd posts are the most attacker-friendly text this product has ever fetched. Three defences: the host runs the existing injection scan and PII mask before the packet is built; samples are titles only, ≤ 160 characters, ≤ 6 per ticker; and the prompts tell every analyst that a sampled post is *mood, not data*. On top of that, `packetNumbers` deliberately does **not** allow figures quoted inside a sample, so "MU to 4242" repeated as fact comes back as `[unverified figure]`. Macro headline figures *are* allowed, exactly as ticker headlines already are — they carry a publisher.

## Cost

Up to `TEAM_MAX_CALLS = 8` model calls (4 analysts + bull + bear + risk + synthesis), enforced by the host. A saham run is 8; forex, gold, commodities, indices are 6; summary is 5. Analysts get no tools, so their calls are short.

**Decision: quick stays the default** (`DEFAULT_MARKET_DEPTH = "quick"`, and `marketWatchRequestSchema.depth` defaults to it). A pre-market glance at eleven tickers should not cost eight calls, and the team is worth paying for on a name the reader is actually thinking about. Team is a control the reader reaches for, never something that happens to them.

## Core surface (host and renderer code against this)

- `team.ts` — `MARKET_DEPTHS`, `DEFAULT_MARKET_DEPTH`, `MARKET_ANALYSTS`, `CONFIDENCE_LEVELS`, `DEBATE_STANCES`, `RISK_LENSES`, the caps, `TEAM_ROUNDS = 1`, `TEAM_MAX_CALLS = 8`, `ANALYST_UNAVAILABLE`, `analystNoteSchema`, `debateSideSchema`, `riskLensSchema`, `riskReadSchema`, `teamNotesSchema`, `unavailableAnalystNote(analyst)`, `analystsFor(specialist)`, `teamAvailable(specialist)`.
- `team-prompts.ts` — `analystSections(analyst)`, `analystPacketOrder(analyst, specialist)`, `analystSystemPrompt(analyst, specialist, language)`, `bullPrompt(specialist, language)`, `bearPrompt(specialist, language)`, `riskPrompt(specialist, language)`, `synthesisPrompt(specialist, language)`, `teamSectionHeadings(language)`, `TEAM_SECTION_KEYS`.
- `briefing-prompt.ts` — `packetToPromptBlock(packet, specialist, only?)`: `only` narrows the desk's `packetOrder`, never widens it. The host builds an analyst's block with `packetToPromptBlock(packet, specialist, analystSections(analyst))`.
- `watch-schemas.ts` (re-exporting `team-source-schemas.ts`, `watch-refs.ts`) — `tickerFundamentalsSchema`, `tickerInsidersSchema`, `tickerSentimentSchema`, `globalNewsItemSchema` and their caps; `MarketWatchRequest.depth`.
- `harness.ts` — `MARKET_SOURCES` gains `fundamentals | insiders | sentiment | globalNews`; `MarketHarnessSpec.analysts`.
- `artifacts/market-briefing.ts` — `marketBriefingSchema.depth` (default `quick`) and `.team?`.

## Open

1. StockTwits and Reddit terms: same standing risk as the TradingView scanner. Revisit before any public, non-local distribution of the fetched text.
2. ~~A team appendix in the DOCX~~ — shipped 2026-09-17 (`packages/host/src/market-docx.ts`, Team block before the sources).
3. Two debate rounds, only if a run shows the one round ending on an unanswered point often enough to matter.
