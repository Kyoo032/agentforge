/**
 * A register sheet written out as figures text, without losing a column.
 *
 * One line per entity, carrying the row's bottom line as its amount and every amount column it had
 * in braces behind it:
 *
 *   `Karyawan 1 (Oktober 2024): 9775000 {Gaji Pokok=8500000; Tunjangan=1700000; Gaji Bersih=9775000}`
 *
 * Two rules the braces exist to keep. The columns are *facts about the row*, never rows of their own,
 * so nothing downstream can add `gaji pokok` to `gaji bersih` and report a payroll at twice its size.
 * And a second block about the same people — a reimbursement list under the payroll — folds onto the
 * entities it names rather than becoming eight more line items; its column joins the braces with a
 * `+`, because it is money that was paid on top and it is the only kind of column that may.
 */
import type { SheetBlock } from "./layout";
import type { FinanceImportWarning } from "./limits";
import type { NumberStyle } from "./numbers";
import {
  derivedFlags,
  droppedRowsWarning,
  noteLine,
  rowContexts,
  tagged,
  type RowContext,
} from "./block-rows";
import { registerColumns, registerShape, registerSheetPeriod, type RegisterShape } from "./register";

/** Opens and closes the row's own columns. Read back by `readFiguresText`. */
export const REGISTER_OPEN = "{";
export const REGISTER_CLOSE = "}";
export const REGISTER_SEPARATOR = "; ";
/** Marks a column that is a *separate payment*, not a part of the row's bottom line. */
export const REGISTER_EXTRA_MARK = "+";

type ReadAmount = (cell: string) => string | null;
type BlockLines = { lines: string[]; warnings: FinanceImportWarning[] };

type Plan = {
  readonly block: SheetBlock;
  readonly contexts: RowContext[];
  readonly flags: boolean[];
  readonly shape: RegisterShape | null;
  readonly entityAt: number;
  readonly amountAt: readonly number[];
  /** The heading the sheet put above this block, when it put one there. */
  readonly title: string;
};

/** One payment from a folded block, keyed by the entity it belongs to. */
type Extra = { readonly key: string; readonly label: string; readonly amount: string };

function entityKey(label: string): string {
  return label.trim().toLowerCase();
}

/** The heading that opened this block: the last one-cell row of the block above it. */
function titleOf(blocks: readonly SheetBlock[], at: number): string {
  const above = blocks[at - 1];
  if (!above) {
    return "";
  }
  const contexts = rowContexts(above.body, 0);
  return [...contexts].reverse().find((context) => context.kind === "heading")?.label ?? "";
}

function planOf(blocks: readonly SheetBlock[], at: number, style: NumberStyle): Plan {
  const block = blocks[at] as SheetBlock;
  const { amountAt, entityAt } = registerColumns(block.header, block.body, style);
  const contexts = rowContexts(block.body, Math.max(entityAt, 0));
  return {
    block,
    contexts,
    flags: derivedFlags(block.body, contexts, amountAt, style),
    shape: registerShape(block.header, block.body, style),
    entityAt,
    amountAt,
    title: titleOf(blocks, at),
  };
}

/** The entities a block names on its own rows — the totals it prints are not entities. */
function entityKeys(plan: Plan): string[] {
  return plan.contexts.flatMap((context, at) =>
    context.kind === "row" && plan.flags[at] !== true ? [entityKey(context.label)] : [],
  );
}

/**
 * The register a one-amount block belongs to: the one that already names every entity this block
 * does. A reimbursement list under a payroll names three of the eight people on it, so its amounts
 * are three more facts about those three rows — not three new rows.
 */
function foldsInto(plan: Plan, registers: readonly Plan[]): Plan | null {
  const keys = entityKeys(plan);
  if (plan.shape !== null || plan.amountAt.length !== 1 || plan.entityAt < 0 || keys.length === 0) {
    return null;
  }
  return registers.find((register) => keys.every((key) => entityKeys(register).includes(key))) ?? null;
}

function extrasOf(plan: Plan, amount: ReadAmount): Extra[] {
  const column = plan.amountAt[0] as number;
  const label = plan.title || plan.block.header[column] || "Amount";
  return plan.contexts.flatMap((context, at) => {
    const cell = amount(plan.block.body[at]?.[column] ?? "");
    return context.kind === "row" && plan.flags[at] !== true && cell !== null
      ? [{ key: entityKey(context.label), label, amount: cell }]
      : [];
  });
}

