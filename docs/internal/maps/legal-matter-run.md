# Map — Legal matter run

Last verified: 2026-09-20 at 6984d84

## Overview

Legal is a **matter job**: `.docx` files in, position-aware review, verified deliverables out (issues memorandum, tracked-changes redline, deviation report, red-flags Markdown, run manifest). A *matter* is a folder on disk, not a database row — everything except the artifacts lives under `localDataDir()/legal/<workspaceId>/<matterId>/` as JSON plus the original bytes (`packages/host/src/legal/store-files.ts:1-9`, `packages/host/src/legal/store.ts:305-307`).

The thing to hold onto: **nine of the ten legal routes never touch a model.** Matter create, list, get, patch (including role changes), delete, file upload and file delete are pure disk bookkeeping and work with no gateway key at all. Only `POST /api/v1/legal/matters/:matterId/run/stream` reaches the gateway, and it is guarded twice — a 403 gate before the job starts and a 503 `runtime_stub` check inside it (`packages/host/src/handlers/legal.ts:114-115`, `packages/host/src/legal-generate.ts:62-72`).

The second thing: **the run's 503 is not an HTTP 503.** The route answers `200 text/event-stream` and delivers `runtime_stub` as the single `job.error` frame inside the stream (`packages/host/src/job-stream.ts:8-13`, proven by `packages/host/src/handlers/legal.test.ts:188-199` and by the drive — see Gotchas).

## How it works

### 1. Reaching the surface

`mode-legal` on the left rail is built dynamically from the product mode's href (`apps/web/components/app-rail.tsx:330`, `:316`; `href: "/legal"` in `packages/core/src/agents/product-modes.ts:11`), so there is no literal `data-testid="mode-legal"` to grep. `/legal` itself is `<Route path="/legal" element={null} />` (`apps/web/src/App.tsx:164`) — the work modes mount through `WorkModeKeepAlive`, not through the route element, so the route table is not where the studio is found.

`LegalStudio` (`apps/web/components/legal-studio.tsx:53`) renders `legal-shell` → `legal-studio` (`:255-256`). `legal-studio` carries `data-screen` = `"new" | "running" | "result"`, computed at `:252` as `job.busy ? "running" : result ? "result" : "new"`. Screen 1 is the matter panel (`LegalMatterPanel`) beside the matter map (`LegalMatterMap`); screen 2 is `LegalRunView`; screen 3 is `LegalResultView`.

On mount the studio fires two unauthenticated-looking GETs — `listLegalMatters()` and `listLegalPlaybooks()` (`apps/web/components/legal-studio.tsx:72-81`).

### 2. Intake — the matter is created by the first upload *attempt*

There is no "create matter" button. `ensureMatter()` (`apps/web/components/legal-studio.tsx:91-98`) is called from `onFiles()` (`:100`) and POSTs `/api/v1/legal/matters` the first time a file is dropped. The title is `draft.title.trim() || untitled()` (`:95`), so an untitled matter is stored as `legal.studio.untitled`.

The order inside `onFiles` matters: `ensureMatter()` runs **before** `uploadLegalFiles()` (`:108-109`). The client's `.docx` pre-check lives in `uploadLegalFile` (`apps/web/lib/legal-client.ts:309-311`), i.e. *after* the matter exists — so a refused `.txt` still leaves a real, empty matter on disk. See Gotchas.

`handlePostLegalMatters` (`packages/host/src/handlers/legal.ts:44-52`) validates against `createMatterBodySchema` (`packages/host/src/legal/input.ts`) and writes `matter.json` through `legalStore()`.

### 3. Upload — .docx only, twice-checked, magic-sniffed

Two independent gates:

