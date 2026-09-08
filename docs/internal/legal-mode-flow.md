# Legal mode — processing flow

Status: proposal, 2026-09-08. Mockups in `docs/internal/mockups/legal-*.png`. Nothing built yet.

Principle, same as Finance and Data: **code computes and checks, the model reads and writes.** Every number, quote, cross-reference and citation in the output is produced or verified by TypeScript before the lawyer sees it.

```
matter folder + side + work type + deliverables + playbook
        │
        ▼
 1 INGEST        files → text, tables, emails, prior redlines        (code)
 2 CLASSIFY      role per document, source priority                  (model proposes, user confirms)
 3 DIFF          prior turn vs counterparty draft, silent changes    (code)
 4 REVIEW        clause by clause vs playbook, checklist, sources    (model, one clause at a time)
 5 DRAFT         memo / redline / report from the findings           (model writes, code renders)
        │
        ▼  ┌──────────────────────────────────────────────┐
 6 VERIFY  │ code checks → model checks → fail list         │
 7 EDIT    │ fix only what failed, re-render                │  up to 3 rounds
        │  └──────────────────────────────────────────────┘
        ▼
 8 PACKAGE       artifacts + verification report + audit trail        (code)
 9 HAND OFF      download, KB, Documents, Presentation, next turn
```

Every stage streams `job.phase` / `job.step` / `job.source` events over the existing job SSE channel. One new event, `job.round`, carries the loop counter.

---

## 0. Input

`POST /api/v1/legal/matters` (multipart) then `POST /api/v1/legal/matters/:id/run` (JSON, streamed).

| Field | Shape | Notes |
|---|---|---|
| files | up to 60 files, 100 MB total | docx, xlsx, pptx, pdf, eml, txt, md. Folder structure kept as a path per file. |
| side | `{ role: "borrower" \| "lender" \| "buyer" \| "seller" \| …, party: string }` | Free text allowed. Drives every prompt. |
| workType | `review \| markup \| draft \| analyze` | Same four as harvey-labs. |
| deliverables | list of `{ kind, format }` | `issues-memo.docx`, `redline.docx`, `deviation-report.xlsx`, `executive-summary.docx`, `red-flags.md`, custom |
| playbookId | Knowledge Base source id | Playbook text + a checklist of required clauses and fallback positions. Optional; a built-in generic checklist per contract type is the fallback. |
| instructions | text, 4k chars | Goes through the injection guard like every other user text. |
| priorMatterId | artifact id | For "next turn": loads last run's redline and findings as the prior turn. |

Validation at the boundary: zod schema, mime sniff on every file (not the extension), size caps, reject archives and executables.

---

## 1. Ingest (code)

Per file, in a worker thread with a timeout, emitting `job.source` as each finishes.

| Type | Extractor | What we keep |
|---|---|---|
| docx | unzip + `word/document.xml` walk (new, in core) | paragraphs with numbering, headings, tables, **existing tracked changes and comments** kept as structured data, defined terms map |
| xlsx | `packages/core/src/tabular/xlsx.ts` (exists) | sheets as typed tables, every numeric cell addressable as `Sheet!A1` |
| pptx | unzip + slide XML (new) | slide text in order; image-only slides marked `skipped: no text layer` |
| pdf | text layer only (new dep, pure JS) | page text with page numbers; scanned PDFs marked skipped, no OCR in v1 |
| eml | RFC 822 parser (new, small) | from, to, date, subject, body, attachments listed; attachments ingested as their own files |
| txt / md | as is | |

Output per file: a `MatterDoc` record.

```ts
type MatterDoc = {
  id: "S1" | "S2" | …;            // stable citation id, ordered by path
  path: string; name: string; mime: string; bytes: number;
  role?: DocRole;                  // filled in stage 2
  text: string;                    // linearised, with paragraph anchors ¶12, ¶13 …
  paragraphs: { anchor: string; heading?: string; number?: string; text: string }[];
  tables?: TypedTable[];           // xlsx and docx tables
  numbers?: { ref: string; value: number }[];   // every numeric cell / figure with an address
  email?: { from; to; date; subject };
  revisions?: TrackedChange[];     // from docx w:ins / w:del
  comments?: DocComment[];
  status: "read" | "skipped"; skipReason?: string;
};
```

