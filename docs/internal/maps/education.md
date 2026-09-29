# Map — Education

Last verified: 2026-09-27 at c48cff7. On 2026-09-29, on the working tree over aaf249d, only the `mascot-states.ts` citations in the task-routing paragraph were re-anchored after the Nultron mascot rewrite; the rest of the page was not re-read.

Verified by [`features/education.md`](../../../.cursor/skills/verify-agentforge/features/education.md).

## Overview

Education is a product mode (`packages/core/src/agents/product-modes.ts:18`, route `/education`). The rail mounts `EducationStudio` (`apps/web/components/work-mode-keep-alive.tsx:31`, `apps/web/src/App.tsx:320`). Opening `/education` with no `task` query shows the chooser: `education-guide-lead` and four cards (`education-guide-choices`, `apps/web/components/education-studio.tsx:350`). The presenting mascot sits above the cards through `ModeIllustration` (`apps/web/components/mode-illustration.tsx:402`). A named task is `/education?task=lesson|quiz|page|show`. An unknown value resolves to the lesson (`taskFromParam`, `apps/web/lib/education-task.ts:19`). Off `/education` the studio keeps the last task (`lastTaskRef`, `education-studio.tsx:127`) so a hidden pane does not flash the chooser.

The rail chevron is `education-tasks-toggle` on `rail-education-mode` (`apps/web/components/app-rail.tsx:262`). It starts closed. The rows are `education-task-lesson`, `education-task-quiz`, `education-task-page`, and `education-task-show` (`apps/web/components/rail-education-tasks.tsx:42`). The visible word is `tasks` / `tugas`. More does not switch tasks. The five skills are registered on the education harness (`packages/core/src/harness/mode-skills.ts:170`). Draft copy and the page face live in `packages/university`. Kernel tables are unchanged.

None of the four routes call the gateway (`packages/host/src/router.ts:359-362`).

## How it works

### Chooser and the rail

`useRailEducationTasks` (`rail-education-tasks.tsx:11`) is `useRailSubmenu("/education")`. The chevron only shows and hides. Each row links to `educationTaskHref` (`education-task.ts:24`). The studio reads `searchParams.get("task")` (`education-studio.tsx:124`). An empty query is the chooser (`:125`). Any other value, including one the catalog does not know, is a task page, and `taskFromParam` still resolves the unknown value to `lesson`. `education-guide-change` (`:380`) links back to `/education` with no query. Quiz's empty desk passes `phase="verifying"` (`:454`), which the mascot map draws as reviewing. A page passes `phase="reading"` (`:462`), which draws as searching. Show and the lesson pass no phase, so they stay on the education home pose, presenting (`MASCOT_MODE_HOME.education`, `apps/web/lib/mascot-states.ts:118`; `PHASE_STATE` `verifying` `:133` and `reading` `:121`).

### Lesson deck

`POST /api/v1/education/lesson` (`packages/host/src/handlers/education.ts:24`) calls `draftLesson` with `localeForRun()`. The topic box is `education-lesson-topic` (`apps/web/components/education-studio.tsx:282`) and Create is `education-lesson-draft` (`:289`). The studio parses the outline and mounts `PresentationPreview` with `variant="simple"` (`:402`). That hides the permanent shape toolbar and the properties column. Add-shape buttons render into More through `toolsHost` (`:588`). A selected shape shows `presentations-selection-toolbar` on the slide. Clicking a heading still edits `presentations-edit-heading`. `education-save-deck` (`:543`) posts that outline to the presentation deck store. Create moves into More once the lesson is up. The lesson draft stays in memory when the reader switches tasks, so Show can use it.

### Quiz

`POST /api/v1/education/exam` (`packages/host/src/handlers/education.ts:34`) calls `retrieveChunks` (`:41`) and `draftExam`. A failure or an empty base still returns one readable item. The quiz is `?task=quiz`. Its first screen is one topic (`education-exam-topic`, `:306`) and Create (`education-exam-generate`, `:313`), with the reviewing mascot (`education-exam-empty`, `:453`). The page then draws `education-exam-sheet` (`:420`): numbered `education-exam-item` (`:425`), lettered `education-exam-choice` (`:434`), and `education-exam-answer` (`:444`).

### A page

A page is `?task=page`. `POST /api/v1/education/book` (`packages/host/src/handlers/education.ts:53`) reads the uploaded file with `readBookFile` (`packages/host/src/education/read-book.ts:26`). A PNG goes through `readPagePng` (`packages/university/src/education/page-face.ts:205`). A PDF uses the existing local text-layer reader. A scan the reader refuses comes back as a local empty result. The file input is `education-book-file` (`education-studio.tsx:506`), Read is `education-book-read` (`:514`), and the result is `education-book-text` (`:467`). The empty desk uses the searching pose.

### Show

Show is `?task=show`. With a lesson and no plan yet, the only primary button is `education-presenter-build` (`:525`). Without a lesson, the empty desk (`education-presenter-empty`, `:484`) says to create one, and the mascot is presenting. `POST /api/v1/education/presenter` (`packages/host/src/handlers/education.ts:67`) calls `draftPresenter`. The response carries avatar placements, subtitle cues, and `dubScript`, with `rendered` false. `PresenterStage` (`apps/web/components/education-studio.tsx:60`) draws `education-presenter-stage` (`:77`) with the avatar absolutely positioned (`education-presenter-avatar`, `:86`) and the current line (`education-presenter-cue`, `:101`). The avatar does not print its motion name or coordinates. Line picks and the spoken script (`education-presenter-dub`, `:580`) sit in More. After a plan exists, the same `education-presenter-build` testid is the quiet button inside More (`:556`). The stage bar and avatar use `--mode`. No video file is written.
