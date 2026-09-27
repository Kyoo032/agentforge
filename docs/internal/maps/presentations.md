# Map — Presentation

Last verified: 2026-09-27 at 1365aa2

## Overview

Presentation is a job. A topic goes in the prompt bar, the model returns one JSON outline, and the renderer paints the current slide large, with a filmstrip and a properties panel. A second route turns the same outline into a `.pptx`. The owner edits the title, heading, and bullets on the slide, and inserts rectangle, rounded rectangle, ellipse, triangle, line, arrow, star, callout, and text. Those boxes are dragged and resized, then written into the PPTX by `addOwnerShapes` (`packages/host/src/presentation-pptx.ts:35`). There is no pen, table, chart, or slide master.

The outline still starts in React state (`apps/web/components/presentations-studio.tsx:48`). Save writes it to `presentation-decks/<workspaceId>/deck_*.json` (`packages/host/src/presentation-decks.ts:37`, `POST /api/v1/presentations/decks` at `packages/host/src/router.ts:358`). Reload clears the open deck until `presentations-deck-open` reads it back. A starter still produces a PPTX with no gateway key.

The first screen is a topic box, length and style chips, and Create (`apps/web/components/presentations-studio.tsx:503`). Everything else sits in More (`presentations-more`, `:515`), including which builder makes the slides (`presentations-engine`, `:537`). The default builder is Open Slide, so Create drafts a deck on a stub desk. Nultron is the previous stage and is what a starter in More still opens. Open Slide is a port of the MIT open-slide authoring rules (`packages/core/src/open-slide/THIRD-PARTY-NOTICES.md`): a 1920×1080 JSON deck, not React source. Education does not show the Presentation builder. Its lesson uses the same simple stage (`variant="simple"` at `apps/web/components/education-studio.tsx:334`) and keeps its own More (`education-more`).

## How it works

### 1. Reaching the studio

The rail tab is `mode-presentations` (`mode-${href.slice(1)}`), and `/presentations` renders **`null`** in the router (`apps/web/src/App.tsx:319`). The real component is mounted by `WorkModeKeepAlive`, which maps `/presentations` → `PresentationsStudio` (`apps/web/components/work-mode-keep-alive.tsx:30`) and keeps every visited mode mounted, hidden when inactive. Switch to Chat and back and the loaded deck is still there; reload and the open deck is gone until a saved deck is opened.

The pane is `absolute inset-0 … overflow-y-auto` (`apps/web/components/work-mode-keep-alive.tsx:72`) precisely because Presentation has no inner scroller — the comment at `:32-40` names it.

### 2. The shell — four input surfaces, one of which needs no key

`PresentationsStudio` (`apps/web/components/presentations-studio.tsx:43`) renders, top to bottom:

| Surface | testid | Works on a stub desk? |
|---|---|---|
| Empty state | `presentations-studio-empty` (`apps/web/components/presentations-studio.tsx:485`) and one hint `presentations-hint` (`:487`) | Yes — the mascot, no starter cards |
| Topic, length, style, Create | `presentations-prompt` (`:405`), `presentations-open-slide-pages`, `presentations-open-slide-density`, `presentations-generate` (`:673`) | Create on the default builder drafts locally. Nultron Create is still 503 without a key |
| More | `presentations-more` (`:515`) | Starters, templates, source, model, builder, movement, save, and Nultron shape tools |

The gallery entries come from core (`packages/core/src/templates/library.ts:502-643`, six `mode: "presentations"` rows) and are localized by slug through `localizedLibrary` (`apps/web/lib/ui-copy.ts:34-52`) against the `presentation.templates.*` keys. Clicking a card only calls `setPrompt(entry.prompt)` (`apps/web/components/presentations-studio.tsx:390`) — it never generates.