All text passes `scanInjection` (exists). A hit does not drop the document; it flags the passage and the model sees it wrapped as untrusted content, same as `web_fetch` today.

Caps: 60 files, 100 MB, 400k characters of text per matter into the model context budget. Above that, stage 4 works from retrieval only.

---

## 2. Classify (model proposes, code enforces, user confirms)

One model call over the file list plus the first 600 characters of each document. Returns a role per file and a source-priority order.

Roles: `counterparty-draft`, `our-draft`, `prior-turn`, `executed`, `instruction`, `playbook`, `figures`, `precedent`, `context`.

Rules in code, not prompt:

- Exactly one `counterparty-draft` for review and markup work. Zero or two is an error shown to the user.
- `executed` outranks `instruction` outranks drafts outranks `context`, unless the user reorders.
- Emails from the partner or client are `instruction` by sender, not by content.

The user sees this as the matter map on screen 1 and can change any tag. The run does not start until they press Run, so this is the confirm step.

---

## 3. Diff (code)

Only when a `prior-turn` and a `counterparty-draft` both exist.

- Paragraph-level alignment of prior turn vs counterparty draft, using numbering first and fuzzy text second.
- Every change the counterparty made **without a tracked change** is a `SilentChange { anchorPrior, anchorNew, before, after }`.
- Definition diff: every defined term whose definition text changed.
- Cross-reference diff: every section number whose target moved.

These feed stage 4 as facts. The model never has to find silent changes itself.

---

## 4. Review (model, clause by clause)

Not one big prompt. The draft is split into clauses by its own numbering. Each clause is reviewed in its own model call with a fixed context window:

- our side and party
- the clause text and its defined terms resolved inline
- the matching playbook entry: preferred position, fallback, walk-away (retrieved by heading and by embedding, `knowledge-embed.ts` exists)
- the matching term sheet / commitment letter / instruction passages (retrieved the same way, top 5)
- the silent-change record for this clause, if any
- checklist items that map to this clause

The model returns strict JSON, zod-validated:

```ts
type Finding = {
  clause: string;                  // "§7.2(b)"
  kind: "attacks-us" | "deviates-from-agreed" | "silent-change" | "interaction" | "ok";
  quote: string;                   // must be verbatim in the draft — checked in code, dropped if not
  why: string;
  severity: "high" | "medium" | "low";
  negotiability: "preferred" | "fallback" | "walk-away" | "open";
  proposedText?: string;           // replacement clause language
  basis: { docId: string; anchor: string }[];   // S2 ¶41, PB 7.2 …
  openForHuman?: string;           // partner asked to leave it, or model unsure
};
```

Code then runs two passes the model cannot do reliably alone:

- **Missing clauses.** Every checklist item with no clause mapped to it becomes a `Finding { kind: "missing" }` with the playbook's preferred language as the proposal. The model is only asked to confirm the clause really is absent, not to find absences.
- **Interactions.** For each high finding, retrieve clauses that reference the same defined terms or section numbers and run one more model call asking whether they compound the problem. Capped at 10.

Concurrency 3, same as the dossier extractor. Each finding emits a `job.step` so the findings table on screen 2 fills as it goes.

Instruction handling: if an `instruction` email says to leave a point open, code marks the matching finding `open` and strips any `proposedText`. This is the MFN row in the mockup.

---

## 5. Draft (model writes, code renders)

One model call per deliverable, with the full findings list as the only source of claims. The prompt forbids introducing facts, numbers or quotes not present in the findings or the matter docs.

