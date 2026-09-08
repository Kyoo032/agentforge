import {
  applyRedline,
  diffDocuments,
  documentText,
  splitClauses,
  validateDocx,
  type DocxClause,
  type DocxDocument,
  type ParagraphChange,
} from "@agentforge/core/docx";
import type { JobEmitter } from "@agentforge/core/jobs";
import {
  DELIVERABLE_MANUALS,
  LEGAL_CAPS,
  appendRound,
  applyFindingEdits,
  buildPreamble,
  buildStageCard,
  checklistVerifyResponseSchema,
  classifyResponseSchema,
  createLedger,
  findingEditResponseSchema,
  interactionResponseSchema,
  mapChecklistToClauses,
  memoOutlineSchema,
  missingConfirmSchema,
  opposingCounselResponseSchema,
  parseModelJson,
  reviewResponseSchema,
  runCodeChecks,
  verifyOk,
  type ChecklistItem,
  type ChecklistVerdict,
  type Concession,
  type DeliverableKind,
  type EditPatch,
  type Finding,
  type LegalManifest,
  type MatterDocCard,
  type Playbook,
  type RoundRecord,
  type DocRole,
  type StageCardInput,
  type VerifyReport,
} from "@agentforge/core/legal";
import type { z } from "zod";
import { throwIfJobAborted } from "../job-stream";
import { renderDeviationXlsx } from "./render-deviation";
import { renderMemoDocx } from "./render-memo";
import { renderRedFlagsMarkdown } from "./render-redflags";
import { buildRedlinePatches } from "./render-redline";
import type { LegalMatterRecord } from "./records";
import {
  applyReserved,
  allowedNumbers,
  autoFixInstructionFindings,
  cardByRole,
  citedDocIds,
  createIdAllocator,
  draftsFromReview,
  emptyPacked,
  emitPhase,
  emitStep,
  fallbackMemo,
  findingFromDraft,
  FILENAME,
  MIME,
  missingFinding,
  pickRelatedClause,
  scanReserved,
  unmarkedFinding,
  type PackedDeliverable,
  type ReservedInstruction,
  type ReviewParsed,
} from "./instructions";

export type LegalRunInput = {
  matter: LegalMatterRecord;
  docs: ReadonlyMap<string, DocxDocument>;
  bytes: ReadonlyMap<string, Uint8Array>;
  playbook: Playbook | null;
  models: { drafting: string; verifier: string };
  maxRounds: number;
  runId: string;
  now: () => Date;
};

export type LegalRunDeps = {
  ask: (args: { model: string; system: string; prompt: string }) => Promise<string>;
  emit: JobEmitter;
  abortSignal?: AbortSignal;
  concurrency?: number;
};

export type LegalRunResult = {
  manifest: LegalManifest;
  findings: Finding[];
  verify: VerifyReport;
  deliverables: { kind: DeliverableKind; filename: string; mime: string; bytes: Uint8Array; text: string }[];
  rounds: RoundRecord[];
};

type Packed = PackedDeliverable;

type RunCtx = {
  input: LegalRunInput;
  deps: LegalRunDeps;
  system: string;
  cards: MatterDocCard[];
  concurrency: number;
  maxRounds: number;
};

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function abort(ctx: RunCtx): void {
  throwIfJobAborted(ctx.deps.abortSignal);
}

async function askJson<S extends z.ZodTypeAny>(
  ctx: RunCtx,
  model: string,
  stage: StageCardInput,
  payload: unknown,
  schema: S,
): Promise<z.infer<S> | null> {
  const prompt = `${buildStageCard(stage)}\n\n${JSON.stringify(payload)}`;
  const tryOnce = async (): Promise<z.infer<S> | null> => {
    abort(ctx);
    const raw = await ctx.deps.ask({ model, system: ctx.system, prompt });
    const json = parseModelJson(raw);
    if (json === null) {
      return null;
    }
    const parsed = schema.safeParse(json);
    return parsed.success ? parsed.data : null;
  };
  const first = await tryOnce();
  if (first !== null) {
    return first;
  }
  const retry = await tryOnce();
  if (retry !== null) {
    return retry;
  }
  emitStep(ctx.deps.emit, stage.stage.split("-")[0] ?? stage.stage, "Dropped invalid model output after retry");
  return null;
}

