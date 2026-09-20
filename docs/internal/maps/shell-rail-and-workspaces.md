# Map — Shell, rail and workspaces

Last verified: 2026-09-20 at ac2d182 (Phase 5 lane A: citations re-anchored by content)

## Overview

The shell is everything around a mode page: the left rail, the desk switcher, the `/workspaces` page that creates and deletes desks, and the `/usage` page that prices what a desk spent. One fact drives all of it — **the current workspace's `productModes` is the rail**. There is no per-user navigation config, no feature flag, and no entitlement check here; a desk row in SQLite decides which tabs exist, and anything not in that list is redirected away from.

It is not a router. React Router owns the URL (`apps/web/src/App.tsx:146-168`); the shell only decides which links to draw and which paths to bounce. It is also not session state: collapse, width and theme are per-browser `localStorage`, never persisted server-side.

## How it works

### 1. Boot — one GET decides the rail

`App` renders a gate (`apps/web/src/App.tsx:74-140`): `loading` while `GET /api/v1/settings` is in flight, `onboarding` when the host reports a closed gateway gate, otherwise `<Shell>`. `Shell.reload()` (`apps/web/src/App.tsx:38-56`) does the only call the shell needs:

```
GET /api/v1/workspaces
→ { workspaces: [{ id, name, slug, templatePack, productModes, protected }], currentWorkspaceId }
```

It finds the row whose `id === currentWorkspaceId` (falling back to `rows[0]`), and sets three pieces of state: `workspaceId`, `workspaceName`, and `visibleModes = resolveWorkspaceModes(current?.productModes)` (`:51`). A rejected fetch is swallowed on purpose — first boot can race SQLite (`:53-55`) — and the state keeps its initial `WORK_PRODUCT_MODES` (`:36`), so a desk that cannot be read shows every tab rather than none.

`resolveWorkspaceModes` (`packages/core/src/agents/product-modes.ts:112-121`) is the normalizer: `null` / `undefined` / `[]` / all-unknown → **all work modes** (`FALLBACK_PRODUCT_MODES`, `:34`); otherwise the sanitized list, forced to contain `chat`, in catalog order. The host applies the same function on the way out (`packages/host/src/handlers/workspaces.ts:33`), so renderer and API agree by construction.

`reload` re-runs on two triggers (`apps/web/src/App.tsx:58-63`): the `agentforge-shell-refresh` window event, and any change of `location.pathname`. The event is what `useRouter().refresh()` dispatches (`apps/web/lib/nav.tsx:43-45`) — this repo's Next-shaped `refresh()` is a custom event, not a server round trip.

### 2. `AppShell` — three children, one of which draws nothing

`AppShell` (`apps/web/components/app-shell.tsx:24-33`) is a flex row of `ModeRedirect` (renders `null`), `AppRail`, and `#app-main-panel` holding the routed children.

`ModeRedirect` (`apps/web/components/mode-redirect.tsx:7-18`) calls the pure `redirectIfHiddenMode(pathname, visibleModes)` (`packages/core/src/agents/product-modes.ts:128-148`) on every render and, in an effect, `router.replace(target)` when it is non-null. The rule:

1. `/chat*`, `/settings*`, `/workspaces*`, `/usage*`, `/knowledge*` are **always** reachable (`:130-137`) — they are not modes, so no desk can hide them.
2. Parked `/agents*` and `/studio*` go to `firstVisibleHref(visible)` (`:140-142`).
3. Any other path that matches a mode href goes to `firstVisibleHref` **unless** that mode is visible (`:143-147`).
4. A path matching nothing (a 404) is left alone here — `App`'s `<Route path="*">` sends it to `/chat` (`apps/web/src/App.tsx:167`).

`firstVisibleHref` prefers `/chat` and otherwise takes the first catalog id present (`packages/core/src/agents/product-modes.ts:100-106`).

### 3. `AppRail` — four blocks, two chrome states

