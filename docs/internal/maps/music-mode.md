# Map — Music mode

Last verified: 2026-09-23 at d4561b8 + uncommitted tree for § 5 (what reaches the relay in custom mode), the
`studio-generate.ts` citations, the studio keeping its picked model after a generate, and the test table.
Everything else was last verified 2026-09-21 at 4938747. The lyrics change is host-side and needs a `:3000`
restart before it can be seen; it has not been driven.

## Overview

`/music` is the third generate studio, built to the same shape as `/images` and `/videos` ([`generate-studios.md`](generate-studios.md)): one fetch-on-mount, a form, a gallery. It turns either a plain description or hand-written lyrics into finished audio files stored as `media` rows and served back at `/api/v1/media/<id>/file`.

Two things make it different from its siblings, and both come from the gateway rather than from a design choice.

**The wire is not a `/v1` route.** The only music backend this gateway exposes is an async Suno relay mounted on the gateway *origin* — `POST /suno/submit/music`, then `GET /suno/fetch/<taskId>` until the job reports `SUCCESS`. Nothing about it is OpenAI-shaped, so it does not share `gateway-media.ts` with Images and Videos; it has its own file.

**One job returns two takes, for one charge.** Suno answers a single submit with two clips. Both are saved, both get their own media row and their own Knowledge card, because each is a separate file the desk may keep or delete on its own.

What this page is *not*: transcription (nothing here reads audio) and text-to-speech. Speech is written and wired but **unreachable on this gateway today** — see the voice-over section below.

> **The Suno wire has never been driven against the live gateway.** It was written from `../gateway-model-selection.md` §5.3 and the NewAPI relay action map it cites. Cloud agents have no egress to `api.tokotokenai.com` (`../research/gateway-media.md`), so every test below stubs `fetch`. `scripts/probe-gateway-music.ts` is the one-command check for a desk that does have a key; until it exits 0 on a real desk, treat the request and response shapes in `gateway-audio.ts` as documented-but-unproven.

## How it works

### 1. Getting there

`music` is a `PRODUCT_MODES` entry (`packages/core/src/agents/product-modes.ts:15`), which is the single list that drives the rail, the route table and the workspace `productModes` set. The rail renders it as `mode-music` through the same `mode-${href.slice(1)}` rule every mode uses (`apps/web/components/app-rail.tsx:117` for the icon, `:40` for the `IconName` union).

`/music` is declared in the router with `element={null}` (`apps/web/src/App.tsx:161`) because the actual component is mounted by the keep-alive layer: `WORK_MODE_COMPONENTS` maps `/music` → `MusicStudio` (`apps/web/components/work-mode-keep-alive.tsx:27`). So the G-3 rule applies here exactly as it does to Images and Videos — after visiting `/music` and then leaving it, `music-studio` is still in the DOM. Assert `isVisible()`, never `count()`.

### 2. Mount → `GET /api/v1/music`

`handleGetMusic` (`packages/host/src/handlers/jobs.ts:117-148`) assembles one payload:

```
{ items, models, defaultModel, ready, speechUnavailable }
```

Like the Images and Videos GETs it is **ungated** — no `requireGatewayAllowed` — so the page renders fully on a keyless desk.

- `items` ← `listStudioGallery(tenant, "audio")` (`packages/host/src/studio-generate.ts:543-567`). Same function the other two studios use; `StudioKind` was widened to `"image" | "video" | "audio"` (`:54`) and the item now also carries `title`, `style`, `instrumental` and `durationSeconds` from the sidecar.
- `defaultModel` ← `resolveStudioGenerateDefault({ kind: "music", ... })` — the agent pin, then the Settings pin (`settings.musicGenModel`), then `defaultStudioMusicModel()` (`packages/host/src/studio-generate.ts:157-159`). **Resolved before `models`, on purpose** — see below.
- `models` ← `withRelayMusicModels(listStudioMusicModels(), [defaultModel])` then `attachMediaPrices(..., "track", ...)`. `"track"` is a new `MediaPriceUnit` (`packages/core/src/models/media-pricing.ts:27`): a flat charge for one finished job, which is how the gateway bills the relay.
- `ready` ← `studioRouteReady("music_gen", workspaceId)` (`:258-264`).
- `speechUnavailable` ← `studioSpeechUnavailable()` (`:167-169`), the reason code the voice-over section renders.

