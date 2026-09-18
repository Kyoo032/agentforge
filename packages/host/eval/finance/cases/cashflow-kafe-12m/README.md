# cashflow-kafe-12m

Task `cashflow` · locale `id` · currency `IDR` · synthetic ("Kafe Kopi Senja", invented).

`buku-kas-kopi-senja-2024.xlsx` is a café's 2024 cash book kept the way an Indonesian owner keeps it:
**months as columns** (`Jan 2024` … `Des 2024`), a `Saldo awal (1 Jan 2024)` cell **above** the table,
four cash-in rows, nine cash-out rows, and four summary rows — `Total masuk`, `Total keluar`,
`Arus kas bersih`, `Saldo akhir`. Three months are negative: `Jul 2024` (an espresso-machine overhaul),
`Nov 2024` and `Des 2024` (the seasonal dip — rainy season plus a new café next door).

Run `node eval/finance/cases/cashflow-kafe-12m/build.mjs` from `packages/host` to regenerate, and
`verify.mjs` next to it to re-derive every figure from the reopened workbook.

## What a correct report must show

- Arus kas bersih and saldo akhir for **all twelve months** — not just the last column.
- Saldo awal 45.000.000 picked up from above the table and carried into the running balance.
- The three negative months named, with the average burn over them (12.183.333) kept **separate** from
  the average burn over the last three months (7.750.000).
- Runway from saldo akhir Desember (64.200.000) at the last-three-month burn: 8,28 bulan, and the month
  the till empties: **September 2025**.
- Breakeven revenue per month (~91,6 juta) and for the year, with the contribution margin it used.
- The scenario — sewa −15%, penjualan +10% from next month — as a new net (−8.380.000) and a new runway
  (7,66 bulan), with the variable cost that rides along with the extra sales taken off.

## Conventions and traps

- **Subtotals must not be double counted.** `Total masuk`, `Total keluar`, `Arus kas bersih` and
  `Saldo akhir` are derived rows. Adding them to the category rows roughly doubles every total.
- **`Saldo akhir` is a balance, not a flow.** It must never enter a cash-in / cash-out sum.
- **Cost behaviour**: variable = `Pembelian bahan baku` + `Perlengkapan & kemasan`; fixed = the rest
  **except** `Perawatan mesin (overhaul)`, which is one-off and is excluded from the breakeven base.
- **The what-if scales variable cost.** Sales +10% raises bahan baku and kemasan by 10% too; a report
  that only adds 10% of revenue overstates the improvement.
- **Burn is a positive number**, runway = closing cash / burn, matching `engine.ts#runwayMonths`.
- Every `tolerance` in `case.json` is **relative** to the truth value (`0.005` = 0.5%); `verify.mjs`
  compares with `|actual − expected| ≤ tolerance × max(|expected|, 1)`.

## Known importer behaviour this case exercises

Reading the file with `readFinanceTable` + `tableToFiguresText` today:

1. `withoutTitleRows` keeps the first row with two filled cells, so the **`Saldo awal` row becomes the
   header**. No period columns are then found, the wide path is skipped, and the narrow path keeps only
   the **last** numeric column — eleven of twelve months disappear silently.
2. The header cell `Des 2024` is read as an amount: `ISO_CURRENCY` treats the three letters `Des` as a
   currency code, leaving `DES 2024` — i.e. the number 2024 with currency `DES`.

Both are why this case exists; a correct run has to survive them.