`AppRail(workspaceName, visibleModes)` (`apps/web/components/app-rail.tsx:207-381`) filters the catalog down to the desk's modes (`:217`) and splits Chat off from the rest (`:219-220`). Both chrome states render from the same JSX with a `collapsed` boolean, so every handle exists in both branches except the three named in Gotchas.

| Block | Group label | Contents |
|---|---|---|
| Header (`:241-270`) | — | `product-logo` (`:249` / `:254`) and, expanded only, `product-brand` (`:262`) linking to `firstVisibleHref`, plus `WorkspaceSwitcher` (compact at `:245`, full at `:266`) |
| CONVERSE (`:275-288`) | `rail.groupConverse` | `mode-chat`, then `RailRecentThreads` — **expanded only**, by an explicit comment at `:286` ("collapsed rail stays a pure icon column") |
| JOB MODES (`:291-302`) | `rail.groupJobs` | one `mode-<href.slice(1)>` per non-chat visible mode; the group label is omitted entirely when the desk has none (`:291`) |
| ACCOUNT (`:304-336`) | `rail.groupAccount` | `mode-knowledge` (`:311`), `workspaces-link` (`:319`), `usage-link` (`:327`), `settings-link` (`:335`) — four fixed links that no desk can hide |
| Footer (`:339-368`) | — | `rail-footer`, `theme-toggle`, `AppUpdatesButton`, and the collapse button whose testid **flips**: `rail-collapse` when expanded, `rail-expand` when collapsed (`:350`) |

Active state is `productModeMatches(id, pathname)` for modes (`packages/core/src/agents/product-modes.ts:55-61`) and a plain `pathname.startsWith` for the four account links.

`RailGroupLabel` (`:198-205`) renders a `<p>` when expanded and a 1px `<div>` rule when collapsed — the group text does not exist in the collapsed DOM.

### 4. Collapse, width, theme — three independent `localStorage` keys

| What | Key | Read | Written |
|---|---|---|---|
| Collapsed | `agentforge-rail-collapsed` (`"1"` / `"0"`) | `getRailCollapsed()` in a mount effect (`apps/web/components/app-rail.tsx:222-224`) | `setRailCollapsed` inside `toggleCollapsed` (`:226-232`) |
| Width | `agentforge-rail-width` (px string) | `usePanelWidth` → `readPanelWidth` in a mount effect (`apps/web/lib/use-panel-width.ts:9-11`) | `writePanelWidth` after clamping (`:13-20`) |
| Theme | `agentforge-theme` (`light` / `dark`) | `getStoredTheme` in `useState` **and** a mount effect (`apps/web/components/theme-toggle.tsx:43-49`) | `setStoredTheme`, which also applies (`apps/web/lib/theme.ts:20-23`) |

Both rail keys are read in an **effect**, not in the initializer, so the first paint is always `collapsed: false` at `RAIL_WIDTH.default` (232) and then snaps. `RAIL_WIDTH = { default: 232, min: 168, max: 360, collapsed: 68 }` (`apps/web/lib/panel-width.ts:3`); the collapsed width is a literal on the `<aside>` style (`apps/web/components/app-rail.tsx:237`) and is never stored. `clampPanelWidth` (`apps/web/lib/panel-width.ts:5-10`) rounds and clamps, and returns `min` for a non-finite value, so a corrupt key degrades to 168 rather than throwing.

`PanelResizeHandle` (`apps/web/components/panel-resize-handle.tsx:14-76`) is a `role="separator"` with pointer capture and a keyboard map: ArrowLeft/Right ±8px, Home → `min`, End → `max` (`:37-57`). It is rendered only when expanded (`apps/web/components/app-rail.tsx:369`), so `rail-resize` has count 0 on a collapsed rail.

`applyTheme` toggles the **`dark` class on `<html>`** (`apps/web/lib/theme.ts:16-18`). There is no `data-theme` attribute; a probe that reads one always sees `null`.

### 5. Switching desks — a file, a cookie, and two refreshes

