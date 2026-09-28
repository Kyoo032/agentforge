/**
 * Each new Meeting skill, under the stub runtime. These checks do not call the gateway.
 * The stub desk still refuses a live run; this file is what proves the skills themselves run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { minutesAgree } from "./agree";
import { meetingPhaseLabel } from "./copy";
import { FIGURE_NOT_SAID, figureSaid, guardMinutesGrounding } from "./ground";
import { meetingMinutesSchema, type MeetingMinutes } from "./minutes";
import { MeetingTranslationError, translateMeetingSheet, writeMeetingSheet } from "./sheet";

const TRANSCRIPT = "Rina: the error budget is at 2.1 percent. We ship on Friday.";

function sheet(overrides: Record<string, unknown> = {}): MeetingMinutes {
  return meetingMinutesSchema.parse({
    title: "Checkout weekly",
    heldOn: "Friday",
    summary: "The error budget is at 2.1 percent.",
    attendees: [{ name: "Rina", role: "" }],
    decisions: [{ statement: "Ship on Friday", provisional: true, context: "" }],
    actionItems: [{ task: "Ship the fix", owner: "Rina", due: "Friday", firstStep: "" }],
    risks: [],
    openQuestions: [],
    ...overrides,
  });
}

beforeEach(() => {
  vi.stubEnv("AGENTFORGE_RUNTIME", "stub");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("stub runtime runs each new meeting skill", () => {
  it("writes the sheet again when the first answer is not minutes", async () => {
    expect(process.env.AGENTFORGE_RUNTIME).toBe("stub");
    const prompts: string[] = [];
    const settled = await writeMeetingSheet({
      transcript: TRANSCRIPT,
      title: "Checkout weekly",
      locale: "en",
      ask: async (prompt) => {
        prompts.push(prompt);
        if (prompts.length === 1) {
          return "Here are your minutes, in prose.";
        }
        return JSON.stringify(sheet());
      },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("previous answer was not the minutes JSON");
    expect(settled.minutes.summary).toContain("2.1");
    expect(settled.minutes.heldOn).toBe("Friday");
    expect(settled.replacedFigures).toBe(0);
    expect(settled.clearedDates).toBe(0);
  });

  it("drops a date and a figure the transcript never said, and keeps the ones it did", async () => {
    const settled = await writeMeetingSheet({
      transcript: TRANSCRIPT,
      title: "Checkout weekly",
      locale: "en",
      ask: async () =>
        JSON.stringify(
          sheet({
            heldOn: "Monday",
            summary: "The error budget is at 2.1 percent, and latency hit 99 ms.",
            actionItems: [{ task: "Ship the fix", owner: "Rina", due: "next year", firstStep: "" }],
          }),
        ),
    });
    expect(settled.minutes.heldOn).toBe("");
    expect(settled.minutes.actionItems[0]?.due).toBe("");
    expect(settled.clearedDates).toBe(2);
    expect(settled.minutes.summary).toContain("2.1");
    expect(settled.minutes.summary).not.toContain("99");
    expect(settled.minutes.summary).toContain(FIGURE_NOT_SAID);
    expect(settled.replacedFigures).toBe(1);
    expect(figureSaid("12", "the total is 120")).toBe(false);
    expect(figureSaid("2.1", "at 2,1 percent")).toBe(true);
    const again = guardMinutesGrounding(settled.minutes, TRANSCRIPT);
    expect(again.replacedFigures).toBe(0);
    expect(again.clearedDates).toBe(0);
  });

  it("asks again when the other language is not the same sheet", async () => {
    const source = sheet();
    const prompts: string[] = [];
    const translated = await translateMeetingSheet({
      transcript: TRANSCRIPT,
      source,
      locale: "id",
      ask: async (prompt) => {
        prompts.push(prompt);
        if (prompts.length === 1) {
          return JSON.stringify(sheet({ title: "Rapat", decisions: [] }));
        }
        return JSON.stringify({ ...source, title: "Rapat", summary: "Anggaran galat ada di 2.1 persen." });
      },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Terjemahan sebelumnya");
    expect(translated.minutes.decisions).toHaveLength(1);
    expect(translated.minutes.decisions[0]?.provisional).toBe(true);
    expect(translated.minutes.actionItems[0]?.owner).toBe("Rina");
    expect(minutesAgree(source, translated.minutes).ok).toBe(true);
  });

  it("does not save a translation that still disagrees, and does not ask a third time", async () => {
    let calls = 0;
    await expect(
      translateMeetingSheet({
        transcript: TRANSCRIPT,
        source: sheet(),
        locale: "id",
        ask: async () => {
          calls += 1;
          return JSON.stringify(sheet({ decisions: [] }));
        },
      }),
    ).rejects.toBeInstanceOf(MeetingTranslationError);
    expect(calls).toBe(2);
  });

  it("does not ask again when the model call itself fails", async () => {
    let calls = 0;
    await expect(
      writeMeetingSheet({
        transcript: TRANSCRIPT,
        title: "Checkout weekly",
        locale: "en",
        ask: async () => {
          calls += 1;
          throw new Error("gateway down");
        },
      }),
    ).rejects.toThrow("gateway down");
    expect(calls).toBe(1);
  });

  it("still drops a person the room never named", async () => {
    const settled = await writeMeetingSheet({
      transcript: TRANSCRIPT,
      title: "Checkout weekly",
      locale: "en",
      ask: async () =>
        JSON.stringify(
          sheet({
            attendees: [
              { name: "Rina", role: "" },
              { name: "Ghost Person", role: "" },
            ],
          }),
        ),
    });
    expect(settled.minutes.attendees.map((attendee) => attendee.name)).toEqual(["Rina"]);
    expect(settled.replacedNames).toBe(1);
    expect(settled.unverifiedNames).toEqual(["Ghost Person"]);
  });

  it("names the check in the desk language", () => {
    expect(meetingPhaseLabel("grounding", "en")).toBe("Checking names, dates, and figures");
    expect(meetingPhaseLabel("grounding", "id")).toBe("Memeriksa nama, tanggal, dan angka");
    expect(meetingPhaseLabel("writing-again", "id")).toBe("Menulis notulen sekali lagi");
  });
});
