/**
 * Just enough Excel to work out what a report's Calc sheet will show: `SUMIFS` and `COUNTIFS` over
 * the Inputs sheet, `ABS`, `IF`, `OR`, `IFERROR`, `=` and the four operators — every function the
 * Calc sheets write, and nothing more. Test support only.
 *
 * The Calc sheet promises that a reader who edits one row on Inputs watches the value move exactly
 * as the report's own arithmetic would. A test that can compute the formula can hold the report's
 * figure to it.
 *
 * A blank and an error are different answers, and this keeps them apart the way Excel does: `""` is
 * a blank (the report's null), while a division by zero or a blank used in arithmetic is an error
 * that travels up through every operator until an `IFERROR` catches it. An error that reaches the
 * cell is thrown, because a reader would see "#DIV/0!" where the report states nothing.
 */
import { REPORT_TABLE_FIRST_DATA_ROW, type ReportCell, type ReportTable } from "../report";

/** `SUMIFS(Inputs!$D:$D,Inputs!$C:$C,"key"[,Inputs!$B:$B,$D<row>])` — the one lookup the sheets write. */
const SUMIFS = /SUMIFS\(Inputs!\$D:\$D,Inputs!\$C:\$C,"([^"]*)"(?:,Inputs!\$B:\$B,\$D(\d+))?\)/g;
/** `COUNTIFS(Inputs!$C:$C,"key"[,Inputs!$B:$B,$D<row>])` — whether a pile has any row at all. */
const COUNTIFS = /COUNTIFS\(Inputs!\$C:\$C,"([^"]*)"(?:,Inputs!\$B:\$B,\$D(\d+))?\)/g;
const NUMBER = /^\d+(?:\.\d+)?(?:e[+-]?\d+)?/i;

/** Inputs columns A–E: Label, Period, Category/Bucket, Amount, Currency. Calc columns A–E: Metric, Value, Unit, Period, Formula. */
const INPUT_PERIOD = 1;
const INPUT_KEY = 2;
const INPUT_AMOUNT = 3;
const CALC_VALUE = 1;
const CALC_PERIOD = 3;

/** What a cell shows for `""`. */
const BLANK = Symbol("blank");

/** An Excel error value, carried as a value so it can travel up to an `IFERROR` or to the cell. */
class CalcError {
  constructor(readonly code: "#DIV/0!" | "#VALUE!") {}
}

type Value = number | boolean | typeof BLANK | CalcError;

function cellText(cell: ReportCell | undefined): string {
  return cell === null || cell === undefined ? "" : String(cell);
}

function matching(inputs: ReportTable, key: string, period: string | null): ReportTable["rows"] {
  return inputs.rows.filter(
    (row) => cellText(row[INPUT_KEY]) === key && (period === null || cellText(row[INPUT_PERIOD]) === period),
  );
}

function sumIfs(inputs: ReportTable, key: string, period: string | null): number {
  return matching(inputs, key, period).reduce<number>(
    (total, row) => total + (typeof row[INPUT_AMOUNT] === "number" ? row[INPUT_AMOUNT] : 0),
    0,
  );
}

/** A number for arithmetic, or the error Excel answers instead. A comparison is never one here. */
function numeric(value: Value, expression: string): number | CalcError {
  if (value instanceof CalcError) {
    return value;
  }
  if (value === BLANK) {
    return new CalcError("#VALUE!");
  }
  if (typeof value === "boolean") {
    throw new Error(`a comparison used as a number in ${expression}`);
  }
  return value;
}

function combine(left: Value, right: Value, expression: string, apply: (a: number, b: number) => Value): Value {
  const a = numeric(left, expression);
  if (a instanceof CalcError) {
    return a;
  }
  const b = numeric(right, expression);
  return b instanceof CalcError ? b : apply(a, b);
}

function truth(value: Value, expression: string): boolean | CalcError {
  if (value instanceof CalcError || typeof value === "boolean") {
    return value;
  }
  throw new Error(`a condition that is not a comparison in ${expression}`);
}

/**
 * A recursive-descent read of numbers, parentheses, unary signs, `+ - * /`, `=`, `""`, `ABS(…)`,
 * `IF(…,…,…)`, `OR(…)` and `IFERROR(…,…)`. Anything else throws.
 */
