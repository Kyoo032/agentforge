import { describe, expect, it } from "vitest";
import { ANN_EXTENSION, annAvailable } from "./ann";

describe("knowledge ANN probe", () => {
  it("reports unavailable while sqlite-vec is not installed", () => {
    // Spike 5 has not run: nothing depends on sqlite-vec, so the probe must say so rather than
    // throw a MODULE_NOT_FOUND out of a retrieval path.
    expect(ANN_EXTENSION).toBe("sqlite-vec");
    expect(annAvailable()).toBe(false);
  });
});
