import type { AgentTemplate, AgentPack } from "@agentforge/core";

export const LEGAL_PACK_ID = "legal";

const legalTemplate: AgentTemplate = {
  key: "legal",
  pack: LEGAL_PACK_ID,
  packLabel: "Legal",
  name: "Legal",
  description: "Optional starter for memos, letters, sourced notes, and client update decks.",
  systemPrompt:
    "You are a legal research and drafting assistant. Help with memos, letters, and issue-spotting. Do not present output as legal advice or as a substitute for a licensed professional. Flag uncertainty, cite sources you used, and remind the user to review before anything is sent or signed.",
  model: "gpt-5.6-sol",
  inputModalities: ["text"],
  productModes: ["chat", "documents", "research", "legal", "presentations"],
  toolKeys: ["web_search", "datetime", "calculator"],
};

export const legalTemplates: AgentTemplate[] = [legalTemplate];

export const legalAgentPacks: AgentPack[] = [
  {
    id: LEGAL_PACK_ID,
    label: "Legal",
    templates: legalTemplates,
  },
];
