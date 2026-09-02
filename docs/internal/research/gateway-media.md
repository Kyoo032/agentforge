# Research: gateway media in this repo

Two media paths already exist. **Do not mix them.**

Canonical product IA: [../../product-modes.md](../../product-modes.md).

---

## Hard distinction

| Path | Purpose | Agentforge surfaces | Not for |
|------|---------|---------------------|---------|
| **Generate** | Make a picture or clip from a prompt | `image_generate` / `video_generate` tools; future `/images` and `/videos` pages; optional Chat tool use | Attach-and-analyze chat runs |
| **Understand** | Attach a file in Chat and reason about it | `POST .../runs/image`, `POST .../runs/video` | Creating new media |

**`/runs/image` and `/runs/video` are attach-and-analyze, NOT generate.**

**Generate** goes through platform helpers → Toko Token gateway:

- `POST /v1/images/generations` (and poll `GET /v1/images/generations/{id}` when the create response is a task)
- `POST /v1/video/generations` (then poll `GET /v1/video/generations/{id}`)

Optional Settings backends (FAL, Seedance, OpenAI Images) still enter through the same tool helpers; they are not `/runs/*`.

Images / Videos studios must call generate helpers **directly** (new `/api/v1/images` and `/api/v1/videos` wrappers), not `/runs/image` / `/runs/video`, and not “ask the chat model to call the tool.”

---

## Generate — files to reuse

| File | Role |
|------|------|
| `packages/core/src/tools/platform/image-generate.ts` | `image_generate` tool: prompt, aspect (`square` / `landscape` / `portrait`), optional `image_url`, optional model |
| `packages/core/src/tools/platform/video-generate.ts` | `video_generate` tool: prompt, aspect, optional still `image_url`, optional model; FAL / Seedance / gateway |
| `packages/core/src/tools/platform/gateway-media.ts` | `generateGatewayImage` / `generateGatewayVideo` — HTTP to gateway generations + poll |
| `packages/core/src/models/media-kind.ts` | `mediaKind()`, `routeModelsByKind()` — live catalog → chat / image / video / audio / other. Defaults `gpt-image-2` / `seedance-2.0-fast` skip `mj_*` for **default pick only**; pickers list every generate id. |
| `packages/core/src/agents/default-chat.ts` | Default chat binds `image_generate` and `video_generate` on **text** runs today (LLM-only generate UX) |
| `apps/web/lib/media.ts` | Persist under `data/media/`; `saveGeneratedImage`; Drizzle `media` table |
| Settings / credentials | Gateway key + sticky image/video backend picks (`resolveToolBackend` / secrets) |

Tests already cover gateway wire shapes: `gateway-media.test.ts`, `image-generate.test.ts`, `video-generate.test.ts`.

### Catalog routing (2026-08-29)

After the owner saves a gateway URL + key, Agentforge always `GET /v1/models`, then routes:

- **Chat / Agents / Documents / Research / Presentation** — `mediaKind === "chat"`
- **Images** — every image-classified id, including `mj_*` action ids
- **Videos** — every video-classified id, including `mj_video`

That list is the live Toko Token catalog, not a closed allowlist. Image families seen on the gateway include `gpt-image-2`, Seedream / `doubao-seedream-*`, Gemini image, `nano-banana`, Qwen image, `wan2.7-image`, `z-image-turbo`, Grok Imagine image, Midjourney `mj_*`. Video families include `seedance-*`, `doubao-seedance-*`, `dreamina-seedance-*`, Veo, Happyhorse, Grok Imagine video, `omni-fast-v2v`.

Preferred **defaults** (first present in the live list):

- Image: `gpt-image-2`
- Video: `seedance-2.0-fast`, then `seedance-2.0-mini`
- Documents: Claude Sonnet 5 → Opus 5 → Kimi K3 → GLM 5.3 → GPT-5.6 Sol
- Research: DeepSeek V4 Pro → GPT-5.6 Sol → Claude Sonnet 5
- Presentation: GPT-5.6 Sol → Claude Sonnet 5 → GLM 5.3

If a preferred id is missing, the mode falls back to Chat’s default (or the kernel image/video default).

### Generate defaults

- Image model: `gpt-image-2` (`DEFAULT_GATEWAY_IMAGE_MODEL`)
- Video model: `seedance-2.0-fast` (`DEFAULT_GATEWAY_VIDEO_MODEL`). Next pick: `seedance-2.0-mini`. `grok-imagine-video` stays in the catalog but is not the default.
- Image aspects in tool: square / landscape / portrait  
- Video aspects planned for studios: 16:9 / 9:16 / 1:1 (align with tool / catalog when implementing pages)