`WorkspaceSwitcher` (`apps/web/components/workspace-switcher.tsx:19-187`) fetches the same `/api/v1/workspaces` for its own list (`:28-35`) and renders the menu through `createPortal(…, document.body)` (`:96-127`) — the rail is `overflow-hidden` (`apps/web/components/app-rail.tsx:236`), so an in-flow menu would be clipped. Placement is recomputed on open, `resize` and capture-phase `scroll` (`:37-79`), and differs by chrome: expanded drops below the trigger, compact flies out to its right (`:47-51`).

`openWorkspace(id)` (`:81-88`) is four steps in order: `POST /api/v1/workspaces/:id/select`, `notifyThreadsChanged()` (so every session list reloads **before** the route settles — sessions are per desk), `router.push("/chat")`, `router.refresh()`.

Host side, `handleSelectWorkspace` (`packages/host/src/handlers/workspaces.ts:85-103`) verifies the id belongs to the org, then does two things: `writeSelectedWorkspaceId(found.id)` — a plain `data/workspace-id.txt` write (`packages/host/src/workspace.ts:21-24`) — and returns a `workspaceCookie` (`:26-28`). The file is **process-global**, not per-browser: switching desks in one tab switches them for every client of that host.

### 6. `/workspaces` — create, edit, delete

`WorkspacesPage` (`apps/web/components/workspaces-page.tsx:44-444`) keeps one list plus three mutually exclusive panels (create / edit / delete); opening any one closes the other two (`:86-124`).

**Create.** `create-new-workspace` (`:294`) reveals `workspace-create-form` (`:213`). A template chip calls `applyPreset` (`:69-77`), which sets `templatePack` and copies that pack's `productModes` into the checkbox row; `workspace-template-blank` resets to `["chat"]`. Chips come from `WORKSPACE_TEMPLATES` (`packages/core/src/templates/library.ts:673-722`) — `general`, `organisation`, `students`, `office`, `legal`, `sales`, `marketing`, `product`. Chat's checkbox is `disabled` and `toggleMode` refuses it anyway (`apps/web/components/workspaces-page.tsx:79-84`). Submit POSTs `{ name, templatePack?, productModes: withChat(selected) }` (`:126-148`) and, on success, `router.push("/chat")` + `router.refresh()`.

Host `handlePostWorkspaces` (`packages/host/src/handlers/workspaces.ts:51-83`) rejects a blank name (400) and an unknown pack (400 `unknown_template_pack`), then resolves modes: the submitted list through `requireProductModes` (throws 400 on an empty-after-sanitize array, `packages/core/src/agents/product-modes.ts:89-98`), **or**, when the body omits them, `productModesForTemplate(pack)` — which is `["chat"]` for no pack (`packages/core/src/templates/library.ts:734-740`). It inserts the desk and a `workspaceMembers` owner row (`packages/db/src/ensure-local-owner.ts:107-145`, unique-slug retry at `:114-126`), then **selects it** (`:74`) and returns `201` with the cookie. So creating a desk always switches to it.

**Edit.** `edit-workspace-modes` (`:324`) toggles an inline editor; `save-workspace-modes` is disabled until `dirty` (name or mode set changed, `:305`, `:385`) and PATCHes `{ name, productModes }` (`:164-168`). `handlePatchWorkspace` (`packages/host/src/handlers/workspaces.ts:105-135`) applies only the fields present (`packages/db/src/ensure-local-owner.ts:163-166`). The page then `reload()`s and, when the edited desk is the current one, fires `router.refresh()` so the rail redraws (`apps/web/components/workspaces-page.tsx:175-177`).

**Delete.** `delete-workspace` only renders for a row that is neither `protected` nor `slug === "home"` (`:328`). The confirm panel (`:402`) requires the exact name typed into `delete-workspace-confirm-name`; `delete-workspace-confirm-submit` is disabled until it matches (`:419`) and the client re-checks before sending (`:186-189`). The DELETE carries `{ confirmName }` in the body.