- **Client, before the network.** `isDocxFile` is a filename regex (`apps/web/lib/legal-client.ts:300-302`); a miss throws the hardcoded English `LEGAL_DOCX_ONLY_MESSAGE` (`:17-18`, thrown at `:310`). A file over `LEGAL_FILE_MAX_BYTES` (25 MB, `:20`) throws before the network too (`:312-314`). One multipart request per file, field `"file"`, sequential, stop-at-first-failure (`uploadLegalFiles`, `:329-346`).
- **Host, on the bytes.** `handlePostLegalMatterFile` (`packages/host/src/handlers/legal.ts:88-103`) re-checks the 25 MB cap at `:94-96`, then the store sniffs the zip magic `50 4B 03 04` (`packages/host/src/legal/store-files.ts:35`, `:115-117`) before `parseDocxOrThrow` (`:154-169`) hands the bytes to `readDocxUnderCaps`. Anything that is not a real docx becomes one `unsupported_content_type` 400 (`unsupportedFileError`, `:28-30`), whose message is the localized `unsupportedFile` copy (`packages/core/src/legal/output-copy.ts:66`, id at `:160`).

Caps (`assertFileCaps`, `packages/host/src/legal/store-files.ts:128-142`): at most `LEGAL_CAPS.maxFiles` = 60 documents, 25 MB per file (413), 100 MB per matter (413; `LEGAL_CAPS.maxTotalBytes`, `packages/core/src/legal/types.ts:237`). Duplicate content is rejected by sha256 with a 409 (`packages/host/src/legal/store.ts:182-190`).

A stored doc becomes a `MatterDocCard` (`buildDocCard`, `store-files.ts:180-204`) with `paragraphs` / `words` / `insertions` / `deletions` / `definedTerms` / `preview` counters and `role: "context"` (`:195`). Bytes land at `files/<docId>.docx`, the parsed `DocxDocument` is cached at `parsed/<docId>.json` (`store-files.ts:53-58`).

### 4. Role classification — the user's cycle and the model's

Every upload starts as `context`. The role tag `legal-file-role-<docId>` (`apps/web/components/legal-file-list.tsx:86`) cycles on click through `DOC_ROLES` in array order with a modulo wrap (`nextDocRole`, `apps/web/lib/legal-view.ts:105-108`): `counterparty-draft → our-draft → prior-turn → executed → instruction → playbook → figures → precedent → context → …`. From the `context` default the first click therefore lands on `counterparty-draft`.

There is **no per-file role route**. `onCycleRole` (`apps/web/components/legal-studio.tsx:129-147`) sends `PATCH /api/v1/legal/matters/:matterId` with `{ roles: [{ id, role }] }`; `handlePatchLegalMatter` (`packages/host/src/handlers/legal.ts:62-76`) splits `roles` off to `store.setRoles` and applies the rest through `store.update`.

Roles are not cosmetic: `DOC_ROLE_PRIORITY` (`packages/core/src/legal/types.ts:27-37`) is the conflict order (`executed` 1 … `context` 7) and is written into the model preamble by `priorityBlock` (`packages/core/src/legal/prompts.ts:121-131`). Anything still `context` when the run starts is re-classified by the model in stage 1.

### 5. Starting a run

`legal-run` is enabled by `canRun(draft, docs.length, uploading)` (`apps/web/lib/legal-view.ts:101-103`) — **at least one document AND a non-empty client party AND no upload in flight**. `onRun` (`apps/web/components/legal-studio.tsx:164-193`) first PATCHes the whole draft back to the matter (`:172`), then calls `job.run(legalRunStreamPath(saved.id), { model, verifierModel })`.

Transport is a POST that streams SSE, not `EventSource` and not polling: `runJobStream` (`apps/web/lib/job-stream.ts:47-56`) does `fetch(..., { method: "POST", signal })` and hand-reads `res.body.getReader()` through `consumeSse`; `useJobStream` (`apps/web/lib/use-job-stream.ts:23-77`) folds each `JobEvent` into `JobProgress`. **Cancel is a client-side `AbortController.abort()`** (`use-job-stream.ts:29-32`) wired to `legal-cancel` (`apps/web/components/legal-run-view.tsx:50`) — there is no cancel route.

