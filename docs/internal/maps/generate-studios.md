# Map — Generate studios (Images and Videos)

Last verified: 2026-09-30, working tree, not committed, for step 5 of § 2 and the `videos-studio-seconds` bullet (the video preference order of that day, [`model-policy.md`](model-policy.md) § 7; not driven in a browser). Before that: 2026-09-29 for § 2's `items` and § 9's gallery (a row whose file is gone, and what a tile mounts), working tree, not committed. Before that, the same day: step 3 of the catalog pipeline (what the models.dev cache keeps). Before that: 2026-09-26 for the Videos picker (probed models only, empty default, not-on-key copy in both locales) and the Images needs-key note (same `allowed` flag as submit). Before that: 2026-09-20 at 6984d84; citations re-anchored at e37b3a1.

## Overview

Two sibling pages, `/images` and `/videos`, that turn a prompt plus a few knobs into a file in a local gallery. They are **generate studios, not editors**: there is no canvas, no layers, no timeline (that is `/edit`), and no chat thread. Each one is a single fetch-on-mount for its own list, a form, and a grid.

The thing to hold onto: **a studio never goes through the chat run pipeline.** It posts to its own route (`POST /api/v1/images` / `POST /api/v1/videos`), which calls the platform generate tool *directly* — no thread, no run row, no SSE. The `/runs/image` and `/runs/video` routes next door look related and are not: they are attach-and-analyse, and they demand an `image_url` / `video_url` content part rather than producing one.

The second thing: **whatever the gateway returns is mirrored before the user sees it.** The renderer only paints host-served media, so the studio's success path ends with a local `/api/v1/media/<id>/file` path, never the vendor's URL. That half of the story is [`renderer-media.md`](renderer-media.md); the price line above the button is [`media-cost-estimate.md`](media-cost-estimate.md). This page is the spine the two of them hang off.

## How it works

### 1. Getting there, and staying there

`mode-images` / `mode-videos` on the left rail are `mode-${href.slice(1)}` buttons (`apps/web/components/app-rail.tsx:330-341`). The route maps to a component in `WORK_MODE_COMPONENTS` (`apps/web/components/work-mode-keep-alive.tsx:18-32`): `/images` → `ImagesStudio`, `/videos` → `VideosStudio`.

`WorkModePanes` (`apps/web/components/work-mode-keep-alive.tsx:50-81`) **keeps every visited work mode mounted** and hides the inactive ones with `hidden` plus a `hidden` class, so in-flight state survives a rail switch. The whole set remounts when the workspace scope id changes (`key={id ?? "boot"}`, `:41-44`). Consequence for anyone driving the app: after visiting `/images` and then `/videos`, `images-studio` is still in the DOM (count 1, not visible) and any testid the two pages share — `example-gallery` is the one that bites — resolves to **two** elements.

### 2. Mount → `GET /api/v1/images` (or `/videos`)

`load()` (`apps/web/components/images-studio.tsx:55-78`, `apps/web/components/videos-studio.tsx:69-92`) runs once from an effect (`:80-82` / `:94-96`) and is the only read. It fills four pieces of state from one payload:

```
{ items: GalleryItem[], models: StudioModel[], defaultModel: string, ready: boolean }
```

On the host, `handleGetImages` (`packages/host/src/handlers/jobs.ts:39-65`) and `handleGetVideos` (`:72-96`) assemble it. Neither calls `requireGatewayAllowed` — **both GETs are ungated on purpose**, which is why the page renders fully with no key.

- `items` ← `listStudioGallery(tenant, "image"|"video")` (`packages/host/src/studio-generate.ts:566-593`): `media` rows for this organization, newest first (`listMediaByKind`, `packages/host/src/media.ts:36-42`), each joined against a sidecar `studio-meta.json` next to the media store (`packages/host/src/studio-media-meta.ts:22-24`) for prompt / aspect / model. The sidecar is best-effort; a missing entry just means a caption-less tile. A row whose file is gone from the store carries `fileMissing: true` (`:119`, set at `:589`): `missingTenantObjects` (`packages/host/src/tenant-storage.ts:631`) `stat`s each row's `storagePath` in batches of 16 (`:614`) on the file backend, and reports nothing under COS, where each answer would be a network `HEAD`. The row stays listed, because it is the owner's data and nothing here deletes it. On the dev desk 36 of 72 video rows answered 404 on `/api/v1/media/<id>/file` and none was marked.
- `models` ← `listStudioImageModels()` / `listStudioVideoModels()` then `attachMediaPrices(...)` (`packages/host/src/handlers/jobs.ts:48-53`, `:87-91`). The price half is [`media-cost-estimate.md`](media-cost-estimate.md). Images still come from the merged catalog. Videos come only from `listProbedVideoModels` (`packages/host/src/selectable-models.ts:103-105`): the four dialect arrays in `models-cache.json`, `mediaKind === "video"`, with no static `CHAT_MODELS` fill-in. A Seedance id the refresh did not return is not in the list and is not priced.
- `defaultModel` ← `resolveStudioGenerateDefault` (`packages/core/src/agents/generate-defaults.ts:96-119`): the oldest custom agent that unlocks this surface and carries an `imageGenModel` / `videoGenModel` pin, else the Settings pin, else the catalog preference. On Videos the pin is kept only when that id is in the probed list (`packages/host/src/handlers/jobs.ts:94-102`); otherwise the default is `availableVideoDefault` (`packages/core/src/models/key-models.ts`), which is `""` when the refresh listed no video model. It does not invent `grok-imagine-video`.
- `ready` ← `studioRouteReady("image_gen"|"video_gen", workspaceId)` (`packages/host/src/studio-generate.ts:259-262`).

