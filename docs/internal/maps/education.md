# Map — Education

Last verified: 2026-09-28

Verified by [`features/education.md`](../../../.cursor/skills/verify-agentforge/features/education.md).

## Overview

Education is a product mode (`packages/core/src/agents/product-modes.ts:18`, route `/education`). The rail mounts `EducationStudio` (`apps/web/components/work-mode-keep-alive.tsx:32`, `apps/web/src/App.tsx:321`). Opening `/education` with no `task` query shows the chooser: `education-guide-lead` and four cards (`education-guide-choices`, `apps/web/components/education-studio.tsx:345`). The presenting mascot sits above the cards through `ModeIllustration` (`apps/web/components/mode-illustration.tsx:402`). A named task is `/education?task=lesson|quiz|page|show`. An unknown value resolves to the lesson (`taskFromParam`, `apps/web/lib/education-task.ts:19`). Off `/education` the studio keeps the last task (`lastTaskRef`, `education-studio.tsx:117`) so a hidden pane does not flash the chooser.

The rail chevron is `education-tasks-toggle` on `rail-education-mode` (`apps/web/components/app-rail.tsx:262`). It starts closed. The rows are `education-task-lesson`, `education-task-quiz`, `education-task-page`, and `education-task-show` (`apps/web/components/rail-education-tasks.tsx:42`). The visible word is `tasks` / `tugas`. More does not switch tasks. The five skills are named on the education harness (`packages/core/src/harness/mode-skills.ts:170`) and run in `packages/host/src/education/harness.ts`. Draft copy and the page face live in `packages/university`. Kernel tables are unchanged.

None of the four routes call the gateway (`packages/host/src/router.ts:359-362`). Each route takes `localeForRun()` and `withOutputLanguage` (`educationBrief`, `packages/host/src/education/harness.ts:49-53`).

## How it works

### Chooser and the rail

`useRailEducationTasks` (`rail-education-tasks.tsx:11`) is `useRailSubmenu("/education")`. The chevron only shows and hides. Each row links to `educationTaskHref` (`education-task.ts:24`). The studio reads `searchParams.get("task")` (`education-studio.tsx:114`). An empty query is the chooser. Any other value, including one the catalog does not know, is a task page, and `taskFromParam` still resolves the unknown value to `lesson`. `education-guide-change` (`education-studio.tsx:370`) links back to `/education` with no query. The mascot is on the chooser. A task screen is the topic or the file, plus one primary button, with save and shape tools in More.

### Harness

`withOneRetry` (`harness.ts:56`) drafts, checks, and retries once. A second failure is repaired by the fixed draft, and that repair is not a third attempt. The lesson, the quiz, and the show use it. Changing a slide (`runLessonEdit`, `:106`) and reading a page (`runBookRead`, `:204`) check once and do not retry. A page retry is the place a scan could be sent away, and this path does not do that.

### Lesson deck

`POST /api/v1/education/lesson` (`packages/host/src/handlers/education.ts:25`) calls `runTeachingDeck`. The check is `lessonShapeOk` (`packages/university/src/education/checks.ts:16`): a title and four slides (aim, example, self-check, close), each with a heading, a bullet, and notes. The topic box is `education-lesson-topic` (`education-studio.tsx:272`) and Create is `education-lesson-draft` (`:279`). The studio parses the outline and mounts `PresentationPreview` with `variant="simple"` (`:385`). That hides the permanent shape toolbar and the properties column. Add-shape buttons render into More through `toolsHost` (`:393`). A selected shape shows `presentations-selection-toolbar` on the slide. Clicking a heading still edits `presentations-edit-heading`. `runLessonEdit` applies one heading change and one shape and checks the other slides are unchanged. `education-save-deck` (`:514`) posts that outline to the presentation deck store. The lesson draft stays in memory when the reader switches tasks, so Show can use it.

### Quiz

`POST /api/v1/education/exam` (`handlers/education.ts:36`) calls `retrieveChunks` (`:43`) and `passagesFromKnowledge` (`harness.ts:127`), which keeps a chunk only when it has a Knowledge `sourceId`. `runExamFromKnowledge` drafts, then `examCitationsOk` (`checks.ts:34`) requires each item's `sourceId` to be one of those ids and the quoted sentence to be in that source. A citation that fails is retried once, then rebuilt from the passages. A failure or an empty base still returns one readable item with an empty `sourceId` and an empty citation. The quiz is `?task=quiz`. Its first screen is one topic (`education-exam-topic`, `education-studio.tsx:296`) and Create (`education-exam-generate`, `:303`). The page then draws `education-exam-sheet` (`:403`): numbered `education-exam-item` (`:408`), lettered `education-exam-choice` (`:417`), `education-exam-answer` (`:427`), and the citation line when one is set (`:430`).

### A page

A page is `?task=page`. `POST /api/v1/education/book` (`handlers/education.ts:61`) calls `runBookRead`, which reads the uploaded file with `readBookFile` (`packages/host/src/education/read-book.ts:26`). A PNG goes through `readPagePng` (`packages/university/src/education/page-face.ts:205`). A PDF uses the existing local text-layer reader. A scan the reader refuses comes back as a local empty result. `bookReadStaysLocal` (`checks.ts:90`) keeps only `text-layer`, `local-ocr`, `local-ocr-empty`, and `unsupported`. The file input is `education-book-file` (`education-studio.tsx:477`), Read is `education-book-read` (`:485`), and the result is `education-book-text` (`:443`).

### Show

Show is `?task=show`. With a lesson and no plan yet, the only primary button is `education-presenter-build` (`education-studio.tsx:496`). Without a lesson that button is not mounted. `POST /api/v1/education/presenter` (`handlers/education.ts:75`) calls `runPresenter`. `presenterPlanOk` (`checks.ts:70`) requires `rendered` false and every cue to be the next spoken line of a slide (`presenterSpokenLines`, `packages/university/src/education/draft.ts:235`). A line that is not on a slide is retried once, then rebuilt from the lesson. `PresenterStage` (`education-studio.tsx:60`) draws `education-presenter-stage` (`:76`) with the avatar absolutely positioned (`education-presenter-avatar`, `:85`) and the current line (`education-presenter-cue`, `:100`). The avatar does not print its motion name or coordinates. Line picks and the spoken script (`education-presenter-dub`, `:551`) sit in More. After a plan exists, the same `education-presenter-build` testid is the quiet button inside More (`:527`). No video file is written.