The model dropdown is the **chat catalog**, not a presentation-specific list: `useJobModel("presentations")` (`apps/web/lib/use-job-model.ts:64`) fetches `/api/v1/models` + `/api/v1/settings` in parallel and seeds from `modes.presentations` / `defaults.presentations` / `settings.presentationGenModel` (`:84-99`). Host side, `modeCatalogPayload` hands presentations `curated.chat` verbatim (`packages/host/src/selectable-models.ts:169`) and `resolveModeDefaults` picks the first live id out of `JOB_MODE_PREFERENCES.presentations` = `glm-5.3-flash`, `glm-5.3-flash-preview`, `glm-5.2-fast-preview`, `glm-5.2`, `glm-5.3`, `kimi-k3` (`packages/core/src/models/mode-defaults.ts:60-67`). On this desk that resolved to `glm-5.3-flash` out of 110 catalog ids, rendered as 101 `<option>`s because `ModelSelect` runs them through `pickerGroups` (`apps/web/components/model-select.tsx:56`).

### 3. Generate — prompt bar → `POST /api/v1/presentations` → one JSON outline

`onGenerate` (`apps/web/components/presentations-studio.tsx:195`) POSTs `{ prompt, model?, sourceText? }` through `apiFetch`, so webdev and the packaged app share one call. Route table: `packages/host/src/router.ts:350`.

`handlePostPresentations` (`packages/host/src/handlers/jobs.ts:211-220`) resolves the tenant and calls `requireGatewayAllowedFor(tenant)` **before** anything else — a closed gate is a flat `403 gateway_blocked` here, never a failed model call.

`generatePresentationOutline` (`packages/host/src/presentation-generate.ts:141-165`) then:

1. `readPrompt` — a missing / blank `prompt` is a 400 (`:53-62`).
2. `requireLivePresentationRuntime` (`:99-109`) — `resolveRuntimeMode({settingsHasKey: hasLiveProvider(settings), envRuntime})`; stub throws `ApiError("runtime_stub", presentationGatewayMessage(locale), 503)`. **This is the state on an unkeyed desk** and it is the one the harness proves.
3. `readSourceText` (`packages/host/src/job-source.ts:38-52`) — optional, trimmed, capped at 120 000 chars with a visible `[source material truncated at cap]` marker (`:4-19`), and run through the same injection guard Chat applies to attachments unless `settings.injectionGuardBypass` is on (`:23-35`, called from `presentation-generate.ts:145`).
4. `resolvePresentationModel` (`:111-115`) — body `model` wins, then `settings.presentationGenModel`, then `defaults.presentations`.
5. `collectAssistantText` (`:80-97`) → `collectJobAssistantText` (`packages/host/src/job-regen.ts:199-201`) → `collectJobAssistantRun` (`:170-190`) → `runJobAssistantOnce` (`:68-146`): builds a synthetic `AgentVersionRecord` with `OUTLINE_SYSTEM` (`presentation-generate.ts:36-51`, `{languageRule}` substituted) as the system prompt, one user turn, `createRuntime(settings)`, and accumulates `assistant.delta` text. It passes `jobMode: "presentations"` (`presentation-generate.ts:93`), which is what sends the thinking-off knob `reasoning_effort: "low"` on always-thinking families — **the opposite of Chat, which deliberately sets no `jobMode`** (see [`chat-send.md`](chat-send.md#4-runtime--probe-stream-coerce)). A `run.failed` event becomes a `502 generation_failed` (`job-regen.ts:142-144`).
6. Empty text → `502` with `modeMessage("emptyPresentationOutline", locale)` (`:148-150`).
7. `parsePresentationOutline` (`packages/host/src/presentation-outline.ts:116`): strip optional ```json fences, slice from the first `{` to the last `}` (`extractJsonObject`, `:101`), `JSON.parse`, then zod. Anything that is not `{title: string, slides: [≥1]}` is a `502 invalid_outline` — the studio never sees half an outline.
8. `presentationOutlineMarkdown` (`packages/host/src/work-cards.ts:217-230`) renders the outline as `# title` + `## N. heading` blocks, which is saved as an artifact (`persistOutline`, `:118-138`, `mode: "presentations"`, `kind: "draft"`) and then ingested as a `Presentation` work card (`upsertWorkSource` + `artifactWorkCard`, `:159-162`). **Both are best-effort:** `persistOutline` swallows its own error and logs, and no artifact means no ingest, but the outline is still returned.

### 4. Preview — one stage, a slim filmstrip

`PresentationPreview` (`apps/web/components/presentation-preview.tsx:199`) mounts `presentations-editor` (`:503`). The studio passes `variant="simple"` (`apps/web/components/presentations-studio.tsx:480`). That hides the permanent shape toolbar and the properties column. Add-shape buttons, speaker notes, and rewrite-this-slide render into More through `toolsHost` (`presentations-studio.tsx:665`, portal at `presentation-preview.tsx:490`). A selected shape shows `presentations-selection-toolbar` (`:564`) on the slide: fill, stroke, shape text, duplicate, delete. Education passes the same `variant="simple"` (`apps/web/components/education-studio.tsx:334`), so its lesson has no permanent shape bar either. The full bar (`presentations-shape-toolbar`, `:427`) and `presentations-properties` (`:729`) remain the default when `variant` is omitted.

- `presentations-filmstrip` (`:511`) has one `presentations-filmstrip-slide` for the title (`:516`) and one per content slide (`:531`).
- The stage is `presentations-slide-title` or `presentations-slide` (`:550`), one at a time. Title, heading, and bullets are `contentEditable` (`presentations-edit-title` `:675`, `presentations-edit-heading` `:624`, `presentations-edit-bullets` `:630`).
- Each shape is `presentations-shape` (`:684`) with `data-kind`, `data-x`, `data-y`, `data-w`, `data-h`. Pointer move and resize listen on `window` and write `orig + delta` back onto the outline. The selected shape shows `presentations-shape-resize` (`:711`). Delete and Backspace remove it when focus is not in a field; arrow keys nudge it by 1 percent, Shift+arrow by 5. `presentations-shape-duplicate` copies it 3 percent down and right and selects the copy. The cap stays 24 shapes.
- Full-mode `presentations-properties` (`:729`) holds fill, stroke, shape text, delete, speaker notes (`presentations-edit-notes` `:792`), and one `presentations-regen` (`:803`). In the studio those notes and the regen button are the portaled copies (`:450`, `:461`).

Layout is not taken at face value. `resolvePresentationSlideLayout` (`apps/web/lib/presentation-outline.ts:73`) repairs decks where the model returned only `bullets` kinds: last slide becomes `close`, the middle slide becomes `split` if it has ≥3 bullets, a `section` with ≥3 bullets is demoted to `bullets`, and a `split` with no `aside` either steals its last bullet (`takeAside`, `:55`) or falls back to `bullets`. The **same function also exists host-side** (`packages/host/src/presentation-outline.ts:69`) and is what the PPTX builder calls — that is the only reason preview and export agree.

### 5. Regenerate one slide

`presentations-regen` toggles `regenOpen` (`apps/web/components/presentation-preview.tsx:214`) and mounts the shared `JobRegenPanel`, which is where `presentations-regen-panel` / `-prompt` / `-model` / `-file` / `-attach` / `-submit` come from (`apps/web/components/job-regen-panel.tsx:120`, `:137`, `:145`, `:155`, `:185`, `:201`). Opening the panel makes **no** request. In the studio the button lives in More, on the current content slide only. Education does not pass `onRegenerate`, so the lesson has no rewrite button.

Submit uploads any held image through `POST /api/v1/media`, inlines any held `.txt` into the instruction (`job-regen-panel.tsx:96-107`), then `onRegenerate` POSTs the **whole outline** plus `slideIndex` to `/api/v1/presentations/regenerate` (`apps/web/components/presentations-studio.tsx:268`; route `packages/host/src/router.ts:351`).

`regeneratePresentationSlide` (`packages/host/src/presentation-generate.ts:189-236`) re-validates the posted outline with `parsePresentationOutlineBody` (400 if malformed), range-checks `slideIndex` (400), gates on live runtime (503), builds a prompt carrying the deck title, the other slides' headings, and the current slide's full body, appends the user instruction (`appendRegenInstruction`, `job-regen.ts:31-33`), runs `SLIDE_SYSTEM` (`:167-176`), parses one slide (`parsePresentationSlide`, `presentation-outline.ts:138`) and returns `mergePresentationSlide(outline, index, slide)` (`:160`) — a new outline object, immutably replaced in renderer state.

### 6. Download — the same outline, server-rendered to PPTX

`onDownload` (`apps/web/components/presentations-studio.tsx:302`) POSTs the raw outline to `/api/v1/presentations/pptx`, reads the blob, pulls the filename out of `Content-Disposition`, and clicks a synthetic `<a download>`. The button is `presentations-download` (`:427`), the only primary control once a deck is open.

`handlePostPresentationsPptx` (`packages/host/src/handlers/jobs.ts:233-247`) is the odd one out: **no `getTenant`, no `requireGatewayAllowed`, no runtime check.** It validates the body and builds bytes. That is deliberate in effect — nothing here reaches the gateway — but it means a desk with a closed gate can still export a deck it is holding.

`buildPresentationPptx` (`packages/host/src/presentation-pptx.ts:292`) defines a 13.333 × 7.5 in layout, stamps `author`/`title` from `resolvedProductName()` and the outline title, adds the title slide (`addTitleSlide`, `:131`), then one content slide per outline slide (`addContentSlide`, `:189`) through the *same* `resolvePresentationSlideLayout` the preview used. `addOwnerShapes` (`:35`) maps each kind to an Office preset and writes fill and stroke. Speaker notes become real PPTX notes (`addNotes`, `:125`). Colors are the quiet-tool tokens as Office hex (`COLORS`, `:13`). The filename is `safeFilename` (`:80`): strip non-word characters, spaces to hyphens, cut at 60 chars, fall back to `presentation.pptx`.

### 7. Locale — slide copy follows the frozen boot locale, not a picker

There is no language control in the studio. `presentationLocale()` = `localeForRun()` (`packages/host/src/presentation-locale.ts:7-9`), i.e. the app locale frozen at boot (see [`locale-boot-and-run-harness.md`](locale-boot-and-run-harness.md)). It drives three things: the `{languageRule}` line spliced into `OUTLINE_SYSTEM` and `SLIDE_SYSTEM` (`presentation-locale.ts:11-16`, applied at `presentation-generate.ts:71-77`), the 503 copy (`:22-26`), and the PPTX title-slide kicker `PRESENTATION` / `PRESENTASI` (`:18-20`). Renderer chrome is separate — `apps/web/locales/{en,id}/presentation.json`, namespace `presentation` (singular) while the rail key stays `presentations`.

### 8. Handoff in — Research / Finance / Data / Market / Legal → Presentation

Presentation is a **handoff target**, never a source. `HANDOFF_TARGETS = ["documents", "presentations"]` (`apps/web/lib/mode-handoff.ts:9`). The five studios that render `ArtifactActions` (research, finance, data, market, legal) expose a `<prefix>-make-presentation` button (`apps/web/components/artifact-actions.tsx:99-107`) which calls `requestModeHandoff` with the artifact Markdown as `sourceText` and a canned prompt (`mode-handoff.ts:34-40`, `:45-51`) and pushes `/presentations`. The studio picks it up in `subscribeModeHandoff("presentations", …)` (`apps/web/components/presentations-studio.tsx:186`), which fills the source box, the source title, and the prompt. Because modes stay mounted, this needs no router state and no storage (`mode-handoff.ts:1-5`). The Presentation studio itself has no `ArtifactActions` row — no Download-Markdown, no Send-to-Knowledge-Base, no Make-a-document.

### 9. Open Slide — harness, stage, PPTX

Create defaults to Open Slide. Length and style are chips on the empty screen (`presentations-open-slide-pages`, `presentations-open-slide-density`, `apps/web/components/presentations-studio.tsx:504`). Movement and the builder stay in More (`presentations-open-slide-motion`, `presentations-engine` at `:537`). Those choices are the product form of open-slide's scoping questions. The aesthetic stays in the deck JSON and is not drawn on the stage.

Generate posts `{ prompt, brief, model?, sourceText? }` to `POST /api/v1/presentations/open-slide` (`packages/host/src/router.ts:353`). `generateOpenSlideDeck` (`packages/host/src/open-slide-generate.ts:147`) gates through the same handler as Nultron (`requireGatewayAllowedFor` in `packages/host/src/handlers/open-slide.ts:26`). When the runtime is stub it returns `draftOpenSlideDeck` (`packages/host/src/open-slide-generate.ts:158`, `packages/core/src/open-slide/draft.ts:333`) and does not open a socket. A live runtime sends `OPEN_SLIDE_SYSTEM` (`packages/core/src/open-slide/harness.ts:6`) through `withOutputLanguage(..., "presentations", locale)` (`packages/host/src/open-slide-generate.ts:97`, rule at `packages/core/src/output-language.ts:64`) and `collectJobAssistantRun` with `jobMode: "presentations"`. The language is `localeForRun()`.

The stage is `OpenSlideStage` (`apps/web/components/open-slide-stage.tsx:28`). A slim filmstrip (`presentations-open-slide-filmstrip`, `:119`) sits above the canvas (`presentations-open-slide-stage`, `:145`). Pages are `presentations-open-slide-page` (`:127`). Blocks are `presentations-open-slide-block` (`:237`) with pixel `data-x` / `data-y` on a 1920×1080 canvas. Clicking a text block edits it in place (`presentations-open-slide-text`, `:250`). Arrow keys call `nudgeOpenSlideBlock` (`packages/core/src/open-slide/deck.ts:244`), 8px, or 40px with Shift, when focus is not in the text. Color, duplicate, add text, and notes appear on `presentations-open-slide-toolbar` (`:152`) only while a block is selected. Movement is stored on the brief and not played.

Download posts that JSON to `POST /api/v1/presentations/open-slide/pptx` (`packages/host/src/router.ts:354`). `buildOpenSlidePptx` (`packages/host/src/open-slide-pptx.ts:73`) maps each page to one Office slide and writes speaker notes (`:87`). Like the Nultron PPTX route, this handler does not call the gateway. Save uses `open-slide-decks/` via `POST /api/v1/presentations/open-slide/decks` (`packages/host/src/router.ts:356`), a different folder from Nultron outlines so a Nultron parser never reads an Open Slide file.

Not in this cut: Babel source edits, present mode, stepped motion, PDF, static HTML, remote fonts, and `svgl.app`. The harness text names no URL. A font value that contains a URL is replaced with `system-ui`.

### Failure modes

| Failure | Where | What the user gets |
|---|---|---|
| Gate closed | `requireGatewayAllowed`, `packages/host/src/handlers/jobs.ts:215`, `:163` | HTTP 403, **flat** `{error:"gateway_blocked", status, message}` (`packages/host/src/errors.ts:20-25`) → the studio's `errorMessage()` cannot read it and shows the generic fallback (see Gotchas) |
| No gateway key / `AGENTFORGE_RUNTIME=stub` | `requireLivePresentationRuntime`, `presentation-generate.ts:99-109` | HTTP 503 `runtime_stub`; `presentations-error` shows the gateway copy + an `Open Settings` link |
| Empty / missing `prompt` | `readPrompt`, `:53-62` | HTTP 400 `invalid_request` (Create is disabled on an empty prompt, `presentations-studio.tsx:672`, so this needs a direct POST) |
| `sourceText` not a string / injection hit | `job-source.ts:38-52`, `:23-35` | HTTP 400 `invalid_request` / `injection_blocked` |
| `slideIndex` out of range | `readSlideIndex`, `:178-187` and `mergePresentationSlide`, `presentation-outline.ts:160` | HTTP 400 `invalid_request` |
| Posted outline malformed (regen or PPTX) | `parsePresentationOutlineBody`, `presentation-outline.ts:172` | HTTP 400 `invalid_request` |
| Model returned nothing | `presentation-generate.ts:148-150`, `:232-234` | HTTP 502 `generation_failed` |
| Model returned non-JSON / wrong shape | `extractJsonObject` + zod, `presentation-outline.ts:101-142` | HTTP 502 `invalid_outline` |
| Run failed mid-stream | `collectJobAssistantText`, `job-regen.ts:142-144` | HTTP 502 `generation_failed` carrying the runtime's own message |
| Regen attachment not an image_url | `readJobRegenAttachments`, `job-regen.ts:35-66` | HTTP 400 `invalid_request` |
| Regen attachment on a text-only model | `assertModelSupportsModality`, `job-regen.ts:92` | HTTP 4xx from core before any gateway call |
| Artifact save or KB ingest fails | `persistOutline` catch, `presentation-generate.ts:133-137` | **Nothing visible.** Warning on the host console; the outline still renders and still downloads |

## Where things live

| File | Role |
|---|---|
| `apps/web/components/presentations-studio.tsx` | The mode: one `outline` state, generate / regen / download, error banner, starters, gallery, prompt bar |
| `apps/web/components/presentation-preview.tsx` | Title card + slide cards + notes + the regen button and panel mount |
| `apps/web/lib/presentation-outline.ts` | Renderer copy of the zod schema and `resolvePresentationSlideLayout` |
| `apps/web/lib/job-starters.ts` | `PRESENTATION_STARTERS` / `_ID` (2 each) and `presentationStarters(locale)` (`:86`, `:247`, `:409`) |
| `apps/web/components/job-regen-panel.tsx` | Shared slide/section regen composer (`presentations-regen-*`) |
| `apps/web/components/source-material-field.tsx` | `presentations-source*` box, 120k cap mirrored from the host |
| `apps/web/components/example-gallery.tsx`, `apps/web/lib/ui-copy.ts` | Templates gallery and its locale-slug lookup |
| `apps/web/lib/use-job-model.ts` | Model list + default for `presentations` |
| `apps/web/lib/mode-handoff.ts`, `apps/web/components/artifact-actions.tsx` | "Make a presentation" handoff into the mode |
| `apps/web/components/work-mode-keep-alive.tsx`, `apps/web/src/App.tsx` | Why `/presentations` renders `null` in the router and stays mounted |
| `apps/web/locales/{en,id}/presentation.json` | Renderer chrome, gallery copy, six template briefs |
| `packages/host/src/router.ts:350-358` | Nultron generate, regenerate, PPTX, and deck store, plus the Open Slide routes |
| `packages/host/src/handlers/jobs.ts:211-247` | Gate + tenant for generate/regen; **neither** for pptx |
| `packages/host/src/presentation-generate.ts` | `OUTLINE_SYSTEM`, `SLIDE_SYSTEM`, runtime gate, model resolve, artifact + KB persist |
| `packages/host/src/presentation-outline.ts` | Host copy of the schema, JSON extraction, merge, layout resolve |
| `packages/host/src/presentation-pptx.ts` | pptxgenjs deck: layout, chrome, four slide kinds, notes, filename |
| `packages/host/src/presentation-locale.ts` | `presentationLocale` / `presentationLanguageRule` / `presentationKicker` / `presentationGatewayMessage` |
| `packages/host/src/job-regen.ts`, `packages/host/src/job-source.ts` | Shared job runtime call and the `sourceText` contract |
| `packages/host/src/work-cards.ts:217` | `presentationOutlineMarkdown` — the artifact body and the KB card body |
| `packages/core/src/models/mode-defaults.ts:60-67` | Ranked model preference for the mode |
| `packages/core/src/templates/library.ts:502-643` | The six gallery entries |

## Gotchas

- **`presentation-outline.ts` exists twice, byte-identical.** `apps/web/lib/presentation-outline.ts` and `packages/host/src/presentation-outline.ts` differ only in the `ApiError` import specifier (`@agentforge/core/errors` vs `@agentforge/core`); their test files are duplicated the same way. `resolvePresentationSlideLayout` is what makes the HTML preview and the PPTX agree, so a one-sided edit silently desynchronizes what the user saw from what they downloaded.
- **`/api/v1/presentations/pptx` is ungated.** `packages/host/src/handlers/jobs.ts:233-247` calls neither `getTenant` nor `requireGatewayAllowed`, unlike its two siblings at `:148` and `:159`. Nothing leaks (the body is the outline the caller already holds and nothing reaches the gateway), but it is the one presentations route a closed gate does not stop.
- **The model dropdown is empty and disabled for the first few hundred ms.** `useJobModel` starts at `models: []` (`apps/web/lib/use-job-model.ts:70-71`) and `ModelSelect` disables itself while the list is empty (`apps/web/components/model-select.tsx:63`). A drive that asserts `presentations-studio-model` *visible* passes instantly; one that reads its options must wait for them. Measured on the desk: 0 options at first paint, 101 after `/api/v1/models` resolved.
- **The "Open Settings" link is suppressed on an English desk, on purpose.** The condition at `apps/web/components/presentations-studio.tsx:442` is `matches gateway|api key|settings|runtime_stub|live gateway` **and** `does not match settings` — and the English 503 copy already says "…in Settings" (`packages/host/src/presentation-locale.ts:26`). The Indonesian copy says "Pengaturan", so the link *does* render there. Same banner, different anatomy per locale.
- **Two error vocabularies for the same wall.** The host 503 string lives in `presentation-locale.ts:22-26`; the renderer also ships `presentation.gatewayError` with the identical sentence in both catalogs — with **zero references** anywhere in `apps/` or `packages/`. Same for `presentation.kicker` (the kicker is produced host-side by `presentationKicker`). Dead keys that look authoritative.
- **Regen posts the entire deck, every time.** `apps/web/components/presentations-studio.tsx:276-287` sends the whole `outline` object plus `slideIndex`; the host re-validates it (`parsePresentationOutlineBody`) and returns a whole new outline. There is no per-slide id and no server-side deck state — the client is the source of truth between calls.
- **The regen panel survives its own failure.** After a 503 the panel stays open, the preview stays rendered, and `presentations-error` appears at the top of the studio, not inside the panel. Verified on the desk.
- **The starter path writes nothing.** Starters are constants in `apps/web/lib/job-starters.ts`; loading one creates no artifact, no thread, no KB card. Only a *successful live generate* persists (`presentation-generate.ts:153-163`). A harness run on a stub desk therefore leaves the owner's data untouched even after a PPTX download.
- **The deck dies on reload, not on navigation.** `WorkModeKeepAlive` keeps the component mounted across rail switches, so the outline survives Chat → Presentation round trips; `F5` clears it because nothing is persisted client-side either.
- **A "6-slide" starter has 7 filmstrip entries.** `total = outline.slides.length + 1` (`apps/web/components/presentation-preview.tsx`). The stage shows one testid at a time: `presentations-slide-title` or `presentations-slide`. Shapes exist only on content slides.
- **Presentation sends `jobMode`, Chat does not.** `presentation-generate.ts:93` and `:227` pass `jobMode: "presentations"`, which turns on the always-thinking-off knob for quiet families (`packages/core/src/models/job-thinking.ts`). Chat deliberately leaves it unset — do not "fix" one to match the other.
- **`sourceText` is guarded like a Chat attachment.** Pasted or handed-off material runs through `scanInjection` (`packages/host/src/job-source.ts:23-35`) unless the owner turned the guard off, so a hostile dossier pasted into the source box is a 400, not a prompt.
- **Nothing tests the generate path.** There is no `presentation-generate.test.ts`; `presentation-locale.test.ts`, `presentation-outline.test.ts` (×2) and `presentation-pptx.test.ts` cover the pieces, not the assembled system prompt. This is blocker P13's Presentation half (`docs/internal/blockers-2026-09-15.md:21`).

## Verify

`.cursor/skills/verify-agentforge/features/presentations.md` — sub-features `presentations-rail`, `presentations-shell`, `presentations-starter`, `presentations-studio-model`, `presentations-regen`, `presentations-download` (recipe names, not DOM testids).

DOM testids that prove it: `mode-presentations` (rail, `mode-${href.slice(1)}`), `presentations-studio` (`apps/web/components/presentations-studio.tsx:414`), `presentations-studio-empty` (`:485`), `presentations-hint` (`:487`), `presentations-studio-prompt-bar` (`:501`), `presentations-prompt` (`:405`), `presentations-generate` (`:673` on an empty desk, `:660` inside More once a deck is open), `presentations-more` (`:515`), `presentations-download` (`:427`), `presentations-error` (`:439`), `presentations-engine` (`:537`, inside More), `presentations-starter` (`:594`), `presentations-enhance` (`:573`), `presentations-studio-model` (`:565`), `presentations-save-deck` (`:642`). Nultron stage: `presentations-editor` / `presentations-filmstrip` / `presentations-edit-heading` / `presentations-shape` / `presentations-selection-toolbar` (`apps/web/components/presentation-preview.tsx:503`, `:511`, `:624`, `:684`, `:564`). Open Slide stage: `presentations-open-slide-stage` / `presentations-open-slide-text` / `presentations-open-slide-toolbar` (`apps/web/components/open-slide-stage.tsx:145`, `:250`, `:152`). Education uses the simple stage (`education-studio.tsx:334`) and does not show `presentations-shape-toolbar` until More is open.

Cloud coverage (and `pnpm ci:local --e2e`) is `apps/web/tests/e2e/foundation.spec.ts:89-107` (rail → studio → More → 2 starters → preview → regen panel → 503). Packaged proof needs `doctor.mjs --desktop`, not `:3000`.

## Why

**Why the mode accepts source material and a handoff at all.** `[Direct]` `docs/internal/0.14.22-changelog.md:9` scopes the change as "an optional source-material input on Documents and Presentation, a renderer handoff between modes", and `:11` records the host half: "`document-generate.ts` / `presentation-generate.ts` accept `sourceText` on generate and regenerate and add the 'use only supplied material' rule to the system prompt." `[Direct]` the plan item that drove it, `docs/internal/research-dossier-analyst-modes-plan.md:37` (A5), and the owner's stated priority at `:3`: "Research dossier as a portable Markdown artifact that feeds Knowledge Base, Presentation, and Documents." **Confidence: high.**

**Why the outline is also saved as an artifact and ingested.** `[Direct]` `docs/internal/0.14.23-changelog.md:15`: `document-generate.ts` and `presentation-generate.ts` "now also persist a `draft` artifact in mode `documents` / `presentations`, then ingest `artifact:<id>`; the returned draft / outline shape is unchanged." The "shape is unchanged" clause is why `persistOutline` is allowed to fail quietly. **Confidence: high.**

**Why Presentation names its `jobMode` while Chat does not.** `[Direct]` `docs/internal/0.14.26-changelog.md:135`: "Every studio names its mode at its `collectJobAssistantText` call (finance, documents, presentations, research, data, market, legal) … Chat never sets it and its body is unchanged byte for byte." `[Supported]` `docs/internal/blockers-2026-09-15.md:231` closes P6 with the same list. The reasoning for the asymmetry is recorded in [`chat-send.md`](chat-send.md#why): Chat's effort is a visible user choice. **Confidence: high.**

**Why the slide locale is read from the i18n core rather than a per-job field.** `[Direct]` `docs/internal/0.14.26-changelog.md:21`: "Presentation reads the slide locale from the i18n core." `[Direct]` `:73` records the renderer half of the same sweep — `presentation-preview.tsx` title localized, "(also fixed its missing `useProductBrand` import — a runtime crash on HEAD)", and "Presentation example gallery (`presentation.json` gained `galleryTitle` / `galleryHint` / six `templates.*`)". That commit is why the gallery has locale copy at all. **Confidence: high.**

**Why the editor is a stage and still not a full canvas.** `[Direct]` `docs/product-modes.md` Presentation — the owner edits title, heading, and bullets on the slide and places nine shape kinds that are dragged, resized, and written into the PPTX. The same page says there is no pen, table, chart, or master. `[Direct]` the stage is `presentations-editor` (`apps/web/components/presentation-preview.tsx:503`), shapes are `presentations-shape` (`:684`), and `addOwnerShapes` (`packages/host/src/presentation-pptx.ts:35`) writes the Office presets. The stage bar uses `--mode`, so it follows the presentations colour on that desk. **Confidence: high.**