### 3. Where the model list comes from — `/v1/models`, cached, then bucketed

The picker is **not** fed by the app's own `/api/v1/models`. It is fed by the studio GET, which reads the same in-process catalog:

1. **Probe.** `refreshModelCache` (`packages/host/src/selectable-models.ts:223-314`) calls `detectCompatibleApi` against the pinned gateway, which is a `GET /v1/models` with the saved key. A desk with no key and no custom gateway **never calls out** (`:207-225`) — and on the way through it also clears any stale `openaiError` so a keyless desk does not keep showing "unreachable".
2. **Persist.** The result lands in `models-cache.json` under the desk's data dir (`packages/host/src/model-cache.ts:22-30`). **This file outlives the key.** Removing the key does not empty the picker — the owner's `:3000` desk is keyless and still lists 40 image ids and 22 video ids, from the last live probe.
3. **Merge.** `listCatalogModels()` (`packages/host/src/selectable-models.ts:57-74`) merges the four dialect caches and stamps context lengths from the models.dev registry, memoized on the two cache files' mtime+size. The registry this holds is a projection, one `context_length` per model that announces one (`projectContextRegistry`, `packages/host/src/models-dev-cache.ts:34`), read back from a cache file that is now ~0.4 MB instead of 8.7 MB; freshness comes from a `models-dev-cache.meta.json` sidecar, so deciding whether to re-download no longer parses the registry.
4. **Bucket.** `routeModelsByKind` (`packages/core/src/models/media-kind.ts`) puts every id in exactly one of `chat / image / video / audio / other` by running `mediaKind(id)`. `listImageModels()` / `listVideoModels()` are `routed.image` / `routed.video` (`packages/host/src/selectable-models.ts:90-96`). Images studio uses that merged list. Videos studio does not: `listStudioVideoModels` defaults to `listProbedVideoModels` (`packages/host/src/studio-generate.ts:144-146`), the probed rows only.
5. **Prefer.** `pickPreferredImageModel` / `pickPreferredVideoModel` (`packages/core/src/models/media-kind.ts`) walk `IMAGE_PREF` (`gpt-image-2` first) / `VIDEO_PREF` (`packages/core/src/models/media-kind.ts:46`: `seedance-2.0`, its dated Doubao spelling, `seedance-2.5`, then Veo fast, Grok Imagine and Omni; the live catalogue of 2026-09-30 lists only the two Seedance ids) and, when nothing matches, fall back to `DEFAULT_GATEWAY_IMAGE_MODEL` / `DEFAULT_GATEWAY_VIDEO_MODEL`. The Videos studio default does not take that last step: `defaultStudioVideoModel` (`packages/host/src/studio-generate.ts:152-154`) calls `availableVideoDefault`, which returns `""` unless the chosen id is in the probed list.

`ModelSelect` (`apps/web/components/model-select.tsx:41-77`) renders it as a plain `<select>` with `<optgroup>`s from `pickerGroups` (`packages/core/src/models/preferred.ts:336-361`), which also applies the chat hide-list and drops dated snapshots. Core returns each group as `{ kind, label, models }` with `kind` one of `recommended | brand | other` (`:332-334`); the renderer turns the two groups that are words into the desk's language through `pickerGroupLabel` (`apps/web/lib/picker-group-label.ts`, catalog `chat.models.groups.*`: "Recommended" is "Disarankan" and "Other" is "Lainnya" in Bahasa Indonesia), leaves brand names alone, and names the flat embeddings list from `chat.models.groups.embeddings` (`model-select.tsx:55`). Until 2026-09-29 these headings were English literals in both locales. Each option label ends with the price hint the studio attached (`apps/web/components/model-select.tsx:32-38`), e.g. `gpt-image-2 · 272K · $0.03/gbr`.

### 4. The needs-key state

Videos still renders its note from route `ready`:

```tsx
{!ready && !loading ? (<p data-testid="videos-studio-needs-key">…</p>) : null}
```

Images renders the same testid from the host gate, the same flag that disables submit:

```tsx
{needsKey && !loading ? (<p data-testid="images-studio-needs-key">…</p>) : null}
```

