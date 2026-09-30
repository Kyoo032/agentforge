# Education

Education is a work mode on the Default rail. Opening it with no task shows four plain cards: Lesson, Quiz, A page, and Show. The rail chevron (`education-tasks-toggle`, word `tasks` / `tugas`) lists the same four and starts closed. Each task is `/education?task=`. An unknown task is the lesson. The lesson that appears is edited by clicking words on the slide. Save and shape tools sit in More (`education-more`). A selected shape gets a small toolbar on the slide. None of these call the gateway. The chooser keeps the presenting mascot. Map: [`docs/internal/maps/education.md`](../../../../docs/internal/maps/education.md).

## Sub-features

- `education-rail` reaches `/education` from `mode-education`. The row is wrapped in `rail-education-mode` and carries `education-tasks-toggle`. On `/education` the chevron can open `rail-education-tasks` with four rows: `education-task-lesson`, `education-task-quiz`, `education-task-page`, `education-task-show`. Off `/education` the chevron is `disabled` and `aria-expanded="false"`. The list starts closed, including on Education itself.
- `education-chooser` is `/education` with no `task` query. `education-guide-lead` reads "What do you want to do?" (`Anda ingin melakukan apa?` on `id`). `education-guide-choices` holds `education-guide-lesson`, `education-guide-quiz`, `education-guide-page`, and `education-guide-show`, each a label and one line. The presenting mascot is on this screen. `education-guide-change` on a task screen returns here.
- `education-lesson` is `?task=lesson`, also the screen for an unknown task. There is no empty mascot card. The topic field is `education-lesson-topic` and Create is `education-lesson-draft`. The prompt strip is sticky at the top of the task until a deck exists. Drafting mounts the simple Presentation stage (`presentations-editor`, `presentations-edit-heading`). There is no permanent `presentations-shape-toolbar` and no `presentations-properties`. Add-shape buttons are in More. Fill, stroke, duplicate, and delete appear on `presentations-selection-toolbar` only while a shape is selected. Arrow keys nudge by 1 percent. `education-save-deck` is in More and stores the deck with the presentation decks.
- `education-exam` is `?task=quiz`. The first screen is the topic field `education-exam-topic` and `education-exam-generate`. There is no `education-exam-empty`. The sheet is `education-exam-sheet`: numbered `education-exam-item`, lettered `education-exam-choice`, and `education-exam-answer`. An empty knowledge base still returns a readable item.
- `education-book` is `?task=page` (`education-book-file`, `education-book-read`, `education-book-text`). The empty desk uses the searching mascot. It reads a PNG page or a PDF on this machine. A scan is not sent away.
- `education-presenter` is `?task=show`. There is no `education-presenter-empty`. With a lesson open, `education-presenter-build` is the one primary button until the stage appears. Then `education-presenter-stage` shows the avatar (`education-presenter-avatar`) and the current line (`education-presenter-cue`). Line picks (`education-presenter-cue-pick`) and the spoken script (`education-presenter-dub`) are in More. It does not render a video file.

## How to get to it (user POV)

- Choose Education on the left rail (`mode-education`). A desk that already has it shows the tab. A fresh first-run desk starts with Research, Images, Videos and Presentation only, so turn this one on first (Workspaces, Edit on the desk). With no task chosen, the four cards are the first thing on the page.
- Open a task from a card, or open the rail word `tasks` and pick a row.
- Open `http://127.0.0.1:3000/education` when the tab is unlocked. `?task=quiz` opens the quiz. `?task=nope` opens the lesson.

## Driving it with the Nultron harness

Preconditions:

- Doctor exits 0.
- `mode-education` is visible on Default.
- Stub runtime. Do not generate a Presentation or a Document as a stand-in.

- **Chooser.** Click `mode-education`. URL matches `/education` with no `task`. `education-guide-choices` has four links. `education-lesson-topic` is not visible. `education-tasks-toggle` is enabled, `aria-expanded="false"`, and its visible word is `tasks`. `rail-education-tasks` has count 0 until the chevron is pressed.
- **Rail.** Press `education-tasks-toggle`. Four rows appear: `education-task-lesson`, `education-task-quiz`, `education-task-page`, `education-task-show`. Press it again and the rows go away while you stay on `/education`.
- **Lesson.** Open `education-guide-lesson` or `education-task-lesson`. URL contains `task=lesson`. `education-lesson-topic` and `education-lesson-draft` are visible. `education-lesson-empty` and `education-hint` count 0. There is no `education-tab-lesson`. Type a topic and click `education-lesson-draft`. `presentations-editor` and `presentations-filmstrip` appear. `presentations-shape-toolbar` is not inside `presentations-editor`. Open a content slide and change `presentations-edit-heading`. Open More and click `presentations-add-ellipse`. Select the shape: `presentations-selection-toolbar` shows. ArrowRight nudges `data-x` by 1. `presentations-shape-duplicate` copies it. Delete removes the copy. Click `education-save-deck`. `education-deck-saved` appears.
- **Quiz.** Open `?task=quiz` (card `education-guide-quiz` or row `education-task-quiz`). `education-exam-topic` is visible. Click `education-exam-generate` (the topic can already be filled). `education-exam-sheet` shows at least one numbered `education-exam-item`, lettered `education-exam-choice` rows, and `education-exam-answer`, including when the desk has no indexed source.
- **A page.** Open `?task=page`. Set `education-book-file` to a PNG page drawn by the local face (the letters `LOCAL PAGE SCAN`) and click `education-book-read`. `education-book-text` contains those letters. A `.txt` file stays on the page with a local message and no outbound reader.
- **Show.** With the lesson deck still open, open `?task=show`, then `education-presenter-build`. `education-presenter-stage` shows `education-presenter-avatar` and one `education-presenter-cue`. Open More: `education-presenter-dub` is there. There is no video file. The avatar does not show a motion name. `education-guide-change` returns to the chooser.
- **Unknown task.** Open `/education?task=nope`. The lesson screen is showing (`education-lesson-topic`), not the chooser and not an error.
- **Locale (id).** With the desk on `id`, the rail reads `Pendidikan`, the chevron word is `tugas`, the chooser lead is `Anda ingin melakukan apa?`, and Create reads `Buat`. Testids do not move.

## Gotchas

- The lesson editor is `PresentationPreview` with `variant="simple"`. Its testids stay `presentations-*` on this page. Shape tools and save are inside `education-more-details`, which stays open after a click because the `<details>` element is not remounted.
- `education-presenter-build` is the primary button on Show until a plan exists, and only when a lesson is already in memory. After that, the same testid is the quiet button inside More. Only one of them is mounted. Switching away from Show does not drop the lesson.
- The book reader does not use the document converter's scan refusal as the owner-facing result. A scan comes back as a local empty reading.
- Exam questions are assembled from retrieved passages, or from a fixed empty-base item. They are not graded and they are not a model paper.
- The presenter plan sets `rendered` false. Avatar motion is a placement record (`data-motion`), not a moving picture.
- The chevron starts closed on `/education` itself. Leaving Education forgets that it was open. Nothing about it is stored.
- A hidden Education pane (keep-alive) is not the chooser just because the visible route has no `task` query. The studio keeps the last task until `/education` is showing again.
