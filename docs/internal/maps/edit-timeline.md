# Map — Edit timeline and agent

Last verified: 2026-09-20 at 6984d84

## Overview

Edit is a CapCut-shaped video editor bolted onto an agent. The owner and the agent write into **one
append-only ops log** per project; the visible timeline is a fold of that log, and every agent change
is a card with Keep / Undo / Tweak. It is not a render farm and not a cloud editor: ffmpeg runs
locally, media lives under the desk's data dir, and everything except *generate* works with no gateway
key at all.

Three things to hold onto. **The document is the fold, not the state** — `POST /ops` appends, the
server folds and snapshots, and the renderer keeps its own optimistic copy. **The project event stream
echoes your own ops back to you**, which is where the current crashes come from. And **the review gate
is a pair of integers** (`lastAgentSeq` vs `ackSeq`) — nothing more — which is why it opens and closes
in ways that look surprising.

## How it works

### 1. Rail → `/edit` → shell

`mode-edit` is an ordinary work-mode rail tab (`mode-${href.slice(1)}`), present on Default since
0.14.22. The route renders `EditStudio` (`apps/web/components/edit-studio.tsx:61`), which mounts as
`data-testid="edit-studio"` (`:630`).

On mount it fires four independent reads (`apps/web/components/edit-studio.tsx:129-163`):

| Call | Used for |
|---|---|
| `GET /api/v1/edit/projects` | the project list in `edit-project-list` |
| `GET /api/v1/edit/doctor` | the `edit-needs-ffmpeg` banner |
| `GET /api/v1/settings` | `hasOpenai` → `edit-needs-key`; `editTurnCapUsd` → the turn meter |
| `GET /api/v1/videos` and `GET /api/v1/images` | the model catalogs for the Generate tab |

With no project open the studio renders a **placeholder** layout: `edit-project-list` on the left, an
empty `edit-preview` div and an empty `edit-timeline` div (`:735-736`), and an `edit-agent-panel`
holding only `t("edit.openProjectHint")` (`:738-740`). `edit-composer`, `edit-import`,
`edit-generate-tab` and `edit-ops-count` do **not** exist in this state. `edit-export` exists but is
disabled, because `!project` is the first term of its `disabled` expression (`:659`).

`FfmpegSetupNotice` (`apps/web/components/ffmpeg-setup-notice.tsx:30`) renders **nothing** unless
`doctor.ffmpeg.found === false` (`:35-37`); when it does render it is `edit-needs-ffmpeg` (`:65`)
with `ffmpeg-install-command` and a `ffmpeg-recheck` button that re-probes via
`GET /api/v1/edit/doctor?recheck=1`.

### 2. Doctor — ffmpeg and ASR

`handleGetEditDoctor` (`packages/host/src/handlers/edit.ts:99-102`) → `getEditDoctor`
(`packages/host/src/edit/doctor.ts:38-54`). It returns `{ ffmpeg, asr, fonts }`. `recheck=1` drops the
cached probe (`resetFfmpegBinaryCache`) but is throttled to one forced re-probe every
`RECHECK_MIN_INTERVAL_MS = 2_000` (`doctor.ts:30, :39-42`), because each probe shells out to ffmpeg
and the caller is a local web page. When ffmpeg is missing the report also carries a per-OS
`setup` hint (`ffmpegSetupHint`, `doctor.ts:50`).

`.cursor/skills/verify-agentforge/scripts/doctor.mjs` folds this endpoint into its own JSON as `edit`. A missing endpoint is a note,
not a doctor failure.

### 3. Creating a project, and starter media

`edit-new-project` → `onNewProject` (`apps/web/components/edit-studio.tsx:261-288`) →
`POST /api/v1/edit/projects` with `{name, aspect, fps: 30, starterId}`. The aspect is derived from the
starter, not from the picker (`projectAspectFromStarter`, `:891-894`).

`createEditProject` (`packages/host/src/edit/projects.ts:19-63`):

1. Inserts the `edit_projects` row with `reviewJson = {lastAgentSeq: 0, ackSeq: 0}`.
2. `seedStarterProject` (`:65-116`) adds an in-memory title clip, caption clip and `@music-bed`
   ingredient for the starters that ask for them.
3. `seedStarterMedia` (`packages/host/src/edit/starter-media.ts:171-204`) copies the bundled sample
   files out of `apps/desktop/resources/starters/` (packaged: `resources/starters`) into the desk's
   media root and lands them as clips. A file that is not there is **skipped and logged**, never
   fetched (`starter-media.ts:182-204`). If seeding throws, the project row is deleted again
   (`projects.ts:53-57`) so a half-seeded project never survives.
4. `writeSnapshot(id, 0, doc)` — the starter lands in the **snapshot**, not the ops log. That is why a
   fresh `promo-16x9` project reads `edit-ops-count` = `ops 0` with four clips on screen.

`edit-starter` labels and `edit-starter-description` come from `STARTER_PROJECTS` in core, which is
English-only; the `edit.starters.*` locale keys exist and are unreferenced.

### 4. The ops log — the one write path

