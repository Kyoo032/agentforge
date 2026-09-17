# appraisal-mesin

Task `appraisal` · locale `id` · currency `IDR` · synthetic ("PT Senja Roastery", invented).

`kelayakan-mesin-roasting.xlsx` is a machine-purchase appraisal laid out with a label column and **year
columns** (`Tahun 0` … `Tahun 6`): investasi awal of Rp 1.450.000.000 at Tahun 0, six years of operating
savings net of running cost, a Rp 180.000.000 salvage value in Tahun 6, and an `Arus kas bersih`
subtotal row. The discount rate (12%) lives in `params.discountRate`, not in the table.

Run `node eval/finance/cases/appraisal-mesin/build.mjs` from `packages/host` to regenerate, and
`verify.mjs` next to it — it rebuilds the flows from the reopened workbook and re-solves the IRR by the
**secant** method (the generator used bisection), then checks NPV at the recorded IRR is ~0.

## What a correct report must show

- NPV at 12%: **Rp 139.939.434** (positive → layak), with the timing convention stated.
- IRR: **15,02%**, comfortably above the 12% hurdle.
- Simple payback **4,02 tahun** and discounted payback **5,51 tahun** — the gap is the point of the case.
- Profitability index **1,097**.
- Arus kas kumulatif for every year (`Tahun 0` = −1.450.000.000 through `Tahun 6` = +960.000.000), which
  is what the cumulative-cash-flow chart is drawn from.
- The full 3×3 sensitivity grid: NPV at 10% / 12% / 14% × flows −10% / base / +10%. Two of the nine cells
  (14% with flows −10%, and 12% with flows −10%) go negative — the report must say which.

## Conventions and traps

- **`Arus kas bersih` is a subtotal.** Adding it to the four component rows doubles every year.
- **Year 0 is undiscounted.** NPV = Σ flow[t] / (1 + r)^t with t starting at 0, matching
  `packages/core/src/finance/engine.ts#npv`. Discounting the outlay by one period is the classic error.
- **Payback** = (first year the running total is ≥ 0) − 1 + |running total the year before| ÷ that year's
  flow, counted in years from t = 0. Discounted payback applies the same rule to flows discounted at 12%.
- **Profitability index** = (NPV − arus Tahun 0) ÷ −arus Tahun 0, i.e. the PV of Tahun 1–6 over the outlay.
- **Sensitivity scales only Tahun 1–6.** The Tahun 0 investment is contractual and never moves; scaling it
  too makes every cell wrong.
- **Salvage is a cash flow of Tahun 6**, not a separate adjustment bolted onto NPV.
- The IRR is unique here — `build.mjs` refuses to emit a case where NPV(r) crosses zero more than once.
- Every `tolerance` in `case.json` is **relative** to the truth value (`0.005` = 0.5% for NPV/IRR,
  `1e-9` for exact sums).

## Known importer behaviour this case exercises

`Tahun 0` … `Tahun 6` are **not** period labels to `isPeriodLabel` (the year regex wants a 19xx/20xx), but
every one of them matches the looser `PERIOD_HEADER` word list via "tahun". So the wide path is skipped
*and* the narrow path finds no value column, and `tableToFiguresText` falls back to dumping the rows as
raw text — amounts still written `(1,450,000,000)`, unnormalised. Anything downstream has to handle the
parenthesised negatives and the comma thousands itself.
