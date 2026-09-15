# Presentation

Presentation is a job: prompt or starter → slide preview → PPTX download. It is not an in-browser slide editor. Live generate needs a gateway key. Starters load a canned outline without one.

## Sub-features

- `presentations-rail` reaches `/presentations` from `mode-presentations` on Default.
- `presentations-shell` shows `presentations-studio` with empty copy and starter cards.
- `presentations-starter` loads a preview (`presentations-preview`) without a live generate. Slide bullets and notes render markdown via `FormattedText` (same as Chat `message-output`).
- `presentations-studio-model` is the generate-bar chat-catalog dropdown.
- `presentations-regen` on a slide opens `presentations-regen-panel` (prompt, model, attach). Confirm with `presentations-regen-submit`; stub/no-key shows `presentations-error` with a Settings hint.
- `presentations-download` builds a PPTX from the in-memory outline.

## How to get to it (user POV)

- Choose Presentation on the left rail (`mode-presentations`). Default already has the tab.
- Open `http://127.0.0.1:3000/presentations` when the tab is unlocked.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-presentations` is visible on Default.
- Stub proof stops at starters + regen 503. Live generate only if the operator asked and doctor reports `ai`.

- **Open Presentation.** Click `mode-presentations`. URL matches `/presentations`. `presentations-studio` and `presentations-studio-model` are visible.
- **Starter.** `presentations-starter` count is 2. Click the first. `presentations-preview` and `presentations-regen` are visible. Slide bullets/notes show formatted markdown.
- **Regen without a key.** Click `presentations-regen`. `presentations-regen-panel`, `presentations-regen-prompt`, `presentations-regen-model`, and `presentations-regen-attach` are visible. Click `presentations-regen-submit`. `presentations-error` mentions gateway / Settings / API key.
- **Download.** Click `presentations-download` to get a PPTX from the starter (no live model).
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Presentasi`, `Belum ada dek` and `Mulai dari templat` (namespace `presentation.json`, singular; the rail key stays `presentations`). Testids are locale-invariant.
- **Cloud.** `foundation.spec.ts` covers starter + regen 503 on the Default Assistant path.

## Gotchas

- The title card is not a slide. Regen buttons sit on `presentations-slide` rows only.
- Regen opens a panel; it does not POST until `presentations-regen-submit`. Stub is HTTP 503.
- Do not POST `/api/v1/presentations` as a substitute for the prompt bar on a live proof.
