"use client";

export type DataGridCell = string | number | boolean | null;

type Props = {
  columns: string[];
  rows: Array<Array<DataGridCell>>;
  maxRows?: number;
  testId?: string;
  caption?: string;
};

const DEFAULT_MAX_ROWS = 100;
const EM_DASH = "—";
const HEADER_CLASS =
  "sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-2)]";
const CELL_CLASS = "border-b border-[var(--line)] px-3 py-1.5 align-top text-[var(--text)]";

function cellText(cell: DataGridCell): string {
  if (cell === null) {
    return EM_DASH;
  }
  if (typeof cell === "boolean") {
    return cell ? "true" : "false";
  }
  return String(cell);
}

function cellClass(cell: DataGridCell): string {
  if (cell === null) {
    return `${CELL_CLASS} text-[var(--text-3)]`;
  }
  if (typeof cell === "number") {
    return `${CELL_CLASS} text-right font-mono tabular-nums`;
  }
  return CELL_CLASS;
}

function Cell({ cell }: { cell: DataGridCell }) {
  return <td className={cellClass(cell)}>{cellText(cell)}</td>;
}

export function DataGrid({ columns, rows, maxRows = DEFAULT_MAX_ROWS, testId, caption }: Props) {
  const visible = rows.slice(0, Math.max(0, maxRows));
  const truncated = rows.length > visible.length;
  return (
    <div className="overflow-auto" data-testid={testId}>
      {caption ? <p className="mb-2 text-xs text-[var(--text-2)]">{caption}</p> : null}
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <tr>
            <th className={`${HEADER_CLASS} w-10 text-right`} scope="col">
              #
            </th>
            {columns.map((column) => (
              <th key={column} className={HEADER_CLASS} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td className={`${CELL_CLASS} text-right font-mono tabular-nums text-[var(--text-3)]`}>{rowIndex + 1}</td>
              {columns.map((_, colIndex) => (
                <Cell key={colIndex} cell={row[colIndex] ?? null} />
              ))}
            </tr>
          ))}
          {visible.length === 0 ? (
            <tr>
              <td className={`${CELL_CLASS} text-[var(--text-3)]`} colSpan={columns.length + 1}>
                No rows
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {truncated ? (
        <p className="mt-1.5 text-xs text-[var(--text-2)]">
          Showing {visible.length} of {rows.length} rows
        </p>
      ) : null}
    </div>
  );
}
