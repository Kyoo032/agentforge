# Rail

The rail is the left column every screen shares: the product mark and desk switcher on top, then four groups — CONVERSE (Chat plus the session list), JOB MODES (one tab per `productMode` the current desk owns), ACCOUNT (Knowledge Base, Workspaces, Usage, Settings), and a footer with the theme icon, the updates icon and the collapse toggle. It renders two chrome states from one component: expanded (default 232px, resizable 168–360) and collapsed (a fixed 68px icon column). What it shows is not configuration — it is the current workspace's `productModes` run through `resolveWorkspaceModes`, so a desk that hides a mode also makes its URL unreachable. The bullet names below (`rail-groups`, `rail-modes`, `rail-sessions`, …) are sub-feature names for this file, not testids; the testids are the ones quoted inside each bullet.

## Sub-features

- `rail-groups` is the four-block order: header, CONVERSE (`rail.groupConverse`), JOB MODES (`rail.groupJobs`, omitted entirely when the desk has no non-chat mode), ACCOUNT (`rail.groupAccount`). Group text exists only when expanded — collapsed renders a 1px divider instead.
- `rail-modes` is one `mode-${href.slice(1)}` per visible mode, in catalog order (`mode-chat`, `mode-documents`, `mode-research`, `mode-finance`, `mode-data`, `mode-market`, `mode-legal`, `mode-images`, `mode-videos`, `mode-edit`, `mode-presentations`). Default shows all eleven. `mode-agents` count is always 0.
- `rail-market-specialists` is the Market sub-list's **chrome**: on an expanded rail the Market row is wrapped in `rail-market-mode` and carries `rail-market-specialists-toggle` (the chevron, `aria-expanded`); under it `rail-market-specialists-branch` is the indented wrapper with the hairline guide and `rail-market-specialists` is the `role="group"` scroll container holding one `rail-market-specialist-<id>` row per agent. The block belongs to `/market`: it is open there, the chevron can close it while you stay on the route, and off `/market` the rows are gone and the chevron is `disabled` — nothing about that state is stored, so there is no rail-prefs key to assert. The rows are height-adaptive and carry `data-overflowing` while they are cut off (four at 720 and 768, about seven at 900, all eleven from 1008 up); every rail row is `shrink-0`, so the nav scrolls rather than squashing rows to fit the block in. Which desk a row opens, what it swaps, and every `market-*` testid belong to [market.md](./market.md); this file owns only "the block is there, and it disappears when the rail collapses".
- `rail-sessions` is the CONVERSE session block's **chrome**: expanded, `rail-thread-list` wraps `new-chat-link`, holds up to four `thread-item` rows (`RAIL_RECENT_THREADS = 4`, `apps/web/lib/thread-groups.ts:2`), and shows `threads-see-all` when the host returned more than four and `rail-thread-error` when the list load or a delete failed. Collapsed, the session rows unmount and `new-chat-link` stays as an icon plus `aria-label`. This is the product's only session list. What a row does — open, delete, the confirm copy, the fork race — belongs to [chat.md](./chat.md).
- `rail-account` is the four fixed links no desk can hide: `mode-knowledge` (`/knowledge`), `workspaces-link` (`/workspaces`), `usage-link` (`/usage`), `settings-link` (`/settings`). All four carry the same testid in both chrome states.
- `rail-brand` is `product-logo` (both states) plus `product-brand` (**expanded only**), which links to the desk's first visible mode. Packaged flavors must not read DPSBuddy — see [desktop-brands.md](./desktop-brands.md).
- `rail-collapse` / `rail-expand` is one button with a flipping testid: `rail-collapse` while expanded, `rail-expand` while collapsed (`apps/web/components/app-rail.tsx:439`). It writes `agentforge-rail-collapsed` (`"1"` / `"0"`) and sets `data-rail="min"` / `"full"` on the `<aside>`.
- `rail-resize` is the `role="separator"` drag handle on the right edge, expanded only. Pointer drag sets the width; ArrowLeft/ArrowRight move ±8px, Home snaps to 168, End to 360 (`apps/web/lib/panel-width.ts:3`). It writes `agentforge-rail-width` and `aria-valuenow` tracks it.
- `rail-theme` is `theme-toggle` in the footer. Default with nothing stored is dark: `<html>` has class `dark` and `:root` is the dark palette. A stored `light` adds class `light` and removes `dark`. `aria-label` reads the target mode (`common.theme.light` / `common.theme.dark`). Expanded, the same word is visible next to the icon.
- `rail-updates` is the footer updates control: wrapper `app-updates`, button `app-updates-toggle`, then `app-updates-badge` / `app-updates-panel` / `app-updates-status` / `app-updates-check` / `app-updates-install` / `app-updates-close`. On webdev the button renders with no badge (`app-updates-badge` count 0); the real behaviour is packaged-only — see [desktop.md](./desktop.md).
- `rail-redirect` is the other half of `productModes`: entering a hidden mode's URL lands on the desk's first visible mode, and `/agents` / `/studio` do the same. `/chat`, `/settings`, `/workspaces`, `/usage` and `/knowledge` are never redirected.

