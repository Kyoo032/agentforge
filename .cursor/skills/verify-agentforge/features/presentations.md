# Presentation

Presentation is a job: prompt or starter → a slide stage → PPTX download. The stage shows the current slide large, a filmstrip, and a properties panel. Title, heading, and bullets are edited on the slide. Nine shapes can be inserted, selected, dragged, and resized, then saved with the deck and written into the PPTX. There is no pen, table, chart, or slide master. Live generate needs a gateway key. Starters, text edits, shapes, save, and PPTX download do not. Map: [`docs/internal/maps/presentations.md`](../../../../docs/internal/maps/presentations.md).

## Sub-features

- `presentations-header` (0.15.0) — title plus one outcome line in `expected-inputs`: "You get: a titled deck with a claim heading, complete-sentence bullets, and speaker notes on every slide — previewed on the page and downloadable as PPTX." `presentations-prompt` is a bordered `text-field` input. Driven 2026-09-23: `presentations-starter` → one `presentations-slide-title` + six `presentations-slide`; `presentations-download` → `POST /api/v1/presentations/pptx` 200, no model call.
- `presentations-rail` reaches `/presentations` from `mode-presentations` on Default.
- `presentations-shell` shows `presentations-studio` with `presentations-studio-empty` copy, starter cards, the templates gallery, and the sticky `presentations-studio-prompt-bar`.
- `presentations-gallery` is the shared example gallery (`example-gallery`, six `example-card`s, `example-result`). A click only fills `presentations-prompt` — it never generates.
- `presentations-generate` is the live path (`presentations-prompt` + `presentations-generate` → `POST /api/v1/presentations`). Stub/no-key is HTTP 503 into `presentations-error`.
- `presentations-enhance` rewrites the typed prompt. It is the one control here that answers 200 without a key (`stubEnhancePrompt` short-circuits ahead of the gate, `packages/host/src/handlers/enhance-prompt.ts:45-48`).
- `presentations-source` is the optional Source material box (`-source-toggle`, `-source-text`, `-source-picker`, `-source-clear`, `-source-title`), sent as `sourceText` on both generate and regenerate. It is also what a `*-make-presentation` handoff from Research / Finance / Data / Market / Legal fills.
- `presentations-starter` loads the editor (`presentations-preview`, `presentations-editor`) without a live generate. The filmstrip lists the title plus each content slide. Only the current stage is `presentations-slide-title` or `presentations-slide`.
- `presentations-studio-model` is the generate-bar chat-catalog dropdown.
- `presentations-regen` sits in the properties panel of the current content slide and opens `presentations-regen-panel` (prompt, model, attach). Confirm with `presentations-regen-submit`; stub/no-key shows `presentations-error` with a Settings hint.
- `presentations-download` builds a PPTX from the in-memory outline. Owner text and shapes on the outline are included (`addOwnerShapes` in `packages/host/src/presentation-pptx.ts`).
- `presentations-edit` is direct text on the stage: `presentations-edit-title` on the title slide, `presentations-edit-heading` and one `presentations-edit-bullet` per bullet on a content slide. Speaker notes stay in `presentations-edit-notes` in `presentations-properties`.
- `presentations-shapes` inserts `presentations-add-rectangle`, `-rounded`, `-ellipse`, `-triangle`, `-line`, `-arrow`, `-star`, `-callout`, and `-text`. Each mark is `presentations-shape` (`data-x`, `data-y`, `data-w`, `data-h`). Select it, drag the box, or drag `presentations-shape-resize`. Fill and stroke are `presentations-fill` and `presentations-stroke`. `presentations-shape-remove` deletes it. `presentations-edit-note` says tables, charts, and masters are not on this surface.
- `presentations-save` posts the outline to `POST /api/v1/presentations/decks` (`presentations-save-deck`). A saved deck is listed in `presentations-deck-list` and reopened with `presentations-deck-open`. Reload starts empty until that reopen. No gateway key.

## How to get to it (user POV)