| Deliverable | Model produces | Code renders |
|---|---|---|
| Issues memo | structured outline: to/from/date/re, sections, per-issue paragraphs referencing finding ids | docx via the `docx` package, real tables (issues table, missing-clauses table), firm template styles if a template docx is in the KB |
| Redline | nothing new — uses `proposedText` from findings | code applies each proposal to the counterparty docx as `w:ins` / `w:del` runs authored as the user, plus a `w:comment` with the basis. Existing counterparty revisions preserved. |
| Deviation report | nothing new | xlsx from findings via SheetJS: one row per finding, columns as in the mockup |
| Executive summary | short prose outline | docx |
| Red-flags md | Markdown from findings | Markdown artifact, same as dossier |

Numbers: the memo outline may cite numbers only by `numberRef` (`S5 Cov!B7`) or by a named computation the engine already did (leverage headroom, share sums). Code substitutes the value. The finance number guard (`guardNumbers`, exists) runs over the final text against the allowed set and marks anything else `[unverified figure]`.

---

## 6. Verify

Runs after every draft. Produces a `VerifyReport`, stored with the artifacts and shown on screen 3.

### 6a. Code checks (deterministic, always run)

| Check | How |
|---|---|
| Quotes verbatim | every `quote` and every quoted string in the memo is a substring of the cited doc, whitespace-normalised. Fail lists the offender. |
| Numbers traced | number guard over memo, summary and report. Allowed set = all `MatterDoc.numbers` values + engine results. |
| Cross-references resolve | every `§x.y` in memo and redline exists in the redlined draft after the edits |
| Defined terms | every capitalised defined term used in `proposedText` is defined in the draft or in a proposed definition |
| Names, dates, parties | parties, addressee, author, matter dates in the memo match the values extracted in stage 1 |
| Instruction compliance | findings marked `open` by an instruction carry no `proposedText`; deliverables requested were all produced |
| Docx valid | the generated files re-open with the same unzip walker, XML well-formed, every relationship id resolves, revision ids unique |
| Coverage | every `read` document was either cited or explicitly listed as "read, nothing relevant" by stage 4; skipped docs listed with reason |

### 6b. Model checks (second model, `knowledgeVerifier` slot in mode defaults)

- **Checklist pass.** For each checklist item and each required memo section, PASS or FAIL with a one-line reason, judged from the deliverable text only. This is the harvey-labs rubric shape, so the same code path can later grade against their tasks.
- **Opposing-counsel pass.** Prompted as counsel for the other side: list anything the redline concedes, leaves ambiguous, or fails to close. Each item becomes a candidate finding for stage 7 or an `openForHuman` if the verifier judges it market.

Model checks never overrule code checks. A code fail is always a fail.

---

## 7. Edit (targeted, not regenerate)

Input: the fail list from stage 6. For each failure:

- code-fixable (bad cross-reference number, unverified number with an obvious source, duplicate revision id): fixed in code, no model call
- content failure (missing section, non-verbatim quote, checklist FAIL, concession): one model call scoped to that section or finding, returning the replacement only

Then re-render only the affected deliverables and go back to stage 6.

Budget: 3 rounds. If round 3 still fails, the run completes with the failures listed in red on the verification report. It never silently ships a failed check and never loops forever. Cost and time are shown per round on screen 2.

---

## 8. Package (code)

- One `artifacts` row per deliverable (`mode: "legal"`, kinds `memo | redline | report | summary | red-flags`), bodies encrypted at rest like messages. Binary docx and xlsx go in as base64 with mime, served by the existing `/artifacts/:id/file` route.
- One `artifacts` row of kind `matter` holding the run manifest: files with hashes, roles, priority, side, work type, playbook id, models, rounds, cost, the full findings JSON, the `VerifyReport`, and the audit trail (which documents were read, skipped, cited).
- The uploaded files stay under `localDataDir()/matters/<id>/` so a next turn can reuse them without re-upload.

---

## 9. Hand off

- Download any deliverable (native save via `apiFetch`, exists).
- Send memo to Knowledge Base as a `Memo` source with matter provenance (`upsertWorkSource`, exists).
- Open memo in Documents, make a client presentation: the `sourceText` handoff that Research already uses.
- Next turn: new run with `priorMatterId`; the current redline becomes `prior-turn`, the user uploads the counterparty's reply, stage 3 diffs them.

