export type StubEditScenario = {
  id: "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9" | "S10";
  match: RegExp;
  toolKey: string;
  args: Record<string, unknown>;
  cardVerb: string;
  cardObject: string;
};

export const STUB_EDIT_SCENARIOS: StubEditScenario[] = [
  {
    id: "S1",
    match: /remove the silences/i,
    toolKey: "remove_silence",
    args: {
      ranges: [
        { startFrame: 300, endFrame: 360 },
        { startFrame: 750, endFrame: 825 },
        { startFrame: 1350, endFrame: 1395 },
      ],
    },
    cardVerb: "Remove 3 silences",
    cardObject: "v1",
  },
  {
    id: "S2",
    match: /split at the scene/i,
    toolKey: "split_at_scenes",
    args: { frames: [450, 900] },
    cardVerb: "Split at scenes",
    cardObject: "v1",
  },
  {
    id: "S3",
    match: /captions from this script/i,
    toolKey: "add_caption",
    args: { source: "script" },
    cardVerb: "Add captions",
    cardObject: "script",
  },
  {
    id: "S4",
    match: /auto captions/i,
    toolKey: "transcribe",
    args: {},
    cardVerb: "Transcribe",
    cardObject: "talk track",
  },
  {
    id: "S5",
    match: /9:16 for reels/i,
    toolKey: "reframe",
    args: { aspect: "9:16", mode: "pad", confirm: true },
    cardVerb: "Reframe",
    cardObject: "9:16",
  },
  {
    id: "S6",
    match: /title ['"]?summer sale/i,
    toolKey: "add_title",
    args: { text: "Summer Sale" },
    cardVerb: "Add title",
    cardObject: "Summer Sale",
  },
  {
    id: "S7",
    match: /trim the first 3 seconds/i,
    toolKey: "trim_clip",
    args: { inFrame: 90 },
    cardVerb: "Trim clip",
    cardObject: "3 seconds",
  },
  {
    id: "S8",
    match: /move the second clip to the start/i,
    toolKey: "move_clip",
    args: { timelineStartFrame: 0 },
    cardVerb: "Move clip",
    cardObject: "start",
  },
  {
    id: "S9",
    match: /delete everything/i,
    toolKey: "clear_timeline",
    args: {},
    cardVerb: "Clear timeline",
    cardObject: "all clips",
  },
  {
    id: "S10",
    match: /undo the last/i,
    toolKey: "__undo__",
    args: { marker: "undo_last" },
    cardVerb: "Undo",
    cardObject: "last change",
  },
];

export function matchStubEditScenario(text: string): StubEditScenario | null {
  for (const scenario of STUB_EDIT_SCENARIOS) {
    if (scenario.match.test(text)) {
      return scenario;
    }
  }
  return null;
}
