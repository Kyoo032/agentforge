# cashflow-startup-burn

Task `cashflow` · locale `en` · currency `USD` · synthetic (an invented seed-stage SaaS company).

`bank-export-2024.csv` is a **long-format** bank export — `date,category,direction,amount` — with 120
transactions across nine months (2024-01-01 … 2024-09-30), ISO dates, several transactions on the same
day, and **signed amounts**. Opening cash on 1 Jan 2024 is $1,850,000; it is stated in the prompt and in
`params.openingCash`, not in the file, because a bank export does not carry it.

Run `node eval/finance/cases/cashflow-startup-burn/build.mjs` from `packages/host` to regenerate, and
`verify.mjs` next to it to re-aggregate every figure from the reopened CSV.

## What a correct report must show

- Cash in, cash out and net operating cash flow for each of the nine months, plus the closing balance.
- The May 2024 `Financing` inflow of $2,500,000 called out **separately** — it lifts the bank balance but
  is not revenue and is not in either burn figure.
- Gross burn and net burn over the last three months ($446,966.67 and $367,676.67) as two distinct
  numbers, with the definition it used.
- Closing cash on 30 Sep 2024 ($1,491,390) and the runway that leaves: 4.06 months.
- The what-if — 3 engineers at $9k/month — as +$27,000/month, net burn $394,676.67 and runway 3.78 months.

## Conventions and traps

- **`amount` is already signed; `direction` is a label.** Outflows are negative, inflows positive. Four
  **reversal** rows deliberately disagree with their label: three vendor refunds are booked `out` with a
  positive amount (2024-03-27 cloud, 2024-06-14 software, 2024-08-09 marketing) and one churned annual
  customer is refunded `in` with a negative amount (2024-07-23). A reader that re-derives the sign from
  `direction` double-negates them and **overstates the nine-month outflow by $23,800**.
- **Financing is not revenue.** `category = "Financing"` is excluded from operating cash in, from gross
  burn and from net burn; it is added only to the bank balance.
- **Gross burn** = operating cash out per month. **Net burn** = operating cash out − operating cash in.
  Both are reported as positive numbers.
- **Runway** = closing cash / average net burn over the last three months, matching
  `engine.ts#runwayMonths(cash, burn) = cash / burn`.
- **The hires are fully loaded.** $9,000/month per engineer already includes employer cost; no extra
  payroll tax is layered on top.
- Every `tolerance` in `case.json` is **relative** to the truth value (`0.005` = 0.5%).

## Known importer behaviour this case exercises

`tableToFiguresText` reads this file cleanly today: the `date` column is recognised as the period, the
`category` column becomes the label, `amount` becomes the value and the signs survive — e.g.
`Rent (2024-01-01): -12500`. The `direction` column is dropped entirely, which is the right answer here
only because the amounts are signed. The remaining work is downstream: 120 undated-by-month lines must
still be grouped into nine periods, and `Financing` must be split out of revenue.
