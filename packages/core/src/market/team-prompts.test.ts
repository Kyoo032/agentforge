import { describe, expect, it } from "vitest";
import { scanForAdvice } from "./advice-guard";
import { packetToPromptBlock } from "./briefing-prompt";
import { harnessFor, type MarketSource } from "./harness";
import { MARKET_SPECIALISTS } from "./specialist-ids";
import { MARKET_ANALYSTS, type MarketAnalyst } from "./team";
import {
  TEAM_SECTION_KEYS,
  analystPacketOrder,
  analystSections,
  analystSystemPrompt,
  bearPrompt,
  bullPrompt,
  riskPrompt,
  synthesisPrompt,
  teamSectionHeadings,
} from "./team-prompts";
import { makeFullPacket } from "./watch-fixtures";

const LANGUAGES = ["id", "en"] as const;

/** Every prompt this module builds, for every desk and language. */
function everyPrompt(): { label: string; text: string }[] {
  return MARKET_SPECIALISTS.flatMap((specialist) =>
    LANGUAGES.flatMap((language) => [
      ...MARKET_ANALYSTS.map((analyst) => ({
        label: `${specialist}/${language}/${analyst}`,
        text: analystSystemPrompt(analyst, specialist, language),
      })),
      { label: `${specialist}/${language}/bull`, text: bullPrompt(specialist, language) },
      { label: `${specialist}/${language}/bear`, text: bearPrompt(specialist, language) },
      { label: `${specialist}/${language}/risk`, text: riskPrompt(specialist, language) },
      { label: `${specialist}/${language}/synthesis`, text: synthesisPrompt(specialist, language) },
    ]),
  );
}

describe("analystSections", () => {
  it("maps each analyst onto the packet sections it is allowed to read", () => {
    expect([...analystSections("technical")]).toEqual(["quotes", "technicals", "signals", "swings"]);
    expect([...analystSections("fundamentals")]).toEqual(["fundamentals", "insiders"]);
    expect([...analystSections("sentiment")]).toEqual(["sentiment", "headlines"]);
    expect([...analystSections("news")]).toEqual(["headlines", "globalNews", "macro", "sessions"]);
  });

  it("names only known sources and gives every analyst at least one", () => {
    const known: ReadonlySet<string> = new Set<MarketSource>([
      "quotes",
      "history",
      "technicals",
      "macro",
      "headlines",
      "swings",
      "crypto",
      "metals",
      "signals",
      "rotation",
      "sessions",
      "fundamentals",
      "insiders",
      "sentiment",
      "globalNews",
    ]);
    for (const analyst of MARKET_ANALYSTS) {
      const sections = analystSections(analyst);
      expect(sections.length).toBeGreaterThan(0);
      expect(new Set(sections).size).toBe(sections.length);
      for (const section of sections) {
        expect(known.has(section)).toBe(true);
      }
    }
  });

  it("intersects with the desk's own packet order, keeping the desk's order", () => {
    for (const specialist of MARKET_SPECIALISTS) {
      const order = harnessFor(specialist).packetOrder;
      for (const analyst of MARKET_ANALYSTS) {
        const allowed: ReadonlySet<MarketSource> = new Set(analystSections(analyst));
        expect([...analystPacketOrder(analyst, specialist)]).toEqual(order.filter((source) => allowed.has(source)));
      }
    }
  });
});

describe("the packet block an analyst sees", () => {
  const packet = makeFullPacket();

  it("shows the fundamentals analyst its own sections and nothing else", () => {
    const block = packetToPromptBlock(packet, "saham", analystSections("fundamentals"));
    expect(block).toContain("- FUNDAMENTALS:");
    expect(block).toContain("- INSIDERS:");
    expect(block).not.toContain("- SENTIMENT:");
    expect(block).not.toContain("- news:");
    expect(block).not.toContain("MACRO:");
    expect(block).not.toContain("- technical:");
  });

  it("shows the sentiment analyst the crowd read and the headlines only", () => {
    const block = packetToPromptBlock(packet, "saham", analystSections("sentiment"));
    expect(block).toContain("- SENTIMENT:");
    expect(block).toContain("- news:");
    expect(block).not.toContain("- FUNDAMENTALS:");
    expect(block).not.toContain("- quote:");
  });

  it("shows the technical analyst the chart sections and no headlines", () => {
    const block = packetToPromptBlock(packet, "scanner", analystSections("technical"));
    expect(block).toContain("- quote:");
    expect(block).toContain("- technical:");
    expect(block).toContain("SIGNALS (computed):");
    expect(block).not.toContain("- news:");
    expect(block).not.toContain("- SENTIMENT:");
  });

  it("shows the news analyst the macro context and never the fundamentals", () => {
    const block = packetToPromptBlock(packet, "news", analystSections("news"));
    expect(block).toContain("- news:");
    expect(block).toContain("GLOBAL NEWS");
    expect(block).not.toContain("- FUNDAMENTALS:");
    expect(block).not.toContain("- technical:");
  });
});

