import { describe, expect, it } from "vitest";
import { UsageError, parseCatalogDiffArgs, parseProbeArgs } from "./args";

const DIR = "/tmp/results";

describe("parseCatalogDiffArgs", () => {
  it("defaults to reading the saved cache, printing prices, and saving a snapshot", () => {
    expect(parseCatalogDiffArgs([], DIR)).toEqual({
      refresh: false,
      prices: true,
      save: true,
      json: false,
      resultsDir: DIR,
      workspace: undefined,
      help: false,
    });
  });

  it("takes every flag", () => {
    const args = parseCatalogDiffArgs(
      ["--refresh", "--no-prices", "--no-save", "--json", "--out", "/x", "--workspace", "desk-1"],
      DIR,
    );
    expect(args).toMatchObject({ refresh: true, prices: false, save: false, json: true, resultsDir: "/x", workspace: "desk-1" });
  });

  it("answers --help and refuses anything it does not know", () => {
    expect(parseCatalogDiffArgs(["--help"], DIR).help).toBe(true);
    expect(() => parseCatalogDiffArgs(["--bogus"], DIR)).toThrow(UsageError);
    expect(() => parseCatalogDiffArgs(["stray"], DIR)).toThrow(UsageError);
  });
});

describe("parseProbeArgs", () => {
  it("defaults to a safe, small run", () => {
    expect(parseProbeArgs([], DIR)).toEqual({
      ids: [],
      onlyIds: false,
      extra: false,
      levels: undefined,
      wire: undefined,
      maxCalls: 60,
      delayMs: 750,
      timeoutMs: 60_000,
      maxTokens: 32,
      dryRun: false,
      resultsDir: DIR,
      workspace: undefined,
      help: false,
    });
  });

  it("reads a comma list of ids, trimmed, without duplicates", () => {
    expect(parseProbeArgs(["--ids", "a, b ,a,,c"], DIR).ids).toEqual(["a", "b", "c"]);
  });

  it("takes the numbers, and refuses one that is not a positive whole number", () => {
    const args = parseProbeArgs(["--max-calls", "5", "--delay-ms", "0", "--timeout-ms", "9000", "--max-tokens", "16"], DIR);
    expect(args).toMatchObject({ maxCalls: 5, delayMs: 0, timeoutMs: 9000, maxTokens: 16 });
    expect(() => parseProbeArgs(["--max-calls", "0"], DIR)).toThrow(/--max-calls/);
    expect(() => parseProbeArgs(["--max-calls", "1.5"], DIR)).toThrow(/--max-calls/);
    expect(() => parseProbeArgs(["--max-calls", "abc"], DIR)).toThrow(/--max-calls/);
    expect(() => parseProbeArgs(["--delay-ms", "-1"], DIR)).toThrow(/--delay-ms/);
    expect(() => parseProbeArgs(["--timeout-ms", "0"], DIR)).toThrow(/--timeout-ms/);
    expect(() => parseProbeArgs(["--max-tokens", "0"], DIR)).toThrow(/--max-tokens/);
  });

  it("caps the call budget so a typo cannot spend a fortune", () => {
    expect(() => parseProbeArgs(["--max-calls", "100000"], DIR)).toThrow(/--max-calls/);
  });

  it("adds Extra and Max only with the flag", () => {
    expect(parseProbeArgs([], DIR).extra).toBe(false);
    expect(parseProbeArgs(["--extra"], DIR).extra).toBe(true);
  });

  it("takes an explicit level list from the ladder, and refuses a word that is not on it", () => {
    expect(parseProbeArgs(["--levels", "none,low,ultra"], DIR).levels).toEqual(["none", "low", "ultra"]);
    expect(() => parseProbeArgs(["--levels", "none,turbo"], DIR)).toThrow(/turbo/);
    expect(() => parseProbeArgs(["--levels", ""], DIR)).toThrow(/--levels/);
  });

  it("takes a concrete wire, and refuses auto or nonsense", () => {
    expect(parseProbeArgs(["--wire", "responses"], DIR).wire).toBe("responses");
    expect(() => parseProbeArgs(["--wire", "auto"], DIR)).toThrow(/--wire/);
    expect(() => parseProbeArgs(["--wire", "grpc"], DIR)).toThrow(/--wire/);
  });

  it("takes --only-ids, --dry-run and --help", () => {
    expect(parseProbeArgs(["--only-ids", "--ids", "x"], DIR)).toMatchObject({ onlyIds: true, ids: ["x"] });
    expect(parseProbeArgs(["--dry-run"], DIR).dryRun).toBe(true);
    expect(parseProbeArgs(["--help"], DIR).help).toBe(true);
  });

  it("refuses --only-ids with nothing to probe", () => {
    expect(() => parseProbeArgs(["--only-ids"], DIR)).toThrow(/--ids/);
  });

  it("refuses a flag it does not know, so a misspelt budget is not silently ignored", () => {
    expect(() => parseProbeArgs(["--max-call", "5"], DIR)).toThrow(UsageError);
  });
});
