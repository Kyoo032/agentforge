# Map — Shell, rail and workspaces

Last verified: 2026-09-29 at aaf249d + working tree, for the rail's first frames (§ 1's boot paragraph, § 2's redirect paragraph, the JOB MODES row in § 3, the workspaces-read failure row and the first-frame Gotcha: the rail no longer starts from every mode, see [`first-run-desk-and-guide.md`](first-run-desk-and-guide.md) § 6). Before that, at the same tree, for the first desk and the guide (Overview, the boot paragraph in § 1, Where things live; the rest of the page is as verified below): the first desk of a fresh Personal install stores Chat, Research, Images, Videos and Presentation only, and `Shell` mounts the first-run tour — both in [`first-run-desk-and-guide.md`](first-run-desk-and-guide.md), which is the page to read before touching either. Before that, for § 8 (ambient motion: one pause switch for every loop, stepped busy indicators, capped entrance stagger; the dot grid no longer drifts; then, the same day, a second pass that deletes every decorative loop, so the only `infinite` animations left are the working dots and a mascot at a job, and a test holds that line). Before that: 2026-09-27 at c48cff7 (Education tasks chevron). Before that: 2026-09-26 on the pane-scroll pass (one scrollport per desk page; the document does not scroll; reading columns cap near 768px and the stage lane grows to 1984px; the rail still collapses at 480px). Before that: 2026-09-26 on the #104 cold-desk pass (submenu chevrons show a short word and start closed). Earlier: 2026-09-23 at 775d16f + working tree (finding 1 of the 0.15.0 verify pass: a new desk inherits the gateway key, and the key screen lists the other desks — §6 Create, Gotchas). The #104 chrome still holds: the rail header is `pt-3` (no fixed `h-12`), the rail's `--rail-*` tokens are per-theme instead of dark in both, the footer is one aligned row of 32px icon buttons whose colour is forced from `globals.css` because unlayered `.btn` beats `@layer utilities`, and `.desk-canvas` is a raised panel (8px margin, 4px radius, blue `--shadow-float`) rather than a flat fill. Later on 2026-09-29, on the same working tree: § 8's `data-busy` paragraph and its busy-indicator bullet were re-read after `PlaceholderMascot` was replaced by `NultronMascot` ([`mascot-and-brand.md`](mascot-and-brand.md)).

This supersedes every rail-chrome detail recorded on 2026-09-22, and the 2026-09-20 structure below still holds (`productModes` is the rail, React Router owns the URL, collapse and theme stay in `localStorage`). What this pass changed of that 09-22 list: the 4px accent edge on an active row is **gone**; the Finance, Market, and Education toggles show a short visible word (`tasks` / `specialists` / `tasks`, full phrase still in `aria-label`) and the sub-list stays closed until that chevron is pressed; the teal "New" label and its whole mechanism are **deleted**, not merely re-dated; the desk switcher and the theme/collapse buttons are icon-only, their words moved to `aria-label` / `title`; the rail collapses at 480px (a 700px window keeps the labels); and light, not dark, is now the default theme (`:root`).

## Overview

The shell is everything around a mode page: the left rail, the desk switcher, the `/workspaces` page that creates and deletes desks, and the `/usage` page that prices what a desk spent. One fact drives all of it — **the current workspace's `productModes` is the rail**. There is no per-user navigation config, no feature flag, and no entitlement check here; a desk row in SQLite decides which tabs exist, and anything not in that list is redirected away from.

**The first desk is narrow on Personal (2026-09-29).** A fresh Personal install writes its Default desk with Chat plus Research, Images, Videos and Presentation only (`FIRST_RUN_MODES`, `packages/core/src/agents/product-modes.ts:55`, written by `ensureLocalOwner`, `packages/db/src/ensure-local-owner.ts:66`), so the rail of a new install has four tools and the owner adds the rest by editing the desk on `/workspaces` (§ 6, Edit). The hosted app's first desk still stores every mode. A desk row that stores nothing still *reads* as every mode (`resolveWorkspaceModes`), and an existing desk is never rewritten. Details and the tests that hold it: [`first-run-desk-and-guide.md`](first-run-desk-and-guide.md).

It is not a router. React Router owns the URL (`apps/web/src/App.tsx:150-175`); the shell only decides which links to draw and which paths to bounce. It is also not session state: collapse, width and theme are per-browser `localStorage`, never persisted server-side.

## How it works

### 1. Boot — one GET decides the rail