`needsKey` is `useDeskNeedsKey()` → `hostWithholdsLiveModel`, true only when `allowed === false`. A stub desk (`status: "stub"`, `allowed: true`) hides the Images note and leaves Generate enabled. A closed gate shows the note and disables the button.

`SettingsLinkHint` (`apps/web/components/settings-link-hint.tsx:7-31`) splits the catalog string on a sentinel and drops a real `<a href="/settings">` in the gap, so the banner is always a working link and never hard-codes English.

`ready` walks back to `listToolRoutes` (`packages/core/src/tools/credentials.ts:362-372`) resolving the `image_gen` / `video_gen` capability. Both declare backends `gateway` → `fal` → (`openai` / `volcengine`) with an autodetect order of `["gateway", "fal"]` (`:83-107`, `:108-132`), and a backend is ready when its env var is populated from `secretMapFromSettings` (`:267-309`). No `OPENAI_API_KEY` and no `FAL_KEY` means no ready backend means `ready: false`. Videos disables `videos-studio-submit` while `!ready`. Images does not: submit follows `allowed`, so a keyless stub desk can still generate.

### 5. Knob snapping — the model decides which controls exist

`packages/core/src/models/video-capabilities.ts` is the whole rule set, and the Videos studio re-derives it on every render (`apps/web/components/videos-studio.tsx:98-99`).

`videoCapabilities(model)` (`:56-59`) picks one of two profiles and then overrides one field:

| | `ratio` | `resolution` | `seconds` | `still` |
|---|---|---|---|---|
| `SEEDANCE_ALL` (`:17-22`) | ✔ | ✔ | ✔ | ✔ |
| `OPENAI_LIKE` (`:24-29`) | ✘ | ✘ | ✔ | ✔ |

`usesSeedanceVideoWire` (`:32-34`) chooses between them, and its regex is `seedance|dreamina-seedance|doubao-seedance|veo_|kling|sora` — **"Seedance-class" includes Veo, Kling and Sora.** `imageToVideo` is a separate, honest gate (`imageToVideoForModel`, `:40-54`) that returns false for `mj_video` and `omni-fast-v2v` even though their profile's legacy `still` flag is true; the comment at `:36-39` says so out loud.

What the three knobs do with that:

- **`videos-studio-resolution`** is `disabled` when `!caps.resolution` (`apps/web/components/videos-studio.tsx:240`) and is dropped from the POST body entirely when the model is not Seedance-wire (`:156`). The live matrix proved why: `grok-imagine-video` answers `json: unknown field "ratio"`.
- **`videos-studio-seconds`** lists `allowedVideoSeconds(model)` (`packages/core/src/models/video-capabilities.ts:68-73`), which is `[4, 6, 8]` for any `veo[_-]` id and `[5, 8, 10]` for everything else. When the model changes, an effect re-snaps the current value through `snapVideoSeconds` (`:76-80`, called from `apps/web/components/videos-studio.tsx:101-103`) — nearest allowed length, ties to the shorter clip. Driven: 10 s on `seedance-2.0-fast`, switch to `veo_3_1-fast`, the select lands on 8.
- **`videos-studio-still`** is not rendered at all when `!caps.imageToVideo`; a muted "text to video only" line takes its place (`apps/web/components/videos-studio.tsx:274-286`). A second effect clears any typed URL when the capability goes away (`:105-109`), so a stale still cannot ride along after a model switch.

Images has one knob, `images-studio-aspect` (`square` / `landscape` / `portrait`, `apps/web/components/images-studio.tsx:41`), and it is not model-dependent in the UI at all.

### 6. Submit → `POST /api/v1/images` or `/api/v1/videos`

`onSubmit` (`apps/web/components/images-studio.tsx:91-118`, `apps/web/components/videos-studio.tsx:139-174`) posts JSON through `apiFetch`, so the packaged app routes it over IPC exactly like Chat does. The video body carries `seconds` always and `resolution` only when the model is Seedance-wire (`:150-157`). On a 2xx it clears the prompt and re-runs `load()` — the new clip appears because the **gallery is re-fetched**, not because anything was pushed into local state.

On the host, `handlePostImages` / `handlePostVideos` (`packages/host/src/handlers/jobs.ts:67-77`, `:98-108`) are four lines each and in this order:

1. `getTenant(request.workspaceId)`
2. `requireGatewayAllowedFor(tenant)` — **this is the gate**, and it lives only on the POSTs. See [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md).
3. `parseImageGenerateBody` / `parseVideoGenerateBody` (`packages/host/src/studio-generate.ts:176-217`) — zod, a 400 on the first issue. The video parser adds one semantic check before anything runs: an `imageUrl` on a model whose `imageToVideo` is false is `video_still_unsupported`, 400 (`:103-105`).
4. `generateStudioImage` / `generateStudioVideo`, answered `201`.

### 7. The generate helper — no run, no thread, no stream

`generateStudioImage` (`packages/host/src/studio-generate.ts:267-322`):

