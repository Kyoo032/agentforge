# Map — Research dossier

Last verified: 2026-09-20 at 69afca9

## Overview

One Research turn: a question in the studio prompt bar, and a cited dossier on screen that can be downloaded, pushed into the Knowledge Base, or handed to Documents or Presentation. Between those two points the host runs a five-phase pipeline — plan sub-queries, web-search each one, fetch the pages behind the hits, extract verbatim passages, synthesize findings — and streams its progress as `job.*` server-sent events.

Two things to hold onto. **Research is the only mode that needs two secrets**: a gateway key for the model *and* a Tavily or Brave key for search; either one missing is the same 503 (`packages/host/src/research-generate.ts:76-87`). And **the streaming route never returns a non-2xx**: `POST /api/v1/research/stream` answers HTTP 200 and puts the failure in a `job.error` frame, so the studio's error banner is an SSE payload, not an HTTP status. It is not a citation manager and not a live-search chat: the caps in `RESEARCH_CAPS` are fixed and "fully detailed" never means unbounded.

## How it works

### 1. Studio → request

`ResearchStudio` (`apps/web/components/research-studio.tsx:42`) is mounted permanently by `WorkModeKeepAlive` (`apps/web/components/work-mode-keep-alive.tsx:19`); the `/research` route element in `apps/web/src/App.tsx:154` is `null` so the studio is not double-mounted.

`onGenerate` (`:51-68`) trims the prompt, refuses when it is empty or a job is already running, and calls `job.run("/api/v1/research/stream", { prompt, model })` (`:57`). `model` comes from `useJobModel("research")` (`:44`), which seeds the `research-studio-model` select from `GET /api/v1/models` `modes.research` + `defaults.research`, overridden by `settings.researchGenModel` (`apps/web/lib/use-job-model.ts:63-104`, `:18-26`). On success the result is split (`:59-65`): the notes go to the Notes tab, `dossier.markdown` to the Dossier tab, and `dossierId ?? artifactId` becomes the artifact the action bar acts on.

`useJobStream` (`apps/web/lib/use-job-stream.ts:23-77`) owns one `AbortController` at a time. `research-cancel` calls `job.cancel()` (`research-studio.tsx:213`), which aborts the fetch; the catch arm sees `abort.signal.aborted` and **resets quietly instead of setting an error** (`use-job-stream.ts:54-59`) — a cancelled run shows nothing, not a banner.

### 2. Transport — the same SSE reader as Chat, a different event union

`runJobStream` (`apps/web/lib/job-stream.ts:48-93`) POSTs through `apiFetch` (so webdev `fetch` and packaged IPC both work), then rejects early if the response is not OK **or** its `Content-Type` is `application/json` (`:61-63`) — that is the branch the non-stream JSON errors take. Otherwise it reads the body, feeds `consumeSse`, and keeps only frames that pass `isJobEvent` (`:6-9`, `packages/core/src/jobs/job-events.ts:75-81`). `settleJobEvents` (`:34-46`) turns a `job.error` into a thrown `JobStreamError` and a `job.done` into the result. If the stream ends with neither, it throws `stream_ended` / 502 (`:90-92`).

`reduceJobProgress` (`packages/core/src/jobs/job-events.ts:133-155`) folds the frames into the `JobProgress` the phase list renders. `JobProgressList` (`apps/web/components/job-progress.tsx:23-71`) draws one `<li data-testid="research-progress-phase">` per phase plus a `research-progress-sources` list of every `job.source`.

### 3. Host — gate, then stream

`packages/host/src/router.ts:227-228` maps both routes:

| Route | Handler | On refusal |
|---|---|---|
| `POST /api/v1/research` | `handlePostResearch` (`packages/host/src/handlers/jobs.ts:187-196`) | real HTTP status (503 stub, 403 gate) with `{error:{code,message}}` |
| `POST /api/v1/research/stream` | `handlePostResearchStream` (`packages/host/src/handlers/jobs.ts:199-209`) | **HTTP 200** + one `event: job.error` frame |

Both call `requireGatewayAllowed(loadSettings(tenant.workspaceId))` **synchronously, before** the job starts (`:191`, `:203`), so a closed gate is the one failure that is a real `403 gateway_blocked` on the stream route too. See [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md).

