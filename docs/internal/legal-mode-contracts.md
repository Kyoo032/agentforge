# Legal mode — build contracts (v1, docx only)

Status: 2026-09-08, in progress. This file is the single source of truth for module boundaries while
several agents build the Legal mode in parallel. Read `legal-mode-flow.md` for the why; this file is the what.

Scope of v1: **.docx only**. PDF and other formats are rejected at upload with a clear message
("Convert to .docx first"). Deliverables: issues memorandum (docx), redline (docx), deviation report (xlsx),
red-flags (md). Executive summary is deferred.

Shared types and zod schemas already exist and must be used, not redefined:

- `packages/core/src/legal/types.ts` — `LegalWorkType`, `DocRole`, `DOC_ROLE_PRIORITY`, `DeliverableKind`,
  `LegalSide`, `MatterDocCard`, `Finding`, `Citation`, `ChecklistItem`, `Playbook`, `VerifyReport`,
  `VerifyCheck`, `VerifyFailure`, `ChecklistVerdict`, `Concession`, `MemoOutline`, `MemoSection`,
  `EditPatch`, `RoundRecord`, `LegalManifest`, `LEGAL_CAPS`.
- `packages/core/src/legal/schemas.ts` — zod schemas for every model response plus `parseModelJson`.
- `packages/core/src/docx/types.ts` — `DocxDocument`, `DocxParagraph`, `DocxClause`, `DocxDiff`,
  `RedlinePatch`, `RedlineInsertParagraph`, `RedlineOptions`, `RedlineResult`, `DocxValidation`.

Import paths: `@agentforge/core/legal`, `@agentforge/core/docx`, `@agentforge/core/artifacts`, `@agentforge/core/jobs`.

---

## 1. Core docx API (`@agentforge/core/docx`)

Being built now. Signatures are fixed:

```ts
readDocx(bytes: Uint8Array): Promise<DocxDocument>
documentText(doc: DocxDocument): string                 // "[¶12] text" lines and "[T0] a | b" rows
paragraphByAnchor(doc: DocxDocument, anchor: ParagraphAnchor): DocxParagraph | null
findQuote(doc: DocxDocument, quote: string): { anchor: ParagraphAnchor; start: number } | null
splitClauses(doc: DocxDocument): readonly DocxClause[]
diffDocuments(prior: DocxDocument, next: DocxDocument): DocxDiff
applyRedline(bytes: Uint8Array, patches: readonly RedlinePatch[], inserts: readonly RedlineInsertParagraph[], options: RedlineOptions): Promise<RedlineResult>
validateDocx(bytes: Uint8Array): Promise<DocxValidation>
```

`findQuote` is whitespace- and quote-mark-normalised. It is the verbatim check. Anything not found is not verbatim.

---

## 2. Core legal API (`@agentforge/core/legal`) — pure, no I/O

### 2a. `checklists.ts`

```ts
BUILTIN_PLAYBOOKS: readonly Playbook[]           // ids: "generic-contract", "credit-agreement-borrower", "nda-receiving"
findPlaybook(id: string): Playbook | null
mapChecklistToClauses(playbook: Playbook, clauses: readonly DocxClause[]): ChecklistMapping
type ChecklistMapping = {
  mapped: readonly { itemId: string; clauseId: string; score: number }[];   // best clause per item, score 0..1
  unmapped: readonly string[];                                              // item ids with no clause above threshold
}
```

Mapping is keyword overlap over clause heading + text (case-insensitive, stemmed lightly by stripping plural
"s" and "ing"). Threshold 0.25. Named constant.

### 2b. `prompts.ts`

