# Templates

Example galleries on Images, Videos, Documents, Research, and Presentation seed the studio prompt from a card. Clicking a card fills the mode composer; it does not generate.

## Sub-features

- `example-gallery` is the “Try an example” region on each unlocked mode studio.
- `example-card` is one clickable example (10 on Images, 6 on the other modes).
- `example-result` shows that card’s `resultSummary` after selection.
- `example-prefills-prompt` clicking a card fills the mode prompt: `images-studio-prompt`, `videos-studio-prompt`, `documents-prompt`, `research-prompt`, or `presentations-prompt`.

## How to get to it (user POV)

- Open a mode page an agent unlocked (Images first: rail `mode-images` or `/images` when that tab is visible).
- The gallery sits above the prompt bar under “Try an example”.
- Click a card. The prompt fills; edit it, then generate if you want.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- A Default (or other) agent exists so `mode-images` (or the target mode tab) is visible. Without that rail tab, this is a skip with unmet precondition — do not force a hidden URL unless a later feature file says that URL is valid.

- **Open Images.** Click `mode-images` (or go to `/images` only if the rail tab is visible). `images-studio` is visible. `example-gallery` is visible.
- **Gallery.** Images: 10 `example-card` entries. Videos / Documents / Research / Presentations: 6 each.
- **Select.** Click one `example-card`. The mode prompt contains that example’s prompt text (15s). `example-result` shows the card’s result summary.
- **Other modes.** Repeat on `/videos`, `/documents`, `/research`, `/presentations` when those tabs are unlocked. Do not remove or recount `documents-starter` / `presentations-starter` (still 2).
- **IDE proof.** Screenshot under `evidence/templates/<run-id>/` with the gallery and prefilled prompt visible.
- **Cloud.** Same asserts via `page.getByTestId`.

## Gotchas

- Mode tabs need a custom agent first. Missing `mode-images` is a skip, not a fail via a deep link.
- `images-studio-gallery` / `videos-studio-gallery` are generated-result galleries, not the example cards.
- Documents / Presentations starters load an offline draft/outline. Example cards only prefill the prompt.
- Prefill targets the mode studio prompt, not Chat `composer-text`.
- Library copy is industry-neutral — no `student` / `course` / campus nouns in titles or prompts.