Everything after that runs inside `streamJob` (`packages/host/src/job-stream.ts:30-86`). It returns `{ type: "stream", status: 200 }` immediately and starts `run()` in the background; the promise's rejection becomes `push(jobErrorFromUnknown(error))` (`:57-60`), which maps an `ApiError` to `{type:"job.error", code, message, status}` with the message run through `redactSecrets` (`:8-14`). `emit` drops any `job.done` / `job.error` a job tries to send itself (`:50-55`), and `push` drops everything after the first terminal frame (`:38-48`). The generator also stops as soon as the client aborts (`:65`).

### 4. The refusal that stub desks actually see

`generateResearchNotes` (`packages/host/src/research-generate.ts:113-171`) starts with `requireLiveResearch` (`:76-87`):

1. `resolveRuntimeMode({ settingsHasKey: hasLiveProvider(settings), envRuntime: AGENTFORGE_RUNTIME })` — `stub` throws `ApiError("runtime_stub", gatewayRequiredMessage("research", locale), 503)`.
2. `listToolRoutes(settings).web?.ready` (`packages/core/src/tools/credentials.ts:318-328`) — no Tavily/Brave route throws `ApiError("tool_failed", searchKeyRequiredMessage(locale), 503)`.

Both messages come from `packages/core/src/output-language.ts:102-105` and `:124-127`, **not** from `apps/web/locales/*/research.json` (see Gotchas). Nothing is written before this point: no artifact, no work card, no search call.

### 5. The pipeline — plan → search → read → extract → synthesize

`runResearchDossier` (`packages/host/src/research-dossier.ts:309-379`) is pure over its `deps`; it never touches settings or the DB. Caps are `RESEARCH_CAPS` (`:24-31`): 5 queries, 5 hits each, 10 pages, 8 000 chars per page, 3 concurrent reads, 5 passages per source. `throwIfJobAborted` (`packages/host/src/job-stream.ts:19-23`) runs between every phase and inside the read loop, so Cancel stops the spend early.

1. **Planning** — `emit({type:"job.phase", phase:"planning"})` (`:316`), one `ask(PLAN_SYSTEM, …)` for `{"queries": string[]}` (`:51-52`, `:319`). A throw is swallowed to `""` (`:320-322`). `parsePlan` (`:103-112`) always puts **the question itself first**, so a dead planner still searches.
2. **Searching** — one `job.step` per query with `current`/`total` (`:330`), then `deps.search(query)` sliced to `hitsPerQuery` (`:331`). `dedupeCandidates` (`:128-154`) round-robins across queries so each contributes, drops anything that is not `https://`, dedupes on `normalizeUrlKey` (`:114-123`, hash stripped, trailing slashes trimmed), and numbers the survivors `S1…Sn`. Zero candidates is a hard `tool_failed` / 502 (`:334-336`). Every candidate is announced as `job.source` with status `found` (`:337-339`).
3. **Reading** — `mapWithConcurrency(candidates, 3, …)` (`:245-261`, `:345`). Per source (`readSource`, `:263-306`): `deps.readPage(url)` → `fetchPageText` over `fetchPublicHttps` (`packages/core/src/tools/platform/web-fetch.ts:26-51`: HTTPS-only, 1.5 MB, 10 s, readable content types only), then the injection guard `scanInjection` unless `settings.injectionGuardBypass` (`research-generate.ts:148-155`), then one `ask(EXTRACT_SYSTEM, …)`. **A page that cannot be read is not dropped** — the candidate is kept with `status: "unreachable"` and the search snippet as its only passage (`:299-304`), and a matching `job.source` frame is emitted (`:298`).
4. **Extracting** — `parseExtraction` (`:169-177`) keeps only passages that are at least 20 chars **and actually occur in the page**, comparing through `squash` (`:157-166`: whitespace, case, curly quotes, en/em dashes and ellipsis normalised). A paraphrase silently disappears; this is the anti-fabrication floor.
5. **Drafting** — one `ask(SYNTHESIS_SYSTEM, …)` over `sourcePromptBlock`s (`:235-243`, `:361-365`). `parseSynthesis` (`:187-216`) unions the ids the model listed with the ids it actually cited in the body (`citedSourceIds`, `packages/core/src/artifacts/dossier.ts:128-134`) and **intersects with the known ids**, so a hallucinated `[S99]` is dropped rather than rendered. Zero usable findings is `invalid_research` / 502 (`:204-206`).
6. `dossierSchema.parse` (`:367-377`) is the last gate, and `notesFromDossier` (`:219-233`) derives the preview shape deterministically — each note's sources are looked up by id, so **every citation in the Notes tab resolves to a real source row**.