1. Resolve the model: body → `settings.imageGenModel` → `defaultStudioImageModel()` (`:162`).
2. `runWithToolSecrets(buildToolSecretScope(settings), …)` (`:161`, `:163`) — the secret scope is an async-local map, so the tool reads its key through `getSecret` instead of being handed one.
3. `imageGenerateTool.execute({ prompt: withImageOutputLanguage(maskPii(prompt), locale), aspect_ratio, image_url, model })` (`:163-173`). **The prompt is PII-masked and locale-stamped before it leaves the process.**
4. `toolSuccessUrl(output, "image")` (`:119-129`) insists on `success === true` plus a non-empty string. Anything else is `tool_failed`, 400, carrying the tool's own error text (`:174-177`).
5. `saveGeneratedImage(tenant, url)` mirrors it (`:178-179`) → a local `/api/v1/media/<id>/file`.
6. Sidecar meta (`:183-190`) and a Knowledge work card (`:191-202`, `packages/host/src/work-cards.ts:98-117`) — a text card holding the prompt, aspect, model and a `media:<id>` pointer. **No bytes go to Knowledge.**

`generateStudioVideo` (`:207-268`) is the same shape with three differences: it re-checks `studioRouteReady("video_gen")` itself and 400s with `gatewayRequiredMessage` (`:212-214`) — the image path has no such check; it re-checks the still gate against the *resolved* model rather than the body's (`:218-220`); and it snaps the clip length server-side with `snapVideoSeconds(model, body.seconds)` (`:228`) so a hand-written body cannot ask Veo for 5 seconds. Its failure status is not a flat 400 but `studioVideoFailureStatus(message)` (`packages/core/src/tools/platform/gateway-media.ts:83-91`), which lifts 503 for "no live gateway channel" / upstream-rejected and 401 for a rejected key.

### 8. The wire

Both tools resolve their backend first and return a **structured failure rather than throwing** when there is none (`packages/core/src/tools/platform/image-generate.ts:62-72`, `packages/core/src/tools/platform/video-generate.ts:120-134`) — which is exactly how a keyless submit becomes a 400 with a "add a key in Settings" message instead of a 403.

**Images**, gateway backend (`packages/core/src/tools/platform/gateway-media.ts:303-396`): `POST <base>/images/generations` with `{ model, prompt, size }`, plus `quality: "medium"` for any `gpt-image` id (`:311-313`), plus `image` when editing. `size` comes from `openaiImageSize` (`:145-153`): `1024x1024` / `1536x1024` / `1024x1536`. **Every gateway image model gets OpenAI pixel sizes**, not a ratio string. A 180 s `AbortSignal.timeout` guards both the create and each poll, and a timeout is reported with an explicit "may already have billed" warning (`:292-293`).

**Videos**, gateway backend (`:398-453`): `POST <base>/video/generations`, then poll `<base>/video/generations/<taskId>` up to 90 times at 2 s. `buildGatewayVideoPayload` (`:162-207`) is the fork:

- Seedance-wire (`:172-192`): `content[]`, `duration`, `resolution`, `ratio`, `generate_audio: false`, `watermark: false`, and a still attached twice — inside `content` as `role: "first_frame"` and at the top level as `image`, because Veo and Kling read the generic field.
- Everything else (`:197-206`): `{ model, prompt, duration, seconds: String(duration) }` and nothing more. The comment above it records why — grok rejected pixel `size`, then rejected `ratio`.

`clampVideoSeconds` (`packages/core/src/models/video-capabilities.ts:82-87`) squeezes duration into 2–12 one last time here, so there are **three** snap points on a video request: the UI effect, the host helper, and the payload builder.

### 9. Gallery and serving

`items` render as a grid (`apps/web/components/images-studio.tsx:228-248`, `apps/web/components/videos-studio.tsx:351-385`), each `src` passed through `mediaSrc` (`apps/web/lib/api-client.ts` → `apps/web/lib/media-src.ts:12-23`), which rewrites `/api/v1/media/<id>/file` to `agentforge://media/<id>` inside the packaged shell and leaves it alone in the browser. Videos add a per-clip download anchor, `videos-studio-download` (`apps/web/components/videos-studio.tsx:370-380`), which a `fileMissing` row does not get. An empty list renders nothing (`items.length === 0 ? null`); there is no empty-state tile any more, and `images-studio-empty` / `videos-studio-empty` no longer exist.

**What a tile mounts** (`apps/web/components/gallery-media.tsx`, shared by Images, Videos and Music). The Videos page used to mount one bare `<video controls>` per row, with no `preload` and no error state: 72 rows plus the 6 bundled examples was 78 video elements on one page, and half the rows had no file. Now:

- A row the host marks `fileMissing`, or whose file fails to load (`onError`, `:106` / `:121` / `:137`), shows `MediaMissingTile` (`:64`, `data-testid="media-missing"` at `:70`, words in `common.mediaMissing.*` in both locales) at the player's size, and mounts no player, so it asks for nothing.
- `GalleryVideo` (`:80`) mounts its `<video>` only once its tile has been within 300 px of the viewport (`useNearViewport`, `:38`, an `IntersectionObserver`; it never un-mounts a tile that has been seen) and is `preload="none"` except the newest four (`GALLERY_METADATA_COUNT`, `:23`), which fetch `metadata` so the top of the gallery is not a wall of black. Driven headless at 1280 px on the dev desk: 6 `<video>` on first paint, all 6 bundled examples, and 0 media requests; scrolling the whole gallery mounted 68 of 72 rows with `preload="none"` and made 4 media requests (the newest four), not 72.
- `GalleryImage` (`:124`) is `loading="lazy"`; `GalleryAudio` (`:114`) is `preload="none"`.
- **A hidden Browser pane mounts no gallery player.** `IntersectionObserver` does not fire while `document.visibilityState` is `"hidden"`, so a drive that counts `<video>` in the gallery from the IDE's Browser pane sees 0. Use a visible window or headless Chromium.

`GET /api/v1/media/:mediaId/file` → `handleGetMediaFile` (`packages/host/src/handlers/media.ts:25-51`), routed at `packages/host/src/router.ts:299`, ungated, scoped by `organizationId`, served through `readByteRange` (`packages/host/src/byte-range.ts:86-106`) so scrubbing a clip reads only the requested bytes. The bundled example clips have their own pair of routes (`packages/host/src/router.ts:304-305`).

### Failure modes

| Failure | Where | What the client gets |
|---|---|---|
| No key / no backend ready | `resolveToolBackend` inside the tool (`image-generate.ts:62-72`, `video-generate.ts:120-134`) | `{ success: false, error }` → `tool_failed` **400**, "add a Toko Token gateway key in Settings". A stub Images desk (`allowed: true`) can still post; Videos cannot (button disabled on `!ready`). A closed gate disables Images before the post. |
| Gate closed | `requireGatewayAllowed`, `packages/host/src/handlers/jobs.ts:71` (and the video twin at `:102`) | HTTP 403, flat `{error:"gateway_blocked", status, message}`. Both studios show it through `*-studio-error`, since they read `data.error?.message` and the flat body has none — the generic "generate failed" copy wins. |
| Empty prompt / bad aspect / out-of-range seconds | zod in `parseImageGenerateBody` / `parseVideoGenerateBody` | HTTP 400, `{error:{code:"invalid_content_part", message}}` |
| Still on a text-only model | `studio-generate.ts:103-105` (body model) and `:218-220` (resolved model) | HTTP 400, `video_still_unsupported` |
| Video route not ready | `studio-generate.ts:212-214` | HTTP 400, `gatewayRequiredMessage("videos")`. **The image path has no equivalent guard.** |
| Gateway non-2xx on create | `generateGatewayVideo` (`gateway-media.ts:415-424`) | status mapped by `httpStatusForGatewayFailure` (`:53-58`): 401/403/404/429/503 pass through, everything else is 502; message widened by `formatVideoGatewayFailure` (`:60-71`) |
| Prepaid proxy key on a Seedance async job | `isPrepaidAsyncPriceError` (`:93-95`) | 403 with the long "billed by tokens after the job finishes … this is not an invalid API key" explanation |
| Upstream refused an accepted job | `formatVideoJobFailure` (`:76-81`), `UPSTREAM_REJECTED` at `:73` | 503 via `studioVideoFailureStatus` |
| Job polls out | `gateway-media.ts:452` (video), `:390` (image) | `tool_failed` 504, "job timed out" |
| Generated URL cannot be mirrored | `saveGeneratedImage` / `saveGeneratedVideo` → `downloadGeneratedMedia` | throws; the studio shows the error and **no gallery row is created**. See [`renderer-media.md`](renderer-media.md). |
| Sidecar meta write fails | `persistMeta` (`studio-generate.ts:141-147`) | swallowed on purpose — the tile appears without a caption |
| Gallery row whose file is gone | `readByteRange` → `stat` ENOENT, caught by `jsonError` | HTTP **500** `internal_error` **with the absolute host path in the message**. Open finding, see Gotchas. |

## Where things live

