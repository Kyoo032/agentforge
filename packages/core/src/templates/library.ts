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
