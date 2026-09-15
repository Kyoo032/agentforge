# Images

Images is a generate studio (prompt → gallery), not a canvas editor. It lists gateway image model ids. Without a Toko Token key the page still renders and shows a needs-key note. Live generate is an operator pass on this machine, never Cloud.

## Sub-features

- `images-rail` reaches `/images` from `mode-images` on Default.
- `images-shell` shows `images-studio` (heading Images, prompt bar, gallery).
- `images-needs-key` shows `images-studio-needs-key` when no gateway key is ready.
- `images-empty` shows `images-studio-empty` ("Nothing here yet") when the gallery has no items.
- `images-estimate` shows the pre-generate cost line `images-studio-estimate` under the controls row (provider list price per image, source + checked date, a cheap/mid/premium word) with `images-studio-estimate-compare` beneath it; an id with no transcribed price shows `images-studio-estimate-unknown` instead. Each `images-studio-model` option ends with its own `$x.xx/img` tag. Table: [`docs/internal/research/media-pricing.md`](../../../../docs/internal/research/media-pricing.md).

## How to get to it (user POV)

- Choose Images on the left rail (`mode-images`). Default already has the tab.
- Open `http://127.0.0.1:3000/images` when the tab is unlocked. A hidden generate URL redirects to the first visible mode.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-images` is visible on Default. If count is 0, you are on a desk that hid Images (e.g. Legal) — not a missing agent.
- Stub / no-key proof stops at the shell. Do not click `images-studio-submit` unless the operator asked for a live generate and doctor reports `ai`.

- **Open Images.** Click `mode-images`. URL matches `/images` (15s). `images-studio` is visible (15s).
- **No-key state.** If doctor `hasOpenai` is false, `images-studio-needs-key` is visible and mentions Settings.
- **Empty gallery.** When there are no saved images, `images-studio-empty` is visible.
- **Cost estimate.** With a model selected, `images-studio-estimate` is visible and starts with `≈ $`. Switch `images-studio-model` to another priced id and the line changes (number, vendor, or tier word). Pick an id the table does not carry (`seedream-5.0-pro`, any `mj_*`) and `images-studio-estimate-unknown` replaces it. On a `gpt-image-*` id, switching `images-studio-aspect` square → portrait raises the number by half (OpenAI bills per output token, and a taller canvas is more tokens); landscape raises it too and leads with `~`. On a Google / xAI / ByteDance id the number does not move with aspect. No POST is involved — this is drivable with no key and no network: `GET /api/v1/images` builds the priced list from the curated table plus an already-cached gateway catalog, and only the POST handler calls `requireGatewayAllowed`. A selected model is the only requirement. Driven 2026-09-15 at 1440x900: `images-studio-estimate` read `≈ $0.03 per image · at medium quality · OpenAI list price, checked Sep 15, 2026 · cheap` and `images-studio-estimate-compare` read `About 4.2× cheaper than gemini-3-pro-image-preview`.
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Gambar`, `Belum ada apa pun`, `Buat gambar untuk mengisi galeri ini.` and `Buat`. Testids are locale-invariant.
- **IDE proof.** Screenshot of the studio shell (and needs-key if shown) under `evidence/images/<run-id>/`.
- **Cloud.** `foundation.spec.ts` asserts `images-studio` on Default. It does not generate an image.

## Gotchas

- The smoke does not assert `images-studio-needs-key`. Still require it for a no-key proof on this map.
- The studio posts to `/api/v1/images`, not `/runs/image`. `/runs/image` is fail-closed attach-and-analyze. A keyless submit is a 400, not a silent drop.
- A visible prompt bar is not a successful generate. Proof of generate is a gallery item (or a visible `images-studio-error`).
- Midjourney-style `mj_*` ids may appear in the picker when live. Stub has no live catalog.
- The estimate is the **provider list price**, not what Toko Token bills (the gateway rate is lower). A mismatch against a gateway invoice is expected, not a bug.
- The line leads with `≈` for an exact figure and `~` for a softened one — never both. `~` means the asked-for tier has no published price, the aspect multiplier is inexact (OpenAI landscape), or the row is low confidence (then "(unverified)" is appended too). OpenAI ids say "at medium quality" because their price is per output token, not per call.
- Read the source clause, not just the number. "… list price" is only used when the vendor’s own page carries the figure; "third-party figure" means a reseller/aggregator transcription (every ByteDance row today); "Unverified estimate, no vendor page" means nobody has a page and the row names no vendor.
- Nothing about the estimate reaches the network. On a desk whose gateway price catalog is not already cached, unpriced ids simply stay on `images-studio-estimate-unknown`.
