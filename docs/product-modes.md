# Product modes

DPSBuddy’s left nav is **mode-first**. Tabs come from a kernel catalog. **Which tabs appear** is the current workspace’s `productModes`. Default stores every work mode. Creating another desk (Legal, Marketing, Students, or custom checkboxes) can shrink or grow that rail. Packs are workspace presets. Custom agents do not drive the rail.

Gateway identity stays **Toko Token** (`api.tokotokenai.com/v1`). Do not merge Toko Token with TokenKu in copy or catalogs. Kernel stays industry-neutral: no `student` / `course` / campus nouns outside `packages/university`.

## Catalog (fixed order)

| Nav label     | Id             | Route              | Role |
|---------------|----------------|--------------------|------|
| Chat          | `chat`         | `/chat`            | Default assistant |
| Documents     | `documents`    | `/documents`       | Prompt → preview → download DOCX |
| Research      | `research`     | `/research`        | Question → web search → sourced notes → Markdown |
| Finance       | `finance`      | `/finance`         | Line items → metrics computed in code → guarded brief → DOCX with tables |
| Data          | `data`         | `/data`            | Upload / paste table → SQL-backed analysis with evidence tables + charts → Markdown |
| Market        | `market`       | `/market`          | Watchlist ≤15 tickers → briefing → guarded brief → DOCX |
| Legal         | `legal`        | `/legal`           | Matter of .docx files → position-aware review → verified memo, tracked-changes redline, deviation report |
| Meeting       | `meeting`      | `/meeting`         | Recording → transcript → minutes of meeting → the same minutes in the other language |
| Images        | `images`       | `/images`          | Prompt → generate images → gallery |
| Videos        | `videos`       | `/videos`          | Prompt → generate videos → gallery |
| Music         | `music`        | `/music`           | Description or lyrics → generate music → gallery (two takes per job) |
| Presentation  | `presentations`| `/presentations`   | Prompt → outline → stage editor (filmstrip, shapes) → PPTX |
| Education     | `education`    | `/education`       | Lesson deck, exam from the desk's knowledge, local page reading, presenter plan |
| Knowledge Base | —             | `/knowledge`       | Account-rail Soul / Memory / Sources / Map + models (not a product mode) |
| Channels      | —              | `/channels`        | Account-rail Telegram bot + desk channels: send and receive (not a product mode) |
| Settings      | —              | `/settings`        | Gateway key, privacy (not a surface) |
| Usage         | —              | `/usage`           | This-key + desk spend by range (not a surface) |

Account rail (not modes): Knowledge Base, Channels, Workspaces, Usage, Settings, theme. Collapse prefs stay on `apps/web/lib/rail-prefs.ts`. Marketing / Students presets stay as seeded — they do not gain Finance, Data, or Legal unless the owner checks those boxes. The Legal preset seeds the Legal mode.

Agents / Studio are parked. `/agents` and `/studio/**` redirect to Chat. Files stay in the tree for a later pass.

## How the rail is computed

`resolveWorkspaceModes` in `packages/core/src/agents/product-modes.ts`:

- Stored workspace `productModes` in catalog order, always including Chat.
- Missing / `null` / empty → all work modes (Default desk).
- Unknown ids including parked `agents` are dropped.
- Hidden generate-studio URLs redirect to the first visible mode (Chat if present). `/` does the same.
- `/agents` and `/studio` redirect like hidden modes.

A few recent **Chat** sessions sit under the Chat entry in the rail (owner decision 2026-09-17), capped at `RAIL_RECENT_THREADS` (4) with `+ New chat` above them and an `All sessions` row when more exist. That row is a toggle: the rail list expands in place to every session the host returns, and there is no second column at all. Job-mode artifacts still never enter the nav.

Redirects:

- `/` → first visible mode
- `/workspace` → `/chat`
- `/agents`, `/studio/**` → `/chat`

## Pack seeds

Packs live in their own packages. They seed workspace **preset mode lists**. They do not change kernel schema.

- **Blank** — `chat` (user adds chips; Chat always required)
- **General / Default** — every work mode
- **Students** (`packages/university`) — `chat`, `documents`, `research`, `images`, `presentations`
- **Marketing** (`packages/marketing`) — `chat`, `documents`, `images`, `videos`, `presentations`
- **Legal** (`packages/legal`) — `chat`, `documents`, `research`, `legal`, `presentations`

## What each mode is for

### Chat

