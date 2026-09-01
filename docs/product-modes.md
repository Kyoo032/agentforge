# Product modes

Agentforge’s left nav is **mode-first**. Tabs come from a kernel catalog. **Which tabs appear** is the union of product surfaces on custom agents in the workspace. Packs only seed those checkboxes. Custom agents pick their own.

Gateway identity stays **Toko Token** (`api.tokotokenai.com/v1`). Do not merge Toko Token with TokenKu in copy or catalogs. Kernel stays industry-neutral: no `student` / `course` / campus nouns outside `packages/university`.

## Catalog (fixed order)

| Nav label     | Id             | Route              | Role |
|---------------|----------------|--------------------|------|
| Chat          | `chat`         | `/chat`            | Default assistant |
| Agents        | `agents`       | `/agents`          | Catalog + talk to custom agents; Build at `/studio/new` |
| Documents     | `documents`    | `/documents`       | Prompt → preview → download DOCX |
| Research      | `research`     | `/research`        | Question → web search → sourced notes → Markdown |
| Images        | `images`       | `/images`          | Prompt → generate images → gallery |
| Videos        | `videos`       | `/videos`          | Prompt → generate videos → gallery |
| Presentation  | `presentations`| `/presentations`   | Prompt → outline → HTML preview + PPTX |
| Settings      | —              | `/settings`        | Gateway key, backends, extras (not a surface) |

Bottom of the rail (not modes): Settings, Workspaces, theme. Collapse prefs stay on `apps/web/lib/rail-prefs.ts`.

Build stays reachable from Settings when the Agents tab is off. `/studio/**` and `/agents/[id]` stay valid URLs.

## How the rail is computed

`resolveProductModes` in `packages/core/src/agents/product-modes.ts`:

- Default Chat (`quick-chat`) never contributes.
- No custom agents, or every custom agent unlocks nothing → **Chat + Agents**.
- Otherwise: union of each custom agent’s published `productModes`, in catalog order.
- Missing / `null` `productModes` on an old agent → original five (`chat`, `agents`, `images`, `videos`, `presentations`).
- Explicit `[]` unlocks nothing from that agent.
- Hidden generate-studio URLs redirect to the first visible mode (Chat if present). `/` does the same.

Session lists live **inside** Chat (and inside an agent). They are never the global nav.

Redirects:

- `/` → first visible mode
- `/workspace` → `/agents`
- `/chat/[agentId]` → `/agents/[agentId]`

## Pack seeds

Packs live in their own packages. They seed `productModes` + tools + prompt. They do not change kernel schema.

- **Blank** — `chat` (user adds chips; at least one required)
- **Default** (`packages/core`) — original five (full current workbench)
- **Students** (`packages/university`) — `chat`, `documents`, `research`, `images`, `presentations`
- **Marketing** (`packages/marketing`) — `chat`, `documents`, `images`, `videos`, `presentations`
- **Legal** (`packages/legal`) — `chat`, `documents`, `research`, `presentations`

## What each mode is for

### Chat

Default gateway chat: model picker, composer, its own sessions (`GET /api/v1/threads?scope=chat`). Uses the **chat** bucket from the live `/v1/models` probe. No specialist chips. No Build. Generate tools may remain bound so a sentence in Chat can still create media; that is not a substitute for the Images / Videos pages.

### Agents

Custom agents platform: catalog at `/agents`, Build at `/studio/new`, talk at `/agents/[agentId]`. Studio configures modalities, tools, and product surfaces. Agent models come from the same **chat** bucket; each agent pins its own `version.model`.

### Documents

Job, not a Word editor. Prompt → JSON sections → HTML preview → download `.docx`. Direct `/api/v1/documents` — not `/runs/*`. Uses the chat catalog with a writing-first preferred default (Claude / Kimi / GLM / GPT-5 family when live). Settings can override the default.

### Research

Job, not Westlaw / Harvey / Kimi Deep Research. Question → `web_search` hits → sourced notes preview → Markdown download. Fails visibly without a gateway key or a Tavily/Brave key. Uses the chat catalog with a tool/reasoning preferred default (DeepSeek / GPT-5.6 / Claude when live).

### Images

Lumina-style **generate** studio: prompt bar + result gallery. Not a canvas editor. Calls generate helpers / gateway image APIs directly — not `/runs/image`. The picker lists **every** gateway image id from `/v1/models` (including Midjourney `mj_*`). Default remains `gpt-image-2` when present.

### Videos

Same pattern for video: prompt, aspect, optional still (`image_url`), gallery. Direct generate path — not `/runs/video`. The picker lists **every** gateway video id. Default remains `seedance-2.0-fast` when present.

### Presentation

Kimi Slides **job** (topic → deck file), not Kimi Slides **product**. Prompt → JSON outline → HTML preview in-app → Download PPTX. No in-browser slide editor. Uses the chat catalog with a structured-outline preferred default (`gpt-5.6-sol` / Claude / GLM when live).

### Settings

Saving a gateway URL + API key always probes `GET /v1/models` first, then routes ids into Chat / Documents / Research / Presentation (chat bucket) and Images / Videos (generate buckets). Empty generate studios fail visibly when there is no key. Includes a Build / Agents link so a desk without an Agents tab can still create another agent.

## Later (not this pass)

- In-browser slide or document editors
- Kimi Adaptive / Visual modes, Nano Banana-on-every-slide, template clone, Google Slides export
- Lumina Home hub, Audio, Avatar
- Kimi Sheets / Websites / Design
- Full canvas media editors

## What we refuse to copy

| Reference | We take | We refuse |
|-----------|---------|-----------|
| Lumina left modes | First-class Image / Video / Agent / Chat in the catalog | Home, Audio, Avatar; infinite canvas; their full agent orchestration |
| Kimi Work / Slides | Prompt → structured deck → preview + editable PPTX download | Adaptive/Visual modes, online slide editor, research-heavy Adaptive pass, multi-format upload suite as a gate |
| ChatGPT-style global thread rail | — | Mixing all sessions into the global nav; burying generate only inside Chat |

## Media path rule (do not mix)

Two different media paths exist in this repo. Details: [research/gateway-media.md](./research/gateway-media.md).

- **Generate** — make a picture/clip: `image_generate` / `video_generate` → gateway `POST /v1/images/generations` and `POST /v1/video/generations` (+ poll). Images / Videos pages must call these helpers (or new `/api/v1/images` / `/api/v1/videos` wrappers) directly.
- **Understand** — attach a file in Chat: `/runs/image` and `/runs/video` are fail-closed **input** routes (attach-and-analyze). They are **not** generate APIs.

## Related docs

- [research/kimi-and-lumina.md](./research/kimi-and-lumina.md) — sourced reference notes vs what we ship
- [research/gateway-media.md](./research/gateway-media.md) — existing generate vs understand files to reuse
