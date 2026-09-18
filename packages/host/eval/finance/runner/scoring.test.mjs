import { describe, expect, it } from "vitest";
import {
  PASS_EXTRACTION_F1,
  PASS_FIGURE_ACCURACY,
  PASS_MAX_HALLUCINATED,
  PASS_MAX_WRONG_RATE,
  casePasses,
  forbiddenPresent,
  missingMentions,
  scoreBudgetFlags,
  scoreBudgetPairs,
  scoreExtraction,
  scoreHallucination,
  scorePii,
  scorePiiLeak,
  unscorableExtraction,
} from "./scoring.mjs";

const TRUTH_ITEMS = [
  { label: "Revenue", period: "2024", amount: 1_000_000 },
  { label: "Revenue", period: "2025", amount: 1_250_000 },
  { label: "COGS", period: "2025", amount: 730_000 },
];

describe("scoreExtraction", () => {
  it("scores a perfect read as 1", () => {
    const score = scoreExtraction(
      TRUTH_ITEMS,
      TRUTH_ITEMS.map((item) => ({ ...item })),
    );
    expect(score.f1).toBe(1);
    expect(score.misses).toEqual([]);
    expect(score.extras).toEqual([]);
  });

  it("forgives case, accents and punctuation in a label", () => {
    const parsed = [
      { label: "  revenue:", period: "2024", amount: 1_000_000 },
      { label: "REVENUE", period: "2025", amount: 1_250_000 },
      { label: "cogs", period: "2025", amount: 730_000 },
    ];
    expect(scoreExtraction(TRUTH_ITEMS, parsed).f1).toBe(1);
  });

  it("does not forgive a translated label", () => {
    const parsed = [
      { label: "Pendapatan", period: "2024", amount: 1_000_000 },
      { label: "Revenue", period: "2025", amount: 1_250_000 },
      { label: "COGS", period: "2025", amount: 730_000 },
    ];
    const score = scoreExtraction(TRUTH_ITEMS, parsed);
    expect(score.matched).toBe(2);
    expect(score.misses[0]).toMatchObject({ label: "Revenue", period: "2024", reason: "label_mismatch" });
  });

  it("names an amount that drifted past tolerance", () => {
    const parsed = [
      { label: "Revenue", period: "2024", amount: 1_000_000 },
      { label: "Revenue", period: "2025", amount: 1_250 },
      { label: "COGS", period: "2025", amount: 730_000 },
    ];
    expect(scoreExtraction(TRUTH_ITEMS, parsed).misses[0].reason).toBe("amount_mismatch");
  });

  it("names a period that drifted", () => {
    const parsed = [{ label: "Revenue", period: "2023", amount: 1_000_000 }];
    expect(scoreExtraction([TRUTH_ITEMS[0]], parsed).misses[0].reason).toBe("period_mismatch");
  });

  it("accepts an FY prefix on a period", () => {
    const parsed = [{ label: "Revenue", period: "FY2024", amount: 1_000_000 }];
    expect(scoreExtraction([TRUTH_ITEMS[0]], parsed).f1).toBe(1);
  });

  it("flags a double-counted subtotal as an extra", () => {
    const parsed = [
      ...TRUTH_ITEMS.map((item) => ({ ...item })),
      { label: "Total 2025", period: "2025", amount: 1_980_000 },
    ];
    const score = scoreExtraction(TRUTH_ITEMS, parsed);
    expect(score.extras).toHaveLength(1);
    expect(score.extras[0].reason).toBe("double_counted_subtotal");
    expect(score.precision).toBeCloseTo(3 / 4, 6);
  });

  it("names a zero the parse filled a grid cell with, rather than lumping it in with a wrong row", () => {
    const parsed = [...TRUTH_ITEMS.map((item) => ({ ...item })), { label: "COGS", period: "2024", amount: 0 }];
    const score = scoreExtraction(TRUTH_ITEMS, parsed);
    expect(score.extras[0].reason).toBe("zero_filled_grid_cell");
    expect(score.precision).toBeCloseTo(3 / 4, 6);
  });

  it("counts a missing row against recall", () => {
    const score = scoreExtraction(
      TRUTH_ITEMS,
      TRUTH_ITEMS.slice(0, 2).map((item) => ({ ...item })),
    );
    expect(score.recall).toBeCloseTo(2 / 3, 6);
    expect(score.precision).toBe(1);
  });
});

