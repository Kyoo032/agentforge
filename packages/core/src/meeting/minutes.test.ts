import { describe, expect, it } from "vitest";
import { guardMinutesNames, nameAppearsInTranscript } from "./guard";
import { meetingMinutesSchema, meetingMinutesToMarkdown, minutesNames, NEEDS_OWNER } from "./minutes";
import { meetingTranscriptSchema, meetingTranscriptToMarkdown, transcriptPlainText } from "./transcript";
import { isTranscriptionModelId, pickTranscriptionModel, transcriptionWireFor } from "./asr-model";

const TRANSCRIPT = [
  "Rina: let's start. The checkout error budget is at 2.1 percent.",
  "Sam: I want a dual run before we commit. I'll write the design this week.",
  "Leah: legal will not review a second vendor this month.",
  "Rina: provisional then — we stay on the current gateway through renewal.",
].join("\n");

function minutes(overrides: Record<string, unknown> = {}) {
  return meetingMinutesSchema.parse({
    title: "Checkout weekly",
    summary: "Error budget reviewed; dual run deferred.",
    attendees: [{ name: "Rina" }, { name: "Sam" }, { name: "Leah" }],
    decisions: [{ statement: "Stay on the current gateway through renewal", provisional: true }],
    actionItems: [{ task: "Write the dual-run design", owner: "Sam", due: "this week" }],
    ...overrides,
  });
}

describe("meetingMinutesSchema", () => {
  it("fills every optional list so a renderer never sees undefined", () => {
    const parsed = meetingMinutesSchema.parse({ title: "Standup", summary: "Nothing blocking." });
    expect(parsed).toMatchObject({ attendees: [], decisions: [], actionItems: [], risks: [], openQuestions: [] });
    expect(parsed.heldOn).toBe("");
  });

  it("rejects minutes with no title or summary", () => {
    expect(meetingMinutesSchema.safeParse({ title: "", summary: "x" }).success).toBe(false);
    expect(meetingMinutesSchema.safeParse({ title: "x" }).success).toBe(false);
  });
});

describe("meetingMinutesToMarkdown", () => {
  it("renders action items as a table with owner and due", () => {
    const markdown = meetingMinutesToMarkdown(minutes());
    expect(markdown).toContain("# Checkout weekly");
    expect(markdown).toContain("## Action items");
    expect(markdown).toContain("Write the dual-run design");
    expect(markdown).toContain("Sam");
    expect(markdown).toContain("this week");
  });

  it("marks a provisional decision as provisional", () => {
    expect(meetingMinutesToMarkdown(minutes())).toContain("*(provisional)*");
  });

  it("leaves out a section the meeting produced nothing for", () => {
    const markdown = meetingMinutesToMarkdown(minutes({ risks: [], openQuestions: [] }));
    expect(markdown).not.toContain("## Risks and blockers");
    expect(markdown).not.toContain("## Open questions");
  });

  it("shows an em dash rather than an empty cell for a missing due date", () => {
    const markdown = meetingMinutesToMarkdown(
      minutes({ actionItems: [{ task: "Chase the vendor", owner: NEEDS_OWNER, due: "", firstStep: "" }] }),
    );
    expect(markdown).toContain("| Chase the vendor | [needs owner] | — | — |");
  });
});

describe("nameAppearsInTranscript", () => {
  it("matches on a single token of a longer name", () => {
    expect(nameAppearsInTranscript("Rina Pratiwi", TRANSCRIPT)).toBe(true);
  });

  it("ignores case", () => {
    expect(nameAppearsInTranscript("SAM", TRANSCRIPT)).toBe(true);
  });

  it("is false for someone the transcript never mentions", () => {
    expect(nameAppearsInTranscript("Gunther Wallace", TRANSCRIPT)).toBe(false);
  });

  it("does not count an honorific or a stopword as evidence", () => {
    expect(nameAppearsInTranscript("Pak Budi", TRANSCRIPT)).toBe(false);
  });

  it("leaves a name with no usable token alone rather than stamping it on no evidence", () => {
    expect(nameAppearsInTranscript("JP", TRANSCRIPT)).toBe(true);
  });
});