async function classify(ctx: RunCtx): Promise<MatterDocCard[]> {
  emitPhase(ctx.deps.emit, "classify");
  abort(ctx);
  const pending = ctx.cards.filter((card) => card.role === "context");
  let proposed = new Map<string, DocRole>();
  if (pending.length > 0) {
    const parsed = await askJson(
      ctx,
      ctx.input.models.drafting,
      { stage: "classify", fileCount: ctx.cards.length },
      {
        docs: ctx.cards.map((card) => ({ id: card.id, name: card.name, preview: card.preview })),
      },
      classifyResponseSchema,
    );
    proposed = new Map((parsed?.docs ?? []).map((entry) => [entry.id, entry.role]));
  }
  const cards = ctx.cards.map((card) => {
    if (card.role !== "context") {
      return card;
    }
    const role = proposed.get(card.id);
    return role ? { ...card, role } : card;
  });
  for (const card of cards) {
    emitStep(ctx.deps.emit, "classify", `${card.id} ${card.role}`, { detail: card.name });
  }
  return cards;
}

async function diffStage(ctx: RunCtx, ids: { next: () => string }, findings: Finding[]): Promise<ParagraphChange[]> {
  emitPhase(ctx.deps.emit, "diff");
  abort(ctx);
  const prior = cardByRole(ctx.cards, "prior-turn");
  const draftCard = cardByRole(ctx.cards, "counterparty-draft");
  const priorDoc = prior ? ctx.input.docs.get(prior.id) : undefined;
  const draftDoc = draftCard ? ctx.input.docs.get(draftCard.id) : undefined;
  if (!prior || !draftCard || !priorDoc || !draftDoc) {
    emitStep(ctx.deps.emit, "diff", "No prior turn to compare");
    return [];
  }
  const diff = diffDocuments(priorDoc, draftDoc);
  for (const change of diff.unmarked) {
    findings.push(unmarkedFinding(change, ids.next(), 1, draftDoc));
  }
  emitStep(ctx.deps.emit, "diff", `${diff.unmarked.length} unmarked changes`, { detail: String(diff.unmarked.length) });
  return [...diff.unmarked];
}

async function reviewStage(
  ctx: RunCtx,
  clauses: readonly DocxClause[],
  mapping: ReturnType<typeof mapChecklistToClauses> | null,
  unmarked: readonly ParagraphChange[],
  draft: DocxDocument | null,
  ids: { next: () => string },
): Promise<Finding[]> {
  emitPhase(ctx.deps.emit, "review");
  abort(ctx);
  for (const card of ctx.cards.filter((card) => card.status === "read")) {
    ctx.deps.emit({ type: "job.source", id: card.id, title: card.name, url: card.path, status: "read" });
  }
  if (clauses.length === 0) {
    emitStep(ctx.deps.emit, "review", "No clauses to review");
    return [];
  }
  const playbook = ctx.input.playbook;
  const drafts = await mapWithConcurrency(clauses, ctx.concurrency, async (clause, index) => {
    abort(ctx);
    const items: ChecklistItem[] =
      playbook && mapping
        ? playbook.items.filter((item) =>
            mapping.mapped.some((row) => row.itemId === item.id && row.clauseId === clause.id),
          )
        : [];
    const clauseUnmarked = unmarked.filter((change) => change.clause === clause.id);
    const parsed = await askJson(
      ctx,
      ctx.input.models.drafting,
      { stage: "review", clauseId: clause.id, unmarkedChanges: clauseUnmarked.length, checklistItems: items },
      {
        clauseId: clause.id,
        text: clause.text,
        heading: clause.heading,
        checklistItems: items,
        unmarked: clauseUnmarked,
      },
      reviewResponseSchema,
    );
    emitStep(ctx.deps.emit, "review", clause.id, { current: index + 1, total: clauses.length });
    return parsed ? draftsFromReview(parsed as ReviewParsed) : [];
  });
  return drafts.flat().map((draftFinding) => findingFromDraft(draftFinding, ids.next(), 1, draft));
}

