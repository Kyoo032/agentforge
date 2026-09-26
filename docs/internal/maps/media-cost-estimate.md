# Map — Media cost estimate

Last verified: 2026-09-26 (an unknown price is omitted; the `*-estimate-unknown` row is not rendered). Before that: 2026-09-20 at c204e5e.

## Overview

The line under the prompt bar in the Images and Videos studios that reads roughly `≈ $0.03 per image` before the user presses Generate. It is a **provider list-price estimate from a curated table**, not a quote and not billing: the gateway bills its own (lower) rate, there is no IDR and no credit balance in it. It exists to answer "which of these two models is dearer" at the moment of choosing, the way Google Flow and BytePlus Lumina do.

Nothing on this path touches the network. The price table is compiled into the app, the host attaches a price (or `null`) to each model row on the studio's GET, and a pure renderer function turns that into a string.

## How it works

**User opens the Images studio.** `ImagesStudio` fetches `GET /api/v1/images` on mount (`apps/web/components/images-studio.tsx:59`, effect at `:80`). Videos does the same against `/api/v1/videos`.

**Host enriches the model list.** `handleGetImages` (`packages/host/src/handlers/jobs.ts:39`) wraps `listStudioImageModels()` in `attachMediaPrices(..., "image", cachedPricingCatalog(resolvedGatewayBaseUrl()), ...)` at `packages/host/src/handlers/jobs.ts:48-53`; videos at `:79-84` with unit `"second"`. `attachMediaPrices` (`packages/host/src/media-price.ts:72-83`) returns a new array — it never mutates the model list — where each row gains `price: MediaPrice | null`.

**Price lookup, curated first.** `findMediaListPrice(model.id)` (`packages/core/src/models/media-pricing.ts:497-508`) tries an exact lowercased id against `EXACT_INDEX`, then walks the ordered regex `pattern`s; narrower patterns (`-fast`, `-mini`, `-1.5-preview`) sit above their family so they win. 23 curated entries, `CHECKED = "2026-09-15"` (`packages/core/src/models/media-pricing.ts:98`). Miss → the gateway fallback below → else `null`. Nothing is ever fabricated.

**Gateway fallback is cache-only.** `gatewayFlatPrice` (`packages/host/src/media-price.ts:35-69`) fires only for `unit === "image"`, only from an already-cached `PricingCatalog`, only for a flat row (`quotaType === 1 && modelPrice > 0`, not `isUnpricedBilling`), and computes `modelPrice * DEFAULT_GROUP_RATIO` (`= 1`, `packages/core/src/gateway.ts:99`), tagged `origin: "gateway"`, `confidence: "medium"`. The catalog comes from `cachedPricingCatalog()` (`packages/host/src/account-usage.ts:164-170`), which **reads the 10-minute in-memory cache and never fetches** (`PRICING_TTL_MS = 10 * 60 * 1000`, `packages/host/src/account-usage.ts:47`). The cache is warmed by the Settings Usage panel (`loadAccountUsage` / `pricingFor`), not by the studio. On a desk that has not opened Usage recently, or has no key, the fallback is simply `null`.

**Renderer computes the string, from state only.** `apps/web/components/images-studio.tsx:85` — `useMemo(() => imageEstimateView({ model, models, aspect }))`; Videos also depends on `seconds` and `resolution` (`apps/web/components/videos-studio.tsx:112-121`). `imageEstimateView` / `videoEstimateView` (`apps/web/lib/media-estimate.ts:196-226`) call `estimateImageCost` / `estimateVideoCost` and format through `t()` + `formatUsd`. Rendered at `apps/web/components/images-studio.tsx:174-187` and `apps/web/components/videos-studio.tsx:258-271`.

**Failure modes**

