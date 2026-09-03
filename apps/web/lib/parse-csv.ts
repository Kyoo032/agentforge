export type CsvTable = {
  headers: string[];
  rows: string[][];
};

export function parseCsv(text: string): CsvTable | null {
  const lines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      lines.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    lines.push(row);
  }
  const nonEmpty = lines.filter((item) => item.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length < 2) {
    return null;
  }
  const headers = nonEmpty[0]!.map((h, idx) => h.trim() || `column_${idx + 1}`);
  const width = headers.length;
  const rows = nonEmpty.slice(1).map((item) => {
    const cells = item.slice(0, width);
    while (cells.length < width) {
      cells.push("");
    }
    return cells.map((cell) => cell.trim());
  });
  return { headers, rows };
}

export function csvSample(table: CsvTable, maxChars = 4000): string {
  const headerLine = table.headers.join(",");
  const out: string[] = [headerLine];
  let size = headerLine.length;
  for (const row of table.rows) {
    const line = row.join(",");
    if (size + line.length + 1 > maxChars) {
      out.push(`… (${table.rows.length - out.length + 1} more rows omitted)`);
      break;
    }
    out.push(line);
    size += line.length + 1;
  }
  return out.join("\n");
}
