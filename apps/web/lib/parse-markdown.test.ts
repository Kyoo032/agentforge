import { describe, expect, it } from "vitest";
import { markdownPlainText, parseMarkdown, safeHref } from "./parse-markdown";

describe("parseMarkdown", () => {
  it("turns bold list items into structured blocks", () => {
    const blocks = parseMarkdown(
      "I can help with:\n- **Questions and writing:** draft and edit\n- **Research:** search the web",
    );
    expect(blocks[0]).toMatchObject({ type: "p" });
    expect(blocks[1]).toMatchObject({ type: "ul" });
    if (blocks[1]?.type !== "ul") {
      return;
    }
    expect(blocks[1].items[0]?.[0]).toMatchObject({ type: "strong" });
    expect(markdownPlainText("I can help with:\n- **Questions:** draft")).toContain("Questions");
    expect(markdownPlainText("I can help with:\n- **Questions:** draft")).not.toContain("**");
  });

  it("keeps fenced code raw and drops javascript links", () => {
    const blocks = parseMarkdown("```\n**not bold**\n```\n[x](javascript:alert(1))");
    expect(blocks[0]).toEqual({ type: "pre", value: "**not bold**" });
    expect(blocks[1]).toMatchObject({ type: "p" });
    if (blocks[1]?.type !== "p") {
      return;
    }
    expect(blocks[1].children.some((node) => node.type === "link")).toBe(false);
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://example.com")).toBe("https://example.com");
  });

  it("parses images and headings", () => {
    const blocks = parseMarkdown("## Title\n\n![cat](https://example.com/cat.png)");
    expect(blocks[0]).toMatchObject({ type: "h", level: 2 });
    expect(blocks[1]).toMatchObject({ type: "p" });
    if (blocks[1]?.type !== "p") {
      return;
    }
    expect(blocks[1].children[0]).toMatchObject({ type: "image", alt: "cat" });
  });
});

describe("parseMarkdown tables", () => {
  const twoCol = "| Name | Age |\n| --- | --- |\n| Ann | 30 |\n| Bob | 41 |";

  it("parses a basic two-column table with outer pipes", () => {
    const blocks = parseMarkdown(twoCol);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "table", align: [null, null] });
    if (blocks[0]?.type !== "table") {
      return;
    }
    expect(blocks[0].header).toEqual([[{ type: "text", value: "Name" }], [{ type: "text", value: "Age" }]]);
    expect(blocks[0].rows).toEqual([
      [[{ type: "text", value: "Ann" }], [{ type: "text", value: "30" }]],
      [[{ type: "text", value: "Bob" }], [{ type: "text", value: "41" }]],
    ]);
  });

  it("parses a table without outer pipes", () => {
    const blocks = parseMarkdown("Name | Age\n--- | ---\nAnn | 30");
    expect(blocks[0]).toMatchObject({ type: "table" });
    if (blocks[0]?.type !== "table") {
      return;
    }
    expect(blocks[0].header).toHaveLength(2);
    expect(blocks[0].rows).toEqual([[[{ type: "text", value: "Ann" }], [{ type: "text", value: "30" }]]]);
  });

  it("reads column alignment from the delimiter row", () => {
    const blocks = parseMarkdown("| a | b | c | d |\n|:---|:---:|---:|---|\n| 1 | 2 | 3 | 4 |");
    expect(blocks[0]).toMatchObject({ type: "table", align: ["left", "center", "right", null] });
  });

  it("treats an escaped pipe inside a cell as a literal pipe", () => {
    const blocks = parseMarkdown("| Expr | Result |\n| --- | --- |\n| a \\| b | c |");
    if (blocks[0]?.type !== "table") {
      throw new Error("expected table");
    }
    expect(blocks[0].rows[0]?.[0]).toEqual([{ type: "text", value: "a | b" }]);
    expect(blocks[0].rows[0]?.[1]).toEqual([{ type: "text", value: "c" }]);
  });

  it("pads ragged body rows to the header width and truncates extra cells", () => {
    const blocks = parseMarkdown("| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |");
    if (blocks[0]?.type !== "table") {
      throw new Error("expected table");
    }
    expect(blocks[0].rows[0]).toEqual([[{ type: "text", value: "1" }], [], []]);
    expect(blocks[0].rows[1]).toHaveLength(3);
  });

  it("parses inline bold and links inside cells", () => {
    const blocks = parseMarkdown("| Item | Link |\n| --- | --- |\n| **Bold** | [site](https://example.com) |");
    if (blocks[0]?.type !== "table") {
      throw new Error("expected table");
    }
    expect(blocks[0].rows[0]?.[0]?.[0]).toMatchObject({ type: "strong" });
    expect(blocks[0].rows[0]?.[1]?.[0]).toMatchObject({ type: "link", href: "https://example.com" });
  });

  it("splits a paragraph immediately followed by a table into p + table", () => {
    const blocks = parseMarkdown("Here is data:\n| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "p", children: [{ type: "text", value: "Here is data:" }] });
    expect(blocks[1]).toMatchObject({ type: "table" });
  });

  it("ends a table at a blank line and resumes with a paragraph", () => {
    const blocks = parseMarkdown(`${twoCol}\n\nAfter the table.`);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "table" });
    expect(blocks[1]).toEqual({ type: "p", children: [{ type: "text", value: "After the table." }] });
  });

  it("keeps a lone line with a pipe and no delimiter row as a paragraph", () => {
    const blocks = parseMarkdown("either | or\nnext line");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "p" });
  });

  it("includes table cell text in markdownPlainText", () => {
    const plain = markdownPlainText(twoCol);
    expect(plain).toContain("Name Age");
    expect(plain).toContain("Ann 30");
    expect(plain).toContain("Bob 41");
    expect(plain).not.toContain("|");
    expect(plain).not.toContain("---");
  });
});
