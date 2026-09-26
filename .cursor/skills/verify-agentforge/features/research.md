# Research

Research is a job: question → planned sub-queries → web search → fetched pages → a cited dossier as Markdown. It is not a citation manager and it has no offline output. Live generate needs a gateway key. Search uses a saved Tavily or Brave key when the desk has one, and otherwise Wikipedia, OpenAlex, arXiv, and Crossref. It does not ask for a second key. The empty shell, the template prefill and the refused generate (no gateway key) are the stub proof. Map: [`docs/internal/maps/research-dossier.md`](../../../../docs/internal/maps/research-dossier.md).

## Sub-features

- `research-header` (0.15.0) — title plus one outcome line in `expected-inputs`: "You get: a cited dossier — Question, Findings, Sources — you can reopen, download, or send to Documents, Presentation, or the Knowledge Base." `research-prompt` is a bordered `text-field` input. Driven 2026-09-23: an `example-card` fills `research-prompt` and shows `example-result` with no request.
- `research-rail` reaches `/research` from `mode-research` on Default (and any workspace that includes Research).
- `research-shell` shows `research-studio-empty` inside `research-studio`, plus `example-gallery` (6 `example-card`, see [templates.md](./templates.md)). There is no Documents-style starter: a card only prefills `research-prompt`, it never produces an offline draft.
- `research-studio-model` is the generate-bar chat-catalog dropdown.
- `research-saved` ("Reopen saved research…") lists `GET /api/v1/artifacts?mode=research`: `research-saved-toggle` → `research-saved-panel` → `research-saved-item`. A reopened dossier shows Markdown only.
- `research-progress` is the streamed phase list (planning → searching n/5 → reading n/10 → drafting → saving) with `research-progress-sources` under it. `research-cancel` replaces nothing but appears beside `research-generate` while the job is busy.
- `research-tabs` (`research-tab-notes` / `research-tab-dossier`) appears **only after a fresh run**, never for a reopened artifact. The Dossier tab is `research-dossier-preview`.
- `research-actions` is the shared artifact bar: `research-download`, `research-send-kb`, `research-make-document`, `research-make-presentation`. The last two are renderer-only handoffs — they navigate to `/documents` / `/presentations` with the dossier Markdown as source material (`apps/web/lib/mode-handoff.ts:45-51`).
- `research-preview` / `research-note` appear after a generate. Note bodies render markdown via `FormattedText` (same as Chat `message-output` and Documents preview).
- Live generate POSTs `/api/v1/research/stream` (SSE `job.*`: phase → step → source → done). `POST /api/v1/research` is the non-streaming twin the studio never calls.
- Stub / no search key shows `research-error`. On `/api/v1/research/stream` the refusal is HTTP **200** carrying `job.error {status: 503}` — assert the testid, never the status; see SKILL.md “Harness-wide gotchas” G2. Only the uncalled `POST /api/v1/research` answers a real 503.

## How to get to it (user POV)

- Choose Research on the left rail (`mode-research`). Default already has the tab.
- Open `http://127.0.0.1:3000/research` when the tab is unlocked.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-research` is visible on Default. If count is 0, you are on a desk that hid Research — switch to Default or add the tab in Workspaces.
- Stub proof stops at the studio shell + the template prefill + the refused generate. Everything from `research-preview` onward — tabs, `research-dossier-preview`, `research-progress`, `research-cancel`, `research-download`, `research-send-kb`, the two handoffs — needs a finished run.
- A live generate needs a gateway key (doctor `runtime: "ai"`). It does not need a Tavily or Brave key. Those keys, when saved, replace the keyless search (`packages/core/src/tools/platform/web-search.ts`). A backend the user selected whose key is missing still errors. A live model run only with the operator's say-so.
- `research-saved` is the one way to reach the artifact bar without a live run — but only on a desk that already has a saved `mode=research` dossier. The owner's :3000 had none on 2026-09-17.

- **Open Research.** Click `mode-research`. URL matches `/research`. `research-studio` and `research-studio-model` are visible.
- **Shell.** `research-studio-empty`, `research-studio-prompt-bar`, `research-prompt`, `research-generate`, `research-enhance` and `research-saved` are visible. `research-preview`, `research-note`, `research-tabs` and `research-actions` count 0.
- **Template prefill.** `example-card` count is 6; click one and `research-prompt` fills with a multi-paragraph brief, `example-result` appears. See [templates.md](./templates.md).
- **Refused generate (stub desk).** Type a question in `research-prompt`, click `research-generate`. `research-error` appears and names the gateway. It does not ask for a Tavily or Brave key. The wire is `POST /api/v1/research/stream` → HTTP 200 with one `job.error` frame; do not assert an HTTP 503 here. Nothing is persisted: `research-saved-item` count is unchanged.
- **Saved dossiers (read-only).** Click `research-saved-toggle`; `research-saved-panel` opens and lists `research-saved-item`. Do not pick, create or delete an artifact on a desk you do not own.
- **Live preview (operator-asked only).** After a generate, `research-preview` and `research-note` are visible; note text is formatted markdown, not raw `**`.
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), the shell reads `Riset` (rail + H1), `Belum ada dosir`, `Mulai dari templat` and the `Batal` / `Hasilkan` buttons. `Catatan` and `Dosir` are the `research-tabs` labels and only exist after a finished run — do not assert them on a stub desk. Testids are locale-invariant. Clicking an `example-card` loads an **English** brief even on an `id` desk (`templates.*.prompt` is absent from `locales/id/research.json`); the dossier Markdown and the phase labels are English too.
- **Cloud.** `foundation.spec.ts` covers the Default rail tab. Do not paste a gateway key.

## Gotchas

- Default desk unlocks Research. A Legal desk also has it. Do not open Studio to unlock the tab.
- `research-error` never shows an "Open Settings" link. The link is guarded by `!/settings/i.test(error)` (`apps/web/components/research-studio.tsx:101`) and both stock refusals already contain the word "Settings", so the branch is unreachable. Assert the banner text, not a link.
- Search does not need its own key. A missing Tavily / Brave key does not refuse Research. The keyless path is `packages/core/src/tools/platform/keyless-search.ts` (pinned Wikipedia, OpenAlex, arXiv, Crossref). Stub desks still refuse on the gateway, before any search — which route is a real 503 is SKILL.md “Harness-wide gotchas” G2; read it before asserting a status.
- `research-studio-model` renders empty and `disabled` for roughly a second after `research-studio` appears; on 2026-09-17 it settled at 101 options in 11 optgroups, default `gpt-5.6-luna`. Wait for a non-empty option list, not for the testid — see SKILL.md “Harness-wide gotchas” G1.
- `locales/*/research.json` carries `stubTitle` / `stubSummary` / `stubFinding*` copy for an offline stub dossier. **That path does not exist** — `requireLiveResearch` refuses before anything is generated (`packages/host/src/research-generate.ts:81-83`). Unlike Documents, Research has no offline output. Do not go looking for it.
- Do not POST `/api/v1/research` as a substitute for the prompt bar on a live proof.
