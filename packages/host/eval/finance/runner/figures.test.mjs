import { describe, expect, it } from "vitest";
import { figureHints, figurePeriod, figureTokens, sameMetric, scoreFigures } from "./figures.mjs";
import { reportCells, unitOfColumn, unitOfLabel } from "./report-cells.mjs";

/**
 * A `FinanceReport` the way a task hands one back: KPI tiles, one table with a
 * period per column, one chart series. Nothing here goes through a brief, which is
 * the point — the figure scorer must read a task's own report.
 */
const REPORT = {
  task: "ratios",
  title: "Ratio health check",
  locale: "en",
  summary: [
    { label: "Current ratio 2024", value: 1.6, unit: "x" },
    { label: "Runway", value: 18, unit: "months" },
    { label: "Net margin 2025", value: 12, unit: "%" },
  ],
  tables: [
    {
      id: "inputs",
      title: "Line items",
      columns: ["Label", "2024", "2025"],
      rows: [
        ["Revenue", 1_000_000, 1_250_000],
        ["Cash", 520_000, 610_000],
      ],
    },
  ],
  charts: [
    {
      id: "trend",
      title: "Gross margin",
      kind: "line",
      categories: ["2024", "2025"],
      series: [{ name: "Gross margin", values: [38.2, 41.6] }],
    },
  ],
  flags: [],
  notes: [{ heading: "Read", body: "Gross margin held at 41.6% in 2025 while revenue reached 1,250,000." }],
};

const VIEW = { report: REPORT, narrative: "", metrics: [], tables: REPORT.tables, charts: REPORT.charts, flags: [] };

function figure(overrides) {
  return { key: "k", label: "Label", value: 1, unit: "number", ...overrides };
}

/**
 * One flagged line as the budget report tables it, with the money columns declaring
 * their currency. `variancePct` is the column a line with no budget cannot fill.
 */
function budgetView(variancePct) {
  const row = ["Biaya perbaikan atap kantor", 0, 18_000_000, 18_000_000];
  const tables = [
    {
      id: "variance",
      title: "Selisih per baris",
      columns: ["Baris", "Anggaran (IDR)", "Realisasi (IDR)", "Selisih (IDR)", "Selisih %"],
      rows: [variancePct === null ? row : [...row, variancePct]],
    },
  ];
  return {
    report: { task: "budget", locale: "id", tables },
    narrative: "",
    metrics: [],
    tables,
    charts: [],
    flags: [],
  };
}

const UNDEFINED_PCT = {
  key: "variance.perbaikan-atap.pct",
  label: "Selisih % Biaya perbaikan atap kantor",
  value: null,
  unit: "percent",
  tolerance: 0.005,
};

describe("figurePeriod and figureTokens", () => {
  it("reads the period off a dotted key", () => {
    expect(figurePeriod(figure({ key: "netCash.Jan 2024" }))).toBe("Jan 2024");
    expect(figurePeriod(figure({ key: "grossMarginPct.2024" }))).toBe("2024");
  });

  it("falls back to the period on the tail of the label", () => {
    expect(figurePeriod(figure({ key: "npv", label: "Gross margin 2025" }))).toBe("2025");
  });

  it("reports no period when neither carries one", () => {
    expect(figurePeriod(figure({ key: "npv", label: "NPV @ 12%" }))).toBe("");
  });

  it("identifies a figure by the case's own label, not by its English key", () => {
    // A case keys `currentRatio.2024` and labels it in Indonesian. Demanding
    // "current" and "ratio" of the report as well would mean no Indonesian report
    // could ever be recognised as talking about it.
    expect(figureTokens(figure({ key: "currentRatio.2024", label: "Rasio lancar 2024" }))).toEqual([
      "rasio",
      "lancar",
      "2024",
    ]);
    expect(figureHints(figure({ key: "currentRatio.2024", label: "Rasio lancar 2024" }))).toEqual(["current", "ratio"]);
  });

  it("falls back to the key when the case wrote no label", () => {
    expect(figureTokens(figure({ key: "currentRatio.2024", label: "" }))).toEqual(["current", "ratio"]);
  });
});

