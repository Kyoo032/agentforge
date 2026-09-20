# Map — Renderer media: what an answer is allowed to load

Last verified: 2026-09-20 at a504555

## Overview

Model output is untrusted, and an `<img src>` is a network request nobody clicked. So DPSBuddy splits media into two halves that meet in the middle. **The renderer** auto-loads only media the host serves — `/api/v1/media/…`, `agentforge://media/…`, plus a small allow-list of inline `data:image/*` — and degrades everything else to a plain link. **The host** downloads whatever remote URL a generation returned, through an SSRF-hardened fetch, into its own store, and hands the renderer a local path.

Landed as one atomic security pass in `8831bc4`, recorded as findings `d1` and `d2` in `docs/internal/blockers-2026-09-15.md` section 3.2 and in the "Renderer media lock-down" section of `docs/internal/0.14.26-changelog.md:191-201`.

## How it works

### The predicates

`apps/web/lib/renderable-media.ts` is the whole rule, 27 lines:

```ts
const HOST_MEDIA_PREFIXES: readonly string[] = ["/api/v1/media/", "agentforge://media/"];   // :11
const INLINE_IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif)[;,]/i;                       // :14

function isHostServedMediaUrl(url) { return HOST_MEDIA_PREFIXES.some((p) => url.startsWith(p)); } // :17
export function isRenderableImageUrl(url) { return isHostServedMediaUrl(url) || INLINE_IMAGE_DATA_URL.test(url); } // :21
export function isRenderableVideoUrl(url) { return isHostServedMediaUrl(url); }              // :25
```

**Images accept** the two host prefixes, and `data:image/png|jpeg|webp|gif` followed by `;` or `,` — the separator matters, so a bare `data:image/png` with no payload marker and a `data:image/pngx` both fail. **Video accepts the two host prefixes and nothing else** — no `data:` video type at all. Rejected either way: every `http://` and `https://` URL including loopback, protocol-relative `//host/…`, `data:image/svg+xml`, `data:text/html`, `javascript:`, and `agentforge://file/…` (wrong path, not `media`).

Only two exports. `apps/web/lib/composer-attach.ts:90` re-exports both "so the composer and the chat renderer share one rule". Pinned by `apps/web/lib/renderable-media.test.ts`.

### Markdown: degrade to a link

`imageNode` (`apps/web/lib/parse-markdown.ts:169-179`) is where a remote image loses its teeth:

1. `safeImageSrc(parsed.href)` (`:63-66`) delegates to `isRenderableImageUrl`. A remote `https://…` is neither host-served nor a `data:image`, so it returns `null`.
2. With no `src`, the node falls through to `safeHref(parsed.href)` (`:41-56`, used at `:174`). A valid `https://` URL passes, and the node becomes `{ type: "link", href, children: [{ type: "text", value: parsed.label || href }] }` — a link the reader has to click.
3. If `safeHref` also rejects it (protocol-relative, `javascript:`), the node is `null` and the raw markdown stays as literal text.

Nothing is fetched on render, either way. The doc comment at `:163-168` states exactly this.

### Tool output: two collectors that deliberately disagree

There are two files named `tool-media.ts` and they are **not** copies.

**Renderer** (`apps/web/lib/tool-media.ts:12-31`): `collectToolMediaParts` takes `image` / `video` string keys only when `success === true`, and only when `isRenderableImageUrl` / `isRenderableVideoUrl` pass. A tool handing back a remote URL is **dropped here** — the comment at `:4-10` explains why: the host mirrors it and the persisted turn carries the `/api/v1/media/<id>/file` path instead.

**Host** (`packages/host/src/tool-media.ts`): the same shape, but its `isHttpOrDataUrl` helper **accepts** `https://` and `http://` — because the host is about to download them. For images it also accepts `data:image/` and `/api/v1/media/`; for video it accepts only http(s).

That asymmetry is the design: the host's collector decides what is worth mirroring, the renderer's decides what is safe to paint.

### Host mirroring

In a Chat run (`packages/host/src/runs.ts:345-353`), every `tool.completed` output goes through the host collector, then each part through `mirrorToolMediaPart` (`:453-468`):

