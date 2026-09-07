/**
 * Source of the worker thread that owns one dataset's SQLite. Kept as a string so
 * it works the same under tsx (ESM) and inside the packaged CommonJS host bundle:
 * the main thread passes the resolved better-sqlite3 path, the DDL, and the rows.
 *
 * Protocol: {type:"load", modulePath, ddl, insertSql, rows, heapLimit} → {type:"loaded"}
 *           {type:"query", id, sql, rowCap, cellMax} → {type:"result", id, ok, result | error}
 */
export const SQL_WORKER_SOURCE = String.raw`
const { parentPort } = require("node:worker_threads");
let db = null;

function cell(value, cellMax) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) return "[blob " + value.byteLength + " bytes]";
  const text = String(value);
  return text.length > cellMax ? text.slice(0, cellMax) + "…" : text;
}

function load(message) {
  const Database = require(message.modulePath);
  db = new Database(":memory:");
  db.exec(message.ddl);
  const insert = db.prepare(message.insertSql);
  const run = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  run(message.rows);
  db.pragma("hard_heap_limit = " + message.heapLimit);
  db.pragma("query_only = 1");
  parentPort.postMessage({ type: "loaded" });
}

function query(message) {
  const started = Date.now();
  let statement;
  try {
    statement = db.prepare(message.sql);
  } catch (error) {
    parentPort.postMessage({ type: "result", id: message.id, ok: false, error: String(error && error.message || error) });
    return;
  }
  if (!statement.reader) {
    parentPort.postMessage({ type: "result", id: message.id, ok: false, error: "Only queries that return rows are allowed" });
    return;
  }
  try {
    const columns = statement.columns().map((column) => column.name);
    const rows = [];
    let rowCount = 0;
    let truncated = false;
    for (const record of statement.raw(true).iterate()) {
      rowCount += 1;
      if (rows.length < message.rowCap) {
        rows.push(record.map((value) => cell(value, message.cellMax)));
      } else {
        truncated = true;
        break;
      }
    }
    parentPort.postMessage({
      type: "result",
      id: message.id,
      ok: true,
      result: { columns, rows, rowCount, truncated, elapsedMs: Date.now() - started },
    });
  } catch (error) {
    parentPort.postMessage({ type: "result", id: message.id, ok: false, error: String(error && error.message || error) });
  }
}

parentPort.on("message", (message) => {
  if (message.type === "load") return load(message);
  if (message.type === "query") return query(message);
});
`;
