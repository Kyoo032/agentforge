# Map — Documents job

Last verified: 2026-09-20 at ac2d182 (Phase 5 lane A: citations re-anchored by content)

## Overview

Documents is a **job**, not an editor: a topic in the prompt bar becomes a JSON draft, the draft renders as an HTML preview of headed sections, and the user downloads a `.docx`. It is the simplest of the job modes — no SSE, no tools, no streaming progress. Three plain JSON `POST`s do the whole thing: `/api/v1/documents` (draft), `/api/v1/documents/regenerate` (one section), `/api/v1/documents/docx` (bytes).

Two things distinguish it from Chat. First, **the draft lives in renderer state**, not in a thread: `DocumentsStudio` holds one `draft` object and every action reads or replaces it, so a reload loses the document unless a live generate happened to save an artifact. Second, **`sourceText` is the mode's real feature** — an optional 120k-char block of material the model may use as its only source of facts, typed by hand, picked from a saved artifact, or pushed across from Research's "Make a document".

What it is not: a Word editor, a streaming mode, or a `/runs/*` consumer. It never touches the chat run orchestrator.

## How it works

### 1. Mounting — the pane is never unmounted

`/documents` has a `<Route path="/documents" element={null} />` in `apps/web/src/App.tsx:150`; the comment on `:148` says why. The real component is mounted by `WorkModeKeepAlive` (`apps/web/components/work-mode-keep-alive.tsx:41-44`), which maps `"/documents" → DocumentsStudio` (`:18`) and keeps **every visited** work-mode pane in the DOM, hiding the inactive ones (`:56-76`, the `hidden={!active}` / `className="hidden"` pair at `:65-68`). Panes are re-keyed on workspace change (`:43`).

Consequence, and it bites tests: after one visit to `/documents`, `documents-studio` still has count 1 on `/chat` and `/research`, with `isVisible() === false`, and `documents-prompt` keeps whatever was typed. Assert visibility, not count, when you mean "this mode is not showing".

### 2. Composing a request

`DocumentsStudio` (`apps/web/components/documents-studio.tsx:33`) holds six pieces of state (`:36-42`): `prompt`, `sourceText`, `sourceTitle`, `draft`, a single `busy` discriminator (`"generate" | "download" | "regen" | null`), `regenIndex`, and `error`. The generate bar is one `<form data-testid="documents-studio-prompt-bar">` (`:227-276`) holding, in order:

| Control | Where | Note |
|---|---|---|
| `SourceMaterialField` | `:232-239`, component at `apps/web/components/source-material-field.tsx:20` | `testIdPrefix="documents"` → `documents-source`, `-source-toggle`, `-source-title`, `-source-clear`, `-source-text` |
| `ModelSelect` | `:240-247` | `testId="documents-studio-model"`; a real `<select>` |
| `EnhancePromptButton` | `:249-256` | `testId="documents-enhance"` |
| the topic field | `:257-266` | `data-testid="documents-prompt"`, an **`<input type="text">`** |
| submit | `:267-274` | `data-testid="documents-generate"`, disabled while busy or when the prompt is blank |

`useJobModel("documents")` (`apps/web/lib/use-job-model.ts:18-19`) reads `GET /api/v1/models` and persists the choice into the desk's `documentGenModel` setting — the same field Finance, Market and Legal use (`:19-25`).

**Source material.** The box is collapsed until `documents-source-toggle` is pressed, or until `value.length > 0` opens it on its own (`source-material-field.tsx:21-22`). Beside it sits `ArtifactPicker` (`apps/web/components/artifact-picker.tsx:35`) with `testId="documents-source-picker"`, which derives `documents-source-picker-toggle` (`:92`), `documents-source-picker-panel` (`:99`) and `documents-source-picker-item` (`:116`). Opening it calls `listArtifacts()` for **every** mode (the `mode` prop is not passed, `source-material-field.tsx:46-55`), so a Research dossier, a Finance brief and a Legal memo are all pickable; picking one calls `getArtifact(id)` and drops the whole `body` into `sourceText` (`:50-54`). The web cap `SOURCE_TEXT_MAX_CHARS = 120_000` (`:8`) is a comment-documented mirror of the host's (`packages/host/src/job-source.ts:4`); the field only colours the counter red past it (`:87-93`) — it does not block.