- `image_url` → `saveGeneratedImage`, `video_url` → `saveGeneratedVideo` (`packages/host/src/media.ts:131-182`). An already-local `/api/v1/media/…` URL is returned as-is; a `data:` URL is decoded directly (`decodeMediaDataUrl`, `:125-131`); anything else goes to `downloadGeneratedMedia`.
- `downloadGeneratedMedia` (`packages/host/src/media-download.ts:39-55`) calls `fetchPublicHttps` with a per-kind byte cap, requires a 2xx, and takes the served content type only when it starts with `image/` or `video/` — otherwise it falls back to `image/png` / `video/mp4`. **The failing URL never appears in the error**, which surfaces to the client (`:26-31`).
- The bytes go to `saveMedia` (`packages/host/src/media.ts:68-105`), which re-validates mime and size, writes under `mediaRoot()`, inserts a `media` row scoped to `tenant.organizationId`, and returns `/api/v1/media/${id}/file`.
- **A part that cannot be mirrored is dropped, not persisted** (`packages/host/src/runs.ts:472-475`): "the turn keeps its text and drops the picture rather than carrying a remote URL."

`fetchPublicHttps` (`packages/core/src/security/safe-fetch.ts`) is the hardening: HTTPS only, no credentials in the URL, no private or loopback host (`isPrivateHost`, `:29-38`), every redirect hop re-validated (`:60-65`, up to `SAFE_FETCH_MAX_HOPS = 5`), and `readCapped` (`:68-88`) cancels the reader the moment the streamed total exceeds the cap, before the body is buffered.

The Images and Videos studios do the same thing directly (`packages/host/src/studio-generate.ts:296-297`, `:239-240`).

### Serving it back

`GET /api/v1/media/:mediaId/file` → `handleGetMediaFile` (`packages/host/src/handlers/media.ts:25-49`), routed at `packages/host/src/router.ts:242`, with HTTP `Range` support via `packages/host/src/byte-range.ts`. It is **ungated** — media is on the list of routes that stay open so a closed gate is always recoverable. Scoping is `getTenant(request.workspaceId)` plus an `organizationId` match on the row, and then the path itself: `mediaFilePath(tenant.tenantId, item.storagePath)` (`packages/host/src/media-root.ts:34-40`) refuses a `storage_path` that resolves outside the caller's tenant root with the same 404, so a row whose `storage_path` was tampered with cannot serve another tenant's bytes ([`tenant-storage.md`](tenant-storage.md)).

In the packaged shell the same bytes are also reachable as `agentforge://media/…` through `registerMediaProtocol()`.

### The mid-stream preview gap

Worth understanding because it looks like a bug and is a consequence of the lock-down.

The SSE `tool.completed` frame carries **`event.output` — the raw tool output** (`packages/host/src/runs.ts:336`), while the mirrored parts go only into the persisted assistant message (`mediaParts`, pushed at `:351`). Mid-run, `ChatTurn` recomputes `liveMedia` from the in-flight tool list on every render (`apps/web/components/chat-turn.tsx:35-37`) and paints it at `:92` — but through the **renderer's** collector, which rejects remote URLs.

So when a tool returns a remote `https://` URL, there is **no mid-stream preview**: the picture appears only after `onComplete` runs `refreshMessages` and the persisted, mirrored `/api/v1/media/…` part arrives. When a tool returns an already-local path, the preview shows immediately.

The other side of the same seam is the fallback at `apps/web/components/chat-session.tsx:527-564`: on completion it recomputes `liveMedia` from `toolsRef.current`, refreshes the messages, and — only if the refreshed list has no assistant message carrying an `image_url` / `video_url` part (`hasMedia`, `:539-553`) — appends a synthetic local message so the picture does not vanish when `setTools([])` clears the live view.

**No changelog or blockers entry names this as a regression.** A grep of every `docs/internal/0.14.2*-changelog.md` and `blockers-2026-09-15.md` for "mid-stream" and "preview" turns up only an unrelated note about a silent gap in token streaming (`docs/internal/0.14.26-changelog.md:129`). The behaviour above is read off the code at `b9f931a`, not from a written record.

### CSP — the second wall

`apps/desktop/renderer-csp.cjs:32-43`, the two directives that matter here:

```
img-src 'self' data: blob: agentforge:;
media-src 'self' blob: agentforge:;
```

No remote origin appears in either, nor in `connect-src`. So even if the renderer predicate were bypassed, a packaged build cannot auto-load a model-named `https://` URL. The rationale comments (`:18-26`): `data:` because "the preload hands the brand logo to the renderer as a data URI"; `blob:` because "the editor and the media studios build object URLs over generated bytes before anything is saved"; `agentforge:` for "gallery media and the bundled example clips, served by `registerMediaProtocol()`". Note `media-src` has no `data:` — matching `isRenderableVideoUrl`'s refusal of every `data:` video.