All three model calls go through `collectJobAssistantText` (`packages/host/src/job-regen.ts:192-194`) with `jobMode: "research"` and `withOutputLanguage(system, "research", localeForRun())`, and all three are parsed with `extractJsonObject` + `JSON.parse`; a non-JSON answer is `invalid_research` / 502 (`research-dossier.ts:77-83`).

### 6. Saving, and the two things that happen after

Back in `generateResearchNotes`: `throwIfJobAborted` again (`:160`) — **a cancelled run is never saved** — then `job.phase "saving"` (`:161`), `dossierToMarkdown` (`packages/core/src/artifacts/dossier.ts:97-125`: YAML frontmatter, then the fixed `## Question / ## Queries run / ## Sources / ## Findings / ## Contradictions / ## Open questions` skeleton), then `persistDossier` (`:89-111`) into the shared `artifacts` table as `mode: "research", kind: "dossier"`. **Persistence can never fail the job** — the catch logs the error code only and returns `null`, and the notes are still returned (`:105-110`). When it succeeded, `upsertWorkSource(artifactWorkCard({type:"Research", …}))` files a Knowledge work card pointing at `artifact:<id>` (`:164-169`, `packages/host/src/work-cards.ts:129-139`).

### 7. Dossier → screen, and the four handoffs

`job.done` resolves `job.run`, and `setShown({kind:"run", …})` renders (`research-studio.tsx:60-66`):

- `research-tabs` with `research-tab-notes` / `research-tab-dossier` (`:132-153`) — only for a fresh run, never for a reopened artifact (`:131`).
- Notes tab → `ResearchPreview` (`apps/web/components/research-preview.tsx:9-45`): `research-preview` wrapper, one `research-note` `<section>` per finding (`:20`), bodies through `FormattedText`, source links through `safeLinkHref` (`:26`).
- Dossier tab → `research-dossier-preview` (`:158-163`), the raw Markdown through the same `FormattedText`.
- `ArtifactActions` (`apps/web/components/artifact-actions.tsx:20-115`) above both: `research-download` (`GET /api/v1/artifacts/:id/file`, or a client-side blob when there is no id — `:25-39`), `research-send-kb` (`POST /api/v1/knowledge/sources` with `type: "Dossier"` — `:41-56`), and `research-make-document` / `research-make-presentation`, which call `requestModeHandoff` (`apps/web/lib/mode-handoff.ts:45-51`) and `router.push("/documents")` / `"/presentations"`. The handoff is **renderer-only**: a module-level pending payload plus an `agentforge-mode-handoff` window event, picked up on the other side by `subscribeModeHandoff` (`:68-87`). It works precisely because `WorkModeKeepAlive` keeps every mode mounted — there is no router state and no storage.

`ArtifactPicker` (`apps/web/components/artifact-picker.tsx:35-129`, mounted as `research-saved` at `research-studio.tsx:82-91`) is the way back in: it lists `GET /api/v1/artifacts?mode=research` on open and sets `{kind:"saved"}`, which shows Markdown only and lands on the Dossier tab.

### Failure modes

| Failure | Where | What the client gets |
|---|---|---|
| Gate closed | `requireGatewayAllowed`, `packages/host/src/handlers/jobs.ts:203` | real **HTTP 403** `gateway_blocked` on both routes (thrown before `streamJob`) |
| Stub runtime (no gateway key) | `requireLiveResearch`, `packages/host/src/research-generate.ts:81-83` | stream: **HTTP 200** + `job.error {code:"runtime_stub", status:503}`. Non-stream: HTTP 503 |
| No Tavily / Brave route | `requireLiveResearch`, `:84-86` | same shape, `code:"tool_failed"` |
| Missing / empty `prompt` | `readPrompt`, `:42-51` | `job.error {code:"invalid_request", status:400}` (HTTP 200 on the stream route) |
| Search backend returned `success:false` | `hitsFromSearch`, `:61-74` | `job.error {code:"tool_failed", status:503}` |
| No HTTPS candidates at all | `packages/host/src/research-dossier.ts:334-336` | `job.error {code:"tool_failed", status:502}` |
| One page unreadable / blocked by the injection guard | `readSource` catch, `:293-305` | **not a failure** — `job.source` status `unreachable`, snippet kept as the passage |
| Model returned non-JSON | `parseJson`, `:77-83` | `job.error {code:"invalid_research", status:502}` |
| Model returned no usable findings | `parseSynthesis`, `:204-206` | `job.error {code:"invalid_research", status:502}` |
| Model call itself failed | `collectJobAssistantText`, `packages/host/src/job-regen.ts:142-144` | `job.error {code:"generation_failed", status:502}` |
| User pressed `research-cancel` | `throwIfJobAborted` → `ApiError("aborted", …, 499)`; client sees the abort first | **no banner** — `use-job-stream.ts:54-59` resets quietly |
| Client tab closed mid-run | `res.on("close")` → `abort.abort()` (`packages/host/src/http-adapter.ts:447-454`, `:471`) | run stops between phases; nothing saved |
| Artifact could not be persisted | `persistDossier` catch, `packages/host/src/research-generate.ts:105-110` | **success** — notes render, `artifactId` is `null`, Download falls back to a client-side blob, no KB work card |
| Stream ended with no `job.done` | `runJobStream`, `apps/web/lib/job-stream.ts:90-92` | `research-error` with `stream_ended` / 502 |

