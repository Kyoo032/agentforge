# Map — The first-run desk and the first-run guide

Last verified: 2026-09-29 at aaf249d + working tree, not committed. Driven on `:3000` with the host's first-run answers faked in the browser (`drive-guide.mjs`, 1280 / 683 / 375 wide, light and dark, English and Indonesian, keyboard only); the host half is proven by tests against a real empty data dir and two real host processes across Start over. **Not driven:** the packaged Windows app, and a real fresh `:3000` (it needs a restart to serve `POST /api/v1/settings/guide`). Later the same day the rail's first frames (§ 6) were driven with the workspaces answer faked and delayed 800 ms, 1280 and 375 wide, a frame sampler counting the modes drawn.

> **Two products, one repo.** The first-desk rule below is **Personal**'s (Rizky, 2026-09-29). **Enterprise**'s first desk keeps every mode and he has not decided it. The guide is shared: `apps/web` is the renderer of both.

## Overview

Two things that a person meets in their first minute. **The first desk** is what a fresh Personal install opens with: Chat plus Research, Images, Videos and Presentation, and no other mode, written into the desk row once and never touched again. **The guide** is a five-stop tour of the real shell, offered once when first-run setup ends, that ends by pointing at the page where the rest of the modes are switched on. Neither is a gate: nothing about setup waits for either, and the host keeps deciding what a key may do.

## How it works

### 1. The first desk

`resolveWorkspaceModes` is the **read** rule and did not change: a desk row with nothing stored reads as every mode (`packages/core/src/agents/product-modes.ts:156`, fallback `:40`), so a desk from before the column existed never loses its rail. The **write** rule is new:

- `FIRST_RUN_MODES` (`packages/core/src/agents/product-modes.ts:55`) is the list, spelled out and frozen: `chat, research, images, videos, presentations`. Chat is in it because `resolveWorkspaceModes` forces Chat into any list, and the stored row should equal what the rail shows. It is not derived from the catalog on purpose.
- `HOSTED_FIRST_DESK_MODES` (`:69`) is Enterprise's, every mode, unchanged.
- `firstDeskModes(hosted)` (`:76`) picks one and returns a copy. It takes the flag as an argument so this file stays free of `process` (the renderer imports it).

There are exactly two writers of a first desk, and a test holds the number at two:

| Writer | When | Reads |
|---|---|---|
| `ensureLocalOwner` (`packages/db/src/ensure-local-owner.ts:22`; the first-desk branch is `ownedWorkspaces.length === 0` at `:66`, with `productModes: firstDeskModes(isServerMode())` at `:78`) | the org has no desk: a fresh data dir, `pnpm db:seed`, and **Start over "all"** | `FIRST_RUN_MODES` off server mode |
| `ensurePortalOwner` (`packages/db/src/portal-owner.ts:151`) | a hosted tenant's first request, and the hosted "Start over", which re-provisions | `HOSTED_FIRST_DESK_MODES` |

How the two products stay apart: they are **different functions**, and the local one also asks `isServerMode()` (`packages/core/src/server-mode.ts:12`), so a hosted process that ever reached it would still get every mode. `getTenant` routes a hosted request to `resolvePortalTenant` and never to `ensureLocalOwner` (`packages/host/src/tenant.ts:96-102`), so this is a belt to that brace.

**Start over "all"** queues `reset-pending.json` (`resetEverything`, `packages/host/src/handlers/settings.ts:432`), and the next boot removes the database before SQLite opens (`packages/db/src/client.ts`, see [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md)). The first request after that walks `getTenant` (`packages/host/src/tenant.ts:88`), then `resolveLocalOwner`, then `ensureLocalOwner` on an empty organization, which is the branch above. `packages/host/src/first-run-modes.test.ts` runs that with two real processes.

`createLocalWorkspace` (`packages/db/src/ensure-local-owner.ts:149`) is **not** a first-desk writer: it is Workspaces' Create, whose modes the owner chose, and its "no modes given" default (`:170`) stays every mode. Nothing rewrites an existing desk: `ensureLocalOwner` writes only inside `ownedWorkspaces.length === 0`.

**Adding the rest.** Workspaces' Edit on the current desk PATCHes `productModes` (`handlePatchWorkspace`, `packages/host/src/handlers/workspaces.ts:131`; [`shell-rail-and-workspaces.md`](shell-rail-and-workspaces.md) § 6). The desk `Default` is `protected` from deletion, not from editing.

### 2. Offering the guide

`AppRoutes` (`apps/web/src/App.tsx`) is the only place that opens it unprompted:

