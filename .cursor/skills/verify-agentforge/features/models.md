# Models

The Chat model picker lists curated models first under **Recommended** (`model-group-recommended`) with per-model `bestFor` hints (`model-best-for`), then brand groups (`GPT`, `Claude`, `Gemini`, …) with no extra testids. There is no Advanced disclosure and no `model-picker-all`. Reasoning ids show a `model-thinking-badge`. Doctor (webdev) probes `GET /api/v1/models` so a drive knows mode keys, chat-list size, and that curation metadata is present.

## Sub-features

- `models-doctor` prints `modeKeys`, `chatCount`, and `curation` from webdev doctor. `curation: true` is expected on webdev; `false` is a regression there. Packaged `--desktop` cannot GET models over HTTP — `curation: false` / empty `modeKeys` on that surface is expected, not a fail.
- `models-recommended` shows the Recommended group (`model-group-recommended`) — chat-kind only, `tier: "everyday"`, with `friendlyLabel` and `bestFor` (`model-best-for`) on each row. The UI label is **Recommended**; the catalog tier is still `everyday`.
- `models-brand-groups` lists the rest under brand headers (`GPT`, `Claude`, `Gemini`, …). Those headers have no testids — scroll or search; do not look for `model-picker-all`. Brand rows still carry `model-best-for` (`apps/web/components/model-picker.tsx:288` is unconditional on group), so a `model-best-for` hit does **not** prove you are inside Recommended — assert `model-group-recommended` for that.
- `models-picker` opens from Chat via `model-picker`; the trigger button shows `friendlyLabel` (not the bare slug) once models load. The trigger wrapper is `relative w-36 min-w-[7rem] shrink` (144px, 112px floor).
- `models-job-fallback` a **job** mode's model is not always the one that answers. When a call fails with a transport-class error, the host retries once on a stand-in and the result carries a `notice` of `{ code: "model_fallback", from, to }` (`packages/core/src/models/job-fallback.ts:9-21`). Finance is the only desk that renders it today: `finance-result-model-fallback` (`apps/web/components/finance-steps/finance-result-notices.tsx:23`), reading "{from} is unavailable; used {to}". Every other job mode gets the same swap through `collectJobAssistantText` and shows nothing. This is not the Chat picker and there is no testid for it on `/chat`.
- `models-picker-panel` is `model-picker-panel` — the list itself (`apps/web/components/model-picker.tsx:327`, trigger at `:386`), portalled with `createPortal(…, document.body)` as `fixed z-[80]` and positioned by `placePickerPanel` (`apps/web/lib/picker-panel.ts`). Inside it only `model-group-recommended` (Recommended group only), `model-best-for`, and `model-thinking-badge` are testids; there is no search-box testid and no per-option testid — rows are `[role="option"]`. `reasoning-effort` is a **sibling** control in `chat-composer.tsx`, not part of the picker. Portal mechanics and narrow-pane rules live in [chat.md](./chat.md) — `chat-model-switch`.

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
- **Switch a model.** Click `model-picker`; `model-picker-panel` opens outside the composer toolbar row. Click an option that carries **no** check mark. Proof is the trigger label becoming that model's `friendlyLabel` — not the panel closing. Driven 2026-09-17 at 1280×800 (`chatCount: 110`): trigger `GPT 5.6 Luna` → `Claude Sonnet 5`, trigger `clientWidth` 142px (box 144), `model-picker-panel` box x=409 y=379 w=352 h=344 (flipped above the trigger, clear of the toolbar row), **101** `[role="option"]` rows, panel gone after select. The panel width (352) and height (344) are stable across viewports; x/y are not — assert the box does not overlap the toolbar row, not fixed coordinates. Option count tracks the catalog and drifts; do not pin it.
- **IDE proof.** Screenshot of the open picker under `evidence/models/<run-id>/` with Recommended group, a `bestFor` hint, and Chat identity visible.
- **Cloud.** Doctor JSON must report `curation: true`. Picker UI smoke asserts `model-group-recommended` and `model-best-for` as real testids.

## Gotchas