Host side: `handlePostLegalRunStream` (`packages/host/src/handlers/legal.ts:112-122`) calls `requireGatewayAllowedFor(tenant)` at `:115` — the only legal route that does — then wraps `generateLegalRun` in `streamJob` (`packages/host/src/job-stream.ts:29-58`).

### 6. `generateLegalRun` — the per-run host orchestrator

`packages/host/src/legal-generate.ts:204-282`:

1. `requireLive(tenant.workspaceId)` (`:62-72`, called at `:211`) — `resolveRuntimeMode` returning `"stub"` throws `ApiError("runtime_stub", legalOutputCopy(locale).stubError, 503)` at `:68-69`. **This is the state a keyless desk records.**
2. `requireLegalMatter` → 404 if gone; `resolveModels` picks the drafting and verifier model ids (`:87-94`).
3. `loadDocMaps` (`:109-129`) reads each doc's cached parse and raw bytes; a missing pair is `internal_error` 500 (`:119-121`), zero docs is `invalid_request` 400 "Upload at least one .docx before running" (`:125-127`).
4. `runLegalMatter(...)` (`:220-247`) with `ask` bound to the model call, `emit` bound to the SSE queue, `maxRounds: LEGAL_CAPS.maxRounds` (`:227`) and the request's `abortSignal`.
5. Persist: `persistDeliverable` (`:131-157`) maps `DeliverableKind → ArtifactKind` via `ARTIFACT_KIND` (`:43-49`) and writes each through `artifactStore().create`; `persistManifest` (`:159-178`) stores the manifest as a `kind: "matter"` artifact; `legalStore().saveRun` (`:267`) writes `runs/<runId>.json`; a memo/red-flags text is upserted as a Knowledge work source (`:270-273`).

### 7. `runLegalMatter` — the nine stages

`packages/host/src/legal/run.ts:748-827`. `maxRounds = Math.max(1, input.maxRounds)` (`:749`); the preamble is built at `:759` and **rebuilt at `:762`** once classify has resolved real roles.

| # | Stage | Function | Phase emitted | What it does |
|---|---|---|---|---|
| 1 | classify | `classify` (`run.ts:182-210`) | `classify` (`:183`) | Model assigns a `DocRole` to every doc still `context`; one `job.step` per doc (`:206-208`) |
| 2 | diff | `diffStage` (`:212-231`) | `diff` (`:213`) | `diffDocuments(prior-turn, counterparty-draft)` → `unmarked-change` findings; missing either doc emits `noPriorTurn` and returns `[]` (`:219-222`) |
| 3 | review | `reviewStage` (`:233-277`) | `review` (`:241`) | Emits `job.source` per read doc (`:244`); clauses from `splitClauses` (`:767`) mapped to playbook items (`mapChecklistToClauses`, `:768`); reviewed at concurrency `LEGAL_CAPS.reviewConcurrency` = 3 (`:755`), one `job.step` with `current/total` per clause (`:273`) |
| 4 | missing | `missingStage` (`:279-311`) | `missing` | Unmapped playbook items confirmed absent by the model → `missing` findings (`:306-307`) |
| 5 | interactions | `interactionStage` (`:313-366`) | `interactions` | Up to `LEGAL_CAPS.maxInteractions` = 10 high-severity findings (`:322`) checked for compounding → `interaction` findings |
| — | reserved scan | `scanReserved`/`applyReserved` (`packages/host/src/legal/instructions.ts:39-73`, `:86-101`) | *(none)* | "reserve / hold / leave open" language in `matter.instructions` or an `instruction`-role doc blanks `proposedText` and sets `reservedFor` (`run.ts:772-782`) |
| 6 | draft | `draftStage` (`:475-495`) | `draft` (`:485-487`) | One `job.step` per deliverable (`:438`); `draftOne` (`:429-473`) dispatches per kind — see §8 |
| 7 | verify | `verifyStage` (`:533-606`) | `verify` (`:541`) + `job.round` (`:543-548`) | Eight code checks then the model grade — see §9 |
| 8 | edit | `editStage` (`:608-708`) | `edit` (`:615`) | Auto-fix + model patches for the round's failures |
| 9 | package | inline (`:813-818`) | `package` (`:813`) | One `job.step` per final deliverable |

