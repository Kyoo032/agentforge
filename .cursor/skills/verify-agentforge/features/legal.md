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

## Verify on webdev, then the installed app

1. Rail shows Legal; `/legal` renders the empty studio.
2. Upload `packages/core/src/docx/fixtures/lender-initial-aca-draft.docx` and `depositary-bank-round-1-redline.docx`; both appear with counters; set the redline's role to counterparty draft and the draft's role to prior turn.
3. Upload a .txt; the exact rejection message appears; nothing is added.
4. Without a key, Run shows the 503 hint. With a key, Run streams all phases, at least one round event, and lands on the results screen with non-empty Adverse provisions.
5. Download the redline; open it in Word; tracked changes are authored as the configured author with margin comments; Accept All produces the proposed language.
6. Download the deviation report; it opens in Excel with a Deviations and a Summary sheet.
7. Send to Knowledge Base creates a `Memo` source; Open in Documents prefills the Documents studio.
8. Reopen the matter from Previous matters; the last run's results load.