const NARRATIVE = { narrative: "Gross margin held at 41.6% in 2025 while revenue reached 1,250,000." };

describe("scoreHallucination", () => {
  it("passes a narrative whose every figure traces back", () => {
    const score = scoreHallucination(NARRATIVE, [41.6, 1_250_000]);
    expect(score.count).toBe(0);
  });

  it("catches a number that traces to nothing", () => {
    const invented = { narrative: "EBITDA margin was 88.4% last year." };
    const score = scoreHallucination(invented, [41.6, 1_250_000]);
    expect(score.count).toBe(1);
    expect(score.hallucinated[0].value).toBeCloseTo(88.4, 6);
  });

  it("frees calendar years and small counts", () => {
    const score = scoreHallucination({ narrative: "In 2025 we ran 3 scenarios." }, []);
    expect(score.count).toBe(0);
  });

  it("accepts a computed figure quoted with its sign in words", () => {
    // "an outlay of 820,000" and "(151.000)" are the app's own numbers written the
    // way a person writes them. A wrong SIGN is caught by scoreFigures, which stays
    // strictly signed; this check is about where a number came from.
    const written = { narrative: "Investasi awal 820.000 terjadi di Year 0; kumulatif positif di Year 8 (151.000)." };
    const score = scoreHallucination(written, [-820_000, 151_000], { locale: "id" });
    expect(score.count).toBe(0);
  });

  it("still catches a number that traces to nothing, either sign", () => {
    const invented = { narrative: "Investasi awal 999.000 terjadi di Year 0." };
    expect(scoreHallucination(invented, [-820_000, 151_000], { locale: "id" }).count).toBe(1);
  });

  it("counts the guard's own markers", () => {
    const score = scoreHallucination({ narrative: "Margin was [unverified figure] last year." }, []);
    expect(score.unverifiedMarkers).toBe(1);
  });
});

describe("scoreBudgetPairs", () => {
  const truth = [
    { label: "Rent", planned: 15_000, actual: 15_500, variance: 500 },
    { label: "Marketing", planned: 8_000, actual: 6_400, variance: -1_600 },
  ];

  it("scores a matching pair set as 1", () => {
    expect(
      scoreBudgetPairs(
        truth,
        truth.map((pair) => ({ ...pair })),
      ).f1,
    ).toBe(1);
  });

  it("fails a pair whose actual is wrong", () => {
    const reported = [{ ...truth[0], actual: 19_000 }, { ...truth[1] }];
    const score = scoreBudgetPairs(truth, reported);
    expect(score.matched).toBe(1);
    expect(score.mismatches[0].fields.actual).toBe(false);
  });

  it("reports a row the report never produced", () => {
    const score = scoreBudgetPairs(truth, [{ ...truth[0] }]);
    expect(score.misses).toEqual(["Marketing"]);
  });
});

describe("scorePii", () => {
  it("scores a complete detection as 1", () => {
    const truth = [{ kind: "email", match: "ana@contoh.test" }];
    expect(scorePii(truth, [{ kind: "email", match: "ana@contoh.test", index: 4 }]).f1).toBe(1);
  });

  it("counts a missed finding against recall", () => {
    const truth = [
      { kind: "email", match: "ana@contoh.test" },
      { kind: "phone", match: "+62 812 3456 7890" },
    ];
    const score = scorePii(truth, [{ kind: "email", match: "ana@contoh.test", index: 4 }]);
    expect(score.recall).toBeCloseTo(0.5, 6);
    expect(score.misses).toEqual(["phone"]);
  });
});

describe("mustMention and mustNotContain", () => {
  it("finds forbidden text case-insensitively", () => {
    expect(forbiddenPresent("Margin was [Unverified Figure].", ["[unverified figure]"])).toHaveLength(1);
  });

  it("reports a phrase the report never mentioned", () => {
    expect(missingMentions("Margins held.", ["runway"])).toEqual(["runway"]);
  });
});

