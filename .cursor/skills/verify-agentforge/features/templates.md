# Templates

Example galleries on Images, Videos, Documents, Research, and Presentation load a full brief into the mode composer. Clicking a card does not generate.

## Sub-features

- `example-gallery` is the “Start from a template” region on each job-mode studio.
- `example-card` is one clickable template (10 on Images, 6 on the other modes). On `/presentations` the gallery is `example-gallery` with **six** `example-card`s whose `data-example-id`s read `presentations-<slug>` (`apps/web/components/example-gallery.tsx:29-30`), backed by `packages/core/src/templates/library.ts:502-643` and localized through `presentation.templates.*`; `packages/core/src/templates/library.test.ts:18` pins that count at 6.
- `example-result` shows that card’s `resultSummary` after selection.
- `example-prefills-prompt` clicking a card fills the mode prompt with that card's full brief: `images-studio-prompt`, `videos-studio-prompt`, `documents-prompt`, `research-prompt`, or `presentations-prompt`. All five are single-line `<input type="text">`, so the library's line breaks are stripped — assert length (600–1600 chars; measured images 639, videos 420, documents 1337, research 678, presentations 1554) or a distinctive substring, never paragraph count: assert the text is present, not that it kept its paragraphs.

## How to get to it (user POV)

- Open a job mode on Default (Images first: rail `mode-images` or `/images`). A Legal desk may hide some of these tabs.
- The gallery sits above the prompt bar under “Start from a template”.
- Click a card. A full brief fills the prompt; replace the sample details, then generate if you want.

## Driving it with the DPSBuddy harness

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
- Documents / Presentations starters load a worked offline draft/outline. Template cards only prefill the prompt: `ExampleGallery`'s `onSelect` does nothing but `setPrompt(entry.prompt)` (`apps/web/components/documents-studio.tsx:191`), so a card can never produce `documents-preview` — only `documents-starter` and a live generate can.
- Prefill targets the mode studio prompt, not Chat `composer-text`.
- Card titles and `example-result` are localized on all five modes, but only `documents` and `presentation` have localized **prompts** in the catalogs; `images`, `videos` and `research` fall back to the English `TEMPLATE_LIBRARY` string (`apps/web/lib/ui-copy.ts:48`). So on an `id` desk the prefill is English on Images/Videos/Research and Indonesian on Documents/Presentations. Match a length or a mode-specific noun, not a fixed English sentence.
- `/videos` carries **two** card grids: the template gallery (`example-card`, 6) and the generated video examples (`videos-example-card` / `videos-example-video` / `videos-example-use-<templateId>`, `apps/web/components/video-examples.tsx:97`, `:107`, `:125`). Say which one you mean.
- The first click on `example-card` right after the studio paints can be swallowed on `/videos` and `/research` — the block above it finishes loading and moves the card. Assert `aria-pressed="true"` (or a non-empty prompt) and re-click once rather than treating the miss as a product fail.
- Library copy is industry-neutral — no `student` / `course` / campus nouns in titles or prompts.
