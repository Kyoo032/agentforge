# budget-retail-en

FY2025 budget vs actual for an invented retailer ("Harborline Outfitters"), `task: budget`,
locale `en`, currency `USD`. All data is synthetic.

- `build.mjs` — writes `input.xlsx` and `case.json`. Fixed numbers, no clock, no randomness, no
  import of the Finance engine.
- `verify.mjs` — re-opens `input.xlsx`, reads the eight quarterly columns off every row and
  re-derives every variance, flag and aggregate before comparing with `case.json`.

## What the input looks like

One sheet, `Budget vs Actual FY2025`. Row 3 is the header:

```
Line item | Q1 Budget | Q1 Actual | Q2 Budget | Q2 Actual | Q3 Budget | Q3 Actual | Q4 Budget | Q4 Actual
```

25 line items in three sections — Revenue (6), Cost of goods sold (4), Operating expenses (15) —
with `Total revenue`, `Total cost of goods sold`, `Gross profit`, `Total operating expenses` and
`Operating income` printed as derived rows.

**There is no full-year column.** The full-year figures have to be summed from the four quarters.

## What a correct report looks like

- Per line and per quarter: `variance = actual - budget`, `variancePct = variance / budget * 100`.
- Full year: sum each side across Q1..Q4 **first**, then apply the same two formulas. Averaging the
  four quarterly percentages is wrong.
- Direction: revenue over budget is favourable, cost over budget is unfavourable; a zero variance is
  **neutral**, not favourable.
- A line is flagged only when `|variance| >= $2,000` **AND** `|variancePct| >= 8` — an `AND`. The
  comparison is `>=`, so a line sitting exactly on a threshold is flagged.
- Flag counts: Q1 8, Q2 8, Q3 13, Q4 15, full year 8. The full-year flag set is
  `net-sales-online-store`, `inventory-shrinkage`, `rent-flagship-store`,
  `bank-card-processing-fees`, `marketing-digital-ads`, `marketing-print-radio`,
  `software-subscriptions`, `travel-entertainment`.
- The five derived rows are not line items. Adding `Total revenue` to the revenue lines double
  counts the whole section (`truth.mustNotContain`).
- Full-year totals a correct report should land on: revenue budget `4,603,500` / actual `4,819,600`;
  COGS budget `1,539,000` / actual `1,632,000`; gross profit budget `3,064,500` / actual
  `3,187,600`; opex budget `2,993,500` / actual `3,176,675`; operating income budget `71,000` /
  actual `10,925` — a `-60,075` swing, the headline of this case.

## Traps in this case

1. **`Shipping revenue`** — every quarter is `+/-15%` and `+/-$7,500`, so all four quarters are
   flagged, but the year nets to **exactly zero** and is *not* flagged. A report that only looks at
   the full year misses four real swings; one that only looks at quarters reports a year-long
   problem that does not exist.
2. **`Bank & card processing fees`** — the mirror image: `+9%` but only `+$1,800` a quarter, so no
   quarter is flagged, yet the year is `+$7,200` at `+9%` and **is** flagged.
3. **`Merchandise purchases`** — `+$60,000` for the year, the largest dollar overspend in the file,
   but only `+5%`. Not flagged. Catches an `OR` where the rule says `AND`.
4. **`Rent - flagship store`** — exactly `+8.00%` every quarter. `>=` means flagged.
5. **`Software subscriptions`** — exactly `+$2,000` every quarter at `+10%`. `>=` means flagged.
6. **`Wholesale accounts`** and **`Insurance`** — exactly on budget in all four quarters. Variance
   `0`, percent `0`, direction `neutral`. A report that calls a zero variance "favourable" is wrong.
7. `Marketing - print & radio` is **under** budget on a cost line, so it is flagged *and*
   favourable — flagged does not mean bad.
8. Section names repeat across lines (`Net sales - ...`, `Rent - ...`, `Marketing - ...`); matching
   on a prefix collapses distinct lines.
