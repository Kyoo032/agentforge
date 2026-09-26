# Images

Images is a generate studio (prompt → gallery), not a canvas editor. It lists gateway image model ids. `images-studio-needs-key` and `images-studio-submit` both follow the host gate: the note shows and Generate is disabled only when `allowed` is false. A stub desk (`allowed: true`) hides the note and can still generate. Live generate is an operator pass on this machine, never Cloud.

## Sub-features

- `images-header` (0.15.0) — title plus one outcome line in `expected-inputs`: "You get: a generated image, saved to the gallery below." No disclosure on this studio; the rail row reads `Images`. Driven 2026-09-23 on a live desk: `images-studio-needs-key` count 0, `images-studio-estimate` starts with `≈ $`, submit not pressed.
- `images-rail` reaches `/images` from `mode-images` on Default.
- `images-shell` shows `images-studio` (heading Images, prompt bar, gallery).
- `images-needs-key` shows `images-studio-needs-key` only when the host set `allowed` false (`useDeskNeedsKey`). On a stub desk the note is absent and `images-studio-submit` stays enabled once the prompt is non-empty. While `allowed` is true the button does not protect you: a keyless click is a real POST. On a closed gate the button is quiet. A live click bills.
- `images-empty` shows `images-studio-empty` ("Nothing here yet") when the gallery has no items.
- `images-estimate` shows the pre-generate cost line `images-studio-estimate` under the controls row (provider list price per image, source + checked date, a cheap/mid/premium word) with `images-studio-estimate-compare` beneath it; an id with no transcribed price shows `images-studio-estimate-unknown` instead. Each `images-studio-model` option ends with its own `$x.xx/img` tag. Table: [`docs/internal/research/media-pricing.md`](../../../../docs/internal/research/media-pricing.md). Maps: [`generate-studios.md`](../../../../docs/internal/maps/generate-studios.md) (prompt bar → picker → generate helper → gallery), [`media-cost-estimate.md`](../../../../docs/internal/maps/media-cost-estimate.md) (the price line), [`renderer-media.md`](../../../../docs/internal/maps/renderer-media.md) (why the gallery `src` is always host-served).

## How to get to it (user POV)

- Choose Images on the left rail (`mode-images`). Default already has the tab.
- Open `http://127.0.0.1:3000/images` when the tab is unlocked. A hidden generate URL redirects to the first visible mode.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-images` is visible on Default. If count is 0, you are on a desk that hid Images (e.g. Legal) — not a missing agent.
- Stub proof: with `allowed: true`, `images-studio-needs-key` is absent and `images-studio-submit` enables once the prompt is non-empty (`apps/web/components/images-studio.tsx`). Do not click it unless the operator asked for a live generate and doctor reports `ai`. A keyless click is a real POST. A closed gate (`allowed: false`) shows the note and disables the button; both use `needsKey`. A live click bills.

- **Open Images.** Click `mode-images`. URL matches `/images` (15s). `images-studio` is visible (15s).
- **Closed gate.** When the host set `allowed` false, `images-studio-needs-key` is visible and contains exactly one `<a href="/settings">` (rendered by `SettingsLinkHint`) — assert the anchor, not the word "Settings". `images-studio-submit` is disabled. A keyless stub desk (`allowed: true`) does not show the note. The `id` copy, when the note is shown, is `Tambahkan kunci gateway Toko Token di Pengaturan untuk membuat gambar.`
- **Empty gallery.** When there are no saved images, `images-studio-empty` is visible.
- **Cost estimate.** With a model selected, `images-studio-estimate` is visible and starts with `≈ $`. Switch `images-studio-model` to another priced id and the line changes (number, vendor, or tier word). Pick an id the table does not carry. Driven on the `:3000` catalog, these are present and all unpriced: `seedream-5.0-pro`, `wan2.7-image`, `wan2.7-image-pro`, `z-image-turbo`, `qwen-image-2.0`, `qwen-image-2.0-pro`, `qwen-image-edit`, and fifteen `mj_*` action ids — and the price line is omitted (no unknown-price row). On a `gpt-image-*` id, switching `images-studio-aspect` square → portrait raises the number by half (OpenAI bills per output token, and a taller canvas is more tokens); landscape raises it too and leads with `~`. On a Google / xAI / ByteDance id the number does not move with aspect. No POST is involved — this is drivable with no key and no network: `GET /api/v1/images` builds the priced list from the curated table plus an already-cached gateway catalog, and only the POST handler calls `requireGatewayAllowed`. A selected model is the only requirement. Driven 2026-09-15 at 1440x900 (`en`): `images-studio-estimate` read `≈ $0.03 per image · at medium quality · OpenAI list price, checked Sep 15, 2026 · cheap` and `images-studio-estimate-compare` read `About 4.2× cheaper than gemini-3-pro-image-preview`. Re-driven 2026-09-17 at 1280x800 on the keyless `:3000` desk (`id`): `gpt-image-2` square read `≈ $0.03 per gambar · pada kualitas sedang · Harga resmi OpenAI, dicek 15 Sep 2026 · murah` with `images-studio-estimate-compare` `Sekitar 4,2× lebih murah dari gemini-3-pro-image-preview`; portrait read `≈ $0.05` (exact 1.5×, still `≈`) and landscape `~$0.05` (inexact 1.48×, `~`). `gemini-3-pro-image-preview` read `≈ $0.13 per gambar · Harga resmi Google …` and did **not** move with aspect. Every unpriced id fell to `images-studio-estimate-unknown` = `Belum ada harga resmi untuk model ini`.
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Gambar`, `Belum ada apa pun`, `Buat gambar untuk mengisi galeri ini.` and `Buat`. Testids are locale-invariant.
- **Other handles on this page.** `images-studio-prompt-bar` (the `<form>`), `images-studio-prompt` (the text input), `images-studio-gallery` (the grid section), `images-studio-error` (the red box, `role="alert"`), `images-enhance` (the Enhance button), and the shared template gallery `example-gallery` / `example-card` / `example-result`. `images-studio-model` and `images-enhance` are `testId` props, not literal `data-testid` attributes — see the Videos file's note.
- **IDE proof.** Screenshot of the studio shell (and needs-key if shown) under `evidence/images/<run-id>/`.
- **Cloud.** `foundation.spec.ts` asserts `images-studio` on Default. It does not generate an image.

