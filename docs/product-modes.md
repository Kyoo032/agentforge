# Product modes (locked IA)

Agentforge’s left nav is **mode-first**, inspired by Lumina-style Image/Video/Agent/Chat and Kimi Work’s Slides idea — not a full clone of either product. This file is the locked information architecture for coding agents and UI work.

Gateway identity stays **Toko Token** (`api.tokotokenai.com/v1`). Do not merge Toko Token with TokenKu in copy or catalogs. Kernel stays industry-neutral: no `student` / `course` / campus nouns outside `packages/university`.

## Nav labels and routes

| Nav label     | Route              | Role |
|---------------|--------------------|------|
| Chat          | `/chat`            | Default assistant only |
| Agents        | `/agents`          | Catalog + talk to custom agents; Build at `/studio/new` |
| Images        | `/images`          | Prompt → generate images → gallery |
| Videos        | `/videos`          | Prompt → generate videos → gallery |
| Presentation  | `/presentations`   | Prompt → outline → HTML preview + PPTX download |
| Settings      | `/settings`        | Gateway key, backends, extras |

Bottom of the rail (not “modes”): Settings, Workspaces, theme. Collapse prefs stay on `apps/web/lib/rail-prefs.ts`.

Active states:

- **Chat** — `/chat` only (not agent talk routes)
- **Agents** — `/agents` and `/studio/**`
- **Images** — `/images`
- **Videos** — `/videos`
- **Presentation** — `/presentations`

Session lists live **inside** Chat (and inside an agent). They are never the global nav.

Redirects (when Chat vs Agents split lands):

- `/` → `/chat`
- `/workspace` → `/agents`
- `/chat/[agentId]` → `/agents/[agentId]`

## What each mode is for

### Chat

Default gateway chat: model picker, composer, its own sessions (`GET /api/v1/threads?scope=chat`). No specialist chips. No Build. Generate tools may remain bound so a sentence in Chat can still create media; that is not a substitute for the Images / Videos pages.

### Agents

Custom agents platform: catalog at `/agents`, Build at `/studio/new`, talk at `/agents/[agentId]`. Studio configures modalities/tools; it is not an image/video generate UI.

### Images

Lumina-style **generate** studio: prompt bar + result gallery. Not a canvas editor. Calls generate helpers / gateway image APIs directly — not `/runs/image`, not “ask the chat model to call the tool.”

### Videos

Same pattern for video: prompt, aspect, optional still (`image_url`), gallery. Direct generate path — not `/runs/video`.

### Presentation

Kimi Slides **job** (topic → deck file), not Kimi Slides **product**. Prompt → JSON outline → HTML preview in-app → Download PPTX. No in-browser slide editor in v1.

### Settings

Gateway API key and optional backends (FAL, Seedance, native providers). Empty generate studios fail visibly when there is no key.

## v1 vs later

### v1 ships

- Mode nav: Chat / Agents / Images / Videos / Presentation / Settings
- Chat vs Agents split (default sessions vs custom agents)
- `/images` and `/videos` prompt + gallery on existing gateway generate tools (defaults `gpt-image-2` / `grok-imagine-video`)
- `/presentations`: outline → HTML preview + PPTX download (`pptxgenjs`; no LibreOffice)
- Chat may keep `image_generate` / `video_generate` on text runs

### Later (not v1)

- In-browser slide editor
- Kimi Adaptive / Visual modes, Nano Banana-on-every-slide, template clone, Deep Research, Google Slides export
- Lumina Home hub, Audio, Avatar
- Kimi Docs / Sheets / Websites / Design
- Full canvas media editors
- Command Deck copy, SQLite/desktop migration as part of this modes pass

## What we refuse to copy

| Reference | We take | We refuse |
|-----------|---------|-----------|
| Lumina left modes | First-class Image / Video / Agent / Chat in the rail | Home, Audio, Avatar; infinite canvas; their full agent orchestration |
| Kimi Work / Slides | Prompt → structured deck → preview + editable PPTX download | Adaptive/Visual modes, online slide editor, research-heavy Adaptive pass, multi-format upload suite as a gate |
| ChatGPT-style global thread rail | — | Mixing all sessions into the global nav; burying generate only inside Chat |

## Media path rule (do not mix)

Two different media paths exist in this repo. Details: [research/gateway-media.md](./research/gateway-media.md).

- **Generate** — make a picture/clip: `image_generate` / `video_generate` → gateway `POST /v1/images/generations` and `POST /v1/video/generations` (+ poll). Images / Videos pages must call these helpers (or new `/api/v1/images` / `/api/v1/videos` wrappers) directly.
- **Understand** — attach a file in Chat: `/runs/image` and `/runs/video` are fail-closed **input** routes (attach-and-analyze). They are **not** generate APIs.

## Related docs

- [research/kimi-and-lumina.md](./research/kimi-and-lumina.md) — sourced reference notes vs what we ship
- [research/gateway-media.md](./research/gateway-media.md) — existing generate vs understand files to reuse