**The handoff.** Research's action row calls `requestModeHandoff({ target: "documents", sourceText: markdown, prompt: suggestedHandoffPrompt(...), artifactId, title })` and then `router.push("/documents")` (`apps/web/components/artifact-actions.tsx:58-67`, button at `:90-98`). `mode-handoff.ts` is deliberately renderer-only — a module-level `pending` map plus a `window` CustomEvent, no router state and no storage (`apps/web/lib/mode-handoff.ts:1-5,42,45-51`). `DocumentsStudio` subscribes on mount (`documents-studio.tsx:44-53`); `subscribeModeHandoff` delivers immediately if something is already queued and then on the event (`mode-handoff.ts:68-87`), and `takePendingHandoff` **consumes** it (`:54-61`). The suggested prompt is fixed copy: `Write a memo from "<title>". Use only the source material and cite its sources.` (`:34-40`).

### 3. Generate — `POST /api/v1/documents`

`onGenerate` (`documents-studio.tsx:55-80`) trims the prompt, bails if empty or busy, and posts `{ prompt, model, sourceText }` through `apiFetch` (`:64-68`) — `sourceText` only when non-empty. A non-OK response becomes `error` via `errorMessage` (`:19-27`), which prefers `payload.error.message` and otherwise falls back to the localized `documents.errors.generate`. On failure `draft` is cleared (`:75`), so a failed generate also wipes whatever was on screen.

Host side, `router.ts:206` → `handlePostDocuments` (`packages/host/src/handlers/jobs.ts:110-119`): `getTenant`, then `requireGatewayAllowed(loadSettings(...))` **before** anything else, then `generateDocumentDraft`.

`generateDocumentDraft` (`packages/host/src/document-generate.ts:152-171`) in order:

