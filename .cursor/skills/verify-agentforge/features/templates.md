# Templates

Example galleries on Images, Videos, Documents, Research, and Presentation load a full brief into the mode composer. Clicking a card does not generate.

## Sub-features

- `example-gallery` is the “Start from a template” region on each job-mode studio.
- `example-card` is one clickable template (10 on Images, 6 on the other modes).
- `example-result` shows that card’s `resultSummary` after selection.
- `example-prefills-prompt` clicking a card fills the mode prompt with a multi-paragraph brief: `images-studio-prompt`, `videos-studio-prompt`, `documents-prompt`, `research-prompt`, or `presentations-prompt`.

## How to get to it (user POV)

- Open a job mode on Default (Images first: rail `mode-images` or `/images`). A Legal desk may hide some of these tabs.
- The gallery sits above the prompt bar under “Start from a template”.
- Click a card. A full brief fills the prompt; replace the sample details, then generate if you want.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- `mode-images` (or the target mode tab) is visible on this workspace. Default already has every work mode. If the tab is missing, you are on a desk that hid it — switch to Default or add the tab in Workspaces.

- **Open Images.** Click `mode-images` (or go to `/images` only if the rail tab is visible). `images-studio` is visible. `example-gallery` is visible.
- **Gallery.** Images: 10 `example-card` entries. Videos / Documents / Research / Presentations: 6 each.
- **Select.** Click one `example-card`. The mode prompt contains that example’s prompt text (15s). `example-result` shows the card’s result summary.
- **Other modes.** Repeat on `/videos`, `/documents`, `/research`, `/presentations` when those rail tabs are visible. Do not remove or recount `documents-starter` / `presentations-starter` (still 2).
- **IDE proof.** Screenshot under `evidence/templates/<run-id>/` with the gallery and prefilled prompt visible.
- **Cloud.** Same asserts via `page.getByTestId`.

## Gotchas

- Default already has job-mode tabs. Missing `mode-images` on Default is a fail. On a Legal desk it is expected — switch to Default or add the tab in Workspaces.
- `images-studio-gallery` / `videos-studio-gallery` are generated-result galleries, not the example cards.
- Documents / Presentations starters load a worked offline draft/outline. Template cards only prefill the prompt.
- Prefill targets the mode studio prompt, not Chat `composer-text`.
- Library copy is industry-neutral — no `student` / `course` / campus nouns in titles or prompts.