How the policy is injected, and why at pack time, is in [`desktop-pack-routes.md`](desktop-pack-routes.md).

### Constants

| Constant | Value | File:line |
|---|---|---|
| `GENERATED_IMAGE_MAX_BYTES` | 10 MB | `packages/host/src/media-download.ts:4` |
| `GENERATED_VIDEO_MAX_BYTES` | 50 MB | `packages/host/src/media-download.ts:5` |
| `IMAGE_MAX` / `VIDEO_MAX` (on save) | 10 MB / 50 MB | `packages/host/src/media.ts:11-17` |
| Allowed image mimes | `image/png`, `image/jpeg`, `image/webp`, `image/gif` | `packages/host/src/media.ts:11-17` |
| Allowed video mimes | `video/mp4`, `video/webm`, `video/quicktime` | `packages/host/src/media.ts:11-17` |
| `SAFE_FETCH_MAX_HOPS` | 5 | `packages/core/src/security/safe-fetch.ts:4` |
| `SAFE_FETCH_DEFAULT_TIMEOUT_MS` | 15 000 | `packages/core/src/security/safe-fetch.ts:6` |
| Default mime when the server declares none of the right family | `image/png` / `video/mp4` | `packages/host/src/media-download.ts:17-21` |

## Where things live

| File | Role |
|---|---|
| `apps/web/lib/renderable-media.ts` | The one rule: `isRenderableImageUrl`, `isRenderableVideoUrl` |
| `apps/web/lib/composer-attach.ts:90` | Re-exports both, so composer and transcript share it |
| `apps/web/lib/parse-markdown.ts` | `safeImageSrc`, `safeHref`, `imageNode` — the degrade-to-link path |
| `apps/web/lib/tool-media.ts` | Renderer-side tool filter (rejects remote) |
| `packages/host/src/tool-media.ts` | Host-side tool filter (**accepts** remote, to mirror it) |
| `packages/host/src/media-download.ts` | `downloadGeneratedMedia` — per-kind caps over `fetchPublicHttps` |
| `packages/core/src/security/safe-fetch.ts` | `fetchPublicHttps`, `assertPublicHttpsUrl`, `readCapped` |
| `packages/host/src/media.ts` | `saveMedia`, `saveGeneratedImage`, `saveGeneratedVideo`, `mediaRoot` |
| `packages/host/src/runs.ts:461-476` | `mirrorToolMediaPart` for Chat runs |
| `packages/host/src/studio-generate.ts:296-297, 239-240` | The same mirroring for Images / Videos |
| `packages/host/src/handlers/media.ts`, `byte-range.ts` | Serving, with `Range` support |
| `apps/web/components/chat-turn.tsx:35-37, 92` | Mid-stream `liveMedia` render |
| `apps/web/components/chat-session.tsx:527-564` | The post-completion media fallback |
| `apps/desktop/renderer-csp.cjs` | `img-src` / `media-src` and their rationale |

## Gotchas

- **The two `tool-media.ts` files are not copies and must not be "unified".** The host accepts remote URLs because it is about to download them; the renderer rejects them because it would paint them. Making them agree in either direction breaks one half.
- **The host collector accepts no `/api/v1/media/` *video*.** `isHttpOrDataUrl` allows the local prefix for images only (`packages/host/src/tool-media.ts`), so a tool returning an already-local video path is dropped before `mirrorToolMediaPart` — which would have passed it straight through. Looks unintended; observed from source, not confirmed against a live case.
- **No mid-stream preview for remotely-generated media.** The SSE frame carries the raw URL, the renderer refuses it, and the picture lands only when the persisted turn arrives. Not a regression anyone wrote down — see above.
- **`data:` is asymmetric between image and video, deliberately.** `isRenderableVideoUrl` takes no `data:` at all, and `media-src` has no `data:` either.
- **Media rows are org-scoped, not desk-scoped.** Open finding `b9` in `docs/internal/blockers-2026-09-15.md` section 3.2: a second desk on the same install can read the first desk's generated media.
- **The SSRF guard is name-only.** Open finding `b10`: hostnames are checked against private-range patterns, but DNS is never resolved and the connecting address is never checked, so a name resolving to `169.254.169.254` passes, and there is a TOCTOU window between check and fetch. Open finding `b11` adds that a model-composed tool-call URL can still carry data out in a query string to any host the name check allows. **The renderer half of the exfil problem is closed; the host-egress half is not.**
- **The media route is ungated on purpose**, like settings and threads — see [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md).
- **The `agentforge://` path key had no validation** until finding `E9`; it is now constrained to `/^[A-Za-z0-9._-]{1,128}$/`.

