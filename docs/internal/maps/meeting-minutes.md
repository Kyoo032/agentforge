# Map — Meeting: recording → transcript → minutes → translation

Last verified: 2026-09-20 at 6984d84 (source-traced; the gateway legs have not been driven live — see [Gotchas](#gotchas)).

## Overview

Meeting is a **file job**, the same shape as Legal: a recording goes in, a transcript and two sets of minutes come out. A *meeting* is a folder on disk, not a database row — everything except the artifacts lives under `localDataDir()/meetings/<workspaceId>/<meetingId>/` (`packages/host/src/meeting/store-files.ts:1-11`). There is no migration; nothing in `packages/db` changed.

Three things to hold onto.

**1. Six of the nine routes never touch a model.** Meeting create, list, get, delete, recording upload and transcript paste are pure disk bookkeeping and work with no gateway key at all. Only the three `/stream` routes reach the gateway, and they are guarded twice — a 403 gate before the job starts (`packages/host/src/handlers/meetings.ts:139`, `:157`, `:176`) and a 503 `runtime_stub` check inside it (`packages/host/src/meeting/run.ts:57-66`). As with Legal, that 503 arrives as a single `job.error` frame inside a `200 text/event-stream`, not as an HTTP 503 (`packages/host/src/handlers/meetings.test.ts:196-206`).

**2. The transcription wire is chat completions, not `/audio/transcriptions`.** The gateway's `supported_endpoint_types` never advertises an audio or transcription type; ASR, omni and TTS ids expose `openai` only and carry their vendor's schema behind it (`docs/internal/gateway-model-selection.md:174`). `mimo-v2.5-asr` — the catalog's one purpose-built recogniser — is documented as taking base64 `input_audio` over chat completions (row 147, `docs/internal/gateway-model-selection.md:620`). So `packages/host/src/meeting/transcribe.ts` speaks two wires and picks by model id (`packages/core/src/meeting/asr-model.ts:44-46`). The multipart route is kept for a Whisper-style id on a gateway that does serve it; that is the wire `packages/host/src/edit/asr.ts` has always used.

**3. Translation is a second pass over the finished JSON, not a second reading of the transcript.** `translateMinutes` (`packages/host/src/meeting/run.ts:311`) hands the model the minutes object and asks for the same shape in the other language, so the two languages cannot disagree about what was decided. This is on top of the repo's usual `withOutputLanguage` surface rule, which only decides what language a single call writes in.

## How it works

### 1. Reaching the surface

`mode-meeting` on the left rail is built from the product mode's href (`packages/core/src/agents/product-modes.ts:12`, `href: "/meeting"`), so there is no literal `data-testid="mode-meeting"` to grep — the rail composes it (`apps/web/components/app-rail.tsx:339`). `/meeting` itself is `<Route path="/meeting" element={null} />` (`apps/web/src/App.tsx:165`); the studio mounts through `WorkModeKeepAlive` (`apps/web/components/work-mode-keep-alive.tsx:31`), not through the route element.

`MeetingStudio` (`apps/web/components/meeting-studio.tsx:62`) renders `meeting-studio`. On mount it fires one GET, `/api/v1/meetings`, which returns both the list and a **capability** block (`packages/host/src/handlers/meetings.ts:37-41`) — whether this desk has a recogniser and whether ffmpeg is installed. That is what lets the studio say "paste the transcript instead" *before* the owner uploads 25 MB and finds out.

### 2. Intake — a meeting is created explicitly

Unlike Legal, there is a create form: title plus the language spoken (`apps/web/components/meeting-studio.tsx:237-281`). `handlePostMeetings` (`packages/host/src/handlers/meetings.ts:47`) writes `meeting.json` through `meetingStore()`. The `locale` chosen here is the language the minutes are written in *first*; the translation is the other one (`otherLocale`, `packages/host/src/meeting/run.ts:53-55`).

### 3. Upload — audio or video, 25 MB, sniffed on mime

`handlePostMeetingRecording` (`packages/host/src/handlers/meetings.ts:90`) takes the usual `request.files` field `"file"`. Caps in `assertRecordingCaps` (`packages/host/src/meeting/store-files.ts:151-161`):

- empty file → 400
- over `MEETING_RECORDING_MAX_BYTES` (25 MB) → 413
- a mime outside `MEETING_AUDIO_TYPES` ∪ `MEETING_VIDEO_TYPES` → 400 `unsupported_content_type`

**Why 25 MB and not more:** the HTTP adapter refuses any request body over `MAX_BODY_BYTES` = 26 MB (`packages/host/src/http-adapter.ts:39`). A larger cap in the store would only turn a clear 413 into a confusing transport failure. Roughly an hour of speech-grade mono audio fits; a longer meeting goes in as a pasted transcript.

Bytes land at `recording/source.<ext>`, extension from the mime with the filename as a fallback (`extensionFor`, `store-files.ts:152-160`). `recordingFile()` re-checks that a stored relative path still resolves inside the meeting directory before anything reads it back (`store-files.ts:76-83`).

Note this path deliberately does **not** reuse `saveMedia` (`packages/host/src/media.ts:38-40`), which rejects audio outright, nor `saveEditFile` (`packages/host/src/handlers/edit.ts:70-97`), which accepts it but belongs to Edit.

### 4. Transcribe — ffmpeg, then one gateway call per chunk

`transcribeMeeting` (`packages/host/src/meeting/run.ts:145`):

1. `resolveMeetingAsr()` first, so a desk with no recogniser is refused before ffmpeg burns CPU (`run.ts:150-159`).
2. `extractMeetingAudio` (`packages/host/src/meeting/audio.ts:57`) decodes to mono 16 kHz 64 kbps mp3 and **segments at `CHUNK_SECONDS` = 600**, about 4.8 MB a chunk, which every transcription route accepts in one request base64-inflated. `MAX_CHUNKS` = 36 caps a pathological file at six hours. This is its own recipe rather than Edit's `extractAudio` because that one resolves paths against Edit's project allowlist (`packages/host/src/edit/ffmpeg/paths.ts:44-46`) and cannot read the meeting store; the ffmpeg runner and the path guard are the shared ones.
3. `transcribeChunks` (`packages/host/src/meeting/transcribe.ts:197`) posts each chunk in order, emitting a `job.step` per chunk.
4. The chunks are deleted in a `finally` (`run.ts:180-184`) — they are a cache of a recording that is still on disk.

An empty chunk is logged and skipped, but an empty *transcript* is a hard `transcription_empty` (`run.ts:175-177`). That is deliberately unlike `edit/asr.ts:65-82`, which drops a failed chunk silently and returns whatever is left.

### 5. Minutes — strict JSON, then the name guard

`generateMinutes` (`packages/host/src/meeting/run.ts:245`) calls `collectJobAssistantRun` with `jobMode: "meeting"`, so it inherits the repo's model-fallback and thinking-off knobs for free. The system prompt is `MEETING_MINUTES_SYSTEM` (`packages/core/src/meeting/prompts.ts:16`) wrapped in `withOutputLanguage(…, "meeting", locale)`.

Then the guard. `guardMinutesNames` (`packages/core/src/meeting/guard.ts:49`) checks every name the minutes assert against the transcript:

- an **attendee** the transcript never named is dropped outright — a minutes sheet listing someone who was not in the room is worse than a short list;
- an **action-item owner** the transcript never named becomes `[needs owner]`, because the action itself was still stated.

Matching is deliberately generous (any word token of the name, ≥3 chars, case-insensitive, honorifics excluded — `guard.ts:20-33`): the point is to catch a wholly invented attendee, not to police how a speaker was introduced. The count is logged as `meeting_minutes_names_guarded` and surfaced to the owner on the studio (`apps/web/components/meeting-studio.tsx:423-427`).

This is the same family as Finance's number guard and Market's advice guard: a code check over model prose, not a nicer prompt.

### 6. Translation

`translateMinutes` (`run.ts:274`) runs `MEETING_TRANSLATE_SYSTEM` over the finished minutes JSON and **runs the guard again** on the result — a translator that hallucinates a name is exactly as wrong as a writer that does, and the transcript is still the only evidence either has.

### 7. Artifacts and the Knowledge card

Both the transcript and each set of minutes become `mode: "meeting"` artifacts (`kind: "transcript"` / `"minutes"`, `text/markdown`). `persist()` never fails the run (`run.ts:95-113`) — same precedent as `persistDraft` in `document-generate.ts:135-151`. The minutes also file a `Meeting` work card into the Knowledge Base (`run.ts:115-137`).

## Routes

Every by-id route, for the Phase 3 tenancy harness to cover:

| Method | Path | Gateway gate | Notes |
|---|---|---|---|
| GET | `/api/v1/meetings` | no | list + capability |
| POST | `/api/v1/meetings` | no | 201 |
| GET | `/api/v1/meetings/:meetingId` | no | **by id** |
| DELETE | `/api/v1/meetings/:meetingId` | no | **by id** |
| POST | `/api/v1/meetings/:meetingId/recording` | no | **by id**, multipart, 201 |
| POST | `/api/v1/meetings/:meetingId/transcript` | no | **by id**, pasted text |
| POST | `/api/v1/meetings/:meetingId/transcribe/stream` | yes | **by id**, SSE |
| POST | `/api/v1/meetings/:meetingId/minutes/stream` | yes | **by id**, SSE |
| POST | `/api/v1/meetings/:meetingId/run/stream` | yes | **by id**, SSE, upload → minutes |

All seven by-id routes resolve through `meetingStore()`, which filters on `tenant.workspaceId` and returns 404 — not 403 — for another workspace's record (`packages/host/src/meeting/store.ts:107-114`). A malformed id is a 400 from `assertSafeId` before it ever reaches the filesystem, which the route surfaces as a 404 (`packages/host/src/handlers/meetings.test.ts:98-101`).

## Model selection

| Leg | How it is picked |
|---|---|
| Transcription | `AGENTFORGE_MEETING_ASR_MODEL` if pinned, else `pickTranscriptionModel(cachedModelIds())` over `TRANSCRIPTION_PREF` (`packages/core/src/meeting/asr-model.ts:25-33`), head `mimo-v2.5-asr`. `undefined` when the catalog lists none — the caller falls back to a pasted transcript rather than inventing an id. |
| Minutes and translation | `JOB_MODE_PREFERENCES.meeting` (`packages/core/src/models/mode-defaults.ts`), head `gpt-5.6-sol`; the owner's `documentGenModel` setting overrides, and the picker overrides that (`packages/host/src/meeting/run.ts:68-72`). |

## The ASR-probe fix that came with this

`resolveAsrCapability()` in `packages/host/src/edit/asr.ts` accepted a model only when `mediaKind(id) === "audio"` **and** the id matched `/whisper|transcribe/i`. On the live Toko Token catalog that is satisfied by nothing: there is no `whisper` id (`grep -ri whisper docs/` returns none), and `mimo-v2.5-asr` — labelled `"Audio"` in `packages/core/src/models/gateway-roles.ts:149` — matched neither the `AUDIO` pattern in `media-kind.ts` nor the `ASR_ID` pattern. Two consequences, both now fixed:

- Edit's auto-captions reported `asr: { available: false }` on every live desk, and `GET /api/v1/edit/doctor` said so.
- `mimo-v2.5-asr` fell through to the **chat** bucket, so it was offered in the ordinary model picker, where it would simply fail.

`AUDIO` in `packages/core/src/models/media-kind.ts` now also matches a delimited `asr` token, `NOT_DEFAULT` in `preferred.ts` hides it from default picks, and `ASR_ID` in `edit/asr.ts` matches it too. Pinned by `packages/core/src/models/media-kind.test.ts` ("routes a speech recogniser to audio, not chat").

## Gotchas

- **One meeting can leave three usage rows, in two units.** The transcription is metered in
  seconds of audio (`recordTranscriptionUsage`, `packages/host/src/meeting/run.ts:188`), because
  that is what a recogniser bills for — not the tokens of the transcript, and not the number of
  chunks `extractMeetingAudio` happened to split the recording into. The minutes and the
  translation are ordinary token runs, metered through their `meeting-minutes` and
  `meeting-translate` run prefixes. All three land under the `meetings` mode. Nobody has
  transcribed a per-second ASR list price yet, so the transcription row records its seconds with a
  null cost and `no_list_price` until one lands. See
  [`tenant-usage-ledger.md`](tenant-usage-ledger.md).
- **The gateway legs are source-traced, not driven.** This branch was built in a sandbox whose egress policy denies `api.tokotokenai.com` and `api.tokenku.ai` (403 to CONNECT), so transcription, minutes and translation have never run against the real gateway. The request *shape* is pinned by `packages/host/src/meeting/transcribe.test.ts`; what is unproven is that the gateway answers it. See the PR for the exact commands to drive it live.
- **`mimo-v2.5-asr` over chat completions is documented, not verified.** Row 147 of the model-selection doc is sourced from mimo.mi.com, and §2.1 says ASR ids use "their vendor's non-chat schema behind" the `openai` endpoint type. If the live gateway disagrees, `AGENTFORGE_MEETING_ASR_MODEL` pins another id and `transcriptionWireFor` decides the wire from it.
- **No ffmpeg, no recording path.** `extractMeetingAudio` raises `ffmpeg_missing` (503) rather than guessing. The capability block on `GET /api/v1/meetings` reports it so the studio can say so up front.
- **A 25 MB cap is a transport fact, not a product choice.** Raising it means raising `MAX_BODY_BYTES` in `http-adapter.ts`, which every upload route shares.
- **The guard can only be as good as the transcript.** A guard run against an empty transcript refuses every name, which is the safe direction but means a transcript that failed silently would produce ownerless minutes rather than wrong ones. That is why an empty transcript is a hard error one step earlier.

## Related

- [`features/meeting.md`](../../../.cursor/skills/verify-agentforge/features/meeting.md) — where to press
- [`legal-matter-run.md`](legal-matter-run.md) — the file-job pattern this follows
- [`gateway-model-selection.md`](../gateway-model-selection.md) — §2.1 endpoint types, §5.3 speech models, row 147
- [`edit-timeline.md`](edit-timeline.md) — the other ASR caller
- [`tenant-usage-ledger.md`](tenant-usage-ledger.md) — where a meeting's spend is recorded
