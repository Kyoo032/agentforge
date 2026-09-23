# Music

Music is the third generate studio (describe-or-lyrics brief, style, title, instrumental, gallery). Without a gateway key the expected state is `music-studio-needs-key`. Two things are unlike Images and Videos and both come from the gateway: **one job returns two takes for one charge**, and the wire is an async Suno relay mounted on the gateway *origin* (`POST /suno/submit/music`, then `GET /suno/fetch/<id>`), not a `/v1` route. That relay has **never been driven live** — Cloud has no egress to the gateway host — so every automated check below stubs `fetch`, and `scripts/probe-gateway-music.ts` is the one-command live proof a keyed desk still owes. Do not paste a gateway key into the shared webdev Settings desk.

## Sub-features

- `music-rail` reaches `/music` from `mode-music` on Default.
- `music-shell` shows `music-studio`.
- `music-needs-key` shows `music-studio-needs-key` when no key is ready. Copy points at Settings through `SettingsLinkHint`, so assert the single `<a href="/settings">`, not the word "Settings" (locale-dependent).
- `music-empty` shows `music-studio-empty` when the gallery has no tracks.
- `music-modes` shows `music-studio-mode`, a `<select>` with two options, `describe` ("Describe it") and `custom` ("My lyrics"), plus `music-studio-mode-hint` explaining which fields the current mode uses. `custom` adds `music-studio-lyrics` above `music-studio-prompt` (which stays in both modes); `music-studio-style`, `music-studio-title` and `music-studio-instrumental` sit inside the closed `music-studio-advanced` disclosure ("Advanced", `apps/web/components/music-studio.tsx:301`) in **both** modes since 0.15.0 — in the DOM, not visible until it is opened. The header is the title plus one outcome line, `expected-inputs` = "You get: a finished song, saved to the library below and downloadable."; the rail row reads `Music` with no `New` badge. Which fields exist at all is `musicCapabilities(model)` ([`audio-capabilities.ts`](../../../../packages/core/src/models/audio-capabilities.ts)): today only `suno_*` ids carry lyrics / style / title / instrumental, and `resolveMusicMode` silently downgrades Custom to Describe on a model that has no lyrics field. Read the mode back after a model change rather than assuming it stuck.
- `music-instrumental` shows `music-studio-instrumental`, a checkbox, on a model that supports it. It rides the wire as `make_instrumental`.
- `music-draft-lyrics` shows `music-studio-draft-lyrics` in both modes (driven 2026-09-23). It posts `POST /api/v1/music/lyrics` and fills the lyrics box. **Nothing is stored** — no media row, no gallery tile, no Knowledge card — because it exists so the desk can edit the words before spending a music charge.
- `music-estimate` shows the pre-generate cost line `music-studio-estimate` and, beside it, `music-studio-takes-note` ("two takes, one charge"). Music is billed flat per job, so the unit is `track`, not `second`. Suno publishes no API list price at all — it sells a consumer subscription — so an id with nothing in the cached gateway catalog falls to `music-studio-estimate-unknown` and **must name no vendor**. Maps: [`music-mode.md`](../../../../docs/internal/maps/music-mode.md) (the spine), [`media-cost-estimate.md`](../../../../docs/internal/maps/media-cost-estimate.md) (the price line), [`renderer-media.md`](../../../../docs/internal/maps/renderer-media.md) (why the gallery `src` is always host-served).
- `music-voice-unavailable` shows `music-studio-voice-unavailable` inside `music-studio-voice` — a sentence, not a control. The host answers `GET /api/v1/music` with `speechUnavailable: "realtime_only" | "no_audio_models" | null`; the studio renders the matching reason. On this gateway the only TTS id is `qwen3-tts-instruct-flash-realtime`, which speaks WebSocket behind an `openai` endpoint label and cannot be driven from a job route, so the expected reason is `realtime_only`. **There is no voice-over button to press, and its absence is the pass.**
- `music-library` shows `music-studio-library` with one `music-studio-track` per saved take — an `<audio>` element plus `music-studio-download`. A single generate adds **two** rows, not one.
- `music-ingest` — a successful generate also writes one `Music` work card per take to the Knowledge Base (prompt or lyrics, model, style, title, duration, `media:<id>` pointer; no bytes). `music-studio-draft-lyrics` adds nothing. See [knowledge-ingest.md](./knowledge-ingest.md).

## How to get to it (user POV)

