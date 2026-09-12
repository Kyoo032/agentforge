# Models

- The Chat model picker lists curated models first under **Recommended** (`model-group-recommended`) with per-model `bestFor` hints (`model-best-for`), then brand groups (`GPT`, `Claude`, `Gemini`, …) with no extra testids. There is no Advanced disclosure and no `model-picker-all`. Reasoning ids show a `model-thinking-badge`. Doctor (webdev) probes `GET /api/v1/models` so a drive knows mode keys, chat-list size, and that curation metadata is present.

## Sub-features

- `models-doctor` prints `modeKeys`, `chatCount`, and `curation` from webdev doctor. `curation: true` is expected on webdev; `false` is a regression there. Packaged `--desktop` cannot GET models over HTTP — `curation: false` / empty `modeKeys` on that surface is expected, not a fail.
- `models-recommended` shows the Recommended group (`model-group-recommended`) — chat-kind only, `tier: "everyday"`, with `friendlyLabel` and `bestFor` (`model-best-for`) on each row. The UI label is **Recommended**; the catalog tier is still `everyday`.
- `models-brand-groups` lists the rest under brand headers (`GPT`, `Claude`, `Gemini`, …). Those headers have no testids — scroll or search; do not look for `model-picker-all`.
- `models-picker` opens from Chat via `model-picker`; the trigger button shows `friendlyLabel` (not the bare slug) once models load.

## How to get to it (user POV)

- Open `http://127.0.0.1:3000/chat`.
- Click the model control (`model-picker`) in the composer toolbar (`composer-toolbar`). The button shows the selected model's friendly label.
- Scroll or search past Recommended to reach a brand-group model.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0 against `http://127.0.0.1:3000` (webdev).
- Record `modeKeys`, `chatCount`, and `curation` from the doctor JSON. Expect `curation: true` on webdev.

- **Doctor models.** Confirm the report includes `modeKeys` (array), `chatCount` (number), and `curation: true`. `curation: false` on **webdev** is a fail (catalog missing `friendlyLabel` / `bestFor` / `tier`). Non-200 on `GET /api/v1/models` is a doctor fail. Models in the payload carry `friendlyLabel`, `bestFor`, and `tier` (`"everyday"` | `"advanced"`).
- **Open picker.** Go to `/chat`. Click `model-picker`. The trigger is visible and shows a friendly label — not the bare word `Model` alone after models load.
- **Recommended + bestFor.** Assert `model-group-recommended` is visible. At least one `model-best-for` hint is present on Recommended rows.
- **Brand groups.** After Recommended, brand-group rows exist. Search can surface a non-recommended id. Do not assert `model-picker-all`.
- **IDE proof.** Screenshot of the open picker under `evidence/models/<run-id>/` with Recommended group, a `bestFor` hint, and Chat identity visible.
- **Cloud.** Doctor JSON must report `curation: true`. Picker UI smoke asserts `model-group-recommended` and `model-best-for` as real testids.

## Gotchas

- `curation: false` on webdev is a regression now that Phase 1 curation ships on `/api/v1/models`. Do not soft-pass it. On `--desktop`, `curation: false` is the doctor limit (no HTTP models probe).
- The Chat list is chat-kind only. Image/video model pickers on Generate surfaces are separate features. Documents / Research / Presentation generate bars use `*-studio-model` (`model-select.tsx`). Section/slide regen uses `*-regen-model` on the regen panel. Knowledge embedding uses a flat `Embeddings` group when `flat`.
- The Chat **wire** picker (`chat-wire`) is independent of the model: picking Claude does not force Messages, and picking Messages does not force a Claude id.
- `model-group-recommended` and `model-best-for` are real — assert them. `model-picker-all` was removed; do not invent it.
- Settings / studio / Knowledge `<select>` paths (`model-select.tsx`) use **Recommended + brand** optgroups (`GPT`, `Claude`, …) with `friendlyLabel — bestFor` option text, not Everyday / Advanced optgroups. Chat uses the palette above.
- Doctor must hit loopback only. Packaged: use `--desktop`, never treat :3000 as the installed app.
