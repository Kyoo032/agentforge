/**
 * What one Finance task owns: its label, its one-line hint, the instruction the
 * studio can prefill, a sample of the figures it expects, the phases its own
 * flow graph draws, the report sections it ends in, and whether it ships yet.
 *
 * `available` is the honest gate: only the brief runs today, so the other four
 * rows are visible in the rail and answer with a calm "coming soon" rather than
 * half a pipeline. The renderer codes against this module; the host carries
 * `task` through to the artifact.
 */
import {
  FINANCE_PHASES,
  FINANCE_PHASE_KINDS,
  isFinancePhase,
  type FinancePhaseId,
  type FinancePhaseKind,
} from "./phase-ids";
import { DEFAULT_FINANCE_TASK, FINANCE_TASKS, isFinanceTask, type FinanceTask } from "./task-ids";
import { financeTaskSystemRules } from "./task-rules";

export { DEFAULT_FINANCE_TASK, FINANCE_PHASES, FINANCE_PHASE_KINDS, FINANCE_TASKS };
export { financeTaskSystemRules, isFinancePhase, isFinanceTask };
export type { FinancePhaseId, FinancePhaseKind, FinanceTask };

export type LocalizedText = { readonly id: string; readonly en: string };

export type FinanceTaskMeta = {
  readonly id: FinanceTask;
  readonly label: LocalizedText;
  /** One short sentence for the rail row's tooltip and the studio header. */
  readonly hint: LocalizedText;
  /** The instruction a studio may prefill. `brief` keeps today's empty box. */
  readonly defaultPrompt: LocalizedText;
  /** A few lines in the shape this task's inputs take, for the empty state. */
  readonly sampleFigures: LocalizedText;
  /** Exactly the steps this task's flow graph draws, in order. */
  readonly phases: readonly FinancePhaseId[];
  /**
   * The report sections the task's builder fills. The brief's headings are the
   * model's own (3 to 6 of them), so it declares none.
   */
  readonly sections: readonly string[];
  /** False until the task's own flow is built; the studio then shows coming soon. */
  readonly available: boolean;
};