`handleDeleteWorkspace` (`packages/host/src/handlers/workspaces.ts:137-177`) re-checks everything the client checked: not found → 404, `HOME_WORKSPACE_SLUG` → **403 `protected`**, wrong or missing `confirmName` → 400 `confirm_required`. Then `deleteLocalWorkspace` wipes the six knowledge tables by hand (`packages/db/src/ensure-local-owner.ts:176-189`) — they key on `workspace_id` as plain text with no foreign key — and deletes the workspace row, which cascades threads, messages and runs (`packages/db/src/schema.ts:219-221`). Finally `dropWorkspaceSettings(workspaceId)` drops the desk's `settings.enc` entry (`packages/host/src/handlers/workspaces.ts:164`), and if the deleted desk was current, the selection falls back to the home desk (`:168-173`).

### 7. `/usage` — one route, one query parameter

`UsagePage` (`apps/web/components/usage-page.tsx:59-237`) holds `range` in state (default `"day"`, `:61`) and refetches on every change (`:94-96`):

```
GET /api/v1/usage?range=day|week|month
```

`parseUsage` (`:32-47`) is a defensive reader: a payload without a `thisKey.status` is treated as incomplete and surfaces `usage.errors.incomplete` rather than rendering zeros as fact.

Host `handleGetUsage` (`packages/host/src/handlers/usage.ts:8-16`) is three lines: tenant, `parseUsageRange(request.query.range)` (anything not `day`/`week`/`month` → `day`, `packages/core/src/gateway/account.ts:464-469`), `loadRangeUsage`.

`loadRangeUsage` (`packages/host/src/account-usage.ts:316-364`) computes **two unrelated numbers**:

- **this-key wallet** — `thisKeyFor(settings)` asks the gateway what this API key has spent, 2-minute cached (`:55-67`). No key → `{ status: "needs_key" }`.
- **desk estimate** — local run rows (`listRunUsage`) plus in-memory desk usage, filtered to the range's bucket keys (`:257-295`), priced against the gateway pricing catalog (10-minute cache, with a separate 2-minute *failure* cache at `:118-139` so an offline desk pays one timeout, not one per request), then `summarizeUsageDesk` + `buildUsageBuckets`.

A pricing failure is **not** fatal: the message is redacted and attached as `desk.error` while buckets still render unpriced (`:322-343`). With no key and no runs in range the whole thing short-circuits to empty frames (`:306-320`).

Bucket frames are fixed calendar windows, oldest → newest: **14 days, 8 weeks, 6 months** (`packages/core/src/gateway/account.ts:535-559`). Empty buckets are kept at `usd: 0` so the axis does not jump; `trimLeadingEmptyBuckets` then drops leading empties down to a floor of 7 (day) or 4 (week/month) (`apps/web/components/usage-range-chart.tsx:18-34`, floor from `apps/web/components/usage-page.tsx:49-57`).

`UsageRangeChart` (`apps/web/components/usage-range-chart.tsx:50-191`) is hand-rolled SVG — no chart library — with three outcomes: `usage-range-empty` "No … runs in this range." when nothing is in the window (`:54-60`), `usage-range-empty` "Runs in this range are not priced yet." when there are runs but no price (`:61-67`), otherwise `usage-range-chart` with stacked `<rect>`s per bucket × model plus a legend (`:86-189`).

### Failure modes

