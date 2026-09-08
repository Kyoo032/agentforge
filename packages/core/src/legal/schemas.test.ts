import { describe, expect, it } from "vitest";
import {
  classifyResponseSchema,
  findingDraftSchema,
  memoOutlineSchema,
  parseModelJson,
  reviewResponseSchema,
} from "./schemas";

describe("legal schemas", () => {
  it("accepts a well-formed finding and fills defaults", () => {
    const parsed = findingDraftSchema.parse({
      kind: "adverse",
      clause: "§7.2(b)",
      quote: "shall indemnify each Lender Party",
      title: "Uncapped indemnity",
    });
    expect(parsed.severity).toBe("low");
    expect(parsed.proposedText).toBeNull();
    expect(parsed.basis).toEqual([]);
  });

  it("rejects unknown kinds and oversized prose", () => {
    expect(() => findingDraftSchema.parse({ kind: "attack", clause: "x", title: "t" })).toThrow();
    expect(() => findingDraftSchema.parse({ kind: "adverse", clause: "x", title: "t", why: "a".repeat(2_001) })).toThrow();
  });

  it("accepts ok, a single finding, or a findings list for review", () => {
    expect(reviewResponseSchema.parse({ kind: "ok" })).toEqual({ kind: "ok" });
    expect(reviewResponseSchema.parse({ findings: [] })).toEqual({ findings: [] });
    const single = reviewResponseSchema.parse({ kind: "missing", clause: "cure", title: "No cure right" });
    expect("kind" in single && single.kind).toBe("missing");
  });

  it("validates classify and memo shapes", () => {
    expect(classifyResponseSchema.parse({ docs: [{ id: "S1", role: "executed" }] }).docs[0]?.reason).toBe("");
    expect(() => classifyResponseSchema.parse({ docs: [{ id: "S1", role: "hostile" }] })).toThrow();
    expect(() => memoOutlineSchema.parse({ to: "a", from: "b", date: "c", re: "d", sections: [] })).toThrow();
  });

  it("parses fenced and unfenced JSON, returns null otherwise", () => {
    expect(parseModelJson('```json\n{"kind":"ok"}\n```')).toEqual({ kind: "ok" });
    expect(parseModelJson('Here you go: {"kind":"ok"} thanks')).toEqual({ kind: "ok" });
    expect(parseModelJson("no json here")).toBeNull();
    expect(parseModelJson("{broken")).toBeNull();
  });
});