`App` renders a gate (`apps/web/src/App.tsx:76-142`): `loading` while `GET /api/v1/settings` is in flight (since 2026-09-29 through `readSettings({ fresh: true })`, `apps/web/src/App.tsx:224`, whose answer Chat's key pill, usage chip and composer then share instead of each asking again: [`chat-send.md`](chat-send.md) § 2), `onboarding` when the host reports a closed gateway gate, otherwise `<Shell>`. `Shell.reload()` (`apps/web/src/App.tsx:40-58`) does the only call the shell needs:

```
GET /api/v1/workspaces
→ { workspaces: [{ id, name, slug, templatePack, productModes, protected }], currentWorkspaceId }
```

It finds the row whose `id === currentWorkspaceId` (falling back to `rows[0]`), and sets the desk (`workspaceId`, `workspaceName`) and its modes, `shellModesFromHost(desk.productModes)` (`apps/web/src/App.tsx:106`: `resolveWorkspaceModes` tagged with the source `host`), then remembers them (`:110`). A rejected fetch is swallowed on purpose — first boot can race SQLite (`:112-114`) — and the state stays where it was. **Where it starts** is the job of `apps/web/lib/shell-modes.ts` (2026-09-29): the desk this browser last drew (`agentforge-shell-modes`, rewritten on every answer, per tenant on the hosted app) or, with nothing remembered, Chat plus a skeleton of four rows, and never every mode; only the host's answer may redirect away from a hidden mode. It used to start from `WORK_PRODUCT_MODES`, so a fresh install drew fourteen tabs and narrowed to five, and a desk that could not be read showed every tab. The source, the frames driven and the tests: [`first-run-desk-and-guide.md`](first-run-desk-and-guide.md) § 6. `Shell` also mounts `<GuideTour visibleModes ready>` after `AppShell` (`apps/web/src/App.tsx:115`), which draws only once the answer has named a desk (`ready`).

`resolveWorkspaceModes` (`packages/core/src/agents/product-modes.ts:156-165`) is the normalizer: `null` / `undefined` / `[]` / all-unknown → **all work modes** (`FALLBACK_PRODUCT_MODES`, `:34`); otherwise the sanitized list, forced to contain `chat`, in catalog order. The host applies the same function on the way out (`packages/host/src/handlers/workspaces.ts:34`), so renderer and API agree by construction.

`reload` re-runs on two triggers (`apps/web/src/App.tsx:60-65`): the `agentforge-shell-refresh` window event, and any change of `location.pathname`. The event is what `useRouter().refresh()` dispatches (`apps/web/lib/nav.tsx:43-45`) — this repo's Next-shaped `refresh()` is a custom event, not a server round trip.

### 2. `AppShell` — three children, one of which draws nothing

`AppShell` (`apps/web/components/app-shell.tsx:24-36`) is a flex row of `ModeRedirect` (renders `null`), `AppRail`, and `#app-main-panel`. The shell and the desk slot are both `h-full` / `min-h-0` and `overflow-hidden`. The slot is **not** keyed on the pathname: keying it remounted `WorkModeKeepAlive` and dropped scroll position.

The document is not a scroller. `html`, `body` and `#root` are `height: 100%`, and `body` is `overflow: hidden` (`apps/web/app/globals.css:417-435`). Each desk page has one scrollport:

- Chat and Edit are fill panes (`FILL_DESK_PATHS`, `apps/web/components/desk-pane.tsx:8`). The pane is `overflow-hidden`; the page scrolls an inner region (the message list, the timeline) so the composer and the stage stay put.
- Every other work mode, and Settings, Knowledge, Workspaces, Usage and Channels, scroll the pane (`overflow-y-auto`). Account routes mount `DeskPane` (`apps/web/src/App.tsx:323-361`). Work modes use the same classes on a node that stays mounted (`apps/web/components/work-mode-keep-alive.tsx:67-84`): an inactive pane is `hidden`, not unmounted, so `scrollTop` survives a rail click. A full page load still starts at the top.
- Entrance motion (`.page-enter`, `apps/web/app/globals.css:1147-1149`) sits on the inner wrapper, not the scrollport, and does not use `animation-fill-mode: both`. A leftover transform would be the containing block for `position: fixed` menus and a second scrollport.

Chat follows the end of its message list while the reader is within 64px of the bottom (`apps/web/lib/stick-to-bottom.ts`, applied in `apps/web/components/chat-session.tsx:100-116` and `:432`). Sending a message re-pins (`:463-464`). Scrolling up during a stream leaves the list where the reader put it. The rail's own scroller is the `<nav>` (`apps/web/components/app-rail.tsx:191-194`, `overscroll-y-contain`). The rail still collapses at 480px (`:134`).

Content lanes (`apps/web/app/globals.css:140-150`, steps at `:377-415`): `--content-max` is the reading column (720px, 768px from 2400px) and the composer shares it. `--content-wide` and `--content-stage` centre studios and grow with the viewport (stage 1984px from 3000px) so a side panel uses the extra width and the page stops short of the desk edge. Edit itself stays the full width of the desk; its side panels widen.

`ModeRedirect` (`apps/web/components/mode-redirect.tsx:7-18`) calls the pure `redirectIfHiddenMode(pathname, visibleModes)` (`packages/core/src/agents/product-modes.ts:172-192`) on every render and, in an effect, `router.replace(target)` when it is non-null, but only once `settled`: the modes came from the host's answer, not from the remembered list or from nothing (`components/mode-redirect.tsx:14`; a remembered list narrower than the desk would bounce a deep link). The rule:

1. `/chat*`, `/settings*`, `/workspaces*`, `/usage*`, `/knowledge*` are **always** reachable (`:130-137`) — they are not modes, so no desk can hide them.
2. Parked `/agents*` and `/studio*` go to `firstVisibleHref(visible)` (`:140-142`).
3. Any other path that matches a mode href goes to `firstVisibleHref` **unless** that mode is visible (`:143-147`).
4. A path matching nothing (a 404) is left alone here — `App`'s `<Route path="*">` sends it to `/chat` (`apps/web/src/App.tsx:174`).

`firstVisibleHref` prefers `/chat` and otherwise takes the first catalog id present (`packages/core/src/agents/product-modes.ts:144-150`).

### 3. `AppRail` — four blocks, two chrome states

`AppRail(workspaceName, visibleModes)` (`apps/web/components/app-rail.tsx:144-421`) filters the catalog down to the desk's modes (`:225`) and splits Chat off from the rest (`:227-228`). Both chrome states render from the same JSX with a `collapsed` boolean, so every handle exists in both branches except the three named in Gotchas.

| Block | Group label | Contents |
|---|---|---|
| Header (`:190-215`) | — | `product-logo` (`BrandTile` `:202`, `:107-140`: the bundled Nultron mark, or a flavor's own logo inside an orb) and, expanded only, `product-brand` (`:207`) linking to `firstVisibleHref`, plus `WorkspaceSwitcher` (compact at `:194`, full at `:211`) |
| CONVERSE (`:288-304`) | `rail.groupConverse` | `mode-chat`, then `RailRecentThreads` — **expanded only**, by an explicit comment at `:301` ("collapsed rail stays a pure icon column") |
| JOB MODES (`:306-360`) | `rail.groupJobs` | one `mode-<href.slice(1)>` per non-chat visible mode; the group label is omitted entirely when the desk has none (`:306`); while nothing is known (`modesSource="unknown"`) the label stays and four `rail-modes-skeleton-row` blocks stand in for the rows, still and `aria-hidden`, with `aria-busy` on the nav (`app-rail.tsx:260-263`, `:238`) |
| ACCOUNT (`:362-394`) | `rail.groupAccount` | `mode-knowledge` (`:369`), `workspaces-link` (`:377`), `usage-link` (`:385`), `settings-link` (`:393`) — four fixed links that no desk can hide |
| Footer (`:397-426`) | — | `rail-footer`, `theme-toggle`, `AppUpdatesButton`, and the collapse button whose testid **flips**: `rail-collapse` when expanded, `rail-expand` when collapsed (`:408`) |

Active state is `productModeMatches(id, pathname)` for modes (`packages/core/src/agents/product-modes.ts:99-105`) and a plain `pathname.startsWith` for the four account links.

`RailGroupLabel` (`:209-218`) renders a `<p>` when expanded and a 1px `<div>` rule when collapsed — the group text does not exist in the collapsed DOM.

### 4. Collapse, width, theme — three independent `localStorage` keys

| What | Key | Read | Written |
|---|---|---|---|
| Collapsed | `agentforge-rail-collapsed` (`"1"` / `"0"`) | `getRailCollapsed()` in a mount effect (`apps/web/components/app-rail.tsx:158-166`) | `setRailCollapsed` inside `toggleCollapsed` (`:169-177`) |
| Width | `agentforge-rail-width` (px string) | `usePanelWidth` → `readPanelWidth` in a mount effect (`apps/web/lib/use-panel-width.ts:9-11`) | `writePanelWidth` after clamping (`:13-20`) |
| Theme | `agentforge-theme` (`light` / `dark`) | `getStoredTheme` in `useState` **and** a mount effect (`apps/web/components/theme-toggle.tsx:43-49`) | `setStoredTheme`, which also applies (`apps/web/lib/theme.ts:20-23`) |

Both rail keys are read in an **effect**, not in the initializer, so the first paint is always `collapsed: false` at `RAIL_WIDTH.default` (232) and then snaps. `RAIL_WIDTH = { default: 232, min: 168, max: 360, collapsed: 68 }` (`apps/web/lib/panel-width.ts:3`); the collapsed width is a literal on the `<aside>` style (`apps/web/components/app-rail.tsx:270`) and is never stored. `clampPanelWidth` (`apps/web/lib/panel-width.ts:5-10`) rounds and clamps, and returns `min` for a non-finite value, so a corrupt key degrades to 168 rather than throwing.

`PanelResizeHandle` (`apps/web/components/panel-resize-handle.tsx:36-105`) is a `role="separator"` with pointer capture and a keyboard map: ArrowLeft/Right ±8px, Home → `min`, End → `max` (`:62-82`). It is rendered only when expanded (`apps/web/components/app-rail.tsx:408-416`), so `rail-resize` has count 0 on a collapsed rail.

`applyTheme` toggles the **`dark` class on `<html>`** (`apps/web/lib/theme.ts:16-18`). There is no `data-theme` attribute; a probe that reads one always sees `null`.

### 5. Switching desks — a file, a cookie, and two refreshes

`WorkspaceSwitcher` (`apps/web/components/workspace-switcher.tsx:19-188`) fetches the same `/api/v1/workspaces` for its own list (`:28-35`) and renders the menu through `createPortal(…, document.body)` (`:96-127`) — the rail is `overflow-hidden` (`apps/web/components/app-rail.tsx:157`), so an in-flow menu would be clipped. Placement is recomputed on open, `resize` and capture-phase `scroll` (`:37-79`), and differs by chrome: expanded drops below the trigger, compact flies out to its right (`:47-51`).

`openWorkspace(id)` (`:81-88`) is four steps in order: `POST /api/v1/workspaces/:id/select`, `notifyThreadsChanged()` (so every session list reloads **before** the route settles — sessions are per desk), `router.push("/chat")`, `router.refresh()`.

Host side, `handleSelectWorkspace` (`packages/host/src/handlers/workspaces.ts:86-104`) verifies the id belongs to the org, then does two things: `writeSelectedWorkspaceId(found.id)` — a plain `data/workspace-id.txt` write (`packages/host/src/workspace.ts:35-41`) — and returns a `workspaceCookie` (`:26-28`). The file is **process-global**, not per-browser: switching desks in one tab switches them for every client of that host.

### 6. `/workspaces` — create, edit, delete

`WorkspacesPage` (`apps/web/components/workspaces-page.tsx:44-444`) keeps one list plus three mutually exclusive panels (create / edit / delete); opening any one closes the other two (`:86-124`).

**Create.** `create-new-workspace` (`:294`) reveals `workspace-create-form` (`:213`). A template chip calls `applyPreset` (`:69-77`), which sets `templatePack` and copies that pack's `productModes` into the checkbox row; `workspace-template-blank` resets to `["chat"]`. Chips come from `WORKSPACE_TEMPLATES` (`packages/core/src/templates/library.ts:673-722`) — `general`, `organisation`, `students`, `office`, `legal`, `sales`, `marketing`, `product`. Chat's checkbox is `disabled` and `toggleMode` refuses it anyway (`apps/web/components/workspaces-page.tsx:79-84`). Submit POSTs `{ name, templatePack?, productModes: withChat(selected) }` (`:126-148`) and, on success, `router.push("/chat")` + `router.refresh()`.

Host `handlePostWorkspaces` (`packages/host/src/handlers/workspaces.ts:52-84`) rejects a blank name (400) and an unknown pack (400 `unknown_template_pack`), then resolves modes: the submitted list through `requireProductModes` (throws 400 on an empty-after-sanitize array, `packages/core/src/agents/product-modes.ts:133-142`), **or**, when the body omits them, `productModesForTemplate(pack)` — which is `["chat"]` for no pack (`packages/core/src/templates/library.ts:734-740`). It inserts the desk and a `workspaceMembers` owner row (`packages/db/src/ensure-local-owner.ts:130-168`, unique-slug retry at `:114-126`), copies the current desk's gateway key into the new desk's settings slice (`inheritGatewayKey`, `packages/host/src/handlers/workspaces.ts:33-39`, called at `:99`), then **selects it** (`:100`) and returns `201` with the cookie. So creating a desk always switches to it, and on an install with a key the switch keeps the gate open: the verdict is the tenant's and keyed by the key's fingerprint, so the copy opens under the verdict the key already has. Only `openaiApiKey` is copied; extras stay empty, the desk can save a different key of its own, and a keyless install creates a keyless desk. Before 2026-09-23 the new desk started empty, the gate derived `needs_key`, and the renderer replaced the whole shell with the key form (finding 1 of the 0.15.0 verify pass).

**Edit.** `edit-workspace-modes` (`:324`) toggles an inline editor; `save-workspace-modes` is disabled until `dirty` (name or mode set changed, `:305`, `:385`) and PATCHes `{ name, productModes }` (`:164-168`). `handlePatchWorkspace` (`packages/host/src/handlers/workspaces.ts:106-136`) applies only the fields present (`packages/db/src/ensure-local-owner.ts:186-189`). The page then `reload()`s and, when the edited desk is the current one, fires `router.refresh()` so the rail redraws (`apps/web/components/workspaces-page.tsx:175-177`).

**Delete.** `delete-workspace` only renders for a row that is neither `protected` nor `slug === "home"` (`:328`). The confirm panel (`:402`) requires the exact name typed into `delete-workspace-confirm-name`; `delete-workspace-confirm-submit` is disabled until it matches (`:419`) and the client re-checks before sending (`:186-189`). The DELETE carries `{ confirmName }` in the body.

`handleDeleteWorkspace` (`packages/host/src/handlers/workspaces.ts:138-181`) re-checks everything the client checked: not found → 404, `HOME_WORKSPACE_SLUG` → **403 `protected`**, wrong or missing `confirmName` → 400 `confirm_required`. Then `deleteLocalWorkspace` wipes the six knowledge tables by hand (`packages/db/src/ensure-local-owner.ts:199-212`) — they key on `workspace_id` as plain text with no foreign key — and deletes the workspace row, which cascades threads, messages and runs (`packages/db/src/schema.ts:392-394`). Finally `dropWorkspaceSettings(workspaceId)` drops the desk's `settings.enc` entry (`packages/host/src/handlers/workspaces.ts:165`), and if the deleted desk was current, the selection falls back to the home desk (`:168-173`).

### 7. `/usage` — one route, one query parameter

`UsagePage` (`apps/web/components/usage-page.tsx:59-237`) holds `range` in state (default `"day"`, `:61`) and refetches on every change (`:94-96`):

```
GET /api/v1/usage?range=day|week|month
```

`parseUsage` (`:32-47`) is a defensive reader: a payload without a `thisKey.status` is treated as incomplete and surfaces `usage.errors.incomplete` rather than rendering zeros as fact.

Host `handleGetUsage` (`packages/host/src/handlers/usage.ts:8-16`) is three lines: tenant, `parseUsageRange(request.query.range)` (anything not `day`/`week`/`month` → `day`, `packages/core/src/gateway/account.ts:498-503`), `loadRangeUsage`.

`loadRangeUsage` (`packages/host/src/account-usage.ts:316-364`) computes **two unrelated numbers**:

- **this-key wallet** — `thisKeyFor(settings)` asks the gateway what this API key has spent, 2-minute cached (`:55-67`). No key → `{ status: "needs_key" }`.
- **desk estimate** — local run rows (`listRunUsage`) plus in-memory desk usage, filtered to the range's bucket keys (`:257-295`), priced against the gateway pricing catalog (10-minute cache, with a separate 2-minute *failure* cache at `:118-139` so an offline desk pays one timeout, not one per request), then `summarizeUsageDesk` + `buildUsageBuckets`.

A pricing failure is **not** fatal: the message is redacted and attached as `desk.error` while buckets still render unpriced (`:322-343`). With no key and no runs in range the whole thing short-circuits to empty frames (`:306-320`).

Bucket frames are fixed calendar windows, oldest → newest: **14 days, 8 weeks, 6 months** (`packages/core/src/gateway/account.ts:568-596`). Empty buckets are kept at `usd: 0` so the axis does not jump; `trimLeadingEmptyBuckets` then drops leading empties down to a floor of 7 (day) or 4 (week/month) (`apps/web/components/usage-range-chart.tsx:18-34`, floor from `apps/web/components/usage-page.tsx:49-57`).

`UsageRangeChart` (`apps/web/components/usage-range-chart.tsx:50-191`) is hand-rolled SVG — no chart library — with three outcomes: `usage-range-empty` "No … runs in this range." when nothing is in the window (`:54-60`), `usage-range-empty` "Runs in this range are not priced yet." when there are runs but no price (`:61-67`), otherwise `usage-range-chart` with stacked `<rect>`s per bucket × model plus a legend (`:86-189`).

### 8. Ambient motion — one switch for every loop

**Why it exists.** The Windows shell runs Chromium without the GPU (`app.disableHardwareAcceleration()`), so every infinite CSS loop costs a full software-composited frame on a screen nobody may be touching. Measured on the harness below, an idle `/chat` cost 10.5% of the machine (about 1.3 cores, 8.2 of it in the GPU process) and `/edit` 18.6 to 21.7%. Any one loop alone saturated the GPU process, so the loops have to stop together.

**The state.** `useAmbientMotion()` is mounted once, in `App` (`apps/web/src/App.tsx:176`), and binds `attachAmbientMotion` (`apps/web/lib/ambient-motion.ts:86`). It models four states of the person, not of the page: `active`; `idle` (visible and focused, no `pointermove`, `pointerdown`, `keydown`, `wheel` or `touchstart` for `AMBIENT_IDLE_MS`, 12 s, `:31`); `blurred` (`document.hasFocus()` is false); `hidden` (`document.hidden`). The order is hidden, then blurred, then idle (`ambientState`, `:42`). Anything but `active` writes `data-ambient="paused"` and `data-ambient-reason="idle|blurred|hidden"` on `<html>`; `active` removes both. CSS reads only those two attributes. The hero's own `data-paused` (off screen, § 9 of [`chat-send.md`](chat-send.md)) is separate and composes with it: either one pauses a loop.

**What it costs.** Passive, capture-phase window listeners and one outstanding timer. An input event stores a timestamp and nothing else, and not even that within 250 ms of the last one (`onInput`, `:136`); the timer re-arms for the remainder of the quiet period when it comes due (`onDue`, `:112`) instead of being reset per event, so a 1000-event storm creates no timer (`lib/ambient-motion.test.ts`). The focus and visibility handlers re-read `document.hasFocus()` rather than trusting the event, because `blur` also fires when focus moves into an iframe of the same page. Coming back to the tab, or focusing the window, counts as activity, so a returning reader is not paused on arrival.

**What it pauses** (`apps/web/app/globals.css:1991-2023`, "Ambient pause", two rules since the second pass below deleted the decoration loops; the first pass listed four, and the table keeps its history where a row says so; the pauses are `animation-play-state: paused !important` so no specificity tie can restart a loop, and the hero pass found one against the mascot's `animation` shorthands):

| Loops | Paused when | Why |
|---|---|---|
| a mascot without `data-busy` (the Nultron mascot has no idle loop; its clips are finite) | any state but active | not at a job. `.icon-float`, `.illustration-float`, `.float-shape` and `.float-shape-spin` were listed here in the first pass and are gone: the second pass deleted their loops |
| `.pulse-dots > span`, a mascot with `data-busy` | `hidden` only, **not** `idle` and not `blurred` | status indicators: someone watching a long run with hands off the mouse is `idle`, and a window beside another is `blurred` yet on screen; a frozen "working" indicator in either would read as a hung app. They are stepped, so they are cheap |

`data-busy` is set only when both hold: the caller says a job is running (`busy` on `NultronMascot`, from `MascotSlot`'s `context.busy`, `ChatTurn`'s `live.running`, the first-run installer panel while it runs and the updates panel while it downloads; `apps/web/components/nultron/nultron-mascot.tsx:84`) and `isMascotBusy` (`apps/web/lib/mascot-states.ts:151`) agrees: `placement="beside"` and a state whose motion is `loop-busy`, that is the twelve work states and `charging`, never idle, sleep, wave, celebrating, error, surprised, love or lets-go. The pose alone is not enough: a job stream that drops leaves the pose behind with nothing running. Entrances (`.enter-*`, `.page-enter`, `.tile-bounce`) are finite and are never listed: pausing one leaves its element at the invisible first keyframe. `lib/motion-tokens.test.ts` ("ambient pause") fails on any infinite loop that no ambient rule lists by its exact selector (a mascot loop by its `.chat-mascot ... *` members), on a bare `.chat-mascot` in the decoration rule, and on an entrance in the list; the reduced-motion test still requires every loop to be named in that block too. `NultronMascot` keeps the root `.chat-mascot` class and puts `data-busy` on that root (`nultron-mascot.tsx:84`), which is how these rules reach it; its own loops live in `apps/web/components/nultron/nultron.css`, every one under `[data-busy]` (`lib/nultron-motion.test.ts`). Map: [`mascot-and-brand.md`](mascot-and-brand.md).

**What it removed or changed outright.**

- **The dot grid stands still.** `.desk-canvas::before` no longer animates (`globals.css:1117`); `nx-dots` and `--motion-drift` are gone. It moved 24px in 16 s, which nobody could see, under a mask on a desk-sized layer. The static dots are unchanged.
- **Busy indicators step.** `--ease-busy: steps(4)` (`globals.css:197`) is the timing of `.pulse-dots > span` (`:1908`) and of the mascot's working-pose loops (now in `components/nultron/nultron.css`, every one under `[data-busy]`): about 8 to 12 frames a second instead of a full 60, on movements of a few pixels. The mascot's other states do not loop at all: idle and sleep are still (idle blinks from a timer), and wave, celebrating, error, surprised, love and lets-go play one clip of 640 to 960 ms when the state is entered ([`mascot-and-brand.md`](mascot-and-brand.md) § 5). `lib/motion-tokens.test.ts` ("busy-state loops step") ties the stepped set to `isMascotBusy`, so a new working pose without a stepped loop fails.
- **Entrances no longer hold a fill.** `.enter-rise`, `.enter-fade`, `.enter-pop` and `.enter-slide` use `animation-fill-mode: backwards` (`globals.css:1589-1601`), not `both`: the first keyframe holds through the delay and afterwards the element returns to its own style, which the last keyframe already equalled (`nx-rise`, `nx-fade`, `nx-pop`, `nx-slide-in` all end on opacity 1, no translate, scale 1; a test pins that). A `forwards` fill kept a finished animation on every element, 835 of them on `/edit`, and pinned `translate: 0 0` on it for good. The stagger is capped: `min(var(--i), 12) * var(--motion-stagger)`, at most 660 ms, where `/edit` used to hold its last row back 44 s. **A latent bug this exposed, kept as it was:** the held `translate` had been masking `.card-live:hover { translate: 0 -4px }` and `:active { translate: 0 2px }` on every `card-live enter-rise` card (the intent cards, Finance guide, Market chips, Knowledge, Music, Data and video cards). Measured with a real hover (`sendInputEvent`): computed `translate` was `0px` while hovered before the change and `0px -4px` with a plain `backwards` fill, so the fill change alone would have switched the lift on. It would also have lifted disabled starter buttons (Data, Market) and made cards around a `<video controls>` jump 6px while the scrubber is held. So `globals.css:1685` keeps `translate: none` on those cards while hovered, focused or pressed (measured `none`, the same picture as before). **Owner decision:** delete that rule to get the lift the CSS describes, after guarding those two cases. After their entrance those cards are no longer a containing block for `position: fixed` descendants (`translate: 0 0` was pinned on them; `none` is not).

**Measured** (a throwaway Electron 35 that mirrors `main.cjs` on Windows: software compositing, 1280x800, `/chat` then `/edit`, 8 s windows, median of 3 runs, % of the whole 12-thread machine so 8.33 is one core; "before" is the tree at `aaf249d` plus its working tree without this change, built the same way; another agent was running a Node benchmark on the machine during some runs):

| | before total (GPU / renderer) | after total (GPU / renderer) | rAF fps before / after |
|---|---|---|---|
| `/chat` active (input within 12 s) | 10.5 (8.3 / 2.1) | 11.2 (6.4 / 4.5), range 10.4 to 13.7 | 43 / 105 |
| `/chat` idle (visible, focused, 14 s without input: paused) | 10.5 (8.2 / 2.1) | **0.10** (0 / 0.09) | 42 / 120 |
| `/chat` blurred | 9.9 (8.2 / 1.7) | **0.01** | 40 / 120 |
| `/edit` active | 21.7 (8.1 / 13.6) | 6.0 (2.0 / 4.0), range 6.0 to 9.8 | 35 / 119 |
| `/edit` idle | 18.6 (6.7 / 11.8) | **0.03** | 66 / 120 |
| busy loops only (3 dots + a thinking mascot), active | 6.7 (3.9 / 2.6) | 1.9 (0.7 / 1.1) | 120 / 120 |
| the same, idle | 5.3 (3.2 / 2.0) | 1.8, still running and stepped | 119 / 120 |
| the same, blurred | 5.5 (3.5 / 2.0) | 1.7, still running and stepped | 120 / 120 |

Reading it honestly: **idle and blurred cost about nothing now, and `/edit` is about 3.6x cheaper while active. `/chat` while active is not cheaper**: the same ten ambient loops run, and without the saturated dot-grid layer they render at 105 to 120 fps instead of 43, so the renderer does more and the total is a little higher. Quantising the ambient loops too (`steps()` on the float shapes, bob and mascot; not shipped) took active `/chat` to 3.4% at 120 fps in three runs. That is a visual change the owner has not been asked about. The rAF column is one 3 s probe after each window and moves with whatever else the machine is doing (another agent's Node benchmark was running during the first series). Boot: `GET`s to the host on a cold `/chat` went from 19 to 13 in three of three runs (`/api/v1/settings` 7 to 4, `knowledge/context` 4 to 2, `workspaces` 2 to 1); the rest are sequential reads that are not in flight together, and sharing them would be a cache. Raw rows: the scratch `cpu-after.csv` of the 2026-09-29 idle-cost pass. **The `/chat` active row is closed by the second pass, next.**

**Second pass, same day: decoration does not loop.** The first pass could not help `/chat` while it is in use: a pause that waits for 12 quiet seconds does nothing for a desk somebody is touching, and the shapes' loops ran at full rate. The fix is elimination. No decorative `infinite` animation is left in the renderer; decoration moves on events only.

| Was | Now | Why |
|---|---|---|
| `.float-shape` bob (`nx-bob`, 4.2 s) and `.float-shape-spin` (`nx-spin`, 18 s): 7 shapes on the Chat hero, 6 in every mode header from `lg`, 7 on onboarding | one finite entrance, `nx-settle` (a 12px drop and a 16 degree tilt) or `nx-settle-spin` (a quarter turn, for the rings and plusses), scale 0.6 to 1, `--motion-5` with `--ease-spring`, staggered by `--i` after `--motion-3`. Fill `backwards`, and the last keyframe is the shape's own style (`globals.css:1337-1365`, `:1506-1515`), so it ends at its designed position with no animation left on it: `getAnimations()` is empty at rest | decoration; 5 to 7 loops on every route |
| `.icon-float` | deleted; nothing used it | dead code |
| `.illustration-float` (`nx-illustration-bob`) on the empty-state scenes (`mode-illustration.tsx`) | class dropped; the scene's own pieces already pop in once (`Pop`, `enter-pop`) | 1 loop on `/edit` |
| `nx-drift`, `--motion-bob`, `--motion-ambient`, `--ease-wave`, `--ease-linear` | deleted | unused after the above |
| `.pulse-dots > span` (`:1908`) | kept: stepped, paused only when hidden | status: work is running |
| a mascot pose under `[data-busy]` (`components/nultron/nultron.css`) | kept, the mascot team's | status |

What still moves, and only on an event: the hero's pointer parallax (`attachHeroMotion` coalesces `pointermove` into one rAF write of `--px` / `--py`; the CSS turns them into a `--motion-4` transition on `transform`, so a still pointer changes nothing), the orb's hover and tap, a tapped shape's one-shot `scale` pop (`pokeShape`), the confetti, the entrances (`.enter-*`, `.page-enter`, `.tile-bounce`) and the card and button hover transitions. Under reduced motion the shapes simply arrive in place (the universal reset makes the entrance instant) and the parallax transform is reset.

**The rule is a test.** `lib/motion-tokens.test.ts`, "decoration does not loop" (`:414`): every stylesheet under `app/`, `components/`, `src/` and `lib/` is scanned for an `animation` or `animation-iteration-count` declaration with `infinite`. The selector must be `.pulse-dots > span` or contain `[data-busy]`, and the declaration must use `var(--ease-busy)`. The mascot's own `components/nultron/nultron.css` is the one file skipped: it answers to `lib/nultron-motion.test.ts` (loops only under `[data-busy]`, stepped). Components are scanned for `infinite`, `animationIterationCount`, Web Animations `iterations: Infinity`, SVG `repeatCount="indefinite"`, and the Tailwind spin, pulse, bounce and ping utilities. "decorative shapes arrive once and rest" (`:474`) pins `nx-settle`, its `backwards` fill and its identity end frame. Proven by dropping a `components/zz-mutation-check.css` with a looping `.icon-float` into the tree: the test failed naming the file and the selector; the file was deleted afterwards. **A trap found on the way:** Tailwind's `content` includes `./lib/**`, so it reads test files. The first draft of the test spelled out the four utility class names, and the production CSS grew an `.animate-ping` rule, an `infinite` animation nobody used, from the test's own title. The test now builds the names by concatenation.

**Measured** (the scratch `perf-electron5.cjs` `routes` scenario: a throwaway Electron 35 with `app.disableHardwareAcceleration()`, the production renderer build served from `perf://`, a 1280x800 window on screen, one `sendInputEvent` mouse move every 3 s so the desk counts as active, 10 s windows, median of 3 runs, % of the whole 12-thread machine so 8.33 is one core; "before" is this tree without the second pass, built the same way and already carrying the Nultron mascot, which is why `/chat` shows 7 loops here and not the first pass's 10):

| | before total (GPU / renderer) | after total (GPU / renderer) | infinite animations running, before / after |
|---|---|---|---|
| `/chat` active | 10.91 (7.08 / 3.68), range 9.32 to 11.92 | **0.67** (0.26 / 0.37), range 0.63 to 0.80 | 7 (5 bob, 2 spin) / 0 |
| `/chat` idle (paused) | 0.09 (0 / 0.08) | 0.04 (0 / 0.03) | 0 / 0 |
| `/documents` active | 4.35 (1.37 / 2.97), 3.08 to 5.17 | **0.23** (0.03 / 0.19), 0.20 to 0.33 | 6 / 0 |
| `/market` active | 4.26 (1.38 / 2.87), 3.13 to 4.76 | **0.15** (0.03 / 0.09), 0.11 to 0.16 | 6 / 0 |
| `/edit` active | 6.48 (2.13 / 4.33), 6.24 to 6.53 | **0.30** (0.05 / 0.24), 0.23 to 0.37 | 7 (4 bob, 2 spin, 1 illustration) / 0 |

Reading it: the active desk now costs what the idle desk cost after the first pass, and idle did not move. `/chat` active still sits above the other routes by about 0.4 points; that is the hero reacting to the moving pointer (the parallax transitions and the spot of light), which is the event-driven motion this pass keeps, and it stops the moment the pointer does. rAF was 120 fps in every window except two runs, `before` run 1 (69 to 106 fps) and `after` run 2 (about 69 fps in all five windows), which coincided with other agents loading the machine; the CPU columns of those runs sit inside the ranges above. The mascot's own loops did not appear in any number: nothing here starts a job, so no `[data-busy]` loop runs; the first pass's busy-only figures (1.7 to 1.9%) stand and were not re-measured. Real-Electron look at the same build (`visual` scenario, PNGs in the scratch dir): at 60 ms every shape is at opacity 0, by 560 to 820 ms they overshoot and settle, at 1.1 s all seven (or six) computed `translate`, `rotate` and `scale` are `none` and opacity is 1; a real mouse move over the hero gave `--px` 0.78 and the shapes' `transform` `translate(px * depth)`, leaving the hero returned both to 0, and a click on a shape started one `scale` animation. `/chat`, `/documents`, `/market` and `/edit` were looked at in that window and nothing is missing or broken. Raw rows: the scratch `cpu-after2.csv` and `cpu-after2-runs.csv`.

**Not driven.** The packaged installer (the harness is the renderer build in a throwaway Electron, not `Nultron.exe`); a Mac; a machine with a working GPU (`app.disableHardwareAcceleration()` is unconditional in `main.cjs` today, and these numbers say nothing about hardware compositing).

### Failure modes

| Failure | Where | What the user gets |
|---|---|---|
| `GET /api/v1/workspaces` rejects at boot | `apps/web/src/App.tsx:83-114` | swallowed; the rail stays on what it drew first (the remembered desk, or Chat and the skeleton when nothing is remembered — never every mode, since 2026-09-29) and `workspaceName` stays `Default`; nothing redirects; the next navigation asks again |
| Desk row has `productModes: null` after migrate | `resolveWorkspaceModes`, `packages/core/src/agents/product-modes.ts:158-160` | all work modes — **never** a Chat-only rail |
| Navigating to a mode the desk hides | `ModeRedirect` → `redirectIfHiddenMode` | `router.replace(firstVisibleHref)`; the studio stays mounted-but-hidden (see Gotchas) |
| Create with a blank name | `packages/host/src/handlers/workspaces.ts:57-59` | 400 `invalid`, rendered inline by `setError` |
| Create with an unknown `templatePack` | `:60-62` | 400 `unknown_template_pack` |
| `productModes: []` submitted | `requireProductModes`, `packages/core/src/agents/product-modes.ts:139` | `ApiError invalid_request` → 400 "Select at least one product surface" |
| Delete the Default desk | `:146-148` (and `packages/db/src/ensure-local-owner.ts:227-229`) | 403 `protected`; the UI never renders the button for it |
| Delete without / with a wrong `confirmName` | `:149-156` | 400 `confirm_required`; the submit button is disabled client-side too |
| Select a workspace id from another org | `handleSelectWorkspace`, `:91-93` | 404 `not_found` |
| `/api/v1/usage` returns 404 | `apps/web/components/usage-page.tsx:73` | `usage.errors.unavailable` |
| `/api/v1/usage` returns any other non-2xx | `:73` | `usage.errors.loadStatus` with the status number |
| Usage payload missing `thisKey.status` | `parseUsage` → `:78-81` | `usage.errors.incomplete`; no zeros are shown as real |
| Gateway pricing fetch fails | `packages/host/src/account-usage.ts:343-347` | `desk.error` (redacted); buckets still render, unpriced |
| No gateway key | `thisKeyFor` → `{ status: "needs_key" }` | `usage.thisKey.needsKey` copy; `usage-key-meter` not rendered |

## Where things live

| File | Role |
|---|---|
| `apps/web/src/App.tsx` | Gate, `Shell`, the single `/api/v1/workspaces` boot fetch, the route table |
| `apps/web/lib/nav.tsx` | `Link` / `usePathname` / `useRouter`; `refresh()` = the `agentforge-shell-refresh` event |
| `apps/web/components/app-shell.tsx` | Flex frame: `ModeRedirect` + `AppRail` + `app-main-panel`; `productMonogram` |
| `apps/web/components/app-rail.tsx` | The rail: groups, icons, collapse toggle, resize handle mounting |
| `apps/web/components/mode-redirect.tsx` | Effect wrapper around `redirectIfHiddenMode`; does nothing until `settled` (the host has answered) |
| `apps/web/lib/shell-modes.ts`, `apps/web/components/rail-modes-skeleton.tsx` | What the rail draws before the workspaces answer: the remembered desk or Chat plus a skeleton, the cache and its rules (`initialShellModes`, `shellModesFromHost`, `parseCachedShellModes`); tests `lib/shell-modes.test.ts`, `lib/shell-first-paint.test.tsx` |
| `apps/web/components/guide-tour.tsx`, `apps/web/components/guide-card.tsx` | The first-run tour, mounted in `Shell`; the rail's nav carries `data-tour="rail-modes"` as its first anchor (`apps/web/components/app-rail.tsx:225`) — see [`first-run-desk-and-guide.md`](first-run-desk-and-guide.md) |
| `apps/web/components/rail-recent-threads.tsx` | `rail-thread-list`, `new-chat-link`, `thread-item`, `threads-see-all` |
| `apps/web/components/panel-resize-handle.tsx` | Pointer + keyboard resize separator |
| `apps/web/lib/panel-width.ts`, `apps/web/lib/use-panel-width.ts` | `RAIL_WIDTH`, clamp/read/write, the hook |
| `apps/web/lib/rail-prefs.ts` | `agentforge-rail-collapsed` |
| `apps/web/lib/ambient-motion.ts`, `apps/web/lib/use-ambient-motion.ts` | The ambient-motion state (active, idle, blurred, hidden) and the `data-ambient` attributes; mounted once in `App` (§ 8) |
| `apps/web/lib/ambient-motion.test.ts`, `apps/web/lib/motion-tokens.test.ts` | The state machine against a fake browser; the CSS contract (every loop listed, entrances not, busy loops stepped, `.enter-*` fill and stagger) |
| `apps/web/lib/theme.ts`, `apps/web/components/theme-toggle.tsx` | `dark` class on `<html>`, `agentforge-theme` |
| `apps/web/components/workspace-switcher.tsx` | Portaled desk menu, `POST /select`, thread-list notify |
| `apps/web/components/workspaces-page.tsx` | Create / edit / delete panels and the desk list |
| `apps/web/components/onboarding-desks.tsx`, `apps/web/lib/onboarding-desks.ts` | The other desks on the key screen; `openDesk` = select + re-read the gate |
| `apps/web/components/work-mode-keep-alive.tsx` | Keeps visited mode pages mounted (hidden) per workspace id |
| `apps/web/components/usage-page.tsx` | Range toggle, this-key card, desk card, by-model list |
| `apps/web/components/usage-panel.tsx` | Shared `thisKeyLine`, `KeyQuotaMeter`, `BAR_COLORS`, Settings strip |
| `apps/web/components/usage-range-chart.tsx` | Hand-rolled stacked bars, `usage-range-empty` copy, `trimLeadingEmptyBuckets` |
| `packages/core/src/agents/product-modes.ts` | Catalog, `resolveWorkspaceModes`, `firstVisibleHref`, `redirectIfHiddenMode` |
| `packages/core/src/templates/library.ts` | `WORKSPACE_TEMPLATES`, `productModesForTemplate` |
| `packages/core/src/gateway/account.ts` | `parseUsageRange`, bucket frames and keys, `buildUsageBuckets`, `summarizeUsageDesk` |
| `packages/host/src/handlers/workspaces.ts` | GET / POST / select / PATCH / DELETE, protection and confirm rules |
| `packages/host/src/workspace.ts` | `data/workspace-id.txt` and the workspace cookie |
| `packages/host/src/handlers/usage.ts`, `packages/host/src/account-usage.ts` | `/api/v1/usage`; this-key wallet, pricing caches, range buckets |
| `packages/db/src/ensure-local-owner.ts` | `list/create/update/deleteLocalWorkspace`, knowledge wipe, home protection |

## Gotchas

- **The Browser pane reads as paused.** It is not focused between tool calls, so `<html>` carries `data-ambient="paused"` with reason `blurred` and `document.getAnimations()` shows 0 running: the switch working, not a stuck desk. A `left_click` on the page focuses it and the loops run (the pane's `hover` sends no `pointermove` at all, but a click's `pointerdown` wakes an idle desk). To count running loops, click first, or remove the attribute from the driver for the read. Entrances still play while paused.
- **A new infinite animation must be listed in the "Ambient pause" block, and in the reduced-motion block.** A status indicator goes in the second rule and steps with `var(--ease-busy)`; decoration has no rule any more, because it does not loop. `lib/motion-tokens.test.ts` fails otherwise. Do not list an entrance.
- **`.enter-*` hold no fill.** A rule that needs an entrance's end state to persist (a different resting opacity, a `translate` the animation should keep) must set it on the element, not lean on `forwards`.
- **`product-brand` does not exist on a collapsed rail.** The expanded branch renders it (`apps/web/components/app-rail.tsx:207`); the collapsed branch renders only `product-logo`, inside the compact switcher (`apps/web/components/workspace-switcher.tsx:166-170`). Driven: count 1 expanded, **0** collapsed. A brand assertion must expand the rail first.
- **A hidden mode's studio can still be in the DOM.** `WorkModeKeepAlive` mounts the pane for the entry path (`apps/web/components/work-mode-keep-alive.tsx:52-58`) before `ModeRedirect`'s effect runs, and keep-alive never unmounts — the pane just goes `hidden` + `class="hidden"` + `aria-hidden` (`:64-73`). Driven on 2026-09-17: on a Legal desk, `/images` redirected to `/chat` yet `images-studio` had count **1**, `isVisible()` false. Assert a hidden mode with the **rail** testid (`mode-images` count 0), never with the studio testid.
- **`rail-collapse` and `rail-expand` are the same button.** One testid, swapped by state (`apps/web/components/app-rail.tsx:389`). Waiting for `rail-expand` is how you know the collapse landed.
- **`rail-resize` and `rail-thread-list` do not exist while collapsed** (`:427`, `:302`). Both are expected count 0, not a regression.
- **Collapsed group labels are a divider, not text** (`:209-218`). Never match a rail group by its string on a collapsed rail — and never by string at all on an `id` desk (`Percakapan` / `Mode kerja` / `Akun`).
- **The rail's first frames are never every mode.** A fresh desk with nothing remembered draws Chat and four `rail-modes-skeleton-row` blocks until the workspaces answer lands (one mode link, `mode-chat`, not five, so wait for the fifth before asserting the desk; `mode-knowledge` is an account link and is always there); a returning browser draws the remembered desk. Do not count the skeleton as modes (no `mode-` testid), and do not read a screenshot from the first 100 to 900 ms as the desk. The rows that replace a skeleton do not slide in (`startedPending`); on a rail that mounted with a list they still do. Driven, with the frame counts, in [`first-run-desk-and-guide.md`](first-run-desk-and-guide.md) § 6.
- **First paint always shows an expanded 232px rail.** Collapse and width are read in mount effects (`:232-234`, `apps/web/lib/use-panel-width.ts:9-11`), not in the state initializer, so a screenshot taken before hydration settles shows the default, not the stored preference.
- **The selected desk is a file, not a session.** `data/workspace-id.txt` (`packages/host/src/workspace.ts:19-41`) is process-global. Switching desks in an automated drive switches them for the owner's open window too — switch back before you finish.
- **Creating a desk selects it.** `handlePostWorkspaces` calls `writeSelectedWorkspaceId` before returning 201 (`packages/host/src/handlers/workspaces.ts:100`), which is why the page can go straight to `/chat`. There is no "create without switching". It inherits the creating desk's gateway key first (`:99`), so the switch does not close the gate.
- **A keyless desk still shows the key form, but not as a dead end.** The gate is per selected desk, and `App` swaps the whole shell for `OnboardingScreen` when it is closed (`apps/web/src/App.tsx:278-283`), so the rail and switcher go with it. A desk made before key inheritance, or one whose own key was cleared, lands there; `OnboardingDesks` (`apps/web/components/onboarding-desks.tsx:11-35`, mounted at `apps/web/components/onboarding-screen.tsx:297`) lists every other desk as `onboarding-open-desk`. Pressing one calls `openDesk` (`apps/web/lib/onboarding-desks.ts:60-68`): the host's `POST /select`, then `GET /api/v1/settings`, and the gate that comes back is applied through the same `resolveGate` as at boot.
- **`productModesForTemplate(null)` is `["chat"]`, not everything** (`packages/core/src/templates/library.ts:734-737`) — but the create form always sends an explicit `productModes`, so that branch only fires for an API caller that omits the field.
- **`resolveWorkspaceModes` treats `[]` as "unset".** An empty stored array yields all work modes (`packages/core/src/agents/product-modes.ts:158-160`), while `requireProductModes` **rejects** an empty submitted array (`:95`). Storing "no modes" is impossible by design.
- **`/usage`, `/knowledge`, `/settings`, `/workspaces` are never redirected** (`:130-137`). A Legal desk still opens `/usage`; do not treat that as a leak.
- **Desk estimate and this-key wallet are different numbers by construction** and the page says so in its footer (`apps/web/components/usage-page.tsx:233-235`). One is local token math against a price catalog, the other is what the gateway says the key spent across every app using it.
- **Equal totals across Day / Week / Month are normal.** The three frames are 14 days / 8 weeks / 6 months (`packages/core/src/gateway/account.ts:568-596`); a desk whose runs are all recent lands every run in the newest bucket of all three. Only the bucket count and labels change. Observed on 2026-09-17: `$0.0018 · 1 model` in all three.
- **`usage-range-empty` carries two different sentences** (`apps/web/components/usage-range-chart.tsx:56`, `:63`) — "No … runs in this range." and "Runs in this range are not priced yet." Matching the first one only will miss the has-runs-no-prices state.
- **The chart's copy is hardcoded English** while `usage.chart.empty` / `unpriced` / `aria` / `barTitle` exist in both catalogs with zero call sites. Locale bug, recorded in `docs/internal/unreleased.md`, not something to work around in a recipe.
- **`usage-key-meter` renders only when `thisKey.status === "ok"`** (`apps/web/components/usage-panel.tsx:86-89`). On a keyless desk it is count 0, which is the correct state, not a missing element.
- **The switcher menu is portaled to `document.body`** (`apps/web/components/workspace-switcher.tsx:96-127`) because the rail is `overflow-hidden`. Scope a menu query to the document, not to the `<aside>`.
- **Deleting a desk needs the name in two places** — the client's disabled-until-match check (`apps/web/components/workspaces-page.tsx:419`) and the host's `confirmName` body field (`packages/host/src/handlers/workspaces.ts:150-157`). An API-only delete without the body is a 400.
- **Knowledge rows are wiped by hand, threads by cascade.** The six `knowledge_*` tables store `workspace_id` as plain text with no FK, so `wipeKnowledgeForWorkspace` deletes them explicitly (`packages/db/src/ensure-local-owner.ts:199-212`); threads and their children cascade from the workspace FK (`packages/db/src/schema.ts:392-394`).

## Verify

- Ambient motion: `.cursor/skills/verify-agentforge/features/chat.md`, "Ambient motion" (attributes, running-loop counts per state, wake on input, entrances still play while paused).
- `.cursor/skills/verify-agentforge/features/workspaces.md` — sub-features `workspaces-open`, `workspaces-switcher`, `workspaces-templates`, `workspaces-modes`, `workspaces-create`, `workspaces-list`, `workspaces-switch`, `workspaces-edit`, `workspaces-delete`.
- `.cursor/skills/verify-agentforge/features/usage.md` — sub-features `usage-open-rail`, `usage-range`, `usage-chart`, `usage-this-key`.
- The rail itself has no feature file yet; a `features/rail.md` is proposed alongside this page.

DOM testids that prove it: rail — `product-brand` / `product-logo` (`apps/web/components/app-rail.tsx:207`, `:123`), `mode-chat` … `mode-presentations` (`:237`, `:257`), `mode-knowledge` (`:328`), `workspaces-link` (`:346`), `usage-link` (`:355`), `settings-link` (`:364`), `rail-footer` (`:380`), `theme-toggle` (`apps/web/components/theme-toggle.tsx:66`), `rail-collapse` / `rail-expand` (`apps/web/components/app-rail.tsx:389`), `rail-resize` (`:415`), `rail-thread-list` / `new-chat-link` / `thread-item` / `threads-see-all` (`apps/web/components/rail-recent-threads.tsx:47`, `:51`, `:70`, `:99`), `app-main-panel` (`apps/web/components/app-shell.tsx:29`). Workspaces — `workspaces-switcher` (`apps/web/components/workspace-switcher.tsx:131`), `open-workspace` (`:111`, and `apps/web/components/workspaces-page.tsx:342`), `workspace-new-link` (`apps/web/components/workspace-switcher.tsx:120`), `create-new-workspace` (`apps/web/components/workspaces-page.tsx:294`), `workspace-create-form` (`:213`), `workspace-template-picker` / `-blank` / `-<pack>` (`:217`, `:222`, `:235`), `workspace-mode-picker` / `workspace-mode-<id>` (`:249`, `:257`), `workspace-name` (`:275`), `create-workspace` (`:277`), `cancel-create-workspace` (`:283`), `workspace-list` (`:301`), `edit-workspace-modes` (`:324`), `workspace-edit-name` (`:356`), `workspace-edit-modes` / `workspace-edit-mode-<id>` (`:361`, `:369`), `save-workspace-modes` (`:384`), `cancel-workspace-modes` (`:393`), `delete-workspace` (`:333`), `delete-workspace-confirm` (`:402`), `delete-workspace-confirm-name` (`:411`), `delete-workspace-confirm-submit` (`:418`), `delete-workspace-cancel` (`:427`). Usage — `usage-page` (`apps/web/components/usage-page.tsx:105`), `usage-range` / `usage-range-day|week|month` (`:112`, `:122`), `usage-this-key` (`:137`), `usage-desk-range` (`:144`), `usage-by-model` (`:173`), `usage-model-row-<model>` (`:184`, `:215`), `usage-range-chart` / `usage-range-empty` (`apps/web/components/usage-range-chart.tsx:87`, `:56`, `:63`), `usage-key-meter` (`apps/web/components/usage-panel.tsx:96`), `usage-panel` / `usage-open` on Settings (`:115`, `:122`).

## Why

**Why the rail is owned by the workspace and not by agents.** `[Direct]` The dead-code comment on `resolveProductModes` says it outright: "Rail no longer uses this — workspaces own visible modes" (`packages/core/src/agents/product-modes.ts:198`). `[Supported]` `.cursor/skills/verify-agentforge/features/README.md` records the product consequence — "Custom agents do not unlock the rail" and "Default already unlocks all of them" — and `features/workspaces.md` adds "Creating no longer seeds a starter agent". **Confidence: high.**

**Why a missing `productModes` means every tab rather than none.** `[Direct]` `features/workspaces.md` Gotchas: "Default with null `productModes` after migrate is all work modes — not Chat-only." `[Direct]` the doc comment at `packages/core/src/agents/product-modes.ts:152-155` states the same rule, and `packages/core/src/agents/product-modes.test.ts:53-55` pins `undefined` / `null` / `[]` to `WORK_PRODUCT_MODES`. The reason is migration safety: rows written before the column existed must not silently lose their rail. **Confidence: high for the rule; the migration-safety reading is `[Inferred]` from the "after migrate" wording in the feature file.**

**Why the switcher menu is a `document.body` portal.** `[Direct]` `features/workspaces.md` Sub-features: "The menu is portaled so the rail `overflow-hidden` does not clip it." `[Direct]` the rail is in fact `overflow-hidden` (`apps/web/components/app-rail.tsx:157`). Same class of fix as the Chat model picker — see [`chat-send.md`](chat-send.md) §7. **Confidence: high.**

**Why deleting a desk needs the name typed twice.** `[Supported]` The client disables the button until the name matches (`apps/web/components/workspaces-page.tsx:419`) *and* re-checks before sending (`:186-189`), while the host independently requires `confirmName` in the body (`packages/host/src/handlers/workspaces.ts:150-157`) — three checks for one action. A desk delete cascades every thread, message and run it owns (`packages/db/src/schema.ts:392-394`) and hand-wipes six knowledge tables (`packages/db/src/ensure-local-owner.ts:199-212`), which is unrecoverable locally. **Confidence: high for the mechanism; "because it is unrecoverable" is `[Inferred]` — no commit or changelog states the intent.**