describe("reportCells", () => {
  it("reads KPIs, table cells and chart points as one pool", () => {
    const cells = reportCells(VIEW);
    expect(cells.filter((cell) => cell.where === "summary")).toHaveLength(3);
    expect(cells.filter((cell) => cell.where === "table:inputs")).toHaveLength(4);
    expect(cells.filter((cell) => cell.where === "chart:trend")).toHaveLength(2);
  });

  it("gives a table cell its row name, its column header and its table title as words", () => {
    const cell = reportCells(VIEW).find((entry) => entry.value === 1_250_000);
    expect(cell.tokens).toEqual(expect.arrayContaining(["revenue", "2025", "line", "items"]));
    expect(cell.period).toBe("2025");
  });

  it("calls a unitless cell unknown rather than a number", () => {
    expect(unitOfLabel("")).toBe("unknown");
    expect(unitOfLabel("%")).toBe("percent");
    expect(unitOfColumn("Margin %")).toBe("percent");
    expect(unitOfColumn("Selisih (%)")).toBe("percent");
    expect(unitOfColumn("Rasio (x)")).toBe("ratio");
    expect(unitOfColumn("Runway (bulan)")).toBe("months");
    expect(unitOfColumn("2025")).toBe("unknown");
    expect(unitOfColumn("Label")).toBe("unknown");
  });

  it("does not read a table titled 'per tahun' as a table of durations", () => {
    // The bug this test exists for: "Arus kas per tahun" made every currency cell
    // in the appraisal's flows table look like a number of years, and the scorer
    // then refused all of them.
    expect(unitOfColumn("Arus kas bersih")).toBe("unknown");
    const flows = {
      report: {
        locale: "id",
        summary: [],
        charts: [],
        flags: [],
        notes: [],
        tables: [
          {
            id: "flows",
            title: "Arus kas per tahun",
            columns: ["Periode", "Arus kas bersih"],
            rows: [["Year 1", 138_000]],
          },
        ],
      },
      metrics: [],
    };
    const score = scoreFigures(
      [figure({ key: "netCashFlow.Year 1", label: "Net cash flow Year 1", value: 138_000, unit: "currency" })],
      flows,
    );
    expect(score.figures[0].verdict).toBe("FOUND_STRUCTURED");
  });

  it("reads the app's numbers in the language the app wrote them in", () => {
    // An `en` case can come back in Indonesian, where "-151.000" is minus a
    // hundred and fifty-one thousand, not minus a hundred and fifty-one.
    const idReport = {
      report: {
        locale: "id",
        summary: [],
        tables: [],
        charts: [],
        flags: [],
        notes: [{ heading: "Catatan", body: "Arus kas tahun 5 adalah -151.000." }],
      },
      metrics: [],
      narrative: "",
    };
    const score = scoreFigures(
      [figure({ key: "flow.5", label: "Arus kas tahun 5", value: -151_000, unit: "currency" })],
      idReport,
      {
        locale: "en",
      },
    );
    expect(score.readAs).toBe("id");
    expect(score.figures[0].verdict).toBe("FOUND_PROSE");
  });
});

describe("sameMetric", () => {
  const cell = {
    value: 12,
    unit: "percent",
    tokens: ["net", "margin", "2025"],
    period: "",
    where: "summary",
    name: "Net margin 2025",
  };

  it("is true only when every word of the truth's name is there", () => {
    expect(sameMetric(figure({ key: "netMargin.2025", label: "Net margin 2025" }), cell)).toBe(true);
    expect(sameMetric(figure({ key: "grossMargin.2025", label: "Gross margin 2025" }), cell)).toBe(false);
  });

  it("does not let a table title lend its words to every row in it", () => {
    // A table headed "Rasio antar periode" once made the row "Jumlah aset lancar"
    // look like a statement about the current RATIO, and its own (correct) asset
    // total was then reported as a WRONG value for that ratio.
    const row = {
      value: 49_861_000_000,
      unit: "unknown",
      tokens: ["jumlah", "aset", "lancar", "rasio", "antar", "periode", "2024"],
      ownTokens: ["jumlah", "aset", "lancar", "2024"],
      period: "2024",
      where: "table:trend",
      name: "Jumlah aset lancar",
    };
    expect(sameMetric(figure({ key: "currentRatio.2024", label: "Rasio lancar 2024" }), row)).toBe(false);
  });

  it("is false when the periods disagree", () => {
    const dated = { ...cell, period: "2024" };
    expect(sameMetric(figure({ key: "netMargin.2025", label: "Net margin 2025" }), dated)).toBe(false);
  });
});