1. `readPrompt` — a non-string or blank `prompt` is a 400 (`:65-74`).
2. `requireLiveDocumentRuntime` (`:112-122`) — `resolveRuntimeMode` on `hasLiveProvider(settings)` and `AGENTFORGE_RUNTIME`; `stub` throws `ApiError("runtime_stub", gatewayRequiredMessage("documents", locale), 503)`. **This is the gate every keyless drive hits**, and it is why the error copy names Settings.
3. `readSourceText` (`job-source.ts:38-52`) — absent → `""`; non-string → 400; otherwise trimmed, capped at 120k with `SOURCE_TRUNCATED_MARKER` appended (`:15-20`), then run through `assertSafeSourceText` → `scanInjection`, which throws `injection_blocked` 400 unless the desk set `injectionGuardBypass` (`:23-35`, threaded from `document-generate.ts:155`).
4. `resolveDocumentModel` (`:124-132`) — body `model`, else `settings.documentGenModel`, else the mode default, resolved against the live catalog by `resolveChatModel`. The Documents bucket **is** the chat bucket (`packages/host/src/selectable-models.ts:145`) and the default ladder is `["hy3", "hy-3", "hunyuan-3", "hunyuan3", "deepseek-v4-flash"]` (`packages/core/src/models/mode-defaults.ts:40`) — Finance's is the same list minus one alias (`:50`), which is why both land on `deepseek-v4-flash` on a gateway without Hunyuan.
5. `collectAssistantText` (`:93-110`) → `collectJobAssistantText` (`packages/host/src/job-regen.ts:67`) with `jobMode: "documents"`, system prompt `withSourceRule(documentJobSystemPrompt(finance), sourceText)` and user prompt `withSourceMaterial(prompt, sourceText)`. `DOCUMENT_SYSTEM` (`:48-63`) demands bare JSON, 5–8 sections (max 12), finished prose, and bans TBD/lorem filler; `withOutputLanguage` stamps the desk locale on it (`:88-91`). `withSourceMaterial` appends the material inside `<<<` / `>>>` fences (`job-source.ts:54-59`) and `withSourceRule` appends the "use only that material for facts" sentence (`:7-8,61-63`).
   Because `jobMode` is set, `applyJobThinking` adds `reasoning_effort: "low"` on always-thinking families — the knob Chat deliberately does not use (see [`chat-send.md`](chat-send.md#4-runtime--probe-stream-coerce)).
6. Empty output → `ApiError("generation_failed", …, 502)` (`:158-160`).
7. `parseDocumentDraft` (`packages/host/src/document-outline.ts:18-38`) — `extractJsonObject` peels fences, `JSON.parse`, then the zod `documentDraftSchema` (`:10-13`: non-empty title, ≥1 section, each with non-empty heading and body). Any failure is a **502 `invalid_document`**, not a 400: the model, not the user, produced it.
8. `persistDraft` (`:134-150`) saves a `mode: "documents", kind: "draft"` markdown artifact — wrapped in try/catch and explicitly documented as never failing the job.
9. If that saved, `upsertWorkSource(artifactWorkCard({ type: "Documents", … }))` files a knowledge work card (`:164-169`, `packages/host/src/work-cards.ts:113`, `:152`).

There is no `finance` toggle in the Documents UI; `isFinanceJob` (`:84-86`) reads a `job: "finance"` body field that only the Finance path sets, and it selects `FINANCE_SYSTEM` (`:33-46`) and the finance model default instead.

### 4. Preview

`DocumentPreview` (`apps/web/components/document-preview.tsx:18`) renders `documents-preview` (`:28`), the title, and one `documents-section` per entry (`:33`). Each section gets a `documents-regen` toggle (`:43`, suppressed when no `onRegenerate` prop is passed) and its body through `FormattedText` (`:49`) — the same markdown renderer Chat's `message-output` uses. Only one panel is open at a time: `openIndex` is local to the preview (`:25,40`).

**Starters** are the keyless path. `documents-starter` buttons (`documents-studio.tsx:207-221`) come from `documentStarters()` (`apps/web/lib/job-starters.ts:420-441`), which builds two fully-localized `DocumentDraft`s from locale keys — `status-memo` with 5 sections and `one-pager` with 6. Clicking one does `setDraft(starter.draft)` and clears the error (`:212-215`). No network call, no model, no artifact.

**Template cards** are a different thing. `ExampleGallery mode="documents"` (`:191`, component at `apps/web/components/example-gallery.tsx:12`) shows `example-gallery` / `example-card` / `example-result` from the 6 Documents entries in `packages/core/src/templates/library.ts`. `onSelect` only does `setPrompt(entry.prompt)` — a card never produces a draft.

### 5. Regenerate one section — `POST /api/v1/documents/regenerate`

`JobRegenPanel` (`apps/web/components/job-regen-panel.tsx`, mounted at `document-preview.tsx:51-60` with `testIdPrefix="documents"`) is shared with Finance, Market and Presentation, so every testid is derived: `documents-regen-panel` (`:120`), `-regen-prompt` (`:137`), `-regen-model` (`:145`, via `ModelSelect`), `-regen-file` (`:155`, an `sr-only` file input), `-regen-attach` (`:185`) and `-regen-submit` (`:201`). The Cancel button at `:190-197` has **no testid**.

`onRegenerate` (`documents-studio.tsx:82-114`) posts the **whole current draft** plus `sectionIndex`, the studio `prompt`, the panel `instruction`, the panel model (falling back to the studio model), uploaded `attachments`, and `sourceText` (`:93-101`). The response replaces the entire draft.

`regenerateDocumentSection` (`document-generate.ts:192-239`) re-validates that draft with `parseDocumentDraftBody` (400 on a bad shape, `document-outline.ts:70-80`), range-checks `sectionIndex` (400, `:181-190`), re-runs the same runtime gate and model resolution, and builds a prompt that carries the original topic, the document title, the **other** section headings as context, and the current heading + body to rewrite (`:208-222`). `SECTION_SYSTEM` (`:173-179`) asks for `{heading, body}` only. `mergeDocumentSection` (`document-outline.ts:62-68`) returns a new draft with that one index replaced — immutably, via `map`.

**It does not persist.** Unlike `generateDocumentDraft`, this function returns the merged draft and never calls `persistDraft` or `upsertWorkSource`, so the saved artifact and the knowledge work card keep the pre-rewrite text forever. See Gotchas.

### 6. Download — `POST /api/v1/documents/docx`

`onDownload` (`documents-studio.tsx:116-147`) posts the draft as the bare body, reads the response as a `Blob`, pulls the filename out of `Content-Disposition` (`:133-135`), and clicks a synthetic `<a download>` (`:136-141`).

`handlePostDocumentsDocx` (`packages/host/src/handlers/jobs.ts:132-146`) is the odd one out: **no `getTenant`, no `requireGatewayAllowed`**. It parses the body with `parseDocumentDraftBody` (400 on a bad shape) and returns a `type: "bytes"` result with the OOXML content type and a filename.

`buildDocumentDocx` (`packages/host/src/document-docx.ts:31-58`) uses the `docx` npm package directly: a `HeadingLevel.TITLE` run in Calibri 24pt `#0D2137`, then per section a `HEADING_1` run in 14pt `#1565C0` and the body split on blank lines into spaced paragraphs (`:14-29`). `safeFilename` (`:5-12`) strips non-word characters, collapses whitespace to `-`, truncates at 60 chars, and falls back to `document.docx`. The document `creator` is `resolvedProductName()`, so packaged brands stamp their own name.

This is **not** `packages/core/src/docx/*` — that toolkit reads, diffs and validates `.docx` for Edit and Legal. The Documents job has its own small writer in the host.

### 7. Enhance

`EnhancePromptButton` (`apps/web/components/enhance-prompt-button.tsx`) posts `{ text, surface: "documents", model }` to `/api/v1/prompts/enhance` (`:69-72`) and applies the result to `prompt`. It is the **only Documents control that works without a gateway key** — it answered 200 in stub on this drive. Its testid flips: `documents-enhance` before, `documents-enhance-revert` after (`:106`).

### Failure modes

| Failure | Where | What the client gets |
|---|---|---|
| Gate closed | `requireGatewayAllowed`, `packages/host/src/handlers/jobs.ts:112`, `:123` | HTTP 403 `gateway_blocked` on generate and regenerate. **`/documents/docx` has no gate and still returns bytes** |
| No gateway key (stub) | `requireLiveDocumentRuntime`, `packages/host/src/document-generate.ts:112-122` | HTTP **503** `runtime_stub`, message naming Settings; rendered in `documents-error` |
| Blank / missing `prompt` | `readPrompt`, `:65-74` | HTTP 400 `invalid_request`. In practice unreachable from the UI — `documents-generate` is disabled on a blank prompt (`documents-studio.tsx:270`) |
| `sourceText` not a string | `readSourceText`, `packages/host/src/job-source.ts:46-48` | HTTP 400 `invalid_request` |
| `sourceText` trips the injection guard | `assertSafeSourceText`, `job-source.ts:23-35` | HTTP 400 `injection_blocked`, naming the rule and the Settings bypass |
| `sourceText` over 120k | `capSourceText`, `job-source.ts:15-20` | No error — silently truncated with `[source material truncated at cap]` |
| Model returns nothing | `document-generate.ts:158-160`, `:235-237` | HTTP 502 `generation_failed` |
| Model returns non-JSON or a bad shape | `parseDocumentDraft` / `parseDocumentSection`, `document-outline.ts:18-38`, `:40-60` | HTTP **502** `invalid_document` (model's fault, not the caller's) |
| `sectionIndex` out of range | `readSectionIndex`, `document-generate.ts:181-190`; also `mergeDocumentSection`, `document-outline.ts:62-65` | HTTP 400 `invalid_request` |
| Draft posted to `/docx` fails the schema | `parseDocumentDraftBody`, `document-outline.ts:70-80` | HTTP 400 `invalid_request` |
| Artifact store rejects the draft | `persistDraft`, `document-generate.ts:134-150` | Nothing — caught, logged as a `console.warn`, the job still succeeds and the work card is skipped |
| Any generate failure | `documents-studio.tsx:74-77` | `draft` is set to `null`, so the preview on screen is destroyed too |

## Where things live

| File | Role |
|---|---|
| `apps/web/components/documents-studio.tsx` | The whole mode: state, three fetches, error row, starters, generate bar |
| `apps/web/components/document-preview.tsx` | `documents-preview` / `-section` / `-regen`; mounts the shared regen panel |
| `apps/web/components/job-regen-panel.tsx` | Shared section-rewrite composer; all `*-regen-*` testids derive from `testIdPrefix` |
| `apps/web/components/source-material-field.tsx` | The `sourceText` box and its 120k counter |
| `apps/web/components/artifact-picker.tsx` | "Use a saved artifact…" dropdown; `<testId>-toggle` / `-panel` / `-item` |
| `apps/web/lib/mode-handoff.ts` | Renderer-only Research → Documents bus (module `pending` + CustomEvent) |
| `apps/web/components/artifact-actions.tsx` | The "Make a document" button that fires the handoff |
| `apps/web/components/work-mode-keep-alive.tsx` | Why `/documents` has a `null` route and why hidden panes stay in the DOM |
| `apps/web/lib/job-starters.ts` | `documentStarters()` — the two keyless drafts |
| `apps/web/lib/document-outline.ts` | Renderer-side mirror of the draft schema (types only) |
| `apps/web/lib/use-job-model.ts` | Job-mode → `documentGenModel` settings field |
| `packages/core/src/templates/library.ts` | The 6 Documents example cards |
| `packages/core/src/models/mode-defaults.ts` | The `hy3 → deepseek-v4-flash` default ladder shared with Finance |
| `packages/host/src/router.ts:206-208` | The three route registrations |
| `packages/host/src/handlers/jobs.ts:110-146` | The three handlers; the docx one has no gate |
| `packages/host/src/document-generate.ts` | System prompts, runtime gate, model resolution, generate + regenerate, artifact persist |
| `packages/host/src/document-outline.ts` | zod schema, JSON parsing, immutable section merge |
| `packages/host/src/document-docx.ts` | `buildDocumentDocx` — the only DOCX writer this mode uses |
| `packages/host/src/job-source.ts` | `sourceText` read, cap, injection guard, prompt/system composition |
| `packages/host/src/job-regen.ts` | `collectJobAssistantText` and the regen instruction/attachment readers |
| `packages/host/src/work-cards.ts` | `artifactWorkCard` / `documentDraftMarkdown` for the knowledge ingest card |

## Gotchas

- **Regenerate never updates the saved artifact.** `generateDocumentDraft` persists a `documents/draft` artifact and a knowledge work card (`packages/host/src/document-generate.ts:163-169`), but `regenerateDocumentSection` ends at `return mergeDocumentSection(...)` (`:238`) with no persist call. Rewrite a section and the artifact the picker offers — and the text the Knowledge Base indexed — are the *pre-rewrite* version, silently. The DOCX the user downloads is built from the in-memory draft, so it will not match either. **Finding, not design.**
- **`/api/v1/documents/docx` is the only Documents route with neither a tenant nor a gate** (`packages/host/src/handlers/jobs.ts:132-146`). That is what makes the starter → download path work in stub, which is exactly what `features/documents.md` asks you to prove — but it also means a desk whose gateway gate is closed can still produce `.docx` files, unlike every other job-mode download.
- **A failed generate destroys the preview.** `onGenerate`'s catch does `setDraft(null)` before setting the error (`apps/web/components/documents-studio.tsx:74-77`). A user who loaded a starter, then typed a topic and pressed Generate without a key, loses the starter draft and gets an error. `onRegenerate`'s catch does *not* clear the draft (`:108-110`) — the two paths disagree.
- **`needsSettingsHint` is a no-op.** `documents-studio.tsx:29-31` tests a regex and returns `message` on both branches. The live behaviour comes from the separate condition at `:178`, which appends a Settings `<Link>` only when the message mentions a gateway **and does not already mention "settings"**. The `runtime_stub` copy always says "Settings", so on this desk that link never renders. Dead branch plus an unclickable hint.
- **`documents-prompt` is an `<input type="text">`** (`:257-266`), yet template cards prefill it with a 1 300-char multi-paragraph brief. The DOM strips newlines from an input's value, so the brief arrives as one run-on line ("…bukan kerangka.Peran: kepala staf…"). The same applies to `research-prompt`, `presentations-prompt`, `images-studio-prompt` and `videos-studio-prompt` — all five are `<input>`.
- **Hidden keep-alive panes keep their testids.** `work-mode-keep-alive.tsx:65-68` hides inactive panes with `hidden` + `className="hidden"`, so `documents-studio` still has count 1 while you are on `/chat`. Any "mode X is not visible" assertion must check visibility, not count.
- **The artifact picker is not scoped to Documents.** `SourceMaterialField` mounts `ArtifactPicker` with no `mode` prop (`source-material-field.tsx:46-55`), so `listArtifacts()` returns every mode's artifacts. Intentional — a Research dossier is the main thing you want here — but it means the picker's contents depend on unrelated modes' history.
- **The handoff is consumed once and does not survive a reload.** `takePendingHandoff` deletes the entry (`mode-handoff.ts:54-61`) and the whole bus is a module-level variable (`:42`). If the user reloads between "Make a document" and the pane mounting, the source material is gone. This is stated as a deliberate tradeoff in the file header (`:1-5`): panes stay mounted, so no router state or storage was needed.
- **The 120k cap silently truncates.** `capSourceText` appends `[source material truncated at cap]` and returns (`job-source.ts:15-20`); no error, no header, no UI signal beyond the field's red counter.
- **Schema failures are 502s, not 400s.** `parseDocumentDraft` and `parseDocumentSection` throw `invalid_document` at 502 (`document-outline.ts:20,27,34`), while `parseDocumentDraftBody` — the one that reads a *caller-supplied* draft — throws `invalid_request` at 400 (`:73`). Same zod schema, different blame.
- **Documents and Finance share `documentGenModel`.** `apps/web/lib/use-job-model.ts:19-25` maps `documents`, `finance`, `market` and `legal` all onto `documentGenModel`. Changing the model in the Documents bar changes Finance's default too.
- **The Documents model bucket is the chat bucket.** `packages/host/src/selectable-models.ts:145` sets `documents: curated.chat`, so all 110 curated chat models appear in `documents-studio-model`. There is no Documents-specific catalog.

## Verify

`.cursor/skills/verify-agentforge/features/documents.md` — sub-features `documents-rail`, `documents-shell`, `documents-starter`, `documents-studio-model`, `documents-enhance`, `documents-regen`, `documents-download`. The Documents slice of `.cursor/skills/verify-agentforge/features/templates.md` covers `example-gallery` / `example-card` / `example-result` / `example-prefills-prompt`.

DOM testids that prove it:

| testid | Source |
|---|---|
| `mode-documents` | `apps/web/components/app-rail.tsx:300` (built as `mode-${href.slice(1)}`) |
| `documents-studio`, `documents-download`, `documents-error`, `documents-studio-empty`, `documents-starter`, `documents-studio-prompt-bar`, `documents-prompt`, `documents-generate` | `apps/web/components/documents-studio.tsx:150`, `:164`, `:175`, `:203`, `:216`, `:230`, `:264`, `:271` |
| `documents-studio-model` | `documents-studio.tsx:245` via `apps/web/components/model-select.tsx:64` |
| `documents-enhance` / `documents-enhance-revert` | `documents-studio.tsx:254` via `apps/web/components/enhance-prompt-button.tsx:106` |
| `documents-preview`, `documents-section`, `documents-regen` | `apps/web/components/document-preview.tsx:28`, `:33`, `:43` |
| `documents-regen-panel`, `-regen-prompt`, `-regen-model`, `-regen-file`, `-regen-attach`, `-regen-submit` | `apps/web/components/job-regen-panel.tsx:120`, `:137`, `:145`, `:155`, `:185`, `:201` |
| `documents-source`, `-source-toggle`, `-source-title`, `-source-clear`, `-source-text` | `apps/web/components/source-material-field.tsx:28`, `:36`, `:41`, `:65`, `:84` |
| `documents-source-picker`, `-source-picker-toggle`, `-source-picker-panel`, `-source-picker-item` | `source-material-field.tsx:48` via `apps/web/components/artifact-picker.tsx:85`, `:92`, `:99`, `:116` |
| `example-gallery`, `example-card`, `example-result` | `apps/web/components/example-gallery.tsx:19`, `:29`, `:49` |
| `research-actions-make-document` | `apps/web/components/artifact-actions.tsx:95` (prefix-derived) — the handoff entry point |

Keyless proof stops at: starters (2), 5 and 6 sections, regen panel, regen **503**, DOCX **200** (real ZIP), generate **503**, enhance **200**. A live draft needs doctor `runtime: "ai"`; a handoff drive additionally needs a saved Research artifact.

## Why

**Why `/documents` renders through a `null` route.** `[Direct]` the comment at `apps/web/src/App.tsx:148` — "Work modes render via WorkModeKeepAlive — null here avoids double-mount." `[Direct]` the header comment on `apps/web/components/work-mode-keep-alive.tsx:32-40` gives the motive: keep visited panes mounted "so in-flight UI/SSE state survives rail switches", and it goes on to record that the active pane must be `overflow-y-auto` rather than `overflow-hidden` because Documents (among others) "grow past the pane and have no inner scroller". **Confidence: high.**

**Why the handoff is a module variable and a window event rather than router state or storage.** `[Direct]` the file header at `apps/web/lib/mode-handoff.ts:1-5`: "Modes stay mounted (WorkModeKeepAlive), so a module-level pending payload plus a window event is enough: no router state, no storage." The cost — a reload loses the payload — is the direct consequence, and is `[Inferred]` from the mechanism rather than recorded anywhere. **Confidence: high for the decision, medium for it having been weighed.**

**Why source material carries an injection guard at all.** `[Direct]` the comment at `packages/host/src/job-source.ts:22`: "Same guard chat applies to attachments; source material goes straight into the prompt so it must pass too." `[Supported]` the bypass is the same desk-level `injectionGuardBypass` switch the chat attachment path reads, threaded in at `packages/host/src/document-generate.ts:155` and `:207`. **Confidence: high.**

**Why Documents and Finance resolve to the same model.** `[Direct]` `packages/core/src/models/mode-defaults.ts:40` and `:50` declare near-identical preference ladders that both end at `deepseek-v4-flash`. `[Supported]` `docs/product-modes.md` describes the Documents default as "a cheap writing default (`hy3` when live, else `deepseek-v4-flash`)". `[Supported]` `features/documents.md` already records the operational consequence — the quiet drafting phase and the 240 s / 180 s watchdog floors — and [`chat-send.md`](chat-send.md#why) records why `QUIET_REASONING_FAMILY` had to be widened for exactly this model. **Confidence: high.**