```ts
buildPreamble(input: PreambleInput): string
buildStageCard(stage: StageCardInput): string
type PreambleInput = {
  side: LegalSide; workType: LegalWorkType; deliverables: readonly DeliverableKind[];
  author: string; addressee: string; firm: string;
  docs: readonly MatterDocCard[]; playbook: Playbook | null; priorityNote: string;
}
type StageCardInput =
  | { stage: "classify"; fileCount: number }
  | { stage: "review"; clauseId: string; unmarkedChanges: number; checklistItems: readonly ChecklistItem[] }
  | { stage: "missing"; item: ChecklistItem }
  | { stage: "interaction"; findingTitle: string; clauseId: string }
  | { stage: "draft"; deliverable: DeliverableKind; manual: string }
  | { stage: "verify-checklist"; deliverable: DeliverableKind; itemCount: number }
  | { stage: "verify-opposing"; deliverable: DeliverableKind }
  | { stage: "edit"; target: string; failure: string }
DELIVERABLE_MANUALS: Readonly<Record<DeliverableKind, string>>   // format manuals, formal register
```

The preamble text follows `legal-mode-flow.md` §11 exactly: identity, MATTER, DOCUMENTS table (id, role, name,
counters), SOURCE PRIORITY, RULES ENFORCED BY CODE (six rules), LANGUAGE. It is deterministic for the same input
(no dates, no random ids) so providers can cache it.

### 2c. `verify.ts` — code checks

```ts
runCodeChecks(input: CodeCheckInput): VerifyCheck[]
type CodeCheckInput = {
  findings: readonly Finding[];
  docs: ReadonlyMap<string, DocxDocument>;          // by doc id; counterparty draft included
  counterpartyDocId: string;
  clauses: readonly DocxClause[];                    // of the counterparty draft
  memo: MemoOutline | null;
  memoText: string | null;                           // rendered plain text of the memo, for number and name checks
  allowedNumbers: readonly number[];                 // every number extracted from matter docs
  facts: { parties: readonly string[]; addressee: string; author: string; dateIso: string };
  instructions: readonly { reservedClause: string; by: string }[];
  redline: { validation: DocxValidation; failed: number } | null;
  readDocIds: readonly string[]; citedDocIds: readonly string[]; skipped: readonly { doc: string; reason: string }[];
}
```

One `VerifyCheck` per `VerifyCheckCode`, always all eight, each with `failures[]`:

| code | rule |
|---|---|
| quotes-verbatim | every `Finding.quote` (non-empty) is found by `findQuote` in the counterparty draft; every quoted string in the memo text (between straight or curly double quotes, ≥ 25 chars) is found in some doc |
| numbers-traced | `guardNumbers(memoText, allowedNumbers)` from `@agentforge/core/finance` flags nothing |
| xrefs-resolve | every `§x.y(z)` token in `Finding.proposedText` and memo text exists among clause ids (normalised: strip spaces, compare path) |
| defined-terms | every Capitalised Multi Word term in `proposedText` that is quoted-defined style ("Fee Cap") is defined in the draft's `definedTerms` or appears in a `Finding.proposedText` of kind missing that defines it |
| facts-match | memo `to`/`from` equal `facts.addressee`/`facts.author`; each party name in `facts.parties` appears in the memo text |
| instructions-obeyed | every finding whose clause matches a reserved instruction has `proposedText === null` and `reservedFor` set |
| docx-valid | `redline.validation.ok` and `redline.failed === 0` when a redline was produced |
| coverage | every doc in `readDocIds` is in `citedDocIds` or listed in a `coverage` failure with `autoFixable: false` (informational) |

`autoFixable: true` only for xrefs (renumbering) and instructions-obeyed (strip proposedText).

### 2d. `ledger.ts`

```ts
createLedger(docs, findings): RunLedger
appendRound(ledger, round: RoundRecord): RunLedger            // returns a new ledger
applyFindingEdits(findings, edits: readonly EditPatch[]): readonly Finding[]
```

All immutable.

---

## 3. Host storage (`packages/host/src/legal/store.ts`)

Layout under `localDataDir()/legal/<workspaceId>/<matterId>/`:

```
matter.json          LegalMatterRecord (below)
files/<docId>.docx   original bytes
parsed/<docId>.json  DocxDocument (cached reader output)
runs/<runId>.json    LegalRunRecord
```