---

## 10. Concurrency — what runs at the same time

The run is a dependency graph, not a sequence. A stage starts as soon as its inputs exist. The scheduler is the same worker-pool pattern the dossier extractor uses, with one pool for CPU work (parsing, diffing, rendering, checks) and one for model calls (gateway rate-limit aware).

```
ingest S1 ─┐
ingest S2 ─┼─► classify ─► diff ─┬─► review §1.1 ──┐
ingest S3 ─┘                     ├─► review §1.2 ──┤
   (pool of 4)                   ├─► …             ├─► findings frozen ─┬─► draft memo ─────┐
                                 ├─► missing pass ─┤   (round r)        ├─► draft redline ──┼─► verify (per deliverable, parallel)
                                 └─► interactions ─┘                    └─► draft xlsx ─────┘         │
        (model pool, concurrency 3–6)                                                                   ▼
                                                                                        fail list → edits (parallel by section) → re-render touched deliverables → verify again
```

| Stage | Unit of parallelism | Limit | Why the limit |
|---|---|---|---|
| Ingest | one worker per file | 4 workers | memory; a 40 MB xlsx parse is the heaviest unit |
| Classify | single call | 1 | needs the whole file list |
| Diff | per aligned paragraph pair | CPU pool | pure code |
| Review | one model call per clause | 3–6 concurrent, adaptive | gateway 429s halve concurrency; success restores it |
| Missing-clause pass | one call per unmapped checklist item | same pool, runs alongside clause reviews | independent of clause results |
| Interactions | one call per high finding | after the clause it depends on, max 10 | needs that finding |
| Draft | one call per deliverable | all deliverables at once | each reads the frozen findings, none reads another draft |
| Verify 6a | per deliverable, per check | CPU pool | pure code |
| Verify 6b | per deliverable, checklist split into chunks of 10 items | model pool | independent judgements |
| Edit | per failure, grouped by section | parallel across sections, serial within a section | two edits to the same clause must compose |
| Render | per deliverable | parallel, except the redline | the redline docx has a single writer applying an ordered patch list |

### Shared state without mutation

Nothing edits a finding or a draft in place. Each stage appends to an immutable ledger keyed by round:

```ts
type RunLedger = {
  docs: readonly MatterDoc[];                         // stage 1, never changes after classify
  findings: readonly Finding[];                       // stage 4, frozen before drafting
  rounds: readonly {
    round: number;
    drafts: Readonly<Record<DeliverableId, Draft>>;   // outline or patch list, plus rendered bytes hash
    verify: VerifyReport;
    edits: readonly EditPatch[];                      // what stage 7 produced for the next round
  }[];
};
```

Round r+1 drafts are computed from round r drafts plus round r edits. Because inputs are frozen per round, every parallel call sees the same snapshot, and a cancelled run leaves a consistent ledger that can be resumed.

### Conflict rules for parallel edits

- Two edits to the same clause: applied in severity order, each rebased on the previous one by the code patcher. If the second no longer applies, it goes back to the model with the current clause text.
- An edit that changes a defined term marks every clause using that term for re-verification in the next round, even if they passed.
- An edit to the memo never touches the redline and vice versa. Cross-deliverable consistency is a verify check, not an edit-time lock.
- The redline writer is single-threaded and applies patches in document order so revision ids and paragraph anchors stay stable.

### Budgets and cancellation

- Per-run budget in tokens and cost, set in mode defaults and shown before Run. The scheduler stops issuing new model calls when 90% is spent and finishes the current round in code-only mode.
- The abort signal from the job stream propagates to every worker and every in-flight gateway call. Partial results are kept in the ledger and marked `cancelled` in the manifest.
- Every model call has its own timeout. A timed-out clause review is retried once, then recorded as `unreviewed` and listed in the coverage check.

---

## 11. What the model is told about the harness

