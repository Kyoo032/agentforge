# Product modes

Agentforge’s left nav is **mode-first**. Tabs come from a kernel catalog. **Which tabs appear** is the current workspace’s `productModes`. Home stores every work mode. Creating another desk (Legal, Marketing, Students, or custom checkboxes) can shrink or grow that rail. Packs are workspace presets. Custom agents do not drive the rail.

Gateway identity stays **Toko Token** (`api.tokotokenai.com/v1`). Do not merge Toko Token with TokenKu in copy or catalogs. Kernel stays industry-neutral: no `student` / `course` / campus nouns outside `packages/university`.

## Catalog (fixed order)

| Nav label     | Id             | Route              | Role |
|---------------|----------------|--------------------|------|
| Chat          | `chat`         | `/chat`            | Default assistant |
| Documents     | `documents`    | `/documents`       | Prompt → preview → download DOCX |
| Research      | `research`     | `/research`        | Question → web search → sourced notes → Markdown |
| Finance       | `finance`      | `/finance`         | Figures-only brief → preview → download DOCX |
| Data          | `data`         | `/data`            | Pasted CSV → table notes (no web search) → Markdown |
| Images        | `images`       | `/images`          | Prompt → generate images → gallery |
| Videos        | `videos`       | `/videos`          | Prompt → generate videos → gallery |
| Presentation  | `presentations`| `/presentations`   | Prompt → outline → HTML preview + PPTX |
| Knowledge     | —              | `/knowledge`       | Account-rail Soul / Memory / Sources (not a product mode) |
| Settings      | —              | `/settings`        | Gateway key, privacy (not a surface) |
| Usage         | —              | `/usage`           | This-key + desk spend by range (not a surface) |

Account rail (not modes): Knowledge, Workspaces, Usage, Settings, theme. Collapse prefs stay on `apps/web/lib/rail-prefs.ts`. Legal / Marketing / Students presets stay as seeded — they do not gain Finance or Data unless the owner checks those boxes.

Agents / Studio are parked. `/agents` and `/studio/**` redirect to Chat. Files stay in the tree for a later pass.

## How the rail is computed

`resolveWorkspaceModes` in `packages/core/src/agents/product-modes.ts`:

- Stored workspace `productModes` in catalog order, always including Chat.
- Missing / `null` / empty → all work modes (Home default).
- Unknown ids including parked `agents` are dropped.
- Hidden generate-studio URLs redirect to the first visible mode (Chat if present). `/` does the same.
- `/agents` and `/studio` redirect like hidden modes.

Session lists live **inside** Chat. They are never the global nav.

Redirects:

- `/` → first visible mode
- `/workspace` → `/chat`
- `/agents`, `/studio/**` → `/chat`

## Pack seeds

Packs live in their own packages. They seed workspace **preset mode lists**. They do not change kernel schema.

- **Blank** — `chat` (user adds chips; Chat always required)
- **General / Home** — every work mode
- **Students** (`packages/university`) — `chat`, `documents`, `research`, `images`, `presentations`
- **Marketing** (`packages/marketing`) — `chat`, `documents`, `images`, `videos`, `presentations`
- **Legal** (`packages/legal`) — `chat`, `documents`, `research`, `presentations`

## What each mode is for

### Chat

Default gateway chat: model picker, composer, its own sessions (`GET /api/v1/threads?scope=chat`). Uses the **chat** bucket from the live `/v1/models` probe. Default / Recommended are small everyday models (`gpt-5.6-luna`, `deepseek-v4-flash`, MiniMax M3) when live — not Sol/Pro. No specialist chips. No Build. Generate tools may remain bound so a sentence in Chat can still create media; that is not a substitute for the Images / Videos pages.

### Documents

Job, not a Word editor. Prompt → JSON sections → HTML preview → download `.docx`. Direct `/api/v1/documents` — not `/runs/*`. Uses the chat catalog with a cheap writing default (`hy3` when live, else `deepseek-v4-flash`). Settings can override the default.

### Research

Job, not Westlaw / Harvey / Kimi Deep Research. Question → `web_search` hits → sourced notes preview → Markdown download. Fails visibly without a gateway key or a Tavily/Brave key. Uses the chat catalog with a cheap default (`gpt-5.6-luna` or MiniMax M3 when live).