```ts
type LegalMatterRecord = {
  id: string; workspaceId: string; title: string; createdAt: number; updatedAt: number;
  side: LegalSide; workType: LegalWorkType; deliverables: DeliverableKind[];
  instructions: string; playbookId: string | null;
  author: string; addressee: string; firm: string;
  docs: MatterDocCard[];                    // roles editable via PATCH
  priorMatterId: string | null;
  lastRunId: string | null;
}
type LegalRunRecord = {
  id: string; matterId: string; startedAt: number; finishedAt: number | null;
  manifest: LegalManifest;
  findings: Finding[];
  verify: VerifyReport | null;
  artifacts: { kind: DeliverableKind; artifactId: string; filename: string }[];
  error: { code: string; message: string } | null;
}
createLegalStore(rootDir: string): LegalStore
legalStore(): LegalStore                              // singleton over localDataDir()/legal
interface LegalStore {
  create(tenant, input: CreateMatterInput): LegalMatterRecord
  list(tenant): LegalMatterRecord[]                   // newest first, cap 100
  get(tenant, id): LegalMatterRecord | null
  remove(tenant, id): boolean
  addFile(tenant, id, file: { filename: string; bytes: Uint8Array }): Promise<{ matter: LegalMatterRecord; card: MatterDocCard }>
  readDoc(tenant, id, docId): Promise<DocxDocument | null>
  readBytes(tenant, id, docId): Uint8Array | null
  setRoles(tenant, id, roles: { id: string; role: DocRole }[]): LegalMatterRecord
  update(tenant, id, patch: Partial<Pick<LegalMatterRecord, "title" | "side" | "workType" | "deliverables" | "instructions" | "playbookId" | "author" | "addressee" | "firm">>): LegalMatterRecord
  saveRun(tenant, id, run: LegalRunRecord): void
  getRun(tenant, id, runId): LegalRunRecord | null
}
```

`addFile`: sniff magic (`PK\x03\x04`) and require `[Content_Types].xml` and `word/document.xml` entries, else
`ApiError("unsupported_content_type", "Only .docx files are accepted in v1. Convert PDF or other formats to .docx first.", 400)`.
Caps from `LEGAL_CAPS` (60 files, 25 MB per file to match the IPC envelope, 100 MB per matter). Filenames sanitised
`replace(/[^\w.-]+/g, "_")`, docId assigned `S<n>` in upload order, sha256 recorded, duplicate sha256 rejected with 409.
Reader output is cached to `parsed/`. Role default `context`; the classify stage sets real roles on run.

All records are workspace-scoped; every method filters on `tenant.workspaceId`.

---

## 4. Host renderers (`packages/host/src/legal/render-*.ts`) — pure

```ts
renderMemoDocx(input: { outline: MemoOutline; findings: readonly Finding[]; side: LegalSide; firm: string }): Promise<{ bytes: Uint8Array; text: string }>
renderMemoText(outline: MemoOutline, findings: readonly Finding[]): string        // same expansion, plain text, for verify
renderDeviationXlsx(input: { findings: readonly Finding[]; side: LegalSide; matterTitle: string }): Uint8Array
renderRedFlagsMarkdown(input: { findings: readonly Finding[]; side: LegalSide; matterTitle: string; verify: VerifyReport | null }): string
buildRedlinePatches(findings: readonly Finding[], draft: DocxDocument, clauses: readonly DocxClause[]): { patches: RedlinePatch[]; inserts: RedlineInsertParagraph[] }
```

Memo docx uses the `docx` package like `document-docx.ts` and `docx-table.ts` (house style: Calibri, heading
colours as there). `{{F3}}` tokens in paragraphs expand to `<finding title> (<clause>; <basis citations>)`.
`findingsTable` renders a real table with columns Clause · Provision · Why adverse · Severity · Proposed language · Basis.
The memo's closing line is always: "Draft work product prepared with automated assistance for review by a qualified lawyer."

Deviation xlsx via SheetJS (`xlsx` package already in core): sheet "Deviations" with header row
Clause · Kind · Title · Provision (quote) · Why adverse · Severity · Negotiability · Proposed language · Basis · Reserved for,
plus a "Summary" sheet with counts by severity. Column widths set.

