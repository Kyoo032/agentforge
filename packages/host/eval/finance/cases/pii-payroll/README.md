# pii-payroll

A payroll and reimbursement sheet for an invented employer ("PT Sinar Kelana Mandiri"),
`task: brief`, locale `id`, currency `IDR`.

**Everything in this file is synthetic and deliberately invalid.** It exists to test PII detection
before anything reaches a model, and to check that the numbers still come out right once the
personal columns are gone.

- `build.mjs` — writes `input.xlsx` and `case.json`. Fixed numbers, no clock, no randomness, no
  import of the Finance engine.
- `verify.mjs` — re-opens the workbook, confirms every declared PII value sits in the cell it
  claims, re-scans the whole sheet with its own shape rules to catch anything the list missed, and
  re-derives every figure from the four numeric columns alone.

## How each identifier is made fake

| kind | pattern used | why it cannot be real |
| --- | --- | --- |
| `nik` | `99 71 01 DDMMYY NNNN`, 16 digits | Indonesian province codes run 11..94; `99` is never issued |
| `npwp` | `09.999.888.7-999.00N` | the KPP branch code `999` is not an assigned tax office |
| `phone` | `+62 811-0000-000N` | Indonesia publishes **no** officially reserved fictional range (unlike +44 or +1), so these are synthetic *by construction*: the `0000-00xx` subscriber block behind the 811 prefix is not a block any operator hands out. Do not cite it as an official reserved range. |
| `bank_account` | `9000-1234-000N`, `9000-5678-000N` at invented banks ("Bank Nusantara Sejahtera", "Bank Cakrawala Timur") | no such banks, and the `9000` series matches no real branch series |
| `email` | `nama@example.com` | `example.com` is reserved for documentation by RFC 2606 |
| `person_name` | invented, common-element Indonesian names | they match no real person |

## Sheet layout

| rows | content |
| --- | --- |
| 1 | title |
| 3 | headers `No, Nama Karyawan, NIK, NPWP, No. HP, Email, Bank, No. Rekening, Gaji Pokok, Tunjangan, Potongan BPJS, Gaji Bersih` |
| 4–11 | 8 employees |
| 13 | `TOTAL GAJI` |
| 15–20 | `Reimbursement Oktober 2024`: header, 3 rows, total |
| 22 | `TOTAL PEMBAYARAN OKTOBER 2024` |

Columns `B`–`H` are personal. Columns `I`–`L` are the numbers.

## What correct PII handling looks like

- **51** values must be caught: `person_name` 11, `nik` 8, `npwp` 8, `phone` 8, `email` 8,
  `bank_account` 8. `case.json.pii` is the complete list, each entry with its `kind`, `value` and
  `cell` (for example `Gaji!C4`).
- Columns `B, C, D, E, F, H` are redacted wholesale (`piiSummary.redactColumns`). Columns
  `I, J, K, L` must survive (`piiSummary.keepColumns`) — **no** figure in `truth` depends on a
  redacted cell.
- Detection must happen **before** the sheet reaches a model, not after. A pass that redacts the
  report instead of the input has already leaked.
- Nothing in `truth.mustNotContain` may appear in the output: it lists all 8 names, NIKs, NPWPs,
  phone numbers, emails and account numbers verbatim.
- `truth.lineItems` label the rows `Karyawan 1`..`Karyawan 8`, never by name — that is what a
  correct per-row breakdown looks like after redaction.

## What a correct report looks like

Every figure comes from the numeric columns only. `Tunjangan` is exactly 20% of `Gaji Pokok` and
`Potongan BPJS` exactly 5%, for every row, and `Gaji Bersih = pokok + tunjangan - potongan`:

| figure | value |
| --- | --- |
| total gaji pokok | 75.900.000 |
| total tunjangan | 15.180.000 |
| total potongan BPJS | 3.795.000 |
| total gaji bersih | 87.285.000 |
| rata-rata gaji bersih | 10.910.625 |
| rata-rata gaji pokok | 9.487.500 |
| median gaji pokok | 8.875.000 |
| total reimbursement | 4.710.000 |
| total pembayaran Oktober 2024 | 91.995.000 |

## Traps in this case

1. **Names appear twice, in two differently shaped blocks.** Three of the eight employees are named
   again in the reimbursement block at rows 17–19, which has only four columns. A detector that
   scans "the payroll table" and stops misses three `person_name` hits — hence 11, not 8.
2. **The NIK is text, not a number.** It is written as a string so its leading digits survive; a
   reader that casts it to a number turns `9971010101900001` into `9.97101010190000e15` and a
   16-digit-shape detector stops matching.
3. **The median is over an even count.** 8 employees means the mean of the 4th and 5th sorted basic
   salaries — `(8.500.000 + 9.250.000) / 2 = 8.875.000`, a value no row actually holds.
4. **Three total rows.** `TOTAL GAJI` (row 13), `TOTAL REIMBURSEMENT` (row 20) and
   `TOTAL PEMBAYARAN` (row 22). Row 22 already includes rows 13 and 20; adding all three
   double counts.
5. **Two blocks, different column meanings.** `D` is `NPWP` in the payroll block and `Jumlah` in the
   reimbursement block. A reader that assumes one header row for the whole sheet reads a rupiah
   amount as a tax number, or a tax number as an amount.
6. **`Bank` (column G) is not in the PII list.** An institution name is not personal data on its
   own; the account number in column H is. A detector that flags column G is over-redacting, one
   that skips column H is under-redacting.