`abort(ctx)` (`:148-150`) → `throwIfJobAborted` (`packages/host/src/job-stream.ts:19-23`) is called at the head of every stage and inside every per-item loop, so a cancel lands mid-phase rather than only between phases.

### 8. Deliverables — two are model-composed, three are pure code

| Kind | Renderer | Format | Words from |
|---|---|---|---|
| `issues-memo` | `renderMemoDocx` (`packages/host/src/legal/render-memo.ts:146-166`) via `draftMemo` (`run.ts:368-398`) | `.docx` | Model `MemoOutline`, code expands `{{F<n>}}` tokens (`render-memo.ts:38-44`); `fallbackMemo` (`instructions.ts:272-295`) when the model call drops |
| `executive-summary` | same path, `kind="executive-summary"` | `.docx` | Model. **Rendered in the UI but disabled** — `available: false` (`apps/web/lib/legal-view.ts:83-94`) |
| `redline` | `buildRedlinePatches` (`render-redline.ts:70-91`) + `applyRedline` from `@agentforge/core/docx`, then `validateDocx` (`run.ts:400-427`) | `.docx`, Word tracked changes | Pure code from findings |
| `deviation-report` | `renderDeviationXlsx` (`render-deviation.ts:83-94`) | `.xlsx`, Deviations + Summary sheets | Pure code |
| `red-flags` | `renderRedFlagsMarkdown` (`render-redflags.ts:104-123`) | `.md` | Pure code; re-rendered once after the round loop (`run.ts:801-812`) |

Filenames and mimes come from `FILENAME` / `MIME` (`packages/host/src/legal/instructions.ts:219-231`). The UI downloads them as `legal-download-<kind>` (`apps/web/components/legal-result-view.tsx:87`) through `GET /api/v1/artifacts/:id/file` (`legalArtifactFilePath`, `apps/web/lib/legal-client.ts:30-32`); on desktop that is a native save (`saveBlob`), so no browser download event fires.

### 9. Verify — eight code checks, then a model grade, up to three rounds

`runCodeChecks` (`packages/core/src/legal/verify.ts:252-254`) runs all eight in `VERIFY_CHECK_ORDER` (`:45-54`):

| # | Code | Function | Line | Checks |
|---|---|---|---|---|
| 1 | `quotes-verbatim` | `checkQuotesVerbatim` | `verify.ts:83-103` | Finding quotes are verbatim in the counterparty draft; memo quotes ≥ `MEMO_QUOTE_MIN_CHARS` (25, `:57`) verbatim in some doc |
| 2 | `numbers-traced` | `checkNumbersTraced` | `:106-115` | Every number in the memo traces to a matter document (`guardNumbers`, cross-refs masked) |
| 3 | `xrefs-resolve` | `checkXrefsResolve` | `:125-142` | Every `§n.n` in proposed text or the memo resolves to a real clause; failures marked auto-fixable (`:139`) |
| 4 | `defined-terms` | `checkDefinedTerms` | `:145-165` | Capitalised terms in proposed text are defined in the draft or by a `missing` finding |
| 5 | `facts-match` | `checkFactsMatch` | `:168-187` | Memo to/from matches addressee/author; party names appear |
| 6 | `instructions-obeyed` | `checkInstructionsObeyed` | `:190-208` | Reserved clauses carry no `proposedText` and do carry `reservedFor`; auto-fixable (`:202-203`) |
| 7 | `docx-valid` | `checkDocxValid` | `:211-227` | Redline validation clean, zero failed patches |
| 8 | `coverage` | `checkCoverage` | `:233-238` | Every read doc cited, every skipped doc explained — **informational** |

