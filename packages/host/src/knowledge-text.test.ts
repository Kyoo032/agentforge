import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ftsSourceFilter, knowledgeFtsQuery } from "./knowledge-text";

/**
 * `knowledgeFtsQuery` is the only thing standing between request text and an FTS5 MATCH
 * expression. The bind parameter stops SQL injection; it does NOT stop *query* injection —
 * `NEAR`, `OR`, `*`, `^`, `-` and `:` are operators inside a MATCH string, and a bare quote
 * ends the expression mid-parse. So every token has to leave here as one quoted FTS5 phrase
 * with its inner quotes doubled, and the result has to parse against a real FTS5 table.
 */

const SECRET = "alpha bravo charlie confidential";
const OTHER = "delta echo foxtrot public";

let db: Database.Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.exec("CREATE VIRTUAL TABLE chunks USING fts5(body)");
  const insert = db.prepare("INSERT INTO chunks (body) VALUES (?)");
  insert.run(SECRET);
  insert.run(OTHER);
});

afterAll(() => {
  db.close();
});

/** Rows a generated MATCH expression returns, or the SQLite error it raised. */
function match(query: string): { rows: string[] } | { error: string } {
  const expression = knowledgeFtsQuery(query);
  if (!expression) {
    return { rows: [] };
  }
  try {
    const rows = db.prepare("SELECT body FROM chunks WHERE chunks MATCH ?").all(expression) as Array<{ body: string }>;
    return { rows: rows.map((row) => row.body) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "error" };
  }
}

const NUL = String.fromCharCode(0);

/** Payloads a hosted search box will eventually be handed. None may error or reach another row. */
const PAYLOADS: Array<[name: string, value: string]> = [
  ["classic SQL injection", "' OR 1=1 --"],
  ["statement break", '"); DROP TABLE users; --'],
  ["FTS5 operators", "NEAR OR AND *"],
  ["column filter", "body:confidential OR body:alpha"],
  ["prefix star", "conf* OR alp*"],
  ["initial token operator", "^confidential"],
  ["negation", "-zulu confidential"],
  ["LIKE wildcards", "100% off _every_ item"],
  ["embedded NUL", `xxx${NUL}yyy`],
  ["unbalanced quote", 'confidential" OR "'],
  ["unicode and emoji", "naïve 🙂 résumé"],
  ["backslashes", "c:\\\\temp\\\\secret"],
];

describe("knowledgeFtsQuery", () => {
  it("wraps every token in a quoted FTS5 phrase and doubles the inner quotes", () => {
    expect(knowledgeFtsQuery("vendor concentration risk")).toBe('"vendor" OR "concentration" OR "risk"');
    expect(knowledgeFtsQuery('say "hello" now')).toBe('"say" OR """hello""" OR "now"');
    expect(knowledgeFtsQuery("  ")).toBe("");
  });

  it("drops control characters instead of letting one truncate the whole expression", () => {
    // SQLite parses a MATCH expression as a C string: an embedded NUL ends it early and the
    // trailing quote is never seen, so one stray byte used to cost the query every result.
    expect(knowledgeFtsQuery(`alpha${NUL}bravo`)).toBe('"alphabravo"');
    expect(knowledgeFtsQuery("alpha\u0007\tbravo")).toBe('"alpha" OR "bravo"');
  });

  it("caps the expression at eight tokens", () => {
    const many = knowledgeFtsQuery("one two three four five six seven eight nine ten");
    expect(many.split(" OR ")).toHaveLength(8);
  });

  it.each(PAYLOADS)("keeps %s literal: no SQLite error and no other row", (_name, payload) => {
    const outcome = match(payload);
    expect(outcome).not.toHaveProperty("error");
    expect("rows" in outcome ? outcome.rows : []).not.toContain(OTHER);
  });

  it("still matches the words a real search is asking for", () => {
    expect(match("confidential charlie")).toEqual({ rows: [SECRET] });
    // An operator word next to a real word must not turn into an operator.
    expect(match("AND confidential")).toEqual({ rows: [SECRET] });
  });

  it("never lets an operator payload widen a search into every row", () => {
    // `NEAR OR AND *` unquoted is a valid expression that FTS5 would run; quoted it is three
    // literal words nothing in the corpus holds.
    expect(match("NEAR OR AND *")).toEqual({ rows: [] });
  });
});

describe("ftsSourceFilter", () => {
  /** The shape the chunk reads use: a MATCH that plans on the FTS index instead of scanning. */
  let scoped: Database.Database;

  beforeAll(() => {
    scoped = new Database(":memory:");
    scoped.exec("CREATE VIRTUAL TABLE chunks USING fts5(source_id, body)");
    const insert = scoped.prepare("INSERT INTO chunks (source_id, body) VALUES (?, ?)");
    insert.run("src-one", SECRET);
    insert.run("src-two", OTHER);
  });

  afterAll(() => {
    scoped.close();
  });

  function bodies(sourceId: string): string[] {
    const rows = scoped
      .prepare("SELECT body FROM chunks WHERE chunks MATCH ? ORDER BY rowid")
      .all(ftsSourceFilter(sourceId)) as Array<{ body: string }>;
    return rows.map((row) => row.body);
  }

  it("reads one source's chunks and no other source's", () => {
    expect(bodies("src-one")).toEqual([SECRET]);
    expect(bodies("src-two")).toEqual([OTHER]);
  });

  it("keeps a crafted source id from escaping the column filter", () => {
    // A bare quote used to end the phrase, which would turn the rest of the id into query syntax
    // and let a caller read chunks it never named. Doubling the quote keeps it inside the phrase.
    expect(ftsSourceFilter('src-one" OR body:confidential OR "')).toBe(
      'source_id:"src-one"" OR body:confidential OR """',
    );
    expect(bodies('src-one" OR body:confidential OR "')).toEqual([]);
    expect(bodies("src-one OR src-two")).toEqual([]);
    expect(bodies("*")).toEqual([]);
  });
});
