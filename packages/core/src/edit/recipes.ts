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
  /** One line shown under the starter picker. */
  description: string;
  aspect: "16:9" | "9:16" | "1:1";
  seedTitle?: boolean;
  seedMusic?: boolean;
  seedCaption?: boolean;
  /** Bundled sample files (see starter-media.json), laid out in order on v1 / a1. */
  media?: string[];
};

export const STARTER_PROJECTS: StarterProject[] = [
  { id: "blank-16x9", name: "Blank 16:9", description: "Empty landscape timeline.", aspect: "16:9" },
  { id: "blank-9x16", name: "Blank 9:16", description: "Empty portrait timeline.", aspect: "9:16" },
  { id: "blank-1x1", name: "Blank 1:1", description: "Empty square timeline.", aspect: "1:1" },
  {
    id: "promo-16x9",
    name: "Product promo",
    description: "Title card, three sample shots, and a music bed. Swap the shots for your footage.",
    aspect: "16:9",
    seedTitle: true,
    media: ["promo-skyline-16x9.mp4", "promo-detail-16x9.mp4", "promo-motion-16x9.mp4", "music-bed-18s.m4a"],
  },
  {
    id: "talk-16x9",
    name: "Talking head + subtitles",
    description: "A 20 second talk clip with a sample caption. Try “Remove the silences”.",
    aspect: "16:9",
    seedCaption: true,
    media: ["talk-20s-16x9.mp4"],
  },
  {
    id: "reels-9x16",
    name: "Reels 9:16",
    description: "Vertical sample clip with a title. Ready for Reels or Shorts.",
    aspect: "9:16",
    seedTitle: true,
    media: ["reel-10s-9x16.mp4"],
  },
  {
    id: "square-1x1",
    name: "Square social",
    description: "Square sample loop for feed posts.",
    aspect: "1:1",
    media: ["square-8s-1x1.mp4"],
  },
];
