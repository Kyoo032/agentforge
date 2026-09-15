# Media list prices (images + videos)

Checked **2026-09-15**. Source of truth for `packages/core/src/models/media-pricing.ts`; change one and change the other in the same commit. Every Source cell below matches the `source` / `citation` pair on the matching code row — if they ever disagree, the code is wrong.

These are the **model provider's own USD list prices**, not what DPSBuddy pays. Toko Token bills its own rate (currently below list) and the studios say so: the copy reads "estimate at provider list price". Nothing here is billing, credits, or IDR — it exists so a creator can see, before pressing Generate, that `gpt-image-2.5` costs several times what `nano-banana` costs, and that `seedance-2.5` is the dear end of video while `omni-fast`, `seedance-2.0-fast` and `-mini` are the cheap end.

## Truthfulness rules

A price string reaches the UI verbatim, so the row has to be able to back it.

- `source` is an `https://` **vendor page only when that page carries the figure**. Anything else is a non-URL marker — `repo:docs/internal/gateway-model-selection.md`, `thirdparty:byteplus-modelark-rate-card`, `thirdparty:cometapi-citing-byteplus` — and must also set `citation` naming where the number really came from. A test enforces both directions.
- No URL in the table points at a private repository: a `source` value ships inside `GET /api/v1/images` and `/videos`, so a `github.com/Kyoo032/...` link would leak into the client payload.
- The studio line follows from that pair, not from the vendor field alone:
  - vendor URL → "{vendor} list price, checked {date}"
  - `citation` set → "{vendor} price, third-party figure, checked {date}"
  - `confidence: "low"` → "Unverified estimate, no vendor page" (plus `~` and "(unverified)"), and the row carries **no vendor name at all**
  - gateway fallback → "Gateway price, checked {date}"
- `checkedAt` is the day the row was last reviewed against whatever its `source` names. It is not a claim that a vendor page was read that day — that is exactly why the two repo-derived rows below never render the words "list price".

## How to read a row

- **Unit** — `image` (per image) or `second` (per second of output). A video estimate is `per-second price × clip length`.
- **Tiers** — quality (`low` / `medium` / `high`) for images priced per output token, resolution (`480p` / `720p` / `1080p` / `4k`) for video, `default` for a flat per-image price. Image rows never carry a `4k` tier: the studio has no output-size control, so a tier nobody can ask for would only be dead data (see "Tiers not modelled" below).
- **Default tier** — what the studio shows when the user has not picked. Every row must have a positive price at its default tier (asserted in `media-pricing.test.ts`).
- **Missing tier** — the estimate falls back to the nearest **lower** published tier (or the nearest higher when there is none) and is flagged `approx: true`. The UI then leads with `~` instead of `≈`. A flat single-price row is *not* approximate just because a quality was requested — it has no tiers to miss.
- **Confidence** — `high` = read off the vendor's own pricing page; `medium` = a vendor rate card seen through a reseller or derived from a repo note; `low` = unverified, shown with `~` and "(unverified)" and attributed to nobody.

## Images (USD per image)

| Gateway id | Vendor | low | medium / default | high | Source (`source` → `citation`) | Confidence |
|---|---|---|---|---|---|---|
| `gpt-image-1` | OpenAI | 0.011 | **0.042** | 0.167 | `https://developers.openai.com/api/docs/pricing` | high |
| `gpt-image-1-mini` | OpenAI | — | **0.008** | — | `https://developers.openai.com/api/docs/pricing` | high |
| `gpt-image-2`, `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `gpt-image-2-count` | OpenAI | 0.008 | **0.032** | 0.125 | `https://developers.openai.com/api/docs/pricing` | high |
| `nano-banana` (= `gemini-2.5-flash-image`) | Google | — | **0.039** | — | `https://ai.google.dev/gemini-api/docs/pricing` | high |
| `nano-banana-2` (= `gemini-3.1-flash-image`) | Google | — | **0.067** | — | `https://ai.google.dev/gemini-api/docs/pricing` | high |
| `nano-banana-pro` (= `gemini-3-pro-image-preview`) | Google | — | **0.134** | — | `https://ai.google.dev/gemini-api/docs/pricing` | high |
| `gemini-3.1-flash-lite-image` | Google | — | **0.0336** | — | `https://ai.google.dev/gemini-api/docs/pricing` | high |
| `seedream-4.0` | ByteDance | — | **0.03** | — | `thirdparty:byteplus-modelark-rate-card` → BytePlus ModelArk rate card, read through a reseller listing, not the vendor page | medium |
| `seedream-4.5` | ByteDance | — | **0.04** | — | `thirdparty:byteplus-modelark-rate-card` → same | medium |
| `grok-imagine-image` | xAI | — | **0.02** | — | `https://docs.x.ai/developers/pricing` | high |
| `grok-imagine-image-2.0` | xAI | — | **0.04** | — | `https://docs.x.ai/developers/pricing` | high |
| `grok-imagine-image-quality` | xAI | — | **0.05** | — | `https://docs.x.ai/developers/pricing` | high |

