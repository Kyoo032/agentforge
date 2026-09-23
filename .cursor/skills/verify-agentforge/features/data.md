# Data

Data is a table analyst job: upload or paste a table → it is parsed, profiled and loaded into a private SQLite → ask a question → the model answers only through a capped read-only `run_sql` tool, and the host re-runs its SQL in code to build the evidence tables and charts. It is not Research and does not call `web_search`. Parsing, profiling and previewing work without a key; analysis needs one.

## Sub-features

- `data-rail` reaches `/data` from `mode-data` on Default (and any workspace that includes Data).
- `data-shell` shows `data-studio`: the header is the title plus one outcome line, `expected-inputs` = "You get: a saved analysis — findings, evidence, and the SQL behind every number."; a closed `data-how` disclosure ("How this works", `apps/web/components/data-studio.tsx:182`); a `data-source` panel (`data-upload`, which fires the hidden `data-file-input`; the closed `data-paste` disclosure "Or paste a table" at `:241` holding `data-csv` + `data-use-pasted`; and `data-saved` once a dataset exists), a `data-starters` list, and the `data-studio-prompt-bar` (`data-enhance`, `data-studio-model`, `data-prompt`, `data-generate`). Since 0.15.0 `data-csv` is **not visible** until `data-paste` is opened.
- `data-upload` posts the file to `POST /api/v1/datasets` (multipart, field `file`); `data-use-pasted` posts `{name, text}` to the same route. Both return a dataset with a profile and a 100-row preview.
- `data-dataset` shows the adopted table: `data-dataset-name`, a row/col/size line, `data-profile` (per-column type, nulls, distinct, min/max/mean, top values) and `data-preview-toggle` → `data-preview`. All of this works with no gateway key.
- `data-saved` reopens a stored dataset via `GET /api/v1/datasets/:id`.
- `data-starter` pre-fills `data-prompt` (3 starters).
- `data-studio-model` is the generate-bar chat-catalog dropdown.
- Generate POSTs `/api/v1/data/stream` with `{datasetId, prompt, model, history}` — the table itself is never in the body. Progress renders as `data-progress`; a finished analysis renders as `data-analysis` (+ `data-summary`, `data-finding`, `data-evidence`, `data-evidence-sql`, `data-evidence-table`, `data-charts`, `data-chart`) with `data-actions` / `data-download` above it. `data-history` marks a follow-up question.
- Generating with no adopted dataset is refused in the browser (`data-error`, no network call). An unparseable upload or paste is refused by `POST /api/v1/datasets` with 400/413 and lands in the same `data-error`.
- `data-download` saves the analysis Markdown. `data-cancel` aborts a running job silently.
- Stub/no-key generate refuses on `/api/v1/data/stream` with HTTP **200** carrying a `job.error` frame (status 503) — assert `data-error`, never the status; see SKILL.md “Harness-wide gotchas” G2. The message names Toko Token and Settings.

## How to get to it (user POV)

- Choose Data on the left rail (`mode-data`). Default already has the tab.
- Open `http://127.0.0.1:3000/data` when the tab is unlocked.
- Legal / Marketing / Students presets do not add this tab unless the owner checks it.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-data` is visible on Default. If count is 0, switch to Default or add the tab in Workspaces.
- Stub proof: upload (or paste) a table, confirm `data-profile`, press a starter, generate. Expect `data-error` carrying the gateway hint on an HTTP 200 from `/api/v1/data/stream` (G2). Live generate only if the operator asked and doctor reports `runtime: "ai"` and `hasOpenai: true`.

- **Open Data.** Click `mode-data`. URL matches `/data`. `data-studio`, `data-upload` and `expected-inputs` are visible; `data-how` and `data-paste` are closed `<details>` and `data-csv` is hidden until `data-paste` is opened.
- **Upload.** Set `data-file-input` to a small CSV. `data-dataset`, `data-dataset-name` and `data-profile` appear; `POST /api/v1/datasets` is 201. No key needed.
- **Preview.** Click `data-preview-toggle`. `data-preview` lists the first rows; empty cells render as an em dash.
- **Paste.** Click the `data-paste` summary ("Or paste a table") first, then type a table into `data-csv` and click `data-use-pasted`. Driven 2026-09-23: 3-row CSV → `POST /api/v1/datasets` 201, `data-dataset-name` "Pasted table", empty cell shown as a blank in `data-preview`; cleaned up with `DELETE /api/v1/datasets/:id` → 200. `GET /api/v1/datasets` answers `{"items":[…]}`. A second dataset is adopted and `data-csv` clears. `data-saved` now lists both.
- **Unparseable paste.** Put a single line with no data row in `data-csv`, click `data-use-pasted`. `POST /api/v1/datasets` is 400 and `data-error` reads "Could not find a header row plus at least one data row" (English on every desk — see Gotchas).
- **No table.** With no dataset adopted, fill `data-prompt` and click `data-generate`. `data-error` is the local "upload or paste first" string and **no** API call is made.
- **Starter.** Click a `data-starter`. `data-prompt` fills.
- **Generate without a key.** With a dataset adopted, click `data-generate`. `data-error` mentions gateway / Settings / Toko Token. No search call.
- **Clean up.** Every dataset you create persists. There is no delete control in the UI — remove yours with `DELETE /api/v1/datasets/:id` and confirm `GET /api/v1/datasets` is empty (and that `data-saved` disappears on reload).
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Unggah CSV / XLSX`, `Ajukan pertanyaan tentang tabel ini.` and `Unggah atau tempel tabel, lalu ajukan pertanyaan.`; `data-profile` headers read `KOLOM / TIPE / KOSONG / UNIK / MIN / MAKS / RATA-RATA / NILAI TERATAS`. Testids are locale-invariant. Two strings are **not** localized and that is the expected (buggy) state: every host `ApiError` from the dataset store is English, and the gateway hint says "Settings", not "Pengaturan". Do not record either as a locale regression.
- **Cloud live.** Only after doctor `ai`: one table analysis. Do not screenshot the key.

## Gotchas

- Default desk unlocks Data. Seeded Legal / Marketing / Students desks do not.
- This is not `/api/v1/research`. A network call to Tavily/Brave is a fail.
- Do not POST `/api/v1/data` or `/api/v1/data/stream` as a substitute for the prompt bar on a live proof. `/api/v1/data` is not the UI's route at all — the studio uses `/api/v1/data/stream`.
- A failed analysis on `/api/v1/data/stream` is HTTP 200 — assert `data-error`; see SKILL.md “Harness-wide gotchas” G2.
- **Every dataset you upload or paste is persisted and there is no UI delete.** `data-saved` grows forever and the raw files sit under `<data dir>/datasets/<workspaceId>/`. Clean up with `DELETE /api/v1/datasets/:id` and prove it with `GET /api/v1/datasets` plus a reload (`data-saved` count 0).
- **Host error text is English on every desk.** The `id` catalog has `data.errors.noHeader` and friends, but nothing reads them — the message on screen comes straight from the host.
- `data-studio` stays mounted after one visit — SKILL.md “Harness-wide gotchas” G3; here it means an adopted dataset and a shown `data-analysis` survive switching to Chat and back, so reload to get a clean studio.