`verifyOk` (`:257-259`) is true iff every check **except `coverage`** has zero failures. `modelVerify` (`run.ts:497-531`) then adds two model calls per round: a checklist pass chunked by `LEGAL_CAPS.checklistChunk` = 10 (`:508-521`) and an opposing-counsel pass returning `Concession[]` with `disposition: "fix" | "market" | "reserved"` (`:523-529`). A round is `ok` iff code checks pass **and** every checklist verdict passes **and** no concession is `"fix"` (`:591-594`).

The loop is `for (let round = 1; !verify.ok && round < maxRounds; round += 1)` (`run.ts:788`): edit → re-apply reserved → re-draft only `edited.touched` (`:698-706`) → merge by kind (`:792-796`) → verify again (`:798`). The label the user sees is the `job.round` event `{round, total, label}` (`:543-548`) using `roundOf: "Round {round} of {total}"` (`packages/core/src/legal/output-copy.ts:91`; id `"Putaran {round} dari {total}"`, `:185`).

Exhausting all three rounds is **not an error**: the run returns normally and `manifest.status` is `"complete-with-failures"` (`run.ts:819`).

### Failure modes

| Failure | Where | What the client gets |
|---|---|---|
| Gate closed (key saved but not allowed) | `requireGatewayAllowedFor`, `packages/host/src/handlers/legal.ts:114` | HTTP **403** `gateway_blocked`, no SSE stream |
| Runtime resolves to stub (no key at all) | `requireLive`, `packages/host/src/legal-generate.ts:68-69` | HTTP **200** SSE carrying one `job.error` frame `{code:"runtime_stub", status:503}` → `legal-error` |
| Zero documents on the matter | `packages/host/src/legal-generate.ts:125-127` | `invalid_request` 400 inside the stream |
| Parsed JSON or bytes missing from the store | `packages/host/src/legal-generate.ts:119-121` | `internal_error` 500 inside the stream |
| Client pressed `legal-cancel` / closed the tab | `throwIfJobAborted`, `packages/host/src/job-stream.ts:19-23` | `aborted` 499; partial deliverables discarded |
| Matter id unknown | `packages/host/src/legal/store.ts:128-134`, `:317-323` | HTTP 404 on GET / PATCH / DELETE / run |
| Malformed body | `parseLegalBody`, `packages/host/src/legal/input.ts:82-90` | HTTP 400 `invalid_request` with the first zod path |
| Not a real .docx (magic sniff or reader) | `packages/host/src/legal/store-files.ts:32-34`, `:153-169` | HTTP 400 `unsupported_content_type` |
| File > 25 MB / matter > 100 MB / > 60 files | `assertFileCaps`, `store-files.ts:129-141` | HTTP 413 `invalid_request` |
| Same sha256 already in the matter | `packages/host/src/legal/store.ts:183-190` | HTTP 409 `conflict` |
| Stored `matter.json` / run JSON fails re-validation | `store.ts:121-124`, `:290-297` | HTTP 500 `internal_error` |
| Model returns unparseable JSON | `askJson`, `run.ts:152-180` | one retry, then a `droppedOutput` step and `null` — the stage skips that item |
| Three verify rounds still failing | `run.ts:788`, `:819` | HTTP 200, `manifest.status: "complete-with-failures"`, deliverables still returned |

## Where things live

