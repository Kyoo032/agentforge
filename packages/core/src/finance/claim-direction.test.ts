import { describe, expect, it } from "vitest";
import { sentenceContradictsDirection, type DirectionClaim } from "./claim-direction";

const FAVOURABLE: DirectionClaim["agree"] = [{ en: "favourable", id: "menguntungkan" }];
const UNFAVOURABLE: DirectionClaim["agree"] = [{ en: "unfavourable", id: "tidak menguntungkan" }];
const RUNS_OUT: DirectionClaim["agree"] = [{ en: "runs out", id: "habis" }];
const STAYS: DirectionClaim["agree"] = [{ en: "does not run out", id: "tidak habis" }];

describe("sentenceContradictsDirection", () => {
  it("flags the opposite of a favourable line and leaves the agreeing sentence", () => {
    const claims: DirectionClaim[] = [{ amount: 14_000, agree: FAVOURABLE, contradict: UNFAVOURABLE }];
    expect(sentenceContradictsDirection("Marketing is unfavourable at 14000.", claims, "en")).toBe(true);
    expect(sentenceContradictsDirection("Marketing is favourable at 14000.", claims, "en")).toBe(false);
  });

  it("does not treat menguntungkan inside tidak menguntungkan as the opposite", () => {
    const claims: DirectionClaim[] = [{ amount: 14_000, agree: UNFAVOURABLE, contradict: FAVOURABLE }];
    expect(sentenceContradictsDirection("Baris ini tidak menguntungkan pada 14000.", claims, "id")).toBe(false);
    expect(sentenceContradictsDirection("Baris ini menguntungkan pada 14000.", claims, "id")).toBe(true);
  });

  it("keeps does not run out distinct from runs out", () => {
    const burning: DirectionClaim[] = [{ amount: 8, agree: RUNS_OUT, contradict: STAYS }];
    expect(sentenceContradictsDirection("Cash does not run out in 8 months.", burning, "en")).toBe(true);
    expect(sentenceContradictsDirection("Cash runs out in 8 months.", burning, "en")).toBe(false);
    const staying: DirectionClaim[] = [{ amount: 90_000, agree: STAYS, contradict: RUNS_OUT }];
    expect(sentenceContradictsDirection("Cash does not run out at 90000.", staying, "en")).toBe(false);
    expect(sentenceContradictsDirection("Kas tidak habis pada 90000.", staying, "id")).toBe(false);
    expect(sentenceContradictsDirection("Kas habis pada 90000.", staying, "id")).toBe(true);
  });

  it("leaves a sentence that quotes two different directions", () => {
    const claims: DirectionClaim[] = [
      { amount: 14_000, agree: UNFAVOURABLE, contradict: FAVOURABLE },
      { amount: 49_000, agree: FAVOURABLE, contradict: UNFAVOURABLE },
    ];
    expect(sentenceContradictsDirection("14000 is unfavourable and 49000 is favourable.", claims, "en")).toBe(false);
  });
});
