# Knowledge graph

Phase 4 builtin makes the Graph stage two-way. Downstream, every completed Chat turn whose reply names bare `[n]` markers records `cites` edges (`source → thread`) — the only signal that a chunk was used rather than merely offered, counted separately from `retrieved`. Upstream, one hop over `covers` can add up to two sibling chunks when the top hit is weak — behind `knowledge.graphExpand`, which is **off in Chat today** (no settings key, no UI). The panel itself is the Phase 2 base under the loop chart; this fixture covers the Phase 4 edges on it — the `cites` writes, the off-by-default expansion, and what the existing `knowledge-graph-panel` shows for them. Builtin only: the WeKnora sidecar is not part of the product. See [knowledge.md](./knowledge.md) for the panel's base behaviour, [knowledge-ingest.md](./knowledge-ingest.md) for the loop chart, and [knowledge-phases.md](./knowledge-phases.md) for the Cloud unit + stub path.

## Sub-features

- `cites` after a reply. `runs.ts` parses each completed assistant reply (`packages/host/src/knowledge-cites.ts`): the bare 1-based integers `[n]` are positional references into the chunks the run was injected with (`[1]` = the first offered chunk, `knowledgeInjection` numbers them). Every distinct source a reply names gets one edge `source → thread`; the stored row aggregates, so a second citing turn raises the same edge's `weight` instead of adding a row. `[S1]`, `[n]`, `[1,2]`, `[0]` are not markers; fenced code is skipped whole (including an unterminated fence); a marker past the last injected chunk is dropped — a reply cannot cite a source it was never offered. A stream that broke but still saved partial text records its cites too; an empty citation set writes nothing.
- Best-effort by design. `recordCites` never throws and never fails a run (a source deleted between injection and reply just logs). A missing `cites` edge after a visibly citing reply is worth a bug report, not a retry loop.
- Graph → retrieval expansion (off). `expandRetrievedChunks` (`packages/host/src/knowledge-expand.ts`) adds up to `EXPAND_CHUNK_CAP` = 2 first-chunks of sources covered by a topic that also covers the top hit's source, each labelled `via graph` with score 0 (so a graph chunk can never outrank a real hit), and only when the top hit scores below `EXPAND_TOP_SCORE_THRESHOLD` = 0.5 and the caller passes `expand: true`. It is wired through `retrieveChunks` — and **Chat does not pass it**; with the flag off the retrieval comes back untouched. The ON path is unit-only (`knowledge-expand.test.ts`); the planted-pair test decides if it ever flips.
- What the existing panel shows for these edges. `knowledge-graph-counts` carries `data-nodes` / `data-edges` (workspace totals, wider than the 200-node draw window). Edges are stroked in a per-kind colour (`covers` / `retrieved` / `cites`) and each line's hover title reads `<kind> · weight <w>`; `knowledge-graph-legend` always names all three edge kinds (`cites` hint: "thread cited a source"). `knowledge-loop-stage-Graph` counts the same edge total, and webdev doctor reports `knowledgeGraph: { nodes, edges }` — aggregate only, no per-kind field.

## How to get to it (user POV)

- Choose Knowledge Base on the Account rail (`mode-knowledge`) → Sources tab; `knowledge-graph-panel` sits under the `knowledge-loop` chart and is collapsed until `knowledge-graph-toggle` is clicked.
- Open `http://127.0.0.1:3000/knowledge` (webdev). This feature needs no sidecar and no `:3100` instance.
- A `cites` edge appears after a Chat reply that actually cites (`[1]` and friends). With the stub runtime there is no such reply — the stub answers with a tool result or "I need a Toko Token gateway key in Settings to answer that." — so a stub desk can prove the plumbing but not a cite.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0 and reports `knowledge: true`.
- Drive webdev `:3000`, and only the Chat and Knowledge pages.
- A citation needs a live turn: stub replies never contain `[n]`. Live spending on the operator's gateway — do the live step only when the operator asked; otherwise stop after the stub steps and report the stub result.
- Evidence state before you drive: Phase 4 landed 2026-09-12. Cloud proves it with the unit commands in [knowledge-phases.md](./knowledge-phases.md). Stub Chat cannot cite. Do not write up a live cites run that did not happen.