## Where things live

| File | Role |
|---|---|
| `apps/web/components/research-studio.tsx` | The whole studio: prompt bar, tabs, error banner, empty shell, saved picker |
| `apps/web/components/research-preview.tsx` | Notes tab — `research-preview` + one `research-note` per finding |
| `apps/web/components/artifact-actions.tsx` | Download / Send to KB / Make a document / Make a presentation |
| `apps/web/components/artifact-picker.tsx` | "Reopen saved research…" (`research-saved`) |
| `apps/web/components/job-progress.tsx` | `research-progress` phase list and source list |
| `apps/web/lib/use-job-stream.ts` | One abortable job at a time; quiet reset on cancel |
| `apps/web/lib/job-stream.ts` | `runJobStream` / `settleJobEvents` — SSE → result or `JobStreamError` |
| `apps/web/lib/use-job-model.ts` | Seeds `research-studio-model` from catalog + `settings.researchGenModel` |
| `apps/web/lib/mode-handoff.ts` | Renderer-only handoff to Documents / Presentation |
| `packages/host/src/handlers/jobs.ts` | `handlePostResearch` / `handlePostResearchStream`, gate check |
| `packages/host/src/job-stream.ts` | `streamJob`, `throwIfJobAborted`, `jobErrorFromUnknown` |
| `packages/host/src/research-generate.ts` | Settings, secrets, model resolution, persistence, KB work card |
| `packages/host/src/research-dossier.ts` | The pipeline and its three prompts; caps; all the parsers |
| `packages/host/src/job-regen.ts` | `collectJobAssistantText` — the one model call the pipeline uses |
| `packages/core/src/artifacts/dossier.ts` | `Dossier` schema, `dossierToMarkdown`, `citedSourceIds` |
| `packages/core/src/artifacts/research-notes.ts` | `ResearchNotes` schema + `researchNotesToMarkdown` fallback |
| `packages/core/src/jobs/job-events.ts` | The `job.*` union and `reduceJobProgress` |
| `packages/core/src/tools/platform/web-fetch.ts` | `fetchPageText` — the HTTPS page reader |
| `packages/core/src/tools/credentials.ts` | `listToolRoutes` — whether a search backend is ready |
| `packages/core/src/output-language.ts` | The two refusal messages Research actually shows |

## Gotchas