Default gateway chat: model picker, composer, its own sessions (`GET /api/v1/threads?scope=chat`). Uses the **chat** bucket from the live `/v1/models` probe. Default / Recommended follow the gateway routing table (`gpt-5.6-luna`, then Claude Sonnet 5 / Gemini 3.5 Flash / Qwen 3.7 Plus / MiniMax M3 / Terra) when live — not Sol/Pro/Astra/Fable. No specialist chips. No Build. Generate tools may remain bound so a sentence in Chat can still create media; that is not a substitute for the Images / Videos pages.

### Documents

Job, not a Word editor. Prompt → JSON sections → HTML preview → download `.docx`. Direct `/api/v1/documents` — not `/runs/*`. Uses the chat catalog with a cheap writing default (`hy3` when live, else `deepseek-v4-flash`). Settings can override the default. Optional **Source material** (`sourceText`, capped at 120k chars) on generate and regenerate: when present the model may use only that material for facts. The field has a "Use a saved artifact…" picker and is prefilled by Research's **Make a document** handoff.

### Research

Job, not Westlaw / Harvey / Kimi Deep Research. Question → `web_search` hits → sourced notes preview → Markdown. Fails visibly without a gateway key. Search uses a saved Tavily or Brave key when one is present, and otherwise Wikipedia, OpenAlex, arXiv, and Crossref. It does not ask for a second key. Uses the chat catalog with an everyday default (`gpt-5.6-luna`, then MiniMax M3, then Terra when live). Since 0.14.22 a run is a **dossier pipeline** (`packages/host/src/research-dossier.ts`): plan 3–5 sub-queries → `web_search` each (5 hits) → dedupe → read up to 10 pages over public HTTPS with the `web_fetch` tool (8k chars/page, 1.5 MB, 10 s, injection-guarded; unreachable pages are kept as snippet-only sources, never dropped) → per-source verbatim passages → one synthesis call for findings that cite `[S#]`, contradictions, and open questions. The dossier is a fixed-skeleton Markdown artifact (`kind: dossier`; frontmatter + Question / Queries run / Sources / Findings / Contradictions / Open questions) and the notes preview is derived from it, so every citation resolves to a real source. The studio streams progress (`POST /api/v1/research/stream`, `job.*` SSE: planning → searching n/m → reading n/m → drafting → saving) with a Cancel that stops the work, shows **Notes** and **Dossier** tabs, and offers **Download Markdown**, **Send to Knowledge Base** (source type `Dossier`), **Make a document**, **Make a presentation**, and **Reopen saved research…**. The JSON `POST /api/v1/research` endpoint returns the same payload.

### Finance

Job, not a spreadsheet. Inputs are **line items** (label, period, amount, currency, category): pasted text goes through `POST /api/v1/finance/parse` and the user confirms the rows before anything is computed; rows can also be typed by hand or mapped from a saved Data dataset. `@agentforge/core/finance` computes margins, growth, burn and runway, ratios, breakeven, and NPV / IRR in code (`computeFinance`), the model writes sections from a table of inputs and metrics (`POST /api/v1/finance` + `/stream`), and a **number guard** replaces any figure in the prose that does not trace to an input or a computed metric with “[unverified figure]” (count shown in the preview). Per-section rewrite via `/api/v1/finance/regenerate` runs the same guard. `POST /api/v1/finance/docx` builds a DOCX with real tables (line items, computed metrics, totals by period) and an assumptions appendix. Output is a `FinanceBrief` artifact (`kind: brief`) with the same action row as Research. Live parse / generate are 503 without a key; the line-item editor and params work without one.

### Market

Watchlist desk, not a broker terminal and not a trade signal service. The user picks a **specialist agent**, a watchlist (any tickers from any venue, up to 15), a language, and an optional position context. The host fetches and computes everything the model may see — resolved symbols, quotes with pre/post-market moves, six months of daily bars, TradingView ratings merged over computed RSI / SMA / EMA / MACD / 52-week range, swing highs and lows, a chart per ticker, headlines with publisher and time, and macro levels — into one packet (`POST /api/v1/market` + `/stream`, `job.*` SSE: resolving → quotes → technicals → charts → news → macro → drafting → verifying → saving; `POST /api/v1/market/board` is the keyless quotes-only view). The model narrates over that packet and nothing else: a **number guard** replaces any figure that does not trace to the packet or the user's own position context with “[unverified figure]”, and an **advice guard** replaces any imperative directive sentence (“beli sekarang”, “buy now”) with a marker and counts it. The disclaimer is stamped by code. Output is a `MarketBriefing` artifact (`mode: market`, `kind: briefing`) with per-section rewrite (`/api/v1/market/regenerate`, same guards, same agent) and `POST /api/v1/market/docx`.

