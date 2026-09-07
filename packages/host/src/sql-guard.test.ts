import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { assertReadOnlySql, quoteIdentifier, sqlTypeFor, toSqlIdentifier } from "./sql-guard";

describe("assertReadOnlySql", () => {
  it("accepts single SELECT / WITH statements and trims a trailing semicolon", () => {
    expect(assertReadOnlySql("  SELECT vendor, SUM(spend) FROM data GROUP BY 1; ")).toBe(
      "SELECT vendor, SUM(spend) FROM data GROUP BY 1",
    );
    expect(assertReadOnlySql("with t as (select 1 as a) select * from t")).toMatch(/^with/);
    expect(assertReadOnlySql("SELECT * FROM data WHERE note = 'drop table; update'")).toContain("drop table");
    expect(assertReadOnlySql("SELECT a.vendor FROM data a JOIN data b ON a.vendor = b.vendor")).toContain("JOIN");
    expect(assertReadOnlySql("SELECT count(*) FROM data a, data b WHERE a.rowid < b.rowid")).toContain("WHERE");
  });

  it("rejects writes, schema changes, extensions, pragmas, comments, and multiple statements", () => {
    const bad = [
      "",
      "INSERT INTO data VALUES (1)",
      "SELECT 1; DROP TABLE data",
      "PRAGMA table_info(data)",
      "ATTACH DATABASE 'x' AS y",
      "SELECT load_extension('x')",
      "SELECT 1 -- comment",
      "SELECT /* c */ 1",
      "UPDATE data SET a = 1",
      "DELETE FROM data",
      "SELECT readfile('/etc/passwd')",
      "SELECT * FROM pragma_table_info('data')",
      "SELECT * FROM pragma_database_list",
      "SELECT sql FROM sqlite_master",
      "SELECT length(randomblob(999999999))",
      "SELECT zeroblob(999999999)",
      "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c",
      "SELECT count(*) FROM data a, data b",
      "SELECT count(*) FROM data a JOIN data b",
    ];
    for (const sql of bad) {
      expect(() => assertReadOnlySql(sql), sql).toThrow(ApiError);
    }
  });
});

describe("identifiers and types", () => {
  it("builds unique, non-reserved identifiers", () => {
    expect(toSqlIdentifier("Vendor Name", [])).toBe("vendor_name");
    expect(toSqlIdentifier("2024 spend ($)", [])).toBe("c_2024_spend");
    expect(toSqlIdentifier("select", [])).toBe("c_select");
    expect(toSqlIdentifier("", [])).toBe("c_col");
    expect(toSqlIdentifier("Spend", ["spend"])).toBe("spend_2");
    expect(toSqlIdentifier("Spend", ["spend", "spend_2"])).toBe("spend_3");
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
  });

  it("maps column types to SQLite affinities", () => {
    expect(sqlTypeFor("number")).toBe("REAL");
    expect(sqlTypeFor("boolean")).toBe("INTEGER");
    expect(sqlTypeFor("date")).toBe("TEXT");
    expect(sqlTypeFor("string")).toBe("TEXT");
  });
});