| Failure | Where | What the user gets |
|---|---|---|
| `GET /api/v1/workspaces` rejects at boot | `apps/web/src/App.tsx:53-55` | swallowed; rail stays on all work modes and `workspaceName` stays `Default` |
| Desk row has `productModes: null` after migrate | `resolveWorkspaceModes`, `packages/core/src/agents/product-modes.ts:113-116` | all work modes — **never** a Chat-only rail |
| Navigating to a mode the desk hides | `ModeRedirect` → `redirectIfHiddenMode` | `router.replace(firstVisibleHref)`; the studio stays mounted-but-hidden (see Gotchas) |
| Create with a blank name | `packages/host/src/handlers/workspaces.ts:56-58` | 400 `invalid`, rendered inline by `setError` |
| Create with an unknown `templatePack` | `:60-62` | 400 `unknown_template_pack` |
| `productModes: []` submitted | `requireProductModes`, `packages/core/src/agents/product-modes.ts:95` | `ApiError invalid_request` → 400 "Select at least one product surface" |
| Delete the Default desk | `:146-148` (and `packages/db/src/ensure-local-owner.ts:204-206`) | 403 `protected`; the UI never renders the button for it |
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
| `apps/web/components/mode-redirect.tsx` | Effect wrapper around `redirectIfHiddenMode` |
| `apps/web/components/rail-recent-threads.tsx` | `rail-thread-list`, `new-chat-link`, `thread-item`, `threads-see-all` |
| `apps/web/components/panel-resize-handle.tsx` | Pointer + keyboard resize separator |
| `apps/web/lib/panel-width.ts`, `apps/web/lib/use-panel-width.ts` | `RAIL_WIDTH`, clamp/read/write, the hook |
| `apps/web/lib/rail-prefs.ts` | `agentforge-rail-collapsed` |
| `apps/web/lib/theme.ts`, `apps/web/components/theme-toggle.tsx` | `dark` class on `<html>`, `agentforge-theme` |
| `apps/web/components/workspace-switcher.tsx` | Portaled desk menu, `POST /select`, thread-list notify |
| `apps/web/components/workspaces-page.tsx` | Create / edit / delete panels and the desk list |
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

