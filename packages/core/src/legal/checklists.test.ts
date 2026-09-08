import { describe, expect, it } from "vitest";
import type { DocxClause } from "../docx/types";
import { BUILTIN_PLAYBOOKS, CHECKLIST_MATCH_THRESHOLD, findPlaybook, mapChecklistToClauses } from "./checklists";
import type { Playbook } from "./types";

const EXPECTED_ITEM_COUNTS: Readonly<Record<string, number>> = {
  "generic-contract": 16,
  "credit-agreement-borrower": 22,
  "nda-receiving": 10,
};

function clause(id: string, heading: string, text: string, index: number): DocxClause {
  return { id, path: [index], heading, paragraphs: [`¶${index}`], text, parent: null };
}

const ACA_CLAUSES: readonly DocxClause[] = [
  clause(
    "§1",
    "Definitions and Interpretation",
    'In this Agreement the following words and expressions have the meanings set out below. "Business Day" means a day other than a Saturday, Sunday or public holiday.',
    1,
  ),
  clause(
    "§7",
    "Limitation of Liability",
    "Neither party's aggregate liability under or in connection with this Agreement shall exceed the Charges paid in the twelve months preceding the claim. Nothing in this clause limits liability for death or personal injury.",
    7,
  ),
  clause(
    "§9",
    "Confidentiality",
    "Each party shall keep the other party's Confidential Information confidential and shall not disclose it to any third party without prior written consent.",
    9,
  ),
  clause(
    "§12",
    "Governing Law and Jurisdiction",
    "This Agreement and any dispute or claim arising out of it shall be governed by the laws of England and Wales. The courts of England have exclusive jurisdiction.",
    12,
  ),
];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function generic(): Playbook {
  const playbook = findPlaybook("generic-contract");
  if (!playbook) {
    throw new Error("generic-contract playbook missing");
  }
  return playbook;
}

describe("built-in playbooks", () => {
  it("ship the three contracted ids with the expected item counts", () => {
    expect(BUILTIN_PLAYBOOKS.map((playbook) => playbook.id)).toEqual(Object.keys(EXPECTED_ITEM_COUNTS));
    for (const playbook of BUILTIN_PLAYBOOKS) {
      expect(playbook.items).toHaveLength(EXPECTED_ITEM_COUNTS[playbook.id] as number);
      expect(playbook.title.length).toBeGreaterThan(0);
      expect(playbook.contractType.length).toBeGreaterThan(0);
    }
  });

  it("have unique ids, keywords and non-empty positions on every item", () => {
    const allIds = new Set<string>();
    for (const playbook of BUILTIN_PLAYBOOKS) {
      for (const item of playbook.items) {
        expect(allIds.has(item.id), `duplicate id ${item.id}`).toBe(false);
        allIds.add(item.id);
        expect(item.id).toMatch(/^[A-Z]{2}-\d{2}$/);
        expect(item.title.trim().length).toBeGreaterThan(0);
        expect(item.keywords.length).toBeGreaterThanOrEqual(3);
        expect(item.preferred.trim().length).toBeGreaterThan(20);
        expect(item.fallback.trim().length).toBeGreaterThan(20);
        expect(item.walkAway.trim().length).toBeGreaterThan(20);
        expect(typeof item.required).toBe("boolean");
      }
    }
  });

  it("findPlaybook returns the playbook or null", () => {
    expect(findPlaybook("nda-receiving")?.contractType).toBe("Non-disclosure agreement");
    expect(findPlaybook("credit-agreement-borrower")?.contractType).toBe("Credit agreement");
    expect(findPlaybook("generic-contract")?.contractType).toBe("Commercial agreement");
    expect(findPlaybook("does-not-exist")).toBeNull();
  });
});

describe("mapChecklistToClauses", () => {
  const byTitle = (playbook: Playbook, fragment: string): string => {
    const item = playbook.items.find((candidate) => candidate.title.toLowerCase().includes(fragment));
    if (!item) {
      throw new Error(`no item titled like ${fragment}`);
    }
    return item.id;
  };

  it("maps the obvious clauses and leaves an absent provision unmapped", () => {
    const playbook = generic();
    const mapping = mapChecklistToClauses(playbook, ACA_CLAUSES);
    const clauseFor = (itemId: string) => mapping.mapped.find((entry) => entry.itemId === itemId)?.clauseId;

    expect(clauseFor(byTitle(playbook, "governing law"))).toBe("§12");
    expect(clauseFor(byTitle(playbook, "limitation of liability"))).toBe("§7");
    expect(clauseFor(byTitle(playbook, "confidentiality"))).toBe("§9");
    expect(clauseFor(byTitle(playbook, "definitions"))).toBe("§1");
    expect(mapping.unmapped).toContain(byTitle(playbook, "insurance"));
    expect(mapping.unmapped).toContain(byTitle(playbook, "force majeure"));

    for (const entry of mapping.mapped) {
      expect(entry.score).toBeGreaterThanOrEqual(CHECKLIST_MATCH_THRESHOLD);
      expect(entry.score).toBeLessThanOrEqual(1);
    }
    const covered = new Set([...mapping.mapped.map((entry) => entry.itemId), ...mapping.unmapped]);
    expect(covered.size).toBe(playbook.items.length);
  });

  it("breaks ties by clause order and picks exactly one clause per item", () => {
    const playbook = generic();
    const twin = clause("§12A", "Governing Law and Jurisdiction", ACA_CLAUSES[3]?.text ?? "", 13);
    const mapping = mapChecklistToClauses(playbook, [...ACA_CLAUSES, twin]);
    const governing = mapping.mapped.filter((entry) => entry.itemId === byTitle(playbook, "governing law"));
    expect(governing).toHaveLength(1);
    expect(governing[0]?.clauseId).toBe("§12");
  });

  it("is deterministic and does not mutate its inputs", () => {
    const playbook = deepFreeze(structuredClone(generic()));
    const clauses = deepFreeze(structuredClone(ACA_CLAUSES));
    const before = JSON.stringify({ playbook, clauses });
    const first = mapChecklistToClauses(playbook, clauses);
    const second = mapChecklistToClauses(playbook, clauses);
    expect(first).toEqual(second);
    expect(JSON.stringify({ playbook, clauses })).toBe(before);
  });

  it("returns every item unmapped when there are no clauses", () => {
    const playbook = generic();
    const mapping = mapChecklistToClauses(playbook, []);
    expect(mapping.mapped).toEqual([]);
    expect(mapping.unmapped).toEqual(playbook.items.map((item) => item.id));
  });
});
