import { maskPii, scanInjection, type TenantContext } from "@agentforge/core";
import {
  findSourceByOrigin,
  indexKnowledgeSource,
  markSourceFailed,
  type KnowledgeSource,
} from "./knowledge";
import { loadSettings } from "./settings-store";
import { renderWorkCard, type WorkCard } from "./work-cards";
import { log } from "./log";

export type UpsertWorkSourceResult =
  | { status: "indexed" | "failed"; source: KnowledgeSource; created: boolean }
  | { status: "skipped"; reason: string };

/**
 * Index (or re-index) the work card for one piece of finished work.
 *
 * - Idempotent on `(workspace, origin.kind, origin.id)`: the same thread / media / artifact
 *   always maps to one source row; a re-run rewrites it instead of adding a duplicate.
 * - Never throws. An index error leaves the source row `Failed` with the reason; the work
 *   that produced the card already succeeded and must stay that way.
 * - Empty cards are skipped without a row.
 */
export async function upsertWorkSource(tenant: TenantContext, card: WorkCard): Promise<UpsertWorkSourceResult> {
  // A thread title is derived from the first user message, so a title that trips the guard would keep
  // every later (clean) card of that thread blocked. The title is replaced; only body + prompt decide.
  const bypass = injectionGuardBypass(tenant);
  const titleHit = bypass ? null : scanInjection(card.title);
  const safeCard = titleHit ? { ...card, title: card.type } : card;
  // Knowledge chunks are plaintext (FTS) while chat messages are sealed at rest, so the card gets the
  // same PII masking the outbound prompt gets. Title too: it is shown in the Sources list.
  //
  // Field by field, never over the rendered card. `Pointer: artifact:<uuid>` is host-generated, and a
  // UUID whose middle groups are all digits matches the intl phone pattern — `b73b2194-8471-4712-…`
  // was indexed as `b73b[phone]-…`, so the retrieved copy of the card could not name its own
  // artifact while the database row was fine. Only the owner's own words are masked now.
  const maskedCard: WorkCard = {
    ...safeCard,
    title: maskPii(safeCard.title),
    prompt: safeCard.prompt === undefined ? undefined : maskPii(safeCard.prompt),
    body: maskPii(safeCard.body),
  };
  const text = renderWorkCard(maskedCard);
  if (!text.trim()) {
    return { status: "skipped", reason: "empty" };
  }
  let existing: KnowledgeSource | null = null;
  try {
    existing = findSourceByOrigin(tenant, card.origin);
  } catch (error) {
    log.warn("knowledge_ingest_origin_lookup_failed", { code: errorCode(error) });
    return { status: "skipped", reason: "lookup_failed" };
  }
  const id = existing?.id ?? crypto.randomUUID();
  // The name is rewritten on every upsert, not only on create: a card's subject can be renamed
  // (a Chat thread that gets a real title after turn 1) and the Sources list, the `[n] <name>`
  // citation marker and the indexed `# <title>` line all have to follow it.
  const input = { id, name: maskedCard.title, type: card.type, origin: card.origin };
  // A card that carries injection text would be retrieved into every later Chat as a trusted source.
  // Same guard and owner bypass as attachments / source material; the work itself already succeeded.
  const hit = bypass ? null : (scanInjection(card.body) ?? scanInjection(card.prompt ?? ""));
  if (hit) {
    const reason = `injection_blocked (rule: ${hit.rule})`;
    try {
      return { status: "failed", source: markSourceFailed(tenant, input, reason), created: !existing };
    } catch (error) {
      log.warn("knowledge_ingest_blocked_card_not_recorded", { code: errorCode(error) });
      return { status: "skipped", reason };
    }
  }
  try {
    const source = await indexKnowledgeSource(tenant, { ...input, text });
    return { status: source.status === "Indexed" ? "indexed" : "failed", source, created: !existing };
  } catch (error) {
    const reason = errorCode(error);
    log.warn("knowledge_ingest_card_failed", { cardType: card.type, pointer: card.pointer, reason });
    try {
      return { status: "failed", source: markSourceFailed(tenant, input, reason), created: !existing };
    } catch (inner) {
      log.warn("knowledge_ingest_failure_not_recorded", { code: errorCode(inner) });
      return { status: "skipped", reason };
    }
  }
}

/** Fire-and-forget variant for hot paths (Chat stream end). Logs, never rejects. */
export function ingestWorkSource(tenant: TenantContext, card: WorkCard): void {
  void upsertWorkSource(tenant, card).catch((error: unknown) => {
    log.warn("knowledge_ingest_unexpected", { code: errorCode(error) });
  });
}

function injectionGuardBypass(tenant: TenantContext): boolean {
  try {
    return loadSettings(tenant.workspaceId).injectionGuardBypass === true;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return error instanceof Error && error.message ? error.message.slice(0, 120) : "internal_error";
}
