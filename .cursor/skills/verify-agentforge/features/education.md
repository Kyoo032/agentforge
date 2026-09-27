# Education

Education is a work mode on the Default rail. The first screen is one lesson topic and Create. The lesson that appears is edited by clicking words on the slide. Quiz, a page, show, save, and shape tools sit in More (`education-more`). A selected shape gets a small toolbar on the slide. None of these call the gateway. The empty lesson keeps the presenting mascot. Map: [`docs/internal/maps/education.md`](../../../../docs/internal/maps/education.md).

## Sub-features

- `education-rail` reaches `/education` from `mode-education`.
- `education-shell` shows `education-studio`. An empty desk shows `education-lesson-empty` (the presenting mascot) and one line `education-hint`. Visible controls beside the topic are Create (`education-lesson-draft`) and More (`education-more`). `education-tab-lesson`, `education-tab-exam`, `education-tab-book`, and `education-tab-presenter` are inside More.
- `education-lesson` drafts a deck (`education-lesson-topic`, `education-lesson-draft`) and mounts the simple Presentation stage (`presentations-editor`, `presentations-edit-heading`). There is no permanent `presentations-shape-toolbar` and no `presentations-properties`. Add-shape buttons are in More. Fill, stroke, duplicate, and delete appear on `presentations-selection-toolbar` only while a shape is selected. Arrow keys nudge by 1 percent. `education-save-deck` is in More and stores the deck with the presentation decks.
- `education-exam` is the Quiz row in More. Its first screen is `education-exam-topic` and `education-exam-generate`. The sheet is `education-exam-sheet`: numbered `education-exam-item`, lettered `education-exam-choice`, and `education-exam-answer`. An empty knowledge base still returns a readable item.
- `education-book` is the page row in More (`education-book-file`, `education-book-read`, `education-book-text`). It reads a PNG page or a PDF on this machine. A scan is not sent away.
- `education-presenter` is the Show row in More. With a lesson open, `education-presenter-build` is the one primary button until the stage appears. Then `education-presenter-stage` shows the avatar (`education-presenter-avatar`) and the current line (`education-presenter-cue`). Line picks (`education-presenter-cue-pick`) and the spoken script (`education-presenter-dub`) are in More. It does not render a video file.

## How to get to it (user POV)

- Choose Education on the left rail (`mode-education`). Default already has the tab.
- Open `http://127.0.0.1:3000/education` when the tab is unlocked.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-education` is visible on Default.
- Stub runtime. Do not generate a Presentation or a Document as a stand-in.

- **Open Education.** Click `mode-education`. URL matches `/education`. `education-studio`, `education-lesson-empty`, `education-hint`, and `education-lesson-topic` are visible. `education-tab-lesson` is not visible until More is opened. `presentations-engine` count is 0.
- **Lesson.** Type a topic in `education-lesson-topic` and click `education-lesson-draft`. `presentations-editor` and `presentations-filmstrip` appear. `presentations-shape-toolbar` is not inside `presentations-editor`. Open a content slide and change `presentations-edit-heading`. Open More and click `presentations-add-ellipse`. Select the shape: `presentations-selection-toolbar` shows. ArrowRight nudges `data-x` by 1. `presentations-shape-duplicate` copies it. Delete removes the copy. Click `education-save-deck`. `education-deck-saved` appears.
- **Exam.** Open More, click `education-tab-exam`, then `education-exam-generate` (the topic can already be filled). `education-exam-sheet` shows at least one numbered `education-exam-item`, lettered `education-exam-choice` rows, and `education-exam-answer`, including when the desk has no indexed source.
- **Book.** Open More and click `education-tab-book`. Set `education-book-file` to a PNG page drawn by the local face (the letters `LOCAL PAGE SCAN`) and click `education-book-read`. `education-book-text` contains those letters. A `.txt` file stays on the page with a local message and no outbound reader.
- **Presenter.** With the lesson deck still open, open More, click `education-tab-presenter`, then `education-presenter-build`. `education-presenter-stage` shows `education-presenter-avatar` and one `education-presenter-cue`. Open More: `education-presenter-dub` is there. There is no video file. The avatar does not show a motion name.
- **Locale (id).** With the desk on `id`, the rail reads `Pendidikan`, More reads `Lainnya`, and Create reads `Buat`. Testids do not move.

## Gotchas

- The lesson editor is `PresentationPreview` with `variant="simple"`. Its testids stay `presentations-*` on this page. Shape tools and save are inside `education-more-details`, which stays open after a click because the `<details>` element is not remounted.
- `education-presenter-build` is the primary button on Show until a plan exists. After that, the same testid is the quiet button inside More. Only one of them is mounted.
- The book reader does not use the document converter's scan refusal as the owner-facing result. A scan comes back as a local empty reading.
- Exam questions are assembled from retrieved passages, or from a fixed empty-base item. They are not graded and they are not a model paper.
- The presenter plan sets `rendered` false. Avatar motion is a placement record (`data-motion`), not a moving picture.