Eleven named agents share that one pipeline; what differs is the system rules, the default instruction, and the starter watchlist (`packages/core/src/market/specialists.ts`). **Saham (IDX)** reads Indonesian equities against the IHSG, LQ45, IDX sessions and the auto-rejection bands. **Forex** reads pairs against the dollar index, rate differentials and session hours, and keeps the quote convention straight. **Emas / Gold** reads XAU against the dollar and real yields, keeps futures apart from spot, and treats miners as beta. **Kripto / Crypto** works a 24/7 clock with bitcoin as the driver, BTC dominance, and headline-only funding and sentiment. **Komoditas / Commodities** covers energy and metals with futures-curve awareness, dollar sensitivity, packet-only supply and demand, and the CPO / coal read-through to USD/IDR. **Indeks Global / Global Indices** runs the Asia → Europe → US session relay, keeps futures apart from cash, and reads breadth only from packet figures. **Rotasi Sektor / Sector Rotation** ranks relative performance across IDX sector proxies and US sector ETFs over 1 day / 5 days / 1 month, names leaders and laggards, and never gives allocation advice. **Market Scanner** emits a ranked setups table per signal group (RSI extremes, MACD crosses, SMA breaks, 52-week breakouts, unusual moves) with no narrative filler. **Ringkasan Pasar / Market Summary** is a one-page macro and session overview. **Elliott Wave Count** labels a preferred and an alternate count on the packet's own swing points and names the invalidation level, never a directive. **Agregator Berita / News Aggregator** is a headline-first digest grouped by ticker and theme, with publisher, time, and a stale flag past 24 hours. Live generate is 503 without a gateway key; the watch board works without one.

### Legal