describe("analystSystemPrompt", () => {
  it("names the analyst's job, the JSON shape, and the house rules, in both languages", () => {
    for (const analyst of MARKET_ANALYSTS) {
      for (const language of LANGUAGES) {
        const prompt = analystSystemPrompt(analyst, "saham", language);
        expect(prompt).toContain("DATA PACKET");
        expect(prompt).toContain('"summary"');
        expect(prompt).toContain('"keyPoints"');
        expect(prompt).toContain('"confidence"');
        expect(prompt).toMatch(/ONLY JSON|HANYA JSON/);
        expect(prompt.length).toBeGreaterThan(200);
      }
      expect(analystSystemPrompt(analyst, "saham", "id")).not.toBe(analystSystemPrompt(analyst, "saham", "en"));
    }
  });

  it("gives two analysts two different prompts and names the desk", () => {
    const seen = new Set(MARKET_ANALYSTS.map((analyst) => analystSystemPrompt(analyst, "saham", "en")));
    expect(seen.size).toBe(MARKET_ANALYSTS.length);
    expect(analystSystemPrompt("news", "crypto", "en")).not.toBe(analystSystemPrompt("news", "saham", "en"));
  });

  it("tells every analyst to be honest about a section that came back empty", () => {
    for (const language of LANGUAGES) {
      for (const analyst of MARKET_ANALYSTS) {
        const prompt = analystSystemPrompt(analyst, "saham", language);
        expect(prompt).toMatch(language === "en" ? /missing|unavailable|less robust/i : /tidak tersedia|kurang kuat/i);
      }
    }
  });
});

describe("bullPrompt / bearPrompt / riskPrompt", () => {
  it("asks the bull and the bear for the same JSON shape with opposite stances", () => {
    for (const language of LANGUAGES) {
      const bull = bullPrompt("saham", language);
      const bear = bearPrompt("saham", language);
      for (const prompt of [bull, bear]) {
        expect(prompt).toContain('"thesis"');
        expect(prompt).toContain('"points"');
        expect(prompt).toContain('"rebuttals"');
      }
      expect(bull).toContain('"bull"');
      expect(bear).toContain('"bear"');
      expect(bull).not.toBe(bear);
    }
  });

  it("tells the bear it is answering the bull's own JSON, once", () => {
    for (const language of LANGUAGES) {
      expect(bearPrompt("saham", language)).toMatch(language === "en" ? /bull case/i : /kasus bullish/i);
    }
  });

  it("asks for the three lenses in one JSON, plus volatility and liquidity", () => {
    for (const language of LANGUAGES) {
      const prompt = riskPrompt("saham", language);
      for (const lens of ["aggressive", "neutral", "conservative"]) {
        expect(prompt).toContain(lens);
      }
      expect(prompt).toContain('"lenses"');
      expect(prompt).toContain('"volatility"');
      expect(prompt).toContain('"liquidity"');
    }
  });
});

describe("teamSectionHeadings / synthesisPrompt", () => {
  it("returns the five headings in the fixed order, translated", () => {
    expect([...TEAM_SECTION_KEYS]).toEqual(["analystNotes", "bull", "bear", "risk", "balance"]);
    const en = teamSectionHeadings("en");
    expect([...en]).toEqual(["Analyst notes", "Bull case", "Bear case", "Risk read", "Balance of evidence"]);
    const id = teamSectionHeadings("id");
    expect(id).toHaveLength(TEAM_SECTION_KEYS.length);
    expect(id).not.toEqual(en);
    for (const heading of id) {
      expect(heading.trim()).not.toBe("");
    }
  });

  it("asks the synthesis for those headings, in that order, and for the existing JSON shape", () => {
    for (const language of LANGUAGES) {
      const prompt = synthesisPrompt("saham", language);
      const headings = teamSectionHeadings(language);
      let cursor = -1;
      for (const heading of headings) {
        const at = prompt.indexOf(heading);
        expect({ heading, found: at >= 0 }).toEqual({ heading, found: true });
        expect(at).toBeGreaterThan(cursor);
        cursor = at;
      }
      expect(prompt).toContain('"title"');
      expect(prompt).toContain('"sections"');
      expect(prompt).toContain('"heading"');
      expect(prompt).toContain('"body"');
    }
  });

  it("refuses a rating, a price target, and a directive in the balance section", () => {
    for (const language of LANGUAGES) {
      const prompt = synthesisPrompt("saham", language);
      expect(prompt).toMatch(language === "en" ? /no rating/i : /tanpa rating/i);
      expect(prompt).toMatch(language === "en" ? /no price target/i : /tanpa target harga/i);
      expect(prompt).toMatch(language === "en" ? /what would change the read/i : /apa yang mengubah pembacaan/i);
    }
  });
});

describe("the advice guard over every team prompt", () => {
  it("finds no directive in any prompt, in any language, for any desk", () => {
    for (const { label, text } of everyPrompt()) {
      expect({ label, hits: scanForAdvice(text) }).toEqual({ label, hits: [] });
    }
  });

  it("repeats the number rule in every prompt", () => {
    for (const { label, text } of everyPrompt()) {
      expect({ label, packet: text.includes("DATA PACKET") }).toEqual({ label, packet: true });
    }
  });
});

describe("analyst prompts are stable", () => {
  it("builds the same text twice for the same inputs", () => {
    const once = analystSystemPrompt("technical" as MarketAnalyst, "saham", "id");
    expect(analystSystemPrompt("technical", "saham", "id")).toBe(once);
  });
});