async function missingStage(
  ctx: RunCtx,
  mapping: ReturnType<typeof mapChecklistToClauses> | null,
  ids: { next: () => string },
): Promise<Finding[]> {
  emitPhase(ctx.deps.emit, "missing");
  abort(ctx);
  const playbook = ctx.input.playbook;
  if (!playbook || !mapping || mapping.unmapped.length === 0) {
    emitStep(ctx.deps.emit, "missing", playbook ? "All checklist items mapped" : "No playbook");
    return [];
  }
  const out: Finding[] = [];
  for (const itemId of mapping.unmapped) {
    abort(ctx);
    const item = playbook.items.find((entry) => entry.id === itemId);
    if (!item) {
      continue;
    }
    const parsed = await askJson(
      ctx,
      ctx.input.models.drafting,
      { stage: "missing", item },
      { item },
      missingConfirmSchema,
    );
    emitStep(ctx.deps.emit, "missing", item.title, { detail: item.id });
    if (parsed?.absent !== false) {
      out.push(missingFinding(item, ids.next(), 1));
    }
  }
  return out;
}

async function interactionStage(
  ctx: RunCtx,
  findings: readonly Finding[],
  clauses: readonly DocxClause[],
  draft: DocxDocument | null,
  ids: { next: () => string },
): Promise<Finding[]> {
  emitPhase(ctx.deps.emit, "interactions");
  abort(ctx);
  const high = findings.filter((finding) => finding.severity === "high").slice(0, LEGAL_CAPS.maxInteractions);
  if (high.length === 0) {
    emitStep(ctx.deps.emit, "interactions", "No high-severity findings");
    return [];
  }
  const out: Finding[] = [];
  for (const finding of high) {
    abort(ctx);
    const related = pickRelatedClause(finding, clauses);
    emitStep(ctx.deps.emit, "interactions", finding.title, { detail: finding.clause });
    if (!related) {
      continue;
    }
    const parsed = await askJson(
      ctx,
      ctx.input.models.drafting,
      { stage: "interaction", findingTitle: finding.title, clauseId: related.id },
      { finding, clauseId: related.id, text: related.text },
      interactionResponseSchema,
    );
    if (!parsed?.compounds) {
      continue;
    }
    const draftFinding = findingFromDraft(
      {
        kind: "interaction",
        clause: parsed.clause || related.id,
        quote: parsed.quote,
        title: `Interaction with ${finding.title}`,
        why: parsed.why,
        severity: parsed.severity,
        negotiability: "fallback",
        proposedText: null,
        basis: [...finding.basis],
        reservedFor: null,
        checklist: [...finding.checklist],
      },
      ids.next(),
      1,
      draft,
    );
    out.push(draftFinding);
  }
  return out;
}

async function draftMemo(
  ctx: RunCtx,
  kind: DeliverableKind,
  findings: readonly Finding[],
  dateIso: string,
): Promise<Packed> {
  const parsed = await askJson(
    ctx,
    ctx.input.models.drafting,
    { stage: "draft", deliverable: kind, manual: DELIVERABLE_MANUALS[kind] },
    { findings, facts: { author: ctx.input.matter.author, addressee: ctx.input.matter.addressee, dateIso } },
    memoOutlineSchema,
  );
  const outline = parsed ?? fallbackMemo(ctx.input.matter, dateIso, findings);
  const rendered = await renderMemoDocx({
    outline,
    findings,
    side: ctx.input.matter.side,
    firm: ctx.input.matter.firm,
  });
  return {
    kind,
    filename: FILENAME[kind],
    mime: MIME.docx,
    bytes: rendered.bytes,
    text: rendered.text,
    outline,
    redline: null,
  };
}