| File | Role |
|---|---|
| `apps/web/components/legal-studio.tsx` | The whole surface's state machine: draft, matter, lazy create, upload, role cycle, run, reopen, next turn |
| `apps/web/components/legal-matter-panel.tsx` | Screen 1 left column — title, files, side, work type, deliverables, playbook, memo header, instructions |
| `apps/web/components/legal-file-list.tsx` | Drop zone, hidden file input, per-doc row, role tag, remove |
| `apps/web/components/legal-matter-map.tsx` | Matter map table, "what will happen" plan, model pickers, previous matters |
| `apps/web/components/legal-run-view.tsx` | Screen 2 — `legal-progress`, round tag, cancel, documents read, streamed findings |
| `apps/web/components/legal-result-view.tsx`, `legal-result-tabs.tsx`, `legal-findings-table.tsx`, `legal-verify-report.tsx` | Screen 3 — downloads, seven tabs, findings rows, verification report |
| `apps/web/lib/legal-client.ts` | Every `/api/v1/legal/*` call, the response zod schemas, the `.docx` pre-check, artifact download |
| `apps/web/lib/legal-view.ts` | `canRun`, `nextDocRole`, `DELIVERABLE_OPTIONS`, `RESULT_TABS`, plan steps, streamed-findings extraction |
| `apps/web/lib/job-stream.ts`, `apps/web/lib/use-job-stream.ts` | POST-based SSE reader and the progress reducer shared by every job mode |
| `packages/host/src/router.ts:324-333` | The ten legal route registrations |
| `packages/host/src/handlers/legal.ts` | Route handlers; the gateway gate at `:115` |
| `packages/host/src/legal-generate.ts` | `generateLegalRun` — stub gate, doc loading, artifact/manifest/run persistence, Knowledge upsert |
| `packages/host/src/legal/run.ts` | `runLegalMatter` — the nine stages and the round loop |
| `packages/host/src/legal/store.ts`, `store-files.ts`, `records.ts` | Matter CRUD on disk, path builders, caps, magic sniff, on-disk record schemas |
| `packages/host/src/legal/instructions.ts` | Reserved-clause scan, finding builders, `FILENAME`/`MIME`, phase/step emit helpers |
| `packages/host/src/legal/render-memo.ts`, `render-redline.ts`, `render-deviation.ts`, `render-redflags.ts`, `render-shared.ts` | The four deliverable renderers and their shared helpers |
| `packages/host/src/job-stream.ts` | `streamJob`, `jobErrorFromUnknown`, `throwIfJobAborted` — shared by every job mode |
| `packages/core/src/legal/types.ts` | `DOC_ROLES`, `DOC_ROLE_PRIORITY`, `DELIVERABLE_KINDS`, `Finding`, `VerifyReport`, `LegalManifest`, `LEGAL_CAPS` |
| `packages/core/src/legal/verify.ts`, `verify-text.ts` | The eight code checks and their pure text helpers |
| `packages/core/src/legal/prompts.ts`, `stage-cards.ts`, `schemas.ts` | Preamble, per-call "STAGE n of 9" card, zod schemas for every model response |
| `packages/core/src/legal/checklists.ts`, `playbook-*.ts` | Built-in playbooks and the keyword-overlap clause mapper |
| `packages/core/src/legal/output-copy.ts`, `locale.ts`, `deliverable-manuals.ts` | en/id user-facing copy (incl. `stubError`), locale resolution, per-deliverable format manuals |
| `apps/web/locales/{en,id}/legal.json` | Renderer strings — `studio.newMatter` "Perkara baru", `studio.run` "Jalankan perkara", `previous.title` "Perkara sebelumnya" (`id/legal.json:14`, `:15`, `:163`) |

## Gotchas