The studio runs this load again after every generate, to show the new takes. Until 2026-09-23 that
reset the picker to `defaultModel` each time; it now keeps the person's pick while the list still
offers it (`keepModelChoice`, `apps/web/lib/model-choice.ts:19`, used at
`apps/web/components/music-studio.tsx:95`). Images and Videos had the same reset and the same fix.

### 2a. Why the picker is not just the live catalog — the relay merge

**`suno_music` is not in `GET /v1/models`, and never will be.** This is the mode's single most confusing fact and it cost the owner a bug report on 2026-09-21: `/music` showed a greyed-out dropdown with no options on a desk whose key works, because `models` came back `[]` while `defaultModel` said `suno_music`.

A new-api / one-api gateway lists the OpenAI-shaped models under `/v1/models` and nothing else. A **relay** model is driven through its own mount on the origin (§6) and billed as a task, so it is absent from that list even for a key entitled to it. On the owner's desk `/v1/models` returns 148 ids and not one of them is a Suno id. Building the Music list by filtering that catalog with `isMusicModelId` — which is what `listMusicModels` and `modeCatalogPayload` did — therefore produced a list that **could not contain the one id the whole mode runs on**, while `pickPreferredMusicModel`'s fallback still resolved the default to `suno_music`. A list that cannot contain its own default is a dead control.

The fix is a named constant, not a probe:

- `RELAY_ONLY_MUSIC_MODEL_IDS` (`packages/core/src/models/media-kind.ts`) — today `["suno_music"]`. Fixed in the repo, like `MUSIC_PREF` beside it: never read from a request, a response or settings, so nothing a gateway says can add an id. Every entry must satisfy `isMusicModelId` or the Music filter would drop it again straight after the merge (`media-kind.test.ts` asserts that).
- `withRelayMusicModels(models, extraIds?)` (`packages/host/src/selectable-models.ts`) — appends the relay rows the catalog is missing. Immutable, deduped case-insensitively, and **the catalog row always wins a collision**: if the gateway ever does list the id, its own row keeps its price and curation and nothing is appended.
- `handleGetMusic` resolves `defaultModel` first and passes it as `extraIds`, so an agent or Settings pin naming a relay id this build does not know about is still shown. The picker can always render what generate will actually send.
- `modeCatalogPayload` merges too, so `/api/v1/models` cannot report `modes.music: []` next to `defaults.music: "suno_music"`.

**No network probe sits on the request path.** A relay-existence check is possible — `GET {origin}/suno/fetch/<bogus id>` returning a structured not-found rather than a route 404 would distinguish "relay mounted" from "relay absent" without billing anything — but it would be a call on every page load to answer what a constant already answers, and `RELAY_MISSING` (§6) already names the exact path tried when a submit 404s. If that is ever wanted, it must be cached and failure-tolerant, and it must fail *open*.

**Nothing downstream rejects an id for being absent from the catalog**, and nothing should start. `musicGenerateBodySchema` takes any non-empty string (`packages/host/src/studio-generate.ts:77`), `generateStudioMusic` (`:424`) falls back to `defaultStudioMusicModel()`, and `musicGenerateTool` falls back to `DEFAULT_GATEWAY_MUSIC_MODEL`. Generation was never blocked by this bug — only the picker was.

### 3. Which ids count as music — `audioRole`

`mediaKind()` already bucketed the live catalog into chat / image / video / audio / other. Everything audio then needs a second split, because "audio" holds four unrelated jobs. `audioRole(id)` (`packages/core/src/models/media-kind.ts:79-101`) does it:

| Role | Matched by | This gateway's ids |
|---|---|---|
| `lyrics` | `/suno_lyrics|lyric/i` (`:73`) | `suno_lyrics` — also relay-only; the lyrics route takes no picker, so it has no merge |
| `music` | `/suno_music|\bmusic\b|lyria/i` (`:74`) | `suno_music` — **merged in, not listed by the gateway** (§2a) |
| `transcribe` | `/whisper|transcribe|\basr\b|-asr/i` (`:75`) | `mimo-v2.5-asr` |
| `realtime` | `/realtime/i` (`:77`) | `qwen3-tts-instruct-flash-realtime`, `qwen-audio-3.0-realtime-*`, `qwen3.5-omni-*-realtime` |
| `speech` | `/\btts\b|tts-|-tts|text-to-speech|speech/i` (`:76`) | *none* |

**The order in `audioRole` is load-bearing**: `realtime` is tested *before* `speech`, so `qwen3-tts-instruct-flash-realtime` comes back `realtime` and not `speech`. That id does say TTS, but it speaks WebSocket behind an `openai` endpoint label (`../gateway-model-selection.md` §2.1), so a plain HTTP job route cannot drive it. Calling it `speech` would light a control that can only fail.

`pickPreferredMusicModel` / `pickPreferredLyricsModel` fall back to `DEFAULT_GATEWAY_MUSIC_MODEL` / `DEFAULT_GATEWAY_LYRICS_MODEL` (`:9-10`) when the catalog is empty, the way the image and video pickers do. `pickPreferredSpeechModel` deliberately does **not** (`:167-169`): with no reachable id it returns `""` rather than inventing one, because a guessed id would send the desk at a model the gateway does not serve.

### 4. The form, and what the model allows

`musicCapabilities(model)` (`packages/core/src/models/audio-capabilities.ts:56-58`) answers four booleans — `lyrics`, `style`, `title`, `instrumental` — and today only `usesSunoMusicWire` ids (`:52-54`, `/^suno_/i`) get all four. `resolveMusicMode(model, wanted)` (`:65-70`) downgrades `custom` to `describe` on a model with no lyrics field, so a picker change can never leave the form in a mode the wire cannot express.

The studio re-derives both on every render and shows only the controls the current model supports (`apps/web/components/music-studio.tsx`). Caps are enforced on both sides: `MUSIC_PROMPT_MAX` 1 000, `MUSIC_LYRICS_MAX` 3 000, `MUSIC_STYLE_MAX` 200, `MUSIC_TITLE_MAX` 80 (`packages/core/src/models/audio-capabilities.ts:32-35`).

### 5. Submit → `POST /api/v1/music`

`handlePostMusic` (`packages/host/src/handlers/jobs.ts:151-161`) calls `requireGatewayAllowed` first — a closed gate is a `403 gateway_blocked` here rather than a failed call — then `parseMusicGenerateBody` (`packages/host/src/studio-generate.ts:195-209`), which refuses two briefs before anything can be billed for them:

- `mode: "custom"` with no lyrics → `400`, `musicLyricsRequired`
- `mode: "describe"` with no prompt → `400`, `musicPromptRequired`

`generateStudioMusic` (`:424-509`) is the spine:

1. `studioRouteReady("music_gen", …)` → `400` with the Settings hint if no key.
2. Pick the model (body → Settings pin → catalog default), then snap `mode`, `style`, `title` and `instrumental` through `musicCapabilities`.
3. The text goes through `maskPii` either way, and **the output-language rule rides only a description** (`:451-452`). In describe mode `withOutputLanguage(maskPii(prompt), "music", locale)` is the brief the model writes the words from. In custom mode the owner's lyrics go as written: the relay sends custom-mode `prompt` to Suno as the words to sing, so until 2026-09-23 the appended instruction would have been sung as the last verse. Never on the style tags.
4. `runWithToolSecrets(scope, () => musicGenerateTool.execute(...))` — the normal tool-secret envelope, so the key is read at call time and never held.
5. Zero tracks back → `tool_failed` carrying the gateway's own message.
6. **For each track returned**: `saveGeneratedAudio` → `persistMeta({ kind: "audio", … })` → `upsertWorkSource(musicWorkCard(...))` (`packages/host/src/work-cards.ts:138`). Two takes means two media rows, two sidecar entries, two Knowledge cards.

### 6. The wire — submit, then poll

`musicGenerateTool` (`packages/core/src/tools/platform/music-generate.ts:23-28`, key `music_generate`, capability `music_gen`) has exactly one backend: the gateway. `credentials.ts:135-138` records why — the catalog's music backend is an async Suno relay with no second vendor, so there is nothing to fall back to.