async function draftRedline(
  ctx: RunCtx,
  findings: readonly Finding[],
  draft: DocxDocument,
  clauses: readonly DocxClause[],
): Promise<Packed> {
  const draftCard = cardByRole(ctx.cards, "counterparty-draft");
  const original = draftCard ? ctx.input.bytes.get(draftCard.id) : undefined;
  if (!original) {
    emitStep(ctx.deps.emit, "draft", "No original bytes for redline");
    return emptyPacked("redline");
  }
  const { patches, inserts } = buildRedlinePatches(findings, draft, clauses);
  const result = await applyRedline(original, patches, inserts, {
    author: ctx.input.matter.author || "Agentforge Legal",
    date: ctx.input.now().toISOString(),
  });
  const validation = await validateDocx(result.bytes);
  return {
    kind: "redline",
    filename: FILENAME.redline,
    mime: MIME.docx,
    bytes: result.bytes,
    text: "",
    outline: null,
    redline: { validation, failed: result.failed.length },
  };
}

async function draftOne(
  ctx: RunCtx,
  kind: DeliverableKind,
  findings: readonly Finding[],
  draft: DocxDocument | null,
  clauses: readonly DocxClause[],
  dateIso: string,
  verify: VerifyReport | null,
): Promise<Packed> {
  emitStep(ctx.deps.emit, "draft", kind);
  if (kind === "issues-memo" || kind === "executive-summary") {
    return draftMemo(ctx, kind, findings, dateIso);
  }
  if (kind === "redline") {
    if (!draft) {
      return emptyPacked(kind);
    }
    return draftRedline(ctx, findings, draft, clauses);
  }
  if (kind === "deviation-report") {
    const bytes = renderDeviationXlsx({ findings, side: ctx.input.matter.side, matterTitle: ctx.input.matter.title });
    return { kind, filename: FILENAME[kind], mime: MIME.xlsx, bytes, text: "", outline: null, redline: null };
  }
  const text = renderRedFlagsMarkdown({
    findings,
    side: ctx.input.matter.side,
    matterTitle: ctx.input.matter.title,
    verify,
  });
  return {
    kind,
    filename: FILENAME[kind],
    mime: MIME.md,
    bytes: new TextEncoder().encode(text),
    text,
    outline: null,
    redline: null,
  };
}

async function draftStage(
  ctx: RunCtx,
  kinds: readonly DeliverableKind[],
  findings: readonly Finding[],
  draft: DocxDocument | null,
  clauses: readonly DocxClause[],
  dateIso: string,
  verify: VerifyReport | null,
  announce: boolean,
): Promise<Packed[]> {
  if (announce) {
    emitPhase(ctx.deps.emit, "draft");
  }
  abort(ctx);
  const out: Packed[] = [];
  for (const kind of kinds) {
    abort(ctx);
    out.push(await draftOne(ctx, kind, findings, draft, clauses, dateIso, verify));
  }
  return out;
}

async function modelVerify(
  ctx: RunCtx,
  packed: Packed[],
  playbook: Playbook | null,
): Promise<{ checklist: ChecklistVerdict[]; concessions: Concession[] }> {
  const target = packed.find((item) => item.kind === "issues-memo") ?? packed.find((item) => item.text !== "");
  if (!target || target.text === "") {
    return { checklist: [], concessions: [] };
  }
  const checklist: ChecklistVerdict[] = [];
  const items = playbook?.items ?? [];
  for (let offset = 0; offset < items.length; offset += LEGAL_CAPS.checklistChunk) {
    abort(ctx);
    const chunk = items.slice(offset, offset + LEGAL_CAPS.checklistChunk);
    const parsed = await askJson(
      ctx,
      ctx.input.models.verifier,
      { stage: "verify-checklist", deliverable: target.kind, itemCount: chunk.length },
      { text: target.text, items: chunk },
      checklistVerifyResponseSchema,
    );
    for (const verdict of parsed?.verdicts ?? []) {
      checklist.push({ itemId: verdict.itemId, deliverable: target.kind, pass: verdict.pass, reason: verdict.reason });
    }
  }
  abort(ctx);
  const opposing = await askJson(
    ctx,
    ctx.input.models.verifier,
    { stage: "verify-opposing", deliverable: target.kind },
    { text: target.text },
    opposingCounselResponseSchema,
  );
  return { checklist, concessions: opposing?.concessions ?? [] };
}

