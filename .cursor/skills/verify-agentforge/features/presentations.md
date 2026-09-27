# Presentation

Presentation is a job. The first screen is one topic box, length and style chips, and Create. The deck that appears is edited by clicking words on the slide. Download is the only primary button after that. Builder, model, starters, templates, source, movement, save, notes, and shape tools sit in More (`presentations-more`). A selected shape or Open Slide block gets a small toolbar on the slide. The default builder is Open Slide, so Create drafts a deck on a stub desk. Nultron stays in More, and a starter there still opens the Nultron stage. Education does not show the Presentation builder. Its lesson uses the same simple stage, and its own More holds quiz, a page, show, and save. There is no pen, table, chart, or slide master, and no thinking-level control. Map: [`docs/internal/maps/presentations.md`](../../../../docs/internal/maps/presentations.md).

## Sub-features

- `presentations-header` — title plus one outcome line in `expected-inputs`: "A few slides you can change, then download." `presentations-download` is the only header button, and only after a deck exists.
- `presentations-rail` reaches `/presentations` from `mode-presentations` on Default.
- `presentations-shell` shows `presentations-studio`. An empty desk shows `presentations-studio-empty` (the presenting mascot) and one line `presentations-hint`. The prompt bar is `presentations-studio-prompt-bar`.
- `presentations-ask` is the topic. The label is `presentation.ask` ("What's your presentation about?"). The box is `presentations-prompt`.
- `presentations-choices` are two chip rows on the empty screen: length `presentations-length-short|standard|deep` (Short / Medium / Long) inside `presentations-open-slide-pages`, and style `presentations-style-minimal|light|standard` (Simple / Clear / Detailed) inside `presentations-open-slide-density`. Defaults are Medium and Clear. Once a deck is open those chips move into More.
- `presentations-generate` is Create (`presentations-generate`). On the empty screen it is the primary button beside More. The default builder posts `POST /api/v1/presentations/open-slide` and a stub desk answers 200. Switching More's "Slides from" to Nultron posts `POST /api/v1/presentations` and a stub desk answers 503 into `presentations-error`.
- `presentations-more` (`presentations-more`, details `presentations-more-details`) hides `presentations-engine`, movement `presentations-open-slide-motion`, `presentations-studio-model`, `presentations-enhance`, source material, `presentations-starter`, the templates gallery, saved decks, and `presentations-save-deck`. None of those are visible until More is opened. There is no density dropdown and no page-role control on the first screen.
- `presentations-gallery` is the shared example gallery inside More (`example-gallery`, six `example-card`s, `example-result`). A click only fills `presentations-prompt`.
- `presentations-enhance` rewrites the typed prompt. It is the one control here that answers 200 without a key (`stubEnhancePrompt` short-circuits ahead of the gate, `packages/host/src/handlers/enhance-prompt.ts:45-48`).
- `presentations-source` is the optional Source material box inside More (`-source-toggle`, `-source-text`, `-source-picker`, `-source-clear`, `-source-title`), sent as `sourceText` on both generate and regenerate. It is also what a `*-make-presentation` handoff from Research / Finance / Data / Market / Legal fills.
- `presentations-starter` loads the Nultron editor (`presentations-preview`, `presentations-editor`) without a live generate. Open More first. The filmstrip lists the title plus each content slide. Only the current stage is `presentations-slide-title` or `presentations-slide`.
- `presentations-studio-model` is the chat-catalog dropdown inside More.
- `presentations-regen` is "Rewrite this slide". In the studio it is portaled into More for the current content slide and opens `presentations-regen-panel`. Confirm with `presentations-regen-submit`; stub/no-key shows `presentations-error`. Education does not mount that button.
- `presentations-download` builds a PPTX from the in-memory deck. Open Slide posts `POST /api/v1/presentations/open-slide/pptx`. Nultron posts `POST /api/v1/presentations/pptx`. Neither route calls the gateway.
- `presentations-edit` on Nultron is direct text on the stage: `presentations-edit-title`, `presentations-edit-heading`, `presentations-edit-bullet`. On Open Slide, click a block and edit `presentations-open-slide-text` in place.
- `presentations-shapes` on the studio are not a permanent toolbar. Add-shape buttons live in More. Fill, stroke, text, duplicate, and delete appear on `presentations-selection-toolbar` only while a shape is selected. Education uses that same simple stage. Arrow keys nudge a Nultron shape by 1 percent (Shift by 5). Open Slide arrow keys nudge by 8px (Shift by 40) when focus is not in the text.
- `presentations-save` posts to `POST /api/v1/presentations/decks` or `POST /api/v1/presentations/open-slide/decks` (`presentations-save-deck`, inside More). Reload starts empty until reopen.
- `presentations-open-slide` is the default. Set `presentations-length-short`, type a topic, click Create. `presentations-open-slide-stage` appears and `presentations-open-slide-page` count is 4. The filmstrip is `presentations-open-slide-filmstrip`. Click a text block, change `presentations-open-slide-text`, focus the stage, press ArrowRight: that block's `data-x` increases by 8. `presentations-open-slide-toolbar` (color, add text, duplicate, notes) is visible only while a block is selected.

## How to get to it (user POV)