### OpenAI: from output tokens to a per-image price

OpenAI prices image output per token, not per image. The figures above are `output $/1M tokens × tokens for one 1024×1024 image`, using OpenAI's published token counts: **272** (low), **1056** (medium), **4160** (high). So `gpt-image-1` at $40/M gives 0.011 / 0.042 / 0.167; the `gpt-image-2` line at $30/M gives 0.008 / 0.032 / 0.125; `gpt-image-1-mini` at $8/M gives ≈0.008 at medium. That is why those rows carry `note` and why the studio line says "at medium quality" — the number is per-quality, not per-call.

**Aspect moves the price on these rows**, because a taller or wider canvas is more tokens. OpenAI's own table:

| Quality | 1024×1024 (square) | 1024×1536 (portrait) | 1536×1024 (landscape) |
|---|---|---|---|
| low | 272 | 408 | 400 |
| medium | 1056 | 1584 | 1568 |
| high | 4160 | 6240 | 6208 |

Portrait is **exactly** 1.5× square at every quality (408/272, 1584/1056, 6240/4160). Landscape drifts — 400/272 = 1.471, 1568/1056 = 1.485, 6208/4160 = 1.492 — so the table stores **1.48** and marks it inexact; a landscape estimate therefore renders with a leading `~`. This lives on the row as `aspectMultipliers: { square: {1, exact}, portrait: {1.5, exact}, landscape: {1.48, inexact} }`. Rows where the vendor bills a flat price per image (Google, xAI, ByteDance) carry no multipliers and do not move with aspect.

### Tiers not modelled