`generateGatewayMusic` (`packages/core/src/tools/platform/gateway-audio.ts:288`) then:

- `buildSunoMusicPayload` (`:133`) emits **one of two shapes and never a blend**: custom mode sends `{ prompt: <lyrics>, tags: <style>, title, make_instrumental }`, describe mode sends `{ gpt_description_prompt: <prompt>, make_instrumental }`. Extra fields are kept out on purpose — a strict decoder rejecting the whole job is the failure mode the video wire already paid for.
- `submitSuno` (`:222-248`) posts to `` `${gatewayOriginFromBaseUrl(baseUrl)}/suno/submit/${action}` `` — **origin, not `/v1`** (`packages/core/src/gateway.ts:76`). A 404 here is answered with `RELAY_MISSING` (`:117-118`), which names the exact path tried, so a wrong mount costs one line instead of a debugging session.
- `sunoTaskId` (`:157`) reads the id whether the relay returns `data` as a bare string, `data.task_id`, or a top-level `id`.
- `pollSuno` (`:250-286`) fetches `` `${origin}/suno/fetch/${taskId}` `` every `MUSIC_POLL_MS` (3 s) up to `MUSIC_MAX_POLLS` (100), i.e. about five minutes, then `504`. It only returns once the relay calls the job `SUCCESS`: a clip url can appear while the status is still `IN_PROGRESS`, and that url is the streaming take, not the finished file.
- `readSunoFailure` (`:180`) reads `data.fail_reason` **ahead of** the envelope, because NewAPI keeps `code: "success"` on a failed job.
- `extractSunoTracks` (`:189`) returns every take, and drops any clip whose `audio_url` is not `http(s):` or `data:` — the relay sometimes puts a failure string in that field.

### 7. Storage, and the narrow chat route

`saveGeneratedAudio` (`packages/host/src/media.ts:151-166`) mirrors the relay's URL into the local media store, decoding `data:audio/*` inline and downloading anything else, exactly like `saveGeneratedImage` / `saveGeneratedVideo`. Files land under the existing layout, `<dataDir>/media/<organizationId>/`, and are served by the existing `GET /api/v1/media/:mediaId/file`.

Teaching the store about audio required widening `saveMedia`, and that is where the one real regression in this change lived. `saveMedia` now takes an explicit `allow` list defaulting to `DEFAULT_UPLOAD_KINDS = ["image", "video"]` (`packages/host/src/media.ts:67`, `:68-77`; the comment on the default is at `:49`); `saveGeneratedAudio` is the only caller that passes `["audio"]`. Without that parameter, `POST /api/v1/media` — the chat upload route — silently started accepting `audio/mpeg` (G-27). The refusal message is rebuilt by `listKinds()` (`:61-66`) so the original copy is unchanged for the image/video case.

### 8. Lyrics helper — `POST /api/v1/music/lyrics`

`writeStudioLyrics` (`packages/host/src/studio-generate.ts:512-541`) runs `lyricsWriteTool` against `suno_lyrics` through the same relay with `action: "lyrics"`, and hands the text straight back. **Nothing is stored**: it exists so the desk can fill the lyrics box and then edit it before spending a music charge.

### 9. Voice-over, and why it is off

`speechGenerateTool` (`packages/core/src/tools/platform/music-generate.ts:118-123`, capability `speech_gen`) and `generateGatewaySpeech` (`gateway-audio.ts:345`) are written against the OpenAI-compatible `POST /v1/audio/speech` and return a `data:` URL. They work; there is simply no id to point them at.

So instead of rendering a dead control, the host answers with a machine-readable reason. `speechUnavailableReason(ids)` (`packages/core/src/models/audio-capabilities.ts:88`) returns `"no_audio_models"` when the catalog lists nothing audio at all, `"realtime_only"` when everything audio is realtime, and `null` the moment a plain TTS id appears. The studio renders the matching sentence from `music.voiceUnavailable.*` (`apps/web/locales/en/music.json`, `apps/web/locales/id/music.json`) inside `music-studio-voice`.

