# Data

Data is a table analyst job: paste CSV → ask a question → sourced notes → Markdown download. It is not Research and does not call `web_search`. Live generate needs a gateway key.

## Sub-features

- `data-rail` reaches `/data` from `mode-data` on Home (and any workspace that includes Data).
- `data-shell` shows `data-studio` with a CSV box (`data-csv`) and starter cards (`data-starters`).
- `data-starter` pre-fills `data-prompt`.
- `data-studio-model` is the generate-bar chat-catalog dropdown.
- Generate POSTs `/api/v1/data` with the question plus a bounded CSV sample. Invalid or empty CSV does not generate (`data-error`).
- `data-download` saves Markdown from the notes.
- Stub/no-key generate is HTTP 503 with a Settings hint.

## How to get to it (user POV)

- Choose Data on the left rail (`mode-data`). Home already has the tab.
- Open `http://127.0.0.1:3000/data` when the tab is unlocked.
- Legal / Marketing / Students presets do not add this tab unless the owner checks it.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- `mode-data` is visible on Home. If count is 0, switch to Home or add the tab in Workspaces.
- Stub proof: paste CSV + starter + generate 503. Live generate only if the operator asked and doctor reports `runtime: "ai"` and `hasOpenai: true`.

- **Open Data.** Click `mode-data`. URL matches `/data`. `data-studio` and `data-csv` are visible.
- **Starter.** Click a `data-starter`. `data-prompt` fills.
- **Invalid CSV.** Clear `data-csv`, keep a prompt, click `data-generate`. `data-error` says the table is not parseable. No search call.
- **Generate without a key.** Restore a valid CSV, click `data-generate`. `data-error` mentions gateway / Settings / API key.
- **Cloud live.** Only after doctor `ai`: one table analysis. Do not screenshot the key.

## Gotchas

- Default Home unlocks Data. Seeded Legal / Marketing / Students desks do not.
- This is not `/api/v1/research`. A network call to Tavily/Brave is a fail.
- Do not POST `/api/v1/data` as a substitute for the prompt bar on a live proof.
