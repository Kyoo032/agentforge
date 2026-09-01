# Presentation

Presentation is a job: prompt or starter → slide preview → PPTX download. It is not an in-browser slide editor. Live generate needs a gateway key. Starters load a canned outline without one.

## Sub-features

- `presentations-rail` reaches `/presentations` from `mode-presentations` after an agent unlocks the surface (Default template does).
- `presentations-shell` shows `presentations-studio` with empty copy and starter cards.
- `presentations-starter` loads a preview (`presentations-preview`) without a live generate.
- `presentations-regen` on a slide posts regenerate; stub/no-key shows `presentations-error` with a Settings hint.
- `presentations-download` builds a PPTX from the in-memory outline.

## How to get to it (user POV)

- Choose Presentation on the left rail (`mode-presentations`) after Build has created an agent with that surface.
- Open `http://127.0.0.1:3000/presentations` when the tab is unlocked.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- `mode-presentations` is visible (Default Assistant unlocks it).
- Stub proof stops at starters + regen 503. Live generate only if the operator asked and doctor reports `ai`.

- **Open Presentation.** Click `mode-presentations`. URL matches `/presentations`. `presentations-studio` is visible.
- **Starter.** `presentations-starter` count is 2. Click the first. `presentations-preview` and `presentations-regen` are visible.
- **Regen without a key.** Click `presentations-regen`. `presentations-error` mentions gateway / Settings / API key.
- **Download.** Click `presentations-download` to get a PPTX from the starter (no live model).
- **Cloud.** `foundation.spec.ts` covers starter + regen 503 on the Default Assistant path.

## Gotchas

- The title card is not a slide. Regen buttons sit on `presentations-slide` rows only.
- Regen uses `/api/v1/presentations/regenerate`. Stub is HTTP 503.
- Do not POST `/api/v1/presentations` as a substitute for the prompt bar on a live proof.