- **The streaming route never returns 503.** `POST /api/v1/research/stream` answers `HTTP 200 text/event-stream` and puts the 503 inside `job.error` (`packages/host/src/job-stream.ts:57-60`, proved by curl on 2026-09-17). Only `POST /api/v1/research` gives a real HTTP 503 (`packages/host/src/handlers/jobs.ts:187-196`). The studio only ever uses the stream route (`apps/web/components/research-studio.tsx:57`), so "Research 503s without a key" is true of the payload, not of the response.
- **The gate is the one exception.** `requireGatewayAllowed` runs before `streamJob`, so a closed gate *is* a real HTTP 403 on the stream route (`packages/host/src/handlers/jobs.ts:203`) and `runJobStream` takes its JSON branch (`apps/web/lib/job-stream.ts:61-63`) instead of parsing SSE.
- **The "Open Settings" link is dead code.** `needsSettingsHint` matches `/gateway|api key|settings|runtime_stub|live gateway|tavily|brave/i`, but the render is guarded by `needsSettingsHint(error) && !/settings/i.test(error)` (`apps/web/components/research-studio.tsx:32-34`, `:101`). Both stock refusals already contain the word "Settings" (`packages/core/src/output-language.ts:103`, `:125`), so the second clause is always false and the `<Link>` never appears — the drive measured `<a>` count 0. `research.openSettings` is loaded but unreachable for the only two errors that trigger the hint.
- **`research-studio-model` is empty and `disabled` for about a second after the studio paints.** `useJobModel` awaits `/api/v1/models` and `/api/v1/settings` in parallel (`apps/web/lib/use-job-model.ts:74-100`) and `ModelSelect` disables itself while `models.length === 0` (`apps/web/components/model-select.tsx:63`). A drive that counts options on the first frame reads 0; wait for a non-empty `inputValue` instead (measured 2026-09-17: 0 options at t+0, 101 options in 11 optgroups at t+1s).
- **Most of `locales/*/research.json` is unreferenced.** 34 of its 65 keys have no reader anywhere in `apps/` or `packages/` — `phasePlanning`…`phaseSaving`, `headingQuestion`…`headingOpenQuestions`, `errorGateway` / `errorSearch` / `errorNoHttps`, `previewKicker`, `notesSources`, `fallbackTitle`, `fallbackSummary`, `unreadPage`, `noneRecorded`, `untitled`, `urlNone`, `keyPassages`, `notesLabel`, `urlLabel`, `retrievedLabel`, `foundByLabel`, `statusLabel`, and all seven `stub*` keys. The strings that actually ship are hardcoded English in `packages/host/src/research-dossier.ts:316`, `:326`, `:342`, `:360` (phase labels), `packages/host/src/research-generate.ts:161`, `packages/core/src/artifacts/dossier.ts:41-48` and `:69-95` (the Markdown skeleton), and `apps/web/components/research-preview.tsx:15` (the `Research` kicker). Consequence on an `id` desk: the phase list and the whole dossier Markdown are English while the chrome is Indonesian. The skeleton headings are deliberate (`packages/core/src/artifacts/dossier.ts:40`: "Other modes navigate the Markdown by these"); the phase labels and the kicker are not.
- **`stub*` keys promise a stub dossier that does not exist.** `research.stubTitle` / `stubFindingBody` / `stubSourceTitle` describe an offline demo dossier, but `requireLiveResearch` refuses at 503 before anything is generated (`packages/host/src/research-generate.ts:81-83`). Unlike Documents, Research has **no** offline path.
- **`apps/web/lib/research-locales.test.ts` cannot catch any of that** — it only asserts that the `en` and `id` key trees match and that brand names survive, so a key with no reader passes forever.
- **A cancelled run shows nothing at all.** `use-job-stream.ts:54-59` resets instead of setting an error, so pressing `research-cancel` leaves the studio back on `research-studio-empty` with no message. That is deliberate ("the user asked for it to stop"), but it reads as a no-op.
- **The question is always query #1.** `parsePlan` prepends it before the planner's output and dedupes (`packages/host/src/research-dossier.ts:103-112`), so a planner that returns garbage still produces one real search.
- **An unreachable page still becomes a numbered source.** `readSource`'s catch keeps the candidate with `status: "unreachable"` and the search snippet as its passage (`:299-304`), so `## Sources` can contain entries the pipeline never actually read. The snippet is labelled in `notes`, not in the passage itself.
- **Paraphrases are dropped silently.** `parseExtraction` (`:169-177`) requires each passage to occur verbatim in the page after `squash` normalisation. A source whose every passage was paraphrased ends up with `passages: []` and no visible explanation.
- **Hallucinated citations are dropped, not flagged.** `parseSynthesis` intersects the model's cited ids with the known source ids (`:198-201`), so `[S99]` disappears from `sources` — but the literal `[S99]` text stays inside the finding body, which still renders.
- **A failed save is a silent success.** `persistDossier` swallows every error (`packages/host/src/research-generate.ts:105-110`). The user gets a dossier they can read and download (as a client-side blob), but `research-send-kb` has no `artifactId`, no Knowledge work card was filed, and `research-saved` will not list it later.
- **Research needs two keys.** A gateway key alone is not enough; `listToolRoutes(settings).web?.ready` must also be true (`packages/host/src/research-generate.ts:84-86`). Doctor's `runtime: "ai"` says nothing about the search backend.
- **Notes tab vs Dossier tab are different documents.** The Notes tab renders `notesFromDossier` output (findings only); the Dossier tab renders the full `dossierToMarkdown` with frontmatter, queries and source blocks. Reopening a saved artifact shows **only** the Dossier tab — `research-tabs` is not rendered for `{kind:"saved"}` (`apps/web/components/research-studio.tsx:131`).