Google publishes a 4K image tier — `nano-banana-2` $0.151, `nano-banana-pro` $0.24 — that the code deliberately omits. The Images studio has aspect and model, no output-size control, so a `4k` image tier could never be selected and `estimateImageCost` has no way to ask for it. Recording it would be data that silently never applies. The figures are kept here (and in each row's `note`) so they are one edit away if a size control lands.

### No list price on file

`seedream-5.0-pro` (BytePlus quotes it in CNY per image plus a per-input-image add-on; not transcribed), `doubao-seedream-5-0-260128`, the Alibaba `wan2.7-image*` / `qwen-image*` / `z-image-turbo` family, and every `mj_*` Midjourney action (a gateway-set flat price, not a vendor list price). These fall through to the gateway catalog fallback below, and otherwise show "No list price on file for this model".

## Videos (USD per second of output)

| Gateway id | Vendor | 480p | 720p | 1080p | 4K | Source (`source` → `citation`) | Confidence |
|---|---|---|---|---|---|---|---|
| `veo_3_1` | Google | — | **0.40** | 0.40 | 0.60 | `https://ai.google.dev/gemini-api/docs/pricing` | high |
| `veo_3_1-fast` | Google | — | **0.10** | — | 0.30 | `https://ai.google.dev/gemini-api/docs/pricing` | high |
| `veo-3.1-lite` | Google | — | **0.05** | — | — | `https://ai.google.dev/gemini-api/docs/pricing` | high |
| `grok-imagine-video` | xAI | 0.05 | **0.07** | — | — | `https://docs.x.ai/developers/pricing` | high |
| `grok-imagine-video-1.5-preview` | xAI | 0.08 | **0.14** | 0.25 | — | `https://docs.x.ai/developers/pricing` | high |
| `seedance-2.5` | ByteDance | 0.103 | **0.231** | — | — | `thirdparty:cometapi-citing-byteplus` → CometAPI citing BytePlus, not the vendor page | medium |
| `seedance-2.0` | ByteDance | 0.07 | **0.15** | 0.37 | 0.78 | `thirdparty:byteplus-modelark-rate-card` → BytePlus ModelArk rate card, read through a reseller listing | medium |
| `seedance-2.0-fast` | ByteDance | 0.06 | **0.12** | 0.30 | — | `thirdparty:byteplus-modelark-rate-card` → same (1080p derived, see below) | medium |
| `seedance-2.0-mini` | ByteDance | 0.04 | **0.08** | 0.185 | — | `thirdparty:byteplus-modelark-rate-card` → same (1080p derived, see below) | medium |
| `happyhorse-1.1-i2v` | Alibaba | — | **0.14** | 0.18 | — | `repo:docs/internal/gateway-model-selection.md` → transcribed from vendor announcements | medium |
| `omni-fast`, `omni-fast-v2v` | *(none claimed)* | — | **0.10** | — | — | `repo:docs/internal/gateway-model-selection.md` → transcribed from vendor announcements | low |

Notes:

- `veo_3_1` bills the same at 720p and 1080p, audio included; only 4K steps up.
- `grok-imagine-video` has no 1080p tier upstream, so a 1080p request falls back to 720p and is flagged approx.
- `seedance-2.5` has no published 1080p rate yet; a 1080p clip is estimated at the 720p rate with `~`.
- The `seedance-2.0-fast` / `-mini` 1080p figures are derived from the repo's own "~20% / ~50% below 2.0" note, not from a published tier.
- `omni-fast` is the weakest row in the table. The model behind the id is not identified — the best hypothesis is Google Gemini Omni Flash — so the row claims **no vendor**, renders "Unverified estimate, no vendor page", and always shows `~` plus "(unverified)". It must never appear as a Google list price.
- `mj_video` has no per-second vendor price (Midjourney is a flat per-action gateway price), so it shows "No list price on file for this model".

## Aliases

The gateway ships several ids per model. `findMediaListPrice` tries the exact id first, then an ordered regex list, so these all land on the right row: `dreamina-seedance-2-5`, `doubao-seedance-2-0-260128`, `dreamina-seedance-2-0-fast-260128`, `doubao-seedance-2-0-mini-260615`, `veo-3.1-fast`, `veo_3_1-fast`, `gpt-image-2-count`, `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`, `doubao-seedream-4-5-251128`. The narrower pattern always sits above the family it belongs to (`-fast` / `-mini` / `-1.5-preview` before the base id), which the alias tests pin.

## Comparison sentences

The "About 1.9× cheaper than seedance-2.5" line is costed against the **same studio state** as the selected model, so 10 s at 1080p ranks the peers at 10 s at 1080p. When the peer it names was itself estimated from a fallback tier or is an unverified row, the sentence is prefixed with `~` — otherwise a confident-sounding ratio would rest on a price nobody published.

## Gateway catalog fallback

When no list price exists, the host may fall back to the gateway's own price list (`GET <origin>/api/pricing`). Only a **flat per-call** row qualifies — `quotaType === 1 && modelPrice > 0`, and never a `tiered_expr` row — and the price is `modelPrice × groupRatio`, the same arithmetic `estimateDeskUsd` uses. The result is marked `origin: "gateway"`, `confidence: "medium"`, `source` = the gateway pricing URL, and the studio line reads "Gateway price, checked …" instead of naming a vendor.

Three deliberate limits:

1. **Images only.** A flat per-call charge lines up with one image. It does not line up with a per-second video rate, so a video model with no list price stays `null` rather than showing a number that would be wrong the moment the clip length changes. Seedance video is `tiered_expr` in that catalog anyway, i.e. unpriceable.
2. **Cached only.** `cachedPricingCatalog()` reads the host's existing 10-minute catalog cache and never fetches. That cache is warmed by the Usage panel (`loadAccountUsage`), so on a desk that has not opened Usage recently — or has no key — the fallback is `null` for every model and unpriced ids simply show "No list price on file for this model". **That is the decision, not unfinished wiring:** the studio model list is on the page-open path and must not wait on a gateway round-trip, and a price is never worth a spinner.
3. **Never authoritative.** A gateway figure is what the gateway charges, not what the vendor lists, so it never uses the "list price" wording.

## Maintenance

- Re-check the vendor pages roughly quarterly; bump `CHECKED` in `media-pricing.ts` and the date at the top of this file together.
- A new gateway id with no row is not a bug — it shows the honest "no list price" line. Add a row when someone has actually read the vendor page.
- Promoting a row from `medium` to `high` means two things at once: swap `source` to the vendor URL **and** delete `citation`. The test refuses a row that has both.
- Never let a price reach the UI from a model's own output, a guess, or a reseller's marketing page without a `citation` and a dropped confidence.