Everything that changes a project goes through `appendOps` (`packages/host/src/edit/ops.ts`):

1. Per input op: compute the inverse (`computeInverse`), bump `seq` and `clock`, build an `EditOp`
   with `actor`, optional `cardId` / `undoOf` (`ops.ts:180-202`).
2. `assertAgentOpHasCard(op)` — an `agent:` op without a card is rejected (`:203`).
3. `applyOp(doc, applyable)` folds it into the in-memory doc (`:204`). **If the op is invalid the
   whole append throws**; `applyOp` is where `clip id already exists` / `asset id already exists` /
   `split atFrame must be strictly inside the clip` come from (`packages/core/src/edit/ops.ts:342-551`).
4. If `actor.startsWith("agent:")`, `doc.review.lastAgentSeq = seq` (`ops.ts:206-208`) — **this is the
   entire review gate**.
5. Insert the `edit_ops` row; snapshot every `SNAPSHOT_EVERY` ops (`:226-233`).
6. Update `edit_projects` (`seq`, `reviewJson`, name, fps, size) (`:236-247`).
7. `editEvents.emitEvent({type: "ops.appended", projectId, ops: applied, seq})` (`:249`).

`foldProject(projectId, workspaceId)` is also the **tenant check**: every handler calls it first, so a
project id from another desk 404s before anything else runs (see the comments at
`packages/host/src/handlers/edit.ts:171`, `:333`).

Since Phase 3 lane A that is enforced rather than assumed. `workspaceId` is a **required** argument on
`loadProjectRow` (`ops.ts:75`), `foldProject` (`:129`) and `appendOps` (via `AppendOpsOptions`, `:29`),
and the desk is part of the `WHERE` clause instead of a follow-up comparison — a handler that forgets
the scope no longer compiles. The same rule runs down the child tables, which carry only a
`project_id`: `getEditJob` / `cancelEditJob` (`jobs.ts:121`, `:442`) pin a job to its project,
`undoCard` / `keepCard` (`undo.ts:41`, `:83`) pin a card to its project, and the unplaced routes pin
the item to the `:projectId` in their own path (`handlers/edit.ts:447`, `:494`). A wrong desk and a
missing row both answer the same 404, so the error leaks nothing about what exists elsewhere.

The job runner is the one caller with no request to scope by, so it has two named unscoped reads —
`workerWorkspaceId` (`ops.ts:97`) and `workerJob` (`jobs.ts:141`) — which turn a job row the handler
already checked back into a scope the rest of the store enforces. They are deliberate and auditable;
`edit-scope.test.ts` fails if a handler ever imports one.

### 5. The renderer's copy, and the echo

`EditStudio` opens `GET /api/v1/edit/projects/:id/events` as an SSE stream whenever a project id is set
(`apps/web/components/edit-studio.tsx:166-233`). The stream is a plain fan-out of the host event bus
filtered by project id (`packages/host/src/edit/events.ts:21-31`; handler at
`packages/host/src/handlers/edit.ts:330-364`, which folds the project first so the desk check happens
before the first frame).

The renderer reacts to four frame families (`edit-studio.tsx:193-232`):

| Frame | Effect |
|---|---|
| `ops.appended` / `edit.ops` | `setProject((current) => foldApplied(current, ops))` |
| `card.updated` / `edit.card` | upsert into `cards`, release the emit lock |
| `job.progress` / `job.done` / `edit.job` | replace the job row |
| `tool.started` | arm the emit lock unless the tool is a job-backed one |

**The host does not filter your own ops out of this stream**, and the renderer does not dedupe by op
id. Every op therefore reaches the renderer twice: once from the request that caused it, once from the
stream. Whether that is harmless depends entirely on *how* the second copy is applied — see
`Failure modes` and `Gotchas`.

### 6. Owner edits — keyboard, drag, `commitOps`

The keyboard handler is a window listener guarded by "is the studio mounted and is the target not an
input" (`apps/web/components/edit-studio.tsx:344-397`):

| Key | Action |
|---|---|
| `Space` / `K` | toggle play |
| `S` | `split_clip` at the playhead, only when the playhead is **strictly inside** the selected clip (`:361-368`) |
| `Delete` / `Backspace` | `delete_clip` on the selection |
| `J` / `L` | step the playhead by `fps/4`, pausing playback |

There is **no `Ctrl+Z`**. Undo exists only as `edit-card-undo` on an agent card.

Dragging is in `EditTimeline` (`apps/web/components/edit-timeline.tsx:61-138`): mousedown on a clip
body starts a `move`, on either 1.5 px edge handle a `trim-in` / `trim-out`. The draft lives in local
state and only commits on mouseup, so a plain click never posts an op. A locked clip (emit lock)
refuses to start a drag at all (`:64-66`).

All of them funnel into `commitOps` (`edit-studio.tsx:235-259`) → `postEditOps`
(`apps/web/lib/edit-client.ts:238-293`), which posts `{ops, parent, clock}`, folds the server's
`applied` into the project and bumps `opsPosted`. `opsPosted` is the number backing `edit-ops-count`
(`edit-studio.tsx:836-838`) — it is a **session counter, not the ops log**, so it resets to `ops 0` on
every reload.

