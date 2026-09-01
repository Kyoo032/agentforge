# Models

The Chat model picker lists curated everyday models (with `bestFor` once Phase 1 lands) plus an Advanced disclosure for the rest. Doctor probes `GET /api/v1/models` so a drive knows mode keys, chat-list size, and whether curation metadata is present.

## Sub-features

- `models-doctor` prints `modeKeys`, `chatCount`, and `curation` from doctor. `curation: false` is OK until Phase 1 ships picker metadata.
- `models-everyday` shows the curated Chat list (chat-kind only) with `bestFor` copy when curation is on.
- `models-advanced` reveals the Advanced models disclosure for non-everyday entries.
- `models-picker` opens from Chat via `model-picker`.

## How to get to it (user POV)

- Open `http://127.0.0.1:3000/chat`.
- Click the model control (`model-picker`) in the Chat header / composer chrome.
- Expand Advanced when you need a model outside the everyday list.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0 against `http://127.0.0.1:3000`.
- Record `modeKeys`, `chatCount`, and `curation` from the doctor JSON. Do not fail the drive when `curation` is `false` (pre-Phase 1).

- **Doctor models.** Confirm the report includes `modeKeys` (array), `chatCount` (number), and `curation` (boolean). Non-200 on `GET /api/v1/models` is a doctor fail.
- **Open picker.** Go to `/chat`. Click `model-picker`. The control is visible and not the bare word `Model` alone after models load.
- **Phase 1 handles (optional).** When present, assert `model-group-recommended`, `model-best-for`, and `model-picker-all`. Until those land, do not fail the drive for absence — note them as unmet Phase 1 IDs and continue.
- **IDE proof.** Screenshot of the open picker under `evidence/models/<run-id>/` with Chat identity visible.
- **Cloud.** Prefer doctor JSON assertions in the stub suite; picker UI smoke waits on Phase 1 testids.

## Gotchas

- `curation: false` before Phase 1 is expected, not a harness fail. Do not invent `bestFor` in the UI assert until the payload carries it.
- The Chat list is chat-kind only. Image/video model pickers on Generate surfaces are separate features.
- Future ids `model-group-recommended`, `model-best-for`, and `model-picker-all` land in Phase 1 — skip those steps while absent; do not substitute coordinate clicks.
- Doctor must hit loopback only. Packaged: use `--desktop` / `AGENTFORGE_VERIFY_URL`, never treat :3000 as the installed app.
