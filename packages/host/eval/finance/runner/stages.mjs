/**
 * The stages a case goes through, each of them a real HTTP call to the running
 * app: import the file(s), parse them into whatever the task proposes, generate,
 * and export.
 *
 * They live apart from the case runner for one reason. A stage that could not run
 * must END the case there, with the app's own words and no score — never with a
 * stand-in that then gets marked as if the app had answered. StageStopped is how
 * a stage says so, and keeping that contract in one small file makes it hard to
 * add a stage that quietly substitutes something.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readFinanceTable, tableToFiguresText } from "./ts-bridge.mjs";
import { AppError, exportDocxLegacy, exportReport, generateReport, importFile, parseTask } from "./client.mjs";
import {
  calcFormulaCheck,
  expectedChartParts,
  readDeckCharts,
  readWorkbook,
  summaryNumbersCheck,
} from "./artifacts.mjs";
import { amountsMatch } from "./numbers.mjs";
/** Formats every case exports; a case may narrow it with `exports: [...]`. */
export const DEFAULT_EXPORT_FORMATS = ["xlsx", "pptx"];

async function timed(fn) {
  const started = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - started) };
}

export function describe(error) {
  return error instanceof AppError
    ? { code: error.code, status: error.status, stage: error.stage, message: error.message }
    : {
        code: "harness_error",
        status: 0,
        stage: null,
        message: error instanceof Error ? error.message : String(error),
      };
}

/** A stage that could not run. Thrown so `runCase` can name where it stopped. */
export class StageStopped extends Error {
  constructor(stage, error) {
    super(error.message);
    this.name = "StageStopped";
    this.stage = stage;
    this.appError = error;
  }
}

/* ---------------------------------------------------------------------- import */

/**
 * The import route through the running app, or — when that route is not there —
 * the very same core reader the handler calls, run in this process.
 *
 * The fallback exists because the route can be newer than the host process that
 * is serving :3000. Recording it as a fallback keeps the result honest: the
 * figures are real, the HTTP hop was not taken, and the summary says so.
 */
export async function readOneFile(ctx, kase, file) {
  const path = join(kase.dir, file.path);
  try {
    const run = await timed(() => importFile(ctx, path, file.sheet));
    return { ok: true, via: "http", ...run.value, ms: run.ms };
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 404) {
      throw error;
    }
    const run = await timed(async () => {
      const bytes = await readFile(path);
      let sheets;
      try {
        ({ sheets } = readFinanceTable(bytes, file.path));
      } catch (cause) {
        // A .docx or .pdf: the finance import reads tables, not documents.
        const why = cause instanceof Error ? cause.message : String(cause);
        throw new AppError("unsupported_content_type", `${file.path} is not a readable table: ${why}`, 400, "import");
      }
      const chosen = file.sheet ? sheets.find((sheet) => sheet.name === file.sheet) : sheets[0];
      if (!chosen) {
        throw new AppError("invalid_request", `sheet ${file.sheet} is not in ${file.path}`, 400, "import");
      }
      return { figuresText: tableToFiguresText(chosen), sheet: chosen.name, sheets: [], pii: null };
    });
    return { ok: false, via: "core-fallback", ...run.value, ms: run.ms, error: describe(error) };
  }
}

/**
 * `apps/web/lib/finance-brief.ts:mergeFigures`, to the letter: one newline between
 * what is already in the box and what the next sheet added. The whitespace matters
 * — the parse reads line-oriented text, and a blank line between two sheets is not
 * what a person clicking "add this sheet" twice would produce.
 */
export function mergeFigures(current, added) {
  const typed = typeof current === "string" ? current : "";
  const incoming = typeof added === "string" ? added.trim() : "";
  if (incoming === "") {
    return typed;
  }
  return typed.trim() === "" ? incoming : `${typed.replace(/\s+$/, "")}\n${incoming}`;
}

/** More sheets than a person would ever add by hand. A runaway workbook stops here. */
export const MAX_SHEETS_PER_FILE = 12;

/**
 * Every sheet of one file the case wants.
 *
 * The import route answers one sheet per call, so the studio asks again for each
 * sheet the reader picks and appends what comes back. A case that NAMES a sheet
 * gets that one; a case that names none gets the whole workbook, which is what a
 * reader who uploaded it and wanted all of it would do.
 */
async function readFileSheets(ctx, kase, file) {
  const first = await readOneFile(ctx, kase, file);
  if (file.sheet || first.via !== "http") {
    return { reads: [first], names: [first.sheet] };
  }
  const listed = (first.sheets ?? []).map((sheet) => sheet.name).filter((name) => typeof name === "string");
  const rest = listed.filter((name) => name !== first.sheet).slice(0, MAX_SHEETS_PER_FILE - 1);
  const reads = [first];
  for (const name of rest) {
    reads.push(await readOneFile(ctx, kase, { ...file, sheet: name }));
  }
  return { reads, names: [first.sheet, ...rest] };
}

