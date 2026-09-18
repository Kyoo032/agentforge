import { describe, expect, it } from "vitest";
import type { LineItem } from "@agentforge/core/finance";
import {
  displayedBucket,
  groupRatiosRows,
  isChanged,
  ratiosBalance,
  ratiosBands,
  ratiosOverrides,
  ratiosPeriods,
  ratiosReadPeriod,
  ratiosRowKey,
  uniqueRatiosRows,
  withBucketChange,
  withRatiosBand,
  withRatiosNumber,
  withRatiosParams,
  withoutRatiosBands,
  type RatiosClassifiedRow,
} from "./finance-ratios-draft";

function item(label: string, period: string, amount: number): LineItem {
  return { label, period, amount, currency: "IDR", category: "other" };
}

/** A tiny balance sheet that balances: 100 + 80 assets, 60 + 40 liabilities, 80 equity. */
const BALANCED: LineItem[] = [
  item("Kas dan Setara Kas", "2024", 100),
  item("Persediaan", "2024", 80),
  item("Utang Usaha", "2024", 60),
  item("Utang Bank Jangka Panjang", "2024", 40),
  item("Modal Saham", "2024", 80),
];

function row(label: string, bucket: RatiosClassifiedRow["bucket"], confidence = 0.95): RatiosClassifiedRow {
  return {
    label,
    period: "2024",
    amount: 100,
    currency: "IDR",
    bucket,
    confidence,
    source: "label",
    reason: "rule",
    section: "ASET",
  };
}

describe("bucket changes", () => {
  const persediaan = row("Persediaan", "inventory");

  it("shows the parse's bucket until the owner moves it", () => {
    expect(displayedBucket(persediaan, {})).toBe("inventory");
    const changed = withBucketChange({}, persediaan, "other-current-asset");
    expect(displayedBucket(persediaan, changed)).toBe("other-current-asset");
    expect(isChanged(persediaan, changed)).toBe(true);
  });

  it("forgets the change when the row is put back where it started", () => {
    const changed = withBucketChange({}, persediaan, "other-current-asset");
    expect(withBucketChange(changed, persediaan, "inventory")).toEqual({});
  });

  it("sends only what the owner moved, so the rest keeps its own evidence", () => {
    const changed = withBucketChange({}, persediaan, "other-current-asset");
    expect(ratiosOverrides(changed)).toEqual([
      { label: "Persediaan", period: "2024", bucket: "other-current-asset", confidence: 1, source: "override" },
    ]);
    expect(ratiosOverrides({})).toEqual([]);
  });

  it("splits a key back into its label and period even when the label has a bar in it", () => {
    expect(ratiosRowKey("A | B", "2024")).toBe("A | B|2024");
    expect(ratiosOverrides({ "A | B|2024": "cash" })[0]).toMatchObject({ label: "A | B", period: "2024" });
  });
});

describe("the balance banner's own arithmetic", () => {
  it("calls a balanced sheet balanced, with the totals it used", () => {
    const [only] = ratiosBalance(BALANCED);
    expect(only).toMatchObject({ period: "2024", assets: 180, liabilities: 100, equity: 80, difference: 0 });
    expect(only?.state).toBe("balanced");
  });

  it("names the difference when the two sides disagree", () => {
    const broken = ratiosBalance([...BALANCED, item("Utang Pajak", "2024", 25)]);
    expect(broken[0]).toMatchObject({ difference: -25, state: "broken" });
  });

  it("moves with a bucket the owner changed, before any job is run", () => {
    // Inventory out of the ratios entirely: assets lose 80 and nothing else does, so the sides part.
    const moved = ratiosBalance(BALANCED, { "Persediaan|2024": "excluded" });
    expect(moved[0]).toMatchObject({ assets: 100, difference: -80, state: "broken" });
  });

  it("says it cannot tell rather than claiming zero when a side is missing", () => {
    expect(ratiosBalance([item("Kas dan Setara Kas", "2024", 100)])[0]?.state).toBe("unknown");
  });
});

describe("periods", () => {
  it("offers the periods the rows carry, oldest first", () => {
    const items = [...BALANCED, item("Kas dan Setara Kas", "2023", 90)];
    expect(ratiosPeriods(items)).toEqual(["2023", "2024"]);
  });

  it("reads the newest period unless the owner picked one the rows have", () => {
    const items = [...BALANCED, item("Kas dan Setara Kas", "2023", 90)];
    expect(ratiosReadPeriod(items, {})).toBe("2024");
    expect(ratiosReadPeriod(items, withRatiosParams({}, { period: "2023" }))).toBe("2023");
    expect(ratiosReadPeriod(items, withRatiosParams({}, { period: "1999" }))).toBe("2024");
  });
});

describe("settings carried in params", () => {
  it("drops a supporting figure when its box is cleared", () => {
    const withValue = withRatiosNumber({}, "daysPerYear", "360");
    expect(withValue).toEqual({ daysPerYear: 360 });
    expect(withRatiosNumber(withValue, "daysPerYear", "")).toEqual({});
  });

  it("moves one threshold and leaves the rest of the documented table alone", () => {
    const moved = withRatiosBand({}, "currentRatio", 2, 1.8);
    const table = ratiosBands(moved);
    expect(table.find((rule) => rule.metric === "currentRatio")).toMatchObject({ healthy: 2, watch: 1.8 });
    expect(table.find((rule) => rule.metric === "quickRatio")).toMatchObject({ healthy: 1, watch: 0.8 });
    expect(ratiosBands(withoutRatiosBands(moved)).find((rule) => rule.metric === "currentRatio")).toMatchObject({
      healthy: 1.5,
    });
  });
});

describe("the classification table's shape", () => {
  it("groups the rows the way the statements were printed", () => {
    const rows = [row("Kas dan Setara Kas", "cash"), row("Penjualan Bersih", "revenue"), row("Pos Khusus", "excluded")];
    expect(groupRatiosRows(rows, {}).map((group) => group.statement)).toEqual([
      "balance-sheet",
      "income-statement",
      "none",
    ]);
  });

  it("re-groups a row the moment the owner moves it", () => {
    const rows = [row("Pos Khusus", "excluded", 0.15)];
    const changed = withBucketChange({}, rows[0] as RatiosClassifiedRow, "inventory");
    expect(groupRatiosRows(rows, changed)[0]?.statement).toBe("balance-sheet");
  });

  it("folds a label's periods into one row for the dropdown", () => {
    const rows = [row("Persediaan", "inventory"), { ...row("Persediaan", "inventory"), period: "2023" }];
    expect(uniqueRatiosRows(rows)).toHaveLength(1);
  });
});
