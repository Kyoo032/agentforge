# Finance

Finance is a job: brief plus optional pasted figures → section preview → DOCX download. It is not a spreadsheet. There are no starter cards and no canned preview: every result comes from a live generate, so the whole downloadable surface needs a working gateway key. The host never invents figures.

## Sub-features

- `finance-rail` reaches `/finance` from `mode-finance` on Default (and any workspace that includes Finance).
- `finance-shell` shows `finance-studio` with empty copy (`finance-studio-empty`) and the prompt bar (`finance-studio-prompt-bar`).
- On load the studio renders exactly these: `finance-studio`, `finance-inputs`, `finance-figures-input`, `finance-parse`, `finance-items`, `finance-items-add`, `finance-param-discountRatePercent`, `finance-param-fixedCosts`, `finance-param-pricePerUnit`, `finance-param-variableCostPerUnit`, `finance-studio-empty`, `finance-studio-prompt-bar`, `finance-enhance`, `finance-studio-model`, `finance-prompt`, `finance-generate`. `finance-param-<key>` is dynamic — one per `FINANCE_PARAM_FIELDS`.
- A successful generate adds `finance-download-docx`, `finance-auto-parsed`, `finance-error`, `finance-actions`, `finance-download`, `finance-send-kb`, `finance-make-document`, `finance-make-presentation`, `finance-actions-note`. None of them are in the DOM on load.
- `finance-studio-model` is the generate-bar chat-catalog dropdown; `finance-enhance` rewrites the brief in place.
- `finance-figures-input` holds pasted numbers; `finance-parse` POSTs `/api/v1/finance/parse` for rows the owner confirms in `finance-items` (`finance-items-add` adds a blank row). Generate POSTs `/api/v1/finance/stream`.
- `finance-auto-parsed` covers Generate pressed with no rows and no dataset but figures in the brief: the brief itself goes to `/api/v1/finance/parse`, the rows land in the editor, and the click stops there — the owner generates again before anything is computed.
- `finance-download-docx` (studio header, `finance-studio.tsx:218`) POSTs the in-memory brief to `/api/v1/finance/docx`. `finance-download` is the generic `${testIdPrefix}-download` Markdown button on the shared artifact bar (`artifact-actions.tsx:77`, prefix `finance`). Both hang off `result`, so both need a live model.
- Stub/no-key generate shows `finance-error` with a Settings hint (HTTP 503).

## How to get to it (user POV)

- Choose Finance on the left rail (`mode-finance`). Default already has the tab.
- Open `http://127.0.0.1:3000/finance` when the tab is unlocked.
- Legal / Marketing / Students presets do not add this tab unless the owner checks it.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `mode-finance` is visible on Default. If count is 0, you are on a desk that hid Finance — switch to Default or add the tab in Workspaces.
- Stub proof stops at the shell and the generate 503. There is no keyless route to a preview or a download. Live generate only if the operator asked and doctor reports `runtime: "ai"` and `hasOpenai: true`.

- **Open Finance.** Click `mode-finance`. URL matches `/finance`. `finance-studio`, `finance-studio-empty`, `finance-studio-prompt-bar`, `finance-inputs`, and `finance-items` are visible. `finance-download-docx` and `finance-download` have count 0.
- **Generate needs the brief.** `finance-generate` is disabled until `finance-prompt` is non-empty (`disabled={locked || !prompt.trim()}`). Fill `finance-figures-input` alone and it stays disabled — pasted figures never enable it. Type the brief first on every step below.
- **Generate without a key.** Fill `finance-prompt` and click `finance-generate`. `finance-error` mentions gateway / Settings / API key.
- **Generate with figures only in the brief.** With no confirmed rows and no dataset, put the numbers in `finance-prompt` ("Q3 2026 review: revenue IDR 18.4B, COGS IDR 7.9B, opex IDR 6.1B") and click `finance-generate`. `briefLooksLikeFigures(prompt)` is true (any digit, or a currency token IDR/Rp/USD/EUR/$/€/£/¥/%), so the brief POSTs to `/api/v1/finance/parse`, the rows fill the line-item editor, `finance-auto-parsed` shows the row count, and the click **stops** — it never chains into a generate. Click `finance-generate` a **second** time to draft. Without a key the same click shows the parse failure in `finance-error`, not the add-items message.
- **No download without a model.** `result` is set only by a successful `onGenerate` or a section regen, so neither `finance-download-docx` nor `finance-download` is reachable without a working gateway key. On a keyless proof record count 0 for both and stop there.
- **Locale (id).** With the desk on `id` (see [locale.md](./locale.md)), this view reads `Keuangan`, `Jelaskan brief yang Anda butuhkan.`, `Tempel angka` and `Buat`; the inputs column reads `TEMPEL ANGKA`, `Uraikan menjadi pos`, `POS`, `Tambah pos`, `PARAMETER (OPSIONAL)` and `Tingkat diskonto %`. Testids are locale-invariant.
- **Cloud live.** Only after doctor `ai`: one generate. Do not screenshot the key.

