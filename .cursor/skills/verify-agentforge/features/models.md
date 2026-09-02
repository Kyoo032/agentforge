# Models

- The Chat model picker lists curated everyday models first (`model-group-recommended`) with per-model `bestFor` hints (`model-best-for`), plus a collapsed Advanced models disclosure (`model-picker-all`) for the rest. Reasoning ids show a `model-thinking-badge`. Doctor probes `GET /api/v1/models` so a drive knows mode keys, chat-list size, and that curation metadata is present.

## Sub-features

- `models-doctor` prints `modeKeys`, `chatCount`, and `curation` from doctor. `curation: true` is expected; `false` is a regression.
- `models-everyday` shows the Everyday group (`model-group-recommended`) — chat-kind only, `tier: "everyday"`, with `friendlyLabel` and `bestFor` (`model-best-for`) on each row.
- `models-advanced` reveals non-everyday entries via the Advanced models disclosure (`model-picker-all`). Search auto-expands Advanced when matches are only in that tier.
- `models-picker` opens from Chat via `model-picker`; the trigger pill shows `friendlyLabel` (not the bare slug) once models load.

## How to get to it (user POV)

- Open `http://127.0.0.1:3000/chat`.
- Click the model control (`model-picker`) in the Chat header / composer chrome. The pill shows the selected model's friendly label.
- Expand Advanced models when you need a model outside the everyday list, or type in Search to surface advanced matches.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0 against `http://127.0.0.1:3000`.
- Record `modeKeys`, `chatCount`, and `curation` from the doctor JSON. Expect `curation: true`.

- **Doctor models.** Confirm the report includes `modeKeys` (array), `chatCount` (number), and `curation: true`. `curation: false` is a fail (catalog missing `friendlyLabel` / `bestFor` / `tier`). Non-200 on `GET /api/v1/models` is a doctor fail. Models in the payload carry `friendlyLabel`, `bestFor`, and `tier` (`"everyday"` | `"advanced"`).
- **Open picker.** Go to `/chat`. Click `model-picker`. The trigger is visible and shows a friendly label — not the bare word `Model` alone after models load.
- **Everyday + bestFor.** Assert `model-group-recommended` is visible. At least one `model-best-for` hint is present on everyday rows.
- **Advanced disclosure.** Assert `model-picker-all` (label Advanced models) is visible and collapsed by default when the selected model is everyday. Click it; advanced options appear. Typing a search that only hits advanced models auto-expands that section.
- **IDE proof.** Screenshot of the open picker under `evidence/models/<run-id>/` with Everyday group, a `bestFor` hint, and Chat identity visible.
- **Cloud.** Doctor JSON must report `curation: true`. Picker UI smoke asserts `model-group-recommended`, `model-best-for`, and `model-picker-all` as real testids.

## Gotchas

- `curation: false` is a regression now that Phase 1 curation ships on `/api/v1/models`. Do not soft-pass it.
- The Chat list is chat-kind only. Image/video model pickers on Generate surfaces are separate features.
- `model-group-recommended`, `model-best-for`, and `model-picker-all` are real — assert them; do not skip or substitute coordinate clicks.
- Settings / studio `<select>` paths (`model-select.tsx`) use Everyday / Advanced optgroups with `friendlyLabel — bestFor` option text; Chat uses the palette above.
- Doctor must hit loopback only. Packaged: use `--desktop` / `AGENTFORGE_VERIFY_URL`, never treat :3000 as the installed app.
