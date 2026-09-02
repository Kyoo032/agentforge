# Documents

Documents is a job: prompt or starter → section preview → DOCX download. It is not a Word editor. Live generate needs a gateway key. Starters load a canned draft without one.

## Sub-features

- `documents-rail` reaches `/documents` from `mode-documents` after an agent unlocks the surface.
- `documents-shell` shows `documents-studio` with empty copy and starter cards.
- `documents-starter` loads a preview (`documents-preview`) without a live generate.
- `documents-studio-model` is the generate-bar chat-catalog dropdown.
- `documents-regen` on a section opens `documents-regen-panel` (prompt, model, attach). Confirm with `documents-regen-submit`; stub/no-key shows `documents-error` with a Settings hint.
- `documents-download` builds a DOCX from the in-memory draft.

## How to get to it (user POV)

- Unlock Documents on a custom agent (`product-mode-documents`, then `save-product-modes`).
- Choose Documents on the left rail (`mode-documents`).
- Open `http://127.0.0.1:3000/documents` when the tab is unlocked.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- `mode-documents` is visible. Default Assistant does not unlock it until you save the Documents chip.
- Stub proof stops at starters + regen 503. Live generate only if the operator asked and doctor reports `ai`.

- **Open Documents.** Click `mode-documents`. URL matches `/documents`. `documents-studio`, `documents-studio-empty`, and `documents-studio-model` are visible.
- **Starter.** `documents-starter` count is 2. Click the first. `documents-preview` and `documents-regen` are visible.
- **Regen without a key.** Click `documents-regen`. `documents-regen-panel`, `documents-regen-prompt`, `documents-regen-model`, and `documents-regen-attach` are visible. Click `documents-regen-submit`. `documents-error` mentions gateway / Settings / API key.
- **Download.** Click `documents-download` to get a DOCX from the starter (no live model).
- **Cloud.** `foundation.spec.ts` covers starter + regen 503 after unlocking Documents in Studio.

## Gotchas

- Default template does not unlock Documents. Toggle `product-mode-documents` and save.
- Regen opens a panel; it does not POST until `documents-regen-submit`. Stub is HTTP 503, not a silent no-op.
- Do not POST `/api/v1/documents` as a substitute for the prompt bar on a live proof.
