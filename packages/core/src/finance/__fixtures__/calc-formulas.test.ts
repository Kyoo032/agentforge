import { describe, expect, it } from "vitest";
import type { ReportTable } from "../report";
import { evaluateCalcFormula } from "./calc-formulas";

/**
 * The evaluator the Calc-sheet tests trust to say what Excel will show. It has to tell a blank from an
 * error, because the report writes nothing where a pile is missing and a reader who sees "#VALUE!"
 * instead has been shown something the report never said.
 */
const INPUTS: ReportTable = {
  id: "inputs",
  title: "Inputs",
  columns: ["Label", "Period", "Bucket", "Amount", "Currency"],
  rows: [
    ["Kas", "2024", "cash", 100, "IDR"],
    ["Bank", "2024", "cash", 20, "IDR"],
    ["Utang usaha", "2024", "current-liability", 50, "IDR"],
    ["Kas", "2023", "cash", 80, "IDR"],
  ],
};

/** Calc row 2 reads 2024 and row 3 reads 2023, through their own Period cells. */
const CALC: ReportTable = {
  id: "calc",
  title: "Calc",
  columns: ["Metric", "Value", "Unit", "Period", "Formula"],
  rows: [
    ["Cash", 120, "IDR", "2024", ""],
    ["Cash", 80, "IDR", "2023", ""],
  ],
};

const count = (bucket: string, row = 2) => `COUNTIFS(Inputs!$C:$C,"${bucket}",Inputs!$B:$B,$D${row})`;
const sum = (bucket: string, row = 2) => `SUMIFS(Inputs!$D:$D,Inputs!$C:$C,"${bucket}",Inputs!$B:$B,$D${row})`;
const show = (formula: string) => evaluateCalcFormula(formula, INPUTS, CALC);

describe("evaluateCalcFormula", () => {
  it("sums and counts a bucket for the row's own period, or across every period", () => {
    expect(show(sum("cash"))).toBe(120);
    expect(show(sum("cash", 3))).toBe(80);
    expect(show('SUMIFS(Inputs!$D:$D,Inputs!$C:$C,"cash")')).toBe(200);
    expect(show(count("cash"))).toBe(2);
    expect(show(count("inventory"))).toBe(0);
    expect(show('COUNTIFS(Inputs!$C:$C,"cash")')).toBe(3);
  });

  it("answers the blank an IF writes where a pile has no row, and the value where it has", () => {
    expect(show(`IF(${count("inventory")}=0,"",${sum("inventory")})`)).toBeNull();
    expect(show(`IF(${count("cash")}=0,"",${sum("cash")})`)).toBe(120);
    expect(show(`IF(OR(${count("cash")}=0,${count("inventory")}=0),"",1)`)).toBeNull();
    expect(show(`IF(OR(${count("cash")}=0,${count("current-liability")}+${count("inventory")}=0),"",7)`)).toBe(7);
  });

  it("keeps the arithmetic Excel does: precedence, signs and ABS", () => {
    expect(show("2+3*4-10/5")).toBe(12);
    expect(show("-(2-5)*ABS(-2)")).toBe(6);
    expect(show(`${sum("cash")}-${sum("current-liability")}`)).toBe(70);
  });

  it("turns a division by zero into a blank only inside IFERROR", () => {
    expect(show(`IFERROR(${sum("cash")}/${sum("inventory")},"")`)).toBeNull();
    expect(() => show(`${sum("cash")}/${sum("inventory")}`)).toThrow(/#DIV\/0!/);
  });

  // Excel answers "" + 1 with #VALUE!; a blank that leaks into arithmetic is a broken cell, not a blank one.
  it("refuses to read a blank that leaks into arithmetic as a blank", () => {
    expect(() => show(`IF(1=1,"",1)+1`)).toThrow(/#VALUE!/);
    expect(() => show(`ABS(IF(1=1,"",1))`)).toThrow(/#VALUE!/);
    expect(show(`IFERROR(IF(1=1,"",1)+1,"")`)).toBeNull();
  });

  it("fails loudly on anything it does not know, rather than guessing", () => {
    expect(() => show("SUM(1,2)")).toThrow();
    expect(() => show("1+")).toThrow();
    expect(() => show('IF(1=1,"a",1)')).toThrow();
  });
});