- `curation: false` on webdev is a regression now that Phase 1 curation ships on `/api/v1/models`. Do not soft-pass it. On `--desktop`, `curation: false` is the doctor limit (no HTTP models probe).
- The Chat list is chat-kind only. Image/video model pickers on Generate surfaces are separate features. Documents / Research / Presentation generate bars use `*-studio-model` (`model-select.tsx`). Section/slide regen uses `*-regen-model` on the regen panel. Knowledge embedding uses a flat `Embeddings` group when `flat`.
- `model-group-recommended` and `model-best-for` are real — assert them. `model-picker-all` was removed; do not invent it.
- Doctor `chatCount` (110 on 2026-09-17) is the chat-kind model count from `/api/v1/models`; the picker rendered 101 rows. They are allowed to differ — do not assert equality.
- The Recommended group's **visible** header is locale copy (`Disarankan` on an `id` desk). `model-group-recommended` is the handle; the brand headers (`GPT`, `Claude`, …) are brand names and stay untranslated.
- Settings / studio / Knowledge `<select>` paths (`model-select.tsx`) use **Recommended + brand** optgroups (`GPT`, `Claude`, …) with `friendlyLabel — bestFor` option text, not Everyday / Advanced optgroups. Chat uses the palette above.
- The currently-selected option's text is prefixed with a check mark (`U+2713`). A driver that picks “the first option whose label differs from the trigger label” therefore re-picks the current model and proves nothing. Pick an option that carries no check mark.
- `model-picker-panel` closes on Escape, on an outside mousedown, and on selecting an option. Scrolling **re-places** it; it does not close it.
- **A job mode that answers on a different model than the picker shows is not a bug.** `runWithJobModelFallback` (`packages/host/src/job-model-fallback.ts:147-173`) swaps **once** and only on a transport-class failure — 502/503/504, `unavailable`, `ECONNREFUSED`, `fetch failed`, the response-header abort and the stream watchdog (`GATEWAY_UNAVAILABLE`, `packages/core/src/models/job-fallback.ts:43-44`). A 400/401/403/404/422/429, a bad key, an unknown model, a context-length error, a content filter or "returned no text" is **never** swapped (`NOT_A_TRANSPORT_FAILURE`, `:55-56`). Two more hard stops: a model the person picked themselves in the studio bar is never swapped (`modelExplicit`), and neither is a call that had already started streaming — a half-written answer is not re-run (`job-model-fallback.ts:126-134`). If the stand-in also fails, the original error is rethrown untouched, status and all.
- **The stand-in comes from a per-mode list, then a shared tail.** `JOB_MODE_PREFERENCES[mode]` (`packages/core/src/models/mode-defaults.ts:57-79`) followed by `JOB_FALLBACK_TAIL = ["gpt-5.6-luna", "claude-sonnet-5", "gpt-5.6-sol", "kimi-k3"]` (`packages/core/src/models/job-fallback.ts:36`), filtered to ids actually live in this desk's catalog and deduped. A mode the host was given no name for gets the tail only. Do not pin the chosen id in a recipe — it tracks the catalog.
- **A failed model is skipped for five minutes afterwards.** `JOB_MODEL_DOWN_MS = 5 * 60 * 1000` (`packages/host/src/job-model-fallback.ts:25`); `startModel` (`:119-124`) skips a model still marked down before the *first* attempt, so a second job can land on the stand-in with no failure of its own. Saving Settings or signing out clears that breaker (`resetJobModelCircuit`, `packages/host/src/handlers/settings.ts:170`, `:318`) — so re-save the key before concluding a model is unreachable.
- **The notice is not an SSE event.** It rides the final JSON result, not `job.*`, so a driver watching the stream will not see it. Read `result.notice` — or the `finance-result-model-fallback` line — after the job returns.
- Do not restate the portal story here. The toolbar wrap rule, the ≥110px trigger floor, the 480px rail caveat, and the Playwright-calls-a-clipped-option-visible trap are in [chat.md](./chat.md) — the `chat-model-switch` bullet and its Gotchas.
- Doctor must hit loopback only. Packaged: use `--desktop`, never treat :3000 as the installed app.