The model never sees the pipeline code. It sees a fixed **harness preamble**, a **stage card**, and the **payload** for that call. This is the same layering as harvey-labs (a shared `system_prompt.md`, then skill manuals, then the task), adapted so the model knows what the code will check afterwards.

### Harness preamble, identical for every call in a run

```
You are the drafting and review engine inside Agentforge Legal, working for a law firm on one matter.
You do not act alone. Code around you extracts the documents, finds unmarked changes, applies your
proposals to the documents, and checks your output. Your work is discarded if it fails those checks.

MATTER
  Client: Meridian Industrial Holdings (the "Borrower"). Counterparty: the Lenders.
  Work type: review. Deliverables: issues memorandum (docx), redline (docx), deviation report (xlsx).
  Author of record for the deliverables: Samuel Roth, Senior Associate. Addressee: Priya Chakravarti, Partner.

DOCUMENTS (cite by id; you receive full text only for what a stage gives you)
  S1  counterparty-draft   credit-agreement-draft-v3-lender-turn.docx   214 ¶, 38 defined terms
  S2  executed             executed-term-sheet.docx                     41 ¶
  S3  executed             commitment-letter.docx                       27 ¶
  S4  instruction          re-no-flex-confirmation.eml                  D. Rennick → S. Roth, 3 Mar 2026
  S5  figures              covenant-model-q2.xlsx                       3 sheets; cite cells as S5 Cov!B7
  S7  instruction          partner-notes-on-baskets.eml                 P. Chakravarti, 3 Mar 2026
  PB  playbook             Credit agreements, borrower side v3          22 required provisions, 14 fallbacks
  S9  context (skipped)    lender-presentation-march.pptx               image-only slides, no text

SOURCE PRIORITY when documents conflict: S2, S3 > S4, S7 > S1 > context.

RULES ENFORCED BY CODE AFTER YOU ANSWER
  1. Every quotation must appear verbatim in the cited document. Paraphrase inside quotation marks is rejected.
  2. Every figure must be cited by reference (S5 Cov!B7) or by a named computation. Free numbers are marked unverified.
  3. Every finding must cite at least one document id and paragraph anchor (S2 ¶41).
  4. Section references must exist in S1 after your proposals are applied.
  5. Where an instruction reserves a point, propose no language for it.
  6. Output must validate against the JSON schema for this stage. Invalid output is retried once, then dropped.

LANGUAGE
  Formal legal register. Refer to parties by their defined terms. No first person outside the memorandum's
  own voice. State what the documents show; do not speculate about intent beyond the text. No advice to
  the client; the deliverables are draft work product for review by a qualified lawyer.
```

The preamble is generated by code from the ledger, so it is always in sync with the actual documents and roles. It is cached across calls in the run (prompt caching on providers that support it, which is why it is byte-identical for every call).

### Stage card, one per stage

Tells the model where it is, what came before, what its output feeds, and what it must not do here.

```
STAGE 4 of 9 — REVIEW, clause §7.2(b) of S1
Before this: code compared S1 with the Borrower's prior turn and found 14 unmarked changes; none in this clause.
Your output feeds: the issues memorandum, the redline, and the deviation report. Code applies proposedText
to S1 as a tracked change in the author's name, with your basis as the margin comment.
Do not: review other clauses here; summarise the document; propose language for reserved points.
Return: one Finding object (schema below) or {"kind":"ok"} if the clause is acceptable as drafted.
```

For stage 5 the card carries the deliverable's format manual, the equivalent of harvey-labs skill files: memo structure the firm uses, redline conventions, deviation report columns. These manuals live in the Knowledge Base as `Manual` sources so the firm can edit them without a release.

For stage 6b the verifier receives the same preamble plus a card that says it is the verifier, the checklist chunk, and the deliverable text. It is not shown the drafting model's reasoning, only the output, so it grades what the lawyer would see.

### Payload

Only what the stage needs, retrieved rather than dumped:

