import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import {
  assertReadOnlySql,
  escapeLikePattern,
  LIKE_ESCAPE,
  quoteIdentifier,
  sqlTypeFor,
  toSqlIdentifier,
} from "./sql-guard";

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

  it("refuses the statements an audit asks about by name", () => {
    // The dataset runner executes SQL the user wrote, so the guard is the control. These are the
    // exact payloads a SQL-injection audit tries: reach the app database, rewrite the schema,
    // load code, write rows, or smuggle a second statement past a harmless-looking SELECT.
    const audit = [
      "ATTACH DATABASE '/data/agentforge.sqlite' AS a",
      'attach database "C:/Users/x/AppData/Roaming/DPSBuddy/agentforge.sqlite" as leak',
      "DETACH DATABASE a",
      "PRAGMA writable_schema=1",
      "pragma query_only = 0",
      "SELECT load_extension('x')",
      "INSERT INTO data VALUES (1)",
      "CREATE TABLE evil (a)",
      "SELECT 1; SELECT 2",
      "SELECT 1;\nDROP TABLE data",
      "VACUUM",
      ".tables",
      ".dump",
      "SELECT * FROM dbstat",
      "SELECT * FROM sqlite_dbpage",
    ];
    for (const sql of audit) {
      const error = (() => {
        try {
          assertReadOnlySql(sql);
          return null;
        } catch (reason) {
          return reason;
        }
      })();
      expect(error, sql).toBeInstanceOf(ApiError);
      expect((error as ApiError).code, sql).toBe("invalid_sql");
      expect((error as ApiError).status, sql).toBe(400);
    }
  });
});

describe("assertReadOnlySql and quoted identifiers", () => {
  it("rejects a blocked name that hides inside a double-quoted identifier", () => {
    // SQLite resolves `"sqlite_master"` to the schema table exactly as the bare name does, so a
    // guard that skipped over double-quoted text handed the deny-list a blind spot.
    const quoted = [
      'SELECT * FROM "sqlite_master"',
      'SELECT * FROM "SQLITE_MASTER"',
      'SELECT * FROM "sqlite_schema"',
      'SELECT * FROM "sqlite_dbpage"',
      'SELECT * FROM "dbstat"',
      `SELECT "load_extension"('x')`,
      `SELECT * FROM "pragma_table_info"('data')`,
      `"ATTACH" DATABASE 'x' AS y`,
      'SELECT * FROM data JOIN "sqlite_master" ON 1 = 1',
    ];
    for (const sql of quoted) {
      const error = (() => {
        try {
          assertReadOnlySql(sql);
          return null;
        } catch (reason) {
          return reason;
        }
      })();
      expect(error, sql).toBeInstanceOf(ApiError);
      expect((error as ApiError).code, sql).toBe("invalid_sql");
      expect((error as ApiError).status, sql).toBe(400);
    }
  });

  it("rejects a quoted identifier carrying a newline or a NUL", () => {
    expect(() => assertReadOnlySql('SELECT "a\nb" FROM data')).toThrow(ApiError);
    expect(() => assertReadOnlySql('SELECT "a\r\nb" FROM data')).toThrow(ApiError);
    expect(() => assertReadOnlySql('SELECT "a\u0000b" FROM data')).toThrow(ApiError);
  });

  it("rejects a single quote smuggled through a double-quoted identifier", () => {
    // SQLite reads `"a'"` as an identifier, so the `'` inside it never opens a string. A guard that
    // paired it with a later quote would mask that whole span - and the keyword inside it - away.
    expect(() => assertReadOnlySql(`SELECT "a'", (SELECT sql FROM sqlite_master WHERE 1='1')`)).toThrow(ApiError);
    // The other side of the same rule: once the identifier is consumed, `'attach'` is an ordinary
    // string literal to SQLite and to the guard, so it stays allowed.
    expect(assertReadOnlySql(`SELECT "x'" FROM data WHERE b = 'attach'`)).toContain("attach");
  });

  it("rejects an unterminated string or identifier instead of guessing where it ends", () => {
    expect(() => assertReadOnlySql('SELECT "a FROM data')).toThrow(ApiError);
    expect(() => assertReadOnlySql("SELECT 'a FROM data")).toThrow(ApiError);
  });

  it("still accepts ordinary quoted identifiers and string literals", () => {
    expect(assertReadOnlySql('SELECT "vendor" FROM data')).toBe('SELECT "vendor" FROM data');
    expect(assertReadOnlySql('SELECT "a""b" FROM data')).toBe('SELECT "a""b" FROM data');
    expect(assertReadOnlySql("SELECT * FROM data WHERE note = 'a''b -- ; drop'")).toContain("drop");
    expect(assertReadOnlySql(`SELECT 'it''s attached' AS note FROM data`)).toContain("attached");
  });
});

describe("escapeLikePattern", () => {
  it("escapes the wildcards and the escape character itself", () => {
    expect(escapeLikePattern("plain")).toBe("plain");
    expect(escapeLikePattern("ds_1")).toBe("ds\\_1");
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
    // The backslash is escaped first, so an already-escaped wildcard is not un-escaped.
    expect(escapeLikePattern("a\\%b")).toBe("a\\\\\\%b");
    expect(escapeLikePattern("")).toBe("");
  });

  it("makes a wildcard match exactly one row in SQLite", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (v TEXT)");
    const insert = db.prepare("INSERT INTO t (v) VALUES (?)");
    for (const value of ["ds_1", "dsX1", "ds%1", "ds-anything-1", "ds\\1", "ds1"]) {
      insert.run(value);
    }
    const like = db.prepare(`SELECT v FROM t WHERE v LIKE ? ESCAPE '${LIKE_ESCAPE}'`);
    const hits = (needle: string) =>
      (like.all(`%${escapeLikePattern(needle)}%`) as Array<{ v: string }>).map((row) => row.v);

    expect(hits("ds_1")).toEqual(["ds_1"]);
    expect(hits("ds%1")).toEqual(["ds%1"]);
    expect(hits("ds\\1")).toEqual(["ds\\1"]);
    expect(hits("' OR 1=1 --")).toEqual([]);
    db.close();
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