async function verifyStage(
  ctx: RunCtx,
  round: number,
  findings: readonly Finding[],
  packed: Packed[],
  clauses: readonly DocxClause[],
  reserved: readonly ReservedInstruction[],
): Promise<VerifyReport> {
  emitPhase(ctx.deps.emit, "verify");
  abort(ctx);
  ctx.deps.emit({ type: "job.round", round, total: ctx.maxRounds, label: `Round ${round} of ${ctx.maxRounds}` });
  const memo = packed.find((item) => item.kind === "issues-memo");
  const redline = packed.find((item) => item.kind === "redline");
  const draftCard = cardByRole(ctx.cards, "counterparty-draft");
  const checks = runCodeChecks({
    findings,
    docs: ctx.input.docs,
    counterpartyDocId: draftCard?.id ?? "",
    clauses,
    memo: memo?.outline ?? null,
    memoText: memo?.text ?? null,
    allowedNumbers: allowedNumbers(ctx.input.docs),
    facts: {
      parties: [ctx.input.matter.side.party, ctx.input.matter.side.counterparty],
      addressee: ctx.input.matter.addressee,
      author: ctx.input.matter.author,
      dateIso: ctx.input.now().toISOString().slice(0, 10),
    },
    instructions: reserved.map((entry) => ({ reservedClause: entry.reservedClause, by: entry.by })),
    redline: redline?.redline ?? null,
    readDocIds: ctx.cards.filter((card) => card.status === "read").map((card) => card.id),
    citedDocIds: citedDocIds(findings),
    skipped: ctx.cards
      .filter((card) => card.status === "skipped")
      .map((card) => ({ doc: card.id, reason: card.skipReason ?? "skipped" })),
  });
  for (const check of checks) {
    emitStep(ctx.deps.emit, "verify", check.code, { detail: `${check.passed} passed, ${check.failed} failed` });
  }
  const model = await modelVerify(ctx, packed, ctx.input.playbook);
  const openForHuman = [
    ...findings
      .filter((finding) => finding.reservedFor !== null)
      .map((finding) => ({ clause: finding.clause, detail: `Reserved for ${finding.reservedFor}` })),
    ...model.concessions
      .filter((item) => item.disposition === "market")
      .map((item) => ({ clause: item.clause, detail: item.detail })),
  ];
  const ok =
    verifyOk(checks) &&
    model.checklist.every((verdict) => verdict.pass) &&
    model.concessions.every((item) => item.disposition !== "fix");
  return {
    round,
    codeChecks: checks,
    checklist: model.checklist,
    concessions: model.concessions,
    documentsSkipped: ctx.cards
      .filter((card) => card.status === "skipped")
      .map((card) => ({ doc: card.id, reason: card.skipReason ?? "skipped" })),
    openForHuman,
    ok,
  };
}

