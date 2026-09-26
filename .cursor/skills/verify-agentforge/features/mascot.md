# Mascot

The placeholder Nultron character is one component, `PlaceholderMascot` (`chat-mascot`, `data-placeholder="nultron-mascot"`). Job desks place it through `MascotSlot`; states are data in `apps/web/lib/mascot-states.ts`. Chat's hero orb is [chat.md](./chat.md). The map is [`docs/internal/maps/chat-send.md`](../../../../docs/internal/maps/chat-send.md).

## Sub-features

- `mascot-pose` — `data-state` is the activity, `data-pose` is the drawing (`answering` shares the writing pose). Home pose when no phase has arrived: chat `idle`, documents `writing`, research `searching`, finance `calculating`, data `calculating`, market `charting`, legal `reviewing`, meeting `listening`, images `painting`, videos `filming`, music `listening`, edit `editing`, presentations `presenting`, education `presenting`, knowledge `searching`. Tooltip and `aria-label` come from `common.mascot.*` (en and id).
- `mascot-placement` — `data-placement="empty"` on an unused desk (`ModeIllustration`, the Legal new-matter screen, Knowledge sources, and Market above the board when a watchlist exists and no job is running). `data-placement="beside"` next to `JobProgressList` (`finance-progress`, `research-progress`, `data-progress`, `market-progress`, `meeting-progress`, `legal-progress`) and beside a generate or export control only while that control is busy.
- `mascot-phase` — the active `job.phase` / `job.step` id picks the pose: planning, distilling, debate, risk → `thinking`; searching, reading, indexing, resolving → `searching`; drafting, minuting, saving, translating, synthesis → `writing`; computing, profiling, analyzing, quotes → `calculating`; verifying → `reviewing`; analysts, macro → `charting`; extracting, transcribing → `listening`. An unknown id uses the mode's home pose. `failed` → `error`. `done` with no error → `celebrating`.
- `mascot-idle-sleep` — an empty job desk waves (`data-state="wave"`) for about 1.4s, settles on the home pose, then `sleep` after 45s if it stays unused. `?mascot=<state>` forces that state and skips both timers. `?mascotMode=<mode>` overrides `data-mode`.
- `mascot-reduced-motion` — `prefers-reduced-motion` sets `animation: none` on every looping `.chat-mascot` selector in `apps/web/app/globals.css`. The pose stays. Assert `data-state` and `data-pose`, not that something is moving.

## How to get to it (user POV)

- Open a job mode on Default (`/documents`, `/research`, `/finance`, `/data`, `/market`, `/legal`, `/meeting`, `/images`, `/videos`, `/music`, `/edit`, `/presentations`, `/knowledge`).
- An unused desk shows the character in the empty state, in that mode's home pose after the wave.
- A running job shows the same character beside the phase list or the busy generate control.
- Education has no route. `/presentations?mascotMode=education` is the stand-in (`data-mode="education"`, presenting pose).

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0 against `http://127.0.0.1:3000`.
- `runtime: "stub"`. Do not start a job that spends a key.

- **Home pose.** Open `/documents`. `chat-mascot` is visible with `data-placeholder="nultron-mascot"`, `data-placement="empty"`, `data-mode="documents"`. Right after load `data-state` is `wave`; after ~1.4s it is `writing` and `data-pose` is `writing`. Repeat per mode and expect that mode's home pose (Market with tickers: the slot above the board, `charting`; Knowledge: the slot on sources, `searching`).
- **Forced pose.** Open `/documents?mascot=sleep`. `data-state` is `sleep` immediately — no wave, and it does not change after 45s. Any `MASCOT_STATES` value works the same way. Cycle them to prove every pose without waiting out the sleep timer.
- **Beside a job.** On a mode that renders `JobProgressList`, a running job shows a second look at the same testid with `data-placement="beside"`. `data-state` follows the active phase id in the map above. A failed job is `error`. A finished job with no error is `celebrating`.
- **Reduced motion.** Emulate `prefers-reduced-motion: reduce`, reload `/documents?mascot=writing`. `data-state` is still `writing` and the writing prop is in the SVG. Do not assert an animation.
- **Locale.** On an `id` desk the `aria-label` is the Indonesian `common.mascot.*` string (writing: `Sedang menulis`). The testid does not move.
- **IDE proof.** One screenshot per mode under `evidence/mascot/<run-id>/` showing `data-state` equal to that mode's home pose.

## Gotchas

- Chat's empty hero uses `PlaceholderMascot` directly at `idle`. It does not wave and it does not sleep. Drive job desks for those two.
- `?mascot=` is a drive hook. It is not a user control.
- Do not wait 45s for `sleep` on a normal drive. Use `?mascot=sleep`.
- Education is not a product route in this tree. A missing `/education` is not a fail.
- The art is a placeholder. Swap the `<svg>` later; keep the testid, `data-placeholder`, and `data-state`.
- Assert attributes. A green paint of the SVG with the wrong `data-state` is a fail.
