# budget-yayasan

Anggaran vs realisasi for an invented foundation ("Yayasan Cahaya Nusantara"), `task: budget`,
locale `id`, currency `IDR`. All data is synthetic.

- `build.mjs` — writes `input.xlsx` and `case.json`. Fixed numbers, no clock, no randomness, no
  import of the Finance engine.
- `verify.mjs` — re-opens `input.xlsx` and re-derives every figure and the pairing map from the
  cells, then compares against `case.json`.

## What the input looks like

One workbook, two sheets:

| sheet | rows |
| --- | --- |
| `Anggaran 2024` | 12 budget lines (4 revenue, 8 cost) + `Subtotal Pendapatan`, `Subtotal Beban`, `Surplus/(Defisit) Anggaran` |
| `Realisasi 2024` | 12 actual lines (3 revenue, 9 cost) + `Jumlah Penerimaan`, `Jumlah Pengeluaran`, `Selisih Lebih/(Kurang)` |

The union is 14 distinct lines: 10 matched pairs, 2 budget-only, 2 actual-only.

## What a correct matching looks like

The same line is worded differently on each sheet, and the row order differs. A correct reader pairs
on meaning, not on string equality or row position:

| Anggaran 2024 | Realisasi 2024 |
| --- | --- |
| Donasi individu | Penerimaan donasi perorangan |
| Hibah korporasi | Dana hibah perusahaan |
| Pendapatan jasa pelatihan | Hasil program pelatihan |
| Gaji & tunjangan karyawan | Beban gaji |
| Program beasiswa | Penyaluran beasiswa |
| Sewa kantor | Biaya sewa gedung |
| Listrik, air & internet | Beban utilitas |
| Perjalanan dinas | Biaya perjalanan |
| ATK | Alat tulis kantor |
| Biaya rapat & konsumsi | Beban konsumsi rapat |
| Pendapatan bunga bank | *(none — never realised)* |
| Cadangan dana darurat | *(none — never drawn down)* |
| *(none — unbudgeted)* | Beban penyusutan inventaris |
| *(none — unbudgeted)* | Biaya perbaikan atap kantor |

`truth.pairing` is this table as `budget label -> actual label | null`; `truth.budgetOnly` and
`truth.actualOnly` name the four unmatched lines.

## What a correct report looks like

- `variance = actual - budget`; `variancePct = variance / budget * 100`.
- A budget line with no actual is treated as `actual = 0` (so `-100%`), not dropped.
- An actual line with no budget has an **undefined** percent (`null`), not `0%` and not `Infinity`.
- Direction: revenue over budget is **favourable**, revenue under budget is unfavourable; cost over
  budget is **unfavourable**, cost under budget is favourable.
- A line is **flagged** only when `|variance| >= Rp 5.000.000` **AND** `|variancePct| >= 10` — an
  `AND`, not an `OR`. For an actual-only line the percent test counts as breached, so only the
  rupiah test decides.
- Nine lines are flagged: `donasi-individu`, `hibah-korporasi`, `bunga-bank`, `sewa-kantor`,
  `perjalanan-dinas`, `atk`, `cadangan-darurat`, `penyusutan-inventaris`, `perbaikan-atap`.
- The report must name the two unbudgeted actual lines and the unspent reserve (`truth.mustMention`).
- The six subtotal rows are **not** line items. If any of them shows up as a row in the report, or
  their amounts are added on top of the line sums, the totals are wrong (`truth.mustNotContain`).

## Traps in this case

1. **`Gaji & tunjangan karyawan`**: +Rp 78.400.000 — the biggest rupiah overspend in the file — but
   only +5,94%, so it is **not** flagged. Catches an `OR` instead of an `AND`.
2. **`Sewa kantor`**: exactly +10,00%. The rule is `>=`, so it **is** flagged. Boundary.
3. **`ATK`**: +Rp 5.300.000, just over the rupiah floor, at +14,72%. Flagged.
4. **`Biaya rapat & konsumsi`**: +15,00% but only +Rp 3.600.000 — under the rupiah floor, **not**
   flagged. The mirror image of trap 1.
5. **`ATK` vs `Alat tulis kantor`**: an acronym on one sheet, its expansion on the other.
6. Subtotal rows with different wording on each sheet (`Subtotal Beban` vs `Jumlah Pengeluaran`)
   invite double counting.
7. The actuals sheet uses `Penerimaan`/`Pengeluaran` as section headings while the budget sheet uses
   `Pendapatan`/`Beban`; the section headings carry no amount and are not rows.