1. Every settings read hydrates the store with `payload.guide` (`hydrateGuide`, `:246`; `apps/web/lib/guide-store.ts:52`). The host's answer is `{ seen, outcome, at }`.
2. When the onboarding screen finishes (`onDone`, `:306`), `offerGuideAfterOnboarding()` (`apps/web/lib/guide-store.ts:93`) offers the tour unless the host said `seen: true`.
3. `<GuideTour visibleModes ready>` is mounted in `Shell` (`:115`) and draws nothing until `ready` (the workspaces answer has named a desk, so the rail it points at is the real one).

Consequences, all on purpose: an install that upgraded into this build never sees it unprompted; a desk on the stub runtime never sees it; Playwright never sees it. Only a person who goes through first-run setup, or presses Replay, does. Onboarding's last step promises it only while it is coming (`onboarding-tour-hint`, hidden once `seen`).

### 3. The state machine

`apps/web/lib/guide-machine.ts`, pure, tested exhaustively to depth 5:

```
idle --offer--> offered --start/next--> step(0) --next--> ... step(n-1) --next--> done(finished)
offered|step --skip--> done(skipped)      offered|step --close--> done(closed)
step(n>0) --back--> step(n-1)             any --replay--> step(0)
```

`guideReducer` (`:56`) returns the same object for an event that means nothing, which is how the store tells "nothing happened". `offer` is refused from `done`, so nobody is re-offered a tour in the session they finished it. `outcomeOwed` (`:86`) is the one rule for when the host is told: exactly when an open tour ends. The steps are data (`GUIDE_STEPS`, `apps/web/lib/guide-steps.ts:75`): `modes` (the rail's nav, `data-tour="rail-modes"`, `apps/web/components/app-rail.tsx:225`), `workspaces` (`workspaces-link`), `chat` (`composer`), `knowledge` (`mode-knowledge`), `settings` (`settings-link`). Two bodies read the desk, so the words are true on both products: step one lists the desk's own tools (`modesBody`): one, up to five by name in the reader's language, or a sentence that does not list; step two (`workspacesBody`) names up to three tools the desk does not have yet, or says the desk already has every tool (the hosted first desk, or an owner who switched them all on).

### 4. On screen

`GuideOverlay` (`apps/web/components/guide-tour.tsx:124`) is mounted only while the tour is open, so its side effects are exactly as long as the tour:

- **Inert.** `#root` gets `inert` (`:162`), so nothing behind the card can be clicked, tabbed to or read by a screen reader. The dimmed desk swallows clicks and does nothing with them (no advance, no close). Focus moves onto the card (`role="dialog"`, `aria-label`, `aria-describedby` = progress + title + body) and goes back to where it was on close (`restoreFocus`, `:101`; falls to `app-main-panel` when the old element is gone, as it is after onboarding).
- **Keys.** One capture-phase `keydown` listener asks `guideKeyAction` (`apps/web/lib/guide-keys.ts`, `guideKeyAction`): Esc closes; Tab and Shift+Tab wrap inside the card; ArrowRight / ArrowLeft step; Enter with focus on the card itself is Next, so five Enters walk the tour. A held key does not: `swallowsRepeat` drops the repeats of Enter, Space and the arrows, or holding Enter would record the tour finished before anything was read.
- **Placement.** `placeGuideCard` (`apps/web/lib/guide-placement.ts:71`) puts the card on the preferred side of the measured anchor, then the opposite, then the others; with no room it becomes a bottom **sheet** (an anchor is on screen but no side fits: a 375px window's icon rail), and with no anchor it is centred. The ring follows the anchor, not the placement. The anchor is the first *visible* match (`findGuideAnchor`, `:70`), because kept-alive panes have zero-size copies. It is re-measured on resize, scroll and a 400 ms timer that exists only while the tour is open.
- **Motion.** Nothing loops. The ring and card move with finite transitions; the mascot is the 36px head, decorative, `wave` on the offer and `presenting` on the steps, never busy.

### 5. Recording how it ended

`dispatchGuide` (`apps/web/lib/guide-store.ts:79`) publishes the new state, sets `seen: true` locally at once, then `persistOutcome` (`:67`) posts `{ outcome }` to `POST /api/v1/settings/guide` (`handlePostGuide`, `packages/host/src/handlers/guide.ts:18`; route `packages/host/src/router.ts:290`). A failed write never brings the tour back. The host stores `users[userId].guide = { outcome, at }` in the **sealed settings payload** beside the language (`saveUserGuide`, `packages/host/src/settings-store.ts:641`; `UserPrefs` `:188`), reads it back as `guide` on every settings answer (`packages/host/src/handlers/settings.ts:101`), and never inherits it from another user (`loadUserGuide`, `:627`).

Because it lives in `settings.enc` it is machine-wide on a desk (one user), per person on the hosted app, and **erased by Start over**: `settings.enc` is the first entry of `HOST_RESET_ENTRIES`. "Sign out of the gateway" (`scope: "key"`) does not clear it, and Replay does not either. The hosted "Start over" (`scope: "tenant"`) removes the tenant's `tenant_state` rows and takes the record with them.

### 6. The rail's first frames

`Shell` mounts one round trip before `GET /api/v1/workspaces` answers, and until 2026-09-29 it started from every mode, so a fresh install drew fourteen tabs and then narrowed to five. It no longer guesses. The rules are pure and live in `apps/web/lib/shell-modes.ts` (pinned by `lib/shell-modes.test.ts`); the state is `Shell`'s (`apps/web/src/App.tsx:83-97`). The first frame comes from one of two places, and the host's answer replaces either:

| Source | When | The rail draws | May redirect away from a mode |
|---|---|---|---|
| `cache` | this browser has drawn a desk before: `agentforge-shell-modes` (`:<tenantId>` on the hosted app) holds the list the host last named, rewritten on every answer (`App.tsx:110`) | that list | no |
| `unknown` | nothing stored: a brand-new install, or cleared storage | Chat, then four still skeleton rows under the Make label (`RailModesSkeleton`, `apps/web/components/rail-modes-skeleton.tsx`; `SKELETON_MODE_ROWS` is the job-mode count of `FIRST_RUN_MODES`, so on a fresh desk the account links do not move when the answer lands) | no |
| `host` | `GET /api/v1/workspaces` named a desk | the desk's modes | yes |

- **Only the host's answer may redirect.** `AppShell` passes `settled={modeRedirectAllowed(modesSource)}` (`components/app-shell.tsx:31`) and `ModeRedirect` returns no target until it is true (`components/mode-redirect.tsx:14`). A remembered list narrower than the desk would otherwise bounce a deep link to a mode the desk has (mutation-checked: without the guard `/documents` went to `/chat`).
- **The cache is a hint, never truth.** `parseCachedShellModes` (`lib/shell-modes.ts:62`) discards an empty or Chat-less value instead of reading it as every mode, which is `resolveWorkspaceModes`'s rule for an old desk and exactly the guess this replaced. Storage is read and written inside try/catch (`readShellModesCache`, `writeShellModesCache`); a blocked store means an `unknown` first frame. A desk changed behind this browser's back (another machine, a data dir replaced on `:3000`) draws its old list for one round trip; the packaged app's Start over clears Chromium storage, so it starts `unknown`.
- **Rows that take a skeleton's place do not slide in** (`startedPending`, `apps/web/components/app-rail.tsx:163`, `enter={!startedPending}` at `:277`). Their `enter-slide` entrance leaves the group blank while each row waits out its stagger: 19 of 39 frames around the swap in the drive. A rail that mounted with a cache keeps the entrance it always had.
- **A locale change remounts `Shell`** (`key={localeEpoch}`), and it now starts from the cache as well, where it used to redraw every mode.

Driven 2026-09-29 on `:3000` (the answer faked in the browser and delayed 800 ms; frames in the first second after the rail appeared, from a `requestAnimationFrame` sampler): a fresh desk drew a mode the desk lacks in 40 of 44 frames at 1280 and 51 of 54 at 375 before, 0 after; a returning five-mode desk 39 of 45 and 50 of 57 before, 0 after; a returning fourteen-mode desk is unchanged (0 before and after, the same 14 links and nav heights). On a fresh desk the nav's scroll height (694) and the Settings link's top are the same before and after the swap, at 1280 and 375. Not touched, and older: the recent-sessions block adds 56px to the rail about 100 ms in (identical before and after), and at 375 the first two frames still draw the 232px rail before its mount effect collapses it ([`shell-rail-and-workspaces.md`](shell-rail-and-workspaces.md) Gotchas).

### Failure modes

| Case | What happens |
|---|---|
| `GET /api/v1/settings` has no `guide` (a host that has not been restarted) | `hydrateGuide` ignores it; `seen` stays `null`, which counts as not seen. Replay still works; the outcome POST answers 404 and is dropped |
| The outcome POST fails | the tour stays closed, `seen` is true in this session, the next first-run setup may offer it once more |
| An anchor is not on screen (no composer on Settings, a collapsed rail with no room) | ring omitted for a missing anchor; centred card, or a bottom sheet when the anchor is there but has no room; the tour goes on |
| The workspaces answer has not arrived | `ready` is false; nothing draws, and the offer waits. The rail draws the remembered desk, or Chat and the skeleton when nothing is remembered (§ 6); nothing redirects |
| The workspaces read fails and nothing is remembered | the skeleton stays until a later read (every navigation, and the `agentforge-shell-refresh` event) names a desk; it never turns into every mode |
| The window is resized mid-tour | re-measured within a frame (resize) or 400 ms; the card and ring follow |
| A second tab or a reload mid-tour | the store is per page; a reload closes the tour without recording anything, and nothing reopens it |

## Where things live

| File | Role |
|---|---|
| `packages/core/src/agents/product-modes.ts` | `FIRST_RUN_MODES`, `HOSTED_FIRST_DESK_MODES`, `firstDeskModes`; the read rule `resolveWorkspaceModes` |
| `packages/db/src/ensure-local-owner.ts`, `packages/db/src/portal-owner.ts` | the two first-desk writers |
| `apps/web/lib/shell-modes.ts`, `apps/web/components/rail-modes-skeleton.tsx` | the first-frame rules (`initialShellModes`, `shellModesFromHost`, the cache), the skeleton rows (§ 6) |
| `packages/core/src/guide.ts` | `GUIDE_OUTCOMES`, `GuideRecord`, `guidePayload`, `parseGuideRecord` |
| `packages/host/src/settings-store.ts`, `packages/host/src/handlers/guide.ts`, `packages/host/src/handlers/settings.ts` | the stored record, the route, the payload field |
| `apps/web/lib/guide-machine.ts`, `guide-steps.ts`, `guide-placement.ts`, `guide-keys.ts`, `guide-store.ts` | machine, registry, geometry, keyboard contract, store |
| `apps/web/components/guide-tour.tsx`, `guide-card.tsx`, `settings-guide-card.tsx` | the overlay, the card, Settings' Replay |
| `apps/web/locales/{en,id}/guide.json` | all the copy (namespace `guide`); onboarding's `tourNext` and its four example tiles are in `onboarding.json` |
| `packages/host/test/first-run-child.ts` | the child process `first-run-modes.test.ts` runs twice across Start over |

## Gotchas

- **The rail's first frames are the remembered desk, or Chat and a skeleton, never every mode** (fixed 2026-09-29; it used to flash all fourteen tabs on a fresh desk, "known and left" until then). See § 6. A probe that counts `mode-*` testids on the very first frames of a fresh desk sees one mode link (`mode-chat`, plus the always-present `mode-knowledge`, which is an account link) and four `rail-modes-skeleton-row` elements, not five modes; wait for the fifth mode link, and never count the skeleton as modes (it has no `mode-` testid). A screenshot taken while the skeleton shows is not a bug.
- **Vite serves modules under a hot-update query,** so a probe that `import()`s `/lib/guide-store.ts` gets a second instance of the store. Find the exact URL from `performance.getEntriesByType("resource")`.
- **The tour never navigates,** including from Settings' Replay. The composer stop is a centred card there and points at the real composer from Chat.
- **The Playwright suite needs Documents, Finance, Data, Market and Edit,** which a fresh desk no longer has, so `apps/web/tests/e2e/every-mode.ts` gives the Default desk every mode before each spec. That spec change is not run here (Playwright is not run on this desk).
- **`FALLBACK_PRODUCT_MODES` is not the first-run list.** Editing it changes what an old row reads as, not what a new desk starts with.

## Verify

[`features/guide.md`](../../../.cursor/skills/verify-agentforge/features/guide.md) drives the tour; [`features/workspaces.md`](../../../.cursor/skills/verify-agentforge/features/workspaces.md) and [`features/onboarding.md`](../../../.cursor/skills/verify-agentforge/features/onboarding.md) carry the first-desk notes. Testids: `guide-overlay`, `guide-backdrop`, `guide-spotlight`, `guide-card` (`data-guide-mode`, `data-guide-step`, `data-guide-index`, `data-guide-placement`), `guide-progress`, `guide-title`, `guide-body`, `guide-dots`, `guide-next`, `guide-back`, `guide-skip`, `guide-close`, `guide-live`, `settings-guide`, `settings-guide-replay`, `onboarding-tour-hint`.

Tests that pin it: `packages/host/src/first-run-modes.test.ts`, `packages/db/src/first-desk-modes.test.ts`, `packages/core/src/agents/product-modes.test.ts`, `packages/host/src/handlers/guide.test.ts`, `packages/core/src/guide.test.ts`, and in `apps/web/lib`: `guide-machine`, `guide-steps`, `guide-placement`, `guide-keys`, `guide-store`, `guide-locale`, `guide-card-render`, `guide-wiring`, `onboarding-first-run-copy`, `shell-modes` and `shell-first-paint`.
