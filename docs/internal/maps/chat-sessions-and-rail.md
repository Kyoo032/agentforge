# Map — Chat sessions and the rail

Last verified: 2026-09-26 (rail collapse is 480px; context and usage chips wait for an assistant reply). Before that: 2026-09-23 at d4561b8 + uncommitted tree for every `chat-session.tsx` and `chat-composer.tsx`
citation and the new § 11 (a run belongs to the session it started in; `onComplete` now receives
`{ threadId, showing }`). Not walked in a browser.

Before that: 2026-09-23 at 0774681 + working tree (the 0.15.0 design pass). Changed there: the rail row reads from `--rail-*` tokens and follows the theme instead of being dark in both; the `New` badge mechanism (`NEW_BADGE_UNTIL`, `newBadgeOn`, the `badge` prop, `rail.badgeNew`) is deleted; `RailSubmenuToggle` shows a short word beside the chevron (the full phrase stays in `aria-label`) and the selected row's left accent stripe is gone. The session list, its store and the events are untouched. Supersedes the 2026-09-22 "dark desk overhaul" note, whose dark default this pass reversed.

The sibling page [`chat-send.md`](chat-send.md) owns one turn inside a session. This page owns the sessions themselves: where the list comes from, how a row opens a thread, and how the pane, the list and the desk stay in step. The rail block (`rail-recent-threads.tsx`, `use-chat-threads.ts`, `thread-groups.ts`, `threads-events.ts`) landed in 0.14.27 ([`../0.14.27-changelog.md`](../0.14.27-changelog.md), PR #52); every citation below is re-anchored to the committed tree at `b482611`.

## Overview

Since 2026-09-17 every Chat session lives in the **left rail**, directly under the Chat entry: a `New chat` row (`new-chat-link`), the four newest threads, and an `All sessions` toggle that expands the list in place. The second column (`chat-thread-list.tsx`) is deleted, so `/chat` is the chat pane and nothing else. As of 2026-09-22 the header `new-chat` button is gone. Collapsing the rail hides the session rows and keeps `new-chat-link` as an icon with `aria-label`. A viewport at 480px or narrower starts collapsed and does not write that into `rail-prefs`. A 700px window keeps the labels.

The list is not a route and it is not owned by the Chat page. It is a rail component with its own hook, its own `GET /api/v1/threads` call and its own cache, refreshed by a window event. That is what lets a thread created inside the composer, a delete pressed in the rail, and a desk switch in the workspace menu all land in the same list without any of them knowing about the others.

It is **not** a global thread rail: only the `quick-chat` agent's threads, only this desk, only 40 rows, and no job-mode artifacts ever.

## How it works

### 1. The rail renders the block, unless it is collapsed

`AppRail` (`apps/web/components/app-rail.tsx`) draws the Converse group, the `mode-chat` item, and then the sessions:

```tsx
{/* Collapsed rail keeps New chat (icon + label) and hides session rows. */}
<RailRecentThreads collapsed={collapsed} />
```

The JOB MODES label follows the sessions, so they sit between Chat and the job modes by ordering alone. Collapse is the `rail-collapse` / `rail-expand` button. Its wide-window state comes from `apps/web/lib/rail-prefs.ts`. Collapsing hides `rail-thread-list` rows and keeps `new-chat-link`. The 2026-09-17 evidence shot that showed zero `new-chat-link` when collapsed is stale.

### 2. `RailRecentThreads` — one list, one local boolean

`apps/web/components/rail-recent-threads.tsx:26-105`. It holds exactly one piece of state of its own:

```tsx
const { threads, error, deletingId, removeThread } = useChatThreads({ scope: "chat" });
const [expanded, setExpanded] = useState(false);
const shown = expanded ? threads : takeRecentThreads(threads, RAIL_RECENT_THREADS);
```

(`:30`, `:31`, `:36`.) `RAIL_RECENT_THREADS = 4` and `takeRecentThreads` live in `apps/web/lib/thread-groups.ts:2` and `:8-13`; the helper slices the head of an already-sorted array and returns a **new** array, so the rail never reorders or mutates what the host returned.

The three fixed parts of the block:

| Element | testid | Source |
|---|---|---|
| Group wrapper, `role="group"`, `aria-label` from `rail.recentSessionsAria` | `rail-thread-list` | `:47` |
| `New chat` link to `/chat` | `new-chat-link` | rail-recent-threads, expanded row and collapsed icon |
| Load / delete error line | `rail-thread-error` | `:56-60` |

Then one row per shown thread (`:62-91`): a `Link` to `/chat?thread=<encodeURIComponent(id)>` carrying `data-testid="thread-item"` and `aria-current={active ? "true" : undefined}` (`:68-71`), plus a sibling `<button data-testid="thread-delete">` that is `opacity-0` until the row is hovered or focused (`:76-88`). `active` is `searchParams.get("thread")` matched against the row id, and only while the pathname is `/chat` (`:33-35`) — an open thread does not stay highlighted after you navigate to Documents.

Finally the toggle (`:93-103`), rendered **only** when `threads.length > RAIL_RECENT_THREADS`:

```tsx
onClick={() => setExpanded((open) => !open)}
aria-expanded={expanded}
data-testid="threads-see-all"
```

It flips `Semua sesi` / `All sessions` to `Lebih sedikit` / `Show less` (`:101`). It is a `<button>`, not a link: nothing navigates, no route is added, and because `expanded` is component state a reload starts collapsed again (driven).

### 3. `useChatThreads` — the list, the delete, and the desk

`apps/web/lib/use-chat-threads.ts:103-166`. The effect fetches once and then re-fetches on an event:

```ts
const { id: workspaceId } = useWorkspaceScope();
...
window.addEventListener(THREADS_CHANGED_EVENT, onChange);
...
}, [scope, agentId, workspaceId]);
```

(`:104`, `:131`, `:136`.) Three things about it matter:

1. **The workspace id is a dependency, not decoration.** `WorkspaceScope` (`apps/web/lib/workspace-scope.tsx:9-16`) is filled by the shell from `GET /api/v1/workspaces` (`apps/web/src/App.tsx:41`, provided at `:67`). Switching desks re-renders the shell **without** remounting the rail, so without this dependency the rail would keep showing the previous desk's titles. `WorkspaceSwitcher` also fires the event after `POST /api/v1/workspaces/:id/select` (`apps/web/components/workspace-switcher.tsx:82-84`), so the list is refreshed twice over — by the id change and by the event.
2. **A failed load keeps the last good list.** The catch sets `error` and returns; it never calls `setThreads([])` (`:119-125`). The rail shows stale-but-real rows plus one error line rather than going blank.
3. **The fetch is defensive about rows.** `toThread` (`:45-62`) drops any row missing `id` / `title` / `createdAt` instead of rendering a blank pill.

`removeThread` (`:138-163`) is the delete path: bail if another delete is in flight, `window.confirm(t("chat.deleteConfirm", { title }))`, `DELETE /api/v1/threads/:id`, drop the row from local state, then `notifyThreadsChanged()`. It resolves `true` only when the row is really gone; a failure sets `error`, raises `window.alert`, and returns `false`.

Back in the component, that return value decides the route:

```ts
const removed = await removeThread(thread);
// The pane keeps a deleted thread alive in its own ref, so leave it whatever route we are on.
if (removed && openThread === thread.id) {
  router.push(CHAT_PATH);
}
```

(`rail-recent-threads.tsx:38-44`.) The guard is on `openThread` (the raw `?thread` param), not on `onChat`, so deleting the open session from, say, `/documents` still clears the Chat pane's URL instead of leaving it pointed at a dead id.

### 4. `THREADS_CHANGED_EVENT` — the bus

`apps/web/lib/threads-events.ts`: a two-line module exporting the name `agentforge:threads-changed` (`:1`) and `notifyThreadsChanged()`, which dispatches a plain `Event` on `window` and no-ops when there is no `window` (`:3-8`). Every list subscribed through `useChatThreads` reloads.

Publishers, all of them:

| Publisher | When | Source |
|---|---|---|
| `ChatSession.ensureThread` | a composer send created the thread | `apps/web/components/chat-session.tsx:181` |
| `ChatComposer` `onComplete` | a run finished, so the title may have changed — whether or not the pane is still showing it | `apps/web/components/chat-session.tsx:454` |
| `useChatThreads.removeThread` | a delete succeeded | `apps/web/lib/use-chat-threads.ts:151` |
| `WorkspaceSwitcher` | after `POST /api/v1/workspaces/:id/select` | `apps/web/components/workspace-switcher.tsx:84` |

There is no polling and no push from the host. A thread created by anything other than this renderer is invisible until one of the four fires or the page reloads.

### 5. `GET /api/v1/threads` — 40 rows, minus the unnamed ones

`threadsPath` builds `?scope=chat` and only rides `agentId` along on the agent scope (`apps/web/lib/use-chat-threads.ts:25-31`) — the host ignores it on `chat` and sending it would widen the list.

Route → `handleGetThreads` (`packages/host/src/router.ts:251`, `packages/host/src/handlers/threads.ts:15-42`). `parseScope` accepts only `chat` and `agent`; anything else, including a missing value, becomes `all` (`:8-13`). Then `listWorkspaceThreads` (`packages/host/src/threads.ts:82-122`):

- tenancy is three equalities — organization, workspace, user (`:93-95`);
- `scope: "chat"` adds `eq(agents.slug, DEFAULT_CHAT_SLUG)`, which is how the rail gets Chat sessions and not job or agent threads (`:99-101`);
- `orderBy(desc(threads.createdAt))` and `.limit(limit)` with `limit = options.limit ?? 40` (`:90`, `:115-116`). The handler never passes a limit, so **40 is the hard ceiling for the expanded rail**; there is no paging and no "older" affordance.

The handler then filters:

```ts
threads: rows
  .filter((row) => !isDefaultThreadTitle(row.title))
```

(`packages/host/src/handlers/threads.ts:28-29`.) `isDefaultThreadTitle` matches the untouched title in **any** locale — `New thread` and `Percakapan baru` (`packages/host/src/thread-title.ts:3-6`, `:20-22`). A thread that exists but has never carried a user message is therefore not in the list at all. That is deliberate: `ensureThread` creates the row before the first token is sent, and without the filter every abandoned composer would leave a `New thread` in the rail.

The rows are shaped down to `{ id, title, agentId, agentName, createdAt, isDefaultChat }` (`:30-37`). Note `preview` is typed as optional on the client (`use-chat-threads.ts:18`) but this route never sends it.

### 6. Opening a row — `?thread` into the pane

The row is a `Link` (`apps/web/lib/nav.tsx:23`, a thin wrapper over react-router), so the click is a client-side navigation with no reload. `ChatPage` reads the param and hands it down (`apps/web/src/pages/chat-page.tsx:5-11`):

```tsx
const thread = params.get("thread") ?? undefined;
// Every Chat session lives in the left rail since 2026-09-17, so the pane owns the whole width.
<ChatSession initialThreadId={thread} />
```

`ChatSession`'s load effect (`apps/web/components/chat-session.tsx:196-289`, deps `[agentId, initialThreadId, router]`) resolves the agent, then:

- **with `initialThreadId`** — early-return if it already equals `threadIdRef.current`, else `GET /api/v1/threads/:id`, adopt the id into both the ref and the state, `setMessages(payload.messages ?? [])`, `resetLive()` (`:245-267`). If the thread belongs to a non-default agent it redirects to `/agents/<id>?thread=<id>` instead (`:257-260`).
- **without it** — blank the pane, but only if this is a real departure.

### 7. `+ New chat` with a thread open — the `leftThread` latch

The subtle case. Pressing the rail's `new-chat-link` while `?thread=x` is open is a same-component prop change from `"x"` to `undefined`; the effect re-runs, but `threadIdRef.current` is still `"x"`, and a naive `if (threadIdRef.current) return` would leave the old transcript on screen. Hence a one-line latch:

```ts
/** Last `initialThreadId` this pane saw, so leaving a thread (rail "+ New chat") empties it. */
const lastInitialThreadRef = useRef(initialThreadId);
...
const leftThread = lastInitialThreadRef.current !== undefined && initialThreadId === undefined;
lastInitialThreadRef.current = initialThreadId;
...
if (threadIdRef.current && !leftThread) {
  return;
}
threadIdRef.current = null;
setThreadId(null);
setMessages([]);
resetLive();
```

(`apps/web/components/chat-session.tsx:71`, `:198-199`, `:269-277`.) Driven: with one stub turn on screen, `new-chat-link` took the URL back to `/chat`, `message-output` to 0, and `aria-current` rows to 0, while the thread itself kept its turn when reopened (`11-new-chat-link-pane-reset.png`, `13-rail-click-reopen.png`).

There is one New chat control, `new-chat-link`. The header button `data-testid="new-chat"` was removed on 2026-09-22. The pane still clears through the `leftThread` latch when that link drops `?thread`.

### 8. Creating and naming a session

`ensureThread` (`apps/web/components/chat-session.tsx:161-194`) returns `threadIdRef.current` when it has one; otherwise it `POST`s `/api/v1/threads` with just `{ agentId }`, fires `notifyThreadsChanged()`, and — only if the owner is still on the session the send started in — adopts the id and `router.replace("/chat?thread=<id>")`s (`:182-193`). A thread created while the owner opened another session is left where it is, so the pane is not pulled back to it (§ 11).

`handlePostThreads` (`packages/host/src/handlers/threads.ts:44-64`) validates that `agentId` and `title` are strings when present, 404s on an unknown agent, trims a supplied title to `THREAD_TITLE_MAX = 200` (`thread-title.ts:25`), and calls `createThread`, which defaults the title to `defaultThreadTitle(localeForRun())` (`packages/host/src/threads.ts:35-47`). That default is exactly the string the list filter throws away, so a thread created this way is **invisible in the rail until the first user message renames it**.

The rename is `setThreadTitleFromParts` (`packages/host/src/threads.ts:243-256`), called once per run at `packages/host/src/runs.ts:252`. It takes the first text part, collapses whitespace and truncates to 48 characters with an ellipsis (`titleFromParts`, `thread-title.ts:29-49`) — and it **only writes when the current title is still a default** (`:249`). A caller-supplied title survives forever; there is no rename UI.

### 9. Deleting

`DELETE /api/v1/threads/:id` → `handleDeleteThread` (`packages/host/src/handlers/threads.ts:81-92`) → `deleteThread` (`packages/host/src/threads.ts:124-153`): read it under the tenant triple first (404 when it is not yours), delete the row, then drop the Knowledge work card that the thread wrote:

```ts
// The thread's Knowledge work card goes with it; otherwise a deleted conversation keeps being
// retrieved. So do its graph node, the `retrieved` / `cites` edges pointing at it and the
// retrieval rows recorded against it.
deleteSourceByOrigin(tenant, { kind: "thread", id: threadId });
removeGraphForThread(tenant, threadId);
```

(`:139-151`.) Both calls sit in one try/catch that only warns, so a knowledge or graph failure never fails the delete.

### 10. Keep-alive

`WorkModeKeepAlive` (`apps/web/components/work-mode-keep-alive.tsx`) keeps every visited work-mode page mounted and merely `hidden`, so leaving Chat for Documents does not unmount `ChatSession`, and drafts plus in-flight SSE survive. It is keyed on the workspace id, so a desk switch **does** blow all panes away — which is the correct pairing with the rail's workspace-scoped list. Since 2026-09-23 the shell changes that id only when `GET /api/v1/workspaces` answers and names a desk (`shellWorkspaceFrom`, `apps/web/src/App.tsx:54`): a lapsed session, a 5xx or a proxy page used to read as "no desks" and remount every pane.

### 11. A run belongs to the session it started in (2026-09-23)

Opening another session from the rail while a reply streams used to write the rest of that reply into the session now on screen, and the new session's Send stayed disabled by the old run. Now:

- `ChatSession` keeps `sessionEpochRef` (`apps/web/components/chat-session.tsx:88`), bumped in the same render that sees a new `?thread` (`:98-112`), and passes it to the composer as `sessionKey` (`:113`, `:426`). `ensureThread`'s own `router.replace` is not a switch: it records the id on `awaitingUrlThreadRef` and the URL it left on `urlAtEnsureRef` (`:96-97`, set at `:209-211`) so the render before `?thread` lands does not bump the epoch. Creating the thread used to set `seenInitialThreadRef` early, and the `setThreadId` render (URL still on `/chat`) was counted as leaving that session, so the live reply never drew and Send stayed busy.
- `ChatComposer.send` records the key it started under (`apps/web/components/chat-composer.tsx:268`, `showing()`). If the owner moves on **before** the run reaches the host, nothing is sent and the draft stays in the box. If they move on **after**, the run's stream is still read to the end — the host aborts a run whose client goes away (`packages/host/src/http-adapter.ts:664-665`), and the reply the owner asked for would never be saved — but `readRunStream` (`chat-composer.tsx:113`) draws nothing once `showing()` is false, and the composer no longer holds Send or its error for the old session (`:193-198`).
- `onComplete` receives `{ threadId, showing }` (`RunEnd`, `chat-composer.tsx:96`; called at `:272`). `ChatSession` always fires `notifyThreadsChanged()`, and when `showing` is false it reloads that thread's messages only if the pane has come back to it (`chat-session.tsx:483-488`).
- `refreshMessages` drops an answer that lands after the pane moved to another session (`:329-334`).
- Only the draft that was sent is cleared; anything typed or attached since stays.

Pinned by `apps/web/lib/chat-run-stream.test.ts` (`readRunStream`) and `apps/web/lib/chat-run-scope-wiring.test.ts` (the wiring, read from source). Not driven in a browser.

### Failure modes

| Failure | Where | What the user sees |
|---|---|---|
| `GET /api/v1/threads` non-OK or network error | `fetchChatThreads`, `apps/web/lib/use-chat-threads.ts:68-76` | `rail-thread-error` line under `+ New chat` with the host message, or `chat.error.loadSessions`; the previous rows stay on screen |
| A row missing `id` / `title` / `createdAt` | `toThread`, `:45-62` | that row is dropped silently; the rest render |
| Confirm dialog dismissed | `removeThread`, `:143-145` | nothing happens, no request is sent |
| `DELETE` non-OK (404 / not yours) | `removeThread`, `:153-157` | `window.alert` with the host message plus the `rail-thread-error` line; the row stays |
| A second delete while one is in flight | `:140-142` | ignored; the busy row keeps `opacity-100` via `deletingId` |
| Deleted thread was the open one | `rail-recent-threads.tsx:41-43` | `router.push("/chat")`, pane blanks |
| `?thread=` points at a missing / foreign thread | `chat-session.tsx:250-252` | `chat-error` with `chat.error.threadMissing`; the rail row is already gone |
| More than 40 chat threads on the desk | `packages/host/src/threads.ts:90`, `:116` | `All sessions` shows the newest 40 and stops; nothing tells the user the list was cut |
| Thread created but never messaged | `handlers/threads.ts:29` + `thread-title.ts:20-22` | never appears in the rail |
| Rail collapsed | `app-rail.tsx:302` | no session rows at all; `mode-chat` icon only |

## Where things live

| File | Role |
|---|---|
| `apps/web/components/rail-recent-threads.tsx` | The whole session block: `+ New chat`, rows, delete buttons, the expand toggle |
| `apps/web/lib/use-chat-threads.ts` | `useChatThreads`, `fetchChatThreads`, `deleteChatThread`, `threadsPath` — the one source of truth for the list |
| `apps/web/lib/thread-groups.ts` | `RAIL_RECENT_THREADS = 4` and `takeRecentThreads` |
| `apps/web/lib/threads-events.ts` | `THREADS_CHANGED_EVENT` and `notifyThreadsChanged` |
| `apps/web/lib/workspace-scope.tsx` | `WorkspaceScope` context; the desk id the hook depends on |
| `apps/web/components/app-rail.tsx` | Where the block is mounted, and the collapse that unmounts it |
| `apps/web/src/pages/chat-page.tsx` | Reads `?thread` and mounts the pane full width |
| `apps/web/components/chat-session.tsx` | `ensureThread`, the `initialThreadId` load effect, the `leftThread` latch, the header `new-chat` |
| `apps/web/components/work-mode-keep-alive.tsx` | Keeps `/chat` mounted across rail switches; remounts on a desk change |
| `apps/web/components/workspace-switcher.tsx` | Fires `THREADS_CHANGED_EVENT` after selecting a desk |
| `packages/host/src/handlers/threads.ts` | `GET` / `POST` / `GET :id` / `DELETE` handlers; scope parsing; the default-title filter |
| `packages/host/src/threads.ts` | `listWorkspaceThreads` (40-row cap, tenancy, `quick-chat` scope), `createThread`, `deleteThread`, `setThreadTitleFromParts` |
| `packages/host/src/thread-title.ts` | Per-locale default titles, `isDefaultThreadTitle`, `titleFromParts`, `THREAD_TITLE_MAX` |
| `packages/host/src/router.ts` | Route table, `:204-207` |
| `apps/web/lib/rail-threads-wiring.test.ts` | Source-level contract: which testids exist, that the retired column is gone, that the toggle expands in place |

## Gotchas

- **`rail-thread-list` is the only session list left.** `apps/web/components/chat-thread-list.tsx` was deleted on 2026-09-17, and `apps/web/lib/rail-threads-wiring.test.ts:30-37` asserts that it stays deleted and that no file routes to `threads=all`. The only two occurrences of `thread-list` and `chat-wire` anywhere in `apps/web` are negative assertions (`rail-threads-wiring.test.ts:35`, `apps/web/tests/e2e/foundation.spec.ts:22`). A locator on `thread-list`, `thread-list-new-chat` or `thread-resize` is a stale recipe.
- **`threads-see-all` only exists above four threads** (`rail-recent-threads.tsx:93`). With four or fewer, waiting for it is waiting forever — and with exactly five, deleting one makes it vanish.
- **Expansion is not persisted.** `expanded` is `useState` in the component (`:31`); a reload, and any remount such as a desk switch, starts collapsed. Driven.
- **`thread-delete` is `opacity-0`, not hidden** (`:78-80`). Playwright happily calls it visible and clicks it without a hover; a human must hover or tab into the row. Do not "fix" a driver by forcing `visible` — hover the parent row.
- **The delete confirm is a native `window.confirm`** (`use-chat-threads.ts:143`), so a driver must register a dialog handler *before* clicking or the click hangs. It is localized through `chat.deleteConfirm` and quotes the thread title.
- **An unnamed thread is invisible, not lost.** `handlers/threads.ts:29` filters every locale's default title. `GET /api/v1/threads?scope=all` will not show a freshly-`POST`ed thread unless you supplied a title, even though `GET /api/v1/threads/:id` returns it fine.
- **A supplied title is never overwritten.** `setThreadTitleFromParts` bails unless the stored title is still a default (`packages/host/src/threads.ts:249`). Seeding with `title: "VERIFY …"` and then sending in that thread leaves the seeded name, so the rail row will not echo the prompt.
- **40 is a silent ceiling.** `listWorkspaceThreads` defaults `limit` to 40 and the handler never overrides it (`packages/host/src/threads.ts:90`). `All sessions` means "all forty newest".
- **`aria-current` is on the row only while the pathname is `/chat`** (`rail-recent-threads.tsx:33-35`). Open a thread, go to Documents, and nothing is marked current even though `?thread` is still in the Chat pane's own history entry.
- **Opening a row and sending immediately used to fork a new thread — fixed in 0.14.27.** `ensureThread` once read `threadIdRef.current` alone, which is only filled when the thread `GET` resolves, while the URL already said `?thread=<id>`; a send inside that window created a second thread. It now falls back to `pendingThreadRef`, seeded synchronously from `initialThreadId` and re-synced on every param change (`chat-session.tsx:114-118`, `:186-191`), and dropped back to whatever really loaded — `null` when the pane is emptied, `threadIdRef.current` when the load failed (`:291-292`, `:299`). Recorded in `docs/internal/0.14.27-changelog.md:84`; pinned by `apps/web/lib/rail-threads-wiring.test.ts:100-107`.
- **Nothing pushes.** The list only refreshes on the four `notifyThreadsChanged()` publishers and on a workspace-id change. A thread created by curl, by another tab, or by the packaged window will not appear in an open rail.
- **`preview` is typed but never sent.** `ChatThread.preview` exists on the client (`use-chat-threads.ts:18`, `:60`) and `handleGetThreads` never populates it; the row that does carry a preview is `PastSessionSummary` on a different path (`packages/host/src/threads.ts:155-160`, filled by `listPastSessionsForAgent` at `:162`).
- **The pane is full width now.** The old "480px window leaves the chat pane ~48px" arithmetic is dead: there is no second column to subtract, only the 232px rail, and expanding the list scrolls the rail rather than narrowing the pane.

## Verify

`.cursor/skills/verify-agentforge/features/chat.md` — sub-features `chat-rail-sessions`, `chat-threads-expand`, `chat-switch`, `chat-new`, `chat-rail`, `chat-keep-alive`.

DOM testids that prove it: `rail-thread-list` (`apps/web/components/rail-recent-threads.tsx:47`), `new-chat-link` (`:51`), `thread-item` (`:70`) with `aria-current="true"` on the open row (`:71`), `thread-delete` (`:85`), `rail-thread-error` (`:57`), `threads-see-all` with `aria-expanded` (`:98-99`), `rail-collapse` / `rail-expand` (`apps/web/components/app-rail.tsx:439`), `mode-chat` (`:299`), and the pane's own `chat-empty` / `message-list` / `message-output`. Source-level contract in `apps/web/lib/rail-threads-wiring.test.ts`; the Playwright walk is `apps/web/tests/e2e/foundation.spec.ts`, retargeted to `rail-thread-list`.

Driven on the owner's webdev (`http://127.0.0.1:3000`, doctor `runtime: stub`) on 2026-09-17 with six seeded threads: 4 rows → `Semua sesi` → 6 rows → `Lebih sedikit` → 4 rows, open a row (`aria-current`), `+ Chat baru` with a turn on screen (pane cleared, thread intact), `thread-delete` with the confirm accepted, collapsed rail empty, reload starts collapsed. Evidence under `.cursor/skills/verify-agentforge/evidence/chat/2026-09-17-cc-map/`.

## Why

**Why the sessions moved into the rail and the second column was deleted.** `[Direct]` `docs/product-modes.md:39`: "A few recent **Chat** sessions sit under the Chat entry in the rail (owner decision 2026-09-17), capped at `RAIL_RECENT_THREADS` (4) with `+ New chat` above them and an `All sessions` row when more exist. That row is a toggle: the rail list expands in place to every session the host returns, and there is no second column at all." `[Direct]` the same file's boundary table at `:129` names "a separate all-sessions column" as an explicit non-goal, alongside "Mixing job-mode artifacts or every session into the global nav". `[Direct]` `docs/internal/0.14.27-changelog.md:80` records the change and its parts: "`chat-thread-list.tsx` — the old second column — is **deleted**, with `THREAD_WIDTH` and the `chat.threads.*` / `newChatPlus` / `sessions*` keys." **Confidence: high.**

**Why the hook depends on the workspace id rather than remounting.** `[Direct]` the comment at `apps/web/lib/use-chat-threads.ts:99-102`: "threads are per desk: switching desks re-renders the shell without remounting the rail, and a stale list would show the previous desk's titles." `[Supported]` the host enforces the same boundary in SQL — the three tenancy equalities in `listWorkspaceThreads` (`packages/host/src/threads.ts:93-95`) — and `docs/internal/0.14.23-changelog.md:57` records "threads were not workspace-scoped" as a CRITICAL 2026-09-08 hardening fix, so the renderer-side scoping is the second half of a bug that was already paid for once. **Confidence: high.**

**Why a transient load failure keeps the old rows.** `[Direct]` the comment at `apps/web/lib/use-chat-threads.ts:123`: "A transient failure keeps the last good list on screen; only the error line is new." `[Supported]` `apps/web/lib/rail-threads-wiring.test.ts:131-134` pins it as a contract by asserting the hook does **not** contain `setThreads([]);`. **Confidence: high.**

**Why unnamed threads are filtered out of the list.** `[Inferred]` no commit or doc states the reason. The chain: `ensureThread` creates the row *before* the first message is sent (`apps/web/components/chat-session.tsx:195-204`), `createThread` gives it the locale default title (`packages/host/src/threads.ts:43`), and `handleGetThreads` filters exactly those titles (`packages/host/src/handlers/threads.ts:29`). Without the filter, every composer that created a thread and then failed, aborted, or was abandoned would leave a `New thread` row in a four-row rail. **Confidence: medium — the mechanism is certain, the motive is read off the mechanism.**