- **The run's "503" is an HTTP 200.** `POST .../run/stream` answers `200 text/event-stream`; `runtime_stub` arrives as the single `job.error` frame, because `streamJob` turns a rejected `run()` into an event rather than a status (`packages/host/src/job-stream.ts:8-13`, `:58-60`). The unit test asserts exactly one chunk matching `^event: job\.error` with `status: 503` in the payload (`packages/host/src/handlers/legal.test.ts:188-199`). Observed on the owner's `:3000` on 2026-09-17: `POST /api/v1/legal/matters/<id>/run/stream -> 200`, `legal-error` populated, `legal-progress` count 0, `data-screen` still `"new"`.
- **The Settings hint never renders on a stub run.** `legal-studio.tsx:260` appends `SettingsLinkHint` only when `needsSettingsHint(...) && !/settings/i.test(error)` — but the `runtime_stub` copy already contains the word "Settings" in both catalogs (`packages/core/src/legal/output-copy.ts:65` and the id copy at `:159`), so the test is always false and `legal.studio.openSettings` is dead on this path. The hint the user sees is the sentence, not a link.
- **A refused upload still creates the matter.** `onFiles` calls `ensureMatter()` before `uploadLegalFiles()` (`apps/web/components/legal-studio.tsx:108-109`), and the `.docx` pre-check is inside `uploadLegalFile` (`apps/web/lib/legal-client.ts:309-311`). Dropping a single `.txt` therefore POSTs `/api/v1/legal/matters` (201), shows the refusal, and leaves an empty matter on disk. Verified on the drive: one `POST /matters -> 201` fired during the `.txt` attempt, none during the `.docx` attempt that followed.
- **The docx-only refusal is hardcoded English.** `LEGAL_DOCX_ONLY_MESSAGE` (`apps/web/lib/legal-client.ts:17-18`) is a module constant, not a `t()` call, even though `legal.errors.docxOnly` is translated in both catalogs (`apps/web/locales/id/legal.json:32` = "Hanya berkas .docx yang diterima pada v1…"). On an `id` desk the whole studio is Indonesian and this one sentence is English. The id key has no reader — grep `errors.docxOnly` in `apps/web` returns only the JSON files.
- **There is no delete-matter control.** `deleteLegalMatter` exists (`apps/web/lib/legal-client.ts:295-298`) and `DELETE /api/v1/legal/matters/:matterId` works (`packages/host/src/router.ts:301`, `handlers/legal.ts:78-85`, returns `{ ok: true }`), but no component calls it and no testid exists — the only references are in `apps/web/lib/legal-client.test.ts:16`, `:181`. Individual *files* can be removed (`legal-file-remove-<docId>`, `legal-file-list.tsx:96`); matters cannot.
- **Delete removes the matter folder, not the workspace folder.** `store.remove()` is `rmSync(dirFor(tenant, id), { recursive: true, force: true })` (`packages/host/src/legal/store.ts:170`), so `<dataDir>/legal/<workspaceId>/` survives as an empty directory after the last matter goes. Verified on the drive: after the DELETE, `data/legal/<workspaceId>/` existed with zero files.
- **Role cycling is a whole-matter PATCH.** There is no `/files/:docId` PATCH; the role tag sends `PATCH /api/v1/legal/matters/:matterId` with a `roles` array (`legal-studio.tsx:141`, handled at `packages/host/src/handlers/legal.ts:62-76`). A drive that waits on a per-file route will wait forever.
- **`executive-summary` is a rendered-but-disabled deliverable.** `legal-deliverable-executive-summary` has count 1 and is `available: false` (`apps/web/lib/legal-view.ts:83-94`); the id label reads "belum tersedia pada versi ini". It is a real `DeliverableKind` in core (`packages/core/src/legal/types.ts:39`) that the UI will not let you pick.
- **The per-file cap is 25 MB, not the 40 MB in `LEGAL_CAPS`.** `LEGAL_FILE_MAX_BYTES` (`packages/host/src/legal/store-files.ts:21`) is deliberately tighter than `LEGAL_CAPS.maxFileBytes` (`packages/core/src/legal/types.ts:238`) because it matches the desktop IPC bytes envelope. A 30 MB docx is refused even though core would allow it.
- **The preamble is built twice.** Once before classify with placeholder `context` roles (`run.ts:759`) and again after (`:762`). Classify is the one stage whose system prompt does not know the final document roles.
- **`coverage` never blocks a round.** It is excluded from `verifyOk` (`packages/core/src/legal/verify.ts:257-258`); an uncited document only surfaces in `openForHuman` and the red-flags "documents skipped" section.
- **`red-flags` is re-rendered after the loop** (`run.ts:801-812`) whether or not it was in `edited.touched`, so its verification section always reflects the settled report — the other deliverables may reflect the round in which they were last touched.
- **`editStage` only ever patches findings.** Every patch it builds targets `"findings"` (`run.ts:642-646`, `:665`, `:686`) and `applyFindingEdits` drops anything else (`packages/core/src/legal/ledger.ts:58-63`), so the memo-section edit shape in `schemas.ts` is never exercised by this path.
- **Cancel is client-only.** `legal-cancel` aborts the fetch (`apps/web/lib/use-job-stream.ts:29-32`); the host notices through `request.abortSignal`. There is no cancel route to call from a script.

