# Map — Education

Last verified: 2026-09-25 at b4e8110

Verified by [`features/education.md`](../../../.cursor/skills/verify-agentforge/features/education.md).

## Overview

Education is a product mode (`packages/core/src/agents/product-modes.ts:18`, route `/education`). The rail mounts `EducationStudio` (`apps/web/components/work-mode-keep-alive.tsx:31`, `apps/web/src/App.tsx:320`). The five skills are registered on the education harness (`packages/core/src/harness/mode-skills.ts:170`). Draft copy and the page face live in `packages/university`. Kernel tables are unchanged.

None of the four routes call the gateway (`packages/host/src/router.ts:349`).

## How it works

### Lesson deck

`POST /api/v1/education/lesson` (`packages/host/src/handlers/education.ts:24`) calls `draftLesson` with `localeForRun()`. The studio parses the outline and mounts `PresentationPreview` (`apps/web/components/education-studio.tsx:272`), so text edits and rectangle, ellipse, and text marks are the same controls as Presentation. `education-save-deck` posts that outline to the presentation deck store.

### Exam

`POST /api/v1/education/exam` (`packages/host/src/handlers/education.ts:34`) calls `retrieveChunks` (`:41`) and `draftExam`. A failure or an empty base still returns one readable item. The page lists `education-exam-item`.

### Book

`POST /api/v1/education/book` (`packages/host/src/handlers/education.ts:53`) reads the uploaded file with `readBookFile` (`packages/host/src/education/read-book.ts:26`). A PNG goes through `readPagePng` (`packages/university/src/education/page-face.ts:205`). A PDF uses the existing local text-layer reader. A scan the reader refuses comes back as a local empty result. The page shows `education-book-text`.

### Presenter

`POST /api/v1/education/presenter` (`packages/host/src/handlers/education.ts:67`) calls `draftPresenter`. The response carries avatar placements, subtitle cues, and `dubScript`, with `rendered` false. The page shows `education-presenter-avatar`, `education-presenter-cue`, and `education-presenter-dub`. No video file is written.
