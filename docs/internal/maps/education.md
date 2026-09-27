# Map — Education

Last verified: 2026-09-27 at 1365aa2

Verified by [`features/education.md`](../../../.cursor/skills/verify-agentforge/features/education.md).

## Overview

Education is a product mode (`packages/core/src/agents/product-modes.ts:18`, route `/education`). The rail mounts `EducationStudio` (`apps/web/components/work-mode-keep-alive.tsx:31`, `apps/web/src/App.tsx:320`). The studio opens with `data-mode="education"` and `ModeHeader` (`apps/web/components/education-studio.tsx:302`, `:304`). The empty lesson shows the presenting mascot through `ModeIllustration` (`apps/web/components/mode-illustration.tsx:278`, `education-lesson-empty` at `education-studio.tsx:339`) and one hint (`education-hint`, `:341`). The first screen is that hint, one topic box, Create, and More. Quiz, a page, show, and save sit in More (`education-more`, `:465`). The five skills are registered on the education harness (`packages/core/src/harness/mode-skills.ts:170`). Draft copy and the page face live in `packages/university`. Kernel tables are unchanged.

None of the four routes call the gateway (`packages/host/src/router.ts:359-362`).

## How it works

### Lesson deck

`POST /api/v1/education/lesson` (`packages/host/src/handlers/education.ts:24`) calls `draftLesson` with `localeForRun()`. The topic box is `education-lesson-topic` (`apps/web/components/education-studio.tsx:262`) and Create is `education-lesson-draft` (`:269`). The studio parses the outline and mounts `PresentationPreview` with `variant="simple"` (`:327`). That hides the permanent shape toolbar and the properties column. Add-shape buttons render into More through `toolsHost` (`:534`). A selected shape shows `presentations-selection-toolbar` on the slide. Clicking a heading still edits `presentations-edit-heading`. `education-save-deck` (`:489`) posts that outline to the presentation deck store. Create moves into More once the lesson is up.

### Exam

`POST /api/v1/education/exam` (`packages/host/src/handlers/education.ts:34`) calls `retrieveChunks` (`:41`) and `draftExam`. A failure or an empty base still returns one readable item. The quiz is behind More (`education-tab-exam`, the tab row at `:470`). Its first screen is one topic (`education-exam-topic`, `:286`) and Create (`education-exam-generate`, `:293`). The page then draws `education-exam-sheet` (`:352`): numbered `education-exam-item` (`:357`), lettered `education-exam-choice` (`:366`), and `education-exam-answer` (`:376`).

### Book

A page is behind More (`education-tab-book`). `POST /api/v1/education/book` (`packages/host/src/handlers/education.ts:53`) reads the uploaded file with `readBookFile` (`packages/host/src/education/read-book.ts:26`). A PNG goes through `readPagePng` (`packages/university/src/education/page-face.ts:205`). A PDF uses the existing local text-layer reader. A scan the reader refuses comes back as a local empty result. The file input is `education-book-file` (`education-studio.tsx:438`), Read is `education-book-read` (`:446`), and the result is `education-book-text` (`:399`).

### Presenter

Show is behind More (`education-tab-presenter`). With a lesson and no plan yet, the only primary button is `education-presenter-build` (`:457`). `POST /api/v1/education/presenter` (`packages/host/src/handlers/education.ts:67`) calls `draftPresenter`. The response carries avatar placements, subtitle cues, and `dubScript`, with `rendered` false. `PresenterStage` (`apps/web/components/education-studio.tsx:53`) draws `education-presenter-stage` (`:70`) with the avatar absolutely positioned (`education-presenter-avatar`, `:79`) and the current line (`education-presenter-cue`, `:94`). The avatar does not print its motion name or coordinates. Line picks and the spoken script (`education-presenter-dub`, `:526`) sit in More. The stage bar and avatar use `--mode`. No video file is written.