| File | Role |
|---|---|
| `apps/web/components/images-studio.tsx` | The whole Images page: load, aspect, picker, estimate, prompt, gallery |
| `apps/web/components/videos-studio.tsx` | The whole Videos page, plus the four knobs and the capability effects |
| `apps/web/components/work-mode-keep-alive.tsx` | Route → studio component, and the mounted-but-hidden pane behaviour |
| `apps/web/components/model-select.tsx` | The `<select>` both studios use; option label + price hint |
| `apps/web/components/video-examples.tsx` | Bundled example clips, `videos-example-use-*` → prompt template |
| `apps/web/components/settings-link-hint.tsx` | The needs-key banner's Settings link |
| `apps/web/lib/api-client.ts`, `apps/web/lib/media-src.ts` | `apiFetch` transport switch; `/api/v1/media/…` → `agentforge://media/…` |
| `packages/host/src/handlers/jobs.ts` | `GET`/`POST` for both studios; the gate sits on the POSTs only |
| `packages/host/src/studio-generate.ts` | Body schemas, model lists, `studioRouteReady`, the two generate helpers, gallery listing |
| `packages/host/src/selectable-models.ts` | `/v1/models` probe → `models-cache.json` → merged catalog → routed buckets |
| `packages/host/src/model-cache.ts` | Where the probed catalog is persisted, and its memo stamp |
| `packages/core/src/models/media-kind.ts` | `mediaKind`, `routeModelsByKind`, the preference lists and the default ids |
| `packages/core/src/models/video-capabilities.ts` | Capability profiles, `allowedVideoSeconds`, `snapVideoSeconds`, `clampVideoSeconds` |
| `packages/core/src/tools/platform/image-generate.ts`, `video-generate.ts` | The two platform tools and their FAL / Volcengine alternates |
| `packages/core/src/tools/platform/gateway-media.ts` | Wire payloads, poll loops, error classification |
| `packages/core/src/tools/credentials.ts` | `image_gen` / `video_gen` capability definitions; `listToolRoutes`, `buildToolSecretScope` |
| `packages/core/src/agents/generate-defaults.ts` | Which model the picker opens on |
| `packages/host/src/media.ts`, `handlers/media.ts`, `byte-range.ts` | Save, list and serve the bytes |
| `packages/host/src/studio-media-meta.ts` | `studio-meta.json` sidecar: prompt / aspect / model per media id |
| `packages/host/src/work-cards.ts:98-117` | The `media:<id>` Knowledge card a successful generate writes |

## Gotchas

- **Every generate now leaves a usage row.** `recordImageUsage` (`packages/host/src/studio-generate.ts:295`)
  and `recordVideoUsage` (`:363`) fire right after the tool returns and before the file is stored,
  because the gateway has already charged by then. Images are metered in images, videos in the
  *snapped* seconds. See [`tenant-usage-ledger.md`](tenant-usage-ledger.md).