describe("scoreBudgetFlags", () => {
  // The case flags by slug; the report names the line as the sheet does. The slug is
  // an ALIAS of that one line, never a second line the report could be credited for.
  const NAMES = [
    { id: "sewa-kantor", names: ["Sewa kantor", "Biaya sewa gedung", "sewa-kantor"] },
    { id: "cadangan-darurat", names: ["Cadangan dana darurat", "cadangan-darurat"] },
    { id: "atk", names: ["ATK", "atk"] },
  ];
  const YEARLY = [{ period: "full period", ids: ["sewa-kantor", "cadangan-darurat"] }];
  const line = (label, period = "Seluruh periode") => ({ period, label });

  it("matches a slug to the sheet label the case gave that same line", () => {
    // "cadangan-darurat" is never a substring of "Cadangan dana darurat".
    const score = scoreBudgetFlags(YEARLY, [line("Sewa kantor"), line("Cadangan dana darurat")], { names: NAMES });
    expect(score.f1).toBe(1);
    expect(score).toMatchObject({ matched: 2, truthTotal: 2, reportedTotal: 2 });
  });

  it("counts one report line once, however many spellings the case has for it", () => {
    const score = scoreBudgetFlags(YEARLY, [line("Sewa kantor"), line("Cadangan dana darurat")], { names: NAMES });
    expect(score.extra).toEqual([]);
    expect(score.precision).toBe(1);
  });

  it("loses precision on a line the case does not flag", () => {
    const reported = [line("Sewa kantor"), line("Cadangan dana darurat"), line("ATK")];
    const score = scoreBudgetFlags(YEARLY, reported, { names: NAMES });
    expect(score.precision).toBeCloseTo(2 / 3, 6);
    expect(score.extra).toEqual(["ATK"]);
  });

  it("loses recall on a line the report never flagged", () => {
    const score = scoreBudgetFlags(YEARLY, [line("Sewa kantor")], { names: NAMES });
    expect(score.recall).toBeCloseTo(0.5, 6);
    expect(score.missed).toEqual(["cadangan-darurat"]);
  });

  it("does not let one line flagged twice count twice", () => {
    const reported = [line("Sewa kantor"), line("Sewa kantor"), line("Cadangan dana darurat")];
    const score = scoreBudgetFlags(YEARLY, reported, { names: NAMES });
    expect(score.matched).toBe(2);
    expect(score.extra).toEqual(["Sewa kantor"]);
  });

  it("keeps a quarterly case's periods apart", () => {
    const quarterly = [
      { period: "Q1", ids: ["sewa-kantor"] },
      { period: "Q2", ids: ["atk"] },
    ];
    const score = scoreBudgetFlags(quarterly, [line("Sewa kantor", "Q1"), line("Sewa kantor", "Q2")], { names: NAMES });
    expect(score.matched).toBe(1);
    expect(score.missed).toEqual(["atk"]);
    expect(score.extra).toEqual(["Sewa kantor"]);
  });

  it("reads a yearly case's list against the report's full-period rows only", () => {
    // The case says nothing about Q1, so a Q1 row is not a claim it can be wrong about.
    const reported = [line("ATK", "Seluruh periode"), line("ATK", "Q1")];
    const score = scoreBudgetFlags([{ period: "full period", ids: ["atk"] }], reported, { names: NAMES });
    expect(score).toMatchObject({ matched: 1, reportedTotal: 1, unscoredLines: 1 });
    expect(score.f1).toBe(1);
  });

  it("falls back to the case's own spelling for a line it wrote no variance for", () => {
    const score = scoreBudgetFlags([{ period: "full period", ids: ["Perjalanan dinas"] }], [line("perjalanan dinas")]);
    expect(score.f1).toBe(1);
  });
});