Gateway video POST body (Toko `POST /v1/video/generations`): Seedance-class ids send both OpenAI `prompt` (Toko returns `prompt is required` without it) and native `content: [{ type: "text", text }]` plus `duration`, `resolution: "720p"`, `ratio`, and `generate_audio: false`. Do not send OpenAI pixel `size`. Non-Seedance ids (`grok-imagine-video`) send only `model`, `prompt`, `duration`, and `seconds` — live Toko rejected both `size` and `ratio` on that upstream (`json: unknown field`). Live Toko pricing for Seedance is `tiered_expr` on completion tokens (`model_price: 0`); prepaid proxy keys return `prepaid_async_requires_fixed_price` even with wallet balance — that is an account/pricing mode, not a missing request field.

### Live video channels (2026-08-29)

Cloud Agents have **no gateway key**. Live generate cannot be proven on the VM. Prove on the Windows PC after pasting a Toko Token key in Settings.

| Model | Status |
|---|---|
| `seedance-2.0-fast` | Default for live generate tests. Gateway catalog id. |
| `seedance-2.0-mini` | Next pick if the live catalog lists it. |
| `doubao-seedance-2-0-fast-260128` | Volcengine/Ark Seedance 2.0 Fast. Used when the video backend is Volcengine, not the Toko Token gateway. |
| `grok-imagine-video` | Often HTTP 503 “no available channel” on auto. Do not default to this. |
| `gpt-image-2` (image) | Live generate succeeded earlier. Not a video model. |
| Other video catalog ids on `auto` | Often **HTTP 503** “no available channel”. Videos studio surfaces this; do not silently retry `/runs/video`. |

Without a saved gateway key, `POST /api/v1/videos` is **400** with a Settings link. HTTP 503 from the gateway stays **503** in the UI.

Probe without committing secrets:

```
pnpm --filter @agentforge/web exec tsx ../../scripts/probe-gateway-video.ts
```

The script exits 2 if no key is saved. It does not print the key.

### What generate is not

- No dedicated generate button in Chat today — only tool calls from the model.
- Studio (`/studio/new`, `/studio/[agentId]`) configures modalities/tools and share; it is **not** a generate UI.

---

## Understand (attach-and-analyze) — files to reuse

| File | Role |
|------|------|
| `apps/web/app/api/v1/threads/[threadId]/runs/image/route.ts` | Fail-closed **image input** run for a thread |
| `apps/web/app/api/v1/threads/[threadId]/runs/video/route.ts` | Fail-closed **video input** run for a thread |
| `apps/web/lib/runs.ts` | `startModalityRun` — parses modality body, asserts agent + model support, streams chat with attached parts |
| `apps/web/lib/composer-attach.ts` | Maps attachments to `image` / `video` / text routes; rejects mixed image+video |
| `apps/web/components/chat-composer.tsx` | Composer attach UI |

Wrong content type on `/runs/text|image|video` is **400**, never silently dropped (kernel fail-closed). These routes stay for Chat attach; they must not become generate APIs for `/images` or `/videos`.

---

## Studio today

| Route | What it does |
|-------|----------------|
| `/studio/new` | Configure modalities / tools for a new agent |
| `/studio/[agentId]` | Share + Open chat |

No generate gallery. Images / Videos pages are new surfaces that wrap **generate** helpers, not studio stubs.

---

## Presentations

**No slides / PPTX code in the repo today.** Presentation mode is new. Local skills (`pptx`, `frontend-slides`) may inform HTML preview and PPTX export only; they are not product dependencies to vendor into kernel.

---

## Implementation checklist (for later phases)

1. Reuse `generateGatewayImage` / `generateGatewayVideo` (or the tool `execute` paths) from new `/api/v1/images` and `/api/v1/videos`.
2. Persist with `saveGeneratedImage` / `media` and list a gallery — do **not** create a chat thread for studio generates.
3. Keep `/runs/image` and `/runs/video` unchanged as attach-and-analyze.
4. Do not weaken fail-closed modality checks on run routes.
5. Empty states: require gateway key (same Settings story); fail visibly.

---

## Summary one-liner

**Generate** = `image_generate` / `video_generate` → gateway `/v1/images/generations` and `/v1/video/generations`. **Understand** = `/runs/image` and `/runs/video` attach-and-analyze. Studios use generate only.
