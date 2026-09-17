# ratios-manufaktur — manufaktur Indonesia, neraca + laba rugi

Task `ratios`, locale `id`, currency `IDR`. Source: `input.xlsx` (sheets `Neraca`, `Laba Rugi`).
All data is invented: **PT Baja Karya Mandiri** is not a real company.

Regenerate with `node eval/finance/cases/ratios-manufaktur/build.mjs` from `packages/host`,
then re-prove it with `node eval/finance/cases/ratios-manufaktur/verify.mjs` — which also
re-proves that the balance sheet balances in both years.

## What a human should see in a correct report

A ratio scorecard for **31 Desember 2024**, each ratio naming its numerator and denominator:

- **Likuiditas.** Rasio lancar **1,60x** (aset lancar Rp 12.607.000.000 ÷ liabilitas jangka
  pendek Rp 7.875.000.000), up from 1,58x in 2023. Rasio cepat **1,00x** once persediaan
  Rp 4.725.000.000 is taken out — the company only just covers its short-term obligations
  without selling inventory, and rasio kas is only **0,30x**. Modal kerja Rp 4.732.000.000.
- **Beban utang.** Utang terhadap ekuitas is reported **with the definition attached**:
  **1,30x** on total liabilities, **0,76x** on interest-bearing debt only
  (Rp 8.100.000.000 = utang bank pendek + bagian lancar UJP + utang bank panjang), and
  **0,56x** on long-term liabilities alone. A single unlabelled "D/E" number is a miss.
- **Kemampuan bayar.** EBIT Rp 3.840.000.000 covers beban bunga Rp 816.000.000 **4,71x**.
  DSCR against beban bunga + pembayaran pokok (Rp 1.866.000.000) is **2,46x on an EBITDA basis**
  (EBITDA Rp 4.590.000.000) and **2,06x on an EBIT basis**. Both are comfortable; the report
  should say which basis it used.
- **Profitabilitas.** Margin kotor **29,01%**, imbal hasil ekuitas **21,64%**, perputaran
  persediaan **5,07x**.
- **Read together**: liquidity is thin (quick ratio barely 1,0x, inventory-heavy) while debt
  service cover is strong. A good report names that tension rather than averaging it away.

## Red flags in a report

- The balance sheet not balancing in the report's own numbers. It balances in the file:
  Rp 24.647.000.000 = Rp 13.920.000.000 + Rp 10.727.000.000 (figure `balanceCheck.2024` = 0, exact).
- `Bagian Lancar Utang Jangka Panjang` (Rp 1.100.000.000) counted **both** in current
  liabilities and again inside long-term debt.
- Subtotals (`Jumlah Aset Lancar`, `JUMLAH ASET`, `JUMLAH LIABILITAS`, `JUMLAH EKUITAS`,
  `JUMLAH LIABILITAS DAN EKUITAS`, `LABA KOTOR`, `LABA USAHA (EBIT)`, `LABA BERSIH`, …) added
  back in as line items — total assets would double to Rp 49.294.000.000.
- `Akumulasi Penyusutan` (negative) added instead of subtracted from aset tetap.
- The 2023 and 2024 columns summed together, which would put current assets at
  Rp 22.822.000.000 and make every ratio meaningless. **All ratios use the 2024 column only.**
- `Beban Penyusutan dan Amortisasi` or `Pembayaran Pokok Pinjaman` pulled into beban usaha;
  they sit under `DATA PENDUKUNG` and only feed EBITDA and DSCR.
- Citing an industry average — nothing in this file carries one.
- `[unverified figure]` anywhere.

## Ambiguities this case pins down

The product has no current/non-current split in its categories, so the truth maps aset lancar →
`asset`, aset tetap → `other`, liabilitas jangka pendek → `liability`, liabilitas jangka panjang
→ `debt`, ekuitas → `equity`. With that mapping the engine's `current_ratio` lands on 1,6009 and
its `debt_to_equity` lands on the long-term variant 0,5635 — which is why all three D/E readings
are in the truth. HPP, akumulasi penyusutan, beban bunga and beban pajak are written **negative**
on the sheet, so `truth.lineItems` carry them negative; `interestExpense.2024` and the inventory
turnover use the absolute values.

Figure tolerances are **relative** fractions of `|value|` (`0.005` = 0.5%); `0` means exact.
