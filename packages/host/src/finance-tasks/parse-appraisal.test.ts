import { describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { appraisalFlowPreview, parseAppraisalInput, type ParsedAppraisal } from "./parse-appraisal";

/** The grid path never reaches the gateway, so the tenant is never read on it. */
const TENANT = {} as TenantContext;

/** What the importer hands over for the machine case, subtotal row and all. */
const MACHINE = `Sheet: Kelayakan Mesin
Komponen | Tahun 0 | Tahun 1 | Tahun 2 | Tahun 3
Investasi awal (mesin + instalasi) | -1450000000 | 0 | 0 | 0
Penghematan biaya & tambahan pendapatan | 0 | 345000000 | 412000000 | 470000000
Biaya operasi & perawatan | 0 | -60000000 | -72000000 | -75000000
[subtotal] Arus kas bersih | -1450000000 | 285000000 | 340000000 | 395000000`;

/** The same shape before anything normalised the cells: the defensive path. */
const UNNORMALISED = `Line item | Year 0 | Year 1 | Year 2
Initial investment | (820,000) | - | -
Avoided grid electricity cost | 0 | 152,000 | 156,000
O&M | 0 | (14,000) | (14,000)`;

async function parse(figures: string, prompt = ""): Promise<ParsedAppraisal> {
  return (await parseAppraisalInput(TENANT, { figures, prompt, task: "appraisal" })) as ParsedAppraisal;
}

describe("appraisal parse", () => {
  it("reads the year columns into component rows without a model", async () => {
    const parsed = await parse(MACHINE, "Diskonto 12% per tahun.");
    expect(parsed.needsConfirmation).toBe(true);
    expect(parsed.items).toHaveLength(7);
    expect(parsed.items[0]).toMatchObject({
      label: "Investasi awal (mesin + instalasi)",
      period: "Tahun 0",
      amount: -1_450_000_000,
      category: "asset",
    });
  });

  // Adding the subtotal to its parts doubles every year, so it is dropped and said so.
  it("drops the subtotal row and names it", async () => {
    const parsed = await parse(MACHINE);
    expect(parsed.droppedSubtotals).toEqual(["[subtotal] Arus kas bersih"]);
    expect(parsed.items.some((item) => item.label.includes("Arus kas bersih"))).toBe(false);
  });

  it("nets the rows into one flow per year, keeping the components", async () => {
    const parsed = await parse(MACHINE);
    expect(parsed.flows.map((flow) => [flow.period, flow.amount])).toEqual([
      ["Tahun 0", -1_450_000_000],
      ["Tahun 1", 285_000_000],
      ["Tahun 2", 340_000_000],
      ["Tahun 3", 395_000_000],
    ]);
    expect(parsed.flows[1]?.components).toHaveLength(2);
    expect(parsed.outlay).toBe(-1_450_000_000);
  });

  it("takes the discount rate from the prompt, then from the figures", async () => {
    expect((await parse(MACHINE, "Diskonto 12% per tahun.")).discountRatePercent).toBe(12);
    expect((await parse(MACHINE, "Should we buy it?")).discountRatePercent).toBeNull();
    expect((await parse(`${MACHINE}\nDiscount rate 9%`)).discountRatePercent).toBe(9);
  });

  // The importer may not have normalised the sheet; parenthesised negatives still have to survive.
  it("reads parenthesised negatives and comma thousands as they stand", async () => {
    const parsed = await parse(UNNORMALISED);
    expect(parsed.outlay).toBe(-820_000);
    expect(parsed.flows[1]?.amount).toBe(138_000);
    expect(parsed.flows[2]?.amount).toBe(142_000);
  });

  it("refuses an empty request rather than answering with nothing", async () => {
    await expect(parse("")).rejects.toThrowError(/figures text is required/);
  });
});

describe("the flows preview", () => {
  it("nets the confirmed rows the same way the task will", () => {
    const preview = appraisalFlowPreview([
      { label: "Outlay", period: "Year 0", amount: -100, currency: "", category: "asset" },
      { label: "Savings", period: "Year 1", amount: 70, currency: "", category: "cash" },
      { label: "Cost", period: "Year 1", amount: -10, currency: "", category: "cash" },
    ]);
    expect(preview.nets).toEqual([-100, 60]);
    expect(preview.flows[1]?.components.map((part) => part.label)).toEqual(["Savings", "Cost"]);
  });
});