describe("scoreFigures over a FinanceReport", () => {
  it("finds a KPI by value and unit", () => {
    const score = scoreFigures(
      [figure({ key: "currentRatio.2024", label: "Current ratio 2024", value: 1.6, unit: "ratio" })],
      VIEW,
    );
    expect(score.figures[0].verdict).toBe("FOUND_STRUCTURED");
    expect(score.figures[0].where).toBe("summary");
    expect(score.accuracy).toBe(1);
  });

  it("finds a figure that only reached a chart series", () => {
    const score = scoreFigures(
      [
        figure({
          key: "grossMarginPct.2025",
          label: "Gross margin 2025",
          value: 41.6,
          unit: "percent",
          tolerance: 0.005,
        }),
      ],
      VIEW,
    );
    expect(score.figures[0].where).toBe("chart:trend");
  });

  it("finds a figure that only reached a table cell", () => {
    const score = scoreFigures(
      [figure({ key: "revenue.2025", label: "Revenue 2025", value: 1_250_000, unit: "currency" })],
      VIEW,
    );
    expect(score.figures[0].where).toBe("table:inputs");
  });

  it("says when the name, not the value, settled which cell it was", () => {
    const twins = {
      ...VIEW,
      report: {
        ...REPORT,
        summary: [
          { label: "Net margin 2025", value: 12, unit: "%" },
          { label: "Tax rate 2025", value: 12, unit: "%" },
        ],
      },
    };
    const score = scoreFigures(
      [figure({ key: "taxRate.2025", label: "Tax rate 2025", value: 12, unit: "percent" })],
      twins,
    );
    expect(score.figures[0].candidates).toBe(2);
    expect(score.figures[0].disambiguatedByName).toBe(true);
    expect(score.figures[0].cell).toBe("Tax rate 2025");
  });

  it("calls a stated-but-different value for the SAME metric WRONG", () => {
    const score = scoreFigures(
      [figure({ key: "netMargin.2025", label: "Net margin 2025", value: 17.6, unit: "percent" })],
      VIEW,
    );
    expect(score.figures[0].verdict).toBe("WRONG");
    expect(score.figures[0].stated).toBe(12);
    expect(score.penalisedAccuracy).toBe(0);
  });

  it("calls a figure the report never mentions MISSING, not WRONG", () => {
    const score = scoreFigures(
      [figure({ key: "irr", label: "Internal rate of return", value: 22.5, unit: "percent" })],
      VIEW,
    );
    expect(score.figures[0].verdict).toBe("MISSING");
    expect(score.wrongRate).toBe(0);
  });

  it("finds a figure that reached only the report's notes", () => {
    const proseOnly = { ...VIEW, report: { ...REPORT, summary: [], tables: [], charts: [] }, tables: [], charts: [] };
    const score = scoreFigures(
      [
        figure({
          key: "grossMarginPct.2025",
          label: "Gross margin 2025",
          value: 41.6,
          unit: "percent",
          tolerance: 0.005,
        }),
      ],
      proseOnly,
    );
    expect(score.figures[0].verdict).toBe("FOUND_PROSE");
  });

  it("keeps null-valued truth figures out of the headline accuracy", () => {
    const score = scoreFigures(
      [
        figure({ key: "currentRatio.2024", label: "Current ratio 2024", value: 1.6, unit: "ratio" }),
        figure({ key: "variance.atap.pct", label: "Roof repair variance %", value: null, unit: "percent" }),
      ],
      VIEW,
    );
    expect(score.total).toBe(1);
    expect(score.accuracy).toBe(1);
    expect(score.naFigures.total).toBe(1);
    expect(score.naFigures.figures[0].verdict).toBe("ABSENT_OK");
  });

  it("calls a number given to an undefined figure WRONG in the naFigures block", () => {
    const score = scoreFigures(
      [figure({ key: "netMargin.2025", label: "Net margin 2025", value: null, unit: "percent" })],
      VIEW,
    );
    expect(score.naFigures.wrong).toBe(1);
    expect(score.naFigures.figures[0].stated).toBe(12);
  });

  it("does not read the money beside an undefined percentage as the percentage", () => {
    // A budget line that exists only in the actuals has no budget to divide by, so
    // its variance % is not defined. The amount in the same row answers to the same
    // words once the `%` normalises away — and it is a different number about a
    // different thing.
    const score = scoreFigures([UNDEFINED_PCT], budgetView(null), { locale: "id" });
    expect(score.naFigures.figures[0].verdict).toBe("ABSENT_OK");
    expect(score.naFigures.wrong).toBe(0);
  });

  it("still fails a report that does print a percentage for an undefined figure", () => {
    const score = scoreFigures([UNDEFINED_PCT], budgetView(-100), { locale: "id" });
    expect(score.naFigures.figures[0]).toMatchObject({ verdict: "WRONG", stated: -100 });
    expect(score.naFigures.wrong).toBe(1);
  });

  it("refuses a cell whose stated unit contradicts the truth's", () => {
    // The report says 12 %. A truth figure worth 12 in money is not that cell.
    const score = scoreFigures([figure({ key: "takings", label: "Takings", value: 12, unit: "currency" })], VIEW);
    expect(score.figures[0].verdict).toBe("MISSING");
  });

  it("lets a unitless cell stand for any unit, because a bare cell states none", () => {
    // A chart point and a spreadsheet cell carry no unit of their own. Refusing
    // them would fail a correct percentage for living in a table; accepting them
    // is why the name is what settles an ambiguity.
    const score = scoreFigures([figure({ key: "takings", label: "Takings", value: 41.6, unit: "currency" })], VIEW);
    expect(score.figures[0].verdict).toBe("FOUND_STRUCTURED");
    expect(score.figures[0].where).toBe("chart:trend");
  });
});