- Stage 2: file list with the first 600 characters of each.
- Stage 4: the clause text with defined terms resolved inline, the matching playbook entry, the top five retrieved passages from executed and instruction documents with their anchors, the unmarked-change record for this clause, the mapped checklist items.
- Stage 5: the full findings list as JSON, the deliverable manual, party and date facts extracted in code.
- Stage 6b: one deliverable's text and one checklist chunk.
- Stage 7: the failing check, the current text of the affected section only, and the finding it came from.

Full document text is never sent wholesale. The 400k-character matter budget is for retrieval indexing, not for prompts.

### Harness manifest for tooling

The same facts are written as `manifest.json` in the matter row so the verifier, the eval runner and any later agent see one contract:

```json
{
  "harness": "agentforge-legal/1",
  "stages": ["ingest","classify","diff","review","draft","verify","edit","package","handoff"],
  "checks": ["quotes-verbatim","numbers-traced","xrefs-resolve","defined-terms","facts-match","instructions-obeyed","docx-valid","coverage"],
  "schemas": { "Finding": "…", "MemoOutline": "…", "VerifyReport": "…" },
  "rounds": { "max": 3, "completed": 2 }
}
```

---

## 12. Language and register

Applies to prompts, UI copy, and generated text.

- Formal legal register throughout. Parties by defined term, provisions by section number, documents by id and title.
- UI labels: "Adverse provisions", "Missing provisions", "Unmarked changes", "Requires partner decision". Not "attacking us", "hurts us", "your call".
- Findings state what the document provides and why it is adverse to the client's position. They do not characterise the counterparty's motives.
- Proposed language is drafted as it would appear in the agreement, with defined-term capitalisation and cross-references in the document's own style.
- Every deliverable carries the line: "Draft work product prepared with automated assistance for review by a qualified lawyer." No text addressed to the client leaves without a human reviewer recorded in the manifest.
- Prompts forbid hedging filler, exclamation, and colloquial phrasing, and require British or American spelling per the firm's setting.
- Verification report and audit trail use plain declarative sentences: what was checked, what passed, what failed, what was skipped and why.

---

## Security and privacy

- Files never leave the machine except as text inside gateway calls. No `bash`, no shell, no container. All parsing in a worker thread with timeouts and memory caps, so a crafted docx can only kill the worker.
- Injection guard on every document passage, every email body, every playbook entry and the instructions box.
- PII masking (`maskPii`, exists) is off by default for legal because names are the work product, but the toggle stays in Settings.
- The matter manifest records model ids and gateway account for the audit trail. No document text goes into logs.

---

## What is reused and what is new

| Reused as is | Extended | New |
|---|---|---|
| job SSE, `streamJob`, job-progress UI | `job-events.ts` gains `job.round` | docx reader/writer with tracked changes and comments (`packages/core/src/docx/`) |
| `artifacts` table and routes | `ArtifactMode` gains `legal`; binary bodies | pptx text, eml parser, pdf text layer |
| tabular parser, xlsx read | xlsx write for reports | paragraph diff and silent-change detector |
| number guard, injection guard, PII | | clause splitter, checklist mapper, missing-clause pass |
| KB embed and retrieval | KB source types `Playbook`, `Precedent`, `Memo` | verify engine (6a) and edit loop (7) |
| dossier verbatim-quote check | | Legal studio (3 screens), matter map, findings table |
| `docx` package for rendering | templates from KB | pluggable mode registry so `packages/legal` owns this mode |

---

## Build order

1. Mode registry: packs can register a product mode, its host pipeline and its studio. Legal is the first pluggable mode.
2. Ingest: docx reader with revisions, eml, pptx, pdf text. Tests against harvey-labs task folders as fixtures.
3. Stages 2 to 4 with the findings table streaming. No deliverables yet, Markdown red-flags output only. This is already useful.
4. Draft and render: memo docx with tables, deviation xlsx.
5. Verify 6a and the edit loop. Then 6b.
6. Redline writer with tracked changes and comments.
7. Eval: run harvey-labs `review` and `analyze` tasks through the pipeline, grade with their evaluator, compare gateway models.
