# Videos

Videos is a generate studio (prompt, aspect, duration, optional resolution, optional still, gallery). Without a gateway key the expected state is `videos-studio-needs-key`. Cloud must not paste a gateway key into the shared webdev Settings desk. Live Toko Token proof is the isolated matrix (gitignored `evidence/videos/live-matrix/`), not a generate from the stub studio.

## Sub-features

- `videos-rail` reaches `/videos` from `mode-videos` on Default.
- `videos-shell` shows `videos-studio`.
- `videos-needs-key` shows `videos-studio-needs-key` when no key is ready.
- `videos-empty` shows `videos-studio-empty` when the gallery has no clips.
- `videos-examples` shows the bundled example clips (`videos-example-card` × 6, each with a playing `videos-example-video` served from `resources/examples/videos/`); `videos-example-use-<templateId>` loads that template's prompt. Absent (not an error) on a checkout that has not run `pnpm videos:examples`.
- `videos-knobs` shows `videos-studio-aspect`, `videos-studio-seconds` (5 / 8 / 10), `videos-studio-resolution` (480p / 720p / 1080p), and `videos-studio-still`. Resolution is disabled when the selected model is not Seedance-class (for example `grok-imagine-video`).
- `videos-ingest` — a successful generate also writes a `Videos` work card to the Knowledge Base (prompt, model, aspect, duration, `media:<id>` pointer; no bytes). `videos-example-use-*` only loads a prompt and never adds a source. See [knowledge-ingest.md](./knowledge-ingest.md).

## How to get to it (user POV)

- Choose Videos on the left rail (`mode-videos`). Default already has the tab.
- Open `http://127.0.0.1:3000/videos` when the tab is unlocked.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-videos` is visible. If not, skip with that precondition — same rule as Images.
- Do not submit `videos-studio-submit` on the shared Cloud `:3000` desk. Isolated live matrix (in-process key, never Settings) is the Cloud live proof. On Windows, only generate from the product UI if the operator asked.

- **Open Videos.** Click `mode-videos`. URL matches `/videos` (15s). `videos-studio` is visible (15s).
- **No-key state.** `videos-studio-needs-key` is visible when the studio is not ready (no key). Copy points at Settings.
- **Empty gallery.** `videos-studio-empty` reads that nothing is here yet when there are no clips.
- **Knobs.** `videos-studio-seconds` and `videos-studio-resolution` are present with aspect + still. Example gallery stays. Do not generate.
- **Example use does not ingest.** Click a `videos-example-use-*`, then open `/knowledge`: no new `Videos` row and `knowledge-loop-work` unchanged. Only a real `POST /api/v1/videos` (live generate, operator asked) adds a `Videos` source; the gallery leaves `videos-studio-empty` at the same time.
- **IDE proof.** Screenshot of the shell and needs-key banner under `evidence/videos/<run-id>/`.
- **Cloud stub.** `foundation.spec.ts` asserts `videos-studio` and `videos-studio-needs-key`. That is the stub contract. Do not generate from the shared desk.
- **Cloud live matrix (2026-09-02, isolated).** `GET /v1/models` 200 (174 ids: 100 chat / 40 image / 24 video). `seedance-2.0-fast` and `doubao-seedance-2-0-260128` returned **403** `prepaid_async_requires_fixed_price` (prepaid proxy, not a bad key). `grok-imagine-video` accepted `prompt` + `duration` and also `seconds` (POST 200); first variant polled a video URL; Seedance `ratio` returned **400** `json: unknown field "ratio"`. Still/image variant skipped (no live public still). Evidence: `evidence/videos/live-matrix/results.json` (gitignored).

## Gotchas

- `videos-studio-needs-key` is the stub pass. A missing banner on a keyless Cloud run is a product fail.
- The studio posts to `/api/v1/videos` (gateway `POST /v1/video/generations` plus poll), not `/runs/video`. A keyless submit is a 400.
- Live Seedance-class jobs on this prepaid test key are **403** (`prepaid_async_requires_fixed_price`). That is a billing/proxy class, not a knob or key-format fail. Grok Imagine video is the live generate proof on this key.
- Do not save the test key to shared `:3000` Settings. That flips the whole local webdev to live.
- Optional still uses `videos-studio-still`. Leave it empty for the shell proof.
- A `Videos` source on `/knowledge` is a text card pointing at `media:<id>`. Do not look for an mp4 under `data/media/knowledge/`.
- `videos-studio-resolution` is a Seedance-class field. grok-imagine / default OpenAI-like models keep seconds + still and must not send `ratio` / `resolution` on the wire. The live matrix confirmed grok rejects `ratio`.