## Verify

`.cursor/skills/verify-agentforge/features/research.md` — sub-features `research-rail`, `research-shell`, `research-studio-model`, `research-preview` / `research-note`.

DOM testids that prove it: `mode-research` (rail, `mode-${href.slice(1)}`); `research-studio` (`apps/web/components/research-studio.tsx:74`), `research-studio-empty` (`:169`), `research-studio-prompt-bar` (`:180`), `research-studio-model` (`:187`), `research-enhance` (`:196`), `research-prompt` (`:206`), `research-generate` (`:223`), `research-cancel` (`:214`), `research-error` (`:98`), `research-tabs` / `research-tab-notes` / `research-tab-dossier` (`:132`, `:139`, `:149`), `research-dossier-preview` (`:160`); `research-preview` / `research-note` (`apps/web/components/research-preview.tsx:13`, `:20`); `research-saved` / `research-saved-toggle` / `research-saved-panel` / `research-saved-item` (`apps/web/components/artifact-picker.tsx:85`, `:92`, `:99`, `:116`); `research-actions` / `research-download` / `research-send-kb` / `research-make-document` / `research-make-presentation` / `research-actions-note` (`apps/web/components/artifact-actions.tsx:71`, `:77`, `:86`, `:95`, `:104`, `:109`); `research-progress` / `research-progress-phase` / `research-progress-sources` (`apps/web/components/job-progress.tsx:30`, `:44`, `:60`); `example-gallery` / `example-card` / `example-result` (`apps/web/components/example-gallery.tsx:19`, `:29`, `:49`).

Unit coverage: `packages/host/src/research-dossier.test.ts` (plan fallback, round-robin dedupe + HTTPS filter + caps, verbatim-only passages, id resolution, cancel between phases). Cloud `apps/web/tests/e2e/foundation.spec.ts:26`, `:133` only asserts the rail tab is visible — there is no end-to-end Research generate anywhere.

Stub-desk ceiling: everything from `research-preview` onward (tabs, dossier, download, KB, handoffs, `research-progress`, `research-cancel`) needs a gateway key **and** a Tavily/Brave key, or a previously saved `mode=research` artifact to reopen through `research-saved`.

## Why

**Why the caps are hardcoded rather than configurable.** `[Direct]` `docs/internal/research-dossier-analyst-modes-plan.md`, design principle 5: "Caps everywhere. Queries, pages, bytes per page, total dossier size, rows, query time. 'Fully detailed' must not mean unbounded." The code comment repeats it (`packages/host/src/research-dossier.ts:14`). **Confidence: high.**

**Why passages must be verbatim.** `[Direct]` the same plan's principle 1, "Code computes, model narrates", and the `EXTRACT_SYSTEM` rule "copied VERBATIM from the page text … Do not paraphrase" (`packages/host/src/research-dossier.ts:57`). `[Supported]` the enforcement is in TypeScript, not in the prompt: `parseExtraction` re-checks every passage against the page (`:169-177`), which is the same "verify in code, not in the prompt" move the plan applies to Finance arithmetic. **Confidence: high.**

**Why the dossier is Markdown with a fixed skeleton.** `[Direct]` the plan's principle 2: "Markdown is the interchange format. Research dossier, Data analysis, Finance brief all serialize to a structured `.md` with a fixed skeleton. Any mode can consume 'source material' Markdown." The code comment at `packages/core/src/artifacts/dossier.ts:40` says the same: "Other modes navigate the Markdown by these." That is also why `DOSSIER_HEADINGS` is not localized. **Confidence: high.**

**Why the handoff is a module-level variable and a window event.** `[Direct]` `docs/internal/research-dossier-analyst-modes-plan.md`, step A6: "module-level pending payload + `agentforge-mode-handoff` CustomEvent … Because `WorkModeKeepAlive` keeps modes mounted, no router state or storage is needed." The file header repeats it (`apps/web/lib/mode-handoff.ts:1-5`). **Confidence: high.**

**Why persistence is allowed to fail silently.** `[Direct]` the inline comment at `packages/host/src/research-generate.ts:106`: "Persistence must never fail the job; the notes are still returned. Log the code only, never the body." The reason to prefer a readable-but-unsaved dossier over an error is `[Inferred]` from the cost asymmetry — the run has already spent up to 10 page fetches and 12 model calls, and the caps principle above treats that spend as the scarce resource. **Confidence: high for the mechanism, hedged for the rationale.**