`postEditOps` also auto-keeps any card whose clips the owner just touched
(`cardIdsClearedByTouch`, `apps/web/lib/edit-badges.ts`, called at `edit-client.ts:250-252`): touching
an agent's clip by hand is treated as accepting that card.

The playhead is moved by clicking the timeline's **shared scroll container**, not a track
(`edit-timeline.tsx:163`, `onTrackClick` at `:54-59`), so a click on any empty pixel — including an
empty track row — seeks. A click on a clip calls `stopPropagation` and only selects.

### 7. Import

`edit-import` is the first nav button (`edit-studio.tsx:758-779`) and does two things: it selects the
`upload` tool and calls `onImportClick` (`:309-333`).

- **Packaged (Electron):** `pickMedia()` over IPC returns a path, and the renderer posts
  `{sourcePath}` as JSON. The host accepts `sourcePath` **only** when the transport header says `ipc`
  (`packages/host/src/handlers/edit.ts:203-206`) — over HTTP it is a 400. Extension → mime is a fixed
  ladder at `:222-242`.
- **Webdev:** `fileRef.current?.click()` opens the hidden `<input type="file">` (`:745-757`), and
  `onImportFile` (`:290-307`) posts multipart to `POST /api/v1/edit/projects/:id/import`.

Host side (`packages/host/src/handlers/edit.ts:194-309`):

1. `foldProject` (desk check), then `saveEditFile` (`:71-97`) — `assertEditUpload` enforces
   `EDIT_UPLOAD_MAX = 500 MB` and an allow-list of image/video/audio mimes (`:28-32`, `:600-607`),
   then writes `mediaRoot()/<organizationId>/<mediaId>.<ext>` and inserts a `media` row.
2. `probe(abs, projectId)` via ffmpeg. **On a probe failure the file is unlinked again** and the call
   answers `400 unsupported_media` (`:257-270`) — no orphan bytes.
3. Duration comes from `importedClipDurationFrames`; a still image gets `STILL_IMAGE_SECONDS`
   (`packages/host/src/edit/import-duration.ts`).
4. `appendOps` with **two** ops: `add_asset` then `add_clip` at `timelineStartFrame: 0` on `v1`
   (or `a1` when the kind is audio, `:279`).
5. Returns `201 {asset, op, clipId}` where `op` is `applied[0]` — the `add_asset`.

### 8. The agent turn

`edit-composer` → `edit-composer-send` → `sendAgent` (`edit-studio.tsx:426-492`) →
`POST /api/v1/edit/projects/:id/agent` with `{text, tier}`, read as SSE. The handler
(`packages/host/src/handlers/edit.ts:311-328`) calls `requireGatewayAllowed` **first** — a closed gate
is a flat `403 gateway_blocked` with no stream, exactly like Chat.

`runEditAgent` (`packages/host/src/edit/agent-run.ts:135-197`) builds a per-turn budget from
`settings.editTurnCapUsd` (`:145`) and picks a path:

- **Live** (a key is saved): `createRuntime(settings).execute(...)` with a compact project prompt
  (`compactPrompt`, `:114-124`) that includes the ffmpeg state (`ffmpegPromptLine`, `:101-112`) and
  the turn cap.
- **Stub** (no key — the state on this desk): `runStub` (`:197-361`) matches the text against
  `STUB_EDIT_SCENARIOS` (`packages/core/src/runtime/stub-edit-scenarios.ts:15-122`), then the Fill and
  Generate scenario tables, and drives the **real tools** with canned arguments. It is scripted input,
  not a scripted result.

`runStub`'s shape, in order (`agent-run.ts:204-360`):

1. No match → `assistant.delta` with the scripted help copy, `run.completed`. No card.
2. `__undo__` (S10) → scripted undo copy only. **No card, no ops** — the owner still has to press
   `edit-card-undo`.
3. `run_recipe` (F3) → `edit.plan` frame carrying a plan card.
4. S9 `clear_timeline` → invokes the tool, which refuses without `confirm: true`. No card either way.
5. A generation tool → estimate, `chargeTurnBudget`; over cap → a refusal plus an `edit.plan` card.
6. Otherwise: fill in missing ids from the doc (`:285-335`), emit `tool.started`, invoke the tool, and
   forward whatever it returned as `edit.ops` / `edit.card` / `edit.job` frames (`:337-354`).

The tool's writes go through `hostEditBackend.applyAgentOps`
(`packages/host/src/edit/backend.ts:112-145`): insert the `edit_cards` row **first**, then `appendOps`
with `actor: "agent:<runId>"` and the card id, then stamp `clip.badge = {cardId}` on the touched clips
and write a snapshot, then emit `card.updated`. The card's `verb` is mechanical — `verbFor`
(`backend.ts:51-57`) is just `ops[0].type.replaceAll("_", " ")` with the first touched clip id as the
object. That is why an S1 "Remove the silences" turn shows a card reading **`split clip · <clip id>`**
and not "Remove 3 silences": `stubEditCardCopy` is only used for the `assistant.delta` line
(`agent-run.ts:355-356`), never for the card.

