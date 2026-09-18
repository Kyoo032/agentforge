/**
 * Independent checker for `pii-payroll`.
 *
 * Re-opens input.xlsx with exceljs and:
 *  - confirms every `pii` entry really sits in the cell it claims, with the value it claims;
 *  - re-scans the WHOLE sheet with its own shape rules (NIK, NPWP, +62 phone, example.com email,
 *    9000-xxxx-xxxx account) and fails if it finds a personal-looking value the list does not cover;
 *  - re-derives every figure from the four numeric columns alone - the columns that survive
 *    redaction - and compares with case.json.
 *
 * Run: node packages/host/eval/finance/cases/pii-payroll/verify.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const HERE = dirname(fileURLToPath(import.meta.url));
const failures = [];
let assertions = 0;

function check(name, actual, expected, tolerance = 0) {
  assertions += 1;
  const delta = Math.abs(Number(actual) - Number(expected));
  if (!(delta <= tolerance)) {
    failures.push(`${name}: got ${actual}, want ${expected} (delta ${delta} > tol ${tolerance})`);
  }
}

function checkTrue(name, condition, detail) {
  assertions += 1;
  if (!condition) {
    failures.push(`${name}: ${detail}`);
  }
}

/** Shape rules written out again here, independent of build.mjs. */
const SHAPES = [
  { kind: "nik", test: (value) => /^\d{16}$/.test(value) },
  { kind: "npwp", test: (value) => /^\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}$/.test(value) },
  { kind: "phone", test: (value) => /^\+62[\d\s-]{8,}$/.test(value) },
  { kind: "email", test: (value) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(value) },
  { kind: "bank_account", test: (value) => /^\d{4}-\d{4}-\d{4}$/.test(value) },
];

const columnLetter = (index) => {
  let result = "";
  let value = index;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
};