- **`product-brand` does not exist on a collapsed rail.** The expanded branch renders it (`apps/web/components/app-rail.tsx:262`); the collapsed branch renders only `product-logo`, inside the compact switcher (`apps/web/components/workspace-switcher.tsx:159`, `:161`). Driven: count 1 expanded, **0** collapsed. A brand assertion must expand the rail first.
- **A hidden mode's studio can still be in the DOM.** `WorkModeKeepAlive` mounts the pane for the entry path (`apps/web/components/work-mode-keep-alive.tsx:48-54`) before `ModeRedirect`'s effect runs, and keep-alive never unmounts — the pane just goes `hidden` + `class="hidden"` + `aria-hidden` (`:64-73`). Driven on 2026-09-17: on a Legal desk, `/images` redirected to `/chat` yet `images-studio` had count **1**, `isVisible()` false. Assert a hidden mode with the **rail** testid (`mode-images` count 0), never with the studio testid.
- **`rail-collapse` and `rail-expand` are the same button.** One testid, swapped by state (`apps/web/components/app-rail.tsx:350`). Waiting for `rail-expand` is how you know the collapse landed.
- **`rail-resize` and `rail-thread-list` do not exist while collapsed** (`:369`, `:287`). Both are expected count 0, not a regression.
- **Collapsed group labels are a divider, not text** (`:198-205`). Never match a rail group by its string on a collapsed rail — and never by string at all on an `id` desk (`Percakapan` / `Mode kerja` / `Akun`).
- **First paint always shows an expanded 232px rail.** Collapse and width are read in mount effects (`:222-224`, `apps/web/lib/use-panel-width.ts:9-11`), not in the state initializer, so a screenshot taken before hydration settles shows the default, not the stored preference.
- **The selected desk is a file, not a session.** `data/workspace-id.txt` (`packages/host/src/workspace.ts:8-24`) is process-global. Switching desks in an automated drive switches them for the owner's open window too — switch back before you finish.
- **Creating a desk selects it.** `handlePostWorkspaces` calls `writeSelectedWorkspaceId` before returning 201 (`packages/host/src/handlers/workspaces.ts:74`), which is why the page can go straight to `/chat`. There is no "create without switching".
- **`productModesForTemplate(null)` is `["chat"]`, not everything** (`packages/core/src/templates/library.ts:734-737`) — but the create form always sends an explicit `productModes`, so that branch only fires for an API caller that omits the field.
- **`resolveWorkspaceModes` treats `[]` as "unset".** An empty stored array yields all work modes (`packages/core/src/agents/product-modes.ts:113-116`), while `requireProductModes` **rejects** an empty submitted array (`:95`). Storing "no modes" is impossible by design.
- **`/usage`, `/knowledge`, `/settings`, `/workspaces` are never redirected** (`:130-137`). A Legal desk still opens `/usage`; do not treat that as a leak.
- **Desk estimate and this-key wallet are different numbers by construction** and the page says so in its footer (`apps/web/components/usage-page.tsx:233-235`). One is local token math against a price catalog, the other is what the gateway says the key spent across every app using it.
- **Equal totals across Day / Week / Month are normal.** The three frames are 14 days / 8 weeks / 6 months (`packages/core/src/gateway/account.ts:535-559`); a desk whose runs are all recent lands every run in the newest bucket of all three. Only the bucket count and labels change. Observed on 2026-09-17: `$0.0018 · 1 model` in all three.
- **`usage-range-empty` carries two different sentences** (`apps/web/components/usage-range-chart.tsx:56`, `:63`) — "No … runs in this range." and "Runs in this range are not priced yet." Matching the first one only will miss the has-runs-no-prices state.
- **The chart's copy is hardcoded English** while `usage.chart.empty` / `unpriced` / `aria` / `barTitle` exist in both catalogs with zero call sites. Locale bug, recorded in `docs/internal/unreleased.md`, not something to work around in a recipe.
- **`usage-key-meter` renders only when `thisKey.status === "ok"`** (`apps/web/components/usage-panel.tsx:86-89`). On a keyless desk it is count 0, which is the correct state, not a missing element.
- **The switcher menu is portaled to `document.body`** (`apps/web/components/workspace-switcher.tsx:96-127`) because the rail is `overflow-hidden`. Scope a menu query to the document, not to the `<aside>`.
- **Deleting a desk needs the name in two places** — the client's disabled-until-match check (`apps/web/components/workspaces-page.tsx:419`) and the host's `confirmName` body field (`packages/host/src/handlers/workspaces.ts:149-156`). An API-only delete without the body is a 400.
- **Knowledge rows are wiped by hand, threads by cascade.** The six `knowledge_*` tables store `workspace_id` as plain text with no FK, so `wipeKnowledgeForWorkspace` deletes them explicitly (`packages/db/src/ensure-local-owner.ts:176-189`); threads and their children cascade from the workspace FK (`packages/db/src/schema.ts:219-221`).

## Verify

- `.cursor/skills/verify-agentforge/features/workspaces.md` — sub-features `workspaces-open`, `workspaces-switcher`, `workspaces-templates`, `workspaces-modes`, `workspaces-create`, `workspaces-list`, `workspaces-switch`, `workspaces-edit`, `workspaces-delete`.
- `.cursor/skills/verify-agentforge/features/usage.md` — sub-features `usage-open-rail`, `usage-range`, `usage-chart`, `usage-this-key`.
- The rail itself has no feature file yet; a `features/rail.md` is proposed alongside this page.

