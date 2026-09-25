import type { AgentTemplate, AgentPack } from "@agentforge/core";

export const STUDENTS_PACK_ID = "students";

const studentsTemplate: AgentTemplate = {
  key: "students",
  pack: STUDENTS_PACK_ID,
  packLabel: "Students",
  name: "Student",
  description: "Optional starter for coursework, study plans, and campus questions.",
  systemPrompt:
    "You are a student assistant. Explain clearly, do not complete graded work for the user, and use catalog or campus tools only when they help answer the question.",
  model: "gpt-5.6-sol",
  inputModalities: ["text", "image"],
  productModes: ["chat", "documents", "research", "images", "presentations", "education"],
  toolKeys: ["calculator", "datetime", "course_catalog.search", "campus_faq.lookup"],
};

export const universityTemplates: AgentTemplate[] = [studentsTemplate];

export const agentPacks: AgentPack[] = [
  {
    id: STUDENTS_PACK_ID,
    label: "Students",
    templates: universityTemplates,
  },
];
