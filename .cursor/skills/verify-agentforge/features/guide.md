# Guide

The first-run tour and the first desk it points at. After first-run setup a short guided tour is offered once: five coach marks on the real shell (the rail and its tools, Workspaces, the Chat composer, the Knowledge Base, Settings), each with Next, Back (not on the first), a visible Skip and a close button. Esc closes it and a click outside does nothing. A fresh **Personal** desk starts with Research, Images, Videos and Presentation plus Chat only; the tour's second stop is where the rest are switched on. How it works, file by file: [`docs/internal/maps/first-run-desk-and-guide.md`](../../../../docs/internal/maps/first-run-desk-and-guide.md). The tour is shared by Personal and Enterprise; the first-desk rule is Personal's.

## Sub-features

- `guide-offer` is the welcome card: `guide-card` with `data-guide-mode="offer"`, `guide-next` ("Show me around"), `guide-skip`, `guide-close`. No `guide-back`, no `guide-progress`, no `guide-dots`. Centred.
- `guide-steps` is the five stops, `data-guide-step` = `modes`, `workspaces`, `chat`, `knowledge`, `settings` and `data-guide-index` 0 to 4. `guide-progress` reads "Step n of 5"; `guide-dots` is decoration (`aria-hidden`). `guide-back` is absent on the first stop. The last stop's `guide-next` reads "Done".
- `guide-anchor` is `guide-spotlight`, the ring on the element being pointed at. It follows the anchor; a missing anchor has no ring and the card is centred (`data-guide-placement="center"`), a window with no room beside it gets `sheet` (a bottom sheet with the anchor still ringed).
- `guide-modal` is what open does to the page: `#root` has `inert`, `guide-backdrop` swallows every click, focus is on `guide-card` (`role="dialog"`, `aria-modal="true"`, `aria-label`, `aria-describedby`), and `guide-live` carries the step text for a screen reader.
- `guide-dismiss` is the way out, by testid `guide-skip` (outcome `skipped`), `guide-close` or Esc (outcome `closed`), and `guide-next` on the last stop, Done (outcome `finished`). Each is written to the host (`POST /api/v1/settings/guide`) and the tour never opens on its own again.
- `guide-replay` is `settings-guide` on Settings with `settings-guide-replay` ("Replay the guide"): opens step one on the page the person is on. It does not navigate.
- `guide-first-desk` is the rail of a fresh Personal desk: `mode-chat`, `mode-research`, `mode-images`, `mode-videos`, `mode-presentations`, `mode-knowledge`, and counts of 0 for `mode-documents`, `mode-finance`, `mode-data`, `mode-market`, `mode-legal`, `mode-meeting`, `mode-music`, `mode-edit`, `mode-education`.
- `guide-tour-hint` is `onboarding-tour-hint` under `onboarding-start`: "A quick tour comes next. You can skip it." It is absent once the host says the guide was seen.

## How to get to it (user POV)

- Install Nultron on a machine that has never run it, paste a key, and press Start in Chat. The welcome card is over Chat. Show me around, then Next through the five stops, or Skip, or press Esc.
- Later, Settings → Guide → Replay the guide.
- To see the narrow desk, that same first launch is the only way: the first desk is written once, on a fresh data dir or by Start over ("all").

## Driving it with the Nultron harness

Preconditions:

- **Never press Start over on `:3000`, and never write to the operator's desk.** The tour opens only after first-run setup, which `:3000` (a keyed desk with every mode) never shows, so drive it with the host's answers **faked in the browser**: a scratch Playwright script that answers `GET /api/v1/settings` from `route.fetch()` with `gateway` replaced by a `needs_key` gate and `guide` set to `{ seen: false }`, answers `GET /api/v1/workspaces` with a desk whose `productModes` are `chat, research, images, videos, presentations`, records `POST /api/v1/settings/guide` and returns `{ guide: { seen: true } }`, and answers every other write on `/api/v1/settings*` and `/api/v1/workspaces*` itself so nothing reaches the host. Type only a dummy key. The 2026-09-29 script is the model; keep it in the run's scratch directory, not in `scripts/`.
- The host half (the record, and Start over erasing it) is proven by `packages/host/src/first-run-modes.test.ts` and `packages/host/src/handlers/guide.test.ts`, which use a real empty `AGENTFORGE_DATA_DIR`. `POST /api/v1/settings/guide` answers 404 until `:3000` is restarted by the operator; say so in the report and drive on the fake.
- Hot updates: Vite serves a module under a `?t=` query after an edit, so `import("/lib/guide-store.ts")` from the page is a second copy of the store. Get the URL from `performance.getEntriesByType("resource")`.

Drive:

- **Offer.** Onboarding: Continue, dummy key, Check this key, Start in Chat. `guide-card` has `data-guide-mode="offer"`, is centred, `document.activeElement` is the card, `#root` has `inert`, and the rail behind it shows exactly the first-desk testids above.
- **Steps.** Show me around. Each stop: `data-guide-step` and `data-guide-index`, `guide-progress`, a `guide-spotlight` ring whose box matches the anchor's, the card fully inside the window, `guide-back` present from stop two, Skip and close on every stop. Stop one names the desk's tools (Research, Images, Videos, and Presentation); stop two names up to three tools the desk does not have yet (Documents, Finance, and Data), and on a desk that has every tool says so instead; stop three is anchored on `composer` from Chat. A held Enter or arrow key advances one stop, not all of them.
- **Outside click.** Click a corner of the dimmed desk on the offer and on a step: the tour is still open, on the same stop.
- **Keyboard only.** From Settings, focus `settings-guide-replay` and press Enter: the tour opens on stop one (no offer), focus on the card. Enter on the card, or ArrowRight, is Next; ArrowLeft is Back; Tab and Shift+Tab visit close, Skip, Back, Next and wrap without leaving the card; Space on a focused Next advances; Esc closes and focus returns to `settings-guide-replay`. Five Enters from the card walk the whole tour to Done.
- **Persistence.** Skip, close and Esc each POST `skipped`, `closed`, `closed`; Done posts `finished`. After each, reload with the fake host now saying `seen: true`: nothing opens. Send the fake back to `needs_key` and finish first-run setup again: still nothing, and `onboarding-tour-hint` is absent.
- **Fallback.** Hide `workspaces-link` (`style.display = "none"`) on stop two: within 400 ms the ring is gone and `data-guide-placement` is `center`; restore it and the ring returns. On Settings, stop three has no composer and is centred.
- **Widths and themes.** 1280, 683 and 375 wide, light and dark, English and Indonesian (`GET /api/v1/settings` fake `locale: "id"`): every card inside the window, no horizontal scroll, and at 375 the rail stays visible above a bottom sheet. Screenshots of the offer and each stop under `evidence/guide/<run-id>/`.
- **Motion.** While the tour is open `document.getAnimations()` has no animation with `iterations === Infinity`.

## Gotchas

- **It never opens on `:3000`.** No onboarding, no offer. Replay is the way in, and it proves everything except the offer.
- **Focus falls to `app-main-panel`** after the offer, because the onboarding button that held focus is gone by then. After a Replay it goes back to `settings-guide-replay`.
- **The rail's first frames are Chat and a skeleton (`rail-modes-skeleton-row` x4), or the remembered desk, never every mode** (2026-09-29; it used to flash all fourteen tabs). `guide-card` waits for the workspaces answer, so a screenshot taken after it appears shows the real desk. See [rail.md](./rail.md), `rail-first-paint`.
- **Do not match the copy by string on an `id` desk.** Match the testids and `data-guide-*` attributes.
- **A first desk cannot be seen on `:3000`.** Its desk was written before the rule and keeps every mode; that is the rule working. Use the test, or the fake.