export async function importStage(ctx, kase) {
  const files = kase.files ?? [];
  if (files.length === 0) {
    return {
      ok: true,
      figuresText: kase.figuresText ?? "",
      sheets: [],
      previews: "",
      proseText: "",
      ms: 0,
      skipped: "no files in case.json",
    };
  }
  const sheets = [];
  const previews = [];
  const prose = [];
  let figuresText = "";
  let ms = 0;
  let ok = true;
  let error;
  for (const file of files) {
    let read;
    try {
      read = await readFileSheets(ctx, kase, file);
    } catch (cause) {
      throw new StageStopped("import", describe(cause));
    }
    // The route lists every sheet on every call, so the previews are taken once.
    for (const sheet of read.reads[0]?.sheets ?? []) {
      previews.push(JSON.stringify(sheet.preview ?? ""));
    }
    for (const one of read.reads) {
      ms += one.ms;
      ok = ok && one.ok;
      error = error ?? one.error;
      figuresText = mergeFigures(figuresText, one.figuresText);
      sheets.push({ file: file.path, name: one.sheet, via: one.via, asked: file.sheet ?? "(all)" });
      if (one.proseText) {
        prose.push(one.proseText);
      }
    }
  }
  return { ok, figuresText, sheets, previews: previews.join("\n"), proseText: prose.join("\n"), ms, error };
}

/* -------------------------------------------------------------- parse/generate */

/**
 * The body this task's own step component posts to the parse. An adapter that names
 * no `parseBody` gets the body every task has always sent.
 */
export function parseBodyFor(kase, adapter) {
  return (
    adapter?.parseBody?.(kase) ?? {
      figures: kase.figuresText,
      task: kase.task,
      prompt: kase.prompt,
      params: kase.params,
    }
  );
}

export async function parseStage(ctx, kase, adapter) {
  try {
    const run = await timed(() => parseTask(ctx, parseBodyFor(kase, adapter)));
    return { ok: true, parsed: run.value, ms: run.ms };
  } catch (error) {
    throw new StageStopped("parse", describe(error));
  }
}

export async function generateStage(ctx, body) {
  try {
    const run = await timed(() => generateReport(ctx, body));
    return { ok: true, result: run.value.result, phases: run.value.phases, ms: run.ms };
  } catch (error) {
    throw new StageStopped("generate", describe(error));
  }
}

/* ---------------------------------------------------------------------- export */

function exportRow(format, file, ms, via) {
  return {
    format,
    via,
    ok: file.mimeOk && file.byteLength > 0,
    mime: file.mime,
    byteLength: file.byteLength,
    filename: file.filename,
    ms,
  };
}

/** The legacy Word route, tried once when the format picker's route is not served. */
async function legacyDocx(ctx, brief) {
  try {
    const run = await timed(() => exportDocxLegacy(ctx, brief));
    return exportRow("docx", run.value, run.ms, "legacy-docx-route");
  } catch (error) {
    return { format: "docx", via: "legacy-docx-route", ok: false, error: describe(error) };
  }
}

/**
 * Every format the case asks for, each posted the way this task's export menu
 * posts it, then re-opened. A file that arrives with the right mime and the wrong
 * numbers inside is not a passing export.
 */
export async function exportStage(ctx, kase, adapter, result, report) {
  const formats = kase.exports ?? DEFAULT_EXPORT_FORMATS;
  const files = [];
  let workbook = null;
  let summary = null;
  let calc = null;
  let deck = null;
  let routeMissing = false;
  for (const format of formats) {
    try {
      const body = adapter.exportBody(kase, result, format);
      const run = await timed(() => exportReport(ctx, body));
      files.push(exportRow(format, run.value, run.ms, "http"));
      if (format === "xlsx") {
        workbook = await readWorkbook(run.value.bytes);
        summary = summaryNumbersCheck(report, workbook, amountsMatch);
        calc = calcFormulaCheck(report, workbook, amountsMatch);
      }
      if (format === "pptx") {
        const read = await readDeckCharts(run.value.bytes);
        deck = {
          ...read,
          expected: expectedChartParts(report),
          ok: read.available && read.charts === expectedChartParts(report),
        };
      }
    } catch (error) {
      routeMissing = routeMissing || (error instanceof AppError && error.status === 404);
      files.push({ format, via: "http", ok: false, error: describe(error) });
    }
  }
  if (routeMissing && result?.brief) {
    files.push(await legacyDocx(ctx, result.brief));
  }
  const artefactsOk =
    (summary === null || summary.missing.length === 0) &&
    (calc === null || (calc.mismatches.length === 0 && calc.uncached.length === 0)) &&
    (deck === null || deck.ok);
  return { ok: files.every((file) => file.ok) && artefactsOk, files, workbook, summary, calc, deck };
}
