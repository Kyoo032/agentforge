export type RecipeStep = {
  tool: string;
  args: Record<string, unknown>;
};

export type Recipe = {
  id: string;
  name: string;
  steps: RecipeStep[];
};

export const RECIPES: Recipe[] = [
  {
    id: "podcast-clean-up",
    name: "Podcast clean-up",
    steps: [
      { tool: "detect_silence", args: { assetId: "{{assetId}}", noiseDb: -30, minSeconds: 0.6 } },
      { tool: "remove_silence", args: { clipId: "{{clipId}}", ranges: "{{silenceRanges}}" } },
      { tool: "add_caption", args: { source: "script", text: "{{script}}" } },
    ],
  },
  {
    id: "reels-cutdown",
    name: "Reels cutdown",
    steps: [
      { tool: "reframe", args: { aspect: "9:16", mode: "crop-center", confirm: true } },
      { tool: "add_title", args: { text: "{{title}}", style: "{{style}}", startFrame: 0, durationFrames: 90 } },
    ],
  },
];

export type StarterProject = {
  id: string;
  name: string;
  aspect: "16:9" | "9:16" | "1:1";
  seedTitle?: boolean;
  seedMusic?: boolean;
  seedCaption?: boolean;
};

export const STARTER_PROJECTS: StarterProject[] = [
  { id: "blank-16x9", name: "Blank 16:9", aspect: "16:9" },
  { id: "blank-9x16", name: "Blank 9:16", aspect: "9:16" },
  { id: "blank-1x1", name: "Blank 1:1", aspect: "1:1" },
  { id: "title-music", name: "Title + music", aspect: "16:9", seedTitle: true, seedMusic: true },
  { id: "subtitled-talk", name: "Subtitled talk", aspect: "16:9", seedCaption: true },
];
