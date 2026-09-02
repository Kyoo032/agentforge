# Product modes

Agentforge’s left nav is **mode-first**. Tabs come from a kernel catalog. **Which tabs appear** is the current workspace’s `productModes`. Home stores every work mode. Creating another desk (Legal, Marketing, Students, or custom checkboxes) can shrink or grow that rail. Packs are workspace presets. Custom agents do not drive the rail.

Gateway identity stays **Toko Token** (`api.tokotokenai.com/v1`). Do not merge Toko Token with TokenKu in copy or catalogs. Kernel stays industry-neutral: no `student` / `course` / campus nouns outside `packages/university`.

## Catalog (fixed order)

| Nav label     | Id             | Route              | Role |
|---------------|----------------|--------------------|------|
| Chat          | `chat`         | `/chat`            | Default assistant |
| Documents     | `documents`    | `/documents`       | Prompt → preview → download DOCX |
| Research      | `research`     | `/research`        | Question → web search → sourced notes → Markdown |
| Images        | `images`       | `/images`          | Prompt → generate images → gallery |
| Videos        | `videos`       | `/videos`          | Prompt → generate videos → gallery |
| Presentation  | `presentations`| `/presentations`   | Prompt → outline → HTML preview + PPTX |
| Settings      | —              | `/settings`        | Gateway key, usage, privacy (not a surface) |

Bottom of the rail (not modes): workspace switcher, Workspaces, Settings, theme. Collapse prefs stay on `apps/web/lib/rail-prefs.ts`.

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

### Images

Lumina-style **generate** studio: prompt bar + result gallery. Not a canvas editor. Calls generate helpers / gateway image APIs directly — not `/runs/image`. The picker lists **every** gateway image id from `/v1/models` (including Midjourney `mj_*`). Default is `gpt-image-2` when present, then Seedream 5.0 Pro.

### Videos

Same pattern for video: prompt, aspect, optional still (`image_url`), gallery. Direct generate path — not `/runs/video`. The picker lists **every** gateway video id. Cheap default is `grok-imagine-video` (or `omni-fast-v2v`); Seedance 2.5 stays in the picker as the quality option.

### Presentation

Kimi Slides **job** (topic → deck file), not Kimi Slides **product**. Prompt → JSON outline → HTML preview in-app → Download PPTX. No in-browser slide editor. Uses the chat catalog with a cheap GLM default (`glm-5.2-fast-preview` / `glm-5.2` when live; Kimi K3 is the quality pick in the picker).

### Settings

Saving a gateway API key always probes `GET /v1/models` first, then routes ids into Chat / Documents / Research / Presentation (chat bucket) and Images / Videos (generate buckets). Empty generate studios fail visibly when there is no key. No Advanced tab, no Build / Agents links.

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
