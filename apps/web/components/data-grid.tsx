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
  "sticky top-0 z-10 border-b border-mist bg-paper px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-ink/55";
const CELL_CLASS = "border-b border-mist/70 px-3 py-1.5 align-top text-ink/85";

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
    return `${CELL_CLASS} text-ink/35`;
  }
  if (typeof cell === "number") {
    return `${CELL_CLASS} text-right font-mono tabular-nums`;
  }
  return CELL_CLASS;
}

function Cell({ cell }: { cell: DataGridCell }) {
  return <td className={cellClass(cell)}>{cellText(cell)}</td>;
}

/** Scrollable table with a sticky header. Slices to `maxRows` instead of virtualizing. */
export function DataGrid({ columns, rows, maxRows = DEFAULT_MAX_ROWS, testId, caption }: Props) {
  const visible = rows.slice(0, Math.max(0, maxRows));
  const truncated = rows.length > visible.length;
  return (
    <div data-testid={testId}>
      {caption ? <p className="mb-2 text-sm font-semibold text-ink">{caption}</p> : null}
      <div className="max-h-[420px] overflow-auto rounded-lg border border-mist">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={`${HEADER_CLASS} w-10 text-right`}>
                #
              </th>
              {columns.map((column, index) => (
                <th key={`${column}-${index}`} scope="col" className={HEADER_CLASS}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
              <tr key={rowIndex}>
                <td className={`${CELL_CLASS} text-right font-mono tabular-nums text-ink/40`}>{rowIndex + 1}</td>
                {columns.map((column, columnIndex) => (
                  <Cell key={`${column}-${columnIndex}`} cell={row[columnIndex] ?? null} />
                ))}
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td className={`${CELL_CLASS} text-ink/45`} colSpan={columns.length + 1}>
                  No rows.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {truncated ? (
        <p className="mt-1.5 text-[11px] text-ink/50">
          Showing first {visible.length} of {rows.length} rows
        </p>
      ) : null}
    </div>
  );
}
