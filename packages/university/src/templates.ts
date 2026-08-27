import type { InputModality } from "@agentforge/core";

export type AgentTemplate = {
  key: string;
  pack: string;
  packLabel: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  inputModalities: InputModality[];
  toolKeys: string[];
};

export type AgentPack = {
  id: string;
  label: string;
  templates: AgentTemplate[];
};

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
