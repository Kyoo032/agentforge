# Education

Education is a work mode on the Default rail. A topic becomes a lesson deck the owner can edit, an exam that stays readable when the knowledge base is empty, a page read on this machine, and a presenter plan. None of these call the gateway. Map: [`docs/internal/maps/education.md`](../../../../docs/internal/maps/education.md).

## Sub-features

- `education-rail` reaches `/education` from `mode-education`.
- `education-lesson` drafts a deck (`education-lesson-topic`, `education-lesson-draft`) and mounts the same slide editor as Presentation (`presentations-edit-heading`, `presentations-add-rectangle`, `presentations-add-ellipse`, `presentations-add-text`). `education-save-deck` stores it with the presentation decks.
- `education-exam` (`education-exam-topic`, `education-exam-generate`) lists `education-exam-item`. An empty knowledge base still returns a readable item.
- `education-book` (`education-book-file`, `education-book-read`, `education-book-text`) reads a PNG page or a PDF on this machine. A scan is not sent away.
- `education-presenter` (`education-presenter-build`, `education-presenter-avatar`, `education-presenter-cue`, `education-presenter-dub`) emits placement, subtitle cues, and a dub script. It does not render a video file.

## How to get to it (user POV)

- Choose Education on the left rail (`mode-education`). Default already has the tab.
- Open `http://127.0.0.1:3000/education` when the tab is unlocked.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-education` is visible on Default.
- Stub runtime. Do not generate a Presentation or a Document as a stand-in.

- **Open Education.** Click `mode-education`. URL matches `/education`. `education-studio` and `education-tab-lesson` are visible.
- **Lesson.** Type a topic in `education-lesson-topic` and click `education-lesson-draft`. `presentations-preview` appears. Change `presentations-edit-heading` and click `presentations-add-ellipse`. Click `education-save-deck`.
- **Exam.** Click `education-tab-exam`, then `education-exam-generate`. At least one `education-exam-item` is visible, including when the desk has no indexed source.
- **Book.** Click `education-tab-book`. Set `education-book-file` to a PNG page drawn by the local face (the letters `LOCAL PAGE SCAN`) and click `education-book-read`. `education-book-text` contains those letters. A `.txt` file stays on the page with a local message and no outbound reader.
- **Presenter.** Return to the lesson tab if the deck is gone, draft again, then click `education-presenter-build`. `education-presenter-avatar`, at least one `education-presenter-cue`, and `education-presenter-dub` are visible. There is no video file.
- **Locale (id).** With the desk on `id`, the rail reads `Pendidikan` and the lesson title uses `Pelajaran`. Testids do not move.

## Gotchas

- The lesson editor is `PresentationPreview`. Its testids stay `presentations-*` on this page.
- `education-presenter-build` is on the lesson tab and again on the presenter tab. Only the active tab is mounted.
- The book reader does not use the document converter's scan refusal as the owner-facing result. A scan comes back as a local empty reading.
- Exam questions are assembled from retrieved passages, or from a fixed empty-base item. They are not graded and they are not a model paper.
- The presenter plan sets `rendered` false. Avatar motion is a placement record, not a moving picture.