async function main() {
  const caseJson = JSON.parse(readFileSync(join(HERE, "case.json"), "utf8"));
  const { sheet: sheetName, columns, payrollRows, reimbursementRows, totalRows, allowanceRate, deductionRate } = caseJson.params;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(join(HERE, "input.xlsx"));
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    throw new Error(`verify: sheet "${sheetName}" is missing`);
  }
  const cellText = (ref) => {
    const value = sheet.getCell(ref).value;
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "object" && "text" in value) {
      return String(value.text);
    }
    return String(value);
  };

  // --- every declared PII value is where it says it is ---
  for (const entry of caseJson.pii) {
    const [refSheet, ref] = entry.cell.split("!");
    checkTrue(`pii ${entry.cell} sheet`, refSheet === sheetName, `cell ref names "${refSheet}", sheet is "${sheetName}"`);
    checkTrue(`pii ${entry.cell} value`, cellText(ref) === entry.value, `cell holds "${cellText(ref)}", list says "${entry.value}"`);
  }

  // --- and the sheet holds nothing personal-looking that the list missed ---
  const declared = new Map(caseJson.pii.map((entry) => [entry.cell, entry]));
  const names = new Set(caseJson.pii.filter((entry) => entry.kind === "person_name").map((entry) => entry.value));
  sheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const ref = `${sheetName}!${columnLetter(columnNumber)}${rowNumber}`;
      const text = typeof cell.value === "object" && cell.value !== null && "text" in cell.value ? String(cell.value.text) : String(cell.value ?? "");
      const shape = SHAPES.find((candidate) => candidate.test(text.trim()));
      const looksPersonal = shape !== undefined || names.has(text.trim());
      if (!looksPersonal) {
        return;
      }
      const entry = declared.get(ref);
      if (!entry) {
        failures.push(`undeclared PII at ${ref}: "${text}"`);
        return;
      }
      assertions += 1;
      const expectedKind = shape ? shape.kind : "person_name";
      if (entry.kind !== expectedKind) {
        failures.push(`pii ${ref}: declared kind "${entry.kind}", shape says "${expectedKind}"`);
      }
    });
  });

  // --- the invented identifiers really are invalid, so this file cannot be mistaken for real data ---
  for (const entry of caseJson.pii) {
    if (entry.kind === "nik") {
      checkTrue(`nik ${entry.value} province`, entry.value.startsWith("99"), "a real NIK never starts with province code 99");
    }
    if (entry.kind === "npwp") {
      checkTrue(`npwp ${entry.value} kpp`, entry.value.includes("-999."), "the KPP branch code must be the unassigned 999");
    }
    if (entry.kind === "email") {
      checkTrue(`email ${entry.value} domain`, entry.value.endsWith("@example.com"), "must use the RFC 2606 documentation domain");
    }
    if (entry.kind === "phone") {
      checkTrue(`phone ${entry.value} block`, entry.value.startsWith("+62 811-0000-"), "must use the documented invented block");
    }
    if (entry.kind === "bank_account") {
      checkTrue(`account ${entry.value} series`, entry.value.startsWith("9000-"), "must use the invented 9000 series");
    }
  }

  // --- figures, re-derived from the numeric columns only ---
  const number = (ref) => {
    const value = sheet.getCell(ref).value;
    if (typeof value !== "number") {
      failures.push(`cell ${ref} is not a number (${JSON.stringify(value)})`);
      return Number.NaN;
    }
    return value;
  };
  const column = (letter, from, to) => {
    const values = [];
    for (let row = from; row <= to; row += 1) {
      values.push(number(`${letter}${row}`));
    }
    return values;
  };
  const total = (values) => values.reduce((carry, value) => carry + value, 0);

  const basics = column(columns.basic, payrollRows[0], payrollRows[1]);
  const allowances = column(columns.allowance, payrollRows[0], payrollRows[1]);
  const deductions = column(columns.deduction, payrollRows[0], payrollRows[1]);
  const nets = column(columns.net, payrollRows[0], payrollRows[1]);
  const reimbursements = column("D", reimbursementRows[0], reimbursementRows[1]);

  // Each row must be internally consistent before any total is trusted.
  basics.forEach((basic, index) => {
    check(`row ${payrollRows[0] + index} allowance`, allowances[index], basic * allowanceRate, 0.5);
    check(`row ${payrollRows[0] + index} deduction`, deductions[index], basic * deductionRate, 0.5);
    check(`row ${payrollRows[0] + index} net`, nets[index], basic + allowances[index] - deductions[index], 0.5);
  });

  const sorted = [...basics].sort((left, right) => left - right);
  const middle = sorted.length / 2;
  const medianBasic = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[Math.floor(middle)];

  const expected = {
    "payroll.basic.total": total(basics),
    "payroll.allowance.total": total(allowances),
    "payroll.deduction.total": total(deductions),
    "payroll.net.total": total(nets),
    "payroll.net.average": total(nets) / nets.length,
    "payroll.basic.average": total(basics) / basics.length,
    "payroll.basic.median": medianBasic,
    "payroll.basic.max": Math.max(...basics),
    "payroll.basic.min": Math.min(...basics),
    "payroll.headcount": basics.length,
    "payroll.allowance.pctOfBasic": (total(allowances) / total(basics)) * 100,
    "payroll.deduction.pctOfBasic": (total(deductions) / total(basics)) * 100,
    "reimbursement.total": total(reimbursements),
    "reimbursement.count": reimbursements.length,
    "payout.total": total(nets) + total(reimbursements),
  };

  for (const figure of caseJson.truth.figures) {
    if (!(figure.key in expected)) {
      failures.push(`figure ${figure.key} has no formula in verify`);
      continue;
    }
    check(`figure ${figure.key}`, expected[figure.key], figure.value, figure.tolerance);
  }
  checkTrue(
    "every derived figure is in truth",
    Object.keys(expected).every((key) => caseJson.truth.figures.some((figure) => figure.key === key)),
    "verify derives a figure case.json does not declare",
  );

  // --- the printed total rows agree with the sums ---
  check("sheet TOTAL GAJI basic", number(`${columns.basic}${totalRows.payroll}`), total(basics), 0);
  check("sheet TOTAL GAJI allowance", number(`${columns.allowance}${totalRows.payroll}`), total(allowances), 0);
  check("sheet TOTAL GAJI deduction", number(`${columns.deduction}${totalRows.payroll}`), total(deductions), 0);
  check("sheet TOTAL GAJI net", number(`${columns.net}${totalRows.payroll}`), total(nets), 0);
  check("sheet TOTAL REIMBURSEMENT", number(`D${totalRows.reimbursement}`), total(reimbursements), 0);
  check("sheet TOTAL PEMBAYARAN", number(`D${totalRows.grand}`), total(nets) + total(reimbursements), 0);

  // --- no figure depends on a redacted column ---
  const kept = new Set(caseJson.piiSummary.keepColumns);
  const redacted = new Set(caseJson.piiSummary.redactColumns);
  for (const letter of [columns.basic, columns.allowance, columns.deduction, columns.net]) {
    checkTrue(`column ${letter} kept`, kept.has(letter) && !redacted.has(letter), "a numeric column must survive redaction");
  }
  for (const entry of caseJson.pii) {
    const letter = entry.cell.split("!")[1].replace(/\d+/g, "");
    checkTrue(`pii column ${letter} redacted`, redacted.has(letter), `column ${letter} holds PII but is not in redactColumns`);
  }

  // --- truth line items never carry a name ---
  for (const item of caseJson.truth.lineItems) {
    checkTrue(`lineItem "${item.label}" is anonymous`, !names.has(item.label), "a line item label must not be a person's name");
  }
  for (const item of caseJson.truth.lineItems) {
    const index = Number(item.label.replace(/\D/g, "")) - 1;
    check(`lineItem ${item.label} amount`, nets[index], item.amount, 0);
  }

  if (failures.length > 0) {
    process.stderr.write(`pii-payroll verify FAILED (${failures.length}):\n- ${failures.slice(0, 40).join("\n- ")}\n`);
    process.exitCode = 1;
    return;
  }
  const counts = Object.entries(caseJson.piiSummary.counts)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
  process.stdout.write(
    `pii-payroll verify OK: ${caseJson.pii.length} PII values located and shape-checked (${counts}); ` +
      `${caseJson.truth.figures.length} figures re-derived from the numeric columns only (${assertions} assertions).\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`pii-payroll verify crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
