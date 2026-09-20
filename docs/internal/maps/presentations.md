# Map — Presentation

Last verified: 2026-09-20 at ac2d182 (Phase 5 lane A: citations re-anchored by content)

## Overview

Presentation is a **job**, not a slide editor: a topic goes in the prompt bar, the model returns one JSON outline, the renderer paints that outline as HTML slide cards, and a second route turns the same in-memory outline into a `.pptx` the browser downloads. There is no slide canvas, no drag handle, no autosave of a deck; the only persisted trace of a run is a Markdown **artifact** (`mode: presentations`, `kind: draft`) plus a Knowledge Base work card.

The thing to hold onto: **the outline lives in React state and nowhere else.** `PresentationsStudio` keeps one `outline` object (`apps/web/components/presentations-studio.tsx:35`); starters, live generate, and slide regen all just replace it, and Download POSTs that same object straight back to the host. A page reload throws the deck away — which is also why the starter path can produce a real PPTX with no gateway key at all.

## How it works

### 1. Reaching the studio

The rail tab is `mode-presentations` (`mode-${href.slice(1)}`), and `/presentations` is one of the work-mode routes that renders **`null`** in the router (`apps/web/src/App.tsx:158`). The real component is mounted by `WorkModeKeepAlive`, which maps `/presentations` → `PresentationsStudio` (`apps/web/components/work-mode-keep-alive.tsx:26`) and keeps every visited mode mounted, hidden when inactive (`:48-54`). Consequence, verified on the desk: switch to Chat and back and the loaded deck is still there; reload and it is gone.

The pane is `absolute inset-0 … overflow-y-auto` (`apps/web/components/work-mode-keep-alive.tsx:68`) precisely because Presentation has no inner scroller — the comment at `:32-40` names it.

### 2. The shell — four input surfaces, one of which needs no key

`PresentationsStudio` (`apps/web/components/presentations-studio.tsx:29`) renders, top to bottom:

| Surface | testid | Works on a stub desk? |
|---|---|---|
| Empty-state block + 2 starter cards | `presentations-studio-empty` (`:198`), `presentations-starter` (`:211`) | **Yes** — canned outlines, no network |
| Templates gallery (6 cards) | `example-gallery` / `example-card` / `example-result` (`apps/web/components/example-gallery.tsx:19`, `:29`, `:49`) | **Yes** — fills `presentations-prompt` only |
| Source material box + saved-artifact picker | `presentations-source*` (`apps/web/components/source-material-field.tsx:28`, `:36`, `:48`, `:65`, `:84`) | Yes (the picker lists saved artifacts) |
| Prompt bar: enhance, model select, prompt, Generate | `presentations-enhance` (`:249`), `presentations-studio-model` (`:240`), `presentations-prompt` (`:259`), `presentations-generate` (`:266`) | Enhance **yes** (stub short-circuit); Generate **no** (503) |

The gallery entries come from core (`packages/core/src/templates/library.ts:502-643`, six `mode: "presentations"` rows) and are localized by slug through `localizedLibrary` (`apps/web/lib/ui-copy.ts:34-52`) against the `presentation.templates.*` keys. Clicking a card only calls `setPrompt(entry.prompt)` (`apps/web/components/presentations-studio.tsx:186`) — it never generates.

The model dropdown is the **chat catalog**, not a presentation-specific list: `useJobModel("presentations")` (`apps/web/lib/use-job-model.ts:56`) fetches `/api/v1/models` + `/api/v1/settings` in parallel and seeds from `modes.presentations` / `defaults.presentations` / `settings.presentationGenModel` (`:73-88`). Host side, `modeCatalogPayload` hands presentations `curated.chat` verbatim (`packages/host/src/selectable-models.ts:147`) and `resolveModeDefaults` picks the first live id out of `JOB_MODE_PREFERENCES.presentations` = `glm-5.3-flash`, `glm-5.3-flash-preview`, `glm-5.2-fast-preview`, `glm-5.2`, `glm-5.3`, `kimi-k3` (`packages/core/src/models/mode-defaults.ts:42-49`). On this desk that resolved to `glm-5.3-flash` out of 110 catalog ids, rendered as 101 `<option>`s because `ModelSelect` runs them through `pickerGroups` (`apps/web/components/model-select.tsx:56`).

### 3. Generate — prompt bar → `POST /api/v1/presentations` → one JSON outline