**This turns itself on.** The day the gateway lists something like `qwen-audio-3.0-tts-flash`, `audioRole` calls it `speech`, `speechUnavailableReason` returns `null`, and the control appears with no code change. `audio-capabilities.test.ts:93-97` is that assertion.

## Where things live

| File | Role |
|---|---|
| `packages/core/src/models/media-kind.ts` | `audioRole` and the five id patterns; `pickPreferred{Music,Lyrics,Speech}Model`; the two `DEFAULT_GATEWAY_*` ids; `RELAY_ONLY_MUSIC_MODEL_IDS` |
| `packages/host/src/selectable-models.ts` | `withRelayMusicModels`, `listMusicModels`, and the `modes.music` / `defaults.music` half of `modeCatalogPayload` |
| `apps/web/lib/music-models.ts` | `musicPickerEmpty` (when to explain instead of disabling) and `readApiErrorMessage` (both host error shapes) |
| `packages/core/src/models/audio-capabilities.ts` | Modes, per-model capability flags, field caps, `speechUnavailableReason`. Exported to the renderer as `@agentforge/core/audio-capabilities` (`packages/core/package.json:19`) |
| `packages/core/src/tools/platform/gateway-audio.ts` | The whole Suno relay wire: payload, submit, poll, extract, plus `/v1/audio/speech` |
| `packages/core/src/tools/platform/music-generate.ts` | `musicGenerateTool`, `lyricsWriteTool`, `speechGenerateTool` |
| `packages/core/src/tools/credentials.ts` | `music_gen` and `speech_gen` capabilities, `musicGenModel`, `MUSIC_GEN_MODEL` |
| `packages/core/src/models/media-pricing.ts` | The `"track"` unit and `estimateMusicCost` |
| `packages/host/src/handlers/jobs.ts` | `handleGetMusic`, `handlePostMusic`, `handlePostMusicLyrics` |
| `packages/host/src/studio-generate.ts` | Body schemas and parse guards, `generateStudioMusic`, `writeStudioLyrics`, `listStudioGallery` |
| `packages/host/src/media.ts` | `DEFAULT_UPLOAD_KINDS`, the `allow` parameter, `saveGeneratedAudio` |
| `packages/host/src/router.ts:306-308` | The three routes |
| `apps/web/components/music-studio.tsx` | The page: mode, model, lyrics, style, title, instrumental, draft-lyrics, library |
| `apps/web/lib/media-estimate.ts:232` | `musicEstimateView` — the price line above the button |
| `scripts/probe-gateway-music.ts` | Live three-step probe: catalog → submit → poll |

## Gotchas

- **A music job leaves one usage row, not two.** `recordMusicUsage`
  (`packages/host/src/studio-generate.ts:472`) records unit `jobs`, quantity 1, however many
  takes come back — that is how the gateway bills it. A lyrics draft (`:535`) is its own
  flat-rate call and gets its own row. See [`tenant-usage-ledger.md`](tenant-usage-ledger.md).

