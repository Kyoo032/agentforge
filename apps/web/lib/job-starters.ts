import type { DocumentDraft } from "./document-outline";
import type { PresentationOutline } from "./presentation-outline";

export type DocumentStarter = {
  id: string;
  label: string;
  description: string;
  draft: DocumentDraft;
};

export type PresentationStarter = {
  id: string;
  label: string;
  description: string;
  outline: PresentationOutline;
};

export const DOCUMENT_STARTERS: DocumentStarter[] = [
  {
    id: "status-memo",
    label: "Status memo",
    description: "Weekly status you can download as DOCX without a live generate.",
    draft: {
      title: "Weekly status memo",
      sections: [
        {
          heading: "Summary",
          body: "Replace this paragraph with what shipped this week, what slipped, and what you need from readers.",
        },
        {
          heading: "Progress",
          body: "List finished work in plain language. Keep claims specific so the memo can stand on its own.",
        },
        {
          heading: "Risks and next steps",
          body: "Name blockers, owners, and the next decision. Download the DOCX and edit locally.",
        },
      ],
    },
  },
  {
    id: "one-pager",
    label: "One-pager brief",
    description: "A short brief with goal, audience, and ask.",
    draft: {
      title: "One-pager brief",
      sections: [
        {
          heading: "Goal",
          body: "State the outcome in one paragraph. Say who this is for and what success looks like.",
        },
        {
          heading: "Approach",
          body: "Outline the work in two or three sentences. Avoid filler and campus jargon.",
        },
        {
          heading: "Ask",
          body: "Write the decision or resource you need. Keep it short enough to read in a minute.",
        },
      ],
    },
  },
];

export const PRESENTATION_STARTERS: PresentationStarter[] = [
  {
    id: "project-update",
    label: "Project update",
    description: "A short deck outline you can preview and download as PPTX.",
    outline: {
      title: "Project update",
      slides: [
        {
          heading: "Where we are",
          bullets: ["What shipped", "What moved", "What is still open"],
          notes: "Keep this slide factual. Add dates when you have them.",
        },
        {
          heading: "What we need",
          bullets: ["Decision", "Owner", "Date"],
          notes: "End with a single ask so the room knows what to do.",
        },
        {
          heading: "Next two weeks",
          bullets: ["Milestone", "Risk to watch", "Who follows up"],
          notes: "",
        },
      ],
    },
  },
  {
    id: "decision-brief",
    label: "Decision brief",
    description: "Options, recommendation, and a next step.",
    outline: {
      title: "Decision brief",
      slides: [
        {
          heading: "Decision",
          bullets: ["What we must choose", "Why now", "Who is affected"],
          notes: "One decision per deck.",
        },
        {
          heading: "Options",
          bullets: ["Option A", "Option B", "Trade-off in one line"],
          notes: "Do not hide the recommendation.",
        },
        {
          heading: "Recommendation",
          bullets: ["Pick", "Why it wins", "First step after the meeting"],
          notes: "",
        },
      ],
    },
  },
];

export function findDocumentStarter(id: string): DocumentStarter | undefined {
  return DOCUMENT_STARTERS.find((item) => item.id === id);
}

export function findPresentationStarter(id: string): PresentationStarter | undefined {
  return PRESENTATION_STARTERS.find((item) => item.id === id);
}