### 9. Cards — Keep, Undo, Tweak, plan

`EditCards` (`apps/web/components/edit-cards.tsx:29-119`) renders, in order: the review card when the
gate is closed, then one article per card. A card is a **plan card** when its `toolKey` is
`propose_plan`, its status is `plan`, or it carries `steps` (`:25-27`) — those render as
`edit-plan-card` with `edit-plan-go`. Everything else is `edit-card`.

A card with a live job (`queued` / `running`) shows `edit-card-progress` + `edit-card-cancel`
**instead of** the three decision buttons (`:90-105`). Otherwise:

| Button | Path |
|---|---|
| `edit-card-keep` | `POST …/cards/:cardId/keep` → `keepCard(projectId, cardId, workspaceId)` (`packages/host/src/edit/undo.ts:83-100`): strip the badge, re-snapshot, status `kept`. **No ops are written.** |
| `edit-card-undo` | `POST …/undo {cardId}` → `undoCard(projectId, cardId, workspaceId)` (`undo.ts:41-80`): cancel the card's job if any, replay the ops log up to each of the card's ops, `computeInverse` for each, append the inverses as `actor: "owner"` with `undoOf`, status `undone` |
| `edit-card-tweak` | client-only — serialises the card args into `edit-composer` (`edit-studio.tsx:514-517`) |
| `edit-plan-go` | `sendAgent("Go")` (`:527-529`) |

Undo appends **forward** inverse ops; it never truncates the log. Because the inverses are `owner` ops,
they do not move `lastAgentSeq`, so undoing a card does not by itself reopen the export gate.

### 10. The review gate

Two integers on the project (`review: {lastAgentSeq, ackSeq}`) and one comparison:
`reviewGateOpen` (`packages/host/src/edit/review.ts:1-3`) and its renderer twin `isReviewOpen`
(`apps/web/lib/edit-client.ts:78-83`) both say `ackSeq >= lastAgentSeq`.

- `lastAgentSeq` only moves inside `appendOps` when the op's actor starts with `agent:`
  (`packages/host/src/edit/ops.ts:234-236`).
- `ackSeq` only moves via a `review_ack` op, which the renderer posts from two places:
  `edit-review-ok` → `onReviewOk` (`edit-studio.tsx:531-536`), and `onScrubBucket` (`:410-424`) once
  every integer-second bucket of the timeline has been visited.
- Closed gate → `EditCards` renders `edit-review-card` + `edit-review-ok`, and `edit-export` is
  disabled (`edit-studio.tsx:659`).
- The host enforces it independently: `handlePostEditExport` answers `400 review_required` when
  `reviewGateOpen` is false (`packages/host/src/handlers/edit.ts:411-415`).

### 11. Generate

`edit-generate-tab` opens `EditGenerateTab` (`apps/web/components/edit-generate-tab.tsx:47`), three
sub-tabs: `edit-generate-image`, `edit-generate-video`, `edit-generate-storyboard`. Storyboard is a
one-line placeholder (`:205-206`) — no prompt, no submit, no tier.

The model is **routed, not picked by default**: `routeEditModel({kind, tier, liveModelIds,
requireImageToVideo})` (`:86-92`) chooses from the live catalog and `edit-generate-model` only
overrides it. Seconds are snapped to the model's allow-list (`snapVideoSeconds`, `:103-105`) and the
price shown in `edit-estimate` is `estimateJobUsd` (`:107-111`), `price unknown` when the model has no
row in the price table.

`edit-prompt-templates` (`apps/web/components/edit-prompt-templates.tsx:67`) renders only on the
Video sub-tab (`edit-generate-tab.tsx:283`). 19 offline templates with cited sources
(`packages/core/src/edit/prompt-templates.json`); picking one sets the prompt **and** the seconds
through the same snap (`pickTemplate`, `:113-117`) and leaves the model alone. Typing in the prompt
clears the selection (`changePrompt`, `:119-122`), which hides `edit-prompt-template-source`.

Submit posts `POST …/generate`; the handler gates on the gateway first, validates the model/still
combination, and hands off to `startGenerateJob`
(`packages/host/src/handlers/edit.ts:539-590` → `packages/host/src/edit/start-generate.ts:156`).
A finished generate either lands a clip at `placeAt` or drops into the unplaced tray
(`edit-tray` / `edit-tray-place` / `edit-tray-discard`, `edit-cards.tsx:124-156`), which is the only
thing that populates the tray.

`edit-needs-key` is driven purely by `hasOpenai` from `GET /api/v1/settings` (plus `ready === false`
from `GET /api/v1/videos`) (`edit-studio.tsx:129-163`), and it disables `edit-generate-submit`
(`edit-generate-tab.tsx:278`).

### 12. Export

`edit-export` → `onExport` (`edit-studio.tsx:558-582`) posts `{preset: "h264-1080p"}`.
`handlePostEditExport` checks the review gate, then enqueues a `render` job and answers **202** with
the job row. The renderer stores the job id and watches the job list that arrives over the event
stream; `edit-export-progress` shows while it is live and `edit-export-download` appears on
`succeeded`, which then pulls `GET …/export/:jobId/file` and triggers a browser download
(`onDownloadExport`, `:584-608`).

