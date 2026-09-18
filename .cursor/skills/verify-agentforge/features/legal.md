# Legal

Legal is a matter job: .docx files in, position-aware review, verified deliverables out (issues memorandum, tracked-changes redline, deviation report, red-flags Markdown). v1 accepts .docx only. Live runs need a gateway key; matter intake, uploads, and role editing work without one.

## Sub-features

- `legal-rail` reaches `/legal` from `mode-legal` on Home and on the Legal preset.
- `legal-shell` shows `legal-studio` with the matter panel, the matter map, "What will happen", and previous matters.
- `legal-file-input` accepts only .docx; a .txt or .pdf shows the message "Only .docx files are accepted in v1. Convert PDF or other formats to .docx first."
- The first upload **attempt** creates the matter lazily — including an attempt that is refused, so a `.txt`-only drop leaves an empty matter behind. Each accepted file appears with a role tag that cycles through the roles on click; the click sends `PATCH /api/v1/legal/matters/:matterId` with a `roles` array, not a per-file route.
- `legal-side` and `legal-work-type` are segmented controls; `legal-deliverable-<kind>` are checkboxes; `legal-run` stays disabled until a file is uploaded and the client party is set.
- `legal-progress` streams phases classify → diff → review n/m → missing → interactions → draft → verify (with "Round r of 3") → edit → package; `legal-cancel` stops it.
- Result tabs `legal-tab-adverse`, `legal-tab-missing`, `legal-tab-unmarked`, `legal-tab-verification`, `legal-tab-redline`, `legal-tab-memo`, `legal-tab-audit`; findings rows are `legal-finding-row`; the verification panel is `legal-verify`.
- `legal-download-<kind>` fetches `/api/v1/artifacts/:id/file` (native save on desktop).
- Stub/no-key run shows `legal-error`. The studio posts `/api/v1/legal/matters/:id/run/stream`, so the response is **HTTP 200 `text/event-stream`** and the failure arrives as the stream's single `job.error` frame, `{ code: "runtime_stub", status: 503 }` — see SKILL.md **Harness-wide gotchas** G2. Do not assert a 503 on the response.
- Matter form fields beyond the party: `legal-matter-title`, `legal-side-counterparty`, `legal-side-role-other` (only when the side is "other"), `legal-playbook`, `legal-author`, `legal-addressee`, `legal-firm`, `legal-instructions`. The panel itself is `legal-matter-panel`.
- `legal-deliverable-executive-summary` renders but is **disabled** (`available: false`, `apps/web/lib/legal-view.ts:83-94`; the `id` label reads "belum tersedia pada versi ini"). The four selectable kinds are `issues-memo`, `redline`, `deviation-report`, `red-flags`.
- File rows carry `legal-file-role-<docId>` (cycle) and `legal-file-remove-<docId>` (remove); the drop target is `legal-drop-zone`, the list is `legal-file-list` and each row is `legal-file-row`.
- The right column is three panels: `legal-matter-map` (rows `legal-matter-map-row`), `legal-plan` ("what will happen"), and `legal-previous` (rows `legal-previous-row`, each with `legal-open-<matterId>`). Model pickers are `legal-studio-model` and `legal-studio-verifier-model`.
- `legal-reopen` is a `<select>` that renders only when at least one matter exists.
- The running screen adds `legal-round`, `legal-documents` and the `JobProgressList` internals `legal-progress-round` / `legal-progress-phase` / `legal-progress-sources`.
- The result screen adds `legal-result-headline`, `legal-new-matter`, `legal-next-turn`, `legal-findings`, `legal-findings-stream`, `legal-memo`, `legal-memo-text`, `legal-redline`, `legal-redline-row`, `legal-audit`, `legal-handoff`, the per-row `legal-verify-<key>`, and the shared `ArtifactActions` set (`legal-actions`, `legal-download`, `legal-send-kb`, `legal-make-document`, `legal-make-presentation`, `legal-actions-note`).
- `legal-studio` carries `data-screen` = `new` | `running` | `result` (`apps/web/components/legal-studio.tsx:252`, `:256`) — the cheapest assertion for which screen is up.
- Matter deletion is `DELETE /api/v1/legal/matters/:matterId`. **There is no UI control and no testid for it** — see [Gotchas](#gotchas). Use it to clean up after a drive.

## How to get to it (user POV)

- Choose Legal on the left rail (`mode-legal`). Home has the tab; the Legal preset seeds it.
- Open `http://127.0.0.1:3000/legal` when the tab is unlocked.
- Marketing / Students presets do not add this tab unless the owner checks it.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-legal` is visible on Home or on the Legal preset. If count is 0, you are on a desk that hid Legal — not a missing agent.
- Stub proof stops at intake, upload, role editing, and the refused run. Live run only if the operator asked and doctor reports `ai`.
- Nine of the ten legal routes never reach the gateway (`packages/host/src/handlers/legal.ts:114`). Intake, upload, role editing, delete and playbooks are fully driveable on a keyless desk; only `run/stream` needs a key.
- Packaged proof repeats the same steps in the installed app, not only on `:3000`.

- **Shell.** Rail shows Legal. `/legal` renders `legal-studio` empty, with the matter panel, the matter map, “What will happen”, and previous matters.
- **Upload.** Upload `packages/core/src/docx/fixtures/lender-initial-aca-draft.docx` and `depositary-bank-round-1-redline.docx` through `legal-file-input`. Both appear with counters. Click each role tag to cycle it (PATCH roles): the redline to counterparty draft, the draft to prior turn.
- **Wrong format.** Upload a .txt. The exact message “Only .docx files are accepted in v1. Convert PDF or other formats to .docx first.” appears in `legal-error`, `legal-file-row` stays at its previous count, and **no `POST /files` reaches the host** — the check is client-side (`apps/web/lib/legal-client.ts:309-311`). The sentence is hardcoded English even on an `id` desk; see [Gotchas](#gotchas).
- **Cleanup (mandatory on a shared desk).** The drive leaves a matter behind, and a refused upload leaves one too. Read the id from `GET /api/v1/legal/matters`, then `DELETE /api/v1/legal/matters/:matterId` (expect `200 {"ok":true}`), reload `/legal` and confirm `legal-reopen` and `legal-previous-row` are back to count 0 and `<dataDir>/legal/<workspaceId>/<matterId>/` is gone.
- **Run without a key.** Click `legal-run`. The wire shows `PATCH /api/v1/legal/matters/:id` (save-before-run) then `POST /api/v1/legal/matters/:id/run/stream` → **200**, and `legal-error` carries the stub copy. `legal-progress` and `legal-cancel` stay at count 0 and `legal-studio` keeps `data-screen="new"` — the run never reaches the running screen.
- **Live run.** Only after doctor `ai`: `legal-progress` streams classify → diff → review n/m → missing → interactions → draft → verify (at least one “Round r of 3”) → edit → package, then lands on the results screen with a non-empty `legal-tab-adverse` (`legal-finding-row`). `legal-cancel` stops a run mid-phase.
- **Redline.** Download the redline (`legal-download-<kind>`) and open it in Word. Tracked changes are authored as the configured author with margin comments; Accept All produces the proposed language.
- **Deviation report.** Download the deviation report (`legal-download-<kind>`). It opens in Excel with a Deviations and a Summary sheet.
- **Handoff.** Send to Knowledge Base creates a `Memo` source. Open in Documents prefills the Documents studio.
- **Reopen.** Reopen the matter from Previous matters; the last run's results load.
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), the empty `/legal` reads `Jalankan perkara` (`legal-run`) and the `PERKARA` panel label; the rail entry reads `Hukum`. `Perkara baru` appears only once a matter exists (screen 1 button, no testid) or on the result screen (`legal-new-matter`), and `Perkara sebelumnya` is the previous-matters panel heading. The `.docx` refusal sentence stays English — do not use it as a locale proof. Testids are locale-invariant.

## Gotchas

- v1 accepts .docx only. A .txt or .pdf is refused with the exact sentence above — a refusal, not a crash, and nothing joins the matter. The sentence is **always English**: `LEGAL_DOCX_ONLY_MESSAGE` is a hardcoded constant (`apps/web/lib/legal-client.ts:17-18`) and the translated `legal.errors.docxOnly` (`apps/web/locales/id/legal.json:32`) has no reader. Do not use it as an `id` locale proof, and do not report the English copy on an `id` desk as a drive mistake.
- A refusal by the **host** (a renamed `.docx` that fails the zip-magic sniff, `packages/host/src/legal/store-files.ts:115-117`) is a different path: HTTP 400 `unsupported_content_type` with the localized `unsupportedFile` copy (`packages/core/src/legal/output-copy.ts:66`, id at `:160`).
- The matter is created **lazily** on the first upload *attempt* (`ensureMatter` runs before the `.docx` check — `apps/web/components/legal-studio.tsx:108-109`). There is no matter row to assert before a file is dropped, and a refused `.txt` still leaves an empty matter on disk. Clean it up with `DELETE /api/v1/legal/matters/:matterId` — there is no UI control for it.
- **Clean up your matter with the route, not the UI.** `deleteLegalMatter` exists (`apps/web/lib/legal-client.ts:295-298`) but no component calls it; the only references are in its own test. `DELETE /api/v1/legal/matters/:matterId` returns `{ ok: true }` and `rmSync`s the matter folder (`packages/host/src/legal/store.ts:169`) — but it leaves `<dataDir>/legal/<workspaceId>/` behind as an empty directory, so check for the *matter* folder, not the workspace one.
- **Role cycling is a whole-matter PATCH.** There is no `/files/:docId` role route. The tag sends `PATCH /api/v1/legal/matters/:matterId` with `{ roles: [{ id, role }] }` (`apps/web/components/legal-studio.tsx:141`). From the `context` default the first click lands on `counterparty-draft`, then `our-draft`, `prior-turn`, `executed`, `instruction`, `playbook`, `figures`, `precedent`, back to `context` (`nextDocRole`, `apps/web/lib/legal-view.ts:105-108`) — so "the draft to prior turn" is three clicks, not one.
- **`legal-cancel` is a client-side abort**, not a route (`apps/web/lib/use-job-stream.ts:29-32`). There is no cancel endpoint to poke.
- **The per-file cap is 25 MB**, tighter than the 40 MB in `LEGAL_CAPS` because it matches the desktop IPC envelope (`packages/host/src/legal/store-files.ts:20-21`). Matter total is 100 MB and 60 files. A second upload of the same bytes is HTTP 409 `conflict` (sha256 match, `packages/host/src/legal/store.ts:177-184`).
- **A run needs a client party, not a title.** `canRun` is `docs > 0 && side.party.trim() && !uploading` (`apps/web/lib/legal-view.ts:101-103`); an untitled matter is saved as `legal.studio.untitled`.
- `legal-run` stays disabled until a file is uploaded **and** the client party is set. A disabled Run is that gate, not a hang.
- A stub / no-key run is never a silent no-op, but it is **not an HTTP 503** — `/api/v1/legal/matters/:id/run/stream` answers 200 and `runtime_stub` / `status: 503` ride inside the single `job.error` frame (SKILL.md **Harness-wide gotchas** G2). Two different gates can stop a run: a saved-but-disallowed key trips `requireGatewayAllowed` first and returns a real HTTP 403 `gateway_blocked` with no stream at all (`packages/host/src/handlers/legal.ts:115`); no key at all reaches `requireLive` inside the job (`packages/host/src/legal-generate.ts:67-68`).
- There is no separate Settings link on `legal-error`: `SettingsLinkHint` is appended only when the message does not already match `/settings/i` (`apps/web/components/legal-studio.tsx:260`), and both `stubError` catalogs name Settings in the sentence itself (`packages/core/src/legal/output-copy.ts:65`, id at `:159`), so the guard is always false. Assert the copy, never a hint link.
- `legal-download-<kind>` fetches `/api/v1/artifacts/:id/file`. On desktop that is a native save, so no browser download event fires — assert the file on disk.
- `legal-side` and `legal-work-type` are segmented controls, `legal-deliverable-<kind>` are checkboxes. Do not look for a select.
- `studio.title` stays **Legal** in `id`. Do not use it as a locale proof string — on the empty screen use `Jalankan perkara` (`legal-run`) or the `PERKARA` panel label. `Perkara baru` is not on the empty screen; it needs a matter (screen 1) or the result screen (`legal-new-matter`).