### Finance

Job, not a spreadsheet. Prompt plus optional pasted figures → JSON sections → HTML preview → download `.docx`. Host uses `POST /api/v1/documents` with `job: "finance"`. The finance system prompt may use only pasted figures and must never invent numbers. Starters load without a key; live generate is 503 without a key.

### Data

Table analyst, not Research. Paste a parseable CSV, ask a question, get sourced notes and a Markdown download. Host is `POST /api/v1/data` — no `web_search`. Empty or invalid CSV does not generate. Live generate is 503 without a key.

### Knowledge

Not a product mode. Account-rail page at `/knowledge`: Soul (name, role, voice, rules), pinned Memory, and Sources (paste / file / HTTPS URL). Text extract is `.txt` / `.md` / `.csv` / `.json` in v1. Chat injects soul + pinned memories + FTS-retrieved chunks. GET settings still never returns the gateway key.

### Images

Lumina-style **generate** studio: prompt bar + result gallery. Not a canvas editor. Calls generate helpers / gateway image APIs directly — not `/runs/image`. The picker lists **every** gateway image id from `/v1/models` (including Midjourney `mj_*`). Default is `gpt-image-2` when present, then Seedream 5.0 Pro.

### Videos

Same pattern for video: prompt, aspect, optional still (`image_url`), gallery. Direct generate path — not `/runs/video`. The picker lists **every** gateway video id. Cheap default is `grok-imagine-video` (or `omni-fast-v2v`); Seedance 2.5 stays in the picker as the quality option.

### Presentation

Kimi Slides **job** (topic → deck file), not Kimi Slides **product**. Prompt → JSON outline → HTML preview in-app → Download PPTX. No in-browser slide editor. Uses the chat catalog with a cheap GLM default (`glm-5.2-fast-preview` / `glm-5.2` when live; Kimi K3 is the quality pick in the picker).

### Settings

Saving a gateway API key always probes `GET /v1/models` first, then routes ids into Chat / Documents / Research / Presentation (chat bucket) and Images / Videos (generate buckets). Empty generate studios fail visibly when there is no key. No Advanced tab, no Build / Agents links. Compact this-key spend + Open Usage link; full Day/Week/Month charts live on Usage (bottom rail, not a work mode).

### Usage

Not a product mode. Bottom-rail page at `/usage`: this-key wallet, desk estimate for the selected Day / Week / Month range, stacked spend-by-model chart, and by-model list. Fetches `GET /api/v1/usage?range=day|week|month`. Desk estimate and this-key wallet will not match.

## Later (not this pass)

- In-browser slide or document editors
- Kimi Adaptive / Visual modes, Nano Banana-on-every-slide, template clone, Google Slides export
- Lumina Home hub, Audio, Avatar
- Kimi Sheets / Websites / Design
- Full canvas media editors

## What we refuse to copy

| Reference | We take | We refuse |
|-----------|---------|-----------|
| Lumina left modes | First-class Image / Video / Chat in the catalog | Home, Audio, Avatar; infinite canvas; their full agent orchestration |
| Kimi Work / Slides | Prompt → structured deck → preview + editable PPTX download | Adaptive/Visual modes, online slide editor, research-heavy Adaptive pass, multi-format upload suite as a gate |
| ChatGPT-style global thread rail | — | Mixing all sessions into the global nav; burying generate only inside Chat |

## Media path rule (do not mix)

Two different media paths exist in this repo. Details: [research/gateway-media.md](./research/gateway-media.md).

- **Generate** — make a picture/clip: `image_generate` / `video_generate` → gateway `POST /v1/images/generations` and `POST /v1/video/generations` (+ poll). Images / Videos pages must call these helpers (or new `/api/v1/images` / `/api/v1/videos` wrappers) directly.
- **Understand** — attach a file in Chat: `/runs/image` and `/runs/video` are fail-closed **input** routes (attach-and-analyze). They are **not** generate APIs.

## Related docs

- [research/kimi-and-lumina.md](./research/kimi-and-lumina.md) — sourced reference notes vs what we ship
- [research/gateway-media.md](./research/gateway-media.md) — existing generate vs understand files to reuse