`buildRedlinePatches`: for findings of kind adverse/deviation/unmarked-change/interaction with non-null
`proposedText` and non-empty `quote` and a `quoteAnchor`, one `RedlinePatch { anchor, find: quote, replace: proposedText, comment: basisLine }`.
For kind `missing` with `proposedText`, one `RedlineInsertParagraph` after the last paragraph of the best-matching
clause (or the last body paragraph). Reserved findings produce nothing. Comment text is
`"<title>. Basis: <citations>."` in formal register.

---

## 5. Host pipeline (`packages/host/src/legal/run.ts`) — pure over deps

```ts
runLegalMatter(input: LegalRunInput, deps: LegalRunDeps): Promise<LegalRunResult>
type LegalRunInput = {
  matter: LegalMatterRecord; docs: ReadonlyMap<string, DocxDocument>; bytes: ReadonlyMap<string, Uint8Array>;
  playbook: Playbook | null; models: { drafting: string; verifier: string }; maxRounds: number; runId: string; now: () => Date;
}
type LegalRunDeps = {
  ask: (args: { model: string; system: string; prompt: string }) => Promise<string>;   // one model call, returns text
  emit: JobEmitter; abortSignal?: AbortSignal;
  concurrency?: number;                                                              // default LEGAL_CAPS.reviewConcurrency
}
type LegalRunResult = {
  manifest: LegalManifest; findings: Finding[]; verify: VerifyReport;
  deliverables: { kind: DeliverableKind; filename: string; mime: string; bytes: Uint8Array; text: string }[];
  rounds: RoundRecord[];
}
```

Stages and the SSE phases they emit (`job.phase` ids are exactly these strings):

| phase id | label | steps |
|---|---|---|
| classify | Classifying documents | one step per doc with the chosen role |
| diff | Comparing with the prior turn | `job.step` with unmarked count; skipped when no prior turn |
| review | Reviewing provisions | one step per clause `current/total`; `job.source` per doc with status `read` |
| missing | Checking required provisions | one step per unmapped checklist item |
| interactions | Checking interactions | one step per high finding, capped |
| draft | Drafting deliverables | one step per deliverable |
| verify | Verifying | `job.round {round,total,label}` then one step per check code with pass/fail counts |
| edit | Applying corrections | one step per patch |
| package | Packaging | one step per artifact |

Loop: draft → verify → if `verify.ok` or round === maxRounds stop, else edit → draft (touched deliverables only) → verify.
Every stage calls `throwIfJobAborted` between model calls. Concurrency via a local `mapWithConcurrency` (copy the
research one; it is file-private there). Model responses parse through `parseModelJson` + the zod schema; one retry
on failure, then the answer is dropped and a `job.step` says so.

Prompts: `buildPreamble` is computed once per run and passed as `system`; `buildStageCard` + payload is the `prompt`.

Instruction handling: the `instructions` text and every `instruction` doc are scanned for the pattern
"reserve|leave open|do not propose|hold" near a clause id or keyword; matches become `reservedClause` entries that
strip `proposedText` from findings and set `reservedFor` to the instructing author.

---

## 6. Host wiring (`packages/host/src/legal-generate.ts` + `handlers/legal.ts` + routes)

Routes (append after the data routes in `router.ts`):

```
POST   /api/v1/legal/matters                       JSON  {title, side, workType, deliverables, instructions?, playbookId?, author?, addressee?, firm?, priorMatterId?} → 201 LegalMatterRecord
GET    /api/v1/legal/matters                       → { matters: LegalMatterRecord[] }
GET    /api/v1/legal/matters/:matterId             → LegalMatterRecord
PATCH  /api/v1/legal/matters/:matterId             JSON partial (title, side, workType, deliverables, instructions, playbookId, author, addressee, firm, roles:[{id,role}]) → LegalMatterRecord
DELETE /api/v1/legal/matters/:matterId             → { ok: true }
POST   /api/v1/legal/matters/:matterId/files       multipart, one file per request, field "file" → { matter, card }
DELETE /api/v1/legal/matters/:matterId/files/:docId → LegalMatterRecord
POST   /api/v1/legal/matters/:matterId/run/stream  JSON {model?, verifierModel?} → SSE job events; job.done result = LegalRunSummary
GET    /api/v1/legal/matters/:matterId/runs/:runId → LegalRunRecord
GET    /api/v1/legal/playbooks                     → { playbooks: {id,title,contractType,itemCount}[] }   (built-ins + KB sources of type Playbook later)
```

