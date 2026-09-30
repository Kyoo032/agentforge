import { describe, expect, it } from "vitest";
import { EVERYDAY_MODEL_IDS } from "./gateway-roles";
import { JOB_FALLBACK_TAIL } from "./job-fallback";
import { JOB_MODE_PREFERENCES } from "./mode-defaults";
import { MODEL_POLICY_TABLE, modelPolicy } from "./model-policy";
import { CHAT_DEFAULT_PREFERENCES } from "./preferred";

/**
 * Every id the product recommends, defaults to, or falls back on must be a model the policy table
 * knows. An id that is not gets the conservative unknown profile (no effort sent unless chosen, never
 * recommended, never a default), so a list that names one is a list that quietly does nothing.
 *
 * There is no allow-absent set any more: `hy3` entered the table on 2026-09-30 (probe), and the
 * `hy-3` / `hunyuan-3` / `hunyuan3` spellings, which the gateway never listed, left the lists. Do not
 * add an id to a list without adding it to `MODEL_POLICY_TABLE` with a `verified` note.
 */
const LISTS: Record<string, readonly string[]> = {
  CHAT_DEFAULT_PREFERENCES,
  EVERYDAY_MODEL_IDS: [...EVERYDAY_MODEL_IDS],
  JOB_FALLBACK_TAIL,
  ...Object.fromEntries(Object.entries(JOB_MODE_PREFERENCES).map(([mode, ids]) => [`JOB_MODE_PREFERENCES.${mode}`, ids])),
};

/** The ids the 2026-09-30 recommendations name that were probed live and so have an entry of their own. */
const PROBED_2026_09_30 = [
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6-astra",
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "deepseek-v4-1-flash",
  "hy3",
];

describe("preference lists only name models the policy table knows", () => {
  for (const [name, ids] of Object.entries(LISTS)) {
    it(name, () => {
      const unknown = ids.filter((id) => !modelPolicy(id).known);
      expect(unknown).toEqual([]);
    });
  }

  it("covers the meeting minutes list and every job mode", () => {
    expect(Object.keys(LISTS)).toEqual(
      expect.arrayContaining([
        "JOB_MODE_PREFERENCES.meeting",
        "JOB_MODE_PREFERENCES.documents",
        "JOB_MODE_PREFERENCES.finance",
        "JOB_MODE_PREFERENCES.legal",
      ]),
    );
    expect(LISTS["JOB_MODE_PREFERENCES.meeting"]).toContain("gpt-6-sol");
  });

  it("resolves every listed id to an entry with a verified note", () => {
    for (const ids of Object.values(LISTS)) {
      for (const id of ids) {
        expect(modelPolicy(id).verified.trim().length, id).toBeGreaterThan(10);
      }
    }
  });
});

describe("the models probed on 2026-09-30 have an entry of their own", () => {
  it("names each by exact id and cites the probe", () => {
    for (const id of PROBED_2026_09_30) {
      const policy = modelPolicy(id);
      const entry = MODEL_POLICY_TABLE.find((candidate) => candidate.key === policy.key);
      expect(entry, id).toBeDefined();
      expect(entry?.ids, id).toContain(id);
      expect(entry?.verified, id).toMatch(/probe 2026-09-30/);
    }
  });

  it("covers every new id the lists lead with: the Chat default, the Recommended set's newcomers and each mode head", () => {
    const newIds = ["gpt-6-luna", "gpt-6-sol", "claude-sonnet-5-5", "deepseek-v4-1-flash", "hy3"];
    const heads = [
      ...CHAT_DEFAULT_PREFERENCES.slice(0, 7),
      ...Object.values(JOB_MODE_PREFERENCES).map((ids) => ids[0] as string),
      JOB_FALLBACK_TAIL[0] as string,
    ];
    for (const id of newIds) {
      expect(heads, id).toContain(id);
      expect(PROBED_2026_09_30, id).toContain(id);
    }
  });
});

describe("the Recommended set and the Chat default list agree", () => {
  it("lists every Recommended model in CHAT_DEFAULT_PREFERENCES, in the same order, ahead of the stand-ins", () => {
    const everyday = [...EVERYDAY_MODEL_IDS];
    expect(CHAT_DEFAULT_PREFERENCES.slice(0, everyday.length)).toEqual(everyday);
    for (const standIn of CHAT_DEFAULT_PREFERENCES.slice(everyday.length)) {
      expect(EVERYDAY_MODEL_IDS.has(standIn), standIn).toBe(false);
    }
  });

  it("makes GPT 6 Luna the Chat default", () => {
    expect(CHAT_DEFAULT_PREFERENCES[0]).toBe("gpt-6-luna");
  });
});