`onGenerate` (`apps/web/components/presentations-studio.tsx:51-76`) POSTs `{ prompt, model?, sourceText? }` through `apiFetch`, so webdev and the packaged app share one call. Route table: `packages/host/src/router.ts:209`.

`handlePostPresentations` (`packages/host/src/handlers/jobs.ts:148-157`) resolves the tenant and calls `requireGatewayAllowed(loadSettings(...))` **before** anything else — a closed gate is a flat `403 gateway_blocked` here, never a failed model call.

`generatePresentationOutline` (`packages/host/src/presentation-generate.ts:140-164`) then:

1. `readPrompt` — a missing / blank `prompt` is a 400 (`:52-61`).
2. `requireLivePresentationRuntime` (`:98-108`) — `resolveRuntimeMode({settingsHasKey: hasLiveProvider(settings), envRuntime})`; stub throws `ApiError("runtime_stub", presentationGatewayMessage(locale), 503)`. **This is the state on an unkeyed desk** and it is the one the harness proves.
3. `readSourceText` (`packages/host/src/job-source.ts:38-52`) — optional, trimmed, capped at 120 000 chars with a visible `[source material truncated at cap]` marker (`:4-19`), and run through the same injection guard Chat applies to attachments unless `settings.injectionGuardBypass` is on (`:23-35`, called from `presentation-generate.ts:144`).
4. `resolvePresentationModel` (`:110-114`) — body `model` wins, then `settings.presentationGenModel`, then `defaults.presentations`.
5. `collectAssistantText` (`:79-96`) → `collectJobAssistantText` (`packages/host/src/job-regen.ts:67-150`): builds a synthetic `AgentVersionRecord` with `OUTLINE_SYSTEM` (`presentation-generate.ts:35-50`, `{languageRule}` substituted) as the system prompt, one user turn, `createRuntime(settings)`, and accumulates `assistant.delta` text. It passes `jobMode: "presentations"` (`presentation-generate.ts:92`), which is what sends the thinking-off knob `reasoning_effort: "low"` on always-thinking families — **the opposite of Chat, which deliberately sets no `jobMode`** (see [`chat-send.md`](chat-send.md#4-runtime--probe-stream-coerce)). A `run.failed` event becomes a `502 generation_failed` (`job-regen.ts:147-149`).
6. Empty text → `502` with `modeMessage("emptyPresentationOutline", locale)` (`:147-149`).
7. `parsePresentationOutline` (`packages/host/src/presentation-outline.ts:88-108`): strip optional ```json fences, slice from the first `{` to the last `}` (`extractJsonObject`, `:73-85`), `JSON.parse`, then zod. Anything that is not `{title: string, slides: [≥1]}` is a `502 invalid_outline` — the studio never sees half an outline.
8. `presentationOutlineMarkdown` (`packages/host/src/work-cards.ts:159-172`) renders the outline as `# title` + `## N. heading` blocks, which is saved as an artifact (`persistOutline`, `:117-137`, `mode: "presentations"`, `kind: "draft"`) and then ingested as a `Presentation` work card (`upsertWorkSource` + `artifactWorkCard`, `:158-161`). **Both are best-effort:** `persistOutline` swallows its own error and logs, and no artifact means no ingest, but the outline is still returned.

### 4. Preview — the outline becomes slide cards

`PresentationPreview` (`apps/web/components/presentation-preview.tsx:104`) draws `outline.slides.length + 1` cards:

- One **title card**, `presentations-slide-title` (`:119`). It is not a slide, carries no regen button, and its kicker is the localized `presentation.title` string (`:124`).
- One `presentations-slide` article per outline slide (`:38`), each with a `presentations-regen` button in its top-right corner (`:151`) and a `Notes: …` paragraph rendered **outside** the article when `slide.notes` is non-empty (`:160-164`).

Every bullet, the `aside`, and the notes go through `FormattedText … inline` (`:62`, `:86`, `:162`), the same markdown renderer Chat's `message-output` uses. The two shipped starters contain no markdown syntax, so a starter drive cannot show bold/code — the claim is true by source, not by the starter path.

Layout is not taken at face value. `resolvePresentationSlideLayout` (`apps/web/lib/presentation-outline.ts:38-68`) repairs decks where the model returned only `bullets` kinds: last slide becomes `close`, the middle slide becomes `split` if it has ≥3 bullets, a `section` with ≥3 bullets is demoted to `bullets`, and a `split` with no `aside` either steals its last bullet (`takeAside`, `:24-35`) or falls back to `bullets`. The **same function, byte-identical, also exists host-side** (`packages/host/src/presentation-outline.ts:38-68`) and is what the PPTX builder calls — that is the only reason preview and export agree.

### 5. Regenerate one slide

`presentations-regen` toggles `openIndex` (`apps/web/components/presentation-preview.tsx:148`) and mounts the shared `JobRegenPanel` with `testIdPrefix="presentations"` (`:166-176`), which is where `presentations-regen-panel` / `-prompt` / `-model` / `-file` / `-attach` / `-submit` come from (`apps/web/components/job-regen-panel.tsx:120`, `:137`, `:145`, `:155`, `:185`, `:201`). Opening the panel makes **no** request.

Submit uploads any held image through `POST /api/v1/media`, inlines any held `.txt` into the instruction (`:96-107`), then `onRegenerate` POSTs the **whole outline** plus `slideIndex` to `/api/v1/presentations/regenerate` (`apps/web/components/presentations-studio.tsx:86-98`; route `packages/host/src/router.ts:210`).

`regeneratePresentationSlide` (`packages/host/src/presentation-generate.ts:188-235`) re-validates the posted outline with `parsePresentationOutlineBody` (400 if malformed), range-checks `slideIndex` (400), gates on live runtime (503), builds a prompt carrying the deck title, the other slides' headings, and the current slide's full body, appends the user instruction (`appendRegenInstruction`, `job-regen.ts:30-32`), runs `SLIDE_SYSTEM` (`:166-175`), parses one slide (`parsePresentationSlide`, `presentation-outline.ts:110-130`) and returns `mergePresentationSlide(outline, index, slide)` (`:132-142`) — a new outline object, immutably replaced in renderer state.

### 6. Download — the same outline, server-rendered to PPTX

`onDownload` (`apps/web/components/presentations-studio.tsx:112-143`) POSTs the raw outline to `/api/v1/presentations/pptx`, reads the blob, pulls the filename out of `Content-Disposition`, and clicks a synthetic `<a download>`.

`handlePostPresentationsPptx` (`packages/host/src/handlers/jobs.ts:170-184`) is the odd one out: **no `getTenant`, no `requireGatewayAllowed`, no runtime check.** It validates the body and builds bytes. That is deliberate in effect — nothing here reaches the gateway — but it means a desk with a closed gate can still export a deck it is holding.

`buildPresentationPptx` (`packages/host/src/presentation-pptx.ts:230-256`) defines a 13.333 × 7.5 in layout, stamps `author`/`title` from `resolvedProductName()` and the outline title, adds the title slide (`:72-104`, kicker from `presentationKicker(locale)`), then one content slide per outline slide through the *same* `resolvePresentationSlideLayout` the preview used (`:137`). Speaker notes become real PPTX notes (`addNotes`, `:66-70`). Colors are the quiet-tool tokens as Office hex (`:9-17`), font Calibri (`:19`). The filename is `safeFilename` (`:21-28`): strip non-word characters, spaces to hyphens, cut at 60 chars, fall back to `presentation.pptx`.

### 7. Locale — slide copy follows the frozen boot locale, not a picker

There is no language control in the studio. `presentationLocale()` = `localeForRun()` (`packages/host/src/presentation-locale.ts:7-9`), i.e. the app locale frozen at boot (see [`locale-boot-and-run-harness.md`](locale-boot-and-run-harness.md)). It drives three things: the `{languageRule}` line spliced into `OUTLINE_SYSTEM` and `SLIDE_SYSTEM` (`presentation-locale.ts:11-16`, applied at `presentation-generate.ts:71-77`), the 503 copy (`:22-26`), and the PPTX title-slide kicker `PRESENTATION` / `PRESENTASI` (`:18-20`). Renderer chrome is separate — `apps/web/locales/{en,id}/presentation.json`, namespace `presentation` (singular) while the rail key stays `presentations`.

### 8. Handoff in — Research / Finance / Data / Market / Legal → Presentation

Presentation is a **handoff target**, never a source. `HANDOFF_TARGETS = ["documents", "presentations"]` (`apps/web/lib/mode-handoff.ts:9`). The five studios that render `ArtifactActions` (research, finance, data, market, legal) expose a `<prefix>-make-presentation` button (`apps/web/components/artifact-actions.tsx:99-107`) which calls `requestModeHandoff` with the artifact Markdown as `sourceText` and a canned prompt (`mode-handoff.ts:34-40`, `:45-51`) and pushes `/presentations`. The studio picks it up in `subscribeModeHandoff("presentations", …)` (`apps/web/components/presentations-studio.tsx:40-49`), which fills the source box, the source title, and the prompt. Because modes stay mounted, this needs no router state and no storage (`mode-handoff.ts:1-5`). The Presentation studio itself has no `ArtifactActions` row — no Download-Markdown, no Send-to-Knowledge-Base, no Make-a-document.

### Failure modes

| Failure | Where | What the user gets |
|---|---|---|
| Gate closed | `requireGatewayAllowed`, `packages/host/src/handlers/jobs.ts:151`, `:162` | HTTP 403, **flat** `{error:"gateway_blocked", status, message}` (`packages/host/src/errors.ts:20-25`) → the studio's `errorMessage()` cannot read it and shows the generic fallback (see Gotchas) |
| No gateway key / `AGENTFORGE_RUNTIME=stub` | `requireLivePresentationRuntime`, `presentation-generate.ts:98-108` | HTTP 503 `runtime_stub`; `presentations-error` shows the gateway copy + an `Open Settings` link |
| Empty / missing `prompt` | `readPrompt`, `:52-61` | HTTP 400 `invalid_request` (the Generate button is disabled on an empty prompt, `presentations-studio.tsx:265`, so this needs a direct POST) |
| `sourceText` not a string / injection hit | `job-source.ts:38-52`, `:23-35` | HTTP 400 `invalid_request` / `injection_blocked` |
| `slideIndex` out of range | `readSlideIndex`, `:177-186` and `mergePresentationSlide`, `presentation-outline.ts:137-139` | HTTP 400 `invalid_request` |
| Posted outline malformed (regen or PPTX) | `parsePresentationOutlineBody`, `presentation-outline.ts:144-154` | HTTP 400 `invalid_request` |
| Model returned nothing | `presentation-generate.ts:147-149`, `:231-233` | HTTP 502 `generation_failed` |
| Model returned non-JSON / wrong shape | `extractJsonObject` + zod, `presentation-outline.ts:73-130` | HTTP 502 `invalid_outline` |
| Run failed mid-stream | `collectJobAssistantText`, `job-regen.ts:147-149` | HTTP 502 `generation_failed` carrying the runtime's own message |
| Regen attachment not an image_url | `readJobRegenAttachments`, `job-regen.ts:34-65` | HTTP 400 `invalid_request` |
| Regen attachment on a text-only model | `assertModelSupportsModality`, `job-regen.ts:91` | HTTP 4xx from core before any gateway call |
| Artifact save or KB ingest fails | `persistOutline` catch, `presentation-generate.ts:132-136` | **Nothing visible.** Warning on the host console; the outline still renders and still downloads |

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
| `packages/host/src/router.ts:209-211` | The three routes |
| `packages/host/src/handlers/jobs.ts:148-184` | Gate + tenant for generate/regen; **neither** for pptx |
| `packages/host/src/presentation-generate.ts` | `OUTLINE_SYSTEM`, `SLIDE_SYSTEM`, runtime gate, model resolve, artifact + KB persist |
| `packages/host/src/presentation-outline.ts` | Host copy of the schema, JSON extraction, merge, layout resolve |
| `packages/host/src/presentation-pptx.ts` | pptxgenjs deck: layout, chrome, four slide kinds, notes, filename |
| `packages/host/src/presentation-locale.ts` | `presentationLocale` / `presentationLanguageRule` / `presentationKicker` / `presentationGatewayMessage` |
| `packages/host/src/job-regen.ts`, `packages/host/src/job-source.ts` | Shared job runtime call and the `sourceText` contract |
| `packages/host/src/work-cards.ts:159` | `presentationOutlineMarkdown` — the artifact body and the KB card body |
| `packages/core/src/models/mode-defaults.ts:42-49` | Ranked model preference for the mode |
| `packages/core/src/templates/library.ts:502-643` | The six gallery entries |

## Gotchas

- **`presentation-outline.ts` exists twice, byte-identical.** `apps/web/lib/presentation-outline.ts` and `packages/host/src/presentation-outline.ts` differ only in the `ApiError` import specifier (`@agentforge/core/errors` vs `@agentforge/core`); their test files are duplicated the same way. `resolvePresentationSlideLayout` is what makes the HTML preview and the PPTX agree, so a one-sided edit silently desynchronizes what the user saw from what they downloaded.
- **`/api/v1/presentations/pptx` is ungated.** `packages/host/src/handlers/jobs.ts:170-184` calls neither `getTenant` nor `requireGatewayAllowed`, unlike its two siblings at `:148` and `:159`. Nothing leaks (the body is the outline the caller already holds and nothing reaches the gateway), but it is the one presentations route a closed gate does not stop.
- **The model dropdown is empty and disabled for the first few hundred ms.** `useJobModel` starts at `models: []` (`apps/web/lib/use-job-model.ts:61-62`) and `ModelSelect` disables itself while the list is empty (`apps/web/components/model-select.tsx:63`). A drive that asserts `presentations-studio-model` *visible* passes instantly; one that reads its options must wait for them. Measured on the desk: 0 options at first paint, 101 after `/api/v1/models` resolved.
- **The "Open Settings" link is suppressed on an English desk, on purpose.** The condition at `apps/web/components/presentations-studio.tsx:174` is `matches gateway|api key|settings|runtime_stub|live gateway` **and** `does not match settings` — and the English 503 copy already says "…in Settings" (`packages/host/src/presentation-locale.ts:26`). The Indonesian copy says "Pengaturan", so the link *does* render there. Same banner, different anatomy per locale.
- **Two error vocabularies for the same wall.** The host 503 string lives in `presentation-locale.ts:22-26`; the renderer also ships `presentation.gatewayError` with the identical sentence in both catalogs — with **zero references** anywhere in `apps/` or `packages/`. Same for `presentation.kicker` (the kicker is produced host-side by `presentationKicker`). Dead keys that look authoritative.
- **Regen posts the entire deck, every time.** `apps/web/components/presentations-studio.tsx:89-97` sends the whole `outline` object plus `slideIndex`; the host re-validates it (`parsePresentationOutlineBody`) and returns a whole new outline. There is no per-slide id and no server-side deck state — the client is the source of truth between calls.
- **The regen panel survives its own failure.** After a 503 the panel stays open, the preview stays rendered, and `presentations-error` appears at the top of the studio, not inside the panel. Verified on the desk.
- **The starter path writes nothing.** Starters are constants in `apps/web/lib/job-starters.ts`; loading one creates no artifact, no thread, no KB card. Only a *successful live generate* persists (`presentation-generate.ts:152-162`). A harness run on a stub desk therefore leaves the owner's data untouched even after a PPTX download.
- **The deck dies on reload, not on navigation.** `WorkModeKeepAlive` keeps the component mounted across rail switches, so the outline survives Chat → Presentation round trips; `F5` clears it because nothing is persisted client-side either.
- **A "6-slide" starter renders 7 cards.** `total = outline.slides.length + 1` (`apps/web/components/presentation-preview.tsx:113`) and the PPTX uses the same arithmetic (`presentation-pptx.ts:245`). `presentations-slide` counts 6; the title card has its own testid.
- **Presentation sends `jobMode`, Chat does not.** `presentation-generate.ts:92` and `:227` pass `jobMode: "presentations"`, which turns on the always-thinking-off knob for quiet families (`packages/core/src/models/job-thinking.ts`). Chat deliberately leaves it unset — do not "fix" one to match the other.
- **`sourceText` is guarded like a Chat attachment.** Pasted or handed-off material runs through `scanInjection` (`packages/host/src/job-source.ts:23-35`) unless the owner turned the guard off, so a hostile dossier pasted into the source box is a 400, not a prompt.
- **Nothing tests the generate path.** There is no `presentation-generate.test.ts`; `presentation-locale.test.ts`, `presentation-outline.test.ts` (×2) and `presentation-pptx.test.ts` cover the pieces, not the assembled system prompt. This is blocker P13's Presentation half (`docs/internal/blockers-2026-09-15.md:21`).

## Verify

`.cursor/skills/verify-agentforge/features/presentations.md` — sub-features `presentations-rail`, `presentations-shell`, `presentations-starter`, `presentations-studio-model`, `presentations-regen`, `presentations-download` (recipe names, not DOM testids).

DOM testids that prove it: `mode-presentations` (rail, `mode-${href.slice(1)}`), `presentations-studio` (`apps/web/components/presentations-studio.tsx:146`), `presentations-studio-empty` (`:198`), `presentations-studio-prompt-bar` (`:225`), `presentations-starter` (`:211`), `presentations-prompt` (`:259`), `presentations-generate` (`:266`), `presentations-enhance` (`:249`), `presentations-studio-model` (`:240`), `presentations-download` (`:160`), `presentations-error` (`:171`), `presentations-source` / `-source-toggle` / `-source-picker` / `-source-clear` / `-source-text` (`apps/web/components/source-material-field.tsx:28`, `:36`, `:48`, `:65`, `:84`), `example-gallery` / `example-card` / `example-result` (`apps/web/components/example-gallery.tsx:19`, `:29`, `:49`), `presentations-preview` / `presentations-slide-title` / `presentations-slide` / `presentations-regen` (`apps/web/components/presentation-preview.tsx:116`, `:119`, `:38`, `:151`), `presentations-regen-panel` / `-prompt` / `-model` / `-file` / `-attach` / `-submit` (`apps/web/components/job-regen-panel.tsx:120`, `:137`, `:145`, `:155`, `:185`, `:201`).

Cloud/GHA coverage is `apps/web/tests/e2e/foundation.spec.ts:89-103` (rail → studio → 2 starters → preview → regen panel → 503). Packaged proof needs `doctor.mjs --desktop`, not `:3000`.

## Why

**Why the mode accepts source material and a handoff at all.** `[Direct]` `docs/internal/0.14.22-changelog.md:9` scopes the change as "an optional source-material input on Documents and Presentation, a renderer handoff between modes", and `:11` records the host half: "`document-generate.ts` / `presentation-generate.ts` accept `sourceText` on generate and regenerate and add the 'use only supplied material' rule to the system prompt." `[Direct]` the plan item that drove it, `docs/internal/research-dossier-analyst-modes-plan.md:37` (A5), and the owner's stated priority at `:3`: "Research dossier as a portable Markdown artifact that feeds Knowledge Base, Presentation, and Documents." **Confidence: high.**

**Why the outline is also saved as an artifact and ingested.** `[Direct]` `docs/internal/0.14.23-changelog.md:15`: `document-generate.ts` and `presentation-generate.ts` "now also persist a `draft` artifact in mode `documents` / `presentations`, then ingest `artifact:<id>`; the returned draft / outline shape is unchanged." The "shape is unchanged" clause is why `persistOutline` is allowed to fail quietly. **Confidence: high.**

**Why Presentation names its `jobMode` while Chat does not.** `[Direct]` `docs/internal/0.14.26-changelog.md:135`: "Every studio names its mode at its `collectJobAssistantText` call (finance, documents, presentations, research, data, market, legal) … Chat never sets it and its body is unchanged byte for byte." `[Supported]` `docs/internal/blockers-2026-09-15.md:231` closes P6 with the same list. The reasoning for the asymmetry is recorded in [`chat-send.md`](chat-send.md#why): Chat's effort is a visible user choice. **Confidence: high.**

**Why the slide locale is read from the i18n core rather than a per-job field.** `[Direct]` `docs/internal/0.14.26-changelog.md:21`: "Presentation reads the slide locale from the i18n core." `[Direct]` `:73` records the renderer half of the same sweep — `presentation-preview.tsx` title localized, "(also fixed its missing `useProductBrand` import — a runtime crash on HEAD)", and "Presentation example gallery (`presentation.json` gained `galleryTitle` / `galleryHint` / six `templates.*`)". That commit is why the gallery has locale copy at all. **Confidence: high.**

**Why there is no in-browser slide editor.** `[Direct]` `docs/product-modes.md:20` defines the mode as "Prompt → outline → HTML preview + PPTX" and `:103` repeats it with the source-material note; the feature file's own first paragraph says "It is not an in-browser slide editor." `[Inferred]` the code shape agrees — the only mutation paths are whole-outline replacements (`setOutline` at `apps/web/components/presentations-studio.tsx:69`, `:103`, `:208`) and there is no per-slide editable field anywhere in `presentation-preview.tsx` — but the *intent* rests on the docs line, not on the code. **Confidence: high for the statement, medium for it being a standing product decision rather than a not-yet.**