function evaluate(expression: string): Value {
  let at = 0;
  const take = (token: string): boolean => {
    if (!expression.startsWith(token, at)) {
      return false;
    }
    at += token.length;
    return true;
  };
  const expect = (token: string): void => {
    if (!take(token)) {
      throw new Error(`expected ${token} at ${at} in ${expression}`);
    }
  };
  const call = (): Value[] => {
    const args: Value[] = [comparison()];
    while (take(",")) {
      args.push(comparison());
    }
    expect(")");
    return args;
  };
  const primary = (): Value => {
    if (take('""')) {
      return BLANK;
    }
    if (take("ABS(")) {
      const [value] = call();
      const number = numeric(value as Value, expression);
      return number instanceof CalcError ? number : Math.abs(number);
    }
    if (take("IFERROR(")) {
      const [value, fallback] = call();
      return value instanceof CalcError ? (fallback as Value) : (value as Value);
    }
    if (take("IF(")) {
      const [test, yes, no] = call();
      const decided = truth(test as Value, expression);
      return decided instanceof CalcError ? decided : ((decided ? yes : no) as Value);
    }
    if (take("OR(")) {
      const tests = call().map((test) => truth(test, expression));
      return tests.find((test) => test instanceof CalcError) ?? tests.some((test) => test === true);
    }
    if (take("(")) {
      const value = comparison();
      expect(")");
      return value;
    }
    const number = NUMBER.exec(expression.slice(at));
    if (!number) {
      throw new Error(`unexpected "${expression.slice(at, at + 16)}" in ${expression}`);
    }
    at += number[0].length;
    return Number(number[0]);
  };
  const unary = (): Value => {
    if (take("-")) {
      const value = numeric(unary(), expression);
      return value instanceof CalcError ? value : -value;
    }
    if (take("+")) {
      return unary();
    }
    return primary();
  };
  const product = (): Value => {
    let value = unary();
    for (;;) {
      if (take("*")) {
        value = combine(value, unary(), expression, (a, b) => a * b);
      } else if (take("/")) {
        value = combine(value, unary(), expression, (a, b) => (b === 0 ? new CalcError("#DIV/0!") : a / b));
      } else {
        return value;
      }
    }
  };
  const sum = (): Value => {
    let value = product();
    for (;;) {
      if (take("+")) {
        value = combine(value, product(), expression, (a, b) => a + b);
      } else if (take("-")) {
        value = combine(value, product(), expression, (a, b) => a - b);
      } else {
        return value;
      }
    }
  };
  const comparison = (): Value => {
    const left = sum();
    if (!take("=")) {
      return left;
    }
    const right = sum();
    // The sheets only ever compare counts. Excel's rules for comparing a blank are not modelled.
    if (left === BLANK || right === BLANK) {
      throw new Error(`a blank compared in ${expression}`);
    }
    return combine(left, right, expression, (a, b) => a === b);
  };
  const value = comparison();
  if (at !== expression.length) {
    throw new Error(`trailing "${expression.slice(at)}" in ${expression}`);
  }
  return value;
}

/** What Excel shows for one Calc formula over these Inputs rows, or null where it shows a blank. */
export function evaluateCalcFormula(formula: string, inputs: ReportTable, calc: ReportTable): number | null {
  const periodOf = (row: string | undefined): string | null =>
    row === undefined ? null : cellText(calc.rows[Number(row) - REPORT_TABLE_FIRST_DATA_ROW]?.[CALC_PERIOD]);
  const substituted = formula
    .replace(SUMIFS, (_whole: string, key: string, row?: string) => `(${sumIfs(inputs, key, periodOf(row))})`)
    .replace(
      COUNTIFS,
      (_whole: string, key: string, row?: string) => `(${matching(inputs, key, periodOf(row)).length})`,
    );
  const value = evaluate(substituted);
  if (value instanceof CalcError) {
    throw new Error(`Excel shows ${value.code} for ${formula}`);
  }
  if (typeof value === "boolean") {
    throw new Error(`a cell that answers a comparison: ${formula}`);
  }
  return value === BLANK || !Number.isFinite(value) ? null : value;
}

export type CalcCheck = {
  readonly label: string;
  readonly period: string;
  readonly reported: number | null;
  readonly computed: number | null;
};

/** Every Calc row that carries a live formula: the value the report wrote beside the one Excel will compute. */
export function calcFormulaChecks(inputs: ReportTable, calc: ReportTable): CalcCheck[] {
  return calc.rows.flatMap((row, index) => {
    const formula = calc.formulas?.[index]?.[CALC_VALUE];
    if (typeof formula !== "string") {
      return [];
    }
    const reported = row[CALC_VALUE];
    return [
      {
        label: cellText(row[0]),
        period: cellText(row[CALC_PERIOD]),
        reported: typeof reported === "number" ? reported : null,
        computed: evaluateCalcFormula(formula, inputs, calc),
      },
    ];
  });
}

/** The checks whose two values disagree by more than a rounding error, for a readable failure. */
export function calcDrift(checks: readonly CalcCheck[]): CalcCheck[] {
  return checks.filter((check) => {
    if (check.reported === null || check.computed === null) {
      return check.reported !== check.computed;
    }
    return Math.abs(check.reported - check.computed) > Math.max(1e-6, Math.abs(check.reported) * 1e-9);
  });
}