- **Baseline the panel.** Follow the planted-fact recipe in [knowledge.md](./knowledge.md) (paste `The internal code name is zorblatt7731.`, add it, new Chat thread). On `/knowledge` read `knowledge-graph-counts` `data-edges` (call it E). Click `knowledge-graph-toggle`: after a `knowledge-map-run` the drawing shows topic + source nodes and `covers` edges — that base is Phase 2, not this fixture.
- **A stub turn writes no cites (expected).** Send the planted question. The reply is a tool result or the gateway-key line; `chat-context-breakdown` → Sources still shows the injected `k chunks`, but the reply contained no `[n]`, so after reloading `/knowledge` and reopening the panel `data-edges` is unchanged and no `cites` edge exists. Do not report this as a bug and do not retry in a loop.
- **Cites (live, operator asked).** On `runtime: "ai"`, ask the planted question in a new thread. When the reply names the source as `[1]` (any bare `[n]`, n ≤ injected chunk count), reload `/knowledge` and reopen the panel: `data-edges` grows by the number of newly cited source→thread pairs, and the thread node is now linked to the cited source by an edge whose hover title reads `cites · weight 1`. Ask a second citing question in the same thread — `data-edges` does not grow again for that pair; the same edge's weight reads 2. A reply that says "Planted note" without `[n]` is not a citation: no edge, by design.
- **Expansion is off — assert the silence.** There is no control to flip `knowledge.graphExpand` on this desk. After any turn the Sources line reads the normal `k chunks · hybrid` / `· fts`, no chunk is labelled `via graph`, and the reply cannot quote a sibling source the query did not retrieve. The ON behaviour is `packages/host/src/knowledge-expand.test.ts` (threshold, cap 2, exclusions, `via graph` label, score 0, untouched output when the flag is off).
- **Unit.** `packages/host/src/knowledge-cites.test.ts` (parser: order/dedupe, fences incl. unterminated, junk markers), `knowledge-graph.test.ts` (cites rows: one edge per source per reply, weight per turn, cites vs retrieved coexistence, empty set writes nothing), `knowledge-expand.test.ts`. Run with the host package's vitest (`vitest run` under `packages/host`).
- **Proof artifacts.** Under `evidence/knowledge-graph/<run-id>/`: screenshot of the panel with the `cites` edge hover title plus `knowledge-graph-counts`, or — stub run — the panel with `data-edges` unchanged and a note that stub Chat cannot cite. Record the feature ID and entry point on every artifact.

## Gotchas

- Stub never cites: `StubRuntime` answers with calculator/datetime output or the fixed gateway-key sentence — zero `[n]` markers. A stub desk with many turns and zero `cites` edges is correct output, not a missing feature.
- `cites` ≠ `retrieved`: the same source→thread pair can carry both rows. `retrieved` is re-projected from `knowledge_retrievals` (90-day window) on later replies; `cites` only ever accumulates, one write per completed turn — nothing re-derives it, and an edge is drawn only when both its ends are inside the returned node set.
- Weight is turns, not citations: two citing turns raise one edge's weight; one reply citing two chunks of one source is one citation; a reply naming three sources adds three edges at weight 1 each.
- Marker strictness is deliberate: fenced blocks — even an unterminated one — and non-bare forms (`[S1]`, `[1,2]`, `[0]`) are quoted text, not citations. A reply demonstrating the format inside a code fence creates nothing.
- The legend lists `cites` before any cites edge exists (it names all three kinds unconditionally) — legend presence is not proof. Use the hover title / edge colour / `data-edges` delta.
- The Graph stage and doctor count edges, not cites: `edges > 0` after a map run can be all `covers`. There is no per-kind count in the UI or doctor; a panel hover is the read.
- Expand is off in every product path today — no Settings key, no UI, Chat does not pass `expand: true`. Do not promise `via graph` chunks to anyone; flipping it is a code change pending the planted-pair test.
- Old host: no `/api/v1/knowledge/graph` route → `knowledge-graph-error` + `knowledge-graph-retry`; the loop chart still counts the other stages (see [knowledge.md](./knowledge.md)).
- There is no WeKnora wiki overlay and no backend Switch. Graph-panel nodes are builtin. Missing wiki nodes is not a bug.
- Never start a second process on `:3000`.
