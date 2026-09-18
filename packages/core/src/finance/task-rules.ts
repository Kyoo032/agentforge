/**
 * The bullet rules appended to the Finance system prompt, one set per task and
 * language. They describe that task's job only: the house rules (every number
 * comes from a line item or a computed metric, JSON output, the guard strips
 * the rest) stay in the shared prompt and apply to every task.
 *
 * `brief` is deliberately empty. It is the task Finance has always done, and an
 * extra bullet would change a prompt that ships today, so the brief's system
 * prompt stays byte-identical.
 *
 * Every line starts with "- " so it reads as one more bullet under the shared
 * "Rules:" heading, and no line ever asks the model to compute something: the
 * math is done in code and the model only narrates it.
 */
import type { FinanceTask } from "./task-ids";

type LocalizedRules = { readonly id: readonly string[]; readonly en: readonly string[] };

const NONE: LocalizedRules = Object.freeze({ id: Object.freeze([]), en: Object.freeze([]) });

const RULES: Readonly<Record<FinanceTask, LocalizedRules>> = Object.freeze({
  brief: NONE,
  cashflow: Object.freeze({
    id: Object.freeze([
      "- Kamu menulis pembacaan arus kas. Bekerjalah dari periode yang sudah dikonfirmasi dan dari angka burn, runway, serta titik impas yang sudah dihitung kode.",
      "- Sebut saldo kas awal dan akhir tiap periode apa adanya; jangan menjumlahkan sendiri dan jangan membulatkan ke angka yang lebih enak dibaca.",
      "- Runway ditulis dalam satuan yang dipakai hasil hitungan; bila runway tidak dapat dihitung, katakan input mana yang kurang alih-alih menaksir.",
      "- Skenario what-if dibaca sebagai hasil hitung ulang oleh kode, bukan sebagai ramalan: sebut apa yang diubah dan apa yang berubah.",
      "- Bedakan kas dengan laba: periode yang untung tetap bisa kehabisan kas, dan katakan demikian bila angkanya memang begitu.",
    ]),
    en: Object.freeze([
      "- You are writing a cash flow read. Work from the confirmed periods and from the burn, runway and breakeven figures the code has already computed.",
      "- Quote each period's opening and closing cash as they stand; never total them yourself and never round to a friendlier number.",
      "- Write runway in the unit the computed figure uses; when runway cannot be computed, say which input is missing instead of estimating it.",
      "- Read the what-if scenario as a recomputation done in code, not as a forecast: say what was changed and what moved.",
      "- Keep cash apart from profit: a profitable period can still run out of cash, and say so when the figures show it.",
    ]),
  }),
  budget: Object.freeze({
    id: Object.freeze([
      "- Kamu menjelaskan selisih anggaran terhadap realisasi. Pasangan baris, nilai selisih, dan persentasenya sudah dihitung kode; kutip apa adanya.",
      "- Hanya baris yang ditandai melewati batas yang dijelaskan; baris lain cukup disebut sebagai sesuai anggaran tanpa paragraf sendiri.",
      "- Sebut arah selisihnya secara eksplisit: lebih besar dari anggaran atau lebih kecil, dan apa artinya bagi pos itu.",
      "- Baris yang tidak punya pasangan di set lain ditulis apa adanya sebagai tak berpasangan; jangan dipaksa dicocokkan.",
      "- Penyebab sebuah selisih hanya boleh disebut bila ada di masukan; bila tidak ada, katakan penyebabnya tidak tercatat.",
      "- Sebut rekap pos persis seperti pada daftar fakta; jangan memakai nama baris total atau subtotal milik sheet itu sendiri.",
      "- Angka seluruh periode adalah penjumlahan tiap sisi lalu dibagi; jangan merata-ratakan persentase antar periode.",
    ]),
    en: Object.freeze([
      "- You are explaining budget against actual. The line pairs, the variance amounts and the percentages are computed in code; quote them as they stand.",
      "- Only the lines flagged as over the limit get an explanation; the rest are named as on budget without a paragraph of their own.",
      "- State the direction of every variance explicitly: over budget or under, and what that means for that line.",
      "- A line with no partner in the other set is written out as unmatched; never force a pairing.",
      "- A cause for a variance may only be named when the inputs carry it; when they do not, say the cause is not recorded.",
      "- Name a section's roll-up exactly as the facts name it; never re-use the sheet's own total or subtotal row names.",
      "- The full-period figure is each side summed and then divided; never average the periods' percentages.",
    ]),
  }),
  appraisal: Object.freeze({
    id: Object.freeze([
      "- Kamu menulis memo kelayakan investasi. NPV, IRR, payback, dan grid sensitivitas sudah dihitung kode; kutip nilainya, jangan menghitung ulang.",
      "- Sebut tingkat diskonto yang dipakai di setiap kesimpulan; NPV tanpa tingkat diskontonya tidak berarti apa-apa.",
      "- IRR yang tidak konvergen atau payback yang tidak pernah tercapai ditulis apa adanya sebagai tidak tersedia.",
      "- Grid sensitivitas dibaca sebagai rentang, bukan sebagai satu angka: sebut di asumsi mana hasilnya berbalik tanda.",
      "- Ini pembacaan angka, bukan arahan transaksi: jangan menulis perintah membeli, menjual, atau mendanai.",
    ]),
    en: Object.freeze([
      "- You are writing an investment appraisal memo. NPV, IRR, payback and the sensitivity grid are computed in code; quote their values and never recompute them.",
      "- Name the discount rate behind every conclusion; an NPV without its rate says nothing.",
      "- An IRR that does not converge, or a payback that is never reached, is written out as not available.",
      "- Read the sensitivity grid as a range rather than one number: say which assumption flips the sign of the result.",
      "- This is a reading of the figures, not a transaction instruction: never write a directive to buy, sell or fund.",
    ]),
  }),
  ratios: Object.freeze({
    id: Object.freeze([
      "- Kamu menulis kartu skor rasio. Setiap rasio dan bandnya sudah dihitung kode terhadap ambang yang dipakai; kutip nilai dan bandnya apa adanya.",
      "- Sebut pos yang menyusun tiap rasio, sehingga pembaca tahu angka mana yang masuk ke pembilang dan mana ke penyebut.",
      "- Rasio yang tidak dapat dihitung karena posnya kosong ditulis sebagai tidak tersedia, lengkap dengan pos yang hilang.",
      "- Bandingkan hanya terhadap ambang yang diberikan; jangan menyebut rata-rata industri yang tidak ada di masukan.",
      "- Bacalah rasio bersama-sama: sebut bila likuiditas dan beban utang mengarah ke kesimpulan yang berbeda.",
    ]),
    en: Object.freeze([
      "- You are writing a ratio scorecard. Every ratio and its band are computed in code against the thresholds in use; quote the value and the band as they stand.",
      "- Name the buckets behind each ratio, so the reader knows which figure is the numerator and which the denominator.",
      "- A ratio that cannot be computed because a bucket is empty is written out as not available, naming the missing bucket.",
      "- Compare only against the thresholds given; never cite an industry average the inputs do not carry.",
      "- Read the ratios together: say when liquidity and debt load point to different conclusions.",
    ]),
  }),
});

/** The extra bullet rules for one task, in the reader's language. Empty for `brief`. */
export function financeTaskSystemRules(task: FinanceTask, language: "id" | "en"): readonly string[] {
  const entry = RULES[task] ?? NONE;
  return language === "en" ? entry.en : entry.id;
}
