export type LibraryMode = "images" | "videos" | "documents" | "research" | "presentations";

export type LibraryEntry = {
  mode: LibraryMode;
  title: string;
  prompt: string;
  resultSummary: string;
};

export type WorkspaceTemplate = {
  id: string;
  label: string;
  description: string;
};

export const TEMPLATE_LIBRARY: LibraryEntry[] = [
  {
    mode: "images",
    title: "Product hero shot",
    prompt:
      "Photorealistic hero image of a wireless earbuds case on matte charcoal stone, soft side light, shallow depth of field, space for headline text on the left.",
    resultSummary: "Clean product photo with empty space for marketing copy.",
  },
  {
    mode: "images",
    title: "App UI mockup",
    prompt:
      "Modern desktop app screenshot mockup: left sidebar with icons, main canvas with a sparse dashboard, muted slate palette, crisp 4k render, no logos.",
    resultSummary: "Neutral UI frame you can drop into pitch decks.",
  },
  {
    mode: "images",
    title: "Workshop mood board",
    prompt:
      "Flat-lay mood board of sketchbooks, colored pencils, sticky notes, and a laptop corner on a light oak desk, natural window light, top-down.",
    resultSummary: "Warm desk scene for creative or planning posts.",
  },
  {
    mode: "images",
    title: "Quiet kitchen morning",
    prompt:
      "Sunlit kitchen counter with a ceramic mug, sliced citrus, and linen napkin, steam rising, soft window light, photorealistic, generous negative space.",
    resultSummary: "Calm breakfast still you can crop for a header.",
  },
  {
    mode: "images",
    title: "City dusk overlook",
    prompt:
      "Wide dusk city overlook from a rooftop terrace, warm street lights just coming on, long shadows, cinematic 35mm look, no people in the foreground.",
    resultSummary: "Moody skyline frame for evening or travel posts.",
  },
  {
    mode: "images",
    title: "Fabric close-up",
    prompt:
      "Macro photo of folded wool and cotton swatches in sand, charcoal, and cream, visible weave, studio softbox, square crop, no logos or labels.",
    resultSummary: "Tactile textile detail for lookbooks and palettes.",
  },
  {
    mode: "images",
    title: "Storefront window",
    prompt:
      "Evening storefront window with a single chair, a lamp, and a hanging plant, reflections of wet pavement, warm interior glow versus cool street light.",
    resultSummary: "Quiet retail scene with a story-ready window.",
  },
  {
    mode: "images",
    title: "Trail in fog",
    prompt:
      "Foggy forest path with wet pine needles, a wooden footbridge, pale morning light, shallow depth of field, landscape 16:9, no text or watermarks.",
    resultSummary: "Soft nature path for covers and calm backgrounds.",
  },
  {
    mode: "images",
    title: "Soft portrait",
    prompt:
      "Natural-light portrait of an adult looking slightly off-camera, linen shirt, muted olive backdrop, gentle catchlight, 85mm look, no jewelry brands.",
    resultSummary: "Simple head-and-shoulders frame for profiles.",
  },
  {
    mode: "images",
    title: "Desk objects still",
    prompt:
      "Still life of a brass paperweight, fountain pen, and stacked notebooks on dark walnut, raking side light, deep shadows, editorial product styling.",
    resultSummary: "Quiet object study for essays and tool write-ups.",
  },
  {
    mode: "videos",
    title: "Feature walkthrough opener",
    prompt:
      "8-second cinematic open: camera glides across a laptop screen showing a clean chat UI, soft ambient desk lighting, subtle UI glow, no voiceover.",
    resultSummary: "Short opener clip for demos and launch videos.",
  },
  {
    mode: "videos",
    title: "Before/after process",
    prompt:
      "Split-screen style transition from a cluttered spreadsheet to a tidy kanban board, smooth wipe, soft corporate palette, 6 seconds.",
    resultSummary: "Simple before/after motion for process stories.",
  },
  {
    mode: "videos",
    title: "Silent social loop",
    prompt:
      "Vertical 9:16 loop of abstract paper folds morphing into a paper plane that flies off-frame, pastel paper textures, seamless loop, no text.",
    resultSummary: "Muted vertical loop for social backgrounds.",
  },
  {
    mode: "videos",
    title: "Product turntable",
    prompt:
      "6-second slow turntable of a matte water bottle on seamless gray, even studio light, subtle reflection, no logos, hold last frame clean.",
    resultSummary: "Simple 360 spin for a product page.",
  },
  {
    mode: "videos",
    title: "Window rain loop",
    prompt:
      "Seamless 8-second loop of rain on a night window, city bokeh beyond the glass, slow rack focus, no faces, no text, ambient only.",
    resultSummary: "Calm rain loop for intros and holds.",
  },
  {
    mode: "videos",
    title: "Coffee pour",
    prompt:
      "Close-up 5-second pour of coffee into a ceramic cup, steam, warm kitchen light, shallow focus, gentle handheld, end on the filled cup.",
    resultSummary: "Short pour clip for morning or lifestyle edits.",
  },
  {
    mode: "documents",
    title: "One-page brief",
    prompt:
      "Write a one-page project brief with sections: Goal, Audience, Constraints, Success metrics, Open questions. Keep tone direct and industry-neutral.",
    resultSummary: "Structured brief ready to paste into a doc.",
  },
  {
    mode: "documents",
    title: "Meeting notes digest",
    prompt:
      "Turn raw meeting notes into Decisions, Action items (owner + due date placeholders), and Parking lot. Drop filler chatter.",
    resultSummary: "Action-oriented digest from messy notes.",
  },
  {
    mode: "documents",
    title: "RFC outline",
    prompt:
      "Draft an RFC outline: Problem, Motivation, Proposed design, Alternatives considered, Rollout plan, Risks. Use short paragraphs.",
    resultSummary: "Skeleton RFC for design discussions.",
  },
  {
    mode: "documents",
    title: "Decision memo",
    prompt:
      "Write a one-page decision memo: Context, Options (two or three), Recommendation, Tradeoffs, and Follow-up. Short paragraphs, no filler.",
    resultSummary: "Clear memo that names a choice and why.",
  },
  {
    mode: "documents",
    title: "Kickoff agenda",
    prompt:
      "Draft a 45-minute kickoff agenda with time boxes, owners, and a desired outcome per block. Include a 5-minute wrap and parking lot.",
    resultSummary: "Timed kickoff plan you can send as-is.",
  },
  {
    mode: "documents",
    title: "Handoff checklist",
    prompt:
      "Create a handoff checklist: What is done, What is in progress, Who owns what, Known risks, and Where files live. Use checkboxes.",
    resultSummary: "Practical list so someone else can pick up.",
  },
  {
    mode: "research",
    title: "Competitive scan",
    prompt:
      "Compare three approaches to local-first AI workspaces. For each: positioning, strengths, gaps, and one open question. Cite assumptions clearly.",
    resultSummary: "Side-by-side scan with explicit assumptions.",
  },
  {
    mode: "research",
    title: "Source synthesis",
    prompt:
      "Synthesize the attached sources into themes, disagreements, and evidence gaps. Prefer bullet lists over long prose.",
    resultSummary: "Theme map with where sources conflict.",
  },
  {
    mode: "research",
    title: "Question backlog",
    prompt:
      "From this topic, produce 12 research questions ordered by impact, each with a one-line why-it-matters note.",
    resultSummary: "Prioritized question list to drive inquiry.",
  },
  {
    mode: "research",
    title: "Landscape snapshot",
    prompt:
      "Map the current landscape for this topic: who the main players are, how they differ, and what changed in the last year. Flag weak evidence.",
    resultSummary: "One-page landscape with dated caveats.",
  },
  {
    mode: "research",
    title: "Claim check",
    prompt:
      "Take the attached claim and list supporting evidence, contradicting evidence, and what would change your mind. Keep each item to one line.",
    resultSummary: "Balanced check on a single claim.",
  },
  {
    mode: "research",
    title: "Options matrix",
    prompt:
      "Build a comparison matrix for three options. Rows: cost, time, risk, lock-in, reversibility. Mark unknowns instead of guessing.",
    resultSummary: "Option grid that shows gaps, not just winners.",
  },
  {
    mode: "presentations",
    title: "Pitch narrative arc",
    prompt:
      "Outline a 7-slide pitch: Problem, Insight, Solution, How it works, Traction or plan, Ask, Next step. One sentence per slide.",
    resultSummary: "Tight pitch arc with one line per slide.",
  },
  {
    mode: "presentations",
    title: "Status update deck",
    prompt:
      "Build a 5-slide status update: Wins this week, Risks, Decisions needed, Metrics snapshot, Next week focus. Keep bullets short.",
    resultSummary: "Lean weekly status skeleton.",
  },
  {
    mode: "presentations",
    title: "Workshop opener",
    prompt:
      "Design a 4-slide workshop opener: Purpose, Agenda with times, Working agreements, Desired outcomes. Friendly and clear.",
    resultSummary: "Facilitator opener for sessions.",
  },
  {
    mode: "presentations",
    title: "Launch readout",
    prompt:
      "Outline a 6-slide launch readout: What shipped, Who it is for, How to try it, Known limits, Support path, Next milestone. One beat per slide.",
    resultSummary: "Ship-day deck with try-it and limits.",
  },
  {
    mode: "presentations",
    title: "Retro slides",
    prompt:
      "Build a 5-slide retro: What we tried, What worked, What stalled, What we will change, Owners for next cycle. Keep bullets under eight words.",
    resultSummary: "Honest retro that ends in owners.",
  },
  {
    mode: "presentations",
    title: "All-hands recap",
    prompt:
      "Design a 6-slide all-hands recap: Wins, Misses, One metric that moved, A story from the floor, Asks, Thank-yous. Friendly and brief.",
    resultSummary: "Room-friendly recap, not a status dump.",
  },
];

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: "organisation",
    label: "Organisation",
    description: "Cross-team workspace for shared agents, threads, and tools.",
  },
  {
    id: "students",
    label: "Students",
    description: "Starter pack for study and campus-oriented templates.",
  },
  {
    id: "office",
    label: "Office",
    description: "Everyday ops: notes, briefs, and meeting follow-ups.",
  },
  {
    id: "legal",
    label: "Legal",
    description: "Templates tuned for contracts, memos, and review flows.",
  },
  {
    id: "sales",
    label: "Sales",
    description: "Outreach, discovery notes, and deal-room helpers.",
  },
  {
    id: "marketing",
    label: "Marketing",
    description: "Campaign briefs, creative prompts, and launch checklists.",
  },
  {
    id: "product",
    label: "Product",
    description: "Specs, RFCs, and roadmap-oriented agent starters.",
  },
];

const WORKSPACE_IDS = new Set(WORKSPACE_TEMPLATES.map((entry) => entry.id));

export function libraryForMode(mode: LibraryMode): LibraryEntry[] {
  return TEMPLATE_LIBRARY.filter((entry) => entry.mode === mode);
}

export function isWorkspaceTemplateId(id: string): boolean {
  return WORKSPACE_IDS.has(id);
}