- Choose Presentation on the left rail (`mode-presentations`). Default already has the tab.
- Open `http://127.0.0.1:3000/presentations` when the tab is unlocked.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-presentations` is visible on Default.
- Stub proof of Create is the Open Slide draft (200). Nultron Create is 503. Live generate only if the operator asked and doctor reports `ai`.
- A stub desk cannot show: a real model outline, the saved `presentations / draft` artifact, the `Presentation` Knowledge Base work card, or a `*-make-presentation` handoff (the source studios only render their action row after a live run). Record those as verified-unreachable, not as skips.

- **Open Presentation.** Click `mode-presentations`. URL matches `/presentations`. `presentations-studio`, `presentations-studio-empty`, `presentations-hint`, and `presentations-studio-prompt-bar` are visible. `presentations-engine`, `presentations-studio-model`, and `presentations-starter` are not visible. `presentations-download` is absent. Visible controls beside the topic are the length chips, the style chips, More, and Create.
- **Create.** Click `presentations-length-short`. Type a topic in `presentations-prompt` and click `presentations-generate`. Stub answers 200 on `POST /api/v1/presentations/open-slide`. `presentations-open-slide-stage` is visible and `presentations-open-slide-page` count is 4. The topic box and Create leave the first screen. `presentations-download` is the header button.
- **Edit.** Click a text block. `presentations-open-slide-text` and `presentations-open-slide-toolbar` appear. Change the text, focus `presentations-open-slide-stage`, press ArrowRight: that same block's `data-x` increases by 8. A click elsewhere on the canvas can select a different block; assert the block that holds the edited text.
- **Download.** Click `presentations-download`. `POST /api/v1/presentations/open-slide/pptx` answers 200 and the slide XML contains the edited line.
- **More.** Click `presentations-more`. `presentations-engine` value is `open-slide`. `presentations-studio-model` is visible but **empty and disabled until `/api/v1/models` lands** (SKILL.md harness-wide gotcha **G1**) — wait for its option count to go above 0 before reading it. `presentations-starter` count is 2. `example-card` count is 6. A gallery click fills `presentations-prompt` and shows `example-result`. It does not generate.
- **Nultron without a key.** Set `presentations-engine` to `nultron`, keep a topic, and click the Create control inside More (`presentations-generate`). `POST /api/v1/presentations` answers **503 `runtime_stub`** and `presentations-error` carries the gateway copy.
- **Starter.** With More open, click the first `presentations-starter`. `presentations-preview`, `presentations-editor`, `presentations-filmstrip` (seven `presentations-filmstrip-slide`), and `presentations-slide-title` are visible. `presentations-shape-toolbar` is not on the studio. Click the second filmstrip entry: `presentations-slide` replaces the title stage. `presentations-regen` is inside the still-open More. Click it: `presentations-regen-panel` opens. `presentations-regen-submit` on a stub desk shows `presentations-error` with a gateway / Settings / API key hint. The panel stays open.
- **Nultron text.** After a starter, edit `presentations-edit-title`. Open a content slide and edit `presentations-edit-heading`. Click `presentations-download`: `POST /api/v1/presentations/pptx` answers 200.
- **Shapes, from More.** Open More and click `presentations-add-rectangle`. Select the shape: `presentations-selection-toolbar` shows `presentations-fill`. ArrowRight moves `data-x` by 1. `presentations-shape-duplicate` adds a copy. Delete removes the copy. `presentations-save-deck` shows `presentations-deck-saved`. Reload: `presentations-studio-empty` is back. Open More, click `presentations-deck-open`: the heading and the shape are back.
- **Keep-alive.** Switch to `mode-chat` and back to `mode-presentations`: the deck is still mounted (SKILL.md harness-wide gotcha **G3**). Reload clears it until a saved deck is opened.
- **Education.** Open `/education`. The presenting mascot and `education-hint` are visible, and `presentations-engine` count is 0. Draft the Fractions lesson. `presentations-editor` is visible and `presentations-shape-toolbar` is not inside it. See [education.md](./education.md).
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Presentasi`, `Lainnya`, `Buat`, and `Unduh` (namespace `presentation.json`, singular; the rail key stays `presentations`). Testids are locale-invariant. The 503 banner is host copy: `Pembuatan presentasi membutuhkan gateway yang aktif. Tempel kunci API Toko Token di Pengaturan, lalu coba lagi.` The `Open Settings` link only renders on an id desk. Match `/gateway/i`, not `/Settings/i`. A desk on `id` gets Indonesian Open Slide block text from the drafter.
- **Cloud.** `apps/web/tests/e2e/foundation.spec.ts` opens More before the model and the starters, then walks preview → regen panel → 503. It does not click Create or Download.

## Gotchas

- More stays open after a starter click because the `<details>` element is not remounted. Regen is portaled into that open panel. If More was closed, open it before looking for `presentations-regen` or `presentations-add-rectangle`.
- The title entry is not a content slide. Shapes insert onto the current content slide; from the title stage they land on the first content slide and the stage follows.
- A "6-slide" starter has 7 filmstrip entries. The stage shows one of `presentations-slide-title` or `presentations-slide`.
- Regen opens a panel; it does not POST until `presentations-regen-submit`. Stub is HTTP 503.
- Do not POST `/api/v1/presentations` as a substitute for Create on a live proof. On a stub desk the default Create button is the Open Slide route, not that 503.
- `presentations-download` has no gateway gate. A PPTX is not evidence of a working key.
- A closed gate (403 `gateway_blocked`) does not surface here: the flat error body is unreadable to the studio's `errorMessage()` and the banner falls back to the generic "could not generate" string with no Settings link.
- Clicking the middle of an Open Slide canvas selects whichever block is under the pointer. Assert the block whose text you edited, not whichever block is selected after a later click.
- Nudge is keyboard-only. There is no nudge button.