## Verify

`.cursor/skills/verify-agentforge/features/images.md` and `features/videos.md` for generation and gallery; `features/chat.md` for media in a turn; `features/security.md` for the lock-down itself.

Testids: `message-image` (`apps/web/components/chat-turn.tsx:186`, `:225`), `message-video` (`:198`, `:230`).

The check that proves it: a model or tool answer containing a remote `![alt](https://example.com/x.png)` must render as a **clickable link**, with no network request to that host — and a generated image must render inline with a `src` beginning `/api/v1/media/` or `agentforge://media/`.

Tests: `apps/web/lib/renderable-media.test.ts` (accept/reject for both predicates); `apps/web/lib/tool-media.test.ts` (notably "drops a remote https image: the host mirrors it and the turn carries the media path"); `apps/web/lib/composer-attach.test.ts`; `packages/host/src/media-download.test.ts` (plain `http://` rejected, redirect to loopback rejected, redirect to a private host rejected, over-cap image rejected **without buffering the whole body**, video cap larger than image cap, non-2xx rejected); `packages/host/src/tool-media.test.ts`.

## Why

**Why remote media no longer renders inline.** `[Direct]` finding `d1`, `docs/internal/blockers-2026-09-15.md` section 3.2, verbatim:

> **Model output could make the renderer fetch a chosen origin.** A remote `![alt](https://…)` in tool or model output became an auto-loading `<img>` / `<video>`, so the mere act of rendering an answer beaconed to whatever host the model named — with the viewer's IP, and on a packaged build from inside the app.

Severity HIGH, status fixed: the predicates moved into `apps/web/lib/renderable-media.ts` and accept only host-served media plus `data:image/{png,jpeg,webp,gif}`, "so a remote image degrades to a plain `safeLinkHref` link."

`[Direct]` The module's own header comment (`apps/web/lib/renderable-media.ts:1-10`) states the threat model in the same terms: "a tracking beacon at minimum, and inside the desktop shell a request sent from the app's own network position."

The exfiltration channel is what makes this more than a privacy nuisance: the URL is chosen by the model, so its **path and query string are attacker-controlled data**. An auto-loading `<img>` therefore both pings a host of the model's choosing and can carry whatever the model put in that URL — with no user action, from inside a packaged desktop app. Closing it at the point of render is what makes the render itself inert. **Confidence: high.**

**Why the host mirror was hardened at the same time.** `[Direct]` finding `d2`, same section: "`saveGeneratedImage` / `saveGeneratedVideo` fetched whatever URL came back from a generation — including a plain `http://` video branch — with no size cap, no redirect re-check and no address filtering, and handed back someone else's URL when the mirror failed." Fixed by routing everything through `packages/host/src/media-download.ts`. The two halves are one fix: locking the renderer to host-served media is only safe once the host can actually produce host-served media for every generation, which is why `runs.ts` gained video mirroring in the same pass. **Confidence: high.**

**Why the CSP is the belt and the predicate the suspenders.** `[Supported]` Finding `E16` (`docs/internal/blockers-2026-09-15.md` section 3.2, LOW, "documented" rather than fixed) notes that the collectors would still accept a remote URL if a predicate ever returned true for one — and is left as-is because `img-src` / `media-src` in the packaged CSP would block the load anyway. Two independent mechanisms, neither relied on alone. `[Inferred]` the ordering matters for webdev, where no CSP meta tag is injected: there the predicate is the only wall, which is an argument for keeping it strict rather than leaning on the shell. **Confidence: high for the mechanism, medium for the reading.**

**Why the whole thing landed as one commit.** `[Direct]` `git log --oneline -10 -i --grep=media` returns `8831bc4` as the only relevant commit, and `--grep=renderable` returns none — `renderable-media.ts` was introduced inside that squash. `docs/internal/0.14.26-changelog.md:191-201` frames it as one atomic security pass rather than an incremental feature. **Confidence: high.**
