# Map — Meeting: recording → transcript → minutes → translation

Last verified: 2026-09-21 at 4938747 — **driven end to end on webdev against the live gateway**: upload → transcript →
minutes → translation, in both locale directions. Transcription runs on `gemini-3.5-flash` over the `chat_audio` wire;
the minutes and the translation on `gpt-5.6-sol`. See [What was driven](#what-was-driven-2026-09-21).

## Overview

Meeting is a **file job**, the same shape as Legal: a recording goes in, a transcript and two sets of minutes come out. A *meeting* is a folder on disk, not a database row — everything except the artifacts lives under `localDataDir()/meetings/<workspaceId>/<meetingId>/` (`packages/host/src/meeting/store-files.ts:1-11`). There is no migration; nothing in `packages/db` changed.

Three things to hold onto.

**1. Six of the nine routes never touch a model.** Meeting create, list, get, delete, recording upload and transcript paste are pure disk bookkeeping and work with no gateway key at all. Only the three `/stream` routes reach the gateway, and they are guarded twice — a 403 gate before the job starts (`packages/host/src/handlers/meetings.ts:139`, `:157`, `:176`) and a 503 `runtime_stub` check inside it (`packages/host/src/meeting/run.ts:57-66`). As with Legal, that 503 arrives as a single `job.error` frame inside a `200 text/event-stream`, not as an HTTP 503 (`packages/host/src/handlers/meetings.test.ts:196-206`).

**2. The transcription wire is chat completions, not `/audio/transcriptions` — and its payload differs per model family.** The gateway's `supported_endpoint_types` never advertises an audio or transcription type; ASR, omni and TTS ids expose `openai` only and carry their vendor's schema behind it (`docs/internal/gateway-model-selection.md:174`). Driving it on 2026-09-21 showed the shape is not one shape: the OpenAI audio family (`gpt-audio-mini`, `gpt-audio-1.5`) takes **bare base64** in `input_audio.data` and answers `400 invalid_value` to a data URI, while the DashScope-backed family (`qwen*-omni*`, `*livetranslate*`) takes a **`data:` URI** and answers `400 InvalidParameter` — "The provided URL does not appear to be valid" — to bare base64. `transcriptionShapeFor` (`packages/core/src/meeting/asr-model.ts`) returns the wire, the encoding and whether to stream; `packages/host/src/meeting/transcribe-request.ts` builds the call from it and accumulates the SSE deltas when it streams. The multipart route is kept for a Whisper-style id on a gateway that does serve it; that is the wire `packages/host/src/edit/asr.ts` has always used.

**3. Translation is a second pass over the finished JSON, not a second reading of the transcript.** `translateMinutes` (`packages/host/src/meeting/run.ts:321`, called at `:310`) hands the model the minutes object and asks for the same shape in the other language, so the two languages cannot disagree about what was decided. This is on top of the repo's usual `withOutputLanguage` surface rule, which only decides what language a single call writes in.

## How it works

### 1. Reaching the surface

`mode-meeting` on the left rail is built from the product mode's href (`packages/core/src/agents/product-modes.ts:12`, `href: "/meeting"`), so there is no literal `data-testid="mode-meeting"` to grep — the rail composes it (`apps/web/components/app-rail.tsx:339`). `/meeting` itself is `<Route path="/meeting" element={null} />` (`apps/web/src/App.tsx:165`); the studio mounts through `WorkModeKeepAlive` (`apps/web/components/work-mode-keep-alive.tsx:31`), not through the route element.

`MeetingStudio` (`apps/web/components/meeting-studio.tsx:62`) renders `meeting-studio`. On mount it fires one GET, `/api/v1/meetings`, which returns both the list and a **capability** block (`packages/host/src/handlers/meetings.ts:37-41`) — whether this desk has a recogniser and whether ffmpeg is installed. That is what lets the studio say "paste the transcript instead" *before* the owner uploads 25 MB and finds out.

### 2. Intake — a meeting is created explicitly

Unlike Legal, there is a create form: title plus the language spoken (`apps/web/components/meeting-studio.tsx:237-281`). `handlePostMeetings` (`packages/host/src/handlers/meetings.ts:47`) writes `meeting.json` through `meetingStore()`. The `locale` chosen here is the language the minutes are written in *first*; the translation is the other one (`otherLocale`, `packages/host/src/meeting/run.ts:53-55`).

### 3. Upload — audio or video, 25 MB, sniffed on mime

`handlePostMeetingRecording` (`packages/host/src/handlers/meetings.ts:90`) takes the usual `request.files` field `"file"`. Caps in `assertRecordingCaps` (`packages/host/src/meeting/store-files.ts:270-280`):

- empty file → 400
- over `MEETING_RECORDING_MAX_BYTES` (25 MB) → 413
- a mime outside `MEETING_AUDIO_TYPES` ∪ `MEETING_VIDEO_TYPES` → 400 `unsupported_content_type`

**Why 25 MB and not more:** the HTTP adapter refuses any request body over `MAX_BODY_BYTES` = 26 MB (`packages/host/src/http-adapter.ts:43`). A larger cap in the store would only turn a clear 413 into a confusing transport failure. Roughly an hour of speech-grade mono audio fits; a longer meeting goes in as a pasted transcript.

Bytes land at `recording/source.<ext>`, extension from the mime with the filename as a fallback (`extensionFor`, `store-files.ts:260-268`). `recordingFile()` re-checks that a stored relative path still resolves inside the meeting directory before anything reads it back (`store-files.ts:96-103`).

**A meeting holds one recording, and since 2026-09-21 the disk agrees.** The filename comes from the mime type, so re-uploading a `.webm` over an `.mp3` used to write `source.weba` beside a `source.mp3` that nothing would ever remove again — a tenant's audio outside the record and outside quota accounting ([`../security-register.md`](../security-register.md) SR-13). `addRecording` (`store.ts:179-209`) now writes the new bytes **first**, then calls `removeStaleRecordings` (`store-files.ts:149-192`) to delete every other `source.<ext>` in that meeting's `recording/`, then `removeDerivedAudio` (`:194-212`) to drop the `audio/` chunks, which are a cache of the recording that was just replaced. Write-then-clean, not clean-then-write: a failed write must leave the tenant with the recording they already had, not with neither. The cleanup is bounded to that one directory (every candidate goes back through `recordingFile()`), to names matching `/^source\.[a-z0-9]{1,5}$/`, and to `entry.isFile()` from `readdirSync(..., { withFileTypes: true })` — a symlink answers `isSymbolicLink()` and is skipped, so nothing can be unlinked through one, and a directory can never turn this into a recursive delete. ENOENT is the outcome asked for, not an error. Deleting a meeting still removes the whole directory (`store.ts:169-177`), unchanged.

Note this path deliberately does **not** reuse `saveMedia` (`packages/host/src/media.ts:37-39`), which rejects audio outright, nor `saveEditFile` (`packages/host/src/handlers/edit.ts:70-97`), which accepts it but belongs to Edit.

### 4. Transcribe — ffmpeg, then one gateway call per chunk

`transcribeMeeting` (`packages/host/src/meeting/run.ts:146`):

1. `resolveMeetingAsr()` first, so a desk with no recogniser is refused before ffmpeg burns CPU (`run.ts:150-159`).
2. `extractMeetingAudio` (`packages/host/src/meeting/audio.ts:57`) decodes to mono 16 kHz 64 kbps mp3 and **segments at `CHUNK_SECONDS` = 600**, about 4.8 MB a chunk, which every transcription route accepts in one request base64-inflated. `MAX_CHUNKS` = 36 caps a pathological file at six hours. This is its own recipe rather than Edit's `extractAudio` because that one resolves paths against Edit's project allowlist (`packages/host/src/edit/ffmpeg/paths.ts:44-46`) and cannot read the meeting store; the ffmpeg runner and the path guard are the shared ones.
3. `transcribeChunks` (`packages/host/src/meeting/transcribe.ts:169`) posts each chunk in order, emitting a `job.step` per chunk.
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
| Transcription | `AGENTFORGE_MEETING_ASR_MODEL` if pinned — one id, no fallback — else `transcriptionCandidates(cachedModelIds())` over `TRANSCRIPTION_PREF` (`packages/core/src/meeting/asr-model.ts`), head `gemini-3.5-flash`. That is a **chain**, not a pick: a model that refuses, times out or answers with nothing is dropped and the next is asked, and the first that answers is preferred for every remaining chunk. Empty when the catalog lists nothing that can hear — the caller falls back to a pasted transcript rather than inventing an id. |
| Minutes and translation | `JOB_MODE_PREFERENCES.meeting` (`packages/core/src/models/mode-defaults.ts`), head `gpt-5.6-sol`; the owner's `documentGenModel` setting overrides, and the picker overrides that (`packages/host/src/meeting/run.ts:68-74`). |

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
- **A fractional ffmpeg timeout used to kill every recording before a byte reached the gateway.** `timeoutForMedia` turned a probed duration (`65.556063` s) into `161112.126` ms, and `execFile` refuses a non-integer `timeout` with `ERR_OUT_OF_RANGE` *without spawning anything*. The catch-all in `packages/host/src/edit/ffmpeg/run.ts` reported that as `ffmpeg_failed` / "ffmpeg recipe failed", so the owner saw a run die at `extracting` and blamed ffmpeg for a request it never received. `runFfmpeg` now rounds the budget up (`run-timeout.test.ts`) and the failure message carries the exit code and the tail of stderr. `edit/ffmpeg/recipes.ts` had the same arithmetic, so Edit's probe, extract and render recipes were broken the same way for any clip that was not a whole number of seconds long.
- **`mimo-v2.5-asr` is not on this gateway, and the ids that were preferred instead do not work.** The 2026-09-21 catalog has 139 ids and no `mimo`. Of the audio-capable ones: `qwen3-livetranslate-flash`, `qwen3.5-omni-flash` and `qwen3.5-omni-plus` answer `503 get_channel_failed` — "Supply pool unavailable" — so the model the picker had been choosing could never have transcribed anything; `gpt-audio` answers `200` with a refusal ("I'm sorry, but I can't provide that transcription") on both wires, which is why an empty answer is now treated as a chunk failure and why that id is off the list entirely; every `*-realtime` id speaks WebSocket only. `isTranscriptionModelId` now refuses realtime, TTS and any id whose `mediaKind` is image, video or other, and the `usable[0]` fallback that could hand a meeting to a video model is gone.
- **No ffmpeg, no recording path.** `extractMeetingAudio` raises `ffmpeg_missing` (503) rather than guessing. The capability block on `GET /api/v1/meetings` reports it so the studio can say so up front.
- **A 25 MB cap is a transport fact, not a product choice.** Raising it means raising `MAX_BODY_BYTES` in `http-adapter.ts`, which every upload route shares.
- **The guard can only be as good as the transcript.** A guard run against an empty transcript refuses every name, which is the safe direction but means a transcript that failed silently would produce ownerless minutes rather than wrong ones. That is why an empty transcript is a hard error one step earlier.

## What was driven (2026-09-21)

Everything in this page above the Recording section was driven on webdev `127.0.0.1:3000` against the live
`https://api.tokotokenai.com/v1`, with synthetic recordings made on this machine with
`System.Speech.Synthesis.SpeechSynthesizer` (no tokens spent producing them) and never committed.

**The models, tried one short 14-second chunk each.** Verbatim and correct: `gemini-3.5-flash` (the only id that
labelled the speakers, ~7 s), `gpt-audio-mini` (~3 s, fastest), `gpt-audio-1.5` (correct streaming; non-streaming
wraps the text in a `{"text": …}` object), `qwen3-omni-flash-2025-12-01` (correct, and only with a data URI).
Refused: `qwen3-livetranslate-flash`, `qwen3.5-omni-flash`, `qwen3.5-omni-plus` (`503 get_channel_failed`),
`gpt-audio` (`200` + a refusal sentence). `TRANSCRIPTION_PREF` is that order, and
`packages/core/src/meeting/asr-model.test.ts` pins it against a snapshot of the live catalog.

**The two full runs**, both `POST /api/v1/meetings/:id/run/stream`, phases
`extracting → transcribing → minuting → saving → translating → job.done`:

| Meeting locale | Recording | Transcript | Minutes | Translation |
|---|---|---|---|---|
| `en` | 65 s, three named speakers | `gemini-3.5-flash`, verbatim with `**Daniel Brooks**:`-style labels | `gpt-5.6-sol`, 3 attendees, 2 decisions, 3 action items with owners and dates, 1 risk, 1 open question, `unverifiedNames: []` | `id`, `gpt-5.6-sol` — "Rilis perbaikan latensi checkout ke produksi pada Jumat, 14." |
| `id` | 73 s, three named speakers | `gemini-3.5-flash`, Indonesian | `gpt-5.6-sol`, Indonesian | `en`, `gpt-5.6-sol` |

The translation target is `otherLocale(meeting.locale)` (`packages/host/src/meeting/run.ts`), so an `en` meeting is
translated to Indonesian and an `id` meeting to English. Both directions fired, with no owner action.

**Still unverified.** This machine has no Indonesian SAPI voice (only `en-US` David and Zira), so the Indonesian
sample is Indonesian *text* read by an English voice. The transcript was good Indonesian prose, but one speaker's
name came back as "Dwiistri" for "Dewi Lestari" — an artefact of the synthetic pronunciation, not evidence about
the recogniser's Indonesian. Real Indonesian audio is still owed. So is a multi-chunk recording: both runs were a
single chunk, so the chain's "prefer the model that just worked" path and `CHUNK_SECONDS` segmentation are covered
by unit tests only.

## Related

- [`features/meeting.md`](../../../.cursor/skills/verify-agentforge/features/meeting.md) — where to press
- [`legal-matter-run.md`](legal-matter-run.md) — the file-job pattern this follows
- [`gateway-model-selection.md`](../gateway-model-selection.md) — §2.1 endpoint types, §5.3 speech models, row 147
- [`edit-timeline.md`](edit-timeline.md) — the other ASR caller
- [`tenant-usage-ledger.md`](tenant-usage-ledger.md) — where a meeting's spend is recorded

## Recording (added 2026-09-21)

Everything above starts from a file that already exists. This section is the other intake: the
browser records the meeting itself, and then joins the pipeline above at step 3 with nothing changed.

**The one rule.** A recording is not a second intake path. `MeetingRecorderPanel` never calls the
host; `MeetingStudio` turns the finished blob into a `File` and hands it to `onUpload` — the same
function the file input calls, the same `POST /api/v1/meetings/:meetingId/recording`, the same
`"file"` field, the same `merge()` that lights up Run. `meeting-recorder-wiring.test.ts` exists to
keep it that way, because a recorder with its own `apiFetch` would pass every other test and quietly
lose the caps, the tenancy scoping and the status transition.

### The three files

| File | What it owns |
|---|---|
| `apps/web/lib/meeting-recorder.ts` | `MeetingRecorderController` — the state machine, mime pick, byte cap, error mapping, and every track/AudioContext release. Framework-free: every browser object arrives through `RecorderDeps`, so it is unit-tested in a node environment. |
| `apps/web/lib/use-meeting-recorder.ts` | The React skin: subscribe (`useSyncExternalStore`), tick the elapsed clock at 250 ms while recording, dispose on unmount. |
| `apps/web/components/meeting-recorder.tsx` | Presentation. Takes a finished view, exactly as `ComponentSetupPanel` does, so it renders in a test without a browser. |

States: `idle → requesting-permission → recording ⇄ paused → stopping → idle`, with `error`
reachable from any of them. The clip arrives through state rather than as a `stop()` return value,
so the owner's Stop and the cap's own auto-stop take one identical path out.

### Audio only, and why the video track exists at all

`getDisplayMedia` will not offer a *tab* picker unless video is requested, so `mic+tab` asks for
`{ video: true, audio: true }` and stops the video track the instant the stream arrives
(`#mixInDisplayAudio`). Nothing ever records it. The tab's audio is then summed with the microphone
through an `AudioContext` `MediaStreamDestination`, and that mixed stream is what `MediaRecorder`
sees — which is the whole point: it is what puts an online meeting's **remote** voices into the
recording. A share that carries no audio track is refused as `display_no_audio` rather than
recording an hour of silence. `mic` alone opens no `AudioContext` at all.

### The cap, and its relationship to the host

`RECORDING_MAX_BYTES` (`meeting-recorder.ts`) is a **deliberate duplicate** of
`MEETING_RECORDING_MAX_BYTES` (`packages/host/src/meeting/store-files.ts:36`). The renderer must not
import `@agentforge/host` and `@agentforge/core` exports no meeting file limit, so the number is
restated and pinned by a test rather than shared. Two mechanisms keep an upload under it:

1. **Bitrate.** `audioBitsPerSecond: 24_000` (speech opus) is about 10.8 MB an hour, under half the
   cap, so an ordinary meeting is never close.
2. **A running count.** `MediaRecorder` is started with a 1 s timeslice, so each `dataavailable`
   chunk updates the total; crossing `RECORDING_MAX_BYTES - RECORDING_STOP_MARGIN_BYTES` (512 KB)
   auto-stops with `capped: true`, keeping everything captured and telling the owner
   (`meeting-record-capped`). The margin exists because a chunk is only measured after it arrives.

**The host needed no change.** `isMeetingMedia` lowercases and splits on `;` before testing
`MEETING_AUDIO_TYPES`, which already carries `audio/webm`, so `audio/webm;codecs=opus` is accepted —
driven on webdev 2026-09-21, `201`, `status: "recorded"`. One cosmetic wrinkle: `EXT_BY_MIME` maps
`audio/webm` to `weba`, so a file named `recording-<iso>.webm` is stored as `recording/source.weba`.
ffmpeg reads by content, so `extractMeetingAudio` does not care.

### Gotchas

- **`dispose()` must not be terminal.** `apps/web/src/main.tsx` renders under `<StrictMode>`, so
  React mounts, runs the unmount cleanup and mounts again against the *same* controller — the hook
  holds it in a ref. The first build set a permanent `disposed` flag there, and Record became
  silently inert: pressed, and nothing happened at all, no error, no state. Thirty-six unit tests
  passed; only driving `/meeting` in a browser found it. The controller now carries a **generation
  token**: `start()` and `dispose()` both bump it, an async step whose generation has been
  superseded releases what it opened and reports nothing, and dispose is an ordinary boundary.
- **A leaked microphone track is an OS recording indicator that never goes away.** Every failure
  path releases what it opened, and each test asserts the tracks, not just the state.
- **Error codes are copy, not a generic failure.** Nine of them (`permission_denied`, `no_device`,
  `display_cancelled`, `display_no_audio`, `insecure_context`, `unsupported_browser`,
  `display_unsupported`, `recorder_failed`, `empty_recording`), each with a sentence in both
  catalogs under `meeting.record.errors.*`. They are looked up by template, so the catalog parity
  test cannot see them — `meeting-recorder-render.test.tsx` renders the panel once per code per
  locale instead.
- **Recording needs a secure context.** Webdev on `127.0.0.1` qualifies; a LAN IP over http does
  not, and is refused up front as `insecure_context` before the owner is asked for anything.
- **Capture itself is unverified.** The Browser pane blocks `getUserMedia` outright, so a granted
  microphone, the tab picker, the AudioContext mix and the resulting webm's decodability have never
  run. See the `unreleased.md` entry for exactly what was and was not driven.