- **The relay is on the origin, not under `/v1`.** `https://api.tokotokenai.com/suno/submit/music`, not `…/v1/suno/…`. Every other generate wire in this repo is a `/v1` route, so this is the first thing to get wrong.
- **Never build the Music list by filtering the live catalog alone.** `suno_music` is not in `GET /v1/models` and never will be (§2a). Any new surface that needs music ids goes through `listMusicModels()` / `withRelayMusicModels`, never `listAudioModels().filter(isMusicModelId)`. This is the 2026-09-21 owner bug and it is easy to reintroduce, because the filter *looks* right.
- **The model id never reaches the gateway.** `buildSunoMusicPayload` emits no `model` field — the relay action in the URL path is what selects Suno, and the gateway bills the call against its `suno_music` entry. The id picked in the studio only selects the wire and the capability flags locally. Do not "fix" this by adding `model` to the body: §6 explains why extra fields are kept out.
- **Two host error shapes, and the studio must read both.** `jsonError` answers an `ApiError` as `{error:{code,message}}` but keeps a gated route's 403 flat — `{error:"gateway_blocked",status,message}` (`packages/host/src/errors.ts:20-32`). Reading only `data.error?.message` turns every flat one into a generic failure line. `readApiErrorMessage` handles both; use it rather than reaching into the body.
- **Two takes, one charge.** `POST /api/v1/music` answers with a `tracks` array, not a single `url`. Code that reads `tracks[0]` and stops is throwing away a file the desk already paid for.
- **A url during `IN_PROGRESS` is not the finished file.** Only trust a clip once the relay reports `SUCCESS`.
- **A failed job still says `code: "success"`.** The reason is `data.fail_reason`.
- **The chat media route stays narrow (G-27).** `POST /api/v1/media` accepts image and video only. Generated audio never arrives as an upload; it comes through `saveGeneratedAudio`. `edit/import.test.ts > "does not loosen the chat media route"` is the guard, and it caught this exact mistake during the build.
- **`MUSIC_ID` must not contain `udio`.** It matches *inside* `qwen-audio-…`, which classifies TTS ids as music and switches voice-over off. Udio is not in this catalog; the pattern is `/suno_music|\bmusic\b|lyria/i`.
- **No new by-id routes.** Tracks are served by the existing `GET /api/v1/media/:mediaId/file`. Nothing new needs covering in the tenancy harness beyond the three routes above.
- **`media.kind` is free text** (`packages/db/src/schema.ts:677`), so `"audio"` needed no migration. That was deliberate: Phase 3 tenancy owns `packages/db` migrations and this change does not touch them.
- **Suno has no vendor list price.** It sells a consumer subscription, not an API, so the price line shows the gateway's per-call figure or honestly says there is none on file. Do not invent a comparison.
- **The wire is unproven live.** See the callout at the top. `scripts/probe-gateway-music.ts` is the check; exit 0 is what promotes this section from "documented" to "verified".

## Verify

`.cursor/skills/verify-agentforge/features/music.md` is the where-to-press half of this page.

Handles: `mode-music` on the rail; `music-studio` as the page root; `music-studio-no-models` for an empty picker; `music-studio-mode`, `music-studio-prompt`, `music-studio-lyrics`, `music-studio-style`, `music-studio-title`, `music-studio-instrumental`, `music-studio-draft-lyrics`, `music-studio-submit` on the form; `music-studio-estimate` and `music-studio-takes-note` above it; `music-studio-needs-key` and `music-studio-error` for the two failure states; `music-studio-voice-unavailable` for the voice-over reason; `music-studio-library`, `music-studio-track`, `music-studio-download` below.

Automated checks that prove this page:

| Check | Proves |
|---|---|
| `packages/core/src/models/audio-capabilities.test.ts` | `audioRole` on the real catalog ids, `realtime` before `speech`, the reason codes, capability snapping |
| `packages/core/src/tools/platform/gateway-audio.test.ts` | Payload shapes never blend, the origin-mounted relay path, task-id shapes, both takes extracted, fail-reason precedence, poll timeout, `RELAY_MISSING` |
| `packages/host/src/handlers/music.test.ts` | The whole host path against a stubbed relay: submit → poll → two media rows → gallery listing → bytes served back, plus the G-27 guard, plus that `models` carries `suno_music` **and** `defaultModel` on a desk with no catalog, plus (2026-09-23) "sends the owner's own lyrics to the relay exactly as written" and "keeps the output-language rule on a described song, where the model writes the words" |
| `apps/web/lib/studio-model-wiring.test.ts` | (2026-09-23) Images, Videos and Music re-seed the picker from the reloaded list with `keepModelChoice`, so a generate no longer resets the model the person picked |
| `packages/host/src/selectable-models.test.ts` | `withRelayMusicModels` (adds, dedupes case-insensitively, never mutates) and that `modes.music` always contains `defaults.music` |
| `apps/web/lib/music-models.test.ts` | The empty-picker rule, and that both host error shapes reach the banner |
| `packages/host/src/edit/import.test.ts` | That the chat media route is still narrow |
| `apps/web/lib/music-locale.test.ts` | `en` and `id` key trees aligned, both voice-over reasons present |
| `scripts/probe-gateway-music.ts` | The live wire. **Not yet run against the gateway.** |
