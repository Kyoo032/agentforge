import { describe, expect, it } from "vitest";
import { FILE_EXTRACT_MAX_CELL_CHARS, FILE_EXTRACT_MAX_TABLE_COLS } from "./limits";
import { markdownToText, parseMarkdownTables } from "./markdown-tables";

describe("parseMarkdownTables", () => {
  it("reads a GFM table and titles it with the nearest heading above it", () => {
    const markdown = [
      "# Report",
      "",
      "## Ringkasan",
      "",
      "| Label | 2024 |",
      "| --- | --- |",
      "| Pendapatan | 1250 |",
    ].join("\n");
    expect(parseMarkdownTables(markdown)).toEqual([
      {
        title: "Ringkasan",
        rows: [
          ["Label", "2024"],
          ["Pendapatan", "1250"],
        ],
      },
    ]);
  });

  it("leaves a table with no heading above it untitled", () => {
    const tables = parseMarkdownTables("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(tables).toEqual([
      {
        rows: [
          ["a", "b"],
          ["1", "2"],
        ],
      },
    ]);
    expect(tables[0]).not.toHaveProperty("title");
  });

  it("accepts every alignment row spelling and nothing else", () => {
    for (const alignment of ["| --- | --- |", "| :--- | ---: |", "| :-: | :---: |", "|-|-|"]) {
      expect(parseMarkdownTables(`| a | b |\n${alignment}\n| 1 | 2 |`)).toHaveLength(1);
    }
    // A second row of prose is not an alignment row, so none of this is a table.
    expect(parseMarkdownTables("| a | b |\n| x | y |\n| 1 | 2 |")).toEqual([]);
  });

  it("treats an escaped pipe as a character inside the cell, not a separator", () => {
    const tables = parseMarkdownTables("| formula | note |\n| --- | --- |\n| a \\| b | two \\| pipes \\| here |");
    expect(tables[0]?.rows[1]).toEqual(["a | b", "two | pipes | here"]);
  });

  it("drops the blank header row a CSV conversion leaves in front", () => {
    // Exactly what anydoc emits for a headerless CSV: an empty header, then the real first row.
    const tables = parseMarkdownTables("|  |  |\n| --- | --- |\n| Label | Amount |\n| Rent | 1200 |");
    expect(tables[0]?.rows).toEqual([
      ["Label", "Amount"],
      ["Rent", "1200"],
    ]);
  });

  it("pads short rows and cuts long ones to the header width", () => {
    const tables = parseMarkdownTables("| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |");
    expect(tables[0]?.rows).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
      ["1", "2", "3"],
    ]);
  });

  it("reads several tables in one document, each with its own heading", () => {
    const markdown = ["## Ringkasan", "| a |", "| --- |", "| 1 |", "", "## Anggaran", "| b |", "| --- |", "| 2 |"].join(
      "\n",
    );
    expect(parseMarkdownTables(markdown).map((table) => table.title)).toEqual(["Ringkasan", "Anggaran"]);
  });

  it("strips control characters and caps a cell", () => {
    const long = "x".repeat(FILE_EXTRACT_MAX_CELL_CHARS + 50);
    const tables = parseMarkdownTables(`| a | b |\n| --- | --- |\n| onetwo | ${long} |`);
    expect(tables[0]?.rows[1]?.[0]).toBe("one two");
    expect(tables[0]?.rows[1]?.[1]?.length).toBe(FILE_EXTRACT_MAX_CELL_CHARS);
  });

  it("caps the column count", () => {
    const width = FILE_EXTRACT_MAX_TABLE_COLS + 20;
    const cells = Array.from({ length: width }, (_unused, index) => `c${index}`).join(" | ");
    const dashes = Array.from({ length: width }, () => "---").join(" | ");
    const tables = parseMarkdownTables(`| ${cells} |\n| ${dashes} |\n| ${cells} |`);
    expect(tables[0]?.rows[0]).toHaveLength(FILE_EXTRACT_MAX_TABLE_COLS);
  });

  it("finds nothing in prose that merely mentions a pipe", () => {
    expect(parseMarkdownTables("Revenue | cost was discussed.\n\nNothing tabular here.")).toEqual([]);
  });
});

describe("emphasis a converter wrapped a whole cell in", () => {
  const MARKDOWN = [
    "## Laporan Laba Rugi Ringkas",
    "",
    "| **Uraian** | **2023** | **2024** |",
    "| --- | --- | --- |",
    "| Pendapatan usaha | 18.420.000.000 | 21.965.000.000 |",
    "| **Laba kotor** | **7.368.000.000** | **9.004.650.000** |",
  ].join("\n");

  it("takes the bold off, because a bold year is still a year", () => {
    const [table] = parseMarkdownTables(MARKDOWN);
    // A Word table writes its header and its subtotal rows in bold. Left on, `**2024**` stops
    // reading as a period and a two-year statement collapses into one undated column.
    expect(table?.rows[0]).toEqual(["Uraian", "2023", "2024"]);
    expect(table?.rows[2]).toEqual(["Laba kotor", "7.368.000.000", "9.004.650.000"]);
    expect(table?.title).toBe("Laporan Laba Rugi Ringkas");
  });

  it("leaves emphasis that is part of what the cell says", () => {
    const [table] = parseMarkdownTables(["| a | b |", "| --- | --- |", "| 3 * 4 | _rate_ per **unit** |"].join("\n"));
    expect(table?.rows[1]).toEqual(["3 * 4", "_rate_ per **unit**"]);
  });
});

describe("markdownToText", () => {
  it("unwraps headings, quotes, links and emphasis but keeps table rows", () => {
    const markdown = [
      "# Laporan",
      "",
      "> Pendapatan **naik** 25 persen, see [the note](https://example.invalid/x).",
      "",
      "| Label | 2024 |",
      "| --- | --- |",
      "| Pendapatan | 1250 |",
    ].join("\n");
    const text = markdownToText(markdown);
    expect(text).toContain("Laporan");
    expect(text).toContain("Pendapatan naik 25 persen, see the note.");
    expect(text).toContain("Label | 2024");
    expect(text).not.toContain("#");
    expect(text).not.toContain("https://");
  });

  it("drops the tables entirely when the caller only wants prose", () => {
    const markdown = "Prose before.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nProse after.";
    const prose = markdownToText(markdown, { withoutTables: true });
    expect(prose).toBe("Prose before.\n\nProse after.");
  });

  it("keeps an image's alt text and drops its source", () => {
    expect(markdownToText("![Grafik pendapatan](data:image/png;base64,AAAA)")).toBe("Grafik pendapatan");
  });
});
