import type { RetrievedChunk } from "../../backend";
import type { SearchHit, WeKnoraCustomMetadata } from "./dto";

/**
 * WeKnora search hits → the contract's `RetrievedChunk`.
 *
 * Two rules, both about identity. First, a hit is only served if it resolves to a source row *in
 * the asking workspace*: a `knowledge_id` alone proves nothing, because the sidecar holds one
 * tenant's documents for every desk on this machine, and a mis-scoped hit would leak one desk's
 * notes into another's prompt. Second, the display name comes from our `knowledge_sources` row,
 * never from the hit — source names are a prompt-injection surface (see the Phase 0 log) and the
 * sidecar's copy of one has been round-tripped through a third-party database.
 */

/** How a source id is resolved, and what it is allowed to resolve to. */
export type SourceLookup = {
  /** Our source id for a WeKnora knowledge id, scoped to this workspace. Null when unknown. */
  bySourceId(sourceId: string): { id: string; name: string } | null;
  byExternalId(externalId: string): { id: string; name: string } | null;
};

/**
 * Parse the rendered custom metadata WeKnora hands back on a hit.
 *
 * `Knowledge.CustomMetadataText()` renders the JSON object as `key: value` lines with keys sorted
 * and blank values dropped — not JSON — so this reads lines, takes the first colon as the
 * separator, and ignores anything else. Values cannot contain a newline by construction (we write
 * ids), so a value that looks like a second key is simply not representable.
 */
export function parseCustomMetadataText(text: string): Partial<WeKnoraCustomMetadata> {
  // Null-prototype: the keys come from a third-party database, so `__proto__` and `constructor`
  // have to be ordinary strings here rather than a way to reach Object.prototype. `Object.hasOwn`
  // for the same reason — `key in out` answers true for every inherited name.
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const line of text.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key && value && !Object.hasOwn(out, key)) {
      out[key] = value;
    }
  }
  return { ...out } as Partial<WeKnoraCustomMetadata>;
}

/**
 * WeKnora scores are cosine / RRF-ish and already roughly in (0, 1], but nothing upstream promises
 * that. Clamped into (0, 1] so it is comparable with the built-in backend's fused score, which the
 * Knowledge page and `knowledge_retrievals` both treat as one scale.
 */
export function normalizeScore(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return MIN_SCORE;
  }
  return Math.min(Math.max(raw, MIN_SCORE), 1);
}

/** A hit that scored 0 would read as "no match", so a real hit never falls below this. */
const MIN_SCORE = 1e-6;

/**
 * Map one hit, or null when it cannot be attributed to a source of `workspaceId`.
 *
 * The metadata path is preferred (it carries the source id we stamped at ingest); the external-id
 * path is the fallback for documents written before a metadata update landed. Both lookups are
 * workspace-scoped by the caller, so neither can return another desk's row.
 */
export function mapSearchHit(hit: SearchHit, workspaceId: string, lookup: SourceLookup): RetrievedChunk | null {
  const meta = parseCustomMetadataText(hit.customMetadataText);
  const source = resolveSource(hit, workspaceId, meta, lookup);
  if (!source) {
    return null;
  }
  return {
    body: hit.content,
    sourceId: source.id,
    sourceName: source.name,
    score: normalizeScore(hit.score),
    chunkIndex: Number.isInteger(hit.chunkIndex) && hit.chunkIndex >= 0 ? hit.chunkIndex : 0,
  };
}

function resolveSource(
  hit: SearchHit,
  workspaceId: string,
  meta: Partial<WeKnoraCustomMetadata>,
  lookup: SourceLookup,
): { id: string; name: string } | null {
  if (meta.source_id) {
    // A document stamped for another desk is dropped outright, even if its id happens to exist
    // here: the stamp is the document's own claim about who it belongs to, and it has to match.
    if (meta.workspace_id && meta.workspace_id !== workspaceId) {
      return null;
    }
    const row = lookup.bySourceId(meta.source_id);
    if (row) {
      return row;
    }
  }
  return hit.knowledgeId ? lookup.byExternalId(hit.knowledgeId) : null;
}

/** Map a whole result set, dropping unattributable hits and preserving upstream's order. */
export function mapSearchHits(hits: SearchHit[], workspaceId: string, lookup: SourceLookup): RetrievedChunk[] {
  const out: RetrievedChunk[] = [];
  for (const hit of hits) {
    const chunk = mapSearchHit(hit, workspaceId, lookup);
    if (chunk) {
      out.push(chunk);
    }
  }
  return out;
}

/** The metadata stamped on every document we ingest. One place, so the field names live here too. */
export function customMetadataFor(input: {
  workspaceId: string;
  sourceId: string;
  originKind: string | null;
  originId: string | null;
  externalRef: string;
}): WeKnoraCustomMetadata {
  return {
    workspace_id: input.workspaceId,
    source_id: input.sourceId,
    origin_kind: input.originKind ?? "",
    origin_id: input.originId ?? "",
    external_ref: input.externalRef,
  };
}