- Choose Presentation on the left rail (`mode-presentations`). Default already has the tab.
- Open `http://127.0.0.1:3000/presentations` when the tab is unlocked.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-presentations` is visible on Default.
- Stub proof stops at starters + regen 503. Live generate only if the operator asked and doctor reports `ai`.
- A stub desk cannot show: a real outline, the saved `presentations / draft` artifact, the `Presentation` Knowledge Base work card, or a `*-make-presentation` handoff (the source studios only render their action row after a live run). Record those as verified-unreachable, not as skips.

- **Open Presentation.** Click `mode-presentations`. URL matches `/presentations`. `presentations-studio`, `presentations-studio-empty` and `presentations-studio-prompt-bar` are visible. `presentations-studio-model` is visible immediately but is **empty and disabled until `/api/v1/models` lands** (SKILL.md harness-wide gotcha **G1**) — wait for its option count to go above 0 before reading it (measured 0 → 101, selected `glm-5.3-flash` = `defaults.presentations`).
- **Templates gallery.** `example-card` count is 6 (`presentations-seed-stage-pitch`, `-weekly-operating-review`, `-workshop-opener`, `-ship-day-readout`, `-retro-with-owners`, `-all-hands-recap`). Click one: `presentations-prompt` fills with a multi-hundred-character brief and `example-result` appears. No request is made.
- **Generate without a key.** With `presentations-prompt` non-empty, click `presentations-generate`. `POST /api/v1/presentations` answers **503 `runtime_stub`** and `presentations-error` carries the gateway copy. This is the prompt-bar proof; do not substitute a raw POST.
- **Starter.** `presentations-starter` count is 2. Click the first. `presentations-preview`, `presentations-editor`, `presentations-filmstrip` (seven `presentations-filmstrip-slide`), and `presentations-slide-title` are visible. Click the second filmstrip entry: `presentations-slide` replaces the title stage, and `presentations-regen` is in the properties panel. Loading a starter clears `presentations-error` and reveals `presentations-download`.
- **Regen without a key.** Click `presentations-regen`. `presentations-regen-panel`, `presentations-regen-prompt`, `presentations-regen-model`, and `presentations-regen-attach` are visible. Click `presentations-regen-submit`. `presentations-error` mentions gateway / Settings / API key. `presentations-regen-file` (the hidden multi-file input) also exists, and after the 503 the panel **stays open** and `presentations-preview` survives — the error banner renders at the top of the studio, not inside the panel.
- **Download.** Click `presentations-download` to get a PPTX from the starter (no live model). Observed: `POST /api/v1/presentations/pptx` → 200, `Content-Disposition: attachment; filename="<safeFilename(title)>.pptx"` (id starter title `Pengambilan Sabtu — minggu 6 Sep`; the filename is `safeFilename` of that title).
- **Edit text and add shapes.** After a starter, open the first content slide from `presentations-filmstrip-slide`. Edit `presentations-edit-heading` on the stage. Click `presentations-add-rectangle` and `presentations-add-ellipse`. Drag the rectangle. Select the ellipse and drag `presentations-shape-resize`. Click `presentations-save-deck`. `presentations-deck-saved` appears. Reload: `presentations-studio-empty` is back. Click `presentations-deck-open`, then the same filmstrip entry: the heading and both shapes (`data-x`, `data-y`, `data-w`, `data-h`) are back. Download again: the PPTX slide XML contains `prst="rect"` and `prst="ellipse"`.
- **Keep-alive.** Switch to `mode-chat` and back to `mode-presentations`: the deck is still mounted (SKILL.md harness-wide gotcha **G3**). Reload the page: the open deck is gone until `presentations-deck-open`. A saved deck is a JSON file under the data dir, not a model artifact.
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Presentasi`, `Belum ada dek` and `Mulai dari templat` (namespace `presentation.json`, singular; the rail key stays `presentations`). Testids are locale-invariant. The 503 banner is host copy, not renderer copy: `Pembuatan presentasi membutuhkan gateway yang aktif. Tempel kunci API Toko Token di Pengaturan, lalu coba lagi.` — and the `Open Settings` link **only renders on an id desk**, because the English message already contains the word "Settings" and the link condition excludes it. Match `/gateway/i`, not `/Settings/i`.
- **Cloud.** `apps/web/tests/e2e/foundation.spec.ts:89-103` covers rail → studio → 2 starters → preview → regen panel → 503 on the Default **workspace** rail. It does not touch the gallery, the prompt bar, Download, or Source material.

## Gotchas

- The title entry is not a content slide. Shapes insert onto the current content slide; from the title stage they land on the first content slide and the stage follows. Regen sits in the properties panel of a content slide only.
- A "6-slide" starter has 7 filmstrip entries. The stage shows one of `presentations-slide-title` or `presentations-slide`. The page counter reads `n / 7`.
- Regen opens a panel; it does not POST until `presentations-regen-submit`. Stub is HTTP 503.
- Do not POST `/api/v1/presentations` as a substitute for the prompt bar on a live proof.
- `presentations-download` is the one presentations route with **no gateway gate and no tenant** (`packages/host/src/handlers/jobs.ts:233-247`). It answers 200 on a stub desk and would answer 200 with the gate closed. Getting a PPTX is therefore not evidence of a working key.
- A closed gate (403 `gateway_blocked`) does **not** surface here: the flat error body is unreadable to the studio's `errorMessage()` and the banner falls back to the generic "could not generate" string with no Settings link. Expect that, and see `docs/internal/unreleased.md`.
