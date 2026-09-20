# Meeting — where to press

Rail tab `mode-meeting` (Default desk has it). Route `/meeting`. Studio testid `meeting-studio`.

Full mechanism map: [`docs/internal/maps/meeting-minutes.md`](../../../../docs/internal/maps/meeting-minutes.md).

## What works without a gateway key

Create, list, select and delete a meeting; upload a recording; paste a transcript. All six of those
are disk bookkeeping. Prove them on a stub desk — no key needed, and no key should be typed.

1. `meeting-title` → type a name, `meeting-locale` → pick the language spoken, `meeting-create`.
2. The meeting appears in `meeting-list` as `meeting-item-<id>` with status `new`.
3. `meeting-file` → attach an mp3/m4a/mp4. Status becomes `recorded` and `meeting-recording` shows
   the name and size.
4. `meeting-paste` → paste a few lines, `meeting-save-paste`. Status becomes `transcribed` and
   `meeting-tab-transcript` shows it back.
5. `meeting-delete-<id>` removes it. **Clean up every meeting you create.**

## What needs a live key

`meeting-run` is the only button that reaches the gateway. On a stub desk it answers one
`job.error` frame with code `runtime_stub` **inside a 200 event-stream** — it is not an HTTP 503,
so do not look for one. `meeting-error` renders the message with a Settings link.

On a live desk the run streams phases into `meeting-progress`: `extracting` → `transcribing`
(with an n/m step per ten-minute chunk) → `minuting` → `saving` → `translating`. Then
`meeting-tab-minutes` and `meeting-tab-translation` both carry content, in opposite languages.

## Capability — read this before blaming the studio

`GET /api/v1/meetings` returns a `capability` block: `{ available, model, reason, ffmpeg }`.

| reason | What it means | What the studio shows |
|---|---|---|
| `ok` | a recogniser is live and a key pays for it | nothing |
| `no_model` | the key's catalog lists no speech-to-text id | `meeting-no-asr` |
| `no_key` | a model is pinned but no key is saved | `meeting-no-asr` |
| — | `ffmpeg: false` | `meeting-no-ffmpeg` |

`meeting-no-asr` is **not a fail**. It is the honest state of a desk whose gateway serves no
recogniser, and the paste path still produces minutes. Doctor's `edit.asr` block reports the same
capability for Edit.

`AGENTFORGE_MEETING_ASR_MODEL` pins a model id by hand, the same escape hatch Edit has as
`AGENTFORGE_EDIT_ASR_MODEL`. Both are in `turbo.json` `globalPassThroughEnv`.

## Testids

`meeting-studio`, `meeting-new`, `meeting-title`, `meeting-locale`, `meeting-create`,
`meeting-list`, `meeting-empty`, `meeting-item-<id>`, `meeting-delete-<id>`, `meeting-recording`,
`meeting-file`, `meeting-run`, `meeting-cancel`, `meeting-progress`, `meeting-paste`,
`meeting-save-paste`, `meeting-error`, `meeting-no-asr`, `meeting-no-ffmpeg`, `meeting-model`,
`meeting-tabs`, `meeting-tab-transcript`, `meeting-tab-minutes`, `meeting-tab-translation`,
`meeting-transcript`, `meeting-minutes`, `meeting-translation`, `meeting-unverified`.

## Gotchas

- **25 MB per recording**, because the HTTP adapter refuses a body over 26 MB. Over that is a 413,
  not a truncated upload. A longer meeting is a pasted transcript.
- **A dropped attendee is the guard working, not a bug.** `meeting-unverified` says how many names
  the transcript never said were removed. Check the transcript before reporting it as data loss.
- **Meetings are folders**, under `localDataDir()/meetings/<workspaceId>/<meetingId>/`. There is no
  table and no migration. Deleting a workspace's directory is how you reset the mode.
- **The transcription wire is `/chat/completions` with base64 `input_audio`**, not
  `/audio/transcriptions`, for every id except a Whisper-style one. If you see a request to
  `/audio/transcriptions` from Meeting, the model id is Whisper-shaped — that is by design.
