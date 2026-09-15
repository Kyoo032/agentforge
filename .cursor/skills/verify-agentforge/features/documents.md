# Documents

Documents is a job: prompt or starter → section preview → DOCX download. It is not a Word editor. Live generate needs a gateway key. Starters load a canned draft without one.

## Sub-features

- `documents-rail` reaches `/documents` from `mode-documents` on Default (and any workspace that includes Documents).
- `documents-shell` shows `documents-studio` with empty copy and starter cards.
- `documents-starter` loads a preview (`documents-preview`) without a live generate.
- `documents-studio-model` is the generate-bar chat-catalog dropdown.
- `documents-enhance` rewrites the topic via the shared Enhance host. Preview bodies (`documents-preview`, research/data notes, presentation bullets) render markdown the same way Chat `message-output` does.
- `documents-regen` on a section opens `documents-regen-panel` (prompt, model, attach). Confirm with `documents-regen-submit`; stub/no-key shows `documents-error` with a Settings hint.
- `documents-download` builds a DOCX from the in-memory draft.

## How to get to it (user POV)

- Choose Documents on the left rail (`mode-documents`). Default already has the tab.
- Open `http://127.0.0.1:3000/documents` when the tab is unlocked.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-documents` is visible on Default. If count is 0, you are on a desk that hid Documents — switch to Default or add the tab in Workspaces.
- Stub proof stops at starters + regen 503. Live generate only if the operator asked and doctor reports `ai`.

- **Open Documents.** Click `mode-documents`. URL matches `/documents`. `documents-studio`, `documents-studio-empty`, and `documents-studio-model` are visible.
- **Starter.** `documents-starter` count is 2. Click the first. `documents-preview`, `documents-section`, and `documents-regen` are visible. Section bodies show formatted markdown (no extra preview testid).
- **Regen without a key.** Click `documents-regen`. `documents-regen-panel`, `documents-regen-prompt`, `documents-regen-model`, and `documents-regen-attach` are visible. Click `documents-regen-submit`. `documents-error` mentions gateway / Settings / API key.
- **Download.** Click `documents-download` to get a DOCX from the starter (no live model).
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Dokumen`, `Belum ada dokumen` and `Mulai dari templat`. Testids are locale-invariant.
- **Cloud.** `foundation.spec.ts` covers starter + regen 503 on Default (no Studio unlock).

## Gotchas

- Default desk unlocks Documents. A Legal desk also has it. Do not open Studio to unlock the tab.
- Regen opens a panel; it does not POST until `documents-regen-submit`. Stub is HTTP 503, not a silent no-op.
- Do not POST `/api/v1/documents` as a substitute for the prompt bar on a live proof.
- Documents runs on the same default job model as Finance (`deepseek-v4-flash`), which thinks silently before it writes: the drafting phase can sit still for a minute or two with no events. That is the model, not a stall — the watchdog now allows 240 s to the first token and 180 s idle for the always-thinking gateway families. See the Finance recipe for the HTTP 500 this used to produce.