`LegalRunSummary` (the `job.done` payload) = `{ runId, manifest, findings, verify, artifacts: {kind, artifactId, filename}[] }`.

`generateLegalRun(tenant, matterId, body, emit, abortSignal)` in `legal-generate.ts`:
1. `requireLive()` like finance (503 `runtime_stub` in stub mode).
2. Load matter, docs (from `parsed/`), bytes, playbook (`findPlaybook`), models (`resolveChatModel` against `listSelectableModels()`, defaults from `modeCatalogPayload().defaults.legal` and `.legalVerifier`).
3. `ask` = `collectJobAssistantText({ tenant, model, systemPrompt: system, runPrefix: "legal", agentId: "legal", versionId: runId, prompt })`.
4. Run, then persist each deliverable as an artifact (`mode: "legal"`, kind by deliverable: issues-memo → memo, redline → redline, deviation-report → report, red-flags → red-flags; docx/xlsx bodies base64 with the OOXML mime; md as text/markdown) and the manifest as kind `matter` (application/json). Save the `LegalRunRecord`. Send the red-flags markdown (or the memo text) to the Knowledge Base via `upsertWorkSource` with `type: "Legal"` after `throwIfJobAborted`.

---

## 7. Web (`apps/web`)

- `lib/legal-client.ts`: typed wrappers for every route above using `apiFetch`; `uploadLegalFile(matterId, file)` posts one `FormData` per file, sequentially, with a per-file progress callback; `runLegalMatter` uses `useJobStream<LegalRunSummary>` from the component.
- `components/legal-studio.tsx` (+ `legal-matter-panel.tsx`, `legal-findings-table.tsx`, `legal-verify-report.tsx`, keep each under 400 lines): the three screens from `docs/internal/mockups/legal-mode-mockup.html`, same class names and layout as `finance-studio.tsx` (`blueprint` panels, `kicker`, `panel-label`, `btn`, `seg`, `tag`). Tabs: Adverse provisions · Missing provisions · Unmarked changes · Verification · Redline · Memo · Audit trail. Labels in formal register only.
- Register: `components/work-mode-keep-alive.tsx` `"/legal": LegalStudio`; `src/App.tsx` `<Route path="/legal" element={null} />`.
- Testids: `legal-studio`, `legal-matter-title`, `legal-file-input`, `legal-side`, `legal-work-type`, `legal-deliverable-<kind>`, `legal-run`, `legal-cancel`, `legal-progress`, `legal-tab-<name>`, `legal-findings`, `legal-finding-row`, `legal-verify`, `legal-download-<kind>`, `legal-error`.
- Hand off: "Send memo to Knowledge Base" via `ArtifactActions` with `kbType="Memo"`; "Open memo in Documents" via `requestModeHandoff({ target: "documents", sourceText: memoText, ... })`.
- Model picker: `useJobModel("legal")`.

---

## 8. Tests each module must ship

- core/docx: agents' own suites (reader, sections, diff, writer, validator).
- core/legal: checklists (mapping on the ACA fixture clauses), prompts (deterministic, contains the six rules, no dates), verify (each check with one pass and one fail case, using fixtures), ledger (immutability).
- host/legal: store (create, addFile with docx sniff and caps, roles, run save, workspace isolation), renderers (memo docx re-reads with `readDocx` and contains the closing line and the table; xlsx parses back with `parseXlsx`; red-flags md has the sections), run (fake `ask` returning canned JSON per stage card keyword; asserts phase order, round events, that a non-verbatim quote is dropped, that a reserved clause has no proposedText, that the loop stops at maxRounds, that abort throws `aborted`), handlers (router dispatch: create → upload fixture → patch roles → 404s → 400 on a .txt upload).
- web: `lib/legal-client.test.ts` for request shaping only (components are not unit-tested in this repo).

Lint with `npx biome check <paths>`; CRLF line endings; files under 400 lines where practical, 800 max.
