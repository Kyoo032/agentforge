# doc-laporan-tahunan

A four-page annual-report excerpt for an invented company ("PT Bahtera Nusantara Jaya"),
`task: brief`, locale `id`, currency `IDR`. All data is synthetic.

This case is the **document** path, not the spreadsheet path: the figures arrive as Word tables and
narrative paragraphs, so it exercises anydoc -> Markdown -> figures.

- `build.mjs` — writes `input.docx`, `input.pdf` and `case.json`. Fixed numbers, no clock, no
  randomness, no import of the Finance engine.
- `verify.mjs` — unzips the `.docx` with `node:zlib` (no new dependency), parses `word/document.xml`
  for its tables and paragraphs, scans the `.pdf` content streams for their text lines, re-foots the
  statements and recomputes every figure before comparing with `case.json`.

## The two files

| file | how it is made |
| --- | --- |
| `input.docx` | the `docx` package, already a dependency of `packages/host` |
| `input.pdf` | a small text-PDF writer inside `build.mjs`, modelled on the repo's own `packages/core/src/pdf/__fixtures__/build-pdf.ts` (same uncompressed, hand-assembled structure, extended from one line per page to many). No dependency was added. |

The PDF is a **text-layer** PDF, so it must never hit the `NeedsOcr` path. It carries the same four
pages as the `.docx`, with the tables laid out as fixed-width text columns.

## Document layout

1. Title, `Ikhtisar Kinerja`, three narrative paragraphs.
2. `Laporan Laba Rugi Ringkas` — a real Word table, 11 rows x (Uraian, 2023, 2024) — plus a note.
3. `Posisi Kas dan Arus Kas` — a real Word table, 5 rows — plus a note.
4. `Catatan Operasional` — three narrative paragraphs.

## What a correct report looks like

- All 16 table rows are read for **both** years (32 line items in `truth.lineItems`), with the
  subtotal rows (`Laba kotor`, `Laba usaha`, `Laba sebelum pajak`, `Laba bersih tahun berjalan`)
  recognised as subtotals and not re-added to the expense lines.
- Numbers are written in Indonesian style: `21.965.000.000` is twenty-one billion nine hundred
  sixty-five million, **not** 21.965. A dot is a thousands separator here, and a decimal comma is
  used for `1,84`.
- Cash outflows print in parentheses: `(1.312.600.000)` is **negative**.
- The statements foot exactly, and `verify.mjs` checks that they do:
  `Pendapatan usaha - Beban pokok = Laba kotor`;
  `Laba kotor - Beban penjualan - Beban umum dan administrasi = Laba usaha`;
  `Laba usaha - Beban bunga + Pendapatan lain-lain = Laba sebelum pajak`;
  `Laba sebelum pajak - Beban pajak = Laba bersih`;
  `kas awal + operasi + investasi + pendanaan = kas akhir` for both years.
- 15 figures are derived from the tables (`"source": "table"`) and 7 are stated **only in the
  narrative** (`"source": "prose"`), so the runner can score the two paths separately:

| prose-only figure | the sentence it comes from |
| --- | --- |
| `headcount.2024` = 148 | "mempekerjakan 148 karyawan tetap" |
| `stores.2023` = 12, `stores.2024` = 17 | "bertambah dari 12 gerai menjadi 17 gerai" |
| `currentRatio.2024` = 1,84 | "rasio lancar ... tercatat 1,84 kali" |
| `capex.2024` = Rp 1.180.000.000 | "belanja modal sepanjang tahun 2024 mencapai ..." |
| `longTermBankDebt.2024` = Rp 3.420.000.000 | "saldo utang bank jangka panjang ..." |
| `dividendPaid.2024` = Rp 250.000.000 | "dividen tunai yang dibagikan ..." |

  `verify.mjs` enforces the claim as a property: each prose-only value appears in a paragraph and
  equals **no** table cell.

## Traps in this case

1. **Dots are thousands separators.** `12.960.350.000` parsed as a decimal turns a 12.96 billion
   expense into 12.96. This is the single most likely failure on this case.
2. **Parentheses mean negative.** Treating `(985.400.000)` as positive makes the cash table stop
   footing and turns free cash flow positive when it should be the sum of an inflow and an outflow.
3. **Prose-only numbers.** `1,84 kali`, `148 karyawan` and `17 gerai` exist in no table. A pipeline
   that only reads tables silently drops all seven — which looks like success, not like an error.
4. **A number repeated in words.** `Kas dan setara kas akhir tahun` 2024 is `2.350.000.000` in the
   table and "Rp 2,35 miliar" in the following paragraph. Reporting it twice, or reading "2,35" as
   two rupiah thirty-five, are both wrong; it is marked `"source": "table"`.
5. **Subtotals interleaved with detail rows.** `Laba kotor` sits between `Beban pokok pendapatan`
   and `Beban penjualan`; summing every row in the table gives nonsense.
6. **Two documents, one truth.** The `.pdf` and the `.docx` carry the same figures. Any difference
   between the two extractions is a bug in the reader, not in the data.
7. The PDF has a real text layer on every page: a `NeedsOcr` result on this file means the extractor
   gave up too early. OCR must never be switched on for it.