Matter review, not a chatbot with a contract pasted in. v1 accepts **.docx only** (PDF and other formats must be converted first). The user creates a matter (`POST /api/v1/legal/matters`: title, the side the firm acts for, work type review / markup / draft / analyze, deliverables, instructions, playbook), uploads one document per request (`POST /api/v1/legal/matters/:id/files`, 25 MB per file, 60 files, 100 MB per matter, magic-sniffed), and can change the role the classifier guessed for each file (counterparty draft, executed, instruction, prior turn, playbook, figures, precedent, context). Files, the cached reader output, and run records live under `localDataDir()/legal/<workspace>/<matter>`. A run (`POST /api/v1/legal/matters/:id/run/stream`, `job.*` SSE incl. `job.round`) is the pipeline in `packages/host/src/legal/run.ts`: classify → compare with the prior turn in code (unmarked changes) → review clause by clause against the playbook checklist and the executed documents (concurrency 3, strict JSON, non-verbatim quotes dropped in code) → missing-provision and interaction passes → draft → **verify** (eight code checks: quotes verbatim, numbers traced, cross-references, defined terms, facts, instructions obeyed, docx valid, coverage; then a second model grades the checklist and reviews as opposing counsel) → targeted edit → verify again, at most three rounds. Deliverables are artifacts under `mode: legal`: issues memorandum (`kind: memo`, docx with real tables), redline (`kind: redline`, tracked changes and margin comments in the author's name, written by `@agentforge/core/docx`), deviation report (`kind: report`, xlsx), red-flags Markdown (`kind: red-flags`), plus the run manifest (`kind: matter`). The studio shows Adverse provisions / Missing provisions / Unmarked changes / Verification / Redline / Memo / Audit trail, downloads, **Send to Knowledge Base** (source type `Memo`), **Open in Documents**, and **Next turn**. Formal register only. Every deliverable ends with the draft-work-product line. Live runs are 503 without a key; matter intake and role editing work without one.

### Meeting

Job, not a note-taker bot in the call. A **meeting** is a folder on disk (`localDataDir()/meetings/<workspace>/<meeting>`), like a Legal matter — no table, no migration. The owner creates a meeting with a title and the language spoken, uploads one recording (audio or video, 25 MB, capped by the HTTP adapter's own 26 MB body limit) **or** pastes a transcript they already have, and runs it (`POST /api/v1/meetings/:id/run/stream`, `job.*` SSE: extracting → transcribing n/m → minuting → saving → translating).

Transcription is ffmpeg to mono 16 kHz mp3, segmented at ten minutes, then one gateway call per chunk. The wire is **chat completions with a base64 `input_audio` part**, because the gateway advertises no audio/transcription endpoint type and `mimo-v2.5-asr` — its only purpose-built recogniser — carries its vendor's schema behind the `openai` type (`docs/internal/gateway-model-selection.md` §2.1 and row 147). A Whisper-style id takes the multipart `/v1/audio/transcriptions` route instead. When the key's catalog lists no recogniser at all, `GET /api/v1/meetings` says so in a `capability` block and the studio offers the paste path rather than failing at upload time.

Minutes are schema-bound JSON (title, date if stated, summary, attendees, decisions, action items with owners and dates, risks, open questions) written by the chat catalog with a strict-output / long-input default (`gpt-5.6-sol`, then `gpt-5.6-terra`, `gemini-3.5-flash`, `MiniMax-M3`, `deepseek-v4-flash`). A **name guard** then checks every attendee and owner against the transcript in code: an attendee the transcript never named is dropped, an invented owner becomes `[needs owner]`, and the count is shown in the studio — the same family as Finance's number guard and Market's advice guard. The translation is a second model pass over the finished minutes JSON, guarded again, so the two languages cannot disagree about what was decided. Output is two `meeting` artifacts (`kind: transcript`, `kind: minutes`) plus a `Meeting` Knowledge work card. Live runs are 503 without a key; create, upload and paste work without one.

### Data

Table analyst, not Research. Upload a CSV / TSV / XLSX (25 MB cap) or paste a table; the host parses and profiles it in code (`@agentforge/core/tabular`), stores the file under `localDataDir()/datasets`, and loads it into a per-dataset in-memory SQLite (`packages/host/src/datasets.ts`). The model gets the column identifiers, the profile, and 20 sample rows, and answers through the `run_sql` tool (SELECT-only guard, 8 queries, 500 rows, table `data`). Every evidence table and chart is produced by re-running the model's SQL in code (`data-analysis-build.ts`); the SQL is shown under each finding. Output is a `DataAnalysis` artifact (`kind: analysis`) with the same action row as Research; follow-up questions reuse the dataset. Routes: `POST /api/v1/datasets` (file or text), `GET /api/v1/datasets[/:id]`, `DELETE`, `POST /api/v1/data` (+ `/stream`). No `web_search`. Live analyze is 503 without a key; upload and profile work without one.

### Channels

Not a product mode. Account-rail page at `/channels`: connect a Telegram bot to the desk (token stored like the gateway key, shown back only as `hasTelegramBot` and a fingerprint), add the groups or channels that bot is in, post to one, and pull replies with **Check for new messages**. A channel belongs to one desk; nothing is shared between desks. The first mode that will *use* a channel is Market — the "market blast" — in a later pass, and market trading after that. Design and phases: [`internal/telegram-channels-plan.md`](internal/telegram-channels-plan.md); how it works: [`internal/maps/channels.md`](internal/maps/channels.md).

### Knowledge Base

Not a product mode. Account-rail page at `/knowledge`: Soul (name, role, voice, rules), pinned Memory, Sources (paste / file / HTTPS URL), and Map. The owner picks Embedding / Brain / Verifier models (saved on the desk). Indexing uses local SQLite vectors with FTS fallback. Map reviews the knowledge base with those models (stub map is valid without a live key). Chat injects soul + pinned memories + RAG retrieve now; other job modes will share the same retrieve later. Text extract reads `.txt` / `.md` / `.csv` / `.json` (raw UTF-8), `.html` (tags stripped, like the URL reader), `.pdf` (pdfjs, 25 MB / 500 pages / 20 s, no OCR — a scan with no text layer is a failed source) and `.docx` (25 MB, 100 MB inflated, 20 s); anything else is refused with `unsupported_content_type` (`packages/host/src/knowledge-extract.ts`). GET settings still never returns the gateway key.

### Images

Lumina-style **generate** studio: prompt bar + result gallery. Not a canvas editor. Calls generate helpers / gateway image APIs directly — not `/runs/image`. The picker lists **every** gateway image id from `/v1/models` (including Midjourney `mj_*`). Default is `gpt-image-2` when present, then Seedream 5.0 Pro.

### Videos

Same pattern for video: prompt, aspect, optional still (`image_url`), gallery. Direct generate path — not `/runs/video`. The picker lists **every** gateway video id. Cheap default is `grok-imagine-video` (or `omni-fast-v2v`); Seedance 2.5 stays in the picker as the quality option.

### Music

Third generate studio, same pattern as Images and Videos: a brief, a picker, a gallery. Two modes — **Describe** (a sentence the model turns into a song) and **Custom** (lyrics the desk wrote, plus style tags, a title and an instrumental switch). A **Draft lyrics** button writes lyrics into the box without spending a music charge.

Unlike its siblings the wire is not a `/v1` route: the gateway's only music backend is an async Suno relay on the gateway origin (`POST /suno/submit/{music,lyrics}`, then `GET /suno/fetch/<id>`). Because Suno answers one submit with **two takes for one charge**, both are saved — each becomes its own media row, its own gallery tile and its own Knowledge card. Tracks are served by the existing `GET /api/v1/media/:id/file`.

Text-to-speech is built but **off**: the gateway's only TTS id is realtime (WebSocket), which a job route cannot drive, so the studio states the reason instead of offering a control. It turns itself on with no code change the day a plain TTS id appears in the catalog. Transcription is not part of this mode.

### Presentation

Prompt → outline → a slide stage (current slide, filmstrip, properties) → PPTX. The owner edits the title, heading, and bullets on the slide, and can insert, drag, and resize a rectangle, rounded rectangle, ellipse, triangle, line, arrow, star, callout, or text box, with fill and stroke. Those boxes are written into the same PPTX. Saving stores the outline as JSON on the desk; a reload starts empty until that deck is opened again. There is no pen, table, chart, or slide master. Same optional **Source material** field and handoff as Documents (`sourceText` on `/api/v1/presentations` and `/regenerate`).

Kimi Slides **job** (topic → deck file), not Kimi Slides **product**. Prompt → JSON outline → HTML preview in-app → Download PPTX. Uses the chat catalog with a cheap GLM default (`glm-5.2-fast-preview` / `glm-5.2` when live; Kimi K3 is the quality pick in the picker).

### Education

A lesson topic becomes a deck on the same slide stage. An exam is a sheet of numbered questions with lettered choices, built from retrieved knowledge passages, and stays readable when none are indexed. A PNG page or a PDF is read on the machine. A presenter plan is a stage: the avatar sits at its recorded position, the subtitle line shows the current cue, and the dub script is English or Bahasa Indonesia. No video file is rendered. The mode id is `education`. Teaching nouns stay in `packages/university`.

### Settings

Saving a gateway API key always probes `GET /v1/models` first, then routes ids into Chat / Documents / Research / Presentation (chat bucket) and Images / Videos (generate buckets). Empty generate studios fail visibly when there is no key. No Advanced tab, no Build / Agents links. Compact this-key spend + Open Usage link; full Day/Week/Month charts live on Usage (bottom rail, not a work mode).

### Usage

Not a product mode. Bottom-rail page at `/usage`: this-key wallet, desk estimate for the selected Day / Week / Month range, stacked spend-by-model chart, and by-model list. Fetches `GET /api/v1/usage?range=day|week|month`. Desk estimate and this-key wallet will not match.

## Later (not this pass)

- In-browser freeform slide canvas, or a document editor
- Kimi Adaptive / Visual modes, Nano Banana-on-every-slide, template clone, Google Slides export
- Lumina Home hub, Audio, Avatar
- Kimi Sheets / Websites / Design
- Full canvas media editors

## What we refuse to copy

| Reference | We take | We refuse |
|-----------|---------|-----------|
| Lumina left modes | First-class Image / Video / Chat in the catalog | Home, Audio, Avatar; infinite canvas; their full agent orchestration |
| Kimi Work / Slides | Prompt → structured deck → preview + editable PPTX download | Adaptive/Visual modes, online slide editor, research-heavy Adaptive pass, multi-format upload suite as a gate |
| ChatGPT-style global thread rail | A few recent **Chat** sessions under Chat in the rail; `All sessions` expands the rail list in place (owner decision 2026-09-17) | Mixing job-mode artifacts or every session into the global nav; a separate all-sessions column; burying generate only inside Chat |

## Media path rule (do not mix)

Two different media paths exist in this repo. Details: [research/gateway-media.md](./research/gateway-media.md).

- **Generate** — make a picture/clip: `image_generate` / `video_generate` → gateway `POST /v1/images/generations` and `POST /v1/video/generations` (+ poll). Images / Videos pages must call these helpers (or new `/api/v1/images` / `/api/v1/videos` wrappers) directly.
- **Understand** — attach a file in Chat: `/runs/image` and `/runs/video` are fail-closed **input** routes (attach-and-analyze). They are **not** generate APIs.

## Related docs

- [internal/legal-mode-flow.md](./internal/legal-mode-flow.md) — Legal pipeline, concurrency, harness preamble, register rules
- [internal/legal-mode-contracts.md](./internal/legal-mode-contracts.md) — Legal module APIs, routes, storage layout, testids
- [research/kimi-and-lumina.md](./research/kimi-and-lumina.md) — sourced reference notes vs what we ship
- [research/gateway-media.md](./research/gateway-media.md) — existing generate vs understand files to reuse
