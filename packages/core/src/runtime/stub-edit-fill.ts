export type StubFillScenario = {
  id: "F1" | "F2" | "F3" | "F4" | "F5";
  match: RegExp;
  toolKey: string;
  buildArgs: (text: string) => Record<string, unknown>;
  cardVerb: string;
  cardObject: string;
};

export const STUB_FILL_SCENARIOS: StubFillScenario[] = [
  {
    id: "F1",
    match: /generate storyboard/i,
    toolKey: "generate_storyboard",
    buildArgs: (text) => {
      const header = text.match(/generate storyboard\s+(\d+)\s+shots\s+\(([^,]+),\s*([^)]+)\):\s*(.+)/i);
      const shots = header?.[1] === "6" ? 6 : 4;
      const aspect = header?.[2]?.trim() === "9:16" ? "9:16" : header?.[2]?.trim() === "1:1" ? "1:1" : "16:9";
      const tier =
        header?.[3]?.trim() === "draft"
          ? "draft"
          : header?.[3]?.trim() === "cinematic"
            ? "cinematic"
            : "standard";
      const scene = header?.[4]?.trim() || text.replace(/generate storyboard/i, "").trim() || "Storyboard scene";
      return { scene, shots, aspect, tier };
    },
    cardVerb: "Storyboard",
    cardObject: "still shots",
  },
  {
    id: "F2",
    match: /animate storyboard/i,
    toolKey: "animate_storyboard",
    buildArgs: (text) => {
      const clipMatch = text.match(/animate storyboard clips?\s+([a-f0-9-,\s]+)\s+\(/i);
      const header = text.match(/\(([^,]+),\s*([^)]+)\)/);
      const aspect = header?.[1]?.trim() === "9:16" ? "9:16" : header?.[1]?.trim() === "1:1" ? "1:1" : "16:9";
      const tier =
        header?.[2]?.trim() === "draft"
          ? "draft"
          : header?.[2]?.trim() === "cinematic"
            ? "cinematic"
            : "standard";
      const clipIds =
        clipMatch?.[1]
          ?.split(/[,\s]+/)
          .map((item) => item.trim())
          .filter(Boolean) ?? [];
      return { clipIds: clipIds.length > 0 ? clipIds : ["stub-still-1"], aspect, tier };
    },
    cardVerb: "Animate",
    cardObject: "storyboard",
  },
  {
    id: "F3",
    match: /run recipe/i,
    toolKey: "run_recipe",
    buildArgs: (text) => {
      const idMatch = text.match(/run recipe\s+([a-z0-9-]+)/i);
      return { recipeId: idMatch?.[1] ?? "podcast-clean-up" };
    },
    cardVerb: "Recipe",
    cardObject: "plan",
  },
  {
    id: "F4",
    match: /match look/i,
    toolKey: "match_look",
    buildArgs: () => ({ referenceClipId: "stub-ref", clipId: "stub-target" }),
    cardVerb: "Match look",
    cardObject: "reference",
  },
  {
    id: "F5",
    match: /propose alt cut|alternate cut/i,
    toolKey: "propose_alt_cut",
    buildArgs: () => ({ clipIds: ["stub-a", "stub-b"] }),
    cardVerb: "Alt cut",
    cardObject: "v_compare",
  },
];

export function matchStubFillScenario(text: string): StubFillScenario | null {
  for (const scenario of STUB_FILL_SCENARIOS) {
    if (scenario.match.test(text)) {
      return scenario;
    }
  }
  return null;
}

export function matchStubGenerateScenario(text: string): StubFillScenario | null {
  if (/^generate image/i.test(text)) {
    return {
      id: "F1",
      match: /^generate image/i,
      toolKey: "generate_image",
      buildArgs: (raw) => {
        const header = raw.match(/generate image\s+\(([^,]+),\s*([^)]+)\):\s*(.+)/i);
        const aspect = header?.[1]?.trim() === "9:16" ? "9:16" : header?.[1]?.trim() === "1:1" ? "1:1" : "16:9";
        const tier =
          header?.[2]?.trim() === "draft"
            ? "draft"
            : header?.[2]?.trim() === "cinematic"
              ? "cinematic"
              : "standard";
        const prompt = header?.[3]?.trim() || "Generated still";
        return { prompt, aspect, tier };
      },
      cardVerb: "Generate image",
      cardObject: "still",
    };
  }
  if (/^generate video/i.test(text)) {
    return {
      id: "F1",
      match: /^generate video/i,
      toolKey: "generate_video",
      buildArgs: (raw) => {
        const header = raw.match(/generate video(?: from still)?\s+\(([^,]+),\s*([^,)]+)(?:,\s*model [^)]+)?\):\s*(.+?)(?:\s+still=|$)/i);
        const aspect = header?.[1]?.trim() === "9:16" ? "9:16" : header?.[1]?.trim() === "1:1" ? "1:1" : "16:9";
        const tier =
          header?.[2]?.trim() === "draft"
            ? "draft"
            : header?.[2]?.trim() === "cinematic"
              ? "cinematic"
              : "standard";
        const prompt = header?.[3]?.trim() || "Generated clip";
        return { prompt, aspect, tier, seconds: 4 };
      },
      cardVerb: "Generate video",
      cardObject: "clip",
    };
  }
  return null;
}
