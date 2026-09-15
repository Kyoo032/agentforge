# Legal

Legal is a matter job: .docx files in, position-aware review, verified deliverables out (issues memorandum, tracked-changes redline, deviation report, red-flags Markdown). v1 accepts .docx only. Live runs need a gateway key; matter intake, uploads, and role editing work without one.

## Sub-features

- `legal-rail` reaches `/legal` from `mode-legal` on Home and on the Legal preset.
- `legal-shell` shows `legal-studio` with the matter panel, the matter map, "What will happen", and previous matters.
- `legal-file-input` accepts only .docx; a .txt or .pdf shows the message "Only .docx files are accepted in v1. Convert PDF or other formats to .docx first."
- Uploading creates the matter lazily; each file appears with a role tag that cycles through the roles on click (PATCH roles).
- `legal-side` and `legal-work-type` are segmented controls; `legal-deliverable-<kind>` are checkboxes; `legal-run` stays disabled until a file is uploaded and the client party is set.
- `legal-progress` streams phases classify → diff → review n/m → missing → interactions → draft → verify (with "Round r of 3") → edit → package; `legal-cancel` stops it.
- Result tabs `legal-tab-adverse`, `legal-tab-missing`, `legal-tab-unmarked`, `legal-tab-verification`, `legal-tab-redline`, `legal-tab-memo`, `legal-tab-audit`; findings rows are `legal-finding-row`; the verification panel is `legal-verify`.
- `legal-download-<kind>` fetches `/api/v1/artifacts/:id/file` (native save on desktop).
- Stub/no-key run shows `legal-error` with a Settings hint (HTTP 503 `runtime_stub`).

## How to get to it (user POV)

- Choose Legal on the left rail (`mode-legal`). Home has the tab; the Legal preset seeds it.
- Open `http://127.0.0.1:3000/legal` when the tab is unlocked.
- Marketing / Students presets do not add this tab unless the owner checks it.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-legal` is visible on Home or on the Legal preset. If count is 0, you are on a desk that hid Legal — not a missing agent.
- Stub proof stops at intake, upload, role editing, and the run 503. Live run only if the operator asked and doctor reports `ai`.
- Packaged proof repeats the same steps in the installed app, not only on `:3000`.

- **Shell.** Rail shows Legal. `/legal` renders `legal-studio` empty, with the matter panel, the matter map, “What will happen”, and previous matters.
- **Upload.** Upload `packages/core/src/docx/fixtures/lender-initial-aca-draft.docx` and `depositary-bank-round-1-redline.docx` through `legal-file-input`. Both appear with counters. Click each role tag to cycle it (PATCH roles): the redline to counterparty draft, the draft to prior turn.
- **Wrong format.** Upload a .txt. The exact message “Only .docx files are accepted in v1. Convert PDF or other formats to .docx first.” appears and nothing is added.
- **Run without a key.** Click `legal-run`. `legal-error` shows the Settings hint (HTTP 503 `runtime_stub`).
- **Live run.** Only after doctor `ai`: `legal-progress` streams classify → diff → review n/m → missing → interactions → draft → verify (at least one “Round r of 3”) → edit → package, then lands on the results screen with a non-empty `legal-tab-adverse` (`legal-finding-row`). `legal-cancel` stops a run mid-phase.
- **Redline.** Download the redline (`legal-download-<kind>`) and open it in Word. Tracked changes are authored as the configured author with margin comments; Accept All produces the proposed language.
- **Deviation report.** Download the deviation report (`legal-download-<kind>`). It opens in Excel with a Deviations and a Summary sheet.
- **Handoff.** Send to Knowledge Base creates a `Memo` source. Open in Documents prefills the Documents studio.
- **Reopen.** Reopen the matter from Previous matters; the last run's results load.
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Perkara baru`, `Jalankan perkara` and `Perkara`. Testids are locale-invariant.

## Gotchas

- v1 accepts .docx only. A .txt or .pdf is refused with the exact sentence above — a refusal, not a crash, and nothing joins the matter.
- The matter is created **lazily** on the first upload. There is no matter row to assert before a file lands.
- `legal-run` stays disabled until a file is uploaded **and** the client party is set. A disabled Run is that gate, not a hang.
- A stub / no-key run is HTTP 503 `runtime_stub` with a Settings hint on `legal-error`, never a silent no-op.
- `legal-download-<kind>` fetches `/api/v1/artifacts/:id/file`. On desktop that is a native save, so no browser download event fires — assert the file on disk.
- `legal-side` and `legal-work-type` are segmented controls, `legal-deliverable-<kind>` are checkboxes. Do not look for a select.
- `studio.title` stays **Legal** in `id`. Do not use it as a locale proof string — use `Perkara baru` / `Jalankan perkara` / `Perkara`.
