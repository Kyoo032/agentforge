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

## Recording in the browser (2026-09-21)

The studio can record as well as accept a file. `meeting-recorder` is the panel beside `meeting-file`;
the finished clip becomes a `File` named `recording-<iso>.webm` and goes through the **same**
`POST /api/v1/meetings/:id/recording` the file input uses, so nothing below this point is new. Map:
[`meeting-minutes.md`](../../../../docs/internal/maps/meeting-minutes.md) § Recording.

Testids: `meeting-recorder`, `meeting-record-source`, `meeting-record-start`, `meeting-record-pause`,
`meeting-record-resume`, `meeting-record-stop`, `meeting-record-timer`, `meeting-record-size`,
`meeting-record-requesting`, `meeting-record-stopping`, `meeting-record-capped`,
`meeting-record-tab-hint`, `meeting-record-error`, `meeting-record-dismiss`,
`meeting-record-unsupported`. The studio also gained `meeting-uploading`.

**What you can drive without a microphone.** Select a meeting. `meeting-recorder` is visible.
`meeting-record-source` has two options — microphone, and microphone + tab audio — and switching to
the second reveals `meeting-record-tab-hint`. Press `meeting-record-start` with the permission
denied: `meeting-record-error` renders the mapped copy and `meeting-record-dismiss` clears it. On a
browser with no `MediaRecorder`, `meeting-record-unsupported` replaces the controls. None of this
needs a key or a gateway.

**What needs a real Chrome.** A **granted** microphone. The Browser pane and most automation harnesses
refuse `getUserMedia` outright (`NotAllowedError`, in about 19 ms), so a human at a real Chrome
window, or Chrome launched with `--use-fake-device-for-media-stream`, is the only way to drive:
start → `meeting-record-timer` advancing and `meeting-record-size` growing → pause → resume → stop →
`meeting-uploading` → the meeting's status becomes `recorded` and `meeting-recording` names the file.
Then run the transcription (`meeting-run`) to prove the produced webm is decodable by ffmpeg. **Until
somebody does that, microphone capture is unverified** — say so rather than recording a pass.

**Tab audio** needs a second real tab and the "share tab audio" tick in Chrome's picker. That tick is
the whole point: it is what puts an online meeting's *remote* voices in the recording.

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
  not a truncated upload. A longer meeting is a pasted transcript. **The browser recorder cannot
  produce one**: it records opus at 24 kbps (about 10.8 MB an hour) and auto-stops 512 KB short of
  the cap, keeping everything captured so far and saying so in `meeting-record-capped`.
- **Recording needs the hosted `Permissions-Policy` to allow two features.** `microphone=(self)` and
  `display-capture=(self)` in **both** `packages/host/src/security-headers.ts` and
  `webapp-deploy/Caddyfile`. Without them the browser refuses before any product code runs, so the
  Record button does nothing and there is no error worth reading. Fixed in the tree, never sent to a
  browser — [SR-14](../../../../docs/internal/security-register.md#sr-14). Webdev sends no such header,
  so a green drive on `:3000` says nothing about the deploy.
- **A `.webm` recording is stored as `recording/source.weba`.** `EXT_BY_MIME` maps `audio/webm` to
  `weba`. Cosmetic: ffmpeg reads by content. Do not go looking for a `.webm` on disk.
- **Replacing a recording now deletes the old file.** Re-uploading over an existing recording removes
  every other `source.<ext>` in that meeting's `recording/` and drops the derived `audio/` chunks
  ([SR-13](../../../../docs/internal/security-register.md#sr-13)). Never driven through the UI — if you
  do it, record what you saw.
- **A dropped attendee is the guard working, not a bug.** `meeting-unverified` says how many names
  the transcript never said were removed. Check the transcript before reporting it as data loss.
- **Meetings are folders**, under `localDataDir()/meetings/<workspaceId>/<meetingId>/`. There is no
  table and no migration. Deleting a workspace's directory is how you reset the mode.
- **The transcription wire is `/chat/completions` with base64 `input_audio`**, not
  `/audio/transcriptions`, for every id except a Whisper-style one. If you see a request to
  `/audio/transcriptions` from Meeting, the model id is Whisper-shaped — that is by design.