- **The picker outlives the key.** `models-cache.json` (`packages/host/src/model-cache.ts:22-30`) is written by the last successful probe and read unconditionally. A desk with `hasOpenai: false` still shows whatever that probe returned. Images also fill an empty provider from static `CHAT_MODELS`. Videos do not: an empty probe is an empty `videos-studio-model`, and a static Seedance row is not priced. A model the video route then refuses with "not available for this key" is dropped from the picker (`apps/web/components/videos-studio.tsx:173-184`) and the error names another probed id (`rewriteModelNotOnKey`, `packages/host/src/studio-generate.ts:370-375`).
- **"Seedance-class" includes Veo, Kling and Sora.** `usesSeedanceVideoWire` (`packages/core/src/models/video-capabilities.ts:32-34`). Reading the name instead of the regex leads you to expect `videos-studio-resolution` to be disabled on the default model; it is enabled.
- **`videos-studio-seconds` is not a fixed set.** Veo ids get `[4, 6, 8]` (`:65`, `:68-73`), everything else `[5, 8, 10]`. Until 2026-09-30 `veo_3_1-fast` led `VIDEO_PREF`, so `4 / 6 / 8` was what a driver saw first. `seedance-2.0` leads it now (`packages/core/src/models/media-kind.ts:46`), so on a catalogue that lists it a driver sees `5 / 8 / 10` first and has to pick a Veo id by hand for `4 / 6 / 8` (not driven in a browser).
- **Three places snap the clip length**: the UI effect (`apps/web/components/videos-studio.tsx:101-103`), the host helper (`packages/host/src/studio-generate.ts:340`), and the payload builder (`packages/core/src/tools/platform/gateway-media.ts:171`). Only the last one clamps to the 2–12 window; the first two snap to an allowed option.
- **`still` and `imageToVideo` are two different flags and the legacy one lies.** Both `SEEDANCE_ALL` and `OPENAI_LIKE` set `still: true` (`video-capabilities.ts:17-29`); only `imageToVideoForModel` (`:40-54`) is honest, and only it drives the field (`apps/web/components/videos-studio.tsx:274`). Driven: `videos-studio-still` count 0 on `mj_video` and `omni-fast-v2v`, 1 on `grok-imagine-video`.
- **Images note and submit share `allowed`.** `images-studio-needs-key` renders when `needsKey && !loading`; `images-studio-submit` is `disabled` on `needsKey`. Stub `allowed: true` hides the note and can generate. Videos still disables submit and shows its note while `!ready`.
- **`generateStudioVideo` re-checks readiness and `generateStudioImage` does not** (`packages/host/src/studio-generate.ts:329-331`). The image path relies entirely on the tool's own backend check, which is why its keyless failure is a `tool_failed` 400 rather than an `invalid_request` 400. Same status, different code, different message.
- **Every gateway image request carries OpenAI pixel sizes**, whatever the vendor (`packages/core/src/tools/platform/gateway-media.ts:145-153`, used unconditionally at `:309`). `quality: "medium"` is added only for `gpt-image` ids (`:311-313`) — which is also why the estimate line says "at medium quality" for exactly those models.
- **`gateway_blocked` is swallowed here too.** The host answers a flat body whose `error` is a string (`packages/host/src/errors.ts:20-25`), and both studios read `data.error?.message` (`apps/web/components/images-studio.tsx:108`, `apps/web/components/videos-studio.tsx:163`). `.message` on a string is `undefined`, so a closed gate shows the generic "generate failed" copy. The same finding is recorded for Chat in [`chat-send.md`](chat-send.md).
- **Visiting a studio leaves it mounted.** `WorkModeKeepAlive` (`apps/web/components/work-mode-keep-alive.tsx:50-81`) hides rather than unmounts, so `example-gallery` resolves to two elements once both studios have been visited, and `images-studio` has count 1 while the user is on `/videos`. Driven; it is a Playwright strict-mode violation on any shared testid.
- **The empty state is behind the loading state.** `loading` starts `true` and both the `*-studio-needs-key` box and `*-studio-empty` are suppressed until it flips. Snapshotting the page as soon as `images-studio` becomes visible reads `null` for both. Wait for `*-studio-model` to gain options instead.
- **A missing media file is a 500, not a 404, and the message contains the absolute path.** `handleGetMediaFile` (`packages/host/src/handlers/media.ts:40`) only 404s on a missing *row*; a missing *file* throws ENOENT out of `stat` and lands in `jsonError`'s catch-all (`packages/host/src/errors.ts:42-46`), whose `redactSecrets` does not touch paths. Driven on `:3000`: `500 {"error":{"code":"internal_error","message":"ENOENT: no such file or directory, stat 'C:\\…\\data\\media\\<organizationId>\\<mediaId>.mp4'"}}`. **Finding, not a design.**
- **The gallery is org-scoped, not desk-scoped**, exactly like the rest of the media store — open finding `b9`, see [`renderer-media.md`](renderer-media.md).
- **A successful generate writes a Knowledge source; loading an example prompt does not.** `upsertWorkSource` runs only from the two generate helpers (`packages/host/src/studio-generate.ts:308-319`, `:252-265`); `videos-example-use-*` calls `onPick` → `pickTemplate`, pure React state (`apps/web/components/video-examples.tsx:126-131`, `apps/web/components/videos-studio.tsx:127-132`), and issues no request at all.
- **`/runs/image` and `/runs/video` are not these routes.** They are chat runs that *consume* media: `parseImageRunInput` demands at least one `image_url` part and rejects `video_url` outright (`packages/core/src/content/parse-run-input.ts:57-58`, `:165-167`). Posting a generate body there is a 400 for a completely unrelated reason.

## Verify

`.cursor/skills/verify-agentforge/features/images.md` — sub-features `images-rail`, `images-shell`, `images-needs-key`, `images-empty`, `images-estimate`.
`.cursor/skills/verify-agentforge/features/videos.md` — sub-features `videos-rail`, `videos-shell`, `videos-needs-key`, `videos-empty`, `videos-examples`, `videos-knobs`, `videos-estimate`, `videos-ingest`.

DOM testids that prove it:

| testid | Declared at |
|---|---|
| `images-studio` / `videos-studio` | `apps/web/components/images-studio.tsx:132`, `apps/web/components/videos-studio.tsx:206` |
| `images-studio-needs-key` / `videos-studio-needs-key` | `:221` / `:343` |
| `images-studio-gallery` / `videos-studio-gallery` | `:228` / `:351` |
| `media-missing` (a tile for a row whose file is gone), `gallery-video` (a mounted gallery player) | `apps/web/components/gallery-media.tsx:70`, `:107` |
| `images-studio-prompt-bar` / `videos-studio-prompt-bar` | `:151` / `:227` |
| `images-studio-prompt` / `videos-studio-prompt` | `:204` / `:326` |
| `images-studio-submit` / `videos-studio-submit` | `:216` / `:338` |
| `images-studio-error` / `videos-studio-error` | `:140` / `:214` |
| `images-studio-aspect` / `videos-studio-aspect` | `:159` / `:235` |
| `videos-studio-seconds` / `videos-studio-resolution` / `videos-studio-still` | `apps/web/components/videos-studio.tsx:248` / `:287` (inside `videos-studio-advanced`, `:277`) / `:303` |
| `videos-studio-download` | `apps/web/components/videos-studio.tsx:375` (not rendered for a row the host marked as having no file) |
| `images-studio-model` / `videos-studio-model` | passed as the `testId` prop (`images-studio.tsx:172`, `videos-studio.tsx:261`) and applied at `apps/web/components/model-select.tsx` — **there is no literal `data-testid="images-studio-model"` to grep for** |
| `images-enhance` / `videos-enhance` | same shape, `testId` prop at `images-studio.tsx:194` / `videos-studio.tsx:316` |
| `videos-examples`, `videos-example-card`, `videos-example-video`, `videos-example-use-<templateId>`, `videos-examples-error` | `apps/web/components/video-examples.tsx:81`, `:97`, `:107`, `:125`, `:70` |
| `example-gallery`, `example-card`, `example-result` | `apps/web/components/example-gallery.tsx:19`, `:29`, `:49` (shared by both studios) |
| estimate testids | see [`media-cost-estimate.md`](media-cost-estimate.md) |

