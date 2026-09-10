# Finance

Finance is a job: brief plus optional pasted figures → section preview → DOCX download. It is not a spreadsheet. Live generate needs a gateway key. Starters load a canned draft without one. The host never invents figures.

## Sub-features

- `finance-rail` reaches `/finance` from `mode-finance` on Default (and any workspace that includes Finance).
- `finance-shell` shows `finance-studio` with empty copy and starter cards (`finance-starters`).
- `finance-starter` loads a preview without a live generate.
- `finance-studio-model` is the generate-bar chat-catalog dropdown.
- `finance-figures-input` holds pasted numbers. Generate POSTs `/api/v1/documents` with `job: "finance"`.
- `finance-download` builds a DOCX from the in-memory draft.
- Stub/no-key generate shows `finance-error` with a Settings hint (HTTP 503).

## How to get to it (user POV)

- Choose Finance on the left rail (`mode-finance`). Default already has the tab.
- Open `http://127.0.0.1:3000/finance` when the tab is unlocked.
- Legal / Marketing / Students presets do not add this tab unless the owner checks it.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-finance` is visible on Default. If count is 0, you are on a desk that hid Finance — switch to Default or add the tab in Workspaces.
- Stub proof stops at starters + generate 503. Live generate only if the operator asked and doctor reports `runtime: "ai"` and `hasOpenai: true`.

- **Open Finance.** Click `mode-finance`. URL matches `/finance`. `finance-studio`, `finance-studio-empty`, and `finance-starters` are visible.
- **Starter.** Click the first `finance-starter`. Preview and `finance-download` are visible.
- **Download.** Click `finance-download` to get a DOCX from the starter (no live model).
- **Generate without a key.** Fill `finance-prompt` and click `finance-generate`. `finance-error` mentions gateway / Settings / API key.
- **Cloud live.** Only after doctor `ai`: one generate. Do not screenshot the key.

## Gotchas

- Default desk unlocks Finance. Seeded Legal / Marketing / Students desks do not.
- Generate is the documents pipeline with `job: "finance"`. Do not invent a second DOCX path.
- Do not POST `/api/v1/documents` as a substitute for the prompt bar on a live proof.
