/**
 * One harness per mode, packed from the 2026-09-25 skill list.
 *
 * A skill is a work or design ability of that mode. "has" means the pipeline already
 * does the work and this catalog only names it. "new" means this change wires it.
 * "off" means the ability exists and is deliberately not offered.
 *
 * Education-specific drafts live in the university pack. This file only names the skills.
 */

export type HarnessSkillStatus = "has" | "new" | "off";

export type HarnessSkill = {
  id: string;
  name: string;
  status: HarnessSkillStatus;
};

export type ModeHarness = {
  id: string;
  route: string;
  skills: readonly HarnessSkill[];
};

export const MODE_HARNESSES: readonly ModeHarness[] = [
  {
    id: "chat",
    route: "/chat",
    skills: [
      { id: "reply-on-a-thread", name: "Reply on a thread", status: "has" },
      { id: "use-desk-knowledge", name: "Use the desk's knowledge", status: "has" },
      { id: "call-bound-tools", name: "Call the bound tools, then stop", status: "has" },
      { id: "refuse-wrong-attachment", name: "Refuse the wrong attachment", status: "has" },
      { id: "keep-the-session", name: "Keep the session", status: "has" },
    ],
  },
  {
    id: "documents",
    route: "/documents",
    skills: [
      { id: "draft-sections", name: "Draft the sections", status: "has" },
      { id: "stay-inside-source", name: "Stay inside the source", status: "has" },
      { id: "rewrite-one-section", name: "Rewrite one section", status: "has" },
      { id: "preview-and-download", name: "Preview and download", status: "has" },
      { id: "check-against-source", name: "Check the draft against the source", status: "new" },
    ],
  },
  {
    id: "research",
    route: "/research",
    skills: [
      { id: "plan-queries", name: "Plan the queries", status: "has" },
      { id: "search", name: "Search", status: "has" },
      { id: "read-pages", name: "Read the pages", status: "has" },
      { id: "verbatim-passages", name: "Pull verbatim passages", status: "has" },
      { id: "write-dossier", name: "Write the dossier", status: "has" },
    ],
  },
  {
    id: "finance",
    route: "/finance",
    skills: [
      { id: "financial-brief", name: "Financial brief", status: "has" },
      { id: "cash-flow", name: "Cash flow and runway", status: "has" },
      { id: "budget-versus-actual", name: "Budget versus actual", status: "has" },
      { id: "investment-appraisal", name: "Investment appraisal", status: "has" },
      { id: "ratio-health", name: "Ratio health check", status: "has" },
    ],
  },
  {
    id: "data",
    route: "/data",
    skills: [
      { id: "take-table", name: "Take the table in", status: "has" },
      { id: "private-database", name: "Load a private database", status: "has" },
      { id: "query-do-not-guess", name: "Query, do not guess", status: "has" },
      { id: "show-evidence", name: "Show the evidence", status: "has" },
      { id: "follow-up", name: "Ask a follow-up", status: "has" },
    ],
  },
  {
    id: "market",
    route: "/market",
    skills: [
      { id: "build-packet", name: "Build the packet", status: "has" },
      { id: "write-briefing", name: "Write one desk's briefing", status: "has" },
      { id: "run-team", name: "Run the team", status: "has" },
      { id: "rewrite-section", name: "Rewrite one section", status: "has" },
      { id: "export-briefing", name: "Export the briefing", status: "has" },
    ],
  },
  {
    id: "legal",
    route: "/legal",
    skills: [
      { id: "open-matter", name: "Open the matter", status: "has" },
      { id: "diff-prior-turn", name: "Diff the prior turn", status: "has" },
      { id: "review-playbook", name: "Review against the playbook", status: "has" },
      { id: "verify-then-edit", name: "Verify, then edit", status: "has" },
      { id: "deliver-set", name: "Deliver the set", status: "has" },
    ],
  },
  {
    id: "meeting",
    route: "/meeting",
    skills: [
      { id: "capture-meeting", name: "Capture the meeting", status: "has" },
      { id: "transcribe", name: "Transcribe", status: "has" },
      { id: "write-minutes", name: "Write the minutes", status: "has" },
      { id: "guard-names", name: "Guard the names", status: "has" },
      { id: "translate-minutes", name: "Translate the minutes", status: "has" },
    ],
  },
  {
    id: "images",
    route: "/images",
    skills: [
      { id: "generate-still", name: "Generate a still", status: "has" },
      { id: "choose-frame", name: "Choose the frame", status: "has" },
      { id: "estimate-cost", name: "Estimate the cost", status: "has" },
      { id: "tighten-prompt", name: "Tighten the prompt", status: "has" },
      { id: "keep-gallery", name: "Keep the gallery", status: "has" },
    ],
  },
  {
    id: "videos",
    route: "/videos",
    skills: [
      { id: "generate-clip", name: "Generate a clip", status: "has" },
      { id: "start-from-still", name: "Start from a still", status: "has" },
      { id: "bill-snapped-length", name: "Bill the snapped length", status: "has" },
      { id: "estimate-and-tighten", name: "Estimate the cost and tighten the prompt", status: "has" },
      { id: "keep-gallery", name: "Keep the gallery", status: "has" },
    ],
  },
  {
    id: "music",
    route: "/music",
    skills: [
      { id: "describe-song", name: "Describe a song", status: "has" },
      { id: "desk-lyrics", name: "Use the desk's lyrics", status: "has" },
      { id: "draft-lyrics", name: "Draft lyrics first", status: "has" },
      { id: "keep-both-takes", name: "Keep both takes", status: "has" },
      { id: "speak-text", name: "Speak the text", status: "off" },
    ],
  },
  {
    id: "edit",
    route: "/edit",
    skills: [
      { id: "cut-timeline", name: "Cut the timeline", status: "has" },
      { id: "clean-sound", name: "Clean the sound", status: "has" },
      { id: "title-and-caption", name: "Title and caption", status: "has" },
      { id: "generate-onto-timeline", name: "Generate onto the timeline", status: "has" },
      { id: "export", name: "Export", status: "has" },
    ],
  },
  {
    id: "presentations",
    route: "/presentations",
    skills: [
      { id: "generate-outline", name: "Generate the outline", status: "has" },
      { id: "rewrite-one-slide", name: "Rewrite one slide", status: "has" },
      { id: "download-pptx", name: "Download the PPTX", status: "has" },
      { id: "edit-text", name: "Edit text", status: "new" },
      { id: "add-shapes", name: "Add shapes", status: "new" },
    ],
  },
  {
    id: "education",
    route: "/education",
    skills: [
      { id: "teaching-deck", name: "Teaching deck", status: "new" },
      { id: "edit-text-and-shapes", name: "Edit text and add shapes", status: "new" },
      { id: "exam-from-knowledge", name: "Exam from the knowledge base", status: "new" },
      { id: "book-reader", name: "Book reader with local OCR", status: "new" },
      { id: "video-presenter", name: "Video presenter", status: "new" },
    ],
  },
  {
    id: "knowledge",
    route: "/knowledge",
    skills: [
      { id: "soul-and-memory", name: "Set Soul and pinned memory", status: "has" },
      { id: "ingest-source", name: "Ingest a source", status: "has" },
      { id: "retrieve-into-chat", name: "Retrieve into Chat", status: "has" },
      { id: "map-and-verify", name: "Map and verify", status: "has" },
      { id: "read-file-stop-on-scan", name: "Read a file locally, and stop on a scan", status: "has" },
    ],
  },
];

export function harnessFor(id: string): ModeHarness | undefined {
  return MODE_HARNESSES.find((harness) => harness.id === id);
}

/** Skills this change wires. Existing pipelines stay where they are. */
export function wiredSkillIds(): string[] {
  return MODE_HARNESSES.flatMap((harness) =>
    harness.skills.filter((skill) => skill.status === "new").map((skill) => `${harness.id}:${skill.id}`),
  );
}