const META: Readonly<Record<FinanceTask, FinanceTaskMeta>> = {
  brief: Object.freeze({
    id: "brief",
    label: { id: "Brief Keuangan", en: "Financial brief" },
    hint: {
      id: "Angka ditempel, baris dikonfirmasi, lalu satu brief naratif dengan semua metrik inti.",
      en: "Paste figures, confirm the rows, then one narrative brief over every core metric.",
    },
    defaultPrompt: {
      id: "Tulis brief keuangan atas baris yang sudah dikonfirmasi: margin, pertumbuhan, dan posisi kas.",
      en: "Write a finance brief over the confirmed rows: margins, growth, and the cash position.",
    },
    sampleFigures: {
      id: "Pendapatan 2025: Rp 1.200.000.000. Hosting Rp 300.000.000. Gaji Rp 1.000.000.000. Kas Rp 900.000.000.",
      en: "Revenue 2025: $120,000. Hosting $30,000. Payroll $100,000. Cash $90,000.",
    },
    phases: Object.freeze([
      "paste-figures",
      "parse-items",
      "confirm-rows",
      "core-metrics",
      "narrate-sections",
      "number-guard-export",
    ] as const),
    sections: Object.freeze([] as const),
    available: true,
  }),
  cashflow: Object.freeze({
    id: "cashflow",
    label: { id: "Arus Kas & Runway", en: "Cash flow & runway" },
    hint: {
      id: "Kas masuk dan keluar tiap bulan atas saldo awal: burn, runway, titik impas, dan satu skenario what-if.",
      en: "Monthly cash in and out over an opening balance: burn, runway, breakeven, and one what-if.",
    },
    defaultPrompt: {
      id: "Jelaskan posisi kas tiap bulan, burn bersih, dan sisa runway dari periode yang sudah dikonfirmasi.",
      en: "Explain the monthly cash position, the net burn, and the runway left from the confirmed periods.",
    },
    sampleFigures: {
      id: "Saldo awal Rp 900.000.000. Jan masuk Rp 200.000.000, keluar Rp 260.000.000. Feb masuk Rp 210.000.000, keluar Rp 255.000.000.",
      en: "Opening cash $90,000. Jan in $20,000, out $26,000. Feb in $21,000, out $25,500.",
    },
    phases: Object.freeze([
      "monthly-flows",
      "parse-periods",
      "confirm-periods",
      "runway-math",
      "scenario",
      "narrate-guard-export",
    ] as const),
    sections: Object.freeze(["position", "burn-and-runway", "scenario", "flags"] as const),
    available: true,
  }),
  budget: Object.freeze({
    id: "budget",
    label: { id: "Anggaran vs Realisasi", en: "Budget vs actual" },
    hint: {
      id: "Dua set angka dipasangkan baris per baris: selisih nominal dan persen, lalu hanya yang lewat batas dijelaskan.",
      en: "Two sets matched line by line: variance in amount and percent, then only the lines over the limit are explained.",
    },
    defaultPrompt: {
      id: "Jelaskan baris yang selisihnya melewati batas, satu paragraf untuk tiap baris yang ditandai.",
      en: "Explain the lines whose variance runs past the limit, one paragraph per flagged line.",
    },
    sampleFigures: {
      id: "Anggaran: Pemasaran Rp 100.000.000, Gaji Rp 500.000.000. Realisasi: Pemasaran Rp 140.000.000, Gaji Rp 490.000.000.",
      en: "Budget: Marketing $10,000, Payroll $50,000. Actual: Marketing $14,000, Payroll $49,000.",
    },
    phases: Object.freeze([
      "budget-and-actuals",
      "parse-both-sets",
      "match-pairs",
      "variance-math",
      "flag-over-limit",
      "explain-flagged",
      "guard-export",
    ] as const),
    sections: Object.freeze(["variance-table", "flagged-lines", "notes"] as const),
    available: true,
  }),
  appraisal: Object.freeze({
    id: "appraisal",
    label: { id: "Kelayakan Investasi", en: "Investment appraisal" },
    hint: {
      id: "Modal awal dan arus kas tahunan pada satu tingkat diskonto: NPV, IRR, payback, dan grid sensitivitas.",
      en: "An outlay and yearly flows at one discount rate: NPV, IRR, payback, and a sensitivity grid.",
    },
    defaultPrompt: {
      id: "Tulis memo kelayakan atas arus kas yang dikonfirmasi, sebut NPV, IRR, dan payback apa adanya.",
      en: "Write an appraisal memo over the confirmed flows, quoting NPV, IRR and payback as computed.",
    },
    sampleFigures: {
      id: "Modal awal Rp 2.000.000.000. Tahun 1 Rp 600.000.000, tahun 2 Rp 750.000.000, tahun 3 Rp 900.000.000. Diskonto 12%.",
      en: "Outlay $200,000. Year 1 $60,000, year 2 $75,000, year 3 $90,000. Discount rate 12%.",
    },
    phases: Object.freeze([
      "outlay-and-flows",
      "discount-rate",
      "confirm-flows",
      "appraisal-math",
      "sensitivity-grid",
      "memo-guard-export",
    ] as const),
    sections: Object.freeze(["verdict", "appraisal-metrics", "sensitivity", "assumptions"] as const),
    available: true,
  }),
  ratios: Object.freeze({
    id: "ratios",
    label: { id: "Cek Kesehatan Rasio", en: "Ratio health check" },
    hint: {
      id: "Neraca dan laba rugi dikelompokkan ke pos-posnya: likuiditas, utang, dan DSCR, lalu dibandingkan dengan ambangnya.",
      en: "A balance sheet and P&L sorted into buckets: liquidity, debt and DSCR, banded against their thresholds.",
    },
    defaultPrompt: {
      id: "Tulis kartu skor rasio atas pos yang sudah dikelompokkan, sebut tiap rasio dan bandnya.",
      en: "Write a ratio scorecard over the classified buckets, naming each ratio and its band.",
    },
    sampleFigures: {
      id: "Aset lancar Rp 1.500.000.000, liabilitas lancar Rp 900.000.000, utang Rp 2.000.000.000, ekuitas Rp 2.500.000.000, EBITDA Rp 800.000.000.",
      en: "Current assets $150,000, current liabilities $90,000, debt $200,000, equity $250,000, EBITDA $80,000.",
    },
    phases: Object.freeze([
      "balance-and-pl",
      "parse-items",
      "classify-buckets",
      "ratio-math",
      "bands-vs-thresholds",
      "scorecard-guard-export",
    ] as const),
    sections: Object.freeze(["scorecard", "liquidity", "leverage", "coverage"] as const),
    available: true,
  }),
};

export const FINANCE_TASK_META: Readonly<Record<FinanceTask, FinanceTaskMeta>> = Object.freeze(META);

/** One task's meta, with the default behind an id that is somehow not ours. */
export function financeTaskMeta(task: FinanceTask): FinanceTaskMeta {
  return FINANCE_TASK_META[task] ?? FINANCE_TASK_META[DEFAULT_FINANCE_TASK];
}

/** The phases this task's own graph draws, in order. */
export function financeTaskPhases(task: FinanceTask): readonly FinancePhaseId[] {
  return financeTaskMeta(task).phases;
}

/** The task ids that actually run today. */
export function availableFinanceTasks(): readonly FinanceTask[] {
  return FINANCE_TASKS.filter((task) => financeTaskMeta(task).available);
}

/** True when the task ships; false is a coming-soon row, not an error in itself. */
export function financeTaskAvailable(task: FinanceTask): boolean {
  return financeTaskMeta(task).available;
}

/** The instruction a studio may prefill for one task, in the reader's language. */
export function defaultFinancePrompt(task: FinanceTask, language: "id" | "en"): string {
  const meta = financeTaskMeta(task);
  return language === "en" ? meta.defaultPrompt.en : meta.defaultPrompt.id;
}
