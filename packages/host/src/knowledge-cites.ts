import type { RetrievedChunk } from "./knowledge/backend";

/**
 * Phase 4 of the knowledge loop: which offered sources a reply itself pointed at.
 *
 * `knowledgeInjection` numbers the injected chunks `[1] … [n]` in retrieval order, so a marker is a
 * *positional* reference back to the chunk it came from — no name matching, and the mapping cannot
 * be forged by a source name. Fenced code is quoted text (a reply showing the citation format, a
 * pasted snippet), never a citation, so those lines are skipped whole, including an unterminated
 * fence: a truncated example must not leak half a citation.
 *
 * Parsing only reads the reply; `recordCites` in `knowledge-graph.ts` writes the edges.
 */

/** A citation marker: the bare 1-based integer in square brackets that the prompt asks for. */
const MARKER = /\[(\d+)\]/g;

/** A line that opens or closes a fenced code block (` ``` ` or ` ~~~ `, up to 3 spaces in). */
const FENCE = /^\s{0,3}(```|~~~)/;

/**
 * The citation numbers this text uses, in order of first use, each counted once.
 *
 * Strict by design: `[S1]`, `[n]`, `[1,2]` and `[0]` are not the `[n]` marker the sources block
 * defines, and a number that cannot map to a chunk is dropped by `citedSources` anyway.
 */
export function parseCiteMarkers(text: string): number[] {
  const seen = new Set<number>();
  const markers: number[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const token = FENCE.exec(line)?.[1];
    if (token) {
      if (fence === null) {
        fence = token;
      } else if (fence === token) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      continue;
    }
    for (const match of line.matchAll(MARKER)) {
      const n = Number(match[1]);
      if (!Number.isSafeInteger(n) || n < 1 || seen.has(n)) {
        continue;
      }
      seen.add(n);
      markers.push(n);
    }
  }
  return markers;
}

/**
 * The distinct source ids a reply cited, in first-citation order.
 *
 * `chunks` is what the run was injected with, in prompt order — `[1]` is `chunks[0]`. A marker past
 * the last chunk is dropped: the reply can claim a source that was never offered, but it cannot
 * make one cite. (Distinct from `@agentforge/core/artifacts`' `citedSourceIds`, which reads the
 * dossier's `[S#]` ids out of a finding body; these are positional markers into the run's chunks.)
 */
export function citedSources(text: string, chunks: readonly RetrievedChunk[]): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();
  for (const marker of parseCiteMarkers(text)) {
    const chunk = chunks[marker - 1];
    if (!chunk || seen.has(chunk.sourceId)) {
      continue;
    }
    seen.add(chunk.sourceId);
    sources.push(chunk.sourceId);
  }
  return sources;
}
