# Templates

Example galleries on mode pages (Images first, then other modes) seed the studio prompt from a card. Phase 2B lands the gallery testids; until then the drive is a documented skip so workers share one contract.

## Sub-features

- `example-gallery` is the gallery region on a mode page that unlocked examples.
- `example-card` is one clickable example entry inside the gallery.
- `example-result` is the result / preview tied to that example after selection.
- `example-prefills-prompt` clicking a card pre-fills the studio prompt (Images: `images-studio-prompt`).

## How to get to it (user POV)

- Open a mode page that an agent unlocked (Images first: `/images`).
- Scroll to the example gallery when Phase 2B has shipped it.
- Click an example card to load its prompt into the studio composer.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- A Default (or other) agent exists so `mode-images` (or the target mode tab) is visible. Without that rail tab, this is a skip with unmet precondition — do not force a hidden URL unless a later feature file says that URL is valid.
- Phase 2B must have landed `example-gallery` / `example-card` / `example-result`. Until those testids exist, mark the drive **skip with unmet precondition** and stop. Document the contract below for Phase 2B workers; do not invent selectors.

Contract when Phase 2B is present:

- **Open Images.** Click `mode-images` (or go to `/images` only if the rail tab is visible). Studio shell is visible.
- **Gallery.** `example-gallery` is visible and contains at least six `example-card` entries (ten on Images).
- **Select.** Click one `example-card`. `images-studio-prompt` (Images) contains that example's prompt text (15s). `example-result` updates when the product shows a result pane for that card.
- **IDE proof.** Screenshot under `evidence/templates/<run-id>/` with the gallery and prefilled prompt visible.
- **Cloud.** Same asserts once the testids ship; keep the skip until then.

## Gotchas

- Mode tabs need a Default agent first. Missing `mode-images` is a skip, not a fail via a deep link unless the feature file allows it.
- Expect ≥6 entries per mode gallery, 10 on Images, once Phase 2B ships.
- Do not fail the current harness for absent `example-*` ids — that is Phase 2B work.
- Prefill targets the mode studio prompt (`images-studio-prompt` on Images), not the Chat `composer-text`.