describe("scorePiiLeak", () => {
  const planted = [
    { kind: "person_name", value: "Dewi Anggraini Putri", cell: "Gaji!B4" },
    { kind: "nik", value: "9971010101900001", cell: "Gaji!C4" },
    { kind: "phone", value: "+62 811-0000-0001", cell: "Gaji!E4" },
  ];

  it("passes when nothing the app handed back carries a planted value", () => {
    const score = scorePiiLeak(planted, {
      figuresText: "Karyawan 1 | 9775000",
      proseText: "Total gaji pokok 75.900.000",
    });
    expect(score.leaked).toBe(0);
    expect(score.checkedPlaces).toEqual(["figuresText", "proseText"]);
  });

  it("names the place a value leaked to", () => {
    const score = scorePiiLeak(planted, { figuresText: "Dewi Anggraini Putri | 9775000", proseText: "" });
    expect(score.leaks).toEqual([{ kind: "person_name", where: "figuresText", cell: "Gaji!B4", form: "verbatim" }]);
  });

  it("catches a number whose punctuation was stripped on the way out", () => {
    const score = scorePiiLeak(planted, { "sheets[].preview": "6281100000001" });
    expect(score.leaks[0]).toMatchObject({ kind: "phone", form: "digits-only" });
  });

  it("reports the retention half as unasked when the case declares nothing", () => {
    const score = scorePiiLeak(planted, { figuresText: "" }, { mustRemainWhy: "add piiSummary.mustRemain" });
    expect(score.mustRemain.checked).toBe(false);
    expect(score.mustRemain.why).toContain("mustRemain");
  });

  it("names a value that should have survived redaction and did not", () => {
    const score = scorePiiLeak([], { figuresText: "Karyawan 1 | 9775000" }, { mustRemain: ["Bank Nusantara"] });
    expect(score.mustRemain.dropped).toEqual(["Bank Nusantara"]);
  });
});

describe("unscorableExtraction", () => {
  it("carries no F1 at all rather than a zero", () => {
    const score = unscorableExtraction("flows carry no label", { flows: 6 });
    expect(score.scorable).toBe(false);
    expect(score.f1).toBeNull();
    expect(casePasses({ ...PERFECT, extraction: score }).reasons[0]).toContain("not measurable");
  });
});

const PERFECT = {
  extraction: { scorable: true, f1: 1 },
  figures: { accuracy: 1, wrongRate: 0, naFigures: { wrong: 0 } },
  hallucination: { count: 0 },
  forbidden: [],
};

describe("casePasses", () => {
  const perfect = PERFECT;

  it("passes only when every gate is met", () => {
    expect(casePasses(perfect).pass).toBe(true);
  });

  it("fails on extraction just under the line", () => {
    const scores = { ...perfect, extraction: { scorable: true, f1: PASS_EXTRACTION_F1 - 0.001 } };
    expect(casePasses(scores).pass).toBe(false);
  });

  it("fails on figure accuracy just under the line", () => {
    const scores = {
      ...perfect,
      figures: { accuracy: PASS_FIGURE_ACCURACY - 0.001, wrongRate: 0, naFigures: { wrong: 0 } },
    };
    expect(casePasses(scores).reasons[0]).toContain("figure accuracy");
  });

  it("fails on a wrong rate over the cap", () => {
    const scores = {
      ...perfect,
      figures: { accuracy: 1, wrongRate: PASS_MAX_WRONG_RATE + 0.001, naFigures: { wrong: 0 } },
    };
    expect(casePasses(scores).reasons[0]).toContain("wrongRate");
  });

  it("fails on a single hallucinated figure", () => {
    const scores = { ...perfect, hallucination: { count: PASS_MAX_HALLUCINATED + 1 } };
    expect(casePasses(scores).reasons[0]).toContain("hallucinated");
  });

  it("fails when forbidden text is present", () => {
    const scores = { ...perfect, forbidden: ["[unverified figure]"] };
    expect(casePasses(scores).pass).toBe(false);
  });

  it("fails when a figure the case calls undefined was given a number", () => {
    const scores = { ...perfect, figures: { accuracy: 1, wrongRate: 0, naFigures: { wrong: 1 } } };
    expect(casePasses(scores).reasons[0]).toContain("not defined");
  });

  it("fails when a planted personal value reached anything the app handed back", () => {
    const scores = { ...perfect, piiLeak: { leaked: 1, leaks: [{ kind: "nik", where: "figuresText" }] } };
    expect(casePasses(scores).reasons[0]).toContain("figuresText");
  });
});