function bracesFor(plan: Plan, at: number, amount: ReadAmount, extras: readonly Extra[]): string {
  const row = plan.block.body[at] ?? [];
  const shape = plan.shape as RegisterShape;
  const columns = shape.amountAt.flatMap((index) => {
    const cell = amount(row[index] ?? "");
    const name = plan.block.header[index] ?? "";
    return cell === null || name.trim() === "" ? [] : [`${name}=${cell}`];
  });
  const added = extras.map((extra) => `${REGISTER_EXTRA_MARK}${extra.label}=${extra.amount}`);
  const all = [...columns, ...added];
  return all.length === 0 ? "" : ` ${REGISTER_OPEN}${all.join(REGISTER_SEPARATOR)}${REGISTER_CLOSE}`;
}

function amountLine(label: string, period: string, figure: string, braces: string): string {
  return `${label}${period === "" ? "" : ` (${period})`}: ${figure}${braces}`;
}

/** Every row of a register block: one line per entity, one per total, notes kept as notes. */
function registerLines(
  plan: Plan,
  period: string,
  extras: ReadonlyMap<string, readonly Extra[]>,
  amount: ReadAmount,
): BlockLines {
  const shape = plan.shape as RegisterShape;
  const emitted = plan.block.body.map((row, at) => {
    const context = plan.contexts[at] as RowContext;
    if (context.kind === "note") {
      return { line: noteLine(context), dropped: "" };
    }
    const figure = amount(row[shape.netAt] ?? "") ?? amount(row[shape.amountAt.at(-1) ?? -1] ?? "");
    if (context.kind === "heading" || figure === null) {
      return { line: "", dropped: context.kind === "heading" ? "" : context.label };
    }
    const mine = plan.flags[at] === true ? [] : (extras.get(entityKey(context.label)) ?? []);
    const label = tagged(plan.flags[at] === true, context.section, context.label || "Amount");
    return { line: amountLine(label, period, figure, bracesFor(plan, at, amount, [...mine])), dropped: "" };
  });
  return {
    lines: emitted.map((entry) => entry.line).filter((line) => line !== ""),
    warnings: droppedRowsWarning(emitted.map((entry) => entry.dropped).filter((entry) => entry !== "")),
  };
}

/** A folded block keeps only the totals it printed; its rows now live in the register's braces. */
function foldedLines(plan: Plan, period: string, amount: ReadAmount): BlockLines {
  const column = plan.amountAt[0] as number;
  const lines = plan.block.body.flatMap((row, at) => {
    const context = plan.contexts[at] as RowContext;
    const figure = amount(row[column] ?? "");
    if (context.kind === "note") {
      return [noteLine(context)];
    }
    return context.kind === "row" && plan.flags[at] === true && figure !== null
      ? [amountLine(tagged(true, context.section, context.label), period, figure, "")]
      : [];
  });
  return { lines, warnings: [] };
}

/**
 * The whole sheet read as a register, or `null` when no block of it is one.
 *
 * `null` is the important half: every statement, ledger and key/value sheet the importer already
 * read keeps the exact lines it had, because this returns before it can write any.
 */
export function registerSheetLines(
  blocks: readonly SheetBlock[],
  rows: ReadonlyArray<ReadonlyArray<string>>,
  style: NumberStyle,
  amount: ReadAmount,
  fallback: (block: SheetBlock) => BlockLines,
): BlockLines[] | null {
  const plans = blocks.map((_block, at) => planOf(blocks, at, style));
  const registers = plans.filter((plan) => plan.shape !== null);
  if (registers.length === 0) {
    return null;
  }
  const folded = new Map<Plan, Plan>();
  const extras = new Map<string, Extra[]>();
  for (const plan of plans) {
    const host = registers.includes(plan) ? null : foldsInto(plan, registers);
    if (!host) {
      continue;
    }
    folded.set(plan, host);
    for (const extra of extrasOf(plan, amount)) {
      extras.set(extra.key, [...(extras.get(extra.key) ?? []), extra]);
    }
  }
  const period = registerSheetPeriod(rows);
  return plans.map((plan) => {
    if (registers.includes(plan)) {
      return registerLines(plan, period, extras, amount);
    }
    return folded.has(plan) ? foldedLines(plan, period, amount) : fallback(plan.block);
  });
}
