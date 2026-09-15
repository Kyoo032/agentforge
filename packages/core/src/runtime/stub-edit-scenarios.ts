import { parseAppLocale, type AppLocale } from "../locale";

export type StubEditScenario = {
  id: "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9" | "S10";
  match: RegExp;
  toolKey: string;
  args: Record<string, unknown>;
  cardVerb: string;
  cardObject: string;
  /** Bahasa Indonesia card copy; the host picks by `localeForRun()`. */
  cardVerbId: string;
  cardObjectId: string;
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
    cardVerbId: "Hapus 3 jeda sunyi",
    cardObjectId: "v1",
  },
  {
    id: "S2",
    match: /split at the scene/i,
    toolKey: "split_at_scenes",
    args: { frames: [450, 900] },
    cardVerb: "Split at scenes",
    cardObject: "v1",
    cardVerbId: "Potong di pergantian adegan",
    cardObjectId: "v1",
  },
  {
    id: "S3",
    match: /captions from this script/i,
    toolKey: "add_caption",
    args: { source: "script" },
    cardVerb: "Add captions",
    cardObject: "script",
    cardVerbId: "Tambahkan teks overlay",
    cardObjectId: "naskah",
  },
  {
    id: "S4",
    match: /auto captions/i,
    toolKey: "transcribe",
    args: {},
    cardVerb: "Transcribe",
    cardObject: "talk track",
    cardVerbId: "Transkripsikan",
    cardObjectId: "trek suara",
  },
  {
    id: "S5",
    match: /9:16 for reels/i,
    toolKey: "reframe",
    args: { aspect: "9:16", mode: "pad", confirm: true },
    cardVerb: "Reframe",
    cardObject: "9:16",
    cardVerbId: "Ubah bingkai",
    cardObjectId: "9:16",
  },
  {
    id: "S6",
    match: /title ['"]?summer sale/i,
    toolKey: "add_title",
    args: { text: "Summer Sale" },
    cardVerb: "Add title",
    cardObject: "Summer Sale",
    cardVerbId: "Tambahkan judul",
    cardObjectId: "Summer Sale",
  },
  {
    id: "S7",
    match: /trim the first 3 seconds/i,
    toolKey: "trim_clip",
    args: { inFrame: 90 },
    cardVerb: "Trim clip",
    cardObject: "3 seconds",
    cardVerbId: "Pangkas klip",
    cardObjectId: "3 detik",
  },
  {
    id: "S8",
    match: /move the second clip to the start/i,
    toolKey: "move_clip",
    args: { timelineStartFrame: 0 },
    cardVerb: "Move clip",
    cardObject: "start",
    cardVerbId: "Pindahkan klip",
    cardObjectId: "awal",
  },
  {
    id: "S9",
    match: /delete everything/i,
    toolKey: "clear_timeline",
    args: {},
    cardVerb: "Clear timeline",
    cardObject: "all clips",
    cardVerbId: "Kosongkan linimasa",
    cardObjectId: "semua klip",
  },
  {
    id: "S10",
    match: /undo the last/i,
    toolKey: "__undo__",
    args: { marker: "undo_last" },
    cardVerb: "Undo",
    cardObject: "last change",
    cardVerbId: "Urungkan",
    cardObjectId: "perubahan terakhir",
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

type StubCardSource = {
  toolKey: string;
  cardVerb?: string;
  cardObject?: string;
  cardVerbId?: string;
  cardObjectId?: string;
};

/**
 * Card copy for a matched stub scenario in the run locale. Fill and generate scenarios
 * carry only English copy today, so `id` falls back to it rather than showing a blank card.
 */
export function stubEditCardCopy(scenario: StubCardSource, locale: AppLocale): { verb: string; object: string } {
  const wantsId = parseAppLocale(locale) === "id";
  const verb = (wantsId ? scenario.cardVerbId : "") || scenario.cardVerb || "Edit";
  const object = (wantsId ? scenario.cardObjectId : "") || scenario.cardObject || scenario.toolKey;
  return { verb, object };
}