## How to get to it (user POV)

- The rail is on every screen after onboarding. There is no route for it.
- Webdev: `http://127.0.0.1:3000/chat`. Packaged: the Electron window on Chat.
- Collapse or expand it with the footer button; drag its right edge to resize.
- The desk name under the product name opens the switcher; Workspaces / Usage / Settings sit at the bottom of the mode list.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- Read `localStorage["agentforge-rail-width"]` and `["agentforge-rail-collapsed"]` **before** touching either, and restore both at the end — they are the operator's chrome, not test state. A throwaway Playwright profile starts empty and needs no restore.

- **Groups (expanded).** With `rail-collapse` visible, the `mode-*` testids are exactly the desk's modes plus `mode-knowledge`. On Default that is all eleven work modes. Collect them by prefix; do not match group headings by text — they are localized.
- **Sessions.** On a wide window, `rail-thread-list` count 1 and `new-chat-link` count 1. On a desk with history, `thread-item` > 0 and `threads-see-all` count 1; on a fresh desk both are 0 and that is the pass. A viewport at 720px or narrower starts collapsed: `new-chat-link` is still 1 and `thread-item` is 0 until the rail is expanded. Opening, deleting and the send-too-early race are driven in [chat.md](./chat.md), not here.
- **Collapse.** Click `rail-collapse`. Wait on `rail-expand`. Assert `[data-rail="min"]`, `<aside>` width 68, `localStorage["agentforge-rail-collapsed"] === "1"`, and count 0 for `rail-thread-list`, `rail-resize` and `product-brand`. `workspaces-link`, `workspaces-switcher`, `usage-link`, `settings-link` and `product-logo` stay count 1.
- **Expand.** Click `rail-expand`. Wait on `rail-collapse`. `data-rail` is `full`, width is the stored value, the key reads `"0"`.
- **Resize.** Focus `rail-resize`. `End` → width 360, `Home` → 168, three ArrowRights from 232 → 256. Drag it with the pointer and assert `localStorage["agentforge-rail-width"]` matches the new width. Reload and assert the width survives.
- **Theme.** Read `document.documentElement.className` first and `localStorage["agentforge-theme"]`. With nothing stored, class includes `dark` and not `light`. Click `theme-toggle`: class gains `light`, loses `dark`, key reads `light`. Click again: class gains `dark`, loses `light`, key reads `dark`. There is no `data-theme` attribute. Leave the operator's theme as you found it.
- **Hidden modes.** On a Legal desk, `mode-images` count 0; navigating to `/images` lands on `/chat`. Assert the **rail** testid, never `images-studio` — the keep-alive leaves a hidden studio pane mounted (see Gotchas).
- **Account links.** Each of `mode-knowledge`, `workspaces-link`, `usage-link`, `settings-link` navigates to its path from both chrome states.
- **Locale (id).** The groups read `Percakapan` / `Mode kerja` / `Akun`, the `<aside>` `aria-label` is `Mode produk`, `rail-resize` is `Ubah ukuran navigasi`, `rail-collapse` is `Ciutkan navigasi`. Testids are locale-invariant.
- **IDE proof.** Screenshots of both chrome states under `evidence/rail/<run-id>/`, with the desk name visible.

## Gotchas

- `rail-collapse` and `rail-expand` are the same button with a state-swapped testid. Waiting for the other one is how you know the click landed.
- `product-brand` does **not** exist on a collapsed rail; only `product-logo` does, and it lives inside the compact switcher.
- `rail-resize` and `rail-thread-list` do not exist on a collapsed rail. Count 0 is the expected state.
- Collapsed group labels are a 1px divider, not text. Never identify a group by its string — and never by string at all on an `id` desk.
- First paint is always an expanded 232px rail: collapse and width are read in mount effects, not in the state initializer. Wait for a named testid, not a fixed sleep, before screenshotting chrome.
- A hidden mode's studio is still in the DOM — SKILL.md **Harness-wide gotchas** G3. Driven on 2026-09-17: on a Legal desk `/images` redirected to `/chat` and `images-studio` still had count 1 with `isVisible()` false, so the rail testid is the only honest assertion for "this desk cannot reach that mode".
- Rail tabs come from the workspace, not from agents. A custom agent never adds a tab.
- The rail is `overflow-hidden`, so the switcher menu is portaled to `document.body`. Scope menu queries to the document.
- `mode-usage` and `mode-workspaces` do not exist. Usage and Workspaces are ACCOUNT links, not product modes.

Subsystem map: [`docs/internal/maps/shell-rail-and-workspaces.md`](../../../../docs/internal/maps/shell-rail-and-workspaces.md).