DOM testids that prove it: rail — `product-brand` / `product-logo` (`apps/web/components/app-rail.tsx:262`, `:249`), `mode-chat` … `mode-presentations` (`:284`, `:300`), `mode-knowledge` (`:311`), `workspaces-link` (`:319`), `usage-link` (`:327`), `settings-link` (`:335`), `rail-footer` (`:341`), `theme-toggle` (`apps/web/components/theme-toggle.tsx:66`), `rail-collapse` / `rail-expand` (`apps/web/components/app-rail.tsx:350`), `rail-resize` (`:376`), `rail-thread-list` / `new-chat-link` / `thread-item` / `threads-see-all` (`apps/web/components/rail-recent-threads.tsx:47`, `:51`, `:70`, `:99`), `app-main-panel` (`apps/web/components/app-shell.tsx:29`). Workspaces — `workspaces-switcher` (`apps/web/components/workspace-switcher.tsx:131`), `open-workspace` (`:111`, and `apps/web/components/workspaces-page.tsx:342`), `workspace-new-link` (`apps/web/components/workspace-switcher.tsx:121`), `create-new-workspace` (`apps/web/components/workspaces-page.tsx:294`), `workspace-create-form` (`:213`), `workspace-template-picker` / `-blank` / `-<pack>` (`:217`, `:222`, `:235`), `workspace-mode-picker` / `workspace-mode-<id>` (`:249`, `:257`), `workspace-name` (`:275`), `create-workspace` (`:277`), `cancel-create-workspace` (`:283`), `workspace-list` (`:301`), `edit-workspace-modes` (`:324`), `workspace-edit-name` (`:356`), `workspace-edit-modes` / `workspace-edit-mode-<id>` (`:361`, `:369`), `save-workspace-modes` (`:384`), `cancel-workspace-modes` (`:393`), `delete-workspace` (`:333`), `delete-workspace-confirm` (`:402`), `delete-workspace-confirm-name` (`:411`), `delete-workspace-confirm-submit` (`:418`), `delete-workspace-cancel` (`:427`). Usage — `usage-page` (`apps/web/components/usage-page.tsx:105`), `usage-range` / `usage-range-day|week|month` (`:112`, `:122`), `usage-this-key` (`:137`), `usage-desk-range` (`:144`), `usage-by-model` (`:173`), `usage-model-row-<model>` (`:184`, `:215`), `usage-range-chart` / `usage-range-empty` (`apps/web/components/usage-range-chart.tsx:87`, `:56`, `:63`), `usage-key-meter` (`apps/web/components/usage-panel.tsx:96`), `usage-panel` / `usage-open` on Settings (`:115`, `:122`).

## Why

**Why the rail is owned by the workspace and not by agents.** `[Direct]` The dead-code comment on `resolveProductModes` says it outright: "Rail no longer uses this — workspaces own visible modes" (`packages/core/src/agents/product-modes.ts:155`). `[Supported]` `.cursor/skills/verify-agentforge/features/README.md` records the product consequence — "Custom agents do not unlock the rail" and "Default already unlocks all of them" — and `features/workspaces.md` adds "Creating no longer seeds a starter agent". **Confidence: high.**

**Why a missing `productModes` means every tab rather than none.** `[Direct]` `features/workspaces.md` Gotchas: "Default with null `productModes` after migrate is all work modes — not Chat-only." `[Direct]` the doc comment at `packages/core/src/agents/product-modes.ts:108-111` states the same rule, and `packages/core/src/agents/product-modes.test.ts:53-55` pins `undefined` / `null` / `[]` to `WORK_PRODUCT_MODES`. The reason is migration safety: rows written before the column existed must not silently lose their rail. **Confidence: high for the rule; the migration-safety reading is `[Inferred]` from the "after migrate" wording in the feature file.**

**Why the switcher menu is a `document.body` portal.** `[Direct]` `features/workspaces.md` Sub-features: "The menu is portaled so the rail `overflow-hidden` does not clip it." `[Direct]` the rail is in fact `overflow-hidden` (`apps/web/components/app-rail.tsx:236`). Same class of fix as the Chat model picker — see [`chat-send.md`](chat-send.md) §7. **Confidence: high.**

**Why deleting a desk needs the name typed twice.** `[Supported]` The client disables the button until the name matches (`apps/web/components/workspaces-page.tsx:419`) *and* re-checks before sending (`:186-189`), while the host independently requires `confirmName` in the body (`packages/host/src/handlers/workspaces.ts:149-156`) — three checks for one action. A desk delete cascades every thread, message and run it owns (`packages/db/src/schema.ts:219-221`) and hand-wipes six knowledge tables (`packages/db/src/ensure-local-owner.ts:176-189`), which is unrecoverable locally. **Confidence: high for the mechanism; "because it is unrecoverable" is `[Inferred]` — no commit or changelog states the intent.**