## Gotchas

- The smoke does not assert `images-studio-needs-key`. On a stub desk (`allowed: true`) the note must be absent. Require it only when the host set `allowed` false.
- The studio posts to `/api/v1/images`, not `/runs/image`. `/runs/image` is fail-closed attach-and-analyze. A keyless submit is a 400, not a silent drop.
- A visible prompt bar is not a successful generate. Proof of generate is a gallery item (or a visible `images-studio-error`).
- Midjourney-style `mj_*` ids appear in the picker whenever the catalog has them — including with no key. The catalog is `models-cache.json` (`packages/host/src/model-cache.ts:22-30`), written by the last successful `/v1/models` probe and read unconditionally; removing the key does not empty the picker. Only a desk that has *never* had a key (fresh Cloud VM) shows an empty `images-studio-model`. An empty picker is not the needs-key note; the note follows `allowed`. Driven 2026-09-17 on `:3000`: `hasOpenai: false`, 40 image ids including fifteen `mj_*`.
- The estimate is the **provider list price**, not what Toko Token bills (the gateway rate is lower). A mismatch against a gateway invoice is expected, not a bug.
- The line leads with `≈` for an exact figure and `~` for a softened one — never both. `~` means the asked-for tier has no published price, the aspect multiplier is inexact (OpenAI landscape), or the row is low confidence (then "(unverified)" is appended too). OpenAI ids say "at medium quality" because their price is per output token, not per call.
- Read the source clause, not just the number. "… list price" is only used when the vendor’s own page carries the figure; "third-party figure" means a reseller/aggregator transcription (every ByteDance row today); "Unverified estimate, no vendor page" means nobody has a page and the row names no vendor.
- Nothing about the estimate reaches the network. On a desk whose gateway price catalog is not already cached, unpriced ids simply stay on `images-studio-estimate-unknown`.
- A visited studio stays mounted — SKILL.md harness-wide gotcha **G3**. Here that means `images-studio` still has count 1 with `isVisible()` false after you leave `/images`, and `example-gallery` resolves to two elements once Videos has also been visited; scope shared-testid queries to `images-studio`.
- **Do not snapshot the moment `images-studio` becomes visible.** `loading` suppresses both `images-studio-needs-key` and `images-studio-empty`; wait for `images-studio-model` to gain options first.
