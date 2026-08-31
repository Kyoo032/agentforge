# Videos

Videos is a generate studio (prompt, aspect, optional still, gallery). Without a gateway key the expected state is `videos-studio-needs-key`. Live video is unproven on Cloud and must not run there.

## Sub-features

- `videos-rail` reaches `/videos` from `mode-videos` after an agent unlocks the surface.
- `videos-shell` shows `videos-studio`.
- `videos-needs-key` shows `videos-studio-needs-key` when no key is ready.
- `videos-empty` shows `videos-studio-empty` when the gallery has no clips.

## How to get to it (user POV)

- Choose Videos on the left rail (`mode-videos`) after Build (Default template unlocks it).
- Open `http://127.0.0.1:3000/videos` when the tab is unlocked.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- `mode-videos` is visible. If not, skip with that precondition — same rule as Images.
- Do not submit `videos-studio-submit` on Cloud. On Windows, only if the operator asked for a live generate.

- **Open Videos.** Click `mode-videos`. URL matches `/videos` (15s). `videos-studio` is visible (15s).
- **No-key state.** `videos-studio-needs-key` is visible when the studio is not ready (no key). Copy points at Settings.
- **Empty gallery.** `videos-studio-empty` reads that nothing is here yet when there are no clips.
- **IDE proof.** Screenshot of the shell and needs-key banner under `evidence/videos/<run-id>/`.
- **Cloud.** `foundation.spec.ts` asserts `videos-studio` and `videos-studio-needs-key`. That is the stub contract.

## Gotchas

- `videos-studio-needs-key` is the stub pass. A missing banner on a keyless Cloud run is a product fail.
- The studio posts to `/api/v1/videos` (gateway `POST /v1/video/generations` plus poll), not `/runs/video`. A keyless submit is a 400.
- Live video quality and poll time are not in the smoke. One operator generate on this PC is the only live proof.
- Optional still uses `videos-studio-still`. Leave it empty for the shell proof.