## Verify

`.cursor/skills/verify-agentforge/features/legal.md` — sub-features `legal-rail`, `legal-shell`, `legal-file-input`, lazy matter + role cycle, the run gate, the stub run, result tabs, downloads.

DOM testids that prove it: `mode-legal` (dynamic, `apps/web/components/app-rail.tsx:339`), `legal-shell` / `legal-studio` with `data-screen` (`apps/web/components/legal-studio.tsx:255-256`), `legal-matter-panel` / `legal-matter-title` / `legal-side` / `legal-side-<role>` / `legal-side-party` / `legal-side-counterparty` / `legal-side-role-other` / `legal-work-type` / `legal-work-type-<type>` / `legal-deliverable-<kind>` / `legal-playbook` / `legal-author` / `legal-addressee` / `legal-firm` / `legal-instructions` (`apps/web/components/legal-matter-panel.tsx:50-224`), `legal-file-input` / `legal-drop-zone` / `legal-file-list` / `legal-file-row` / `legal-file-role-<docId>` / `legal-file-remove-<docId>` (`apps/web/components/legal-file-list.tsx:53-96`), `legal-matter-map` / `legal-matter-map-row` / `legal-plan` / `legal-studio-model` / `legal-studio-verifier-model` / `legal-previous` / `legal-previous-row` / `legal-open-<matterId>` (`apps/web/components/legal-matter-map.tsx:93-180`), `legal-reopen` / `legal-run` / `legal-error` (`apps/web/components/legal-studio.tsx:309`, `:330`, `:258`), `legal-round` / `legal-cancel` / `legal-progress` / `legal-documents` (`apps/web/components/legal-run-view.tsx:46-63`), `legal-download-<kind>` / `legal-result-headline` / `legal-new-matter` / `legal-next-turn` / `legal-tabs` / `legal-tab-<id>` / `legal-memo` / `legal-handoff` (`apps/web/components/legal-result-view.tsx:87-196`), `legal-finding-row` (`apps/web/components/legal-findings-table.tsx:35`, `:85`), `legal-verify` / `legal-verify-<key>` (`apps/web/components/legal-verify-report.tsx:22`, `:35`, `:39`).

Stub proof stops at intake, upload, role editing and the stream's `runtime_stub` frame. A live run needs doctor `runtime: "ai"`. Packaged proof needs `doctor.mjs --desktop` (`transport: "ipc"`), not `:3000`.

## Why

**Why the gateway check lives on the run route only.** `[Direct]` the comment at `packages/host/src/handlers/legal.ts:114` states it: the run stream is "the only legal route that reaches the gateway; the rest is matter bookkeeping on disk." That is what makes intake, upload and role editing driveable with no key — the property the feature file depends on. **Confidence: high.**

**Why the per-file cap is 25 MB rather than the core 40 MB.** `[Direct]` the comment at `packages/host/src/legal/store-files.ts:20` ties `LEGAL_FILE_MAX_BYTES` to "the IPC bytes envelope", i.e. the packaged desktop transport is the binding constraint, not the parser. `[Supported]` the client repeats the same 25 MB number before the network (`apps/web/lib/legal-client.ts:20`, `:312-314`) and the handler re-checks it (`packages/host/src/handlers/legal.ts:94-96`), so all three layers agree. **Confidence: high.**

**Why on-disk records are re-validated on every read.** `[Direct]` `packages/host/src/legal/store.ts:126` and `:296` throw `internal_error` when a stored record fails its zod schema, and the file's own doc comment treats disk content as untrusted input. The matter folder is user-writable, so a hand-edited `matter.json` is an injection surface rather than a convenience. **Confidence: high for the mechanism; the injection-surface reading is `[Inferred]` from the comment's wording.**
