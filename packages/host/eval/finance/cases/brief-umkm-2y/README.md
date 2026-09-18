# brief-umkm-2y — UMKM Indonesia, laba rugi 2 tahun

Task `brief`, locale `id`, currency `IDR`. Source: `input.xlsx` (sheets `Laba Rugi`, `Operasional`).
All data is invented: **CV Terang Sentosa Boga** is not a real company.

Regenerate with `node eval/finance/cases/brief-umkm-2y/build.mjs` from `packages/host`,
then re-prove it with `node eval/finance/cases/brief-umkm-2y/verify.mjs`.

## What a human should see in a correct report

A two-year read of a profitable food SME, written in natural Bahasa Indonesia:

- **Pendapatan bersih** Rp 7.570.000.000 (2023) → Rp 9.775.000.000 (2024), **+29,13%**.
  The net figure is after `Retur & Potongan Penjualan`; a report that says Rp 10.020.000.000
  has added the gross sales lines and skipped the contra-revenue row.
- **Laba kotor** Rp 3.255.000.000 → Rp 4.318.000.000, **margin kotor 43,00% → 44,17%** — margin
  improved slightly even though HPP grew, and the report should say so.
- **Beban usaha** Rp 2.316.000.000 → Rp 2.907.000.000, with `Gaji & Tunjangan` (Rp 1.560.000.000)
  named as the largest single line and `Pemasaran` (+43,9%) as the fastest-growing one.
- **Laba usaha** Rp 1.411.000.000 (2024) and **laba bersih** Rp 1.024.920.000 after interest,
  other income and 22% tax — **margin bersih 10,49%**, net profit up **51,56%**.
  The two profit lines must be named distinctly; collapsing them into one "laba" is wrong.
- **Runway** of the expansion cash: Rp 1.180.000.000 / Rp 152.000.000 per month = **±7,8 bulan**,
  and the report should say that this is the expansion programme's cash, not the whole business
  running out of money — the company is profitable.
- Headcount and units read as **counts, not rupiah**: 75 staff in 2024 (46 tetap + 29 harian),
  18 partner outlets, 528.000 pcs sold. Only `Rata-rata Harga Jual per pcs` (Rp 17.900) is money.

## Red flags in a report

- Any subtotal (`Pendapatan Bersih`, `Jumlah Harga Pokok Penjualan`, `LABA KOTOR`,
  `Jumlah Beban Usaha`, `LABA USAHA`, `LABA SEBELUM PAJAK`, `LABA BERSIH`) counted a second
  time as if it were a line item — revenue would come out at Rp 19.550.000.000 for 2024.
- Rp 512.000.000, Rp 245.000.000, Rp 24.000.000 or Rp 31.000.000 read as 512, 245, 24 or 31
  (those four cells are TEXT with Indonesian thousands separators).
- `Retur & Potongan Penjualan` treated as an expense instead of a deduction from revenue.
- "528.000" or "58.000" described as an amount of money.
- `[unverified figure]` anywhere — every number here traces to a cell or to a computed metric.

## Ambiguities this case pins down

The product's `net_profit` metric is `revenue - cogs - opex`, which for this file equals
**Laba Usaha**, because interest, other income and tax are categorised `other`. The truth
therefore carries `operatingProfit.2024` (Rp 1.411.000.000) *and* `netProfit.2024`
(Rp 1.024.920.000) as separate figures. Runway is defined as expansion cash ÷ the monthly burn
printed on the sheet — not as opex ÷ periods.

Figure tolerances are **relative** fractions of `|value|` (`0.005` = 0.5%); `0` means exact.