async function editStage(
  ctx: RunCtx,
  round: number,
  findings: readonly Finding[],
  verify: VerifyReport,
  reserved: readonly ReservedInstruction[],
): Promise<{ findings: readonly Finding[]; patches: EditPatch[]; touched: DeliverableKind[] }> {
  emitPhase(ctx.deps.emit, "edit");
  abort(ctx);
  const failures = verify.codeChecks.flatMap((check) => (check.code === "coverage" ? [] : [...check.failures]));
  const auto = autoFixInstructionFindings(findings, failures, reserved, round, ctx.input.matter.author);
  for (const patch of auto.patches) {
    emitStep(ctx.deps.emit, "edit", `${patch.reason} ${patch.target.ref}`, { detail: "code" });
  }
  let next = auto.findings;
  const modelPatches: EditPatch[] = [...auto.patches];
  const remaining = failures.filter((failure) => !failure.autoFixable);
  const checklistFails = verify.checklist.filter((verdict) => !verdict.pass);
  const concessionFails = verify.concessions.filter((item) => item.disposition === "fix");
  for (const failure of remaining) {
    abort(ctx);
    const current = next.find((finding) => finding.id === failure.target);
    const parsed = await askJson(
      ctx,
      ctx.input.models.drafting,
      { stage: "edit", target: failure.target, failure: failure.detail },
      { failure, current },
      findingEditResponseSchema,
    );
    if (!parsed) {
      continue;
    }
    const patch: EditPatch = {
      round,
      target: {
        deliverable: failure.deliverable === "findings" ? "findings" : failure.deliverable,
        ref: failure.target,
      },
      reason: failure.code,
      replacement: parsed,
      appliedBy: "model",
    };
    modelPatches.push(patch);
    emitStep(ctx.deps.emit, "edit", `${failure.target}`, { detail: failure.code });
  }
  for (const verdict of checklistFails) {
    abort(ctx);
    const parsed = await askJson(
      ctx,
      ctx.input.models.drafting,
      { stage: "edit", target: verdict.itemId, failure: verdict.reason },
      { verdict },
      findingEditResponseSchema,
    );
    if (parsed) {
      const patch: EditPatch = {
        round,
        target: { deliverable: "findings", ref: verdict.itemId },
        reason: "checklist",
        replacement: parsed,
        appliedBy: "model",
      };
      modelPatches.push(patch);
      emitStep(ctx.deps.emit, "edit", verdict.itemId, { detail: "checklist" });
    }
  }
  for (const concession of concessionFails) {
    abort(ctx);
    const parsed = await askJson(
      ctx,
      ctx.input.models.drafting,
      { stage: "edit", target: concession.clause, failure: concession.detail },
      { concession },
      findingEditResponseSchema,
    );
    if (parsed) {
      modelPatches.push({
        round,
        target: { deliverable: "findings", ref: concession.clause },
        reason: "concession",
        replacement: parsed,
        appliedBy: "model",
      });
      emitStep(ctx.deps.emit, "edit", concession.clause, { detail: "concession" });
    }
  }
  next = applyFindingEdits(
    next,
    modelPatches.filter((patch) => patch.appliedBy === "model"),
  ).findings;
  const touched = new Set<DeliverableKind>(ctx.input.matter.deliverables);
  if (
    auto.patches.length === 0 &&
    remaining.every((failure) => failure.deliverable === "issues-memo") &&
    checklistFails.length === 0
  ) {
    touched.clear();
    touched.add("issues-memo");
  }
  return { findings: next, patches: modelPatches, touched: [...touched] };
}

function preambleArgs(ctx: RunCtx) {
  return {
    side: ctx.input.matter.side,
    workType: ctx.input.matter.workType,
    deliverables: ctx.input.matter.deliverables,
    author: ctx.input.matter.author,
    addressee: ctx.input.matter.addressee,
    firm: ctx.input.matter.firm,
    docs: ctx.cards,
    playbook: ctx.input.playbook,
    priorityNote: "",
  };
}

function toManifest(
  ctx: RunCtx,
  findings: readonly Finding[],
  rounds: readonly RoundRecord[],
  status: LegalManifest["status"],
): LegalManifest {
  return {
    harness: "agentforge-legal/1",
    matterId: ctx.input.matter.id,
    createdAt: ctx.input.now().toISOString(),
    side: ctx.input.matter.side,
    workType: ctx.input.matter.workType,
    deliverables: ctx.input.matter.deliverables,
    playbookId: ctx.input.playbook?.id ?? ctx.input.matter.playbookId,
    docs: ctx.cards,
    models: ctx.input.models,
    rounds,
    maxRounds: ctx.maxRounds,
    findingsCount: findings.length,
    status,
  };
}