The job itself runs in `packages/host/src/edit/jobs.ts:165-170` → `render`
(`packages/host/src/edit/ffmpeg/recipes.ts:221-261`): write an `.ass` document for titles and
captions, compile the concat/scale/pad filter graph (`compileFilterGraph`, `:170-195`), and run ffmpeg
into `data/edit/<projectId>/export-<uuid>.mp4` — or, for a tenant other than `local-tenant`,
`data/tenants/<tenantId>/edit/<projectId>/…` (Phase 3 lane D; see [`tenant-storage.md`](tenant-storage.md)).
Every input and output path is checked against the allow-list for that tenant and project
(`editAllowlist({ tenantId, projectId })` = that tenant's media root + that project's scratch dir, plus the
`denied` list that keeps the local tenant out of `tenants/`, `packages/host/src/edit/ffmpeg/paths.ts:63-69`).
The job runner has no request to read a tenant from, so it reads one by project id through `workerTenantId`
(`packages/host/src/edit/ops.ts:97-109`), the twin of lane A's `workerWorkspaceId`.

### Failure modes

| Failure | Where | What the user gets |
|---|---|---|
| ffmpeg missing | `resolveFfmpeg` via `getEditDoctor` | `edit-needs-ffmpeg` banner with an install command and `ffmpeg-recheck`; probe/cut/captions/export refuse |
| No gateway key | `hasOpenai` false | `edit-needs-key` in the Generate tab, `edit-generate-submit` disabled; everything else still works |
| Gateway gate closed | `requireGatewayAllowed` (`handlers/edit.ts:326`, `:546`) | flat `403 gateway_blocked`, no stream; the composer surfaces `edit.errors.agentFailed` |
| Unsupported / oversized upload | `assertEditUpload` (`handlers/edit.ts:600-607`) | `400 invalid_request` / `unsupported_content_type` |
| ffmpeg cannot read the upload | probe catch (`handlers/edit.ts:257-270`) | `400 unsupported_media`, the saved file is unlinked |
| `sourcePath` over HTTP | `handlers/edit.ts:214-217` | `400` — IPC only |
| Op invalid (duplicate id, split outside the clip) | `applyOp` (`packages/core/src/edit/ops.ts:342-551`) | server side: the append throws, `jsonError` → 400. **Renderer side: uncaught, the studio unmounts** — see Gotchas |
| Project id from another desk | `foldProject(projectId, workspaceId)` | 404 before any work |
| Job id from another project | `jobInProject` (`handlers/edit.ts:171-177`) | 404 |
| Export before review | `handlePostEditExport` (`:419-421`) | `400 review_required` (the button is already disabled) |
| ffmpeg render fails | `spawnFfmpeg` under `runFfmpeg` (`packages/host/src/edit/ffmpeg/run.ts:107-123`) | job `failed`, `error: "ffmpeg recipe failed"`, partial output unlinked. **Nothing at all in the UI** |
| ffmpeg times out / cancelled | same, `:116-121` | `ffmpeg_timeout` / `job_cancelled` |
| Turn cap exceeded | `chargeTurnBudget` (`packages/host/src/edit/budget.ts:27-39`) | a refusal plus an `edit-plan-card`; no job is queued |
| Export file requested early | `handleGetEditExportFile` (`:441-443`) | `404 not_found` "Export is not ready" |

## Where things live

