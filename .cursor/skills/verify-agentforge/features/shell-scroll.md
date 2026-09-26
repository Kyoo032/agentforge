# Shell scroll

The desk is the viewport. The document does not scroll, and each page has one scrollport: Chat and Edit fill the pane and scroll inside it, and every other work mode plus Settings, Knowledge, Workspaces, Usage and Channels scroll the pane. Work modes stay mounted, so a rail click keeps `scrollTop`. Reading columns stay near 768px; studios grow on a wide window and stop short of the desk edge. Map: [`docs/internal/maps/shell-rail-and-workspaces.md`](../../../../docs/internal/maps/shell-rail-and-workspaces.md) §2. The 480px rail collapse is [rail.md](./rail.md), not this file.

## Sub-features

- `shell-one-scroller` — `body` is `overflow: hidden` and `document.scrollingElement` does not move. `#app-main-panel` (`app-main-panel`) is `overflow: hidden`. On a scrolling page the only desk scroller is the pane around the page (the visible `overflow-y: auto` ancestor of `legal-studio`, `finance-studio`, or `settings-form`). The rail `<nav>` is the rail's own scroller and is not a second desk bar.
- `shell-fill-chat` — `message-list` is Chat's scroller (`overflow-y: auto`). `composer` stays at the bottom of `chat-home` while that list moves. `chat-header` and `message-list` are `max-w-[var(--content-max)]`.
- `shell-fill-edit` — `edit-studio` fills `app-main-panel` (`h-full`, `overflow: hidden`). With no project open, `edit-project-list` is the inner scroller. The page does not grow a bar.
- `shell-scroll-keep` — a work mode's pane `scrollTop` is the same after `mode-chat` and back. Account routes unmount, so Settings does not keep its place.
- `shell-stream-follow` — after a send, `message-list` sits within 64px of the end (`apps/web/lib/stick-to-bottom.ts`). Wheeling up more than 64px leaves it there. The next send jumps back to the end. `new-chat-link` resets the list to the top.
- `shell-wide-lanes` — viewport width picks the lane. `--content-max` is 736px at 1920 and 768px at 2560 and 3440. `--content-stage` (`finance-studio`) is 1600px at 1920, 1792px at 2560, and 1984px at 3440. Both are centred in `app-main-panel` and narrower than it.

## How to get to it (user POV)

- Open Chat. A long thread scrolls in the message column. The composer stays on screen. A reply follows the bottom until you scroll up to read.
- Open Legal or Finance, scroll down, open Chat, then come back. The page is where you left it.
- On a wide monitor the Chat column stays a reading width in the middle. Finance uses more of the desk and still has space on both sides. Edit uses the whole desk.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0 on stub webdev. Do not start a second server while `:3000` answers.
- Drive with client rail clicks. `page.goto` reloads and starts every pane at the top; that is not a fail.
- Wait until `.page-enter` has finished (about 700ms) before measuring widths. Mid-animation the column is scaled down.
- Leave Finance and Market chevrons closed. An open submenu is its own list scroller.

- **One scroller.** On `/legal`, `body` computed `overflow` is `hidden` and `document.scrollingElement.scrollTop` is 0. Exactly one visible desk element has `overflow-y` of `auto` or `scroll` and `scrollHeight > clientHeight`: the pane that contains `legal-studio`. Repeat on `/settings` with `settings-form`. The rail `<nav>` may also overflow on a short window; do not count it as a desk scroller.
- **Chat fills.** On a thread long enough to overflow, wheel `message-list`. Its `scrollTop` changes. `composer`'s bottom stays inside `app-main-panel`. `document.scrollingElement.scrollTop` stays 0.
- **Edit fills.** On `/edit` with no project, `edit-studio`'s width is within 8px of `app-main-panel`'s. `edit-project-list` is the scroller (`overflow-y: auto`). The document does not move.
- **Keep.** On `/legal`, set the pane's `scrollTop` to 300 (skip if `scrollHeight` cannot reach it; lengthen the window narrower instead). Click `mode-chat`, then `mode-legal`. The same pane's `scrollTop` is still 300, and `legal-studio` was never unmounted (`hidden` while you were on Chat). Repeat with `mode-finance` at 180, detour through `settings-link`, and come back.
- **Follow.** On stub Chat, send four short turns (`composer-text`, `composer-send`). When `assistant-live` is gone, `message-list` is within 64px of the end (`scrollHeight - scrollTop - clientHeight <= 64`). Wheel up so that distance is greater than 64 and wait; it must not jump. Send once more: it returns to the end. Click `new-chat-link`: `scrollTop` is 0. On an empty Chat at 1280×800, `message-list` does not overflow.
- **Wide.** Set the viewport to 1920×1080, 2560×1440, and 3440×1440. At each, read `--content-max` and `--content-stage` on `documentElement` and assert the table in `shell-wide-lanes`. `message-list` width equals `--content-max` (±2px) and is centred in `app-main-panel` (equal gaps, each greater than 24px). `finance-studio` width equals `--content-stage` (±2px) and is less than the panel. `edit-studio` still fills the panel. The rail is expanded (labels visible); collapsing it is [rail.md](./rail.md).
- **Evidence.** Screenshots of Chat, Finance, and Edit at the three widths, plus the Legal scrollTop before and after the Chat detour, under `evidence/shell-scroll/<run-id>/`.

## Gotchas

- A full load resets scroll. Only a rail click (or another in-app navigation) is the keep check.
- Settings, Knowledge, Workspaces, Usage, and Channels mount with the route. Leaving them drops `scrollTop`. The keep check is a work mode.
- Sending re-pins. Scrolling up and then pressing `composer-send` jumping to the end is the pass, not a yank bug. A yank is the list moving while you did not send.
- Hidden work modes stay in the DOM. Assert the visible pane, not "count of `legal-studio` is 0" after you have visited Legal.
- The rail `<nav>` scrolls when the window is shorter than the mode list. That bar is the rail. An open Finance or Market submenu adds another list scroller; close it before counting desk scrollers.
- At 1280 the stage token is wider than the desk, so `finance-studio` shrinks to the panel. The "narrower than the panel" check is for 1920, 2560, and 3440.
- Edit is supposed to be edge to edge inside the desk. Failing it for not using `--content-max` is the wrong assertion.