export async function runLegalMatter(input: LegalRunInput, deps: LegalRunDeps): Promise<LegalRunResult> {
  const maxRounds = Math.max(1, input.maxRounds);
  const ctx: RunCtx = {
    input,
    deps,
    system: "",
    cards: input.matter.docs.map((card) => ({ ...card })),
    concurrency: deps.concurrency ?? LEGAL_CAPS.reviewConcurrency,
    maxRounds,
  };
  abort(ctx);
  ctx.system = buildPreamble(preambleArgs(ctx));
  const ids = createIdAllocator();
  ctx.cards = await classify(ctx);
  ctx.system = buildPreamble(preambleArgs(ctx));
  const findings: Finding[] = [];
  const unmarked = await diffStage(ctx, ids, findings);
  const draftCard = cardByRole(ctx.cards, "counterparty-draft");
  const draft = draftCard ? (input.docs.get(draftCard.id) ?? null) : null;
  const clauses = draft ? splitClauses(draft) : [];
  const mapping = input.playbook ? mapChecklistToClauses(input.playbook, clauses) : null;
  findings.push(...(await reviewStage(ctx, clauses, mapping, unmarked, draft, ids)));
  findings.push(...(await missingStage(ctx, mapping, ids)));
  findings.push(...(await interactionStage(ctx, findings, clauses, draft, ids)));
  const instructionSources = [
    { text: input.matter.instructions, by: input.matter.author || "instructing author" },
    ...ctx.cards
      .filter((card) => card.role === "instruction")
      .map((card) => {
        const doc = input.docs.get(card.id);
        return { text: doc ? documentText(doc) : card.preview, by: input.matter.author || card.name };
      }),
  ];
  const reserved = scanReserved(instructionSources);
  let working = applyReserved(findings, reserved);
  const dateIso = input.now().toISOString().slice(0, 10);
  let packed = await draftStage(ctx, input.matter.deliverables, working, draft, clauses, dateIso, null, true);
  let ledger = createLedger(ctx.cards, working);
  let verify = await verifyStage(ctx, 1, working, packed, clauses, reserved);
  ledger = appendRound(ledger, { round: 1, verify, edits: [] });
  for (let round = 1; !verify.ok && round < maxRounds; round += 1) {
    const edited = await editStage(ctx, round, working, verify, reserved);
    working = applyReserved(edited.findings, reserved);
    const redrawn = await draftStage(ctx, edited.touched, working, draft, clauses, dateIso, verify, true);
    const overlay = new Map(packed.map((item) => [item.kind, item] as const));
    for (const item of redrawn) {
      overlay.set(item.kind, item);
    }
    packed = [...overlay.values()];
    const nextRound = round + 1;
    verify = await verifyStage(ctx, nextRound, working, packed, clauses, reserved);
    ledger = appendRound(ledger, { round: nextRound, verify, edits: edited.patches });
  }
  if (input.matter.deliverables.includes("red-flags")) {
    const text = renderRedFlagsMarkdown({
      findings: working,
      side: input.matter.side,
      matterTitle: input.matter.title,
      verify,
    });
    packed = packed.map((item) =>
      item.kind === "red-flags" ? { ...item, text, bytes: new TextEncoder().encode(text) } : item,
    );
  }
  emitPhase(deps.emit, "package");
  const deliverables = input.matter.deliverables.map((kind) => {
    const item = packed.find((entry) => entry.kind === kind) ?? emptyPacked(kind);
    emitStep(deps.emit, "package", kind);
    return { kind: item.kind, filename: item.filename, mime: item.mime, bytes: item.bytes, text: item.text };
  });
  const status: LegalManifest["status"] = verify.ok ? "complete" : "complete-with-failures";
  return {
    manifest: toManifest(ctx, working, ledger.rounds, status),
    findings: [...working],
    verify,
    deliverables,
    rounds: [...ledger.rounds],
  };
}