- Choose Music on the left rail (`mode-music`). Default already has the tab.
- Open `http://127.0.0.1:3000/music` when the tab is unlocked.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-music` is visible. If not, skip with that precondition — same rule as Images and Videos.
- Do not submit `music-studio-submit` on the shared Cloud `:3000` desk. A live music generate is an operator-asked action on a desk that owns its key.

- **Open Music.** Click `mode-music`. URL matches `/music` (15s). `music-studio` is visible (15s).
- **Settle before asserting.** `loading` starts true and suppresses both `music-studio-needs-key` and `music-studio-empty`. Wait for `music-studio-mode` to be visible and the model select to gain options — that is `GET /api/v1/music` landing — before reading either. Harness-wide gotcha **G1**.
- **No-key state.** `music-studio-needs-key` is visible when the studio is not ready. Assert the anchor, not the copy.
- **Empty gallery.** `music-studio-empty` reads that nothing is here yet. On a desk whose media store already carries audio rows this is `verified-unreachable (gallery not empty)` — record it, never delete rows to reach the state.
- **Mode switch.** `selectOption("custom")` on `music-studio-mode` (it is a `<select>`; clicking an option does nothing): `music-studio-lyrics` becomes visible and `music-studio-prompt` stays. `music-studio-mode-hint` changes from "Say what the song is. The model writes the lyrics." to "Paste your own lyrics. Style and title are yours too." Open `music-studio-advanced`: style, title and instrumental become visible. `selectOption("describe")` hides `music-studio-lyrics` again. No POST, no key. Driven 2026-09-23 on `suno_music`.
- **Caps.** `music-studio-prompt` stops at 1 000 characters, `music-studio-lyrics` at 3 000, `music-studio-style` at 200, `music-studio-title` at 80 (`MUSIC_*_MAX`, `audio-capabilities.ts:32-35`). Paste-longer-than-the-cap is truncated, not rejected.
- **Cost estimate.** With a model selected, `music-studio-estimate` is visible, or `music-studio-estimate-unknown` when the catalog has no figure for that id. `music-studio-takes-note` sits beside it. No POST, no key, no network: `GET /api/v1/music` is ungated and prices from the already-cached gateway catalog.
- **Voice-over reason.** `music-studio-voice-unavailable` is visible and non-empty. On a desk with a live catalog it should read the realtime-only sentence. A **blank** box means a missing locale key, which is a fail; a missing box entirely means the host returned `speechUnavailable: null`, i.e. the gateway has started listing a reachable TTS id — that is news, not a fail, and belongs in `docs/internal/unreleased.md`.
- **Empty-brief guards.** Submit Custom with no lyrics, and Describe with no description. Both are `400` from `parseMusicGenerateBody` before anything can be billed, and the message names the missing field. Safe on a keyless desk, where the earlier `ready` check answers first.
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), the rail reads `Musik` and the studio strings come from `apps/web/locales/id/music.json`. Testids are locale-invariant. `apps/web/lib/music-locale.test.ts` holds the two key trees aligned.
- **Other handles on this page.** `music-studio-prompt-bar` (the `<form>`), `music-studio-submit`, `music-studio-generating-hint` (shown while a job runs — a Suno job polls for up to ~5 minutes, so this is a long-lived state, not a flash), `music-studio-error` (the red box, `role="alert"`).
- **IDE proof.** Screenshot of the shell, the needs-key banner and the voice-over reason under `evidence/music/<run-id>/`.
- **Automated proof already in the repo.** `packages/core/src/models/audio-capabilities.test.ts` (roles, reason codes, capability snapping), `packages/core/src/tools/platform/gateway-audio.test.ts` (payload shapes, relay path, poll behaviour, failure reading), `packages/host/src/handlers/music.test.ts` (the whole host path against a stubbed relay: submit → poll → two media rows → gallery → bytes served back), `apps/web/lib/music-locale.test.ts`.
- **Live proof, still owed.** On a desk with a real key: `OPENAI_API_KEY=… pnpm exec tsx scripts/probe-gateway-music.ts`. Exit 0 means the catalog listed a music id, the relay accepted a submit and a finished job returned a playable URL. Exit 1 prints which of the three steps failed; exit 2 means no key. **Record the exit code and the step it reached** — until this exits 0, the relay's request and response shapes are documented, not verified.

## Gotchas

- **One generate produces two rows.** `POST /api/v1/music` answers with a `tracks` array. A recipe that asserts `music-studio-track` count 1 after one submit is asserting the wrong thing.
- **`music-studio-needs-key` is the stub pass.** A missing banner on a keyless Cloud run is a product fail.
- **The relay is on the gateway origin, not under `/v1`.** `https://<gateway>/suno/submit/music`, not `…/v1/suno/…`. A 404 there is answered with a purpose-written message naming the path that was tried — if you see it, the mount moved, and the fix is `gateway-audio.ts`, not the studio.
- **A clip URL during `IN_PROGRESS` is the streaming take, not the finished file**, and a failed Suno job still returns `code: "success"` with the real reason in `data.fail_reason`. Both are handled; both will bite anyone reading the relay's JSON by hand.
- **There is no voice-over control and no transcription here.** Speech is wired (`speech_generate`, `POST /v1/audio/speech`) but has no reachable model id on this gateway. Transcription is not part of this mode at all.
- **The chat media route stays narrow.** `POST /api/v1/media` accepts image and video only; generated audio never arrives as an upload. Harness-wide gotcha **G-27**, guarded by `packages/host/src/edit/import.test.ts`.
- **A `Music` source on `/knowledge` is a text card pointing at `media:<id>`.** Do not look for an mp3 under `data/media/knowledge/`.
- **A visited studio stays mounted** — harness-wide gotcha **G3**. After `/images` → `/music`, `images-studio` is still in the DOM. Assert `isVisible()`, never `count()`, and scope shared queries to `music-studio`.
- **`music-studio-model` has no literal `data-testid=` in the source.** It is a `testId` prop applied inside `ModelSelect`, exactly like `images-studio-model` / `videos-studio-model`. Grepping `apps/web` for it returns nothing; `getByTestId` finds it.
- **The gateway price catalog is the only price source for music.** There is no curated vendor list price to compare against, so `music-studio-estimate-compare` may be absent where the Videos studio would show one. That is correct, not a missing feature.
