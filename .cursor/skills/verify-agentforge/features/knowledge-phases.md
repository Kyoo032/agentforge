# Knowledge phases

Builtin-only Knowledge Base. WeKnora sidecar was stripped 2026-09-12 (binary never built). Cloud proves Phases 0–4 with Vitest plus stub webdev on `127.0.0.1:3000`. Live `[n]` cites need a gateway key — skip that step on Cloud. This file is the testing path; drive recipes live in [knowledge.md](./knowledge.md), [knowledge-ingest.md](./knowledge-ingest.md), and [knowledge-graph.md](./knowledge-graph.md).

## Sub-features

- `phase-0-seam` is the backend contract + cited retrieve + `knowledge_retrievals` + PDF/DOCX ingest. Unit: `packages/host/src/knowledge/backend.contract.test.ts`, `knowledge-extract.test.ts`, `knowledge-retrievals.test.ts`. Drive: planted-fact recipe in [knowledge.md](./knowledge.md).
- `phase-1-parse` is text-layer PDF / Word → `Indexed`, scanned PDF → `pdf_no_text_layer`. Unit: `packages/core/src/pdf/index.test.ts`, host `knowledge-extract.test.ts`. Drive: the PDF/Word gotchas in [knowledge.md](./knowledge.md). No OCR.
- `phase-2-hybrid` is overlapping chunker, hybrid RRF, graph tables, six-stage loop, self-check. Unit: `knowledge-chunk.test.ts`, `knowledge-verify.test.ts`, `knowledge-graph.test.ts`, `knowledge-stub-vectors.test.ts`, `knowledge-query-model.test.ts`. Drive: Loop chart and Graph in [knowledge.md](./knowledge.md).
- `phase-3-builtin-only` is the sidecar removal. `GET /api/v1/knowledge` reports `backend.id = "builtin"`. `PUT /api/v1/knowledge/backend` `{id:"weknora"}` is **400** `WeKnora sidecar is not part of this product`. Unit: `knowledge-backend-routes.test.ts`. There is no backend card, no `:3100` sidecar instance, no `AGENTFORGE_WEKNORA_BIN`, no `features/knowledge-backend.md`.
- `phase-4-graph` is `cites` edges after a reply with `[n]`, one-hop `covers` expand (off in Chat), reindex, PDF `worker_threads`. Unit: `knowledge-cites.test.ts`, `knowledge-expand.test.ts`, `knowledge-reindex.test.ts`, `knowledge-graph.test.ts`, `packages/core/src/pdf/worker.test.ts`, `fallback.test.ts`. Drive: [knowledge-graph.md](./knowledge-graph.md). Stub Chat never cites.
- `ingest-loop` predates these phases (0.14.23). Every finished Chat/job writes a work card. Drive: [knowledge-ingest.md](./knowledge-ingest.md).

## How to get to it (user POV)

- Cloud / GHA: this repo after clone. Stub runtime. No sidecar to start.
- Webdev: `pnpm dev` → `http://127.0.0.1:3000/knowledge` (`mode-knowledge`). Doctor with no args; skip the Knowledge drive if `knowledge` is false.
- Packaged desktop is Windows-only proof (`doctor --desktop`). Cloud cannot pack or drive the installed app.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0. Cloud stays `AGENTFORGE_RUNTIME=stub`. Do not paste a gateway key.
- Never start a second process on `:3000`. Never treat `:3000` as the packaged app.
- Do not look for WeKnora, `resources/weknora/`, or a backend Switch.

**Cloud unit (required).** From repo root, after `install`:

```bash
cd packages/host
npx vitest run src/knowledge.test.ts \
  src/knowledge/backend.contract.test.ts \
  src/knowledge-backend-routes.test.ts \
  src/knowledge-extract.test.ts \
  src/knowledge-retrievals.test.ts \
  src/knowledge-chunk.test.ts \
  src/knowledge-verify.test.ts \
  src/knowledge-graph.test.ts \
  src/knowledge-cites.test.ts \
  src/knowledge-expand.test.ts \
  src/knowledge-reindex.test.ts \
  src/knowledge-stub-vectors.test.ts \
  src/knowledge-query-model.test.ts

cd packages/core
npx vitest run src/pdf
```

Pass: those files green. A leftover `weknora` id in settings is ignored; the routes file asserts PUT `weknora` → 400.

**Cloud UI (stub, required for phases 0–2 + ingest).** Follow [knowledge.md](./knowledge.md) planted-fact + loop/graph, then [knowledge-ingest.md](./knowledge-ingest.md) baseline. Stub Chat injects chunks (`chat-context` Sources `≥ 1 chunks`) but the reply has no `[n]`, so Phase 4 `cites` stays 0 — that is a pass, not a skip. Expand stays off: no chunk labelled `via graph`.

**Cloud UI (Phase 4 cites).** Stop after the stub steps. Do not spend a key. Record: `data-edges` unchanged, no `cites` hover. Live cites are Windows-only when the operator asked (`runtime: "ai"`).

**Doctor fields (webdev).** `knowledge: true`, `knowledgeRetrievals` after a completed Chat retrieve, `knowledgeGraph` after a map run, `knowledgeBackend` is builtin / absent of weknora health. Missing graph fields mean an old host.

## Gotchas

- This path is the source of truth for Cloud. `docs/internal/weknora-kb-plan.md` is the old evaluation; Phase 3 sidecar code is gone. Do not revive the sidecar, the lite workflow, or `stage-weknora.mjs`.
- `:3100` was an isolated Windows desk used while building. Cloud has no `:3100`. Use `:3000` after doctor.
- `knowledge.graphExpand` has no Settings key. Chat does not pass `expand: true`. Unit tests cover the ON path; product stays off.
- Playwright `foundation.spec.ts` is Chat/Settings/job-mode smoke. It does not replace the Knowledge phase files above.
- Packaged proof (`host.cjs` + renderer, `doctor --desktop`) is owed on Windows before 0.14.25 ships. Cloud must not run `pnpm desktop:build`.
