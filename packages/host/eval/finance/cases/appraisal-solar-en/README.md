# appraisal-solar-en

Task `appraisal` · locale `en` · currency `USD` · synthetic ("Harbour Lane Logistics", invented).

`rooftop-solar-appraisal.xlsx` is a rooftop solar appraisal with a label column and **year columns**
(`Year 0` … `Year 10`): an $820,000 outlay at Year 0, ten uneven years of avoided electricity cost net of
O&M, a $45,000 residual value in Year 10, and a `Net cash flow` subtotal row. **Year 5 is negative**
(−$65,000): the inverters and roof works land in one year and swamp that year's savings. The discount
rate (8%) lives in `params.discountRate`.

Run `node eval/finance/cases/appraisal-solar-en/build.mjs` from `packages/host` to regenerate, and
`verify.mjs` next to it — it rebuilds the flows from the reopened workbook, re-solves the IRR by the
**secant** method (the generator used bisection), checks NPV at the recorded IRR is ~0, and re-scans
NPV(r) to confirm the IRR is still unique.

## What a correct report must show

- NPV at 8%: **$56,127** (positive, but thin), with the timing convention stated.
- IRR: **9.42%** — above the 8% hurdle, below a 10% one, which is exactly what the sensitivity grid shows.
- Simple payback **7.04 years** and discounted payback **9.42 years** — the project only clears its
  discounted cost in the final year.
- Profitability index **1.068**.
- Cumulative cash flow per year, with the Year 5 reversal visible: the running total improves to
  −$246,000 by Year 4, falls back to −$311,000 in Year 5, and first turns positive in Year 8.
- The 3×3 sensitivity grid (6% / 8% / 10% × −10% / base / +10%). Three cells are negative — 8% with flows
  −10%, and both 10% with flows −10% and 10% at base — so the verdict must be conditional on the hurdle.
- An explicit note that Year 5 is negative and why.

## Conventions and traps

- **`Net cash flow` is a subtotal.** Adding it to the five component rows doubles every year.
- **Year 0 is undiscounted**, matching `packages/core/src/finance/engine.ts#npv`.
- **Payback is the FIRST non-negative crossing.** The running total goes *backwards* in Year 5, so
  interpolating at the first year the total merely improves, or at the last time it crosses, is wrong.
  payback = (first year cumulative ≥ 0) − 1 + |cumulative the year before| ÷ that year's flow.
- **Three sign changes, one IRR.** The flow signs run − + + + + − + + + + +, so Descartes' rule allows up
  to three real IRRs. `build.mjs` and `verify.mjs` both scan NPV(r) over r ∈ [−0.98, 6] and assert exactly
  one zero crossing; a report that quotes an IRR without that check is quoting an unverified number.
  Bisection over [−0.9999, 10] (what `engine.ts#irr` does) is only sound because of that uniqueness.
- **Sensitivity scales only Years 1–10**, the negative Year 5 included — at −10% that year gets 10%
  *less* negative, at +10% it gets 10% worse. The Year 0 outlay never moves.
- **Residual value is a Year 10 cash flow**, not an adjustment bolted onto NPV.
- Every `tolerance` in `case.json` is **relative** to the truth value (`0.005` = 0.5% for NPV/IRR,
  `1e-9` for exact sums).

## Known importer behaviour this case exercises

`Year 0` … `Year 10` are **not** period labels to `isPeriodLabel` (the year regex wants a 19xx/20xx), but
they all match the looser `PERIOD_HEADER` word list via "year". So the wide path is skipped *and* the
narrow path finds no value column, and `tableToFiguresText` falls back to dumping the rows as raw text —
amounts still written `(820,000)`, unnormalised. Downstream has to handle the parenthesised negatives and
the comma thousands itself, and must not lose the `(65,000)` in Year 5 to a sign mistake.