The checks that prove it, none of which need a key: `mode-images` → `/images` → `images-studio` visible; on a stub desk (`allowed: true`) `images-studio-needs-key` is absent and `images-studio-submit` enables with a prompt; when `allowed` is false the note is visible with an `<a href="/settings">` and the button is disabled; an empty gallery renders no tiles (no empty-state testid); a gallery row whose file is gone shows `media-missing` and no `<video>` (host: `fileMissing`; unit: `packages/host/src/studio-gallery.test.ts`, `apps/web/lib/gallery-media.test.tsx`); switching `videos-studio-model` to a `veo_` id while `videos-studio-seconds` reads 10 must leave it on 8; `videos-studio-resolution` must be `disabled` on `grok-imagine-video` and enabled on `veo_3_1-fast`; `videos-studio-still` must have count 0 on `mj_video`. A gallery `<img>` / `<video>` `src` must begin `/api/v1/media/` (or `agentforge://media/` packaged).

Unit tests: `packages/core/src/models/video-capabilities.test.ts`, `packages/host/src/studio-generate.test.ts`, `packages/host/src/handlers/jobs.test.ts`, `packages/core/src/tools/platform/image-generate.test.ts`, `packages/core/src/tools/platform/video-generate.test.ts`, `apps/web/lib/images-locale.test.ts`, `apps/web/lib/videos-locale.test.ts`, `apps/web/lib/images-studio-gate.test.ts`. Cloud: `apps/web/tests/e2e/foundation.spec.ts` asserts `images-studio`, and `videos-studio` + `videos-studio-needs-key`; it never generates.

## Why

**Why the studios post to their own route instead of a chat run.** `[Direct]` The run routes are typed the other way round: `parseImageRunInput` "image runs require at least one `image_url` part" and rejects `video_url` on the image route (`packages/core/src/content/parse-run-input.ts:57-58`, `:165-167`), so a generate body cannot be expressed there at all. `[Direct]` `.cursor/skills/verify-agentforge/features/images.md` states the same boundary as a harness rule: "The studio posts to `/api/v1/images`, not `/runs/image`. `/runs/image` is fail-closed attach-and-analyze." `[Inferred]` the practical consequence — no thread row, no SSE, no run-stall guard — follows from `handlePostImages` being four straight-line calls with no `startModalityRun` anywhere in `packages/host/src/handlers/jobs.ts`. **Confidence: high for the mechanism, medium for reading it as a deliberate split rather than an accident of history.**

**Why the non-Seedance video payload is so bare.** `[Direct]` The code comment at `packages/core/src/tools/platform/gateway-media.ts:194-196`: "Toko `/v1/video/generations` uses a strict JSON decoder per upstream. grok-imagine-video rejected OpenAI pixel `size`, then `ratio` (`json: unknown field`). Seedance still needs `ratio` + `resolution`. Keep this branch to prompt/duration/seconds." `[Direct]` The live matrix in `.cursor/skills/verify-agentforge/features/videos.md` records the same result from the other end: "`grok-imagine-video` accepted `prompt` + `duration` and also `seconds` (POST 200) … Seedance `ratio` returned **400** `json: unknown field "ratio"`." **Confidence: high.**

**Why `imageToVideoForModel` exists next to the `still` profile flag.** `[Direct]` The doc comment at `packages/core/src/models/video-capabilities.ts:36-39` names the change: "Honest image-to-video gate (G-20). Unknown ids are false. `still` remains the legacy UI-field flag and may stay true when `imageToVideo` is false." So the profile flag was kept for compatibility and a second, conservative predicate was added in front of the UI rather than editing the profiles. **Confidence: high for the what; the ticket `G-20` itself was not read.**

**Why the studio GETs are ungated while the POSTs are not.** `[Direct]` The comment repeated above both POST handlers (`packages/host/src/handlers/jobs.ts:70`, `:101`): "Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call." `[Direct]` The GET handlers carry the mirror-image comment about prices (`:37-40`): "Nothing here reaches the network." `[Supported]` [`media-cost-estimate.md`](media-cost-estimate.md) and [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md) both record the same rule — the routes that cannot reach the gateway stay open so a blocked desk is still navigable and still recoverable through Settings. **Confidence: high.**
