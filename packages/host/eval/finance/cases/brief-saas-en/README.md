# brief-saas-en — SaaS startup, eight quarters

Task `brief`, locale `en`, currency `USD`. Source: `input.csv` (comma-delimited, quoted thousands).
All data is invented: **Lumenstack Analytics, Inc.** is not a real company.

Regenerate with `node eval/finance/cases/brief-saas-en/build.mjs` from `packages/host`,
then re-prove it with `node eval/finance/cases/brief-saas-en/verify.mjs`.

## What a human should see in a correct report

The story is a company that grew into profitability in the last quarter of the series:

- **Revenue** $1,499,000 (Q1 2023) → $3,937,000 (Q4 2024); FY2023 $7,396,000 → FY2024 $12,880,000,
  **+74.1% year over year**. Quarter-on-quarter the last step is **+15.7%**, and the compound
  rate across the seven steps is **14.79% per quarter** (≈ +73.6% annualised).
- **Gross margin** 71.4% (FY2023) → 74.3% (FY2024), **75.3% in Q4 2024** — the hosting and support
  lines are growing more slowly than subscription revenue, and the report should attribute the
  margin lift to that rather than to a price change (there is no price data in the file).
- **Operating income was negative in seven of eight quarters** and turns positive for the first
  time in **Q4 2024 at +$33,000** (operating margin 0.84%). FY2024 as a whole is still a
  **$1,090,000 operating loss**. A report that calls FY2024 profitable is wrong.
- **Burn is falling fast**: $640,000 in Q1 2023 down to $90,000 in Q4 2024.
- **Runway** must be stated with the burn basis it uses. On the FY2024 average monthly burn
  ($106,667) the $9,380,000 cash gives **≈ 87.9 months**; on the Q4 2024 burn alone it gives
  **≈ 312.7 months**. Quoting one number with no basis is a miss; both figures are in the truth.
- **Breakeven**: at $1,200 per seat per quarter and $310 variable cost, contribution margin is
  **74.17%**, so covering the Q4 2024 fixed base of $2,932,000 takes **≈ 3,294 seats a quarter**
  (**≈ $3,953,258** of quarterly revenue).

## Red flags in a report

- Any subtotal (`Total Revenue`, `Total Cost of Revenue`, `Gross Profit`,
  `Total Operating Expenses`, `Operating Income (Loss)`) counted again as a line item —
  Q4 2024 revenue would come out at $7,874,000.
- `"(593,000)"` read as a positive 593,000, which would turn every loss quarter into a profit.
- `"1,250,000"` read as 1.25 or as 1,250 — the thousands separators are inside quoted fields.
- Cash and burn added into revenue or opex; they are a separate block under `Cash`.
- Calling the series "8 quarters of growth with breakeven reached in 2024" without saying that
  only the single quarter Q4 2024 is above the line.
- `[unverified figure]` anywhere.

## Ambiguities this case pins down

`fixedCosts`, `pricePerUnit` and `variableCostPerUnit` are **params**, not rows in the CSV;
`fixedCosts` is the Q4 2024 operating expense run rate, and the unit is a seat per quarter.
CAGR is per quarter over 7 steps. Runway is given on two burn bases, as above.

Figure tolerances are **relative** fractions of `|value|` (`0.005` = 0.5%); `0` means exact.
The importer names the sheet after the file, so it appears as `input`.