| Case | What happens |
|---|---|
| Model has no curated entry and no cached catalog row | `price: null` → the studio renders nothing for the price line (no `*-estimate-unknown` row) |
| Priced model, missing tier (e.g. `seedance-2.5` at 1080p) | `resolveTier` (`packages/core/src/models/media-pricing.ts:514-541`) falls to the nearest lower published tier, else higher, sets `approx: true`; the UI leads with `~` instead of `≈` (`apps/web/lib/media-estimate.ts:173`) |
| Low-confidence row (`omni-fast`, empty vendor) | `~`, no vendor name, explicit "(unverified)" suffix (`apps/web/lib/media-estimate.ts:184-185`) |
| Catalog cache gone stale | Treated as no catalog: the gateway-fallback price disappears rather than going wrong |
| Gate closed / no key | **No effect on the estimate.** `requireGatewayAllowed` is called from `handlePostImages` / `handlePostVideos` only (`packages/host/src/handlers/jobs.ts:71` and the video equivalent), never from the GETs that build the price list |
| Bad inputs | `count` clamps to `>= 1` and a whole number (`packages/core/src/models/media-pricing.ts:575`); `seconds` clamps to `>= 1` and may stay fractional (`:586`) |
| Upstream vendor changes its price | Nothing detects it. See Gotchas |

## Where things live

| File | Role |
|---|---|
| `packages/core/src/models/media-pricing.ts` | The table (`MEDIA_PRICE_ENTRIES`) plus the pure math: `findMediaListPrice`, `estimateImageCost`, `estimateVideoCost`, `costTier`, `relativeFactor`. Browser-safe, no Node imports |
| `docs/internal/research/media-pricing.md` | The human dossier behind the table: sources, confidence, derivations, aliases, fallback rules |
| `packages/host/src/media-price.ts` | `attachMediaPrices`, `gatewayFlatPrice` — host enrichment of studio model rows |
| `packages/host/src/account-usage.ts` | Owns the 10-minute pricing cache; `cachedPricingCatalog()` is the read-only door into it |
| `packages/host/src/handlers/jobs.ts` | Wires enrichment into `GET /api/v1/images` and `GET /api/v1/videos` |
| `apps/web/lib/media-estimate.ts` | `imageEstimateView`, `videoEstimateView`, `mediaPriceHint(s)` — `MediaPrice` → translated strings |
| `apps/web/components/images-studio.tsx`, `videos-studio.tsx` | Fetch, memoise the estimate, render it |
| `packages/core/src/gateway.ts:95-118` | `DEFAULT_GROUP_RATIO`, `formatUsd` |

`MediaPrice` shape (`packages/core/src/models/media-pricing.ts:20-58`): `{ vendor, unit: "image" | "second", tiers, defaultTier, source, citation?, checkedAt, confidence: "high" | "medium" | "low", origin: "list" | "gateway", aspectMultipliers?, note? }`. USD only.

## Gotchas

- **The table is hand-maintained and nothing checks it.** `CHECKED` is a date someone typed. There is no staleness alarm, so a shown number can drift silently from the vendor's current list price until a human re-reads the vendor pages and edits **both** `packages/core/src/models/media-pricing.ts` and `docs/internal/research/media-pricing.md`. They move in lockstep or the doc is a lie.
- **This is not the gateway's price.** Treating the estimate as what the desk will be charged is the main way to misread this feature. It is the provider's public list price, for comparison only.
- **A closed gate does not hide the estimate**, because the price comes from the GET route, which is deliberately ungated. The block lands on Generate, not on the number.
- **Video never takes the gateway fallback.** `gatewayFlatPrice` refuses anything but `unit === "image"`, because a flat per-call gateway rate cannot be turned into a per-second price. So an unpriced video model always reads "no list price".
- **`≈` vs `~` is load-bearing.** `≈` means the exact published tier was used; `~` means a tier was substituted or the row is unverified. Do not normalise them in copy edits.
- Some models have no price **by design** (`seedream-5.0-pro`, the Alibaba `wan2.7-image*` / `qwen-image*` / `z-image-turbo` family, every `mj_*` Midjourney action) — see `docs/internal/research/media-pricing.md:63-65`.

## Verify

`.cursor/skills/verify-agentforge/features/images.md` and `features/videos.md`.

Testids that prove a priced model: `images-studio-estimate` and `images-studio-estimate-compare`; `videos-studio-estimate` and `videos-studio-estimate-compare`. An unpriced id leaves those nodes out. Switching `images-studio-aspect` or `videos-studio-seconds` must move the number without any network call.

Unit tests: `packages/core/src/models/media-pricing.test.ts` (table invariants, alias resolution, both cost functions, tier fallback → `approx`, clamps), `packages/host/src/handlers/jobs.test.ts:57-96` (curated beats catalog; flat-row-only fallback; `null` with no catalog; input array untouched), `apps/web/lib/media-estimate.test.ts` (line assembly, comparison sentences, aspect scaling, currency formatting).