| File | Role |
|---|---|
| `apps/web/components/edit-studio.tsx` | The whole shell: loads, event stream, `commitOps`, import, agent, cards, export, keyboard |
| `apps/web/components/edit-timeline.tsx` | Tracks, clips, playhead, drag / trim, `edit-zoom` |
| `apps/web/components/edit-preview.tsx` | Stage, title/caption overlays, transport, the (untestid'd) scrubber |
| `apps/web/components/edit-agent-panel.tsx` | Composer, spend meter, emit-lock line |
| `apps/web/components/edit-cards.tsx` | `edit-review-card`, `edit-plan-card`, `edit-card`, the unplaced tray |
| `apps/web/components/edit-generate-tab.tsx` | Image / Video / Storyboard, model routing, seconds snap, estimate |
| `apps/web/components/edit-prompt-templates.tsx` | The 19 cited templates, category filter, `edit-prompt-guide` |
| `apps/web/components/edit-recipes-panel.tsx` | `edit-recipe-<id>` buttons (no wrapper testid) |
| `apps/web/components/ffmpeg-setup-notice.tsx` | `edit-needs-ffmpeg` banner and its re-probe |
| `apps/web/lib/edit-client.ts` | `postEditOps`, `foldApplied`, `isReviewOpen`, `turnSpendUsd`, the API wrappers |
| `apps/web/lib/edit-badges.ts` | Which cards an owner touch auto-keeps |
| `apps/web/lib/use-emit-lock.ts` | The 5 s agent-writing lock and the clip ids it dims |
| `packages/host/src/router.ts:212-231` | The 20 `/api/v1/edit/*` routes |
| `packages/host/src/handlers/edit.ts` | Every edit handler; upload limits and mime allow-list |
| `packages/host/src/edit/ops.ts` | `appendOps`, `foldProject`, `loadProjectRow`, `writeSnapshot` — the one write path. Every one of them takes a required `workspaceId` |
| `packages/host/src/edit/projects.ts` | Create, list, bundle, `mapCard` / `mapJob` / `mapUnplaced` |
| `packages/host/src/edit/starter-media.ts` | Copies bundled starter files into the desk's media root |
| `packages/host/src/edit/agent-run.ts` | The turn: live runtime or the scripted-input stub |
| `packages/host/src/edit/backend.ts` | `EditToolBackend` — what the tools are allowed to do |
| `packages/host/src/edit/undo.ts` | `keepCard`, `undoCard` (inverse ops appended forward); both take the desk and pin the card to its project |
| `packages/host/src/edit/review.ts` | `reviewGateOpen` — two integers |
| `packages/host/src/edit/budget.ts` | Per-turn cap from `settings.editTurnCapUsd` |
| `packages/host/src/edit/jobs.ts` | Job queue, the ffmpeg runner, boot interruption. `getEditJob` / `cancelEditJob` take the project; `workerJob` is the runner's own unscoped read |
| `packages/host/src/edit/events.ts` | The project event bus and its SSE encoding |
| `packages/host/src/edit/ffmpeg/recipes.ts` | `probe`, `render`, `frameAt`, `compileFilterGraph` |
| `packages/host/src/edit/ffmpeg/paths.ts` | Scratch roots, the path allow-list, `escapeFilterPath` |
| `packages/host/src/edit/doctor.ts` | `GET /api/v1/edit/doctor` and its re-probe throttle |
| `packages/core/src/edit/ops.ts` | `applyOp` and every invariant it enforces |
| `packages/core/src/edit/fold.ts` | `foldOps` + `validateDoc` (dangling references) |
| `packages/core/src/edit/starter-media.json` | The bundled starter manifest |
| `packages/core/src/edit/prompt-templates.json` | The 19 cited video prompt templates |
| `packages/core/src/runtime/stub-edit-scenarios.ts` | S1–S10 regexes, tool keys and canned args |
| `packages/core/src/tools/edit/tools.ts` | The tool definitions the agent calls |

## Gotchas

- **An agent turn leaves a usage row against its tenant.** `rememberJobUsage`
  (`packages/host/src/edit/agent-run.ts:182`, and `:360` on the stub path) writes to
  `tenant_usage` under mode `edit`. It used to append to one global untenanted
  `desk-usage.json`. See [`tenant-usage-ledger.md`](tenant-usage-ledger.md).

- **The event stream echoes your own ops, and two call sites re-apply them.** `appendOps` emits
  `ops.appended` unconditionally (`packages/host/src/edit/ops.ts:277`) and the renderer folds every
  such frame (`apps/web/components/edit-studio.tsx:193-203`) with no dedupe. Import
  (`:302-303`) and the agent stream (`:474-479`) then apply the *same* ops a second time, `applyOp`
  throws a duplicate-id / invalid-split error out of the React state updater, and `EditStudio`
  unmounts — the studio disappears until a reload. `commitOps` (`:235-259`) escapes this only because
  it assigns a plain value instead of an updater. **Treat as a finding, not a design** (see
  `unreleased.md`). `foldApplied`'s `catch` (`apps/web/lib/edit-client.ts:219-228`) does not save you:
  its fallback loop calls `applyOp` again and rethrows.
- **`edit-parity-check` has no `onClick`** (`apps/web/components/edit-studio.tsx:652-654`). The Parity
  button is inert; `POST …/parity` and `renderParityFrame` have no caller in `apps/web`.
- **There is no `Ctrl+Z`.** The only keys the studio binds are Space/K, S, Delete/Backspace, J and L
  (`edit-studio.tsx:344-397`). Undo is `edit-card-undo`, and only on an agent card.
- **`edit-ops-count` is a session counter.** It renders `opsPosted` (`:836-838`), which counts ops this
  tab posted, not `project.seq`. It reads `ops 0` after every reload and after every starter seed.
- **The starter is seeded into the snapshot, not the log**, so a four-clip `promo-16x9` project starts
  at `ops 0` (`packages/host/src/edit/projects.ts:45-61`). Bundled files that are missing are skipped
  with a `log.warn`, never downloaded (`starter-media.ts:182-204`).
- **`edit-export` is disabled with no project**, not only when the gate is closed
  (`edit-studio.tsx:659`) — count it as three separate reasons: no project, gate closed, export in
  flight.
- **The card verb is the op type, not the scenario copy.** `verbFor`
  (`packages/host/src/edit/backend.ts:51-57`) prints `ops[0].type.replaceAll("_", " ")`, so S1 shows
  `split clip · <clip id>`. The friendly `stubEditCardCopy` string only reaches the `assistant.delta`
  line (`agent-run.ts:355-356`), which the Edit UI does not render at all.
- **A card can exist with zero ops.** `applyAgentOps` inserts the card row before `appendOps`
  (`backend.ts:110-127`) and never reconciles. A stub scenario whose canned frames fall outside the
  clip (S1's 300–1395 on a short clip, S2's 450/900 on already-split clips) produces a `proposed` card
  with `opIds: []`, and `lastAgentSeq` never moves, so the review gate stays open.
- **Undo does not reopen the review gate.** `undoCard` appends inverses as `actor: "owner"`
  (`packages/host/src/edit/undo.ts:65-69`), and only `agent:` ops move `lastAgentSeq`.
- **Keep writes no ops at all** — it strips the badge, re-snapshots and flips a status
  (`undo.ts:75-91`). "Keep" is bookkeeping, not a commit.
- **The owner touching an agent's clip silently keeps that card.** `postEditOps` collects
  `cardIdsClearedByTouch` and POSTs `/keep` for each (`apps/web/lib/edit-client.ts:250-252`,
  `edit-studio.tsx:205-209`).
- **The emit lock is unobservable on stub.** `onCard()` releases it (`apps/web/lib/use-emit-lock.ts:71-73`)
  and the stub emits `tool.started` and the card in the same tick, so `edit-emit-lock` never paints.
  Job-backed tools deliberately never take the lock at all (`use-emit-lock.ts:63-65`).
- **`escapeFilterPath` under-escapes a Windows drive letter** (`packages/host/src/edit/ffmpeg/paths.ts:71-80`).
  It emits `C\:/…`, which ffmpeg unescapes once at the filtergraph level, leaving the option parser to
  split the path on its colon. Since `render()` always attaches an `.ass` file
  (`recipes.ts:225-228`, `:189-193`) — even with no captions and no titles — **every export on Windows
  fails** with `ffmpeg recipe failed`, and `frameAt()` carries the same bug. The wire form that works
  is `C\\:/…`. **Finding, not a design.**
- **An export failure is silent.** `onExport` only shows an error when the POST is not ok
  (`edit-studio.tsx:571-575`); a job that fails later just clears `exporting` (`:618-625`).
- **There is no way back to the project list.** `edit-project-list` only renders in the `!project`
  branch (`:687-741`); switching projects needs a reload.
- **`sourcePath` import is IPC-only** (`packages/host/src/handlers/edit.ts:203-206`). Do not try the
  packaged path against `:3000`.
- **The Edit UI below the header is hardcoded English.** Only `edit-studio.tsx` calls `t`; the agent
  panel, cards, preview, timeline, generate tab, recipes and templates ship literal English while the
  matching `edit.*` keys sit unused in both locale catalogs. Testids are still locale-invariant, but
  "only the visible strings change" is not true here yet. **Finding.**
- **`edit-recipes` does not exist.** Assert `edit-recipe-<id>`; there are exactly two,
  `edit-recipe-podcast-clean-up` and `edit-recipe-reels-cutdown`.
- **`edit-generate-storyboard` exists** (the sub-tab button). `edit-storyboard-generate` and
  `edit-storyboard-animate-all` do not. `animate_storyboard` is backend-only
  (`packages/core/src/tools/edit/tools.ts`).
- **`mutatingCount > 3` in the stub is dead code** (`packages/host/src/edit/agent-run.ts:244-256`):
  the counter is incremented at most once per turn.
- **The turn cap is per request, not cumulative.** `createTurnBudget` is rebuilt on every
  `POST …/agent` (`agent-run.ts:145`), clamped to `[0.5, 50]`
  (`packages/host/src/edit/budget.ts:12-17`), and the stub charges it at most once.

## Verify

`.cursor/skills/verify-agentforge/features/edit.md` — sub-features `edit-shell`, `edit-import`,
`edit-cut`, `edit-cards`, `edit-review-gate`, `edit-titles`, `edit-generate`, `edit-keep-scenarios`,
`edit-prompt-templates`, `edit-starter-media`.

DOM testids that prove it: `edit-studio` (`apps/web/components/edit-studio.tsx:630`),
`edit-project-list` / `edit-starter` / `edit-starter-description` / `edit-project-name` /
`edit-new-project` (`:689`, `:696`, `:704`, `:712`, `:717`), `edit-tier` / `edit-jobs` /
`edit-parity-check` / `edit-export` (`:639`, `:645`, `:652`, `:658`),
`edit-export-progress` / `edit-export-download` (`:667`, `:675`), `edit-ops-count` (`:836`),
`edit-import` / `edit-generate-tab` (`:767-769`),
`edit-preview` / `edit-preview-video` / `edit-play` / `edit-time`
(`apps/web/components/edit-preview.tsx:189`, `:216`, `:246`, `:257`),
`edit-timeline` / `edit-zoom` / `edit-playhead` / `edit-track-<id>` / `edit-clip` / `edit-placeholder`
(`apps/web/components/edit-timeline.tsx:147`, `:158`, `:168`, `:174`, `:198`),
`edit-agent-panel` / `edit-spend-meter` / `edit-emit-lock` / `edit-composer` / `edit-composer-send`
(`apps/web/components/edit-agent-panel.tsx:63`, `:66`, `:71`, `:96`, `:98`),
`edit-review-card` / `edit-review-ok` / `edit-plan-card` / `edit-plan-go` / `edit-card` /
`edit-card-progress` / `edit-card-cancel` / `edit-card-keep` / `edit-card-undo` / `edit-card-tweak` /
`edit-tray` / `edit-tray-item` / `edit-tray-place` / `edit-tray-discard`
(`apps/web/components/edit-cards.tsx:44`, `:47`, `:57`, `:69`, `:78`, `:92`, `:98`, `:106`,
`:109`, `:112`, `:137`, `:141`, `:144`, `:147`),
`edit-generate` / `edit-generate-image` / `edit-generate-video` / `edit-generate-storyboard` /
`edit-needs-key` / `edit-generate-tier` / `edit-estimate` / `edit-generate-model` /
`edit-generate-seconds` / `edit-generate-still` / `edit-generate-still-clip` / `edit-generate-prompt` /
`edit-generate-submit` (`apps/web/components/edit-generate-tab.tsx:169`, `:174`, `:182`, `:190`,
`:197`, `:209`, `:221`, `:228`, `:236`, `:246`, `:258`, `:268`, `:279`),
`edit-prompt-templates` / `edit-prompt-template-categories` / `edit-prompt-template-category-<id>` /
`edit-prompt-template-list` / `edit-prompt-template-<id>` / `edit-prompt-template-source` /
`edit-prompt-guide` (`apps/web/components/edit-prompt-templates.tsx:73`, `:75`, `:80`, `:91`,
`:101`, `:114`, `:25`, `:54`),
`edit-recipe-<id>` (`apps/web/components/edit-recipes-panel.tsx:19`),
`edit-needs-ffmpeg` / `ffmpeg-install-command` / `ffmpeg-recheck` / `ffmpeg-setup-steps`
(`apps/web/components/ffmpeg-setup-notice.tsx:65`, `:74`, `:86`, `:98`),
`settings-edit-turn-cap` (`apps/web/components/settings-page.tsx:396`).

Doctor proof: `node .cursor/skills/verify-agentforge/scripts/doctor.mjs` with
`edit.ffmpeg.found: true`. Packaged proof needs `doctor.mjs --desktop`, not `:3000`.

## Why

**Why the ops log is append-only with forward inverses rather than a stack.** `[Direct]` `undoCard`
(`packages/host/src/edit/undo.ts:57-69`) replays the log prefix before each of the card's ops,
computes the inverse against that exact base, and appends the inverses as new ops with `undoOf` set —
it never deletes a row. `[Supported]` `appendOps` stores `inverseJson` on every op at write time
(`packages/host/src/edit/ops.ts:208`, `:247`) and snapshots every N ops (`:254-261`), which only makes
sense for a log meant to be replayed rather than rewound. `[Inferred]` the reason is that the owner and
the agent share one log, so a stack pop would have to decide whose change to drop; a forward inverse
keeps both histories intact and lets a card be undone out of order. **Confidence: high for the
mechanism, medium for the motive.**

**Why the review gate is two integers and not a per-card flag.** `[Direct]` `reviewGateOpen`
(`packages/host/src/edit/review.ts:1-3`) is `ackSeq >= lastAgentSeq`, and `lastAgentSeq` is written
only by `appendOps` when the actor is an agent (`ops.ts:206-208`). `[Direct]` the same rule is
duplicated in the renderer (`apps/web/lib/edit-client.ts:78-83`) so the button state and the host's
`400 review_required` (`packages/host/src/handlers/edit.ts:408-410`) cannot disagree. `[Inferred]` a
sequence comparison means *any* agent write since the last ack closes the gate, which is stricter and
much cheaper than tracking per-card acknowledgement — but it is also why an owner-actor undo does not
reopen it. **Confidence: high for the mechanism.**

**Why `sourcePath` import is refused over HTTP.** `[Direct]` `packages/host/src/handlers/edit.ts:203-206`
returns `400 "sourcePath is only valid over IPC"` when the transport header is not `ipc`. `[Inferred]`
the handler would otherwise `readFile` an arbitrary absolute path on behalf of any page that can reach
`:3000` — a local file read primitive. The IPC check is the boundary because in the packaged app the
path came from the OS file dialog (`pickMedia`), not from the page. **Confidence: high for the
mechanism, high for the motive given the shape of the check.**

**Why every ffmpeg path goes through an allow-list.** `[Direct]` `editAllowlist`
(`packages/host/src/edit/ffmpeg/paths.ts:63-69`) is that tenant's media root plus that one project's
scratch dir, and `assertInsidePath` rejects empty paths, NUL bytes, UNC/device paths and drive-relative
paths (`:82-94`) before resolving — then checks the `denied` roots before the allowed ones, which is what
stops the local tenant reaching `media/tenants/<other>/…`. `render` and `frameAt` run every input and
output through it (`recipes.ts:218`, `:224`, `:252`, `:258`). `[Inferred]` ffmpeg takes paths from a document that an agent can
write, so the allow-list is the line between "the agent edits the owner's timeline" and "the agent
names any file on the disk". **Confidence: high.**
