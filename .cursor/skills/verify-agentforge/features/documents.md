# Documents

Documents is a job: prompt or starter → section preview → DOCX download. It is not a Word editor. Live generate needs a gateway key. Starters load a canned draft without one. An optional **Source material** box (`sourceText`, 120k chars) takes pasted text, a saved artifact, or a Research handoff, and becomes the only facts the model may use.

## Sub-features

- `documents-rail` reaches `/documents` from `mode-documents` on Default (and any workspace that includes Documents).
- `documents-shell` shows `documents-studio` with empty copy and starter cards.
- `documents-prompt` + `documents-generate` are the generate bar (`documents-studio-prompt-bar`). Without a key, generate is HTTP 503 into `documents-error` — and the failure also clears any starter draft on screen.
- `documents-source` is the optional Source material box: `documents-source-toggle` reveals `documents-source-text`, `documents-source-clear` empties it, and `documents-source-title` names the artifact it came from. Works without a key.
- `documents-source-picker` is the “Use a saved artifact…” dropdown (`-toggle`, `-panel`, `-item`). Opening it does `GET /api/v1/artifacts` across **every** mode, not just Documents.
- `documents-handoff` — Research's `research-make-document` fills `documents-source-text`, `documents-source-title` and `documents-prompt`, then routes to `/documents`. Renderer-only and consumed once; a reload loses it.
- `documents-starter` loads a preview (`documents-preview`) without a live generate.
- `documents-studio-model` is the generate-bar chat-catalog dropdown.
- `documents-enhance` rewrites the topic via the shared Enhance host (`POST /api/v1/prompts/enhance`, `surface: "documents"`). It is the one Documents control that **works without a gateway key** — 200 in stub. After applying, the testid becomes `documents-enhance-revert`. Preview bodies (`documents-preview`, research/data notes, presentation bullets) render markdown the same way Chat `message-output` does.
- `documents-regen` on a section opens `documents-regen-panel` (prompt, model, attach). The panel is the shared `JobRegenPanel`, so it also carries an `sr-only` `documents-regen-file` input; its Cancel button has no testid. Confirm with `documents-regen-submit`; stub/no-key shows `documents-error` with a Settings hint. An empty `documents-regen-prompt` still submits — there is no required-field guard.
- `documents-download` builds a DOCX from the in-memory draft. `POST /api/v1/documents/docx` is the only Documents route with no tenant lookup and no gateway gate, so it answers 200 even on a stub desk or a closed gate. A regenerated section is included, but the *saved artifact* is not updated — the DOCX and the artifact diverge after any rewrite.

## How to get to it (user POV)

- Choose Documents on the left rail (`mode-documents`). Default already has the tab.
- Open `http://127.0.0.1:3000/documents` when the tab is unlocked.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-documents` is visible on Default. If count is 0, you are on a desk that hid Documents — switch to Default or add the tab in Workspaces.
- Stub proof stops at starters + regen 503. Live generate only if the operator asked and doctor reports `ai`.

- **Open Documents.** Click `mode-documents`. URL matches `/documents`. `documents-studio`, `documents-studio-empty`, and `documents-studio-model` are visible.
- **Starter.** `documents-starter` count is 2. Click the first (“Memo status”) — `documents-section` and `documents-regen` are 5. The second (“Brief satu halaman”) is 6. `documents-preview` is visible. Section bodies show formatted markdown (no extra preview testid).
- **Source material (no key needed).** Click `documents-source-toggle`; `documents-source-text` appears. Type anything and press `documents-generate`: the request body carries `sourceText` alongside `prompt` and `model` before the 503. Click `documents-source-picker-toggle` to open `documents-source-picker-panel` — on a desk with no artifacts it shows the empty-dossier copy; this is the only place a saved Research/Finance/Legal artifact enters Documents.
- **Generate without a key.** Fill `documents-prompt`, click `documents-generate`. `POST /api/v1/documents` is HTTP 503 and `documents-error` carries the gateway/Settings copy. Note that this also clears any starter draft — `documents-preview` disappears.
- **Regen without a key.** Click `documents-regen`. `documents-regen-panel`, `documents-regen-prompt`, `documents-regen-model`, and `documents-regen-attach` are visible. Click `documents-regen-submit`. `documents-error` mentions gateway / Settings / API key.
- **Download.** Click `documents-download` to get a DOCX from the starter (no live model).
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Dokumen`, `Belum ada dokumen` and `Mulai dari templat`. Testids are locale-invariant.
- **Cloud.** `foundation.spec.ts` covers starter + regen 503 on Default (no Studio unlock).

## Gotchas

- Default desk unlocks Documents. A Legal desk also has it. Do not open Studio to unlock the tab.
- Regen opens a panel; it does not POST until `documents-regen-submit`. Stub is HTTP 503, not a silent no-op.
- Do not POST `/api/v1/documents` as a substitute for the prompt bar on a live proof.
- A hidden studio stays mounted — SKILL.md “Harness-wide gotchas” G3; here it means `documents-studio` still has count 1 on `/chat` and `documents-prompt` keeps its typed value.
- A failed generate wipes the preview. `onGenerate`'s catch does `setDraft(null)` before it sets the error (`apps/web/components/documents-studio.tsx:74-77`); `onRegenerate`'s catch does not. Load a starter, then press Generate without a key, and the starter is gone.
- `documents-studio-model` is a real `<select>` carrying the whole curated chat catalog (110 options on this desk; `packages/host/src/selectable-models.ts:145`), and it writes the desk's `documentGenModel` — the same field Finance, Market and Legal read (`apps/web/lib/use-job-model.ts:19-25`). Changing it here changes Finance's default too.
- Documents runs on the same default job model as Finance (`deepseek-v4-flash`), which thinks silently before it writes: the drafting phase can sit still for a minute or two with no events. That is the model, not a stall — the watchdog now allows 240 s to the first token and 180 s idle for the always-thinking gateway families. See the Finance recipe for the HTTP 500 this used to produce.