## Gotchas

- Default desk unlocks Finance. Seeded Legal / Marketing / Students desks do not.
- There are no starters. `finance-starters` and `finance-starter` were deleted on 2026-09-07 in `2394b38` (the 0.14.22 analyst-modes rewrite) and have no successor testid. A map or script that still clicks a starter card is stale — do not file it as a regression.
- Generate is the finance pipeline on `/api/v1/finance/stream`; parse is `/api/v1/finance/parse`. Do not invent a second DOCX path.
- Do not POST `/api/v1/finance/stream` as a substitute for the prompt bar on a live proof.
- `finance-generate` is disabled until `finance-prompt` has text. A drive that pastes into `finance-figures-input` and clicks Generate does nothing and raises nothing — read the disabled attribute before blaming the gateway. Two textareas, two jobs: `finance-figures-input` is the Paste-figures box, `finance-prompt` is the brief.
- A brief with no digit and no currency token skips the parse entirely and lands on the `finance.errors.addItems` message in `finance-error`. Auto-parse never generates in the same click.
- The DOCX button is `finance-download-docx` (studio header, POSTs `/api/v1/finance/docx`); `finance-download` is the Markdown button on the shared artifact bar (`${testIdPrefix}-download`, prefix `finance`). The split landed on 2026-09-15; before it they shared one id, so a strict `getByTestId("finance-download")` resolved to two nodes and threw on a successful run. Match on the exact id you mean.
- Counts are dropped on purpose (`packages/core/src/finance/count-rows.ts`). A currency-free whole number under 1000 sitting next to a countable noun — outlets, stores, branches, employees, staff, headcount, units, months, weeks, days, customers, users — is silently removed and never becomes a line item, so "12 outlets" simply vanishes. The same number survives when it carries a currency token and is at or above 1000 ("units sold 12000 IDR"). Expect operational counts to disappear; that is the parser working, not a bug.
- Magnitude suffixes are expanded before the model sees the text (`packages/core/src/finance/magnitude.ts`). Shorthand the owner types — "IDR 18.4B", "Rp 18,4 M", "5jt", "3 miliar", "900k" — is rewritten to a plain integer, because quiet reasoning models drop the suffix and keep the mantissa. `M` is locale-dependent: million in English, **miliar (1e9)** in Indonesian, decided by the run locale and not by the text. Verifier guidance: do **not** check the margins — they are ratios and stay correct even when the amount is 1e9 too small. Check a stored line-item **amount**: after "revenue IDR 18.4B" the row must read 18 400 000 000, not 18.4. Measured: with the `reasoning_effort: "low"` job knob, `deepseek-v4-flash` returned `revenue: 18.4` in 6 of 8 runs on "revenue IDR 18.4B, COGS IDR 7.9B, opex IDR 6.1B, net profit IDR 2.6B" (`gpt-5.6-luna` 2/2 correct); `looksScaled` re-scales any row that still comes back as the bare mantissa.
- A live brief on the default job model goes quiet for a long time and that is the model thinking, not a stall. The desk default is `deepseek-v4-flash` (the `hy3` first choice is not on the gateway), and DeepSeek V4 thinks before it answers; its reasoning arrives as `reasoning_content`, which AI SDK 4 drops, so the host sees no stream events at all while the model works. That used to fail the generate at 60 s with HTTP 500 "No stream events from deepseek-v4-flash for 60s" while a short parse on the same model passed. DeepSeek V4, GLM-5.3, Kimi K3 and Qwen3.8-Max now get the reasoning budgets (240 s to the first token, 180 s idle after it), so a one-to-two minute silence in the drafting phase is expected; only a longer one is a fail. Documents and Market resolve to the same default (Market already carried its own 180 s / 150 s override for this).