describe("guardMinutesNames", () => {
  it("passes minutes whose every name was said", () => {
    const result = guardMinutesNames(minutes(), TRANSCRIPT);
    expect(result.replaced).toBe(0);
    expect(result.unverified).toEqual([]);
    expect(result.minutes.attendees).toHaveLength(3);
  });

  it("drops an attendee the transcript never named", () => {
    const result = guardMinutesNames(
      minutes({ attendees: [{ name: "Rina" }, { name: "Gunther Wallace" }] }),
      TRANSCRIPT,
    );
    expect(result.unverified).toEqual(["Gunther Wallace"]);
    expect(result.minutes.attendees.map((a) => a.name)).toEqual(["Rina"]);
    expect(result.replaced).toBe(1);
  });

  it("keeps an invented owner's action but marks the owner as needed", () => {
    const result = guardMinutesNames(
      minutes({
        attendees: [],
        actionItems: [{ task: "Ship the migration", owner: "Gunther Wallace", due: "", firstStep: "" }],
      }),
      TRANSCRIPT,
    );
    expect(result.minutes.actionItems).toHaveLength(1);
    expect(result.minutes.actionItems[0]?.task).toBe("Ship the migration");
    expect(result.minutes.actionItems[0]?.owner).toBe(NEEDS_OWNER);
  });

  it("does not stamp its own [needs owner] marker", () => {
    const result = guardMinutesNames(
      minutes({
        attendees: [],
        actionItems: [{ task: "Chase the vendor", owner: NEEDS_OWNER, due: "", firstStep: "" }],
      }),
      TRANSCRIPT,
    );
    expect(result.replaced).toBe(0);
    expect(result.minutes.actionItems[0]?.owner).toBe(NEEDS_OWNER);
  });

  it("guards an empty transcript by refusing every name, not by passing them all", () => {
    const result = guardMinutesNames(minutes(), "");
    expect(result.minutes.attendees).toEqual([]);
    expect(result.minutes.actionItems[0]?.owner).toBe(NEEDS_OWNER);
  });
});

describe("minutesNames", () => {
  it("collects attendees and owners once each", () => {
    expect(minutesNames(minutes()).sort()).toEqual(["Leah", "Rina", "Sam"]);
  });
});

describe("transcript", () => {
  it("renders segments with a timestamp and a speaker when it has them", () => {
    const transcript = meetingTranscriptSchema.parse({
      segments: [
        { startSeconds: 0, speaker: "Rina", text: "Let's start." },
        { startSeconds: 3725, speaker: "", text: "Any other business?" },
      ],
    });
    const markdown = meetingTranscriptToMarkdown(transcript, "Checkout weekly — transcript");
    expect(markdown).toContain("[00:00] **Rina:** Let's start.");
    expect(markdown).toContain("[1:02:05] Any other business?");
  });

  it("falls back to the flat text when there are no segments", () => {
    const transcript = meetingTranscriptSchema.parse({ text: "One long block." });
    expect(meetingTranscriptToMarkdown(transcript, "T")).toContain("One long block.");
  });

  it("reads plain text out of segments when no flat text was stored", () => {
    const transcript = meetingTranscriptSchema.parse({
      segments: [{ speaker: "Sam", text: "I want a dual run." }],
    });
    expect(transcriptPlainText(transcript)).toBe("Sam: I want a dual run.");
  });

  it("defaults an un-sourced transcript to pasted, not to a machine transcription", () => {
    expect(meetingTranscriptSchema.parse({ text: "x" }).source).toBe("pasted");
  });
});

describe("transcription model routing", () => {
  it("recognises the gateway's own ASR id", () => {
    expect(isTranscriptionModelId("mimo-v2.5-asr")).toBe(true);
  });

  it("does not mistake an ordinary chat model for a recogniser", () => {
    for (const id of ["gpt-5.6-luna", "claude-sonnet-5", "deepseek-v4-flash", "glm-5.3"]) {
      expect(isTranscriptionModelId(id), id).toBe(false);
    }
  });

  it("drives mimo over chat completions and whisper over the multipart route", () => {
    expect(transcriptionWireFor("mimo-v2.5-asr")).toBe("chat_audio");
    expect(transcriptionWireFor("qwen3.5-omni-flash")).toBe("chat_audio");
    expect(transcriptionWireFor("whisper-1")).toBe("audio_transcriptions");
    expect(transcriptionWireFor("gpt-4o-transcribe")).toBe("audio_transcriptions");
  });

  it("prefers the purpose-built recogniser over an omni model that merely hears audio", () => {
    expect(pickTranscriptionModel(["qwen3.5-omni-flash", "mimo-v2.5-asr", "gpt-5.6-luna"])).toBe("mimo-v2.5-asr");
  });

  it("returns undefined rather than inventing an id the gateway would 404 on", () => {
    expect(pickTranscriptionModel(["gpt-5.6-luna", "claude-sonnet-5"])).toBeUndefined();
  });
});
