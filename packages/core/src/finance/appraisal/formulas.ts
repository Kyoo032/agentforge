/**
 * The appraisal's arithmetic again, as live Excel formulas over the Inputs sheet.
 *
 * A reader who changes one year's flow should watch the NPV, the IRR and all nine sensitivity cells
 * move with it, which is the whole reason the workbook carries formulas rather than a picture of
 * the numbers. Excel's own `NPV()` discounts its FIRST value by one period, so the t = 0 outlay is
 * added OUTSIDE the call — the same convention `engine.ts#npv` follows, expressed in Excel's terms.
 *
 * Nothing a user typed is ever written into a formula: the only literals are our own rates and
 * scale factors, which are numbers, and every amount is addressed as a cell.
 */
import { REPORT_TABLE_FIRST_DATA_ROW } from "../report";

/** The sheet the renderer gives the `inputs` table, and the column its amounts land in. */
export const INPUTS_SHEET = "Inputs";
/** The sheet the renderer gives the `calc` table. Its Value column holds the live discount rate. */
export const CALC_SHEET = "Calc";

const AMOUNT = `${INPUTS_SHEET}!$D`;
/** The Calc row the discount rate is written to, and the column its value sits in. */
export const CALC_RATE_ROW = REPORT_TABLE_FIRST_DATA_ROW;
export const CALC_RATE_REF = `${CALC_SHEET}!$B$${CALC_RATE_ROW}`;
/** The Calc row the NPV lands on, one below the rate. The profitability index divides by it. */
export const CALC_NPV_ROW = REPORT_TABLE_FIRST_DATA_ROW + 1;

/** A number as Excel should read it: no exponent, no trailing float noise. */
function literal(value: number): string {
  return String(Number(value.toFixed(10)));
}

/** `Inputs!$D$2` — the t = 0 outlay, which every formula here treats as undiscounted. */
export function outlayRef(): string {
  return `${AMOUNT}$${REPORT_TABLE_FIRST_DATA_ROW}`;
}

/** `Inputs!$D$3:$D$8` — the flows after t = 0, which is exactly what Excel's NPV wants. */
export function laterFlowsRange(periodCount: number): string | null {
  if (periodCount < 2) {
    return null;
  }
  const first = REPORT_TABLE_FIRST_DATA_ROW + 1;
  return `${AMOUNT}$${first}:$D$${REPORT_TABLE_FIRST_DATA_ROW + periodCount - 1}`;
}

/** `Inputs!$D$2:$D$8` — every flow including t = 0, which is what Excel's IRR wants. */
export function allFlowsRange(periodCount: number): string | null {
  if (periodCount < 2) {
    return null;
  }
  return `${AMOUNT}$${REPORT_TABLE_FIRST_DATA_ROW}:$D$${REPORT_TABLE_FIRST_DATA_ROW + periodCount - 1}`;
}

/** NPV at the rate held on the Calc sheet, with the outlay added outside the NPV call. */
export function npvFormula(periodCount: number): string | null {
  const range = laterFlowsRange(periodCount);
  return range === null ? null : `${outlayRef()}+NPV(${CALC_RATE_REF}/100,${range})`;
}

/** IRR over every flow, as a percentage so it reads like the rate beside it. */
export function irrFormula(periodCount: number): string | null {
  const range = allFlowsRange(periodCount);
  return range === null ? null : `IRR(${range})*100`;
}

/** (NPV − outlay) ÷ −outlay, reading the NPV straight off its own Calc row. */
export function profitabilityIndexFormula(periodCount: number): string | null {
  if (periodCount < 2) {
    return null;
  }
  const outlay = outlayRef();
  return `($B$${CALC_NPV_ROW}-${outlay})/-${outlay}`;
}

/**
 * One sensitivity cell. Scaling every flow after t = 0 by the same factor scales their present
 * value by that factor exactly, so the cell is the outlay plus the scaled NPV of the range — and
 * the outlay stays where it is, at full size, which is the rule the grid turns on.
 */
export function sensitivityFormula(periodCount: number, ratePercent: number, shiftPercent: number): string | null {
  const range = laterFlowsRange(periodCount);
  if (range === null) {
    return null;
  }
  const factor = 1 + shiftPercent / 100;
  const scaled = factor === 1 ? "" : `${literal(factor)}*`;
  return `${outlayRef()}+${scaled}NPV(${literal(ratePercent / 100)},${range})`;
}

/** NPV at one fixed hurdle rate on the base flows. */
export function hurdleFormula(periodCount: number, ratePercent: number): string | null {
  return sensitivityFormula(periodCount, ratePercent, 0);
}

/** The year-by-year sheet's own columns: A period, B net, C cumulative, D discounted, E running. */
export const FLOW_ROW_COLUMNS = ["A", "B", "C", "D", "E"] as const;

export type FlowRowFormulas = {
  readonly net: string;
  readonly cumulative: string;
  readonly discounted: string;
  readonly cumulativeDiscounted: string;
};

/** The four live cells of one year's row, addressed from its own position on the sheet. */
export function flowRowFormulas(rowIndex: number): FlowRowFormulas {
  const row = REPORT_TABLE_FIRST_DATA_ROW + rowIndex;
  const first = REPORT_TABLE_FIRST_DATA_ROW;
  return {
    net: `${AMOUNT}$${row}`,
    cumulative: `SUM(${AMOUNT}$${first}:$D$${row})`,
    discounted: `${AMOUNT}$${row}/(1+${CALC_RATE_REF}/100)^${rowIndex}`,
    cumulativeDiscounted: `SUM($D$${first}:$D$${row})`,
  };
}
