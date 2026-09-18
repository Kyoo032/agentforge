import { describe, expect, it } from "vitest";
import {
  EMPTY_FINANCE_DRAFT,
  FINANCE_DRAFT_MAX_CHARS,
  HOME_FINANCE_SCOPE,
  clearFinanceDraft,
  financeDraftKey,
  loadFinanceDraft,
  parseFinanceDraft,
  saveFinanceDraft,
  type FinanceDraftStore,
} from "./finance-drafts";

/** A plain object stands in for `localStorage`; this package runs vitest node-only. */
function store(): FinanceDraftStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe("financeDraftKey", () => {
  it("scopes a draft to one desk and one task", () => {
    expect(financeDraftKey("ws-1", "brief")).toBe("agentforge-finance-draft:ws-1:brief");
    expect(financeDraftKey("ws-1", "cashflow")).not.toBe(financeDraftKey("ws-1", "brief"));
    expect(financeDraftKey("ws-2", "brief")).not.toBe(financeDraftKey("ws-1", "brief"));
  });

  it("names the owner's home desk rather than writing an empty segment", () => {
    expect(financeDraftKey(null, "brief")).toBe(`agentforge-finance-draft:${HOME_FINANCE_SCOPE}:brief`);
    expect(financeDraftKey("   ", "brief")).toBe(financeDraftKey(undefined, "brief"));
  });
});

describe("parseFinanceDraft", () => {
  it("reads a draft back", () => {
    expect(parseFinanceDraft(JSON.stringify({ prompt: "p", figures: "f" }))).toEqual({ prompt: "p", figures: "f" });
  });

  it("treats anything unusable as nothing rather than blanking on a throw", () => {
    for (const raw of [null, undefined, "", "   ", "not json", "[]", '"text"', "12"]) {
      expect(parseFinanceDraft(raw), String(raw)).toBeNull();
    }
  });

  it("drops fields that are not strings instead of trusting a hand-edited key", () => {
    expect(parseFinanceDraft(JSON.stringify({ prompt: 3, figures: ["x"] }))).toEqual({ prompt: "", figures: "" });
  });

  it("caps a field a pasted spreadsheet blew up", () => {
    const long = "x".repeat(FINANCE_DRAFT_MAX_CHARS + 500);
    expect(parseFinanceDraft(JSON.stringify({ prompt: long, figures: "" }))?.prompt).toHaveLength(
      FINANCE_DRAFT_MAX_CHARS,
    );
  });
});

describe("loadFinanceDraft / saveFinanceDraft", () => {
  it("keeps one task's draft away from another's", () => {
    const s = store();
    saveFinanceDraft("ws-1", "brief", { prompt: "brief prompt", figures: "rev 100" }, s);
    saveFinanceDraft("ws-1", "cashflow", { prompt: "cash prompt", figures: "jan 10" }, s);
    expect(loadFinanceDraft("ws-1", "brief", s)).toEqual({ prompt: "brief prompt", figures: "rev 100" });
    expect(loadFinanceDraft("ws-1", "cashflow", s)).toEqual({ prompt: "cash prompt", figures: "jan 10" });
  });

  it("keeps one desk's draft away from another desk's", () => {
    const s = store();
    saveFinanceDraft("ws-1", "brief", { prompt: "one", figures: "" }, s);
    expect(loadFinanceDraft("ws-2", "brief", s)).toEqual(EMPTY_FINANCE_DRAFT);
  });

  it("opens empty when nothing was ever kept", () => {
    expect(loadFinanceDraft("ws-never", "brief", store())).toEqual(EMPTY_FINANCE_DRAFT);
  });

  it("clears the key when the draft is emptied, rather than leaving a blank record", () => {
    const s = store();
    saveFinanceDraft("ws-1", "brief", { prompt: "one", figures: "" }, s);
    expect(s.map.size).toBe(1);
    saveFinanceDraft("ws-1", "brief", { prompt: "  ", figures: "" }, s);
    expect(s.map.size).toBe(0);
    expect(loadFinanceDraft("ws-1", "brief", s)).toEqual(EMPTY_FINANCE_DRAFT);
  });

  it("forgets one task on request", () => {
    const s = store();
    saveFinanceDraft("ws-1", "brief", { prompt: "one", figures: "" }, s);
    clearFinanceDraft("ws-1", "brief", s);
    expect(loadFinanceDraft("ws-1", "brief", s)).toEqual(EMPTY_FINANCE_DRAFT);
  });

  it("survives a store that throws, the way private mode does", () => {
    const blocked: FinanceDraftStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    saveFinanceDraft("ws-blocked", "brief", { prompt: "kept", figures: "" }, blocked);
    expect(loadFinanceDraft("ws-blocked", "brief", blocked)).toEqual({ prompt: "kept", figures: "" });
  });
});
