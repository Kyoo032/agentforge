/**
 * Two cash books, written out as the rows a reader would have confirmed.
 *
 * Both are synthetic and both are copied in by hand rather than read from the eval folder: a core
 * unit test must be able to fail on its own, without a fixture file somewhere else moving under it.
 * The figures are the ones the two case READMEs state, so a test that agrees with these agrees with
 * an oracle that was written independently of this engine.
 *
 * KAFE — a café's twelve months, months as columns, outflows written as positive magnitudes.
 * STARTUP — nine months of a bank export, one financing round in May that is not revenue.
 */
import type { CashflowItem } from "../types";

const JUTA = 1_000_000;

export const KAFE_PERIODS = [
  "Jan 2024",
  "Feb 2024",
  "Mar 2024",
  "Apr 2024",
  "Mei 2024",
  "Jun 2024",
  "Jul 2024",
  "Agu 2024",
  "Sep 2024",
  "Okt 2024",
  "Nov 2024",
  "Des 2024",
] as const;

export const KAFE_OPENING_CASH = 45 * JUTA;

/** Total masuk per month, as the sheet's own subtotal row states it. */
const KAFE_IN = [92.0, 91.3, 96.9, 111.2, 115.9, 99.8, 84.4, 107.5, 107.4, 95.4, 79.9, 71.6];
/** Total keluar per month. */
const KAFE_OUT = [88.75, 86.45, 92.05, 110.15, 101.05, 93.75, 96.65, 96.35, 98.75, 94.35, 89.55, 86.25];
/** Pembelian bahan baku + Perlengkapan & kemasan: the cost that rides along with sales. */
const KAFE_VARIABLE = [38.6, 37.2, 41.0, 45.9, 48.4, 42.9, 36.1, 45.1, 46.6, 40.9, 34.3, 31.4];
/** Perawatan mesin (overhaul): one event in July, and never part of a monthly base. */
const KAFE_ONE_OFF = [0, 0, 0, 0, 0, 0, 12.0, 0, 0, 0, 0, 0];
/** Sewa tempat, flat all year. */
const KAFE_RENT = 15.0;

function kafeFixed(at: number): number {
  return (KAFE_OUT[at] ?? 0) - (KAFE_VARIABLE[at] ?? 0) - (KAFE_ONE_OFF[at] ?? 0);
}

export const KAFE_ITEMS: CashflowItem[] = [
  { label: "Saldo awal", period: "", amount: KAFE_OPENING_CASH, currency: "IDR", category: "cash", kind: "opening" },
  ...KAFE_PERIODS.flatMap((period, at) => [
    {
      label: "Total kas masuk",
      period,
      amount: (KAFE_IN[at] ?? 0) * JUTA,
      currency: "IDR",
      category: "revenue",
      kind: "inflow" as const,
    },
    {
      label: "Total kas keluar",
      period,
      amount: (KAFE_OUT[at] ?? 0) * JUTA,
      currency: "IDR",
      category: "opex",
      kind: "outflow" as const,
      breakdown: {
        variable: (KAFE_VARIABLE[at] ?? 0) * JUTA,
        fixed: kafeFixed(at) * JUTA,
        oneOff: (KAFE_ONE_OFF[at] ?? 0) * JUTA,
        roles: { rent: KAFE_RENT * JUTA },
      },
    },
  ]),
];

export const STARTUP_PERIODS = [
  "2024-01",
  "2024-02",
  "2024-03",
  "2024-04",
  "2024-05",
  "2024-06",
  "2024-07",
  "2024-08",
  "2024-09",
] as const;

export const STARTUP_OPENING_CASH = 1_850_000;

const STARTUP_IN = [44_980, 65_940, 51_300, 76_360, 58_120, 78_800, 61_250, 98_990, 77_630];
const STARTUP_OUT = [325_680, 310_080, 345_360, 333_960, 402_560, 413_440, 459_040, 423_640, 458_220];
/** The SAFE round. It lifts the bank balance and is never operating revenue. */
export const STARTUP_FINANCING = { period: "2024-05", amount: 2_500_000 };

export const STARTUP_ITEMS: CashflowItem[] = STARTUP_PERIODS.flatMap((period, at) => [
  {
    label: "Operating cash in",
    period,
    amount: STARTUP_IN[at] ?? 0,
    currency: "USD",
    category: "revenue",
    kind: "inflow" as const,
  },
  {
    label: "Operating cash out",
    period,
    amount: STARTUP_OUT[at] ?? 0,
    currency: "USD",
    category: "opex",
    kind: "outflow" as const,
    breakdown: { variable: 0, fixed: STARTUP_OUT[at] ?? 0, oneOff: 0, roles: {} },
  },
  ...(period === STARTUP_FINANCING.period
    ? [
        {
          label: "Financing",
          period,
          amount: STARTUP_FINANCING.amount,
          currency: "USD",
          category: "equity",
          kind: "financing" as const,
        },
      ]
    : []),
]);
